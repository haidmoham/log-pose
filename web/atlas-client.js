(function (root) {
  'use strict';

  function create({ cache, fallbackMessage, buildMismatchMessage, fetchImpl = root.fetch }) {
    async function request(fields, signal) {
      const query = new URLSearchParams(fields).toString();
      const cached = cache.get(query);
      if (cached) return cached;
      const response = await fetchImpl(`./api/atlas?${query}`, {
        signal,
        headers: { accept: 'application/json' }
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.error || fallbackMessage(response.status));
      }
      if (fields.build_id && result.build_id !== fields.build_id) {
        throw new Error(buildMismatchMessage);
      }
      cache.put(query, result);
      return result;
    }

    return { request, clear: () => cache.clear() };
  }

  root.LogPoseAtlasClient = { create };
})(globalThis);
