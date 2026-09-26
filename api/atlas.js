// The SQLite file is an immutable gold projection, never the evidence write store.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const LIMITS = Object.freeze({ response_bytes: 1024 * 1024, page: 100,
  memberships: 200000, placements: 4096, candidates: 20000,
  milliseconds: 750, sqlite_cache_kib: 8192, open_snapshots: 2 });
const QUERY_VERSION = 'atlas-query-v1';
const LAYOUT_VERSION = 'atlas-address-v1';
const NOTES = [
  'inventory co-listing is an unreviewed lead, not a company relationship.',
  'inventory years have year precision; missing observations do not establish exits.',
  'accumulation means previously observed, not continuously valid.',
  'identity keys and display positions are a present-day lens; system-known replay is unsupported.'
];

class AtlasError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fileDigest(filename) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(65536);
  const descriptor = fs.openSync(filename, 'r');
  try {
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, length));
    }
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}

function parameter(params, name, fallback = '') {
  const values = params.getAll(name);
  if (values.length > 1) throw new AtlasError(400, 'invalid_request', `repeat parameter: ${name}`);
  const value = values.length ? values[0] : fallback;
  if (value.length > (name === 'cursor' ? 2048 : 240)) {
    throw new AtlasError(400, 'invalid_request', `${name} exceeds its length budget`);
  }
  return value;
}

function integer(params, name, fallback, maximum) {
  const value = parameter(params, name, String(fallback));
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
    throw new AtlasError(400, 'invalid_request', `invalid ${name}`);
  }
  return Number(value);
}

function selectors(params) {
  const clock = parameter(params, 'clock', 'inventory_year');
  const mode = parameter(params, 'temporal_mode', 'snapshot');
  if (clock !== 'inventory_year' || !['snapshot', 'accumulated'].includes(mode)) {
    throw new AtlasError(400, 'unsupported_clock', 'only inventory-year reconstruction is supported');
  }
  const year = parameter(params, 'year');
  if (year && !/^\d{4}$/.test(year)) throw new AtlasError(400, 'invalid_request', 'invalid year');
  return { clock, temporal_mode: mode, source: parameter(params, 'source'),
    year, category: parameter(params, 'category'), artifact: parameter(params, 'artifact') };
}

function matches(placement, selection) {
  return (!selection.source || placement.source === selection.source)
    && (!selection.year || (selection.temporal_mode === 'accumulated'
      ? placement.inventory_year <= Number(selection.year)
      : placement.inventory_year === Number(selection.year)))
    && (!selection.category || placement.category === selection.category)
    && (!selection.artifact || placement.artifact_id === selection.artifact);
}

function budget() {
  const started = performance.now();
  let visited = 0;
  return {
    add(count) {
      visited += count;
      if (visited > LIMITS.memberships || performance.now() - started > LIMITS.milliseconds) {
        throw new AtlasError(422, 'query_budget_exceeded', 'narrow the source revision or category');
      }
    },
    receipt() { return { membership_rows_read: visited, elapsed_ms: performance.now() - started }; }
  };
}

function encodeCursor(binding, position) {
  return Buffer.from(JSON.stringify({ binding, position })).toString('base64url');
}

function cursorPosition(params, binding, fallback) {
  const value = parameter(params, 'cursor');
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed.binding !== binding) throw new Error('mismatch');
    if (Number.isInteger(fallback)) {
      if (!Number.isSafeInteger(parsed.position) || parsed.position < 0
          || parsed.position > LIMITS.candidates) throw new Error('invalid position');
    } else if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(parsed.position)) throw new Error('invalid position');
    return parsed.position;
  } catch {
    throw new AtlasError(409, 'cursor_mismatch', 'the cursor belongs to another build, filter or page size');
  }
}

function descriptor(row) {
  if (!row) throw new AtlasError(404, 'unknown_candidate', 'candidate is absent from this build');
  const candidate = JSON.parse(row.summary_json);
  return { id: row.id, name: row.name, identity_review: candidate.identity_review || null,
    candidate_tags: candidate.candidate_tags || [], record_type: candidate.record_type || 'inventory_candidate' };
}

function position(id) {
  const hash = crypto.createHash('sha256').update(`${LAYOUT_VERSION}:${id}`).digest();
  return { x: hash.readUInt32BE(0) / 0xffffffff, y: hash.readUInt32BE(4) / 0xffffffff };
}

