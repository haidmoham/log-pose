'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const LIMITS = Object.freeze({ response_bytes: 1024 * 1024, page: 100, claims: 200000,
  milliseconds: 750, cache_kib: 8192, handles: 2 });
const PREDICATES = new Set(['possible_substitute_for', 'named_competitor_of', 'integrates_with',
  'announced_partnership_with', 'invested_in', 'shared_exposure_hypothesis']);
const REVIEW_LENS = 'current_accepted_at_build';
const NOTES = [
  'source publication cutoff includes a claim only when every premise was published by the cutoff.',
  'published-through is evidence availability, not relationship validity or operational replay.',
  'accepted hypotheses remain untested hypotheses; graph position and order do not encode strength.'
];

class ReviewedAtlasError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function fileDigest(filename) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const block = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, block, 0, block.length, null)) > 0) {
      hash.update(block.subarray(0, bytes));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}
function parameter(params, name, fallback = '') {
  const values = params.getAll(name);
  if (values.length > 1) throw new ReviewedAtlasError(400, 'invalid_request', `repeat parameter: ${name}`);
  const value = values.length ? values[0] : fallback;
  if (value.length > (name.includes('cursor') ? 2048 : 240)) {
    throw new ReviewedAtlasError(400, 'invalid_request', `${name} exceeds its length budget`);
  }
  return value;
}
function integer(params, name, fallback, maximum) {
  const value = parameter(params, name, String(fallback));
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
    throw new ReviewedAtlasError(400, 'invalid_request', `invalid ${name}`);
  }
  return Number(value);
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function selection(params) {
  for (const unsupported of ['year', 'inventory_year', 'source', 'category', 'artifact',
    'valid_at', 'valid_from', 'valid_to', 'replay', 'system_time', 'review_cutoff']) {
    if (params.has(unsupported)) throw new ReviewedAtlasError(400, 'unsupported_clock',
      `reviewed relationships do not support ${unsupported}`);
  }
  const clock = parameter(params, 'clock', 'source_publication');
  const temporal_mode = parameter(params, 'temporal_mode', 'published_through');
  const review_lens = parameter(params, 'review_lens', REVIEW_LENS);
  if (clock !== 'source_publication' || temporal_mode !== 'published_through'
      || review_lens !== REVIEW_LENS) {
    throw new ReviewedAtlasError(400, 'unsupported_clock', 'only the current accepted publication-time lens is supported');
  }
  const cutoff = parameter(params, 'cutoff');
  if (cutoff && !validDate(cutoff)) throw new ReviewedAtlasError(400, 'invalid_request', 'invalid cutoff');
  const basis = parameter(params, 'basis', 'documented');
  if (!['documented', 'hypothesis', 'all'].includes(basis)) throw new ReviewedAtlasError(400, 'invalid_request', 'invalid basis');
  const predicate = parameter(params, 'predicate');
  if (predicate && predicate !== 'all' && !PREDICATES.has(predicate)) throw new ReviewedAtlasError(400, 'invalid_request', 'invalid predicate');
  const direction = parameter(params, 'direction', 'both');
  if (!['both', 'in', 'out'].includes(direction)) throw new ReviewedAtlasError(400, 'invalid_request', 'invalid direction');
  return { clock, temporal_mode, cutoff, review_lens, basis, predicate: predicate === 'all' ? '' : predicate, direction };
}
function encodeCursor(binding, position) {
  return Buffer.from(JSON.stringify({ binding, position })).toString('base64url');
}
function cursorPosition(params, binding) {
  const cursor = parameter(params, 'cursor');
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.binding !== binding || !Number.isSafeInteger(parsed.position) || parsed.position < 0
        || parsed.position > LIMITS.claims) throw new Error();
    return parsed.position;
  } catch { throw new ReviewedAtlasError(409, 'cursor_mismatch', 'cursor belongs to another build, selection or page'); }
}
function position(id, version) {
  const bytes = crypto.createHash('sha256').update(`${version}:${id}`).digest();
  return { x: bytes.readUInt32BE(0) / 0xffffffff, y: bytes.readUInt32BE(4) / 0xffffffff };
}
function where(selectionValue, entityId = null) {
  const clauses = []; const values = [];
  if (selectionValue.cutoff) { clauses.push('latest_source_date<=?'); values.push(selectionValue.cutoff); }
  if (selectionValue.basis === 'documented') clauses.push("status IN ('documented','reviewed_inference')");
  else if (selectionValue.basis === 'hypothesis') clauses.push("status='hypothesis'");
  if (selectionValue.predicate) { clauses.push('predicate=?'); values.push(selectionValue.predicate); }
  if (entityId) {
    clauses.push('(subject_id=? OR object_id=?)'); values.push(entityId, entityId);
    if (selectionValue.direction === 'out') {
      clauses.push("(direction='symmetric' OR (direction='subject_to_object' AND subject_id=?)"
        + " OR (direction='object_to_subject' AND object_id=?))");
      values.push(entityId, entityId);
    } else if (selectionValue.direction === 'in') {
      clauses.push("(direction='symmetric' OR (direction='subject_to_object' AND object_id=?)"
        + " OR (direction='object_to_subject' AND subject_id=?))");
      values.push(entityId, entityId);
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function createReviewedAtlasHandler(root = path.join(__dirname, 'data/atlas-reviewed')) {
  const stores = new Map();
  function open(buildId = '') {
    if (buildId && !/^[a-f0-9]{64}$/.test(buildId)) {
      throw new ReviewedAtlasError(410, 'build_unavailable', 'reviewed build is not hosted');
    }
    const manifestName = buildId ? `${buildId}.json` : 'current.json';
    const manifestPath = path.join(root, manifestName);
    if (!fs.existsSync(manifestPath)) throw new ReviewedAtlasError(410, 'build_unavailable', 'reviewed build is not hosted');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (buildId && manifest.build_id !== buildId) throw new ReviewedAtlasError(410, 'build_unavailable', 'reviewed build is not hosted');
    if (stores.has(manifest.build_id)) return stores.get(manifest.build_id);
    const databasePath = path.join(root, manifest.database);
    const stat = fs.statSync(databasePath);
    if (stat.size !== manifest.database_bytes || fileDigest(databasePath) !== manifest.database_sha256) {
      throw new ReviewedAtlasError(503, 'snapshot_invalid', 'reviewed snapshot checksum differs');
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec(`PRAGMA query_only=ON; PRAGMA cache_size=-${LIMITS.cache_kib}`);
    const stored = JSON.parse(database.prepare("SELECT value FROM metadata WHERE key='manifest'").get().value);
    if (stored.build_id !== manifest.build_id || stored.versions.query !== manifest.versions.query) {
      database.close(); throw new ReviewedAtlasError(503, 'snapshot_invalid', 'reviewed snapshot version differs');
    }
    const store = { manifest, database };
    stores.set(manifest.build_id, store);
    while (stores.size > LIMITS.handles) { const oldest = stores.entries().next().value; oldest[1].database.close(); stores.delete(oldest[0]); }
    return store;
  }
  function descriptor(store, id) {
    const row = store.database.prepare('SELECT * FROM entity WHERE id=?').get(id);
    if (!row) throw new ReviewedAtlasError(404, 'unknown_entity', 'reviewed entity is absent from this build');
    const links = store.database.prepare('SELECT candidate_id,identity_review_id FROM candidate_link WHERE entity_id=? ORDER BY candidate_id LIMIT ?')
      .all(id, LIMITS.page + 1);
    if (links.length > LIMITS.page) {
      throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'reviewed identity links require a narrower page');
    }
    return { id, entity_slug: id, name: row.name, target_kind: row.target_kind,
      candidate_links: links, position: position(id, store.manifest.versions.layout) };
  }
  function resolve(store, params, entityName = 'entity') {
    const entity = parameter(params, entityName); const candidate = parameter(params, 'candidate');
    let candidateEntity = '';
    if (candidate) {
      const link = store.database.prepare('SELECT entity_id FROM candidate_link WHERE candidate_id=?').get(candidate);
      if (!link) throw new ReviewedAtlasError(404, 'unknown_identity', 'candidate has no reviewed entity link');
      candidateEntity = link.entity_id;
    }
    if (entity && candidateEntity && entity !== candidateEntity) throw new ReviewedAtlasError(409, 'identity_mismatch', 'entity and candidate resolve differently');
    const resolved = entity || candidateEntity;
    if (!resolved) throw new ReviewedAtlasError(400, 'invalid_request', `${entityName} or candidate is required`);
    descriptor(store, resolved); return resolved;
  }
  function common(store, operation, selected, entity = '') {
    const frame = { build_id: store.manifest.build_id, selection: selected, resolved_entity: entity };
    return { build_id: store.manifest.build_id, versions: store.manifest.versions, selection: selected,
      frame_id: digest(frame), receipt_id: digest({ ...frame, operation }), limitations: NOTES, operation };
  }
  function workBudget() {
    const started = performance.now(); let rows = 0;
    return { add(count) {
      rows += count;
      if (rows > LIMITS.claims || performance.now() - started > LIMITS.milliseconds) {
        throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'narrow reviewed filters');
      }
    }, remaining() { return LIMITS.claims - rows; } };
  }
  function boundedMetadata(store, sql, values, budget) {
    const remaining = budget.remaining();
    const rows = store.database.prepare(`${sql} LIMIT ?`).all(...values, remaining + 1);
    if (rows.length > remaining) throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'narrow reviewed filters');
    budget.add(rows.length); return rows;
  }
  function fullClaim(store, row, budget) {
    const claim = JSON.parse(row.detail_json);
    budget.add(Array.isArray(claim.sources) ? claim.sources.length : 0);
    const remaining = budget.remaining();
    claim.review_history = store.database.prepare('SELECT detail_json FROM review_history WHERE claim_id=? ORDER BY ordinal LIMIT ?')
      .all(row.id, remaining + 1).map(item => JSON.parse(item.detail_json));
    if (claim.review_history.length > remaining) {
      throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'narrow reviewed evidence');
    }
    budget.add(claim.review_history.length);
    return claim;
  }
  function focus(store, params, selected, budget = workBudget()) {
    const entity = resolve(store, params); const topK = integer(params, 'top_k', 60, 100);
    const limit = integer(params, 'limit', 100, 100); const filter = where(selected, entity);
    const rows = boundedMetadata(store,
      `SELECT id,subject_id,object_id FROM claim ${filter.sql} ORDER BY id`, filter.values, budget);
    const groups = new Map();
    for (const row of rows) { const neighbor = row.subject_id === entity ? row.object_id : row.subject_id;
      if (!groups.has(neighbor)) groups.set(neighbor, []); groups.get(neighbor).push(row.id); }
    const eligible = [...groups.keys()].sort(); const selectedNeighbors = eligible.slice(0, topK);
    const binding = digest({ build: store.manifest.build_id, selected, entity, topK, limit, operation: 'focus' });
    const offset = cursorPosition(params, binding); const page = selectedNeighbors.slice(offset, offset + limit);
    const edges = page.map(neighbor => ({ neighbor_id: neighbor, neighbor: descriptor(store, neighbor),
      claim_count: groups.get(neighbor).length, position: position(`${entity}:${neighbor}`, store.manifest.versions.layout) }));
    return { ...common(store, 'focus', selected, entity), focus: descriptor(store, entity), edges,
      returned: edges.length, count: { status: 'exact', value: eligible.length, grain: 'neighbor' },
      eligible_claim_count: rows.length, suppressed: Math.max(0, eligible.length - topK),
      next_cursor: offset + limit < selectedNeighbors.length ? encodeCursor(binding, offset + limit) : null,
      selection_policy: 'neighbor_id_ascii_asc' };
  }
  function explain(store, params, selected, budget = workBudget()) {
    const entity = resolve(store, params); const neighbor = parameter(params, 'neighbor');
    const claimId = parameter(params, 'claim');
    if (!neighbor && !claimId) throw new ReviewedAtlasError(400, 'invalid_request', 'neighbor or claim is required');
    const limit = integer(params, 'limit', 10, 25); const filter = where(selected, entity);
    let rows = boundedMetadata(store,
      `SELECT id,subject_id,object_id FROM claim ${filter.sql} ORDER BY id`, filter.values, budget);
    rows = rows.filter(row => claimId ? row.id === claimId :
      (row.subject_id === neighbor || row.object_id === neighbor));
    if (claimId && !rows.length) throw new ReviewedAtlasError(404, 'unknown_claim', 'claim is absent from this frame');
    if (claimId && neighbor && !rows.some(row => row.subject_id === neighbor || row.object_id === neighbor)) {
      throw new ReviewedAtlasError(409, 'claim_neighbor_mismatch', 'claim does not connect the requested neighbor');
    }
    const binding = digest({ build: store.manifest.build_id, selected, entity, neighbor, claimId, limit, operation: 'explain' });
    const offset = cursorPosition(params, binding); const pageMetadata = rows.slice(offset, offset + limit);
    let detailBytes = 0;
    for (const row of pageMetadata) {
      const counts = store.database.prepare(`SELECT
          (SELECT count(*) FROM claim_source WHERE claim_id=?) sources,
          (SELECT count(*) FROM review_history WHERE claim_id=?) reviews,
          (SELECT length(CAST(detail_json AS BLOB)) FROM claim WHERE id=?) detail_bytes`).get(row.id, row.id, row.id);
      budget.add(Number(counts.sources) + Number(counts.reviews));
      detailBytes += Number(counts.detail_bytes);
    }
    if (detailBytes > LIMITS.response_bytes) {
      throw new ReviewedAtlasError(422, 'response_budget_exceeded', 'use a smaller explain page');
    }
    const page = pageMetadata.map(row => store.database.prepare('SELECT * FROM claim WHERE id=?').get(row.id));
    budget.add(page.length);
    return { ...common(store, 'explain', selected, entity), focus: descriptor(store, entity),
      neighbor: neighbor ? descriptor(store, neighbor) : null, claims: page.map(row => fullClaim(store, row, budget)),
      returned: page.length, count: { status: 'exact', value: rows.length, grain: 'claim' },
      next_cursor: offset + limit < rows.length ? encodeCursor(binding, offset + limit) : null };
  }
  function traversalClaims(store, claimIds, budget) {
    return claimIds.map(id => {
      const row = store.database.prepare('SELECT * FROM claim WHERE id=?').get(id);
      if (!row) throw new ReviewedAtlasError(503, 'snapshot_invalid', 'reviewed path claim is absent');
      budget.add(1);
      return fullClaim(store, row, budget);
    });
  }
  function traverse(store, params, selected, budget = workBudget()) {
    const start = resolve(store, params); const target = parameter(params, 'target');
    if (!target) throw new ReviewedAtlasError(400, 'invalid_request', 'target is required');
    descriptor(store, target);
    const maxHops = integer(params, 'hops', 2, 3);
    const queue = [{ id: start, path: [] }]; const visited = new Set([start]);
    const found = path => {
      const materialized = path.map(edge => ({ from: edge.from, to: edge.to,
        claim_ids: edge.claim_ids, claims: traversalClaims(store, edge.claim_ids, budget) }));
      const base = common(store, 'traverse', selected, start);
      base.receipt_id = digest({ build_id: store.manifest.build_id, selection: selected,
        resolved_entity: start, operation: 'traverse', target, max_hops: maxHops });
      return { ...base, status: 'found', start: descriptor(store, start), target: descriptor(store, target),
        path: materialized, hops: materialized.length, visited: visited.size, exhaustive: false,
        selection_policy: 'breadth_first_neighbor_id_ascii_asc_then_claim_id_ascii_asc',
        meaning: 'a path groups eligible accepted claims; it does not establish a direct relationship' };
    };
    while (queue.length) {
      const current = queue.shift();
      if (current.id === target) return found(current.path);
      if (current.path.length === maxHops) continue;
      const filter = where(selected, current.id);
      const rows = boundedMetadata(store,
        `SELECT id,subject_id,object_id FROM claim ${filter.sql} ORDER BY id`, filter.values, budget);
      const groups = new Map();
      for (const row of rows) {
        const neighbor = row.subject_id === current.id ? row.object_id : row.subject_id;
        if (!groups.has(neighbor)) groups.set(neighbor, []);
        groups.get(neighbor).push(row.id);
      }
      for (const neighbor of [...groups.keys()].sort()) {
        if (visited.has(neighbor)) continue;
        const nextPath = [...current.path,
          { from: current.id, to: neighbor, claim_ids: groups.get(neighbor) }];
        if (visited.size >= 100) {
          const base = common(store, 'traverse', selected, start);
          base.receipt_id = digest({ build_id: store.manifest.build_id, selection: selected,
            resolved_entity: start, operation: 'traverse', target, max_hops: maxHops });
          return { ...base, status: 'visited_entity_budget_exhausted', start: descriptor(store, start),
            target: descriptor(store, target), path: null, hops: maxHops, visited: visited.size,
            exhaustive: false, selection_policy: 'breadth_first_neighbor_id_ascii_asc_then_claim_id_ascii_asc',
            meaning: 'the bounded search ended without inferring a relationship or reporting absence' };
        }
        visited.add(neighbor);
        if (neighbor === target) return found(nextPath);
        queue.push({ id: neighbor, path: nextPath });
      }
    }
    const base = common(store, 'traverse', selected, start);
    base.receipt_id = digest({ build_id: store.manifest.build_id, selection: selected,
      resolved_entity: start, operation: 'traverse', target, max_hops: maxHops });
    return { ...base, status: 'not_found_within_hop_limit', start: descriptor(store, start),
      target: descriptor(store, target), path: null, hops: maxHops, visited: visited.size,
      exhaustive: true, selection_policy: 'breadth_first_neighbor_id_ascii_asc_then_claim_id_ascii_asc',
      meaning: 'no eligible path was found in this bounded publication-time scope; this is not relationship absence' };
  }
  function handle(params) {
    try {
      const started = performance.now();
      const selected = selection(params); const store = open(parameter(params, 'build_id'));
      const mode = parameter(params, 'mode', 'discover'); let body;
      if (mode === 'discover') {
        const filter = where(selected); const counts = store.database.prepare(`SELECT count(*) claims,count(DISTINCT subject_id)+count(DISTINCT object_id) endpoint_mentions FROM claim ${filter.sql}`).get(...filter.values);
        const selectedPredicates = new Map(store.database.prepare(`SELECT predicate id,count(*) count FROM claim ${filter.sql} GROUP BY predicate ORDER BY predicate`)
          .all(...filter.values).map(row => [row.id, Number(row.count)]));
        const predicates = store.database.prepare('SELECT predicate id,count(*) total_count FROM claim GROUP BY predicate ORDER BY predicate')
          .all().map(row => ({ id: row.id, count: selectedPredicates.get(row.id) || 0,
            total_count: Number(row.total_count) }));
        const sourceDateRows = store.database.prepare('SELECT DISTINCT source_date FROM claim_source ORDER BY source_date LIMIT ?')
          .all(LIMITS.claims + 1);
        if (sourceDateRows.length > LIMITS.claims) throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'reviewed source dates exceed work budget');
        const source_dates = sourceDateRows.map(row => row.source_date);
        body = { ...common(store, mode, selected), counts: { ...store.manifest.counts, selected_claims: counts.claims }, predicates, source_dates, review_lens: REVIEW_LENS };
      } else if (mode === 'search') {
        const query = parameter(params, 'query').toLowerCase(); const limit = integer(params, 'limit', 60, 100);
        const binding = digest({ build: store.manifest.build_id, selected, query, limit, operation: mode }); const offset = cursorPosition(params, binding);
        const terms = [`%${query}%`, `%${query}%`];
        const count = Number(store.database.prepare('SELECT count(*) count FROM entity WHERE lower(name) LIKE ? OR lower(id) LIKE ?').get(...terms).count);
        if (count > LIMITS.claims) throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'narrow reviewed search');
        const page = store.database.prepare('SELECT id FROM entity WHERE lower(name) LIKE ? OR lower(id) LIKE ? ORDER BY id LIMIT ? OFFSET ?')
          .all(...terms, limit, offset);
        body = { ...common(store, mode, selected), entities: page.map(row => descriptor(store, row.id)),
          returned: page.length, count: { status: 'exact', value: count, grain: 'entity' }, next_cursor: offset + limit < count ? encodeCursor(binding, offset + limit) : null };
      } else if (mode === 'focus') body = focus(store, params, selected);
      else if (mode === 'explain') body = explain(store, params, selected);
      else if (mode === 'traverse') body = traverse(store, params, selected);
      else if (mode === 'compare') {
        const entity = resolve(store, params); const compareCutoff = parameter(params, 'compare_cutoff');
        if (!validDate(compareCutoff)) throw new ReviewedAtlasError(400, 'invalid_request', 'invalid compare_cutoff');
        const compareBudget = workBudget();
        const rowsFor = cutoff => { const next = { ...selected, cutoff }; const filter = where(next, entity);
          return boundedMetadata(store, `SELECT id,predicate,status FROM claim ${filter.sql} ORDER BY id`, filter.values, compareBudget); };
        const before = new Map(rowsFor(compareCutoff).map(row => [row.id, row])); const after = new Map(rowsFor(selected.cutoff).map(row => [row.id, row]));
        const compareSelection = { ...selected, compare_cutoff: compareCutoff };
        body = { ...common(store, mode, compareSelection, entity), focus: descriptor(store, entity), compare_cutoff: compareCutoff,
          additions: [...after.values()].filter(row => !before.has(row.id)), removals: [...before.values()].filter(row => !after.has(row.id)),
          caveat: 'differences are source-publication availability, not relationship activity' };
      } else if (mode === 'export') {
        const exportBudget = workBudget();
        const focused = focus(store, params, selected, exportBudget); let explained = null;
        if (params.has('neighbor') || params.has('claim')) {
          const evidenceParams = new URLSearchParams(params);
          evidenceParams.set('limit', parameter(params, 'evidence_limit', '10'));
          evidenceParams.delete('cursor');
          if (params.has('evidence_cursor')) evidenceParams.set('cursor', parameter(params, 'evidence_cursor'));
          explained = explain(store, evidenceParams, selected, exportBudget);
        }
        body = { ...common(store, mode, selected, focused.focus.id), focus: focused, explained };
      } else throw new ReviewedAtlasError(400, 'invalid_request', 'unsupported reviewed operation');
      if (performance.now() - started > LIMITS.milliseconds) throw new ReviewedAtlasError(422, 'query_budget_exceeded', 'narrow reviewed filters');
      if (Buffer.byteLength(JSON.stringify(body)) > LIMITS.response_bytes) throw new ReviewedAtlasError(422, 'response_budget_exceeded', 'use a smaller page');
      return { status: 200, body };
    } catch (error) {
      if (error instanceof ReviewedAtlasError) return { status: error.status, body: { error: error.code, message: error.message } };
      return { status: 500, body: { error: 'reviewed_provider_error', message: 'reviewed provider failed' } };
    }
  }
  handle.close = () => { for (const store of stores.values()) store.database.close(); stores.clear(); };
  return handle;
}

module.exports = { createReviewedAtlasHandler, ReviewedAtlasError, REVIEW_LENS, LIMITS };
