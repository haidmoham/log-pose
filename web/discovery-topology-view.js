(function exposeDiscoveryTopologyView(globalScope) {
  'use strict';

  function create({ root, state, index, commitState, openRecord, openCompany }) {
    const { node, append, svgNode } = globalScope.LogPoseUI;
    const model = globalScope.LogPoseDiscoveryTopologyModel;
    const manifest = index.exploratory_topology;
    const formatCount = value => Number(value || 0).toLocaleString();
    const pageSize = 80;
    let summary = null;
    let summaryError = null;
    let summaryLoading = false;
    let summaryRequest = 0;
    let layout = null;
    let queryKey = null;
    let queryResult = null;
    let queryError = null;
    let queryLoading = false;
    let queryRequest = 0;
    let loadedCandidates = [];
    let detailKey = null;
    let detailResult = null;
    let detailError = null;
    let detailLoading = false;
    let detailRequest = 0;
    let mismatchRefreshAttempted = false;
    let summaryRefreshToken = null;

    function endpoint(params) {
      return `./api/market-field?${new URLSearchParams(params).toString()}`;
    }

    async function requestJson(url) {
      const response = await fetch(url, { cache: 'no-store',
        headers: { accept: 'application/json' } });
      let body;
      try { body = await response.json(); }
      catch { body = null; }
      if (!response.ok) {
        const failure = new Error(body?.error || `market field HTTP ${response.status}`);
        failure.status = response.status;
        failure.body = body;
        throw failure;
      }
      return body;
    }

    function clearBuildData() {
      summary = null;
      summaryError = null;
      summaryLoading = false;
      queryKey = null;
      queryResult = null;
      queryError = null;
      queryLoading = false;
      loadedCandidates = [];
      detailKey = null;
      detailResult = null;
      detailError = null;
      detailLoading = false;
      summaryRequest += 1;
      queryRequest += 1;
      detailRequest += 1;
    }

    function refreshAfterMismatch() {
      if (mismatchRefreshAttempted) {
        queryLoading = false;
        detailLoading = false;
        queryError = 'The market field changed again while loading. Retry the field query to continue.';
        commitState({}, { replace: true });
        return;
      }
      mismatchRefreshAttempted = true;
      summaryRefreshToken = `${Date.now()}-${summaryRequest + 1}`;
      clearBuildData();
      commitState({}, { replace: true });
    }

    function loadSummary() {
      if (summary || summaryLoading) return;
      summaryLoading = true;
      const requestId = ++summaryRequest;
      const params = { mode: 'summary' };
      if (summaryRefreshToken) params.refresh = summaryRefreshToken;
      requestJson(endpoint(params)).then(result => {
        if (!model.isCurrentRequest(requestId, 'summary', summaryRequest, 'summary')) return;
        if (result.schema_version !== '1.0' || !result.build_id
            || !Array.isArray(result.candidates) || !result.counts || !result.facets) {
          throw new Error('market field summary is incomplete');
        }
        summary = result;
        layout = model.positions(summary.candidates);
        summaryError = null;
        summaryLoading = false;
        summaryRefreshToken = null;
        commitState({}, { replace: true });
      }).catch(failure => {
        if (!model.isCurrentRequest(requestId, 'summary', summaryRequest, 'summary')) return;
        summaryLoading = false;
        summaryError = failure.message;
        commitState({}, { replace: true });
      });
    }

    function filters() {
      return { query: state.fieldQuery, source: state.fieldSource,
        year: state.fieldYear, tag: state.fieldTag,
        category: state.fieldCategory, identity: state.fieldIdentity };
    }

    function currentQueryKey(activeFilters) {
      return JSON.stringify([summary?.build_id, activeFilters.query, activeFilters.source,
        activeFilters.year, activeFilters.tag, activeFilters.category,
        activeFilters.identity, state.fieldCandidate]);
    }

    function queryParams(activeFilters, offset, neighborOffset = 0) {
      const params = { mode: 'query', build_id: summary.build_id,
        source: activeFilters.source, year: activeFilters.year,
        category: activeFilters.category, tag: activeFilters.tag,
        identity: activeFilters.identity, query: activeFilters.query,
        offset: String(offset), limit: String(pageSize) };
      if (state.fieldCandidate) {
        params.candidate = state.fieldCandidate;
        params.neighbor_offset = String(neighborOffset);
        params.neighbor_limit = '500';
      }
      return params;
    }

    function loadQuery(activeFilters) {
      if (!summary) return;
      const key = currentQueryKey(activeFilters);
      if (queryKey !== key) {
        queryKey = key;
        queryResult = null;
        queryError = null;
        loadedCandidates = [];
        queryLoading = false;
        queryRequest += 1;
        detailKey = null;
        detailResult = null;
        detailError = null;
        detailRequest += 1;
      }
      if (queryLoading || queryError || queryResult) return;
      const offset = loadedCandidates.length;
      if (queryResult && queryResult.next_offset !== offset) return;
      queryLoading = true;
      root.setAttribute('aria-busy', 'true');
      const requestId = ++queryRequest;
      requestJson(endpoint(queryParams(activeFilters, offset))).then(result => {
        if (!model.isCurrentRequest(requestId, key, queryRequest, queryKey)) return;
        if (!model.matchesBuild(summary.build_id, result.build_id)) {
          refreshAfterMismatch();
          return;
        }
        if (!Array.isArray(result.candidate_ids) || !Array.isArray(result.candidates)
            || !Array.isArray(result.neighbors) || !Array.isArray(result.tag_flows)) {
          throw new Error('market field query is incomplete');
        }
        loadedCandidates = offset === 0 ? result.candidates
          : loadedCandidates.concat(result.candidates);
        queryResult = result;
        queryError = null;
        queryLoading = false;
        // A focused read is complete only after its detail response also matches.
        if (!state.fieldCandidate) mismatchRefreshAttempted = false;
        commitState({}, { replace: true });
      }).catch(failure => {
        if (!model.isCurrentRequest(requestId, key, queryRequest, queryKey)) return;
        if (failure.status === 409) {
          refreshAfterMismatch();
          return;
        }
        queryLoading = false;
        queryError = failure.message;
        commitState({}, { replace: true });
      });
    }

    function loadDetail(focusCandidate, selectedNeighbor) {
      if (!summary || !focusCandidate) return;
      const key = JSON.stringify([summary.build_id, focusCandidate.id,
        selectedNeighbor?.id || '']);
      if (detailKey !== key) {
        detailKey = key;
        detailResult = null;
        detailError = null;
        detailLoading = false;
        detailRequest += 1;
      }
      if (detailLoading || detailResult || detailError) return;
      detailLoading = true;
      const requestId = ++detailRequest;
      const params = { mode: 'detail', build_id: summary.build_id,
        candidate: focusCandidate.id };
      if (selectedNeighbor) params.neighbor = selectedNeighbor.id;
      requestJson(endpoint(params)).then(result => {
        if (!model.isCurrentRequest(requestId, key, detailRequest, detailKey)) return;
        if (!model.matchesBuild(summary.build_id, result.build_id)) {
          refreshAfterMismatch();
          return;
        }
        if (!result.candidate || !Array.isArray(result.candidate.observations)
            || !Array.isArray(result.shared_observations)) {
          throw new Error('market field detail is incomplete');
        }
        const hasFilteredSharedPlacement = result.shared_observations.some(item =>
          (state.fieldSource === 'all' || item.source === state.fieldSource)
          && (state.fieldYear === 'all' || item.year === Number(state.fieldYear))
          && (state.fieldCategory === 'all' || item.source_category === state.fieldCategory));
        if (selectedNeighbor && (!result.neighbor || !hasFilteredSharedPlacement)) {
          detailError = 'The selected candidate has no exact shared placement in the current filter.';
          detailLoading = false;
          commitState({}, { replace: true });
          return;
        }
        detailResult = result;
        detailLoading = false;
        detailError = null;
        mismatchRefreshAttempted = false;
        commitState({}, { replace: true });
      }).catch(failure => {
        if (!model.isCurrentRequest(requestId, key, detailRequest, detailKey)) return;
        if (failure.status === 409) {
          refreshAfterMismatch();
          return;
        }
        detailLoading = false;
        detailError = failure.message;
        commitState({}, { replace: true });
      });
    }

    function changeFilter(changes, focus) {
      commitState({ ...changes, fieldCandidate: null, fieldNeighbor: null },
        { replace: true, focus });
    }

    function controls() {
      const frame = node('div', '', 'field-controls');
      const search = node('input');
      search.id = 'field-search';
      search.type = 'search';
      search.placeholder = `search ${formatCount(summary.counts.nodes)} candidates, descriptions, categories…`;
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
      const sources = [...summary.facets.sources].sort();
      const years = [...summary.facets.years].sort((left, right) => Number(left) - Number(right));
      const categories = [...summary.facets.categories].sort();
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

    function coverage(result) {
      const section = node('section', '', 'field-coverage');
      const cards = [
        [result.total_candidates, summary.counts.nodes, 'product / project candidates'],
        [result.observation_count, summary.counts.observations, 'dated source placements'],
        [result.pair_count, summary.counts.possible_pairs, 'same-category-year pairs'],
        [summary.counts.edges, summary.counts.edges, 'sampled review leads']
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

    function fieldMap(result, focusCandidate) {
      const section = node('section', '', 'field-map');
      section.append(append(node('div', '', 'field-map-head'),
        node('p', 'SOURCE FIELD / EXACT CO-LISTINGS', 'eyebrow'),
        node('p', focusCandidate
          ? `Focus: ${focusCandidate.name}. Lines show shared source category and year only.`
          : 'All matching candidates are placed in the field. Select one to reveal its exact co-listings.',
        'muted')));
      const svg = svgNode('svg', { viewBox: '0 0 1000 720', class: 'field-graph',
        role: 'img', 'aria-label': `${formatCount(result.total_candidates)} candidate dots in four research groups. Select a candidate from the list below to inspect exact co-listings.` });
      const activeIds = new Set(result.candidate_ids);
      const centers = {
        ai_automation: [265, 198], data_infrastructure: [735, 198],
        developer_tools: [265, 522], security_observability: [735, 522]
      };
      const tagPairs = new Map();
      for (const flow of result.tag_flows) {
        const key = [flow.left, flow.right].sort().join(':');
        tagPairs.set(key, flow.count);
      }
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
      const neighbors = focusCandidate ? result.neighbors : [];
      const neighborIds = new Set(neighbors.map(item => item.candidate.id));
      if (focusCandidate) {
        const start = layout.nodes.get(focusCandidate.id);
        for (const neighbor of neighbors) {
          const end = layout.nodes.get(neighbor.candidate.id);
          const selected = state.fieldNeighbor === neighbor.candidate.id;
          svg.append(svgNode('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y,
            class: `field-neighbor-line${selected ? ' is-selected' : ''}` }));
        }
        const directNeighbor = detailResult?.neighbor;
        if (directNeighbor && !neighborIds.has(directNeighbor.id)) {
          const end = layout.nodes.get(directNeighbor.id);
          if (end) {
            neighborIds.add(directNeighbor.id);
            svg.append(svgNode('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y,
              class: 'field-neighbor-line is-selected' }));
          }
        }
      }
      for (const candidate of summary.candidates) {
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
          ? `${formatCount(result.neighbor_count)} exact co-listings for ${focusCandidate.name} in this filter. Select a dot or a row to compare retained source placements.`
          : `${formatCount(result.total_candidates)} candidates and ${formatCount(result.pair_count)} derivable overlaps are in this filter. The lines group co-listings by research category; they do not describe business relationships.`,
        'field-map-caption'));
      return { section, neighbors };
    }

    function rowButton(row, label) {
      const button = node('button', label, 'field-row-button');
      button.type = 'button';
      button.addEventListener('click', () => openRecord(row.id));
      return button;
    }

    function observations(candidate, activeFilters) {
      return candidate.observations.filter(item =>
        (activeFilters.source === 'all' || item.source === activeFilters.source)
        && (activeFilters.year === 'all' || item.year === Number(activeFilters.year))
        && (activeFilters.category === 'all' || item.source_category === activeFilters.category));
    }

    function observationList(candidate, activeFilters) {
      const list = node('div', '', 'field-observations');
      for (const observation of observations(candidate, activeFilters)) {
        const item = node('article', '', 'field-observation');
        item.append(node('strong', `${observation.source.toUpperCase()} ${observation.year} · ${observation.source_category}`),
          node('small', `artifact ${observation.artifact_sha256.slice(0, 12)} · ${observation.occurrence_ids.length} row${observation.occurrence_ids.length === 1 ? '' : 's'}`));
        for (const row of observation.rows) item.append(rowButton(row,
          `inspect ${row.name} source row →`));
        list.append(item);
      }
      return list;
    }

    function inspector(focusCandidate, selectedNeighbor, result, activeFilters) {
      const panel = node('aside', '', 'field-inspector');
      panel.id = 'field-inspector';
      panel.tabIndex = -1;
      panel.append(node('p', 'INSPECT THE SOURCE FIELD', 'eyebrow'));
      if (!focusCandidate) {
        panel.append(node('h3', `A field of ${formatCount(summary.counts.nodes)} leads`),
          node('p', 'Each dot is a retained product or project candidate. Source-category co-listing can nominate research, but it does not establish company identity, competition, partnership, or shared customers.', 'muted'),
          node('p', 'Use the filters, search, or candidate index. Then select a dot to inspect its dated source rows and exact co-listings.', 'caveat'));
        return panel;
      }
      if (!detailResult) {
        panel.append(node('h3', focusCandidate.name),
          node('p', detailError ? `Source detail failed: ${detailError}`
            : detailLoading ? 'Loading retained source detail…' : 'Loading retained source detail…',
          detailError ? 'error' : 'loading'));
        if (detailError) {
          const retry = node('button', 'retry source detail', 'quiet-button');
          retry.type = 'button';
          retry.addEventListener('click', () => {
            detailError = null;
            detailKey = null;
            commitState({}, { replace: true });
          });
          panel.append(retry);
        }
        return panel;
      }
      const candidate = detailResult.candidate;
      panel.append(node('h3', candidate.name),
        node('p', candidate.description || 'No retained description.', 'field-description'));
      const clear = node('button', 'clear focus ×', 'quiet-button');
      clear.type = 'button';
      clear.addEventListener('click', () => commitState({ fieldCandidate: null,
        fieldNeighbor: null }, { focus: '#field-search' }));
      panel.append(clear);
      const identity = candidate.identity_review;
      panel.append(node('p', identity
        ? `Reviewed identity relation: ${identity.provider_name} · ${identity.provider_relation}. Eligibility and every proposed market relationship remain separate.`
        : candidate.navigation_match
          ? `Unreviewed navigation match: ${candidate.navigation_match.slug}. This is a name or homepage lead, not an identity review.`
          : 'Company identity and U.S. eligibility are unreviewed.', 'caveat'));
      if (identity?.pilot_slug) {
        const company = node('button', `open ${identity.provider_name} pilot study →`, 'text-button');
        company.type = 'button';
        company.addEventListener('click', () => openCompany(identity.pilot_slug));
        panel.append(company);
      }
      panel.append(node('h4', `${formatCount(observations(candidate, activeFilters).length)} dated source placements`, 'section-title'),
        observationList(candidate, activeFilters));
      if (selectedNeighbor && detailResult.neighbor) {
        const neighbor = detailResult.neighbor;
        const sharedPlacements = detailResult.shared_observations.filter(item =>
          (activeFilters.source === 'all' || item.source === activeFilters.source)
          && (activeFilters.year === 'all' || item.year === Number(activeFilters.year))
          && (activeFilters.category === 'all' || item.source_category === activeFilters.category));
        panel.append(node('h4', `${candidate.name} / ${neighbor.name}`, 'section-title'),
          node('p', `${formatCount(sharedPlacements.length)} exact source-category-year placements overlap. ${detailResult.in_review_worklist
            ? `This pair is in the ${formatCount(summary.counts.edges)}-item sampled review worklist.`
            : 'This pair is outside the sampled review worklist.'} No relationship claim follows from co-listing.`, 'caveat'));
        for (const shared of sharedPlacements) {
          const item = node('article', '', 'field-shared-placement');
          item.append(node('strong', `${shared.source.toUpperCase()} ${shared.year} · ${shared.source_category}`),
            node('p', `shared artifact ${shared.artifact_sha256.slice(0, 12)}. Both candidates appear in this pinned category and year.`, 'muted'));
          for (const row of shared.subject_rows) item.append(rowButton(row,
            `${candidate.name}: ${row.name} →`));
          for (const row of shared.object_rows) item.append(rowButton(row,
            `${neighbor.name}: ${row.name} →`));
          panel.append(item);
        }
      } else if (selectedNeighbor) {
        panel.append(node('p', detailError ? `Shared source detail failed: ${detailError}`
          : 'Loading exact shared source rows…', detailError ? 'error' : 'loading'));
      } else panel.append(node('p', `${formatCount(result.neighbor_count)} candidates share at least one exact source category and year with this candidate in the current filter. Select a connected dot or candidate row to inspect the shared placements.`, 'muted'));
      return panel;
    }

    function candidateIndex(result, focusCandidate) {
      const section = node('section', '', 'field-index');
      const entries = focusCandidate ? result.neighbors.map(item => item.candidate) : loadedCandidates;
      section.append(node('p', focusCandidate ? 'EXACT CO-LISTINGS' : 'CANDIDATE INDEX', 'eyebrow'),
        node('h3', `${formatCount(focusCandidate ? result.neighbor_count : result.total_candidates)} ${focusCandidate ? 'neighbors' : 'candidates'}`));
      for (const candidate of entries) {
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
      if (!focusCandidate && result.next_offset !== null) {
        const more = node('button', queryLoading ? 'loading more candidates…' : 'show 80 more',
          'quiet-button field-show-more');
        more.type = 'button';
        more.disabled = queryLoading;
        more.addEventListener('click', () => {
          if (queryLoading) return;
          requestNextPage();
        });
        section.append(more);
      }
      if (focusCandidate && result.next_neighbor_offset !== null) {
        const more = node('button', queryLoading ? 'loading more neighbors…' : 'show more neighbors',
          'quiet-button field-show-more-neighbors');
        more.type = 'button';
        more.disabled = queryLoading;
        more.addEventListener('click', () => {
          if (!queryLoading) requestNextNeighbors();
        });
        section.append(more);
      }
      return section;
    }

    function requestNextPage() {
      const activeFilters = filters();
      if (queryLoading || !queryResult || queryResult.next_offset === null) return;
      const offset = queryResult.next_offset;
      const key = queryKey;
      queryLoading = true;
      const requestId = ++queryRequest;
      root.setAttribute('aria-busy', 'true');
      requestJson(endpoint(queryParams(activeFilters, offset))).then(result => {
        if (!model.isCurrentRequest(requestId, key, queryRequest, queryKey)) return;
        if (!model.matchesBuild(summary.build_id, result.build_id)) {
          refreshAfterMismatch();
          return;
        }
        loadedCandidates = loadedCandidates.concat(result.candidates);
        queryResult = result;
        queryLoading = false;
        // A focused read is complete only after its detail response also matches.
        if (!state.fieldCandidate) mismatchRefreshAttempted = false;
        commitState({}, { replace: true });
      }).catch(failure => {
        if (!model.isCurrentRequest(requestId, key, queryRequest, queryKey)) return;
        if (failure.status === 409) {
          refreshAfterMismatch();
          return;
        }
        queryLoading = false;
        queryError = failure.message;
        commitState({}, { replace: true });
      });
    }

    function requestNextNeighbors() {
      const activeFilters = filters();
      if (queryLoading || !queryResult || queryResult.next_neighbor_offset === null) return;
      const neighborOffset = queryResult.next_neighbor_offset;
      const key = queryKey;
      queryLoading = true;
      const requestId = ++queryRequest;
      root.setAttribute('aria-busy', 'true');
      requestJson(endpoint(queryParams(activeFilters, 0, neighborOffset))).then(result => {
        if (!model.isCurrentRequest(requestId, key, queryRequest, queryKey)) return;
        if (!model.matchesBuild(summary.build_id, result.build_id)) {
          refreshAfterMismatch();
          return;
        }
        queryResult = { ...queryResult,
          neighbors: queryResult.neighbors.concat(result.neighbors),
          next_neighbor_offset: result.next_neighbor_offset };
        queryLoading = false;
        // A focused read is complete only after its detail response also matches.
        if (!state.fieldCandidate) mismatchRefreshAttempted = false;
        commitState({}, { replace: true });
      }).catch(failure => {
        if (!model.isCurrentRequest(requestId, key, queryRequest, queryKey)) return;
        if (failure.status === 409) {
          refreshAfterMismatch();
          return;
        }
        queryLoading = false;
        queryError = failure.message;
        commitState({}, { replace: true });
      });
    }

    function render() {
      if (!manifest) {
        root.append(node('p', 'This export has no discovery topology partition.', 'empty-state'));
        return;
      }
      if (!summary) {
        if (summaryError) {
          const retry = node('button', 'retry market field', 'quiet-button');
          retry.type = 'button';
          retry.addEventListener('click', () => {
            summaryError = null;
            mismatchRefreshAttempted = false;
            summaryRefreshToken = `${Date.now()}-${summaryRequest + 1}`;
            loadSummary();
            commitState({}, { replace: true });
          });
          root.append(node('p', `The market field is unavailable: ${summaryError}`, 'error'), retry);
        } else {
          root.setAttribute('aria-busy', 'true');
          root.append(node('p', 'Loading candidate summary from the versioned market field…', 'loading'));
          loadSummary();
        }
        return;
      }
      const activeFilters = filters();
      loadQuery(activeFilters);
      root.setAttribute('aria-busy', String(queryLoading || detailLoading));
      if (queryError) {
        const retry = node('button', 'retry market field query', 'quiet-button');
        retry.type = 'button';
        retry.addEventListener('click', () => {
          queryError = null;
          mismatchRefreshAttempted = false;
          queryKey = null;
          commitState({}, { replace: true });
        });
        root.append(controls(), node('p', `The market field query failed: ${queryError}`, 'error'), retry);
        return;
      }
      if (!queryResult) {
        root.append(controls(), node('p', 'Loading the filtered candidate field…', 'loading'));
        return;
      }
      const candidatesById = new Map(summary.candidates.map(candidate => [candidate.id, candidate]));
      const focusCandidate = queryResult.candidate_ids.includes(state.fieldCandidate)
        ? candidatesById.get(state.fieldCandidate) || null : null;
      const selectedNeighbor = queryResult.neighbors.find(item =>
        item.candidate.id === state.fieldNeighbor)?.candidate
        || (state.fieldNeighbor && queryResult.candidate_ids.includes(state.fieldNeighbor)
          ? candidatesById.get(state.fieldNeighbor) : null) || null;
      if (focusCandidate) loadDetail(focusCandidate, selectedNeighbor);
      root.setAttribute('aria-busy', String(queryLoading || detailLoading));
      const map = fieldMap(queryResult, focusCandidate);
      root.append(coverage(queryResult),
        node('p', 'A co-listing means two product or project rows appeared in the same named source category and inventory year. It is a research lead, not a company relationship. Accepted claims have their own review layer.', 'field-warning'),
        controls());
      if (queryResult.total_candidates === 0) {
        root.append(node('p', 'No candidates match these filters.', 'empty-state'));
        return;
      }
      const workspace = node('div', '', 'field-workspace');
      workspace.append(map.section, inspector(focusCandidate, selectedNeighbor,
        queryResult, activeFilters));
      root.append(workspace, candidateIndex(queryResult, focusCandidate));
    }

    return { render };
  }

  globalScope.LogPoseDiscoveryTopologyView = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
