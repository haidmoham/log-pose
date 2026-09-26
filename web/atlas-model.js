(function (root) {
  'use strict';
  function displayPosition(position) {
    return { x: 90 + position.x * 820, y: 80 + position.y * 520 };
  }
  function graphFrame(result) {
    const focused = result.operation === 'focus';
    const candidates = focused ? result.edges.map(edge => ({ ...edge.candidate, position: edge.position }))
      : result.candidates;
    const nodes = candidates.map(candidate => ({ ...candidate, position: displayPosition(candidate.position) }));
    if (focused) nodes.push({ ...result.focus, position: displayPosition(result.position) });
    return { build_id: result.versions.layout, source: result.selection.source, year: result.selection.year,
      temporal_mode: result.selection.temporal_mode, nodes, focus: focused ? result.focus.id : '',
      focus_present: result.focus_status === 'observed', edges: focused ? result.edges : [], context_edges: [] };
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
  root.LogPoseAtlasModel = { graphFrame, createCache };
})(globalThis);