function explanationParameters(params) {
  const fields = new URLSearchParams(params);
  fields.set('limit', parameter(params, 'evidence_limit', '10'));
  fields.delete('cursor');
  if (params.has('evidence_cursor')) fields.set('cursor', parameter(params, 'evidence_cursor'));
  return fields;
}

function compareRank(left, right) {
  return right.supporting_placements - left.supporting_placements
    || (left.candidate_id < right.candidate_id ? -1 : left.candidate_id > right.candidate_id ? 1 : 0);
}

// Keep the worst selected item at the heap root. Selection uses O(k) slots and
// O(n log k) comparisons; exact support counting still has a separate scan cap.
function selectTopK(connections, k) {
  const heap = [];
  for (const connection of connections) {
    if (heap.length < k) {
      heap.push(connection);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compareRank(heap[index], heap[parent]) <= 0) break;
        [heap[index], heap[parent]] = [heap[parent], heap[index]];
        index = parent;
      }
    } else if (compareRank(connection, heap[0]) < 0) {
      heap[0] = connection;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        const left = index * 2 + 1;
        const right = left + 1;
        const worseChild = right < heap.length && compareRank(heap[right], heap[left]) > 0 ? right : left;
        if (compareRank(heap[index], heap[worseChild]) >= 0) break;
        [heap[index], heap[worseChild]] = [heap[worseChild], heap[index]];
        index = worseChild;
      }
    }
  }
  return heap.sort(compareRank);
}

