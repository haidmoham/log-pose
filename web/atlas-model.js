(function (root) {
  'use strict';
  function routeParams(fields, artifacts = []) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
    }
    params.delete('limit');
    if (params.get('mode') === 'focus' && params.has('candidate')) params.delete('mode');
    if (params.get('source') === 'cncf') params.delete('source');
    if (params.get('temporal_mode') === 'snapshot') params.delete('temporal_mode');
    if (params.get('top_k') === '24') params.delete('top_k');
    const source = fields.source || 'cncf';
    // Full build identity remains in every saved route. An artifact is redundant
    // only when that pinned build has one exact revision at the selected stop.
    for (const [artifactKey, yearKey] of [['artifact', 'year'], ['compare_artifact', 'compare_year']]) {
      const matches = artifacts.filter(item => item.source === source
        && String(item.inventory_year) === String(fields[yearKey]));
      if (/^[a-f0-9]{64}$/.test(params.get('build_id') || '') && matches.length === 1
          && matches[0].artifact_id === params.get(artifactKey)) params.delete(artifactKey);
    }
    return params;
  }
  function displayPosition(position) {
    return { x: 90 + position.x * 820, y: 80 + position.y * 520 };
  }
  function placementTier(count) {
    if (!Number.isSafeInteger(count) || count < 1) return { key: 'unknown', label: 'placement count unavailable' };
    if (count === 1) return { key: 'one', label: '1 shared placement' };
    if (count <= 3) return { key: 'few', label: '2–3 shared placements' };
    return { key: 'many', label: '4+ shared placements' };
  }
  function companyRoute(candidate, year) {
    const slug = candidate.identity_review?.pilot_slug;
    if (!slug) return null;
    return `./index.html?${new URLSearchParams({ view: 'explore', company: slug,
      q: candidate.name, year: String(year) })}#company-detail`;
  }
  function connectionDescription(result, edge, evidence) {
    const count = edge.supporting_placements;
    const support = Number.isSafeInteger(count) && count > 0
      ? `${count} shared ${count === 1 ? 'placement' : 'placements'}` : 'placement count unavailable';
    const source = result.selection.source.toUpperCase();
    const time = result.selection.temporal_mode === 'accumulated'
      ? `inventories through ${result.selection.year}` : `inventory ${result.selection.year}`;
    const categories = [...new Set((evidence?.premises || []).map(premise =>
      `“${premise.placement.category}” (${premise.placement.source.toUpperCase()} ${premise.placement.inventory_year})`))];
    const relationship = categories.length
      ? `co-listed in ${categories.join('; ')}${evidence.next_cursor ? '; more source placements are available on selection' : ''}`
      : `co-listed in the same source categories in ${source} ${time}`;
    return `${result.focus.name} and ${edge.candidate.name} are ${relationship}. Evidence: ${support} in ${source} ${time}. `
      + 'This is unreviewed co-listing evidence; it does not establish competition, partnership or adoption.';
  }
  function graphFrame(result) {
    const focused = result.operation === 'focus';
    const edges = focused ? result.edges.map(edge => ({ ...edge, support_tier: placementTier(edge.supporting_placements).key,
      connection_label: connectionDescription(result, edge) })) : [];
    const candidates = focused ? edges.map(edge => ({ ...edge.candidate, position: edge.position,
      connection_label: edge.connection_label }))
      : result.candidates;
    const nodes = candidates.map(candidate => ({ ...candidate, position: displayPosition(candidate.position) }));
    if (focused) nodes.push({ ...result.focus, position: displayPosition(result.position) });
    return { build_id: result.versions.layout, source: result.selection.source, year: result.selection.year,
      temporal_mode: result.selection.temporal_mode, nodes, focus: focused ? result.focus.id : '',
      focus_present: result.focus_status === 'observed', edges, context_edges: [],
      semantics: { legend: [['support-one', '1 placement'], ['support-few', '2–3 placements'],
        ['support-many', '4+ placements'], ['hollow', 'not observed in selected slice']],
      edgeNote: 'line patterns group exact shared source/category/revision placements: 1, 2–3, or 4+. these are co-listings, not economic strength, confidence or independent corroboration.' } };
  }
  function reviewedGraphFrame(result) {
    const focused = result.operation === 'focus';
    const entities = focused ? result.edges.map(edge => ({ ...edge.neighbor, position: edge.position,
      connection_label: `${edge.claim_count} reviewed ${edge.claim_count === 1 ? 'claim' : 'claims'}` })) : result.entities;
    const nodes = entities.map(entity => ({ ...entity, position: displayPosition(entity.position),
      identity_label: entity.target_kind === 'reviewed_external_entity'
        ? 'reviewed entity; no reviewed inventory mapping' : 'reviewed entity with an explicit inventory identity link' }));
    if (focused) nodes.push({ ...result.focus, position: displayPosition(result.focus.position),
      identity_label: 'reviewed entity; source publication is not relationship validity' });
    return { build_id: result.versions.layout, source: 'reviewed', nodes,
      focus: focused ? result.focus.id : '', focus_present: true,
      edges: focused ? result.edges.map(edge => ({ ...edge, candidate_id: edge.neighbor_id })) : [],
      context_edges: [], semantics: {
        sceneLabel: 'reviewed claim constellation',
        eyebrow: `reviewed claims / ${result.selection.cutoff ? `sources through ${result.selection.cutoff}` : 'all retained source dates'}`,
        overviewTitle: 'reviewed entities', focusCountLabel: 'visible neighbors',
        overviewCountLabel: 'reviewed entities', focusKind: 'reviewed entity',
        neighborKind: 'reviewed claims',
        legend: [['solid', 'eligible claims']]
      } };
  }
  function createCache(maxBytes = 3 * 1024 * 1024) {
    const entries = new Map();
    let bytes = 0;
    return {
      get(key) {
        const entry = entries.get(key);
        if (!entry) return null;
        entries.delete(key); entries.set(key, entry);
        return entry.value;
      },
      put(key, value) {
        const size = new TextEncoder().encode(JSON.stringify(value)).length;
        if (entries.has(key)) { bytes -= entries.get(key).bytes; entries.delete(key); }
        if (size > maxBytes) return;
        entries.set(key, { value, bytes: size }); bytes += size;
        while (bytes > maxBytes) {
          const oldest = entries.keys().next().value;
          bytes -= entries.get(oldest).bytes; entries.delete(oldest);
        }
      },
      clear() { entries.clear(); bytes = 0; },
      usage() { return { bytes, entries: entries.size, max_bytes: maxBytes }; }
    };
  }
  root.LogPoseAtlasModel = { graphFrame, reviewedGraphFrame, createCache, placementTier, companyRoute, connectionDescription, routeParams };
})(globalThis);
