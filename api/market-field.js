// The graph is built from retained inventory observations before deployment.
// This module is shared by the Vercel function and the local read server.
'use strict';

const graph = require('./data/market-field-graph.json');
const projection = require('../web/data/topology-discovery.json');

const MAX_PAGE = 100;
const MAX_NEIGHBOR_PAGE = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const candidateIndex = new Map(graph.candidates.map((candidate, index) => [candidate.id, index]));
const fullCandidates = new Map(projection.nodes.map(candidate => [candidate.id, candidate]));
const artifactByHash = new Map(projection.artifacts.map(artifact => [artifact.raw_sha256, artifact]));
const reviewPairs = new Map(projection.edges.map(edge =>
  [[edge.subject_candidate_id, edge.object_candidate_id].sort().join(':'), edge]));
const tagOrder = ['ai_automation', 'data_infrastructure', 'developer_tools', 'security_observability'];

if (projection.build_id !== graph.input_hashes.projection_build_id ||
    projection.counts.possible_pairs !== graph.pairs.length ||
    projection.counts.nodes !== graph.candidates.length) {
  throw new Error('market field graph and detail projection differ');
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

function handleMarketField(searchParams) {
  try {
    const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
    const mode = parameter(params, 'mode', 'summary');
    if (!['summary', 'query', 'detail'].includes(mode)) throw new Error('invalid mode');
    if (mode === 'summary') return response(200, { schema_version: graph.schema_version,
      build_id: graph.build_id, status: graph.status, counts: graph.counts,
      facets: graph.facets, candidates: graph.candidates.map(fieldCandidate), input_hashes: graph.input_hashes });
    const requestedBuild = parameter(params, 'build_id', '');
    if (requestedBuild !== graph.build_id) return response(409, {
      error: 'build_version_mismatch', build_id: graph.build_id });
    return mode === 'query' ? query(params) : detail(params);
  } catch (error) {
    if (error.message.startsWith('invalid ') || error.message.startsWith('repeat ') ||
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
