(function (root) {
  'use strict';
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
  function graphFrame(result) {
    const focused = result.operation === 'focus';
    const edges = focused ? result.edges.map(edge => ({ ...edge, support_tier: placementTier(edge.supporting_placements).key })) : [];
    const candidates = focused ? edges.map(edge => ({ ...edge.candidate, position: edge.position,
      connection_label: `${Number.isSafeInteger(edge.supporting_placements) && edge.supporting_placements > 0
        ? `${edge.supporting_placements} shared ${edge.supporting_placements === 1 ? 'placement' : 'placements'}`
        : 'placement count unavailable'} · co-listing only` }))
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
  root.LogPoseAtlasModel = { graphFrame, reviewedGraphFrame, createCache, placementTier, companyRoute };
})(globalThis);
