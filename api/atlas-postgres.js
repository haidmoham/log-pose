// Postgres is an immutable gold serving derivative, never the evidence write store.
'use strict';

const { LIMITS, protocol } = require('./atlas.js');
const { AtlasError, digest, parameter, integer, selectors, encodeCursor, cursorPosition,
  descriptor, position, explanationParameters, QUERY_VERSION, LAYOUT_VERSION, NOTES } = protocol;

const OPERATIONS = ['discover', 'search', 'regions', 'focus', 'explain', 'compare', 'traverse', 'export'];

function candidateDescriptor(row) {
  if (!row) return descriptor(row);
  return descriptor({ ...row, summary_json: JSON.stringify(row.summary_json) });
}

function selectionSql(selection, alias, values) {
  const clauses = [];
  if (selection.source) { values.push(selection.source); clauses.push(`${alias}.source=$${values.length}`); }
  if (selection.year) {
    values.push(Number(selection.year));
    clauses.push(`${alias}.inventory_year${selection.temporal_mode === 'accumulated' ? '<=' : '='}$${values.length}`);
  }
  if (selection.category) { values.push(selection.category); clauses.push(`p.category=$${values.length}`); }
  if (selection.artifact) { values.push(selection.artifact); clauses.push(`p.artifact_id=$${values.length}`); }
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
}

