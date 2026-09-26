(function exposeTemporalTopologyView(globalScope) {
  'use strict';

  function create({ root, state, commitState, openRecord }) {
    const { node, append } = globalScope.LogPoseUI;
    let active = false;
    let timeline = null;
    let timelineError = null;
    let frame = null;
    let frameError = null;
    let timelineRequest = 0;
    let frameRequest = 0;
    let frameKey = '';
    let displayedKey = '';
    let frameLoading = false;
    const frameCache = new Map();
    let playTimer = null;
    let committedQuery = state.temporalQuery || '';
    let queryDraft = committedQuery;
    let surface = null;
    let frameContent = null;
    let transitionStatus = null;
    let controlRefs = null;
    let renderedFrame = null;
    let limitationsNode = null;

    const endpoint = params => `./api/market-field?${new URLSearchParams(params).toString()}`;
    const formatCount = value => Number(value || 0).toLocaleString();

    async function requestJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error(`The server returned invalid JSON (HTTP ${response.status}).`); }
      if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
      return payload;
    }

    function currentTimeline() {
      return (timeline?.frames || []).filter(item => item.source === state.temporalSource)
        .sort((left, right) => left.year - right.year);
    }

    function selectedFrameKey() {
      return JSON.stringify([timeline?.build_id, state.temporalSource, Number(state.temporalYear),
        state.temporalMode, state.temporalCompareYear, state.temporalCategory, state.temporalQuery,
        state.temporalCandidate, state.temporalNeighbor, state.temporalOffset,
        state.temporalNodeLimit, state.temporalEdgeLimit]);
    }

    function loadTimeline() {
      if (timeline || timelineRequest) return;
      const requestId = ++timelineRequest;
      requestJson(endpoint({ mode: 'timeline' })).then(result => {
        if (requestId !== timelineRequest) return;
        if (result.schema_version !== '1.0' || !result.build_id || !Array.isArray(result.frames)) {
          throw new Error('The temporal inventory is incomplete.');
        }
        timeline = result;
        timelineError = null;
        render();
      }).catch(error => {
        if (requestId !== timelineRequest) return;
        timelineError = error.message;
        render();
      });
    }

    function frameParams() {
      const params = { mode: 'frame', build_id: timeline.build_id,
        source: state.temporalSource, year: String(state.temporalYear),
        temporal_mode: state.temporalMode, category: state.temporalCategory || 'all',
        query: state.temporalQuery || '' };
      params.offset = String(state.temporalOffset || 0);
      params.limit = '60';
      if (!state.temporalCandidate) {
        if (state.temporalNodeLimit !== 'all') params.node_limit = state.temporalNodeLimit || '150';
        params.edge_limit = state.temporalEdgeLimit || '500';
      }
      if (state.temporalCompareYear && state.temporalCompareYear !== 'auto') {
        params.compare_year = state.temporalCompareYear;
      }
      if (state.temporalCandidate) params.candidate = state.temporalCandidate;
      if (state.temporalCandidate && state.temporalNeighbor) params.neighbor = state.temporalNeighbor;
      return params;
    }

    function loadFrame() {
      if (!timeline) return;
      const key = selectedFrameKey();
      if (frameKey !== key) {
        frameKey = key;
        frameError = null;
        frameLoading = false;
        frameRequest += 1;
        if (frameCache.has(key)) {
          frame = frameCache.get(key);
          displayedKey = key;
        }
      }
      if (frameLoading || displayedKey === key || frameError) return;
      const requestId = ++frameRequest;
      frameLoading = true;
      requestJson(endpoint(frameParams())).then(result => {
        if (requestId !== frameRequest || selectedFrameKey() !== key) return;
        if (result.build_id !== timeline.build_id) {
          timeline = null;
          frame = null;
          displayedKey = '';
          frameCache.clear();
          frameKey = '';
          frameLoading = false;
          timelineRequest = 0;
          frameRequest += 1;
          loadTimeline();
          render();
          return;
        }
        frame = result;
        displayedKey = key;
        frameCache.delete(key);
        frameCache.set(key, result);
        if (frameCache.size > 3) frameCache.delete(frameCache.keys().next().value);
        frameLoading = false;
        frameError = null;
        render();
      }).catch(error => {
        if (requestId !== frameRequest || selectedFrameKey() !== key) return;
        frameLoading = false;
        frameError = error.message;
        render();
      });
    }

    function change(changes, options = {}) {
      commitState(changes, { replace: true, updateTemporalView: true, ...options });
    }

    function stopPlayback() {
      if (playTimer !== null) globalScope.clearInterval(playTimer);
      playTimer = null;
    }

    function navigateStep(amount) {
      const frames = currentTimeline();
      const index = frames.findIndex(item => item.year === Number(state.temporalYear));
      const next = frames[index + amount];
      if (!next) return;
      change({ temporalYear: String(next.year), temporalOffset: 0 });
    }

    function controls() {
      const section = node('section', '', 'temporal-controls');
      const head = append(node('div', '', 'temporal-controls-head'),
        node('p', 'INVENTORY OBSERVATION / YEAR PRECISION', 'eyebrow'),
        node('p', 'A stop is a retained source revision. The year is not a capture timestamp.', 'muted'));
      const stopDetail = node('div', '', 'temporal-stop-detail');
      head.append(stopDetail);
      const source = node('select');
      source.setAttribute('aria-label', 'Inventory provider');
      [['lfai', 'LF AI landscape'], ['cncf', 'CNCF landscape']]
        .forEach(([value, label]) => source.add(new Option(label, value)));
      source.addEventListener('change', () => {
        if (!timeline) return;
        const sourceFrames = timeline.frames.filter(item => item.source === source.value);
        const preferred = sourceFrames.find(item => item.year === Number(state.temporalYear))
          || sourceFrames.filter(item => item.coverage_status === 'dated_inventory_snapshot').at(-1)
          || sourceFrames.at(-1);
        change({ temporalSource: source.value, temporalYear: String(preferred.year),
          temporalCandidate: null, temporalNeighbor: null, temporalOffset: 0 });
      });
      const mode = node('select');
      mode.setAttribute('aria-label', 'Temporal evidence meaning');
      mode.add(new Option('snapshot · selected source slice', 'snapshot'));
      mode.add(new Option('accumulated · observed through this year', 'accumulated'));
      mode.addEventListener('change', () => change({ temporalMode: mode.value, temporalOffset: 0 }));
      const compare = node('select');
      compare.setAttribute('aria-label', 'Comparable inventory stop');
      compare.addEventListener('change', () => change({ temporalCompareYear: compare.value,
        temporalOffset: 0 }));
      const category = node('select');
      category.setAttribute('aria-label', 'Exact source category filter');
      category.addEventListener('change', () => change({ temporalCategory: category.value,
        temporalOffset: 0 }));
      const form = append(node('div', '', 'temporal-facets'), source, mode, compare, category);
      const density = node('fieldset', '', 'temporal-density');
      density.append(node('legend', 'overview top-k'));
      const densityInputs = node('div', '', 'temporal-density-inputs');
      function densitySelect(label, key, values, fallback) {
        const wrapper = node('label');
        const select = node('select');
        select.setAttribute('aria-label', label);
        for (const value of values) select.add(new Option(value === 'all' ? 'all nodes'
          : `${Number(value).toLocaleString()}${value === fallback ? ' · medium' : ''}`, value));
        select.addEventListener('change', () => change({ [key]: select.value, temporalOffset: 0 }));
        wrapper.append(node('span', label), select);
        densityInputs.append(wrapper);
        return select;
      }
      const nodeLimit = densitySelect('top-k nodes', 'temporalNodeLimit', ['50', '100', '150', '300', 'all'], '150');
      const edgeLimit = densitySelect('top-k connections', 'temporalEdgeLimit', ['100', '250', '500', '1000', '2500'], '500');
      const resetDensity = node('button', 'reset density', 'quiet-button');
      resetDensity.type = 'button';
      resetDensity.addEventListener('click', () => change({ temporalNodeLimit: '150', temporalEdgeLimit: '500', temporalOffset: 0 }));
      densityInputs.append(resetDensity);
      density.append(densityInputs, node('p', 'nodes: most peer connections · connections: most shared placements. display order, not evidence strength.', 'temporal-density-note'));
      const yearControl = node('input');
      yearControl.type = 'range';
      yearControl.step = '1';
      yearControl.setAttribute('aria-label', 'Scrub retained inventory year');
      yearControl.addEventListener('input', () => {
        const target = currentTimeline()[Number(yearControl.value)];
        if (target) change({ temporalYear: String(target.year), temporalOffset: 0 });
      });
      yearControl.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); navigateStep(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); navigateStep(1); }
      });
      const previous = node('button', '← previous', 'temporal-step');
      previous.type = 'button';
      previous.addEventListener('click', () => navigateStep(-1));
      const next = node('button', 'next →', 'temporal-step');
      next.type = 'button';
      next.addEventListener('click', () => navigateStep(1));
      const playback = node('button', 'play frames', 'temporal-play');
      playback.type = 'button';
      playback.addEventListener('click', () => {
        if (playTimer !== null) {
          stopPlayback();
          syncControls();
          return;
        }
        if (globalScope.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          navigateStep(1);
          return;
        }
        playTimer = globalScope.setInterval(() => {
          const frames = currentTimeline();
          const index = frames.findIndex(item => item.year === Number(state.temporalYear));
          if (index < 0 || index === frames.length - 1) {
            stopPlayback();
            syncControls();
            return;
          }
          navigateStep(1);
        }, 1250);
        syncControls();
      });
      const rail = append(node('div', '', 'temporal-rail'), previous, yearControl,
        playback, next);
      const partialNote = node('p', '2026 is a partial-year inventory. Its counts do not cover a complete calendar year.', 'temporal-coverage-note');
      section.append(head, form, density, rail, partialNote);
      return { section, stopDetail, source, mode, compare, category, density, nodeLimit, edgeLimit, yearControl,
        previous, next, playback, partialNote, compareOptionsKey: '', categoryOptionsKey: '' };
    }

    function syncControls() {
      const { stopDetail, source, mode, compare, category, yearControl,
        previous, next, playback, partialNote } = controlRefs;
      const frameStops = currentTimeline();
      const selectedIndex = frameStops.findIndex(item => item.year === Number(state.temporalYear));
      controlRefs.density.hidden = Boolean(state.temporalCandidate);
      controlRefs.nodeLimit.value = state.temporalNodeLimit || '150';
      controlRefs.edgeLimit.value = state.temporalEdgeLimit || '500';
      source.value = state.temporalSource;
      mode.value = state.temporalMode;
      const compareOptionsKey = JSON.stringify([state.temporalSource, state.temporalYear,
        frameStops.map(item => [item.year, item.coverage_status])]);
      if (controlRefs.compareOptionsKey !== compareOptionsKey) {
        compare.replaceChildren(new Option('previous retained stop', 'auto'),
          new Option('no comparison', 'none'));
        frameStops.filter(item => item.year < Number(state.temporalYear)).forEach(item =>
          compare.add(new Option(`${item.year} · ${item.coverage_status.replaceAll('_', ' ')}`,
            String(item.year))));
        controlRefs.compareOptionsKey = compareOptionsKey;
      }
      compare.value = state.temporalCompareYear || 'auto';
      const categories = frame?.available_categories || [];
      const categoryOptionsKey = JSON.stringify(categories);
      if (controlRefs.categoryOptionsKey !== categoryOptionsKey) {
        category.replaceChildren(new Option('all exact categories', 'all'));
        categories.forEach(value => category.add(new Option(value, value)));
        controlRefs.categoryOptionsKey = categoryOptionsKey;
      }
      category.value = categories.includes(state.temporalCategory) ? state.temporalCategory : 'all';
      yearControl.min = '0';
      yearControl.max = String(Math.max(0, frameStops.length - 1));
      yearControl.disabled = selectedIndex < 0;
      const yearValue = String(Math.max(0, selectedIndex));
      if (yearControl.value !== yearValue) yearControl.value = yearValue;
      previous.disabled = selectedIndex <= 0;
      next.disabled = selectedIndex >= frameStops.length - 1;
      playback.textContent = playTimer === null ? 'play frames' : 'pause';
      playback.setAttribute('aria-pressed', String(playTimer !== null));
      const currentArtifact = frameStops.find(item => item.year === Number(state.temporalYear));
      if (currentArtifact) {
        const label = displayedKey === frameKey ? '' : 'requested · ';
        const commitTime = node('time', `source revision committed ${currentArtifact.commit_at}`);
        commitTime.dateTime = currentArtifact.commit_at;
        commitTime.title = currentArtifact.commit_at;
        stopDetail.replaceChildren(
          node('strong', `${label}${currentArtifact.source.toUpperCase()} · ${currentArtifact.year}`),
          node('span', currentArtifact.coverage_status.replaceAll('_', ' ')), commitTime);
      } else {
        stopDetail.replaceChildren(node('span', `No retained ${state.temporalSource.toUpperCase()} snapshot exists for ${state.temporalYear}. Step to a retained stop to continue.`, 'temporal-coverage-note'));
      }
      partialNote.hidden = !frameStops.some(item => item.coverage_status === 'partial_year_snapshot');
    }

    function candidateSearch() {
      const section = node('section', '', 'temporal-search');
      const form = node('form', '', 'temporal-search-form');
      const input = node('input');
      input.type = 'search';
      input.value = queryDraft;
      input.placeholder = 'search names in this source slice';
      input.setAttribute('aria-label', 'Search names in selected source slice');
      input.addEventListener('input', () => { queryDraft = input.value.slice(0, 200); });
      const submit = node('button', 'find', 'temporal-search-submit');
      submit.type = 'submit';
      form.addEventListener('submit', event => {
        event.preventDefault();
        change({ temporalQuery: queryDraft, temporalCandidate: null, temporalNeighbor: null,
          temporalOffset: 0 });
      });
      form.append(input, submit);
      section.append(node('p', 'FIND A CANDIDATE IN THIS SOURCE SLICE', 'eyebrow'), form);
      if (frame?.suggestions?.length) {
        const suggestions = node('div', '', 'temporal-suggestions');
        frame.suggestions.forEach(candidate => {
          const button = node('button', candidate.name, 'temporal-suggestion');
          button.type = 'button';
          button.setAttribute('aria-pressed', String(state.temporalCandidate === candidate.id));
          button.addEventListener('click', () => change({ temporalCandidate: candidate.id,
            temporalNeighbor: null, temporalOffset: 0 }, { focus: '#temporal-inspector' }));
          suggestions.append(button);
        });
        section.append(suggestions);
      } else if (frame?.candidate_count === 0) {
        section.append(node('p', 'No candidate names match in this selected source slice.', 'muted'));
      }
      return section;
    }

    function statusLabel(status) {
      return ({ newly_observed_in_selected_frame: 'new vs comparison',
        not_observed_in_either_frame: 'not observed in either frame',
        observed_without_comparison: 'observed · no comparison',
        absent_from_selected_frame: 'absent from this slice', observed_in_both: 'observed in both frames',
        filtered_out_current: 'filtered out of selected frame', filtered_out_previous: 'filtered out of comparison' })[status]
        || status.replaceAll('_', ' ');
    }

    function changeLedger() {
      const section = node('section', '', 'temporal-ledger');
      section.append(node('p', 'WHAT CHANGED AROUND THIS CANDIDATE', 'eyebrow'));
      if (!frame?.changes?.length) {
        section.append(node('p', !frame?.focus
          ? 'Choose a point in the field to inspect its retained neighbors.'
          : frame?.focus_present === false
          ? 'This candidate has no row in the selected source slice.'
          : 'No exact shared source-category placement is in this neighborhood.', 'muted'));
        return section;
      }
      const labelById = new Map((frame.nodes || []).map(candidate => [candidate.id, candidate.name]));
      frame.changes.slice(0, 60).forEach(change => {
        const label = labelById.get(change.candidate_id) || `candidate ${change.candidate_id.slice(0, 8)}`;
        const button = node('button', '', 'temporal-change');
        button.type = 'button';
        button.dataset.status = change.status;
        button.append(node('strong', label), node('span', statusLabel(change.status)),
          node('small', `${change.current_placements.length} current · ${change.comparison_placements.length} comparison placements`));
        button.setAttribute('aria-pressed', String(state.temporalNeighbor === change.candidate_id));
        button.addEventListener('click', () => changeStateNeighbor(change.candidate_id));
        section.append(button);
      });
      if (frame.total_neighbors > frame.edges.length) section.append(node('p',
        `Showing ${formatCount(frame.changes.length)} neighbor records of ${formatCount(frame.total_neighbors)}; some comparison rows have no selected-slice edge.`, 'muted'));
      if (frame.next_offset !== null || frame.offset > 0) {
        const paging = node('div', '', 'temporal-ledger-paging');
        if (frame.offset > 0) {
          const previous = node('button', 'previous 60', 'temporal-page-button');
          previous.type = 'button';
          previous.addEventListener('click', () => change({ temporalOffset: Math.max(0, frame.offset - frame.limit),
            temporalNeighbor: null }));
          paging.append(previous);
        }
        if (frame.next_offset !== null) {
          const next = node('button', 'next 60', 'temporal-page-button');
          next.type = 'button';
          next.addEventListener('click', () => change({ temporalOffset: frame.next_offset,
            temporalNeighbor: null }));
          paging.append(next);
        }
        section.append(paging);
      }
      return section;
    }

    function rowButton(row, label) {
      const button = node('button', label, 'temporal-row-link');
      button.type = 'button';
      button.addEventListener('click', () => openRecord(row.id));
      return button;
    }

    function placementCard(placement, focusName, neighborName) {
      const card = node('article', '', 'temporal-evidence-card');
      card.append(node('p', `${placement.source.toUpperCase()} ${placement.year} · ${placement.source_category}`, 'eyebrow'),
        node('p', `Both retained rows are in the exact same provider, year, and category. This is an inventory co-listing, not a reviewed business relationship.`, 'muted'));
      const artifactLink = node('a', 'open pinned source revision ↗');
      artifactLink.href = placement.source_url;
      artifactLink.target = '_blank';
      artifactLink.rel = 'noopener noreferrer';
      card.append(artifactLink,
        node('small', `commit ${placement.source_commit} · committed ${placement.source_committed_at}`),
        node('small', `artifact SHA-256 ${placement.artifact_sha256}`));
      placement.subject_rows.forEach(row => card.append(rowButton(row, `${focusName}: ${row.name} · inspect retained row`)));
      placement.object_rows.forEach(row => card.append(rowButton(row, `${neighborName}: ${row.name} · inspect retained row`)));
      return card;
    }

    function inspector() {
      const panel = node('aside', '', 'temporal-inspector');
      panel.id = 'temporal-inspector';
      panel.tabIndex = -1;
      panel.append(node('p', 'WHY DOES THIS EDGE EXIST IN THIS MOMENT?', 'eyebrow'));
      if (!frame?.detail) {
        panel.append(node('h3', state.temporalNeighbor ? 'Loading retained edge evidence…'
          : frame?.focus ? (frame.nodes.find(candidate => candidate.id === frame.focus)?.name || 'Inspect an edge')
            : 'Choose a candidate'),
        node('p', state.temporalNeighbor
          ? 'The graph and inspector are loading one committed frame together.'
          : 'Select a connected edge or a change entry to inspect the two retained rows and why the edge is visible.', 'muted'));
        return panel;
      }
      const detail = frame.detail;
      const explanations = {
        newly_observed_in_selected_frame: 'This exact pair appears in the selected evidence and has no matching placement in the comparison. This marks an observation difference, not a project start.',
        absent_from_selected_frame: 'The comparison contains a matching placement, but the selected source slice does not. This does not show that a project or relationship ended.',
        observed_in_both: 'Both selected and comparison evidence include an exact placement for this pair.',
        observed_without_comparison: 'The selected evidence contains this pair. No comparison is selected, so this view does not classify an addition or an absence.',
        not_observed_in_either_frame: 'The retained selection has no matching placement in either frame. Its identifier stays selected so you can continue through time; there is no edge to draw here.',
        filtered_out_current: 'A matching placement exists in the selected evidence, but the active category filter hides it. Retained support is shown below; this is not an observed removal.',
        filtered_out_previous: 'A matching placement exists in the comparison evidence, but the active category filter hides it. Retained support is shown below; this is not an observed addition.'
      };
      panel.append(node('h3', `${detail.focus.name} · ${detail.neighbor.name}`),
        node('p', statusLabel(detail.status), 'temporal-status-label'),
        node('p', explanations[detail.status] || 'Inspect the retained placements below.', 'muted'));
      panel.append(node('h4', `Selected evidence · ${detail.selected_placements.length}`, 'section-title'));
      detail.selected_placements.forEach(placement => panel.append(
        placementCard(placement, detail.focus.name, detail.neighbor.name)));
      if (detail.comparison_placements.length) {
        panel.append(node('h4', `Comparison evidence · ${detail.comparison_placements.length}`, 'section-title'));
        detail.comparison_placements.forEach(placement => panel.append(
          placementCard(placement, detail.focus.name, detail.neighbor.name)));
      } else panel.append(node('p', frame.compare_year == null
        ? 'No comparison is selected for this frame.'
        : 'No exact matching placement appears in the comparison evidence.', 'muted'));
      panel.append(node('p', 'Inventory year is the active clock. Source commit time is shown separately. Source publication, event time, ingestion time, and review time are unavailable here. Names and candidate groupings remain unresolved leads.', 'caveat'));
      return panel;
    }

    function changeStateNeighbor(candidateId) {
      change({ temporalNeighbor: candidateId }, { focus: '#temporal-inspector' });
    }

    function graphPanel() {
      const section = node('section', '', 'temporal-graph-panel');
      section.append(append(node('div', '', 'temporal-graph-heading'),
        node('p', 'RETAINED SOURCE TOPOLOGY', 'eyebrow'),
        node('span', frame?.frame_id ? `frame ${frame.frame_id.slice(0, 12)}` : '', 'temporal-frame-id')));
      const options = { selectedEdge: state.temporalNeighbor,
        onSelectEdge: changeStateNeighbor,
        onSelectCandidate: candidateId => change({ temporalCandidate: candidateId,
          temporalNeighbor: null, temporalOffset: 0 }, { focus: '#temporal-inspector' }) };
      const rendered = globalScope.LogPoseTemporalGraph?.render
        ? globalScope.LogPoseTemporalGraph.render(frame, options) : fallbackGraph(frame, options);
      section.append(rendered);
      return section;
    }

    function fallbackGraph(result, options) {
      const list = node('div', '', 'temporal-graph-fallback');
      for (const candidate of result.nodes || []) {
        if (candidate.id === result.focus) continue;
        const button = node('button', candidate.name, 'temporal-fallback-edge');
        button.type = 'button';
        button.addEventListener('click', () => result.focus
          ? options.onSelectEdge(candidate.id) : options.onSelectCandidate(candidate.id));
        list.append(button);
      }
      return list;
    }

    function missingFrame() {
      const section = node('section', '', 'temporal-missing');
      section.append(node('p', 'MISSING RETAINED SOURCE STOP', 'eyebrow'),
        node('h3', `${state.temporalSource.toUpperCase()} · ${state.temporalYear}`),
        node('p', frame?.coverage?.explanation || 'No retained inventory artifact exists at this year.'),
        node('p', 'This is a coverage gap. It does not show that any candidate or relationship ended.', 'caveat'));
      return section;
    }

    function updateTransitionStatus() {
      const requested = `${state.temporalSource.toUpperCase()} ${state.temporalYear}`;
      const displayed = frame ? `${frame.source.toUpperCase()} ${frame.year}` : null;
      transitionStatus.replaceChildren();
      if (!timeline) {
        transitionStatus.dataset.state = timelineError ? 'error' : 'loading';
        transitionStatus.append(node('span', timelineError
          ? `The temporal inventory is unavailable: ${timelineError}`
          : 'Loading retained inventory stops…'));
        if (timelineError) {
          const retry = node('button', 'retry temporal inventory', 'quiet-button');
          retry.type = 'button';
          retry.addEventListener('click', () => {
            timelineError = null;
            timelineRequest = 0;
            render();
          });
          transitionStatus.append(retry);
        }
      } else if (frameError) {
        transitionStatus.dataset.state = 'error';
        transitionStatus.append(node('span', `Could not load ${requested}: ${frameError}`
          + (displayed ? `. Showing ${displayed}.` : '.')));
        const retry = node('button', 'retry selected frame', 'quiet-button');
        retry.type = 'button';
        retry.addEventListener('click', () => { frameError = null; render(); });
        transitionStatus.append(retry);
      } else if (frameLoading || displayedKey !== frameKey) {
        transitionStatus.dataset.state = displayed ? 'pending' : 'loading';
        transitionStatus.append(node('span', `Loading ${requested}`
          + (displayed ? ` · showing ${displayed} until the requested frame is ready.` : '…')));
      } else {
        transitionStatus.dataset.state = frame?.status === 'missing_snapshot' ? 'missing' : 'ready';
        transitionStatus.append(node('span', frame?.status === 'missing_snapshot'
          ? `${requested} has no retained source stop.` : `Showing ${requested}.`));
      }
    }

    function renderFrameContent() {
      if (!frame) {
        renderedFrame = null;
        limitationsNode?.remove();
        limitationsNode = null;
        frameContent.replaceChildren(node('p', frameError
          ? 'No frame is displayed. Retry to load retained evidence.'
          : 'Loading the selected frame…', 'temporal-loading'));
        return;
      }
      if (renderedFrame === frame && frameContent.hasChildNodes()) return;
      renderedFrame = frame;
      limitationsNode?.remove();
      limitationsNode = null;
      if (frame.status === 'missing_snapshot') {
        frameContent.replaceChildren(missingFrame());
        return;
      }
      const graphConnections = frame.focus
        ? `${formatCount(frame.total_neighbors)} exact neighbors`
        : `${formatCount(frame.context_edge_count)} of ${formatCount(frame.total_context_edges)} peer connections shown`;
      const coverage = append(node('section', '', 'temporal-frame-summary'),
        node('span', `${formatCount(frame.coverage.selected_rows)} retained rows`, 'temporal-count'),
        ...(!frame.focus ? [node('span', `${formatCount(frame.nodes.length)} of ${formatCount(frame.candidate_count)} nodes shown`, 'temporal-count')] : []),
        node('span', graphConnections, 'temporal-count'),
        node('span', frame.temporal_mode === 'snapshot'
          ? `compared with ${frame.compare_year || 'no prior retained stop'}`
          : `observed through ${frame.year}; persistence means previously observed`, 'temporal-count'));
      const workspace = node('section', '', 'temporal-workspace');
      const main = node('div', '', 'temporal-main');
      main.append(coverage, graphPanel());
      const sidebar = node('aside', '', 'temporal-sidebar');
      sidebar.append(candidateSearch(), changeLedger(), inspector());
      workspace.append(main, sidebar);
      frameContent.replaceChildren(workspace);
      if (frame.limitations?.length) {
        const disclosure = node('details', '', 'temporal-limitations');
        disclosure.append(node('summary', 'Clock and interpretation limits'));
        frame.limitations.forEach(item => disclosure.append(node('p', item)));
        surface.append(disclosure);
        limitationsNode = disclosure;
      }
    }

    function render() {
      if (!active) return;
      if (!surface) {
        surface = node('div', '', 'temporal-view-state');
        frameContent = node('div', '', 'temporal-frame-content');
        transitionStatus = node('div', '', 'temporal-transition-status');
        transitionStatus.setAttribute('role', 'status');
        surface.append(frameContent, transitionStatus);
      }
      if (surface.parentNode !== root) root.append(surface);
      if (!timeline) {
        if (controlRefs) controlRefs.section.hidden = true;
        if (!timelineError) loadTimeline();
      } else {
        loadFrame();
        if (!controlRefs) {
          controlRefs = controls();
          surface.insertBefore(controlRefs.section, transitionStatus);
        }
        controlRefs.section.hidden = false;
        syncControls();
      }
      updateTransitionStatus();
      renderFrameContent();
      root.setAttribute('aria-busy', String((!timeline && !timelineError)
        || (frameLoading && !frame)));
    }

    function activate() {
      const nextQuery = state.temporalQuery || '';
      if (nextQuery !== committedQuery) {
        committedQuery = nextQuery;
        queryDraft = nextQuery;
      }
      active = true;
      render();
    }

    function dispose() {
      active = false;
      stopPlayback();
    }
    return { activate, dispose };
  }

  globalScope.LogPoseTemporalTopologyView = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
