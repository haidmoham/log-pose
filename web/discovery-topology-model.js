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

  function observationKey(observation) {
    return JSON.stringify([observation.source, observation.year,
      observation.source_category]);
  }

  function prepare(payload) {
    const nodes = new Map();
    const categoryMembers = new Map();
    const observationsByNode = new Map();
    for (const candidate of payload.nodes || []) {
      if (nodes.has(candidate.id)) throw new Error(`duplicate discovery candidate ${candidate.id}`);
      nodes.set(candidate.id, candidate);
      const observations = new Map();
      for (const observation of candidate.observations || []) {
        const key = observationKey(observation);
        const group = observations.get(key) || [];
        group.push(observation);
        observations.set(key, group);
      }
      observationsByNode.set(candidate.id, observations);
      for (const key of observations.keys()) {
        if (!categoryMembers.has(key)) categoryMembers.set(key, []);
        categoryMembers.get(key).push(candidate.id);
      }
    }
    const pairs = new Map();
    for (const [key, memberIds] of categoryMembers) {
      memberIds.sort();
      for (let first = 0; first < memberIds.length; first++) {
        for (let second = first + 1; second < memberIds.length; second++) {
          const left = memberIds[first];
          const right = memberIds[second];
          const pairId = `${left}:${right}`;
          if (!pairs.has(pairId)) pairs.set(pairId, { left, right, keys: [] });
          pairs.get(pairId).keys.push(key);
        }
      }
    }
    if (pairs.size !== payload.counts.possible_pairs) {
      throw new Error(`source overlap count ${pairs.size} differs from retained manifest ${payload.counts.possible_pairs}`);
    }
    const neighbors = new Map([...nodes.keys()].map(id => [id, new Map()]));
    for (const pair of pairs.values()) {
      neighbors.get(pair.left).set(pair.right, pair);
      neighbors.get(pair.right).set(pair.left, pair);
    }
    return { payload, nodes, pairs, neighbors, observationsByNode };
  }

  function matchesObservation(observation, filters) {
    return (filters.source === 'all' || observation.source === filters.source)
      && (filters.year === 'all' || observation.year === Number(filters.year))
      && (filters.category === 'all' || observation.source_category === filters.category);
  }

  function matchingCandidates(prepared, filters) {
    const terms = (filters.query || '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return [...prepared.nodes.values()].filter(candidate => {
      if (filters.tag !== 'all' && !candidate.candidate_tags.includes(filters.tag)) return false;
      if (filters.identity === 'reviewed' && !candidate.identity_review) return false;
      if (filters.identity === 'unreviewed' && candidate.identity_review) return false;
      if ((filters.source !== 'all' || filters.year !== 'all' || filters.category !== 'all')
          && !candidate.observations.some(item => matchesObservation(item, filters))) return false;
      const haystack = [candidate.name, candidate.description,
        ...candidate.candidate_tags, ...candidate.observations.map(item => item.source_category)]
        .join(' ').toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  function matchingPairs(prepared, candidateIds, filters) {
    const ids = new Set(candidateIds);
    const result = [];
    for (const pair of prepared.pairs.values()) {
      if (!ids.has(pair.left) || !ids.has(pair.right)) continue;
      const keys = pair.keys.filter(key => matchesObservation(
        prepared.observationsByNode.get(pair.left).get(key)[0], filters));
      if (keys.length) result.push({ ...pair, keys });
    }
    return result;
  }

  function matchingNeighbors(prepared, candidateId, candidateIds, filters) {
    const ids = new Set(candidateIds);
    const matches = [];
    for (const [neighborId, pair] of prepared.neighbors.get(candidateId) || []) {
      if (!ids.has(neighborId)) continue;
      const keys = pair.keys.filter(key => matchesObservation(
        prepared.observationsByNode.get(candidateId).get(key)[0], filters));
      if (keys.length) matches.push({ candidate: prepared.nodes.get(neighborId), keys, pair });
    }
    return matches.sort((left, right) => right.keys.length - left.keys.length
      || left.candidate.name.localeCompare(right.candidate.name));
  }

  function positions(prepared) {
    const centers = {
      ai_automation: [265, 198], data_infrastructure: [735, 198],
      developer_tools: [265, 522], security_observability: [735, 522]
    };
    const groups = new Map(TAG_ORDER.map(tag => [tag, []]));
    for (const candidate of prepared.nodes.values()) {
      const tag = TAG_ORDER.find(item => candidate.candidate_tags.includes(item)) || TAG_ORDER[0];
      groups.get(tag).push(candidate);
    }
    const result = new Map();
    for (const [tag, candidates] of groups) {
      candidates.sort((left, right) => left.id.localeCompare(right.id));
      const [centerX, centerY] = centers[tag];
      candidates.forEach((candidate, index) => {
        const distance = Math.sqrt((index + .5) / candidates.length);
        const angle = index * 2.399963229728653;
        result.set(candidate.id, { x: centerX + Math.cos(angle) * distance * 178,
          y: centerY + Math.sin(angle) * distance * 116, tag });
      });
    }
    return { nodes: result, groups };
  }

  const model = { TAG_ORDER, TAG_LABELS, observationKey, prepare,
    matchingCandidates, matchingPairs, matchingNeighbors, positions };
  globalScope.LogPoseDiscoveryTopologyModel = model;
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
}(typeof globalThis !== 'undefined' ? globalThis : this));
