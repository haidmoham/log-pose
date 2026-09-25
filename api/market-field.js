// The graph is built from retained inventory observations before deployment.
// This module is shared by the Vercel function and the local read server.
'use strict';

const crypto = require('node:crypto');
const graph = require('./data/market-field-graph.json');
const layout = require('./data/market-field-layout.json');
const projection = require('../web/data/topology-discovery.json');

const MAX_PAGE = 100;
const MAX_NEIGHBOR_PAGE = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const candidateIndex = new Map(graph.candidates.map((candidate, index) => [candidate.id, index]));
const fullCandidates = new Map(projection.nodes.map(candidate => [candidate.id, candidate]));
const artifactByHash = new Map(projection.artifacts.map(artifact => [artifact.raw_sha256, artifact]));
const reviewPairs = new Map(projection.edges.map(edge =>
  [[edge.subject_candidate_id, edge.object_candidate_id].sort().join(':'), edge]));
const artifactsBySourceYear = new Map(projection.artifacts.map(artifact =>
  [`${artifact.source}:${artifact.year}`, artifact]));
const tagOrder = ['ai_automation', 'data_infrastructure', 'developer_tools', 'security_observability'];

function canonicalEncode(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalEncode).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalEncode(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function verifyGraphDetail(readGraph, detailProjection) {
  const projectionSha256 = crypto.createHash('sha256')
    .update(canonicalEncode(detailProjection)).digest('hex');
  if (projectionSha256 !== readGraph.input_hashes.projection_sha256 ||
      detailProjection.build_id !== readGraph.input_hashes.projection_build_id ||
      detailProjection.counts.possible_pairs !== readGraph.pairs.length ||
      detailProjection.counts.nodes !== readGraph.candidates.length) {
    throw new Error('market field graph and detail projection differ');
  }
}

let graphDetailMismatch = false;
try {
  verifyGraphDetail(graph, projection);
  if (layout.build_id !== graph.build_id || Object.keys(layout.positions).length !== graph.candidates.length) {
    throw new Error('market field layout and graph differ');
  }
} catch {
  graphDetailMismatch = true;
}

function response(status, body) {
  if (status === 200 && Buffer.byteLength(JSON.stringify(body)) > MAX_RESPONSE_BYTES) {
    return { status: 413, body: { error: 'response_too_large',
      message: 'narrow the field or request a smaller page' } };
  }
  return { status, body };
}

function fieldCandidate(candidate) {
  const { id, name, candidate_tags, observed_years, identity_review } = candidate;
  return { id, name, candidate_tags, observed_years, identity_review: Boolean(identity_review) };
}

function parameter(params, name, fallback) {
  const values = params.getAll(name);
  if (values.length > 1) throw new Error(`repeat parameter: ${name}`);
  return values.length ? values[0] : fallback;
}

function numberParameter(params, name, fallback, maximum) {
  const raw = parameter(params, name, String(fallback));
  if (!/^(0|[1-9]\d*)$/.test(raw) || Number(raw) > maximum) {
    throw new Error(`invalid ${name}`);
  }
  return Number(raw);
}

function readFilters(params) {
  const filters = {
    source: parameter(params, 'source', 'all'),
    year: parameter(params, 'year', 'all'),
    category: parameter(params, 'category', 'all'),
    tag: parameter(params, 'tag', 'all'),
    identity: parameter(params, 'identity', 'all'),
    query: parameter(params, 'query', '')
  };
  if (filters.query.length > 200 || filters.source.length > 200 ||
      filters.year.length > 20 || filters.category.length > 200) {
    throw new Error('filter exceeds maximum length');
  }
  if (filters.tag !== 'all' && !tagOrder.includes(filters.tag)) throw new Error('invalid tag');
  if (!['all', 'reviewed', 'unreviewed'].includes(filters.identity)) throw new Error('invalid identity');
  filters.terms = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return filters;
}

function matchesKey(keyIndex, filters) {
  const [source, year, category] = graph.keys[keyIndex];
  return (filters.source === 'all' || source === filters.source)
    && (filters.year === 'all' || year === Number(filters.year))
    && (filters.category === 'all' || category === filters.category);
}

function matchesCandidate(index, filters) {
  const candidate = graph.candidates[index];
  if (filters.tag !== 'all' && !candidate.candidate_tags.includes(filters.tag)) return false;
  if (filters.identity === 'reviewed' && !candidate.identity_review) return false;
  if (filters.identity === 'unreviewed' && candidate.identity_review) return false;
  if ((filters.source !== 'all' || filters.year !== 'all' || filters.category !== 'all')
      && !graph.candidate_key_indices[index].some(key => matchesKey(key, filters))) return false;
  const categories = graph.candidate_key_indices[index].map(key => graph.keys[key][2]);
  const haystack = [candidate.name, candidate.description, ...candidate.candidate_tags, ...categories]
    .join(' ').toLocaleLowerCase();
  return filters.terms.every(term => haystack.includes(term));
}

function candidateSort(leftIndex, rightIndex) {
  const left = graph.candidates[leftIndex];
  const right = graph.candidates[rightIndex];
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function primaryTag(candidate) {
  return tagOrder.find(tag => candidate.candidate_tags.includes(tag)) || tagOrder[0];
}

function query(params) {
  const filters = readFilters(params);
  const offset = numberParameter(params, 'offset', 0, graph.candidates.length);
  const limit = numberParameter(params, 'limit', 80, MAX_PAGE);
  const neighborOffset = numberParameter(params, 'neighbor_offset', 0, graph.candidates.length);
  const neighborLimit = numberParameter(params, 'neighbor_limit', MAX_NEIGHBOR_PAGE, MAX_NEIGHBOR_PAGE);
  if (limit === 0 || neighborLimit === 0) throw new Error('page limits must be positive');
  const focusId = parameter(params, 'candidate', '');
  if (focusId && !candidateIndex.has(focusId)) return response(404, { error: 'unknown_candidate' });

  const matched = graph.candidates.map((_, index) => index).filter(index => matchesCandidate(index, filters));
  matched.sort(candidateSort);
  const matchedSet = new Set(matched);
  const matchingPairIndices = new Set();
  for (const index of matched) for (const pairIndex of graph.adjacency[index]) matchingPairIndices.add(pairIndex);
  const flows = new Map();
  let pairCount = 0;
  for (const pairIndex of matchingPairIndices) {
    const [left, right, keys] = graph.pairs[pairIndex];
    if (!matchedSet.has(left) || !matchedSet.has(right) || !keys.some(key => matchesKey(key, filters))) continue;
    pairCount += 1;
    const tags = [primaryTag(graph.candidates[left]), primaryTag(graph.candidates[right])].sort();
    const flowKey = tags.join(':');
    flows.set(flowKey, (flows.get(flowKey) || 0) + 1);
  }
  const observationCount = matched.reduce((count, index) => count +
    graph.candidate_key_indices[index].filter(key => matchesKey(key, filters)).length, 0);

  let neighbors = [];
  if (focusId && matchedSet.has(candidateIndex.get(focusId))) {
    const focus = candidateIndex.get(focusId);
    for (const pairIndex of graph.adjacency[focus]) {
      const [left, right, keys] = graph.pairs[pairIndex];
      const other = left === focus ? right : left;
      if (!matchedSet.has(other)) continue;
      const matchingKeys = keys.filter(key => matchesKey(key, filters));
      if (matchingKeys.length) neighbors.push({ candidate: fieldCandidate(graph.candidates[other]),
        keys: matchingKeys.map(key => graph.keys[key]), pair: { left: graph.candidates[left].id,
          right: graph.candidates[right].id } });
    }
    neighbors.sort((left, right) => right.keys.length - left.keys.length
      || left.candidate.name.localeCompare(right.candidate.name)
      || left.candidate.id.localeCompare(right.candidate.id));
  }
  const candidatePage = matched.slice(offset, offset + limit)
    .map(index => fieldCandidate(graph.candidates[index]));
  return response(200, {
    schema_version: graph.schema_version, build_id: graph.build_id,
    total_candidates: matched.length, candidate_ids: matched.map(index => graph.candidates[index].id),
    candidates: candidatePage, offset, limit,
    next_offset: offset + candidatePage.length < matched.length ? offset + candidatePage.length : null,
    observation_count: observationCount, pair_count: pairCount,
    tag_flows: [...flows].sort(([left], [right]) => left.localeCompare(right)).map(([tags, count]) => {
      const [left, right] = tags.split(':');
      return { left, right, count };
    }),
    neighbor_count: neighbors.length,
    neighbors: neighbors.slice(neighborOffset, neighborOffset + neighborLimit),
    neighbor_offset: neighborOffset, neighbor_limit: neighborLimit,
    next_neighbor_offset: neighborOffset + neighborLimit < neighbors.length ? neighborOffset + neighborLimit : null
  });
}

function detail(params) {
  const candidateId = parameter(params, 'candidate', '');
  const neighborId = parameter(params, 'neighbor', '');
  const candidate = fullCandidates.get(candidateId);
  const neighbor = neighborId ? fullCandidates.get(neighborId) : null;
  if (!candidate || (neighborId && !neighbor)) return response(404, { error: 'unknown_candidate' });
  const shared = [];
  if (neighbor) {
    const otherObservations = new Map(neighbor.observations.map(observation =>
      [JSON.stringify([observation.source, observation.year, observation.source_category]), observation]));
    for (const observation of candidate.observations) {
      const other = otherObservations.get(JSON.stringify([
        observation.source, observation.year, observation.source_category]));
      if (!other) continue;
      if (observation.artifact_sha256 !== other.artifact_sha256) {
        throw new Error('shared placement has mismatched pinned artifacts');
      }
      const artifact = artifactByHash.get(observation.artifact_sha256);
      shared.push({ source: observation.source, year: observation.year,
        source_category: observation.source_category, artifact_sha256: observation.artifact_sha256,
        source_commit: artifact.commit, source_committed_at: artifact.commit_at,
        source_url: artifact.url, coverage_status: artifact.coverage_status,
        partition_path: observation.partition_path,
        subject_occurrence_ids: observation.occurrence_ids,
        object_occurrence_ids: other.occurrence_ids,
        subject_rows: observation.rows, object_rows: other.rows });
    }
  }
  const reviewPair = neighbor ? reviewPairs.get([candidateId, neighborId].sort().join(':')) || null : null;
  return response(200, { schema_version: graph.schema_version, build_id: graph.build_id,
    candidate, neighbor, shared_observations: shared,
    in_review_worklist: Boolean(reviewPair), review_pair: reviewPair });
}

function temporalTimeline() {
  return response(200, { schema_version: graph.schema_version, build_id: graph.build_id,
    clocks: { active: 'inventory_year', precision: 'year',
      commit_at: 'pinned_source_commit_time', source_publication: 'unknown',
      event_validity: 'unknown', ingestion: 'not_available', review: 'not_available' },
    accumulation: { meaning: 'observed_at_or_before_selected_inventory_year',
      validity: 'previously_observed_does_not_mean_valid_today' },
    frames: projection.artifacts.map(artifact => ({ source: artifact.source, year: artifact.year,
      commit_at: artifact.commit_at, coverage_status: artifact.coverage_status,
      artifact_sha256: artifact.raw_sha256, source_url: artifact.url,
      repository: artifact.repository, commit: artifact.commit,
      observation_basis: artifact.observation_basis })) });
}

function temporalFrameId(options) {
  return crypto.createHash('sha256').update(JSON.stringify({ query_version: 1, ...options })).digest('hex');
}

function temporalFrame(params) {
  const source = parameter(params, 'source', '');
  const yearValue = parameter(params, 'year', '');
  const mode = parameter(params, 'temporal_mode', 'snapshot');
  const clock = parameter(params, 'clock', 'inventory_year');
  const candidateId = parameter(params, 'candidate', '');
  const neighborId = parameter(params, 'neighbor', '');
  const offset = numberParameter(params, 'offset', 0, graph.candidates.length);
  const category = parameter(params, 'category', 'all');
  const queryText = parameter(params, 'query', '').trim().toLocaleLowerCase();
  if (!['cncf', 'lfai'].includes(source)) throw new Error('invalid source');
  if (!/^20\d{2}$/.test(yearValue)) throw new Error('invalid year');
  if (!['snapshot', 'accumulated'].includes(mode)) throw new Error('invalid temporal_mode');
  if (clock !== 'inventory_year') throw new Error('unsupported temporal clock');
  if (queryText.length > 200 || category.length > 200) throw new Error('filter exceeds maximum length');
  const year = Number(yearValue);
  const artifact = artifactsBySourceYear.get(`${source}:${year}`);
  const candidates = projection.nodes;
  const artifactYears = projection.artifacts.filter(item => item.source === source
    && item.year <= year).map(item => item.year).sort((left, right) => left - right);
  const compareArtifact = projection.artifacts.filter(item => item.source === source && item.year < year)
    .sort((left, right) => right.year - left.year)[0] || null;
  const requestedCompareYear = parameter(params, 'compare_year', compareArtifact ? String(compareArtifact.year) : '');
  const compareYear = requestedCompareYear === 'none' ? '' : requestedCompareYear;
  if (compareYear && (!/^20(?:20|2[1-6])$/.test(compareYear)
      || !artifactsBySourceYear.has(`${source}:${Number(compareYear)}`)
      || Number(compareYear) >= year)) throw new Error('invalid compare_year');
  const comparison = compareYear ? artifactsBySourceYear.get(`${source}:${Number(compareYear)}`) : null;
  const frameId = temporalFrameId({ build_id: graph.build_id, source, year, mode,
    compare_year: comparison?.year ?? null, category, query: queryText,
    candidate: candidateId || null, neighbor: neighborId || null, offset,
    limit: numberParameter(params, 'limit', 60, 100) });
  const selectedYears = mode === 'snapshot' ? (artifact ? [year] : []) : artifactYears;
  const comparisonYears = mode === 'snapshot'
    ? (comparison ? [Number(compareYear)] : []) : (comparison ? projection.artifacts
      .filter(item => item.source === source && item.year <= Number(compareYear))
      .map(item => item.year) : []);
  const keyMatches = key => key[0] === source
    && (selectedYears.includes(key[1])) && (category === 'all' || key[2] === category);
  const comparisonKeyMatches = key => key[0] === source
    && comparisonYears.includes(key[1]) && (category === 'all' || key[2] === category);
  const eligibleObservations = (candidate, years = selectedYears) => candidate.observations.filter(observation =>
    observation.source === source && years.includes(observation.year)
      && (category === 'all' || observation.source_category === category));
  const retainedRowCount = years => projection.nodes.reduce((count, candidate) =>
    count + candidate.observations.filter(item => item.source === source
      && years.includes(item.year) && (category === 'all' || item.source_category === category))
      .reduce((sum, item) => sum + item.rows.length, 0), 0);
  const availableCategories = [...new Set(candidates.flatMap(candidate => candidate.observations
    .filter(observation => observation.source === source && selectedYears.includes(observation.year))
    .map(observation => observation.source_category)))].sort();
  const rowNameMatch = candidate => eligibleObservations(candidate).some(observation =>
    observation.rows.some(row => `${row.name} ${row.description}`.toLocaleLowerCase().includes(queryText)));
  const eligibleName = candidate => eligibleObservations(candidate)[0]?.rows[0]?.name || candidate.name;
  const matchingCandidates = candidates.filter(candidate => eligibleObservations(candidate).length
    && (!queryText || rowNameMatch(candidate)))
    .sort((left, right) => eligibleName(left).localeCompare(eligibleName(right))
      || left.id.localeCompare(right.id));

  if (!artifact) return response(200, { schema_version: graph.schema_version,
    build_id: graph.build_id, status: 'missing_snapshot', source, year, temporal_mode: mode,
    frame_id: frameId, active_clock: 'inventory_year', precision: 'year',
    compare_year: comparison?.year ?? null,
    nodes: [], edges: [], changes: [], candidate_count: 0, edge_count: 0,
    coverage: { status: 'missing', source, year, source_rows: 0,
      explanation: 'No retained source snapshot exists for this provider and year.' },
    limitations: ['No frame is available. This gap does not establish that any candidate or relationship ended.'] });

  const nodeLimit = numberParameter(params, 'limit', 60, 100);
  if (nodeLimit === 0) throw new Error('page limits must be positive');
  const focus = candidateId ? candidates.find(candidate => candidate.id === candidateId) : null;
  if (candidateId && !focus) return response(404, { error: 'unknown_candidate' });
  if (neighborId && !candidates.some(candidate => candidate.id === neighborId)) {
    return response(404, { error: 'unknown_candidate' });
  }

  function candidateDescriptor(candidate, years = selectedYears) {
    const observations = eligibleObservations(candidate, years);
    const rows = observations.flatMap(observation => observation.rows);
    return { id: candidate.id, name: rows[0]?.name || `unobserved candidate ${candidate.id.slice(0, 8)}`,
      position: layout.positions[candidate.id],
      description: rows.find(row => row.description)?.description || '',
      observed_years: [...new Set(observations.map(item => item.year))],
      identity_status: 'unreviewed_candidate_key',
      observations: observations.map(observation => ({ source: observation.source,
        year: observation.year, source_category: observation.source_category,
        artifact_sha256: observation.artifact_sha256, partition_path: observation.partition_path,
        occurrence_ids: observation.occurrence_ids, rows: observation.rows })) };
  }
  function pairPlacements(pairIndex, matches) {
    return graph.pairs[pairIndex][2].filter(keyIndex => matches(graph.keys[keyIndex]))
      .map(keyIndex => graph.keys[keyIndex]);
  }
  function edgeMap(center, matches) {
    const result = new Map();
    const centerIndex = candidateIndex.get(center);
    for (const pairIndex of graph.adjacency[centerIndex]) {
      const [left, right] = graph.pairs[pairIndex];
      const otherIndex = left === centerIndex ? right : left;
      const placements = pairPlacements(pairIndex, matches);
      if (placements.length) result.set(graph.candidates[otherIndex].id, placements);
    }
    return result;
  }
  const suggestions = matchingCandidates.slice(0, 30).map(candidate => ({
    id: candidate.id, name: eligibleObservations(candidate)[0].rows[0]?.name || candidate.name }));
  if (!focus) {
    const matchedIndices = new Set(matchingCandidates.map(candidate => candidateIndex.get(candidate.id)));
    const contextEdges = [];
    let totalContextEdges = 0;
    for (const [left, right, keyIndices] of graph.pairs) {
      if (!matchedIndices.has(left) || !matchedIndices.has(right)) continue;
      const placements = keyIndices.filter(keyIndex => keyMatches(graph.keys[keyIndex]))
        .map(keyIndex => graph.keys[keyIndex]);
      if (!placements.length) continue;
      totalContextEdges += 1;
      if (contextEdges.length < 2500) contextEdges.push({ left: graph.candidates[left].id,
        right: graph.candidates[right].id });
    }
    return response(200, { schema_version: graph.schema_version, build_id: graph.build_id,
    status: 'ready', frame_id: frameId, source, year, temporal_mode: mode, compare_year: comparison?.year ?? null,
    active_clock: 'inventory_year', precision: 'year', artifact: {
      commit_at: artifact.commit_at, coverage_status: artifact.coverage_status,
      artifact_sha256: artifact.raw_sha256, source_url: artifact.url, commit: artifact.commit,
      repository: artifact.repository, observation_basis: artifact.observation_basis },
    coverage: { status: artifact.coverage_status, selected_rows: retainedRowCount(selectedYears),
      eligible_candidates: matchingCandidates.length, source_candidates: candidates.filter(candidate =>
        candidate.observations.some(item => item.source === source && selectedYears.includes(item.year))).length },
    filters: { source, category, query: queryText }, suggestions, candidate_count: matchingCandidates.length,
    available_categories: availableCategories,
    focus: null,
    nodes: matchingCandidates.map(candidate => ({ id: candidate.id, name: eligibleName(candidate),
      position: layout.positions[candidate.id],
      observed_years: [...new Set(eligibleObservations(candidate).map(item => item.year))],
      identity_status: 'unreviewed_candidate_key', frame_presence: 'observed_in_selected_frame' })),
    edges: [], changes: [], context_edges: contextEdges,
    total_context_edges: totalContextEdges, context_edge_count: contextEdges.length,
    context_edges_truncated: totalContextEdges > contextEdges.length,
    limitations: temporalLimitations(mode) });
  }

  const focusHasSelectedObservation = eligibleObservations(focus).length > 0;
  const selectedNeighbors = edgeMap(candidateId, keyMatches);
  const comparisonNeighbors = comparisonYears.length ? edgeMap(candidateId, comparisonKeyMatches) : new Map();
  const unfilteredCurrent = category === 'all' ? selectedNeighbors : edgeMap(candidateId, key =>
    key[0] === source && selectedYears.includes(key[1]));
  const unfilteredPrevious = category === 'all' ? comparisonNeighbors : edgeMap(candidateId, key =>
    key[0] === source && comparisonYears.includes(key[1]));
  const changeIds = [...new Set([...selectedNeighbors.keys(), ...comparisonNeighbors.keys(),
    ...unfilteredCurrent.keys(), ...unfilteredPrevious.keys()])].sort();
  const changes = changeIds.map(id => {
    const current = selectedNeighbors.get(id) || [];
    const previous = comparisonNeighbors.get(id) || [];
    const currentUnfiltered = unfilteredCurrent.get(id) || [];
    const previousUnfiltered = unfilteredPrevious.get(id) || [];
    const currentFiltered = currentUnfiltered.length > 0 && current.length === 0;
    const previousFiltered = previousUnfiltered.length > 0 && previous.length === 0;
    const status = currentFiltered ? 'filtered_out_current'
      : previousFiltered ? 'filtered_out_previous'
        : current.length && previous.length ? 'observed_in_both'
          : current.length ? (comparisonYears.length ? 'newly_observed_in_selected_frame' : 'observed_without_comparison') : 'absent_from_selected_frame';
    return { candidate_id: id, status, current_placements: current,
      comparison_placements: previous, current_unfiltered_placements: currentUnfiltered,
      comparison_unfiltered_placements: previousUnfiltered };
  });
  const relevantChanges = changes.filter(change => change.status !== 'filtered_out_current'
    && change.status !== 'filtered_out_previous');
  const ordered = changes.slice().sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  const visibleChanges = ordered.slice(offset, offset + nodeLimit);
  const visibleIds = new Set([candidateId, ...visibleChanges.map(change => change.candidate_id)]);
  const visibleEdges = visibleChanges.filter(change => change.current_placements.length)
    .map(change => ({ candidate_id: change.candidate_id,
      placements: change.current_placements,
      status: change.status === 'observed_in_both' ? 'previously_observed'
        : change.status === 'newly_observed_in_selected_frame' ? 'first_observed_in_selected_evidence'
          : 'observed_in_selected_evidence' }));
  const visibleIndexById = new Map([...visibleIds].map(id => [id, candidateIndex.get(id)]));
  const contextEdges = [];
  let totalContextEdges = 0;
  for (const [id, index] of visibleIndexById) {
    for (const pairIndex of graph.adjacency[index]) {
      const [left, right] = graph.pairs[pairIndex];
      const otherIndex = left === index ? right : left;
      const otherId = graph.candidates[otherIndex].id;
      if (id >= otherId || !visibleIds.has(otherId)) continue;
      const placements = pairPlacements(pairIndex, keyMatches);
      if (placements.length) {
        totalContextEdges += 1;
        contextEdges.push({ left: id, right: otherId });
      }
    }
  }
  contextEdges.sort((left, right) => left.left.localeCompare(right.left)
    || left.right.localeCompare(right.right));
  const contextEdgeLimit = 2500;
  let detail = null;
  if (neighborId) {
    const currentChange = changes.find(change => change.candidate_id === neighborId);
    const focusDescriptor = candidateDescriptor(focus);
    const neighbor = candidates.find(candidate => candidate.id === neighborId);
    const neighborDescriptor = candidateDescriptor(neighbor);
    const placementDetails = keys => keys.map(([keySource, keyYear, keyCategory]) => {
      const leftObservation = focus.observations.find(item => item.source === keySource
        && item.year === keyYear && item.source_category === keyCategory);
      const rightObservation = neighbor.observations.find(item => item.source === keySource
        && item.year === keyYear && item.source_category === keyCategory);
      if (!leftObservation || !rightObservation
          || leftObservation.artifact_sha256 !== rightObservation.artifact_sha256) return null;
      const sourceArtifact = artifactsBySourceYear.get(`${keySource}:${keyYear}`);
      return { source: keySource, year: keyYear, source_category: keyCategory,
        artifact_sha256: leftObservation.artifact_sha256,
        source_url: sourceArtifact.url, source_commit: sourceArtifact.commit,
        source_committed_at: sourceArtifact.commit_at, coverage_status: sourceArtifact.coverage_status,
        partition_path: leftObservation.partition_path,
        subject_occurrence_ids: leftObservation.occurrence_ids,
        object_occurrence_ids: rightObservation.occurrence_ids,
        subject_rows: leftObservation.rows, object_rows: rightObservation.rows };
    }).filter(Boolean);
    detail = { focus: focusDescriptor, neighbor: neighborDescriptor,
      status: currentChange?.status || 'not_observed_in_either_frame',
      selected_placements: placementDetails(currentChange?.current_unfiltered_placements || []),
      comparison_placements: placementDetails(currentChange?.comparison_unfiltered_placements || []),
      current_filtered_placements: currentChange?.current_placements || [],
      comparison_filtered_placements: currentChange?.comparison_placements || [] };
  }
  const nodeById = new Map([[candidateId, candidateDescriptor(focus)]]);
  for (const id of visibleIds) if (id !== candidateId) {
    const item = candidates.find(candidate => candidate.id === id);
    if (item) {
      const currentObservations = eligibleObservations(item);
      const descriptor = currentObservations.length ? candidateDescriptor(item)
        : candidateDescriptor(item, comparisonYears);
      descriptor.frame_presence = currentObservations.length ? 'observed_in_selected_frame'
        : 'comparison_context_only';
      nodeById.set(id, descriptor);
    }
  }
  const comparisonDescription = mode === 'snapshot'
    ? 'selected source snapshot compared with previous retained snapshot from the same provider'
    : 'observations accumulated through the selected source year; persistence means previously observed only';
  return response(200, { schema_version: graph.schema_version, build_id: graph.build_id,
    status: 'ready', frame_id: frameId, source, year, temporal_mode: mode, compare_year: comparison?.year ?? null,
    active_clock: 'inventory_year', precision: 'year', comparison_description: comparisonDescription,
    artifact: { commit_at: artifact.commit_at, coverage_status: artifact.coverage_status,
      artifact_sha256: artifact.raw_sha256, source_url: artifact.url, commit: artifact.commit,
      repository: artifact.repository, observation_basis: artifact.observation_basis },
    coverage: { status: artifact.coverage_status, selected_rows: retainedRowCount(selectedYears),
      eligible_candidates: matchingCandidates.length, source_candidates: candidates.filter(candidate =>
        candidate.observations.some(item => item.source === source && selectedYears.includes(item.year))).length,
      comparison_source_rows: comparison ? retainedRowCount(comparisonYears) : 0 },
    filters: { source, category, query: queryText }, focus: candidateId,
    available_categories: availableCategories,
    focus_present: focus.observations.some(observation => observation.source === source
      && selectedYears.includes(observation.year)),
    focus_filtered_out: !focusHasSelectedObservation && focus.observations.some(observation =>
      observation.source === source && selectedYears.includes(observation.year)),
    candidate_count: matchingCandidates.length,
    total_neighbors: relevantChanges.length, offset, limit: nodeLimit,
    next_offset: offset + visibleChanges.length < ordered.length ? offset + visibleChanges.length : null,
    truncated: offset + visibleChanges.length < ordered.length,
    changes: visibleChanges,
    total_changes: changes.length,
    nodes: [...nodeById.values()], edges: visibleEdges,
    context_edges: contextEdges.slice(0, contextEdgeLimit),
    context_edge_count: Math.min(contextEdges.length, contextEdgeLimit),
    total_context_edges: totalContextEdges,
    context_edges_truncated: totalContextEdges > contextEdgeLimit, detail,
    limitations: temporalLimitations(mode) });
}

function temporalLimitations(mode) {
  const limitations = [
    'First observed means first in this retained evidence slice, not when a project or relationship formed.',
    'Absence means absent from the selected source slice; it does not establish closure or relationship termination.',
    'Candidate identity keys and names remain unreviewed. Similar names can represent spelling changes or distinct projects.',
    'Stable candidate groupings are from the current build across retained years; they are not historical identity decisions.',
    'Source publication, event validity, ingestion, and review timestamps are not available for this inventory frame.'
  ];
  if (mode === 'accumulated') limitations.push(
    'Accumulation records prior observation only. It does not mean the candidate or overlap remains valid today.');
  limitations.push('Reviewed relationship overlays are unsupported because the reviewed claims do not have a compatible historical knowledge clock.');
  return limitations;
}

function handleMarketField(searchParams) {
  if (graphDetailMismatch) return response(503, { error: 'market_field_unavailable' });
  try {
    const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
    const mode = parameter(params, 'mode', 'summary');
    if (!['summary', 'query', 'detail', 'timeline', 'frame'].includes(mode)) throw new Error('invalid mode');
    if (mode === 'summary') return response(200, { schema_version: graph.schema_version,
      build_id: graph.build_id, status: graph.status, counts: graph.counts,
      facets: graph.facets, candidates: graph.candidates.map(fieldCandidate), input_hashes: graph.input_hashes });
    if (mode === 'timeline') {
      const requestedBuild = parameter(params, 'build_id', '');
      if (requestedBuild && requestedBuild !== graph.build_id) return response(409, {
        error: 'build_version_mismatch', build_id: graph.build_id });
      return temporalTimeline();
    }
    const requestedBuild = parameter(params, 'build_id', '');
    if (requestedBuild !== graph.build_id) return response(409, {
      error: 'build_version_mismatch', build_id: graph.build_id });
    return mode === 'query' ? query(params) : mode === 'detail' ? detail(params) : temporalFrame(params);
  } catch (error) {
    if (error.message.startsWith('invalid ') || error.message.startsWith('unsupported ')
        || error.message.startsWith('repeat ') ||
        error.message.includes('exceeds') || error.message.includes('must be positive')) {
      return response(400, { error: 'invalid_request', message: error.message });
    }
    return response(503, { error: 'market_field_unavailable' });
  }
}

function vercelHandler(request, reply) {
  if (request.method !== 'GET') {
    reply.setHeader('Allow', 'GET');
    return reply.status(405).json({ error: 'method_not_allowed' });
  }
  const params = new URL(request.url, 'http://localhost').searchParams;
  const result = handleMarketField(params);
  reply.setHeader('Cache-Control', result.status === 200
    ? (params.get('mode') === 'summary' || !params.get('mode')
      ? 'public, max-age=0, s-maxage=60' : 'public, max-age=0, s-maxage=3600')
    : 'no-store');
  return reply.status(result.status).json(result.body);
}

module.exports = vercelHandler;
module.exports.handleMarketField = handleMarketField;
module.exports.verifyGraphDetail = verifyGraphDetail;