function createPostgresHandler(pool) {
  if (!pool?.connect) throw new TypeError('a Postgres pool is required');

  async function handle(searchParams) {
    let client;
    let transaction = false;
    let discardClient = false;
    const started = performance.now();
    let membershipRows = 0;
    function checkBudget(add = 0) {
      membershipRows += add;
      if (membershipRows > LIMITS.memberships || performance.now() - started > LIMITS.milliseconds) {
        throw new AtlasError(422, 'query_budget_exceeded', 'narrow the source revision or category');
      }
    }
    async function query(text, values = []) {
      const result = await client.query({ text, values });
      checkBudget();
      return result;
    }

    try {
      const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
      if (parameter(params, 'layer', 'inventory') !== 'inventory'
          || parameter(params, 'predicate', 'exact_inventory_colisting') !== 'exact_inventory_colisting'
          || parameter(params, 'direction', 'both') !== 'both') {
        throw new AtlasError(400, 'unsupported_layer', 'inventory co-listing reads cannot stand in for typed reviewed claims');
      }
      const operation = parameter(params, 'mode', 'discover');
      if (!OPERATIONS.includes(operation)) throw new AtlasError(400, 'invalid_request', 'unsupported atlas operation');
      const requestedBuild = parameter(params, 'build_id');
      if (operation !== 'discover' && !requestedBuild) {
        throw new AtlasError(409, 'build_required', 'discover a version before reading it');
      }
      if (requestedBuild && !/^[a-f0-9]{64}$/.test(requestedBuild)) {
        throw new AtlasError(410, 'build_unavailable', 'this build is not hosted; restore its immutable snapshot');
      }

      client = await pool.connect();
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transaction = true;
      await client.query("SELECT set_config('statement_timeout',$1,true)", [`${LIMITS.milliseconds}ms`]);
      const snapshot = requestedBuild
        ? await query('SELECT manifest FROM gold.atlas_snapshot WHERE build_id=$1', [requestedBuild])
        : await query(`SELECT snapshot.manifest FROM gold.atlas_current current_snapshot
            JOIN gold.atlas_snapshot snapshot ON snapshot.build_id=current_snapshot.build_id
            WHERE current_snapshot.singleton`);
      if (!snapshot.rows.length) {
        throw new AtlasError(requestedBuild ? 410 : 503, 'build_unavailable',
          'the requested snapshot is unavailable');
      }
      const manifest = snapshot.rows[0].manifest;
      if (manifest.build_id !== (requestedBuild || manifest.build_id)
          || manifest.versions?.query !== QUERY_VERSION) {
        throw new AtlasError(503, 'snapshot_mismatch', 'snapshot versions differ');
      }
      const buildId = manifest.build_id;
      const selection = selectors(params);

      async function candidate(id) {
        const result = await query(`SELECT id,name,summary_json FROM gold.atlas_candidate
          WHERE build_id=$1 AND id=$2`, [buildId, id]);
        return candidateDescriptor(result.rows[0]);
      }

      async function checkSelection(selected) {
        if (selected.artifact) {
          const artifact = await query(`SELECT source,inventory_year FROM gold.atlas_artifact
            WHERE build_id=$1 AND id=$2`, [buildId, selected.artifact]);
          const row = artifact.rows[0];
          if (!row || (selected.source && row.source !== selected.source)
              || (selected.year && row.inventory_year !== Number(selected.year))) {
            throw new AtlasError(404, 'missing_snapshot', 'artifact and source/year selectors do not match');
          }
        }
        if (selected.year) {
          if (!selected.source) throw new AtlasError(400, 'invalid_request', 'a year needs a source');
          const revisions = await query(`SELECT id FROM gold.atlas_artifact
            WHERE build_id=$1 AND source=$2 AND inventory_year=$3 ORDER BY id LIMIT 2`,
          [buildId, selected.source, Number(selected.year)]);
          if (!revisions.rows.length) throw new AtlasError(404, 'missing_snapshot', 'no retained artifact at this stop');
          if (revisions.rows.length > 1 && !selected.artifact && selected.temporal_mode === 'snapshot') {
            throw new AtlasError(409, 'ambiguous_revision', 'select the exact artifact revision');
          }
        }
      }
      await checkSelection(selection);

      async function neighborhood(id, selected, { limit = null, offset = 0, topK = null,
        includePlacementIds = false } = {}) {
        const focusCandidate = await candidate(id);
        const scopeValues = [buildId, id];
        const scope = selectionSql(selected, 'a', scopeValues);
        const coverage = await query(`SELECT count(*)::int AS placements,
            coalesce(sum(p.member_count),0)::int AS membership_rows
          FROM gold.atlas_membership focus_membership
          JOIN gold.atlas_placement p ON p.build_id=focus_membership.build_id
            AND p.id=focus_membership.placement_id
          JOIN gold.atlas_artifact a ON a.build_id=p.build_id AND a.id=p.artifact_id
          WHERE focus_membership.build_id=$1 AND focus_membership.candidate_id=$2${scope}`, scopeValues);
        const placementCount = coverage.rows[0].placements;
        const scanned = coverage.rows[0].membership_rows;
        if (placementCount > LIMITS.placements) {
          throw new AtlasError(422, 'query_budget_exceeded', 'candidate history exceeds the interactive placement budget');
        }
        // Count and ranked-page queries each visit this incidence set. This is
        // a conservative row estimate, not PostgreSQL EXPLAIN execution data.
        checkBudget(2 * scanned + placementCount);
        const neighborValues = [buildId, id];
        const neighborScope = selectionSql(selected, 'a', neighborValues);
        const countValues = [...neighborValues, LIMITS.candidates + 1];
        const neighborCount = await query(`SELECT count(*)::int AS count FROM (
          SELECT member.candidate_id
          FROM gold.atlas_membership focus_membership
          JOIN gold.atlas_placement p ON p.build_id=focus_membership.build_id
            AND p.id=focus_membership.placement_id
          JOIN gold.atlas_artifact a ON a.build_id=p.build_id AND a.id=p.artifact_id
          JOIN gold.atlas_membership member ON member.build_id=p.build_id
            AND member.placement_id=p.id AND member.candidate_id<>focus_membership.candidate_id
          WHERE focus_membership.build_id=$1 AND focus_membership.candidate_id=$2${neighborScope}
          GROUP BY member.candidate_id
          LIMIT $${countValues.length}) bounded_neighbors`, countValues);
        const total = neighborCount.rows[0].count;
        if (total > LIMITS.candidates) {
          throw new AtlasError(422, 'query_budget_exceeded', 'distinct neighbors exceed the interactive budget');
        }
        const selectedCount = topK === null ? total : Math.min(topK, total);
        const pageLimit = limit === null ? selectedCount : Math.max(0, Math.min(limit, selectedCount - offset));
        let page = [];
        if (pageLimit) {
          const rankedValues = [...neighborValues, pageLimit, offset];
          page = (await query(`SELECT member.candidate_id,
              count(*)::int AS supporting_placements,
              ${includePlacementIds ? 'array_agg(p.id ORDER BY p.id)' : 'NULL::text[]'} AS placement_ids
            FROM gold.atlas_membership focus_membership
            JOIN gold.atlas_placement p ON p.build_id=focus_membership.build_id
              AND p.id=focus_membership.placement_id
            JOIN gold.atlas_artifact a ON a.build_id=p.build_id AND a.id=p.artifact_id
            JOIN gold.atlas_membership member ON member.build_id=p.build_id
              AND member.placement_id=p.id AND member.candidate_id<>focus_membership.candidate_id
            WHERE focus_membership.build_id=$1 AND focus_membership.candidate_id=$2${neighborScope}
            GROUP BY member.candidate_id
            ORDER BY count(*) DESC,member.candidate_id COLLATE "C"
            LIMIT $${rankedValues.length - 1} OFFSET $${rankedValues.length}`, rankedValues)).rows;
        }
        return { focus: focusCandidate, placements: placementCount, scanned,
          total, selected: selectedCount, rows: page,
          hasMore: limit !== null && offset + limit < selectedCount };
      }

      async function discover() {
        const limit = integer(params, 'limit', 60, LIMITS.page);
        const binding = digest([buildId, 'discover', limit]);
        const after = cursorPosition(params, binding, '');
        const rows = await query(`SELECT id,detail_json FROM gold.atlas_artifact
          WHERE build_id=$1 AND id>$2 ORDER BY id COLLATE "C" LIMIT $3`, [buildId, after, limit + 1]);
        return { ...manifest, operation: 'discover', capabilities: OPERATIONS, limits: LIMITS,
          limitations: NOTES, artifacts: rows.rows.slice(0, limit).map(row => ({ ...row.detail_json, artifact_id: row.id })),
          next_cursor: rows.rows.length > limit ? encodeCursor(binding, rows.rows[limit - 1].id) : null,
          layers: [{ id: 'inventory', status: 'unreviewed_inventory_overlap', clock: 'inventory_year' },
            { id: 'reviewed_claims', status: 'separate_clock', href: '/?view=topology&topologyLayer=reviewed' }] };
      }

      async function regions() {
        const limit = integer(params, 'limit', 60, LIMITS.page);
        const binding = digest([buildId, 'regions', selection, limit]);
        const after = cursorPosition(params, binding, '');
        const values = [buildId, after];
        const scope = selectionSql(selection, 'a', values);
        values.push(limit + 1);
        const result = await query(`SELECT p.*,a.source,a.inventory_year,a.raw_sha256
          FROM gold.atlas_placement p JOIN gold.atlas_artifact a
            ON a.build_id=p.build_id AND a.id=p.artifact_id
          WHERE p.build_id=$1 AND p.id>$2${scope}
          ORDER BY p.id COLLATE "C" LIMIT $${values.length}`, values);
        const rows = result.rows.slice(0, limit);
        return { operation: 'regions', regions: rows, returned: rows.length,
          count: { status: 'unavailable', value: null, grain: 'matching_source_placements' },
          aggregation: 'each region is one exact source revision/category; candidates may occur in several regions',
          next_cursor: result.rows.length > limit ? encodeCursor(binding, rows.at(-1).id) : null };
      }

      async function search() {
        const limit = integer(params, 'limit', 60, LIMITS.page);
        const searchText = parameter(params, 'query');
        const placementId = parameter(params, 'placement');
        const binding = digest([buildId, 'search', selection, searchText, placementId, limit]);
        const after = cursorPosition(params, binding, '');
        const values = [buildId, after];
        let joins = '';
        let where = '';
        if (placementId) {
          values.push(placementId);
          const placement = await query(`SELECT p.*,a.source,a.inventory_year FROM gold.atlas_placement p
            JOIN gold.atlas_artifact a ON a.build_id=p.build_id AND a.id=p.artifact_id
            WHERE p.build_id=$1 AND p.id=$2`, [buildId, placementId]);
          if (!placement.rows.length) throw new AtlasError(404, 'unknown_region', 'region is absent from the selected frame');
          const checkValues = [buildId, placementId];
          const checkScope = selectionSql(selection, 'a', checkValues);
          const valid = await query(`SELECT 1 FROM gold.atlas_placement p JOIN gold.atlas_artifact a
            ON a.build_id=p.build_id AND a.id=p.artifact_id
            WHERE p.build_id=$1 AND p.id=$2${checkScope}`, checkValues);
          if (!valid.rows.length) throw new AtlasError(404, 'unknown_region', 'region is absent from the selected frame');
          joins = `JOIN gold.atlas_membership selected_membership ON selected_membership.build_id=c.build_id
            AND selected_membership.candidate_id=c.id`;
          where += ` AND selected_membership.placement_id=$${values.length}`;
        } else if (searchText.trim()) {
          const tokens = searchText.match(/[\p{L}\p{N}_]+/gu) || [];
          if (!tokens.length || tokens.length > 12) throw new AtlasError(400, 'invalid_request', 'search needs 1 to 12 terms');
          values.push(tokens.map(token => `${token.replaceAll("'", "''")}:*`).join(' & '));
          where += ` AND c.search_text @@ to_tsquery('simple',$${values.length})`;
        }
        if (!placementId && (selection.source || selection.year || selection.category || selection.artifact)) {
          const scope = selectionSql(selection, 'search_artifact', values);
          where += ` AND EXISTS (SELECT 1 FROM gold.atlas_membership search_membership
            JOIN gold.atlas_placement p ON p.build_id=search_membership.build_id AND p.id=search_membership.placement_id
            JOIN gold.atlas_artifact search_artifact ON search_artifact.build_id=p.build_id AND search_artifact.id=p.artifact_id
            WHERE search_membership.build_id=c.build_id AND search_membership.candidate_id=c.id${scope})`;
        }
        values.push(limit + 1);
        const result = await query(`SELECT c.id,c.name,c.summary_json FROM gold.atlas_candidate c ${joins}
          WHERE c.build_id=$1 AND c.id>$2${where} ORDER BY c.id COLLATE "C" LIMIT $${values.length}`, values);
        const rows = result.rows.slice(0, limit);
        return { operation: 'search', candidates: rows.map(row => ({ ...candidateDescriptor(row), position: position(row.id) })),
          returned: rows.length, count: { status: 'unavailable', value: null, grain: 'matching_candidates',
            reason: 'paged lookup does not scan the complete matching universe' },
          next_cursor: result.rows.length > limit ? encodeCursor(binding, rows.at(-1).id) : null };
      }

      async function focus() {
        const id = parameter(params, 'candidate');
        const limit = integer(params, 'limit', 60, LIMITS.page);
        const topK = params.has('top_k') ? integer(params, 'top_k', 60, LIMITS.page) : null;
        const binding = digest([buildId, QUERY_VERSION, 'focus', selection, id, limit, topK]);
        const offset = cursorPosition(params, binding, 0);
        const result = await neighborhood(id, selection, { limit, offset, topK });
        if (offset > result.selected) throw new AtlasError(409, 'cursor_mismatch', 'the cursor position exceeds this result');
        const ids = result.rows.map(row => row.candidate_id);
        let summaries = [];
        if (ids.length) {
          summaries = (await query(`SELECT id,name,summary_json FROM gold.atlas_candidate
            WHERE build_id=$1 AND id=ANY($2::text[])`, [buildId, ids])).rows;
        }
        const byId = new Map(summaries.map(row => [row.id, candidateDescriptor(row)]));
        const edges = result.rows.map(row => ({ candidate_id: row.candidate_id,
          supporting_placements: row.supporting_placements, candidate: byId.get(row.candidate_id),
          position: position(row.candidate_id) }));
        return { operation: 'focus', focus: result.focus, position: position(id),
          focus_status: result.placements ? 'observed' : 'absent_from_selected_slice',
          count: { status: 'exact', value: result.total, grain: 'distinct_neighbor_candidates' },
          returned: edges.length, suppressed: result.total - edges.length, edges,
          explanation: { mode: 'explain', candidate: id, neighbor_parameter: 'neighbor',
            requires: 'same build_id and selection; exact placement IDs and retained rows are paged on demand' },
          ranking: { metric: 'distinct_supporting_placements', order: 'descending_support_then_candidate_id',
            top_k: topK, selected: result.selected, pruned: result.total - result.selected,
            meaning: 'co-listing support only; not economic strength, probability or independent corroboration' },
          next_cursor: result.hasMore ? encodeCursor(binding, offset + limit) : null,
          layout: { version: LAYOUT_VERSION, basis: 'stable_hash_address', meaning: 'display only; distance has no economic meaning' } };
      }

      async function explain(evidenceParams = params) {
        const left = parameter(params, 'candidate');
        const right = parameter(params, 'neighbor');
        const subject = await candidate(left);
        const object = await candidate(right);
        const limit = integer(evidenceParams, 'limit', 10, 25);
        const binding = digest([buildId, 'explain', selection, left, right, limit]);
        const offset = cursorPosition(evidenceParams, binding, 0);
        const values = [buildId, left, right];
        const scope = selectionSql(selection, 'a', values);
        const countResult = await query(`SELECT count(*)::int AS count,
            coalesce(sum(p.member_count),0)::int AS membership_rows
          FROM gold.atlas_membership subject_membership
          JOIN gold.atlas_membership object_membership ON object_membership.build_id=subject_membership.build_id
            AND object_membership.placement_id=subject_membership.placement_id
          JOIN gold.atlas_placement p ON p.build_id=subject_membership.build_id AND p.id=subject_membership.placement_id
          JOIN gold.atlas_artifact a ON a.build_id=p.build_id AND a.id=p.artifact_id
          WHERE subject_membership.build_id=$1 AND subject_membership.candidate_id=$2
            AND object_membership.candidate_id=$3${scope}`, values);
        const total = countResult.rows[0].count;
        if (total > LIMITS.placements) throw new AtlasError(422, 'query_budget_exceeded', 'shared history exceeds the interactive placement budget');
        checkBudget(4 * total);
        values.push(limit, offset);
        const result = await query(`SELECT p.*,a.source,a.inventory_year,a.raw_sha256,
            a.detail_json AS artifact,subject_membership.detail_json AS subject,
            object_membership.detail_json AS object
          FROM gold.atlas_membership subject_membership
          JOIN gold.atlas_membership object_membership ON object_membership.build_id=subject_membership.build_id
            AND object_membership.placement_id=subject_membership.placement_id
          JOIN gold.atlas_placement p ON p.build_id=subject_membership.build_id AND p.id=subject_membership.placement_id
          JOIN gold.atlas_artifact a ON a.build_id=p.build_id AND a.id=p.artifact_id
          WHERE subject_membership.build_id=$1 AND subject_membership.candidate_id=$2
            AND object_membership.candidate_id=$3${scope}
          ORDER BY p.id COLLATE "C" LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
        const premises = result.rows.map(row => ({ placement: { id: row.id, artifact_id: row.artifact_id,
          category: row.category, member_count: row.member_count, source: row.source,
          inventory_year: row.inventory_year, raw_sha256: row.raw_sha256 },
        artifact: row.artifact, subject: row.subject, object: row.object }));
        return { operation: 'explain', subject, object, premises,
          count: { status: 'exact', value: total, grain: 'shared_exact_placements' },
          returned: premises.length, status: total ? 'unreviewed_inventory_overlap' : 'no_shared_placement',
          contradictions: { status: 'not_reviewed', records: [] },
          next_cursor: offset + limit < total ? encodeCursor(binding, offset + limit) : null };
      }

      async function compare() {
        const compareYear = parameter(params, 'compare_year');
        if (!/^\d{4}$/.test(compareYear) || !selection.year || !selection.source) {
          throw new AtlasError(400, 'invalid_request', 'comparison requires a source and two inventory years');
        }
        const prior = { ...selection, year: compareYear,
          artifact: selection.temporal_mode === 'accumulated' ? '' : parameter(params, 'compare_artifact') };
        await checkSelection(prior);
        const id = parameter(params, 'candidate');
        const current = await neighborhood(id, selection);
        const previous = await neighborhood(id, prior);
        const before = new Set(previous.rows.map(row => row.candidate_id));
        const after = new Set(current.rows.map(row => row.candidate_id));
        const changes = [...new Set([...before, ...after])].sort().map(candidateId => ({ candidate_id: candidateId,
          status: before.has(candidateId) && after.has(candidateId) ? 'observed_in_both'
            : after.has(candidateId) ? 'only_in_selected_slice' : 'only_in_comparison_slice' }));
        const limit = integer(params, 'limit', 60, LIMITS.page);
        const binding = digest([buildId, 'compare', selection, prior, id, limit]);
        const offset = cursorPosition(params, binding, 0);
        const page = changes.slice(offset, offset + limit);
        const ids = page.map(change => change.candidate_id);
        const summaries = ids.length ? (await query(`SELECT id,name,summary_json FROM gold.atlas_candidate
          WHERE build_id=$1 AND id=ANY($2::text[])`, [buildId, ids])).rows : [];
        const byId = new Map(summaries.map(row => [row.id, candidateDescriptor(row)]));
        return { operation: 'compare', comparison_selection: prior,
          selected_frame_id: digest([buildId, QUERY_VERSION, selection, id]),
          comparison_frame_id: digest([buildId, QUERY_VERSION, prior, id]),
          changes: page.map(change => ({ ...change, candidate: byId.get(change.candidate_id) })),
          count: { status: 'exact', value: changes.length, grain: 'union_of_neighbor_candidates' },
          coverage: { selected_placements: current.placements, comparison_placements: previous.placements },
          next_cursor: offset + limit < changes.length ? encodeCursor(binding, offset + limit) : null,
          meaning: 'observation differences, not product changes, relationship formation or exits' };
      }

      async function traverse() {
        const start = parameter(params, 'candidate');
        const target = parameter(params, 'target');
        await candidate(target);
        const maxHops = integer(params, 'hops', 2, 3);
        const queue = [{ id: start, path: [] }];
        const visited = new Set([start]);
        while (queue.length) {
          const current = queue.shift();
          if (current.id === target) return { operation: 'traverse', status: 'found', path: current.path,
            visited: visited.size, meaning: 'a path through premises does not establish a direct relationship' };
          if (current.path.length === maxHops) continue;
          const adjacent = await neighborhood(current.id, selection,
            { limit: 101, offset: 0, includePlacementIds: true });
          for (const edge of adjacent.rows) {
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

      const operations = { discover, search, regions, focus, explain, compare, traverse };
      const result = operation === 'export'
        ? { operation: 'export', status: 'selected_page_export', neighborhood: await focus(),
          evidence: parameter(params, 'neighbor') ? await explain(explanationParameters(params)) : null,
          scope: 'one selected page; continuation cursors identify omitted pages' }
        : await operations[operation]();
      const body = { schema_version: '1.0', build_id: buildId, versions: manifest.versions, selection,
        frame_id: digest([buildId, QUERY_VERSION, selection, parameter(params, 'candidate')]),
        receipt_id: digest([buildId, [...params].sort()]), limitations: NOTES, ...result,
        work: { membership_rows_estimate: membershipRows, elapsed_ms: performance.now() - started } };
      if (Buffer.byteLength(JSON.stringify(body)) > LIMITS.response_bytes) {
        throw new AtlasError(413, 'response_too_large', 'request a smaller page; evidence was not silently truncated');
      }
      checkBudget();
      await client.query('COMMIT');
      transaction = false;
      return { status: 200, body };
    } catch (error) {
      if (transaction && client) {
        try { await client.query('ROLLBACK'); } catch { discardClient = true; }
        transaction = false;
      }
      if (error instanceof AtlasError) return { status: error.status, body: { error: error.code, message: error.message } };
      if (error?.code === '57014') return { status: 422, body: { error: 'query_budget_exceeded', message: 'narrow the source revision or category' } };
      return { status: 503, body: { error: 'atlas_unavailable', message: 'snapshot could not be read; retry or use retained evidence' } };
    } finally {
      if (transaction && client) {
        try { await client.query('ROLLBACK'); } catch { discardClient = true; }
      }
      // A failed rollback must not return an open transaction to the shared pool.
      client?.release(discardClient);
    }
  }

  handle.close = async () => pool.end();
  return handle;
}

module.exports = { createPostgresHandler };
