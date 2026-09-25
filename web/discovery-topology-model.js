(function exposeDiscoveryTopologyModel(globalScope) {
  'use strict';

  const TAG_ORDER = ['ai_automation', 'data_infrastructure',
    'developer_tools', 'security_observability'];
  const TAG_LABELS = {
    ai_automation: 'AI / automation',
    data_infrastructure: 'Data infrastructure',
    developer_tools: 'Developer tools',
    security_observability: 'Security / observability'
  };

  function isCurrentRequest(requestId, requestKey, currentRequestId, currentRequestKey) {
    return requestId === currentRequestId && requestKey === currentRequestKey;
  }

  function matchesBuild(expectedBuildId, responseBuildId) {
    return Boolean(expectedBuildId) && expectedBuildId === responseBuildId;
  }

  function positions(candidates) {
    const centers = {
      ai_automation: [265, 198], data_infrastructure: [735, 198],
      developer_tools: [265, 522], security_observability: [735, 522]
    };
    const groups = new Map(TAG_ORDER.map(tag => [tag, []]));
    for (const candidate of candidates) {
      const tag = TAG_ORDER.find(item => candidate.candidate_tags.includes(item)) || TAG_ORDER[0];
      groups.get(tag).push(candidate);
    }
    const result = new Map();
    for (const [tag, members] of groups) {
      members.sort((left, right) => left.id.localeCompare(right.id));
      const [centerX, centerY] = centers[tag];
      members.forEach((candidate, index) => {
        const distance = Math.sqrt((index + .5) / members.length);
        const angle = index * 2.399963229728653;
        result.set(candidate.id, { x: centerX + Math.cos(angle) * distance * 178,
          y: centerY + Math.sin(angle) * distance * 116, tag });
      });
    }
    return { nodes: result, groups };
  }

  const model = { TAG_ORDER, TAG_LABELS, positions, isCurrentRequest, matchesBuild };
  globalScope.LogPoseDiscoveryTopologyModel = model;
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
}(typeof globalThis !== 'undefined' ? globalThis : this));
