(function exposeDiscoveryTopologyView(globalScope) {
  'use strict';

  function create({ root, state, index, commitState, openRecord, openCompany }) {
    const { node, append, svgNode } = globalScope.LogPoseUI;
    const model = globalScope.LogPoseDiscoveryTopologyModel;
    const manifest = index.exploratory_topology;
    const formatCount = value => Number(value || 0).toLocaleString();
    let prepared = null;
    let layout = null;
    let loading = false;
    let error = null;
    let listLimit = 80;
    const queuedPairs = new Map();

    function load() {
      if (!manifest || prepared || loading) return;
      loading = true;
      fetch(`./${manifest.partition_path}`).then(response => {
        if (!response.ok) throw new Error(`source field HTTP ${response.status}`);
        return response.json();
      }).then(payload => {
        prepared = model.prepare(payload);
        layout = model.positions(prepared);
        queuedPairs.clear();
        for (const edge of payload.edges) {
          queuedPairs.set([edge.subject_candidate_id, edge.object_candidate_id].sort().join(':'), edge);
        }
        loading = false;
        if (state.view === 'topology' && state.topologyLayer === 'field')
          commitState({}, { replace: true });
      }).catch(failure => {
        error = failure.message;
        loading = false;
        if (state.view === 'topology' && state.topologyLayer === 'field')
          commitState({}, { replace: true });
      });
    }

    function filters() {
      return { query: state.fieldQuery, source: state.fieldSource,
        year: state.fieldYear, tag: state.fieldTag,
        category: state.fieldCategory, identity: state.fieldIdentity };
    }

    function observationMatches(observation, activeFilters) {
      return (activeFilters.source === 'all' || observation.source === activeFilters.source)
        && (activeFilters.year === 'all' || observation.year === Number(activeFilters.year))
        && (activeFilters.category === 'all' || observation.source_category === activeFilters.category);
    }

    function filteredObservationCount(candidates, activeFilters) {
      return candidates.reduce((count, candidate) => count + candidate.observations.filter(
        observation => observationMatches(observation, activeFilters)).length, 0);
    }

    function changeFilter(changes, focus) {
      listLimit = 80;
      commitState({ ...changes, fieldCandidate: null, fieldNeighbor: null },
        { replace: true, focus });
    }

    function controls() {
      const frame = node('div', '', 'field-controls');
      const search = node('input');
      search.id = 'field-search';
      search.type = 'search';
      search.placeholder = 'search 1,240 candidates, descriptions, categories…';
      search.setAttribute('aria-label', 'Search discovery candidates');
      search.value = state.fieldQuery;
      search.addEventListener('input', () => changeFilter({ fieldQuery: search.value.slice(0, 200) },
        '#field-search'));
      frame.append(search);
      const selects = node('div', '', 'field-facets');
      function select(label, id, values, value, key) {
        const control = node('select');
        control.id = id;
        control.setAttribute('aria-label', label);
        values.forEach(([optionValue, optionLabel]) => control.add(new Option(optionLabel, optionValue)));
        control.value = value;
        control.addEventListener('change', () => changeFilter({ [key]: control.value }, `#${id}`));
        return control;
      }
      const sources = [...new Set(prepared.payload.artifacts.map(item => item.source))].sort();
      const years = [...new Set(prepared.payload.artifacts.map(item => item.year))].sort();
      const categories = [...new Set(prepared.payload.nodes.flatMap(item =>
        item.observations.map(observation => observation.source_category)))].sort();
      selects.append(
        select('Inventory source', 'field-source', [['all', 'all sources'],
          ...sources.map(source => [source, source.toUpperCase()])], state.fieldSource, 'fieldSource'),
        select('Inventory year', 'field-year', [['all', 'all years'],
          ...years.map(year => [String(year), String(year)])], state.fieldYear, 'fieldYear'),
        select('Research category', 'field-tag', [['all', 'all research categories'],
          ...model.TAG_ORDER.map(tag => [tag, model.TAG_LABELS[tag]])], state.fieldTag, 'fieldTag'),
        select('Exact source category', 'field-category', [['all', 'all source categories'],
          ...categories.map(category => [category, category])], state.fieldCategory, 'fieldCategory'),
        select('Identity review', 'field-identity', [['all', 'all identity states'],
          ['reviewed', 'reviewed identity'], ['unreviewed', 'identity unreviewed']],
        state.fieldIdentity, 'fieldIdentity'));
      frame.append(selects);
      return frame;
    }

    function coverage(candidates, pairs, observationCount) {
      const section = node('section', '', 'field-coverage');
      const counts = prepared.payload.counts;
      const cards = [
        [candidates.length, counts.nodes, 'product / project candidates'],
        [observationCount, counts.observations, 'dated source placements'],
        [pairs.length, counts.possible_pairs, 'same-category-year pairs'],
        [counts.edges, counts.edges, 'sampled review leads']
      ];
      for (const [shown, total, label] of cards) {
        const card = node('div', '', 'field-coverage-card');
        card.append(node('span', label, 'eyebrow'), node('strong', formatCount(shown)),
          node('small', shown === total ? 'full retained frame' : `of ${formatCount(total)} in the frame`));
        section.append(card);
      }
      return section;
    }

    function candidateLabel(candidate) {
      return candidate.identity_review
        ? 'identity relation reviewed' : 'identity unreviewed';
    }

    function selectCandidate(candidateId) {
      commitState({ fieldCandidate: candidateId, fieldNeighbor: null },
        { focus: '#field-inspector' });
    }

    function selectNeighbor(candidateId) {
      commitState({ fieldNeighbor: candidateId }, { focus: '#field-inspector' });
    }

    function fieldMap(candidates, pairs, activeFilters, focusCandidate) {
      const section = node('section', '', 'field-map');
      section.append(append(node('div', '', 'field-map-head'),
        node('p', 'SOURCE FIELD / EXACT CO-LISTINGS', 'eyebrow'),
        node('p', focusCandidate
          ? `Focus: ${focusCandidate.name}. Lines show shared source category and year only.`
          : 'All matching candidates are placed in the field. Select one to reveal its exact co-listings.',
        'muted')));
      const svg = svgNode('svg', { viewBox: '0 0 1000 720', class: 'field-graph',
        role: 'img', 'aria-label': `${formatCount(candidates.length)} candidate dots in four research groups. Select a candidate from the list below to inspect exact co-listings.` });
      const activeIds = new Set(candidates.map(item => item.id));
      const tagPairs = new Map();
      for (const pair of pairs) {
        const left = layout.nodes.get(pair.left).tag;
        const right = layout.nodes.get(pair.right).tag;
        const key = [left, right].sort().join(':');
        tagPairs.set(key, (tagPairs.get(key) || 0) + 1);
      }
      const centers = {
        ai_automation: [265, 198], data_infrastructure: [735, 198],
        developer_tools: [265, 522], security_observability: [735, 522]
      };
      const maximumFlow = Math.max(1, ...tagPairs.values());
      if (!focusCandidate) {
        for (const [key, count] of tagPairs) {
          const [first, second] = key.split(':');
          if (first === second) continue;
          const [x1, y1] = centers[first];
          const [x2, y2] = centers[second];
          const path = svgNode('path', { d: `M ${x1} ${y1} Q 500 360 ${x2} ${y2}`,
            class: 'field-aggregate-flow',
            'stroke-width': String(1 + 9 * Math.sqrt(count / maximumFlow)) });
          const tooltip = svgNode('title');
          tooltip.textContent = `${formatCount(count)} exact co-listing pairs between ${model.TAG_LABELS[first]} and ${model.TAG_LABELS[second]}`;
          path.append(tooltip);
          svg.append(path);
        }
      }
      for (const tag of model.TAG_ORDER) {
        const [x, y] = centers[tag];
        const label = svgNode('text', { x, y: y - 134, 'text-anchor': 'middle',
          class: 'field-group-label' });
        const count = layout.groups.get(tag).filter(item => activeIds.has(item.id)).length;
        label.textContent = `${model.TAG_LABELS[tag]} · ${formatCount(count)}`;
        svg.append(label);
      }
      const neighbors = focusCandidate
        ? model.matchingNeighbors(prepared, focusCandidate.id, candidates.map(item => item.id), activeFilters)
        : [];
      const neighborIds = new Set(neighbors.map(item => item.candidate.id));
      if (focusCandidate) {
        const start = layout.nodes.get(focusCandidate.id);
        for (const neighbor of neighbors) {
          const end = layout.nodes.get(neighbor.candidate.id);
          const selected = state.fieldNeighbor === neighbor.candidate.id;
          svg.append(svgNode('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y,
            class: `field-neighbor-line${selected ? ' is-selected' : ''}` }));
        }
      }
      for (const candidate of prepared.nodes.values()) {
        const position = layout.nodes.get(candidate.id);
        const active = activeIds.has(candidate.id);
        const focused = focusCandidate?.id === candidate.id;
        const neighbor = neighborIds.has(candidate.id);
        const selected = state.fieldNeighbor === candidate.id;
        const circle = svgNode('circle', { cx: position.x, cy: position.y,
          r: focused ? 9 : selected ? 7 : candidate.identity_review ? 4.5 : 3.1,
          class: `field-dot field-${position.tag}${active ? '' : ' is-muted'}`
            + (focused ? ' is-focused' : '') + (neighbor ? ' is-neighbor' : '')
            + (selected ? ' is-selected' : ''),
          'data-candidate-id': candidate.id });
        const tooltip = svgNode('title');
        tooltip.textContent = `${candidate.name} · ${candidateLabel(candidate)}`;
        circle.append(tooltip);
        if (active) circle.addEventListener('click', () => {
          if (focusCandidate && neighbor && !focused) selectNeighbor(candidate.id);
          else selectCandidate(candidate.id);
        });
        svg.append(circle);
      }
      section.append(append(node('div', '', 'field-graph-frame'), svg),
        node('p', focusCandidate
          ? `${formatCount(neighbors.length)} exact co-listings for ${focusCandidate.name} in this filter. Select a dot or a row to compare retained source placements.`
          : `${formatCount(candidates.length)} candidates and ${formatCount(pairs.length)} derivable overlaps are in this filter. The lines group co-listings by research category; they do not describe business relationships.`,
        'field-map-caption'));
      return { section, neighbors };
    }

    function rowButton(observation, row, label) {
      const button = node('button', label, 'field-row-button');
      button.type = 'button';
      button.addEventListener('click', () => openRecord(row.id));
      return button;
    }

    function observationList(candidate, activeFilters) {
      const list = node('div', '', 'field-observations');
      const observations = candidate.observations.filter(item =>
        observationMatches(item, activeFilters));
      for (const observation of observations) {
        const item = node('article', '', 'field-observation');
        item.append(node('strong', `${observation.source.toUpperCase()} ${observation.year} · ${observation.source_category}`),
          node('small', `artifact ${observation.artifact_sha256.slice(0, 12)} · ${observation.occurrence_ids.length} row${observation.occurrence_ids.length === 1 ? '' : 's'}`));
        for (const row of observation.rows) item.append(rowButton(observation, row,
          `inspect ${row.name} source row →`));
        list.append(item);
      }
      return list;
    }

    function inspector(focusCandidate, selectedNeighbor, neighbors, activeFilters) {
      const panel = node('aside', '', 'field-inspector');
      panel.id = 'field-inspector';
      panel.tabIndex = -1;
      panel.append(node('p', 'INSPECT THE SOURCE FIELD', 'eyebrow'));
      if (!focusCandidate) {
        panel.append(node('h3', 'A field of 1,240 leads'),
          node('p', 'Each dot is a retained product or project candidate. Source-category co-listing can nominate research, but it does not establish company identity, competition, partnership, or shared customers.', 'muted'),
          node('p', 'Use the filters, search, or candidate index. Then select a dot to inspect its dated source rows and exact co-listings.', 'caveat'));
        return panel;
      }
      panel.append(node('h3', focusCandidate.name),
        node('p', focusCandidate.description || 'No retained description.', 'field-description'));
      const clear = node('button', 'clear focus ×', 'quiet-button');
      clear.type = 'button';
      clear.addEventListener('click', () => commitState({ fieldCandidate: null,
        fieldNeighbor: null }, { focus: '#field-search' }));
      panel.append(clear);
      const identity = focusCandidate.identity_review;
      panel.append(node('p', identity
        ? `Reviewed identity relation: ${identity.provider_name} · ${identity.provider_relation}. Eligibility and every proposed market relationship remain separate.`
        : focusCandidate.navigation_match
          ? `Unreviewed navigation match: ${focusCandidate.navigation_match.slug}. This is a name or homepage lead, not an identity review.`
          : 'Company identity and U.S. eligibility are unreviewed.', 'caveat'));
      if (identity?.pilot_slug) {
        const company = node('button', `open ${identity.provider_name} pilot study →`, 'text-button');
        company.type = 'button';
        company.addEventListener('click', () => openCompany(identity.pilot_slug));
        panel.append(company);
      }
      panel.append(node('h4', `${formatCount(focusCandidate.observations.length)} dated source placements`, 'section-title'),
        observationList(focusCandidate, activeFilters));
      if (selectedNeighbor) {
        const match = neighbors.find(item => item.candidate.id === selectedNeighbor.id);
        if (match) {
          const queueId = [focusCandidate.id, selectedNeighbor.id].sort().join(':');
          const queue = queuedPairs.get(queueId);
          panel.append(node('h4', `${focusCandidate.name} / ${selectedNeighbor.name}`, 'section-title'),
            node('p', `${match.keys.length} exact source-category-year placements overlap. ${queue
              ? 'This pair is in the 100-item sampled review worklist.'
              : 'This pair is outside the sampled review worklist.'} No relationship claim follows from co-listing.`, 'caveat'));
          for (const key of match.keys) {
            const left = prepared.observationsByNode.get(focusCandidate.id).get(key);
            const right = prepared.observationsByNode.get(selectedNeighbor.id).get(key);
            const observation = left[0];
            const item = node('article', '', 'field-shared-placement');
            item.append(node('strong', `${observation.source.toUpperCase()} ${observation.year} · ${observation.source_category}`),
              node('p', 'Both candidate rows appear in this pinned category and year. Inspect either retained row here.', 'muted'));
            for (const source of left) for (const row of source.rows)
              item.append(rowButton(source, row, `${focusCandidate.name}: ${row.name} →`));
            for (const source of right) for (const row of source.rows)
              item.append(rowButton(source, row, `${selectedNeighbor.name}: ${row.name} →`));
            panel.append(item);
          }
        }
      } else panel.append(node('p', `${formatCount(neighbors.length)} candidates share at least one exact source category and year with this candidate in the current filter. Select a connected dot or candidate row to inspect the shared placements.`, 'muted'));
      return panel;
    }

    function candidateIndex(candidates, neighbors, focusCandidate) {
      const section = node('section', '', 'field-index');
      const entries = focusCandidate ? neighbors.map(item => item.candidate) : candidates;
      section.append(node('p', focusCandidate ? 'EXACT CO-LISTINGS' : 'CANDIDATE INDEX', 'eyebrow'),
        node('h3', `${formatCount(entries.length)} ${focusCandidate ? 'neighbors' : 'candidates'}`));
      for (const candidate of entries.slice(0, listLimit)) {
        const button = node('button', '', 'field-index-row');
        button.type = 'button';
        button.append(node('strong', candidate.name),
          node('span', `${candidate.candidate_tags.map(tag => model.TAG_LABELS[tag]).join(' · ')} · ${candidate.observed_years[0]}–${candidate.observed_years.at(-1)}`, 'muted'),
          node('small', candidateLabel(candidate)));
        button.addEventListener('click', () => {
          if (focusCandidate) selectNeighbor(candidate.id);
          else selectCandidate(candidate.id);
        });
        section.append(button);
      }
      if (entries.length > listLimit) {
        const more = node('button', `show ${Math.min(80, entries.length - listLimit)} more`,
          'quiet-button field-show-more');
        more.type = 'button';
        more.addEventListener('click', () => {
          listLimit += 80;
          commitState({}, { focus: '.field-show-more' });
        });
        section.append(more);
      }
      return section;
    }

    function render() {
      if (!manifest) {
        root.append(node('p', 'This export has no discovery topology partition.', 'empty-state'));
        return;
      }
      if (error) {
        const retry = node('button', 'retry source field', 'quiet-button');
        retry.type = 'button';
        retry.addEventListener('click', () => {
          error = null;
          load();
          commitState({}, { replace: true });
        });
        root.append(node('p', error, 'error'), retry);
        return;
      }
      if (!prepared) {
        root.append(node('p', 'loading the full retained candidate field…', 'loading'));
        load();
        return;
      }
      const activeFilters = filters();
      const candidates = model.matchingCandidates(prepared, activeFilters);
      const pairs = model.matchingPairs(prepared, candidates.map(item => item.id), activeFilters);
      const focusCandidate = candidates.find(item => item.id === state.fieldCandidate) || null;
      const selectedNeighbor = candidates.find(item => item.id === state.fieldNeighbor) || null;
      const map = fieldMap(candidates, pairs, activeFilters, focusCandidate);
      root.append(coverage(candidates, pairs, filteredObservationCount(candidates, activeFilters)),
        node('p', 'A co-listing means two product or project rows appeared in the same named source category and inventory year. It is a research lead, not a company relationship. Accepted claims have their own review layer.', 'field-warning'),
        controls());
      const workspace = node('div', '', 'field-workspace');
      workspace.append(map.section, inspector(focusCandidate, selectedNeighbor,
        map.neighbors, activeFilters));
      root.append(workspace, candidateIndex(candidates, map.neighbors, focusCandidate));
    }

    return { render };
  }

  globalScope.LogPoseDiscoveryTopologyView = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