function createAtlasHandler(root = path.join(__dirname, 'data/atlas')) {
  const stores = new Map();

  function open(buildId) {
    if (buildId && !/^[a-f0-9]{64}$/.test(buildId)) {
      throw new AtlasError(410, 'build_unavailable', 'this build is not hosted; restore its immutable snapshot');
    }
    const manifestPath = path.join(root, buildId ? `${buildId}.json` : 'current.json');
    if (!fs.existsSync(manifestPath)) {
      throw new AtlasError(buildId ? 410 : 503, 'build_unavailable', 'the requested snapshot is unavailable');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(manifest.build_id)
        || manifest.database !== `${manifest.build_id}.sqlite`
        || (buildId && buildId !== manifest.build_id)) {
      throw new AtlasError(503, 'snapshot_mismatch', 'invalid snapshot manifest');
    }
    if (stores.has(manifest.build_id)) {
      const store = stores.get(manifest.build_id);
      stores.delete(manifest.build_id);
      stores.set(manifest.build_id, store);
      return store;
    }
    const databasePath = path.join(root, manifest.database);
    if (fs.statSync(databasePath).size !== manifest.database_bytes) {
      throw new AtlasError(503, 'snapshot_mismatch', 'snapshot byte length differs');
    }
    if (fileDigest(databasePath) !== manifest.database_sha256) {
      throw new AtlasError(503, 'snapshot_mismatch', 'snapshot checksum differs');
    }
    const db = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
    try {
      db.exec(`PRAGMA query_only=ON; PRAGMA cache_size=-${LIMITS.sqlite_cache_kib}; PRAGMA mmap_size=0;`);
      const stored = JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get('manifest').value);
      if (stored.build_id !== manifest.build_id || stored.versions.query !== QUERY_VERSION) {
        throw new AtlasError(503, 'snapshot_mismatch', 'snapshot versions differ');
      }
      const store = { db, manifest };
      stores.set(manifest.build_id, store);
      if (stores.size > LIMITS.open_snapshots) {
        const oldest = stores.keys().next().value;
        stores.get(oldest).db.close();
        stores.delete(oldest);
      }
      return store;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  function candidate(store, id) {
    return descriptor(store.db.prepare('SELECT id,name,summary_json FROM candidate WHERE id=?').get(id));
  }

  function placementsFor(store, id, work) {
    const rows = store.db.prepare(`SELECT p.*,a.source,a.inventory_year,a.raw_sha256
      FROM membership m JOIN placement p ON p.id=m.placement_id
      JOIN artifact a ON a.id=p.artifact_id WHERE m.candidate_id=?
      ORDER BY m.placement_id LIMIT ?`).all(id, LIMITS.placements + 1);
    work.add(rows.length);
    if (rows.length > LIMITS.placements) {
      throw new AtlasError(422, 'query_budget_exceeded', 'candidate history exceeds the interactive placement budget');
    }
    return rows;
  }

  function checkSelection(store, selection) {
    if (selection.artifact) {
      const artifact = store.db.prepare('SELECT * FROM artifact WHERE id=?').get(selection.artifact);
      if (!artifact || (selection.source && artifact.source !== selection.source)
          || (selection.year && artifact.inventory_year !== Number(selection.year))) {
        throw new AtlasError(404, 'missing_snapshot', 'artifact and source/year selectors do not match');
      }
    }
    if (selection.year) {
      if (!selection.source) throw new AtlasError(400, 'invalid_request', 'a year needs a source');
      const revisions = store.db.prepare('SELECT id FROM artifact WHERE source=? AND inventory_year=? LIMIT 2')
        .all(selection.source, Number(selection.year));
      if (!revisions.length) throw new AtlasError(404, 'missing_snapshot', 'no retained artifact at this stop');
      if (revisions.length > 1 && !selection.artifact && selection.temporal_mode === 'snapshot') {
        throw new AtlasError(409, 'ambiguous_revision', 'select the exact artifact revision');
      }
    }
  }

  function neighbors(store, id, selection, work, topK = null) {
    const focus = candidate(store, id);
    const placements = placementsFor(store, id, work).filter(item => matches(item, selection));
    const byCandidate = new Map();
    for (const placement of placements) {
      const members = store.db.prepare('SELECT candidate_id FROM membership WHERE placement_id=? ORDER BY candidate_id LIMIT ?')
        .all(placement.id, LIMITS.memberships + 1);
      work.add(members.length);
      for (const member of members) {
        if (member.candidate_id === id) continue;
        if (topK === null) {
          if (!byCandidate.has(member.candidate_id)) byCandidate.set(member.candidate_id, []);
          byCandidate.get(member.candidate_id).push(placement.id);
        } else {
          byCandidate.set(member.candidate_id, (byCandidate.get(member.candidate_id) || 0) + 1);
        }
      }
      if (byCandidate.size > LIMITS.candidates) {
        throw new AtlasError(422, 'query_budget_exceeded', 'distinct neighbors exceed the interactive budget');
      }
    }
    if (topK !== null) {
      function* connections() {
        for (const [neighbor, count] of byCandidate) yield { candidate_id: neighbor, supporting_placements: count };
      }
      const selected = selectTopK(connections(), topK);
      return { focus, placements, edges: selected, total: byCandidate.size };
    }
    const edges = [...byCandidate].map(([neighbor, support]) => ({ candidate_id: neighbor, placement_ids: support }));
    edges.sort((left, right) => right.placement_ids.length - left.placement_ids.length
      || (left.candidate_id < right.candidate_id ? -1 : left.candidate_id > right.candidate_id ? 1 : 0));
    return { focus, placements, edges, total: byCandidate.size };
  }

  function discover(store, params) {
    const limit = integer(params, 'limit', 60, LIMITS.page);
    const binding = digest([store.manifest.build_id, 'discover', limit]);
    const after = cursorPosition(params, binding, '');
    const rows = store.db.prepare('SELECT id,detail_json FROM artifact WHERE id>? ORDER BY id LIMIT ?')
      .all(after, limit + 1);
    return { ...store.manifest, operation: 'discover', capabilities: ['discover', 'search', 'regions', 'focus',
      'explain', 'compare', 'traverse', 'export'], limits: LIMITS, limitations: NOTES,
    artifacts: rows.slice(0, limit).map(row => ({ ...JSON.parse(row.detail_json), artifact_id: row.id })),
    next_cursor: rows.length > limit ? encodeCursor(binding, rows[limit - 1].id) : null,
    layers: [{ id: 'inventory', status: 'unreviewed_inventory_overlap', clock: 'inventory_year' },
      { id: 'reviewed_claims', status: 'separate_clock', href: '/atlas.html?layer=reviewed' }] };
  }

  function focus(store, params, selection, work) {
    const id = parameter(params, 'candidate');
    const limit = integer(params, 'limit', 60, LIMITS.page);
    const topK = params.has('top_k') ? integer(params, 'top_k', 60, LIMITS.page) : null;
    const binding = digest([store.manifest.build_id, QUERY_VERSION, 'focus', selection, id, limit, topK]);
    const offset = cursorPosition(params, binding, 0);
    const result = neighbors(store, id, selection, work, topK);
    const edges = result.edges.slice(offset, offset + limit).map(edge => ({ candidate_id: edge.candidate_id,
      supporting_placements: edge.supporting_placements ?? edge.placement_ids.length,
      candidate: candidate(store, edge.candidate_id), position: position(edge.candidate_id) }));
    return { operation: 'focus', focus: result.focus, position: position(id),
      focus_status: result.placements.length ? 'observed' : 'absent_from_selected_slice',
      count: { status: 'exact', value: result.total, grain: 'distinct_neighbor_candidates' },
      returned: edges.length, suppressed: result.total - edges.length, edges,
      explanation: { mode: 'explain', candidate: id, neighbor_parameter: 'neighbor',
        requires: 'same build_id and selection; exact placement IDs and retained rows are paged on demand' },
      ranking: { metric: 'distinct_supporting_placements', order: 'descending_support_then_candidate_id',
        top_k: topK, selected: result.edges.length, pruned: result.total - result.edges.length,
        meaning: 'co-listing support only; not economic strength, probability or independent corroboration' },
      next_cursor: offset + limit < result.edges.length ? encodeCursor(binding, offset + limit) : null,
      layout: { version: LAYOUT_VERSION, basis: 'stable_hash_address', meaning: 'display only; distance has no economic meaning' } };
  }

  function regions(store, params, selection, work) {
    const limit = integer(params, 'limit', 60, LIMITS.page);
    const binding = digest([store.manifest.build_id, 'regions', selection, limit]);
    const after = cursorPosition(params, binding, '');
    const rows = store.db.prepare(`SELECT p.*,a.source,a.inventory_year,a.raw_sha256
      FROM placement p JOIN artifact a ON a.id=p.artifact_id WHERE p.id>?
      ORDER BY p.id LIMIT ?`).all(after, LIMITS.placements + 1);
    work.add(rows.length);
    const selected = [];
    let last = after;
    for (const row of rows.slice(0, LIMITS.placements)) {
      last = row.id;
      if (matches(row, selection)) selected.push(row);
      if (selected.length === limit) break;
    }
    const more = rows.some(row => row.id > last);
    return { operation: 'regions', regions: selected, returned: selected.length,
      count: { status: 'unavailable', value: null, grain: 'matching_source_placements' },
      aggregation: 'each region is one exact source revision/category; candidates may occur in several regions',
      next_cursor: more ? encodeCursor(binding, last) : null };
  }

  function search(store, params, selection, work) {
    const limit = integer(params, 'limit', 60, LIMITS.page);
    const query = parameter(params, 'query');
    const placementId = parameter(params, 'placement');
    const binding = digest([store.manifest.build_id, 'search', selection, query, placementId, limit]);
    const after = cursorPosition(params, binding, '');
    const scanLimit = 2000;
    let rows;
    if (placementId) {
      const placement = store.db.prepare(`SELECT p.*,a.source,a.inventory_year
        FROM placement p JOIN artifact a ON a.id=p.artifact_id WHERE p.id=?`).get(placementId);
      if (!placement || !matches(placement, selection)) {
        throw new AtlasError(404, 'unknown_region', 'region is absent from the selected frame');
      }
      rows = store.db.prepare(`SELECT c.* FROM membership m JOIN candidate c ON c.id=m.candidate_id
        WHERE m.placement_id=? AND m.candidate_id>? ORDER BY m.candidate_id LIMIT ?`)
        .all(placementId, after, scanLimit + 1);
    } else if (query.trim()) {
      const tokens = query.match(/[\p{L}\p{N}_]+/gu) || [];
      if (!tokens.length || tokens.length > 12) throw new AtlasError(400, 'invalid_request', 'search needs 1 to 12 terms');
      const match = tokens.map(token => `"${token}"*`).join(' AND ');
      // Export inserts candidate and FTS rows in the same ID order. FTS can stop
      // at this rowid page boundary instead of materializing all matching IDs.
      rows = store.db.prepare(`SELECT c.* FROM candidate_search s JOIN candidate c ON c.id=s.id
        WHERE candidate_search MATCH ? AND s.rowid>coalesce((SELECT rowid FROM candidate WHERE id=?),0)
        ORDER BY s.rowid LIMIT ?`).all(match, after, scanLimit + 1);
    } else {
      rows = store.db.prepare('SELECT * FROM candidate WHERE id>? ORDER BY id LIMIT ?').all(after, scanLimit + 1);
    }
    const found = [];
    let last = after;
    for (const row of rows.slice(0, scanLimit)) {
      last = row.id;
      if (placementId || placementsFor(store, row.id, work).some(item => matches(item, selection))) {
        found.push({ ...descriptor(row), position: position(row.id) });
      }
      if (found.length === limit) break;
    }
    work.add(rows.length);
    return { operation: 'search', candidates: found, returned: found.length,
      count: { status: 'unavailable', value: null, grain: 'matching_candidates',
        reason: 'paged lookup does not scan the complete matching universe' },
      next_cursor: rows.some(row => row.id > last) ? encodeCursor(binding, last) : null };
  }

  function explain(store, params, selection, work) {
    const left = parameter(params, 'candidate');
    const right = parameter(params, 'neighbor');
    const subject = candidate(store, left);
    const object = candidate(store, right);
    const limit = integer(params, 'limit', 10, 25);
    const binding = digest([store.manifest.build_id, 'explain', selection, left, right, limit]);
    const offset = cursorPosition(params, binding, 0);
    const rightPlacements = new Set(placementsFor(store, right, work).map(item => item.id));
    const shared = placementsFor(store, left, work)
      .filter(item => matches(item, selection) && rightPlacements.has(item.id));
    const premises = shared.slice(offset, offset + limit).map(placement => ({ placement,
      artifact: JSON.parse(store.db.prepare('SELECT detail_json FROM artifact WHERE id=?').get(placement.artifact_id).detail_json),
      subject: JSON.parse(store.db.prepare('SELECT detail_json FROM membership WHERE candidate_id=? AND placement_id=?')
        .get(left, placement.id).detail_json),
      object: JSON.parse(store.db.prepare('SELECT detail_json FROM membership WHERE candidate_id=? AND placement_id=?')
        .get(right, placement.id).detail_json) }));
    return { operation: 'explain', subject, object, premises,
      count: { status: 'exact', value: shared.length, grain: 'shared_exact_placements' },
      returned: premises.length, status: shared.length ? 'unreviewed_inventory_overlap' : 'no_shared_placement',
      contradictions: { status: 'not_reviewed', records: [] },
      next_cursor: offset + limit < shared.length ? encodeCursor(binding, offset + limit) : null };
  }

  function compare(store, params, selection, work) {
    const compareYear = parameter(params, 'compare_year');
    if (!/^\d{4}$/.test(compareYear) || !selection.year || !selection.source) {
      throw new AtlasError(400, 'invalid_request', 'comparison requires a source and two inventory years');
    }
    const prior = { ...selection, year: compareYear,
      artifact: selection.temporal_mode === 'accumulated' ? '' : parameter(params, 'compare_artifact') };
    checkSelection(store, prior);
    const id = parameter(params, 'candidate');
    const current = neighbors(store, id, selection, work);
    const previous = neighbors(store, id, prior, work);
    const before = new Set(previous.edges.map(edge => edge.candidate_id));
    const after = new Set(current.edges.map(edge => edge.candidate_id));
    const changes = [...new Set([...before, ...after])].sort().map(candidateId => ({ candidate_id: candidateId,
      status: before.has(candidateId) && after.has(candidateId) ? 'observed_in_both'
        : after.has(candidateId) ? 'only_in_selected_slice' : 'only_in_comparison_slice' }));
    const limit = integer(params, 'limit', 60, LIMITS.page);
    const binding = digest([store.manifest.build_id, 'compare', selection, prior, id, limit]);
    const offset = cursorPosition(params, binding, 0);
    return { operation: 'compare', comparison_selection: prior,
      selected_frame_id: digest([store.manifest.build_id, QUERY_VERSION, selection, id]),
      comparison_frame_id: digest([store.manifest.build_id, QUERY_VERSION, prior, id]),
      changes: changes.slice(offset, offset + limit).map(change => ({ ...change,
        candidate: candidate(store, change.candidate_id) })),
      count: { status: 'exact', value: changes.length, grain: 'union_of_neighbor_candidates' },
      coverage: { selected_placements: current.placements.length, comparison_placements: previous.placements.length },
      next_cursor: offset + limit < changes.length ? encodeCursor(binding, offset + limit) : null,
      meaning: 'observation differences, not product changes, relationship formation or exits' };
  }

  function traverse(store, params, selection, work) {
    const start = parameter(params, 'candidate');
    const target = parameter(params, 'target');
    candidate(store, target);
    const maxHops = integer(params, 'hops', 2, 3);
    const queue = [{ id: start, path: [] }];
    const visited = new Set([start]);
    while (queue.length) {
      const current = queue.shift();
      if (current.id === target) return { operation: 'traverse', status: 'found', path: current.path,
        visited: visited.size, meaning: 'a path through premises does not establish a direct relationship' };
      if (current.path.length === maxHops) continue;
      const adjacent = neighbors(store, current.id, selection, work);
      for (const edge of adjacent.edges) {
        if (edge.candidate_id === target) return { operation: 'traverse', status: 'found',
          path: [...current.path, { subject: current.id, object: target,
            predicate: 'exact_inventory_colisting', placement_ids: edge.placement_ids }],
          visited: visited.size, meaning: 'a path through premises does not establish a direct relationship' };
        if (visited.has(edge.candidate_id)) continue;
        if (visited.size >= 100) return { operation: 'traverse', status: 'node_budget_reached',
          path: null, visited: visited.size, exhaustive: false };
        visited.add(edge.candidate_id);
        queue.push({ id: edge.candidate_id, path: [...current.path, { subject: current.id,
          object: edge.candidate_id, predicate: 'exact_inventory_colisting', placement_ids: edge.placement_ids }] });
      }
    }
    return { operation: 'traverse', status: 'not_found_within_hop_limit', path: null,
      visited: visited.size, hops: maxHops, exhaustive: false };
  }

  function handle(searchParams) {
    try {
      const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
      if (parameter(params, 'layer', 'inventory') !== 'inventory'
          || parameter(params, 'predicate', 'exact_inventory_colisting') !== 'exact_inventory_colisting'
          || parameter(params, 'direction', 'both') !== 'both') {
        throw new AtlasError(400, 'unsupported_layer', 'inventory co-listing reads cannot stand in for typed reviewed claims');
      }
      const operation = parameter(params, 'mode', 'discover');
      if (!['discover', 'search', 'regions', 'focus', 'explain', 'compare', 'traverse', 'export'].includes(operation)) {
        throw new AtlasError(400, 'invalid_request', 'unsupported atlas operation');
      }
      const requestedBuild = parameter(params, 'build_id');
      if (operation !== 'discover' && !requestedBuild) {
        throw new AtlasError(409, 'build_required', 'discover a version before reading it');
      }
      const store = open(requestedBuild);
      const selection = selectors(params);
      checkSelection(store, selection);
      const work = budget();
      const operations = { discover, search, regions, focus, explain, compare, traverse };
      const result = operation === 'export'
        ? { operation: 'export', status: 'selected_page_export',
          neighborhood: focus(store, params, selection, work),
          evidence: parameter(params, 'neighbor') ? explain(store, explanationParameters(params), selection, work) : null,
          scope: 'one selected page; continuation cursors identify omitted pages' }
        : operations[operation](store, params, selection, work);
      const body = { schema_version: '1.0', build_id: store.manifest.build_id,
        versions: store.manifest.versions, selection,
        frame_id: digest([store.manifest.build_id, QUERY_VERSION, selection, parameter(params, 'candidate')]),
        receipt_id: digest([store.manifest.build_id, [...params].sort()]),
        limitations: NOTES, ...result, work: work.receipt() };
      if (Buffer.byteLength(JSON.stringify(body)) > LIMITS.response_bytes) {
        throw new AtlasError(413, 'response_too_large', 'request a smaller page; evidence was not silently truncated');
      }
      return { status: 200, body };
    } catch (error) {
      return error instanceof AtlasError ? { status: error.status, body: { error: error.code, message: error.message } }
        : { status: 503, body: { error: 'atlas_unavailable', message: 'snapshot could not be read; retry or use retained evidence' } };
    }
  }

  handle.close = () => { for (const store of stores.values()) store.db.close(); stores.clear(); };
  return handle;
}

const handleAtlas = createAtlasHandler();
async function vercelHandler(request, reply) {
  if (request.method !== 'GET') {
    reply.setHeader('Allow', 'GET');
    return reply.status(405).json({ error: 'method_not_allowed' });
  }
  const params = new URL(request.url, 'http://localhost').searchParams;
  const result = await require('./atlas-runtime.js').readAtlas(params);
  reply.setHeader('Cache-Control', result.status === 200 && params.get('build_id')
    ? 'public, max-age=0, s-maxage=3600' : 'no-store');
  return reply.status(result.status).json(result.body);
}

module.exports = vercelHandler;
module.exports.handleAtlas = handleAtlas;
module.exports.createAtlasHandler = createAtlasHandler;
module.exports.LIMITS = LIMITS;
module.exports.selectTopK = selectTopK;
module.exports.protocol = { AtlasError, digest, parameter, integer, selectors, matches,
  encodeCursor, cursorPosition, descriptor, position, explanationParameters, QUERY_VERSION, LAYOUT_VERSION, NOTES };
