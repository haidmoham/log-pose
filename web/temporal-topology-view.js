(function exposeTemporalTopologyView(globalScope) {
  'use strict';

  function create({ root, state, commitState, openRecord }) {
    const { node, append } = globalScope.LogPoseUI;
    const fallbackNode = (tag, text, className) => node(tag, text, className);
    let timeline = null;
    let timelineError = null;
    let frame = null;
    let frameError = null;
    let timelineRequest = 0;
    let frameRequest = 0;
    let frameKey = '';
    let frameLoading = false;
    let playTimer = null;

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
        state.temporalCandidate, state.temporalNeighbor]);
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
      if (state.temporalCompareYear && state.temporalCompareYear !== 'auto') {
        params.compare_year = state.temporalCompareYear;
      }
      if (state.temporalCandidate) params.candidate = state.temporalCandidate;
      if (state.temporalNeighbor) params.neighbor = state.temporalNeighbor;
      return params;
    }

    function loadFrame() {
      if (!timeline) return;
      const key = selectedFrameKey();
      if (frameKey !== key) {
        frameKey = key;
        frame = null;
        frameError = null;
        frameLoading = false;
        frameRequest += 1;
      }
      if (frameLoading || frame || frameError) return;
      const requestId = ++frameRequest;
      frameLoading = true;
      root.setAttribute('aria-busy', 'true');
      requestJson(endpoint(frameParams())).then(result => {
        if (requestId !== frameRequest || selectedFrameKey() !== key) return;
        if (result.build_id !== timeline.build_id) {
          timeline = null;
          frameKey = '';
          timelineRequest = 0;
          frameRequest += 1;
          loadTimeline();
          return;
        }
        frame = result;
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
      commitState(changes, { replace: true, ...options });
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
      change({ temporalYear: String(next.year), temporalNeighbor: null });
    }

    function playbackButton() {
      const button = node('button', playTimer === null ? 'play frames' : 'pause', 'temporal-play');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(playTimer !== null));
      button.addEventListener('click', () => {
        if (playTimer !== null) {
          stopPlayback();
          render();
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
            render();
            return;
          }
          navigateStep(1);
        }, 1250);
        render();
      });
      return button;
    }

    function controls() {
      const section = node('section', '', 'temporal-controls');
      const head = append(node('div', '', 'temporal-controls-head'),
        node('p', 'INVENTORY OBSERVATION / YEAR PRECISION', 'eyebrow'),
        node('p', 'A stop is a retained source revision. The year is not a capture timestamp.', 'muted'));
      const source = node('select');
      source.setAttribute('aria-label', 'Inventory provider');
      [['lfai', 'LF AI landscape'], ['cncf', 'CNCF landscape']]
        .forEach(([value, label]) => source.add(new Option(label, value)));
      source.value = state.temporalSource;
      source.addEventListener('change', () => {
        const available = currentTimeline().map(item => item.year);
        const sourceFrames = timeline.frames.filter(item => item.source === source.value);
        const preferred = sourceFrames.find(item => item.year === Number(state.temporalYear))
          || sourceFrames.filter(item => item.coverage_status === 'dated_inventory_snapshot').at(-1)
          || sourceFrames.at(-1);
        change({ temporalSource: source.value, temporalYear: String(preferred.year),
          temporalCandidate: null, temporalNeighbor: null });
      });
      const mode = node('select');
      mode.setAttribute('aria-label', 'Temporal evidence meaning');
      mode.add(new Option('snapshot · selected source slice', 'snapshot'));
      mode.add(new Option('accumulated · observed through this year', 'accumulated'));
      mode.value = state.temporalMode;
      mode.addEventListener('change', () => change({ temporalMode: mode.value,
        temporalNeighbor: null }));
      const category = node('select');
      category.setAttribute('aria-label', 'Exact source category filter');
      category.add(new Option('all exact categories', 'all'));
      const categories = [...new Set((frame?.nodes || []).flatMap(candidate =>
        candidate.observations.map(item => item.source_category)))].sort();
      categories.forEach(value => category.add(new Option(value, value)));
      category.value = categories.includes(state.temporalCategory) ? state.temporalCategory : 'all';
      category.addEventListener('change', () => change({ temporalCategory: category.value,
        temporalNeighbor: null }));
      const form = append(node('div', '', 'temporal-facets'), source, mode, category);
      const frameStops = currentTimeline();
      const selectedIndex = frameStops.findIndex(item => item.year === Number(state.temporalYear));
      const yearControl = node('input');
      yearControl.type = 'range';
      yearControl.min = '0';
      yearControl.max = String(Math.max(0, frameStops.length - 1));
      yearControl.step = '1';
      yearControl.value = String(Math.max(0, selectedIndex));
      yearControl.setAttribute('aria-label', 'Scrub retained inventory year');
      yearControl.addEventListener('input', () => {
        const target = frameStops[Number(yearControl.value)];
        if (target) change({ temporalYear: String(target.year), temporalNeighbor: null });
      });
      yearControl.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); navigateStep(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); navigateStep(1); }
      });
      const previous = node('button', '← previous', 'temporal-step');
      previous.type = 'button';
      previous.disabled = selectedIndex <= 0;
      previous.addEventListener('click', () => navigateStep(-1));
      const next = node('button', 'next →', 'temporal-step');
      next.type = 'button';
      next.disabled = selectedIndex < 0 || selectedIndex >= frameStops.length - 1;
      next.addEventListener('click', () => navigateStep(1));
      const rail = append(node('div', '', 'temporal-rail'), previous, yearControl,
        playbackButton(), next);
      const currentArtifact = frameStops.find(item => item.year === Number(state.temporalYear));
      if (currentArtifact) {
        const selected = append(node('div', '', 'temporal-stop-detail'),
          node('strong', `${currentArtifact.source.toUpperCase()} · ${currentArtifact.year}`),
          node('span', currentArtifact.coverage_status.replaceAll('_', ' ')),
          node('time', `source revision committed ${currentArtifact.commit_at}`));
        selected.lastChild.dateTime = currentArtifact.commit_at;
        if (selected.lastChild.textContent) selected.lastChild.title = currentArtifact.commit_at;
        head.append(selected);
      }
      section.append(head, form, rail);
      if (frameStops.some(item => item.coverage_status === 'partial_year_snapshot')) {
        section.append(node('p', '2026 is a partial-year inventory. Its counts do not cover a complete calendar year.', 'temporal-coverage-note'));
      }
      return section;
    }

    function candidateSearch() {
      const section = node('section', '', 'temporal-search');
      const input = node('input');
      input.type = 'search';
      input.value = state.temporalQuery || '';
      input.placeholder = 'search names in this source slice';
      input.setAttribute('aria-label', 'Search names in selected source slice');
      input.addEventListener('input', () => change({ temporalQuery: input.value.slice(0, 200),
        temporalCandidate: null, temporalNeighbor: null }));
      section.append(node('p', 'FIND A CANDIDATE IN THIS SOURCE SLICE', 'eyebrow'), input);
      if (frame?.suggestions?.length) {
        const suggestions = node('div', '', 'temporal-suggestions');
        frame.suggestions.forEach(candidate => {
          const button = node('button', candidate.name, 'temporal-suggestion');
          button.type = 'button';
          button.setAttribute('aria-pressed', String(state.temporalCandidate === candidate.id));
          button.addEventListener('click', () => change({ temporalCandidate: candidate.id,
            temporalNeighbor: null }, { focus: '#temporal-inspector' }));
          suggestions.append(button);
        });
        section.append(suggestions);
      } else if (frame?.candidate_count === 0) {
        section.append(node('p', 'No candidate names match in this selected source slice.', 'muted'));
      }
      return section;
    }

    function statusLabel(status) {
      return ({ newly_observed_in_selected_frame: 'first observed in this slice',
        absent_from_selected_frame: 'absent from this slice', observed_in_both: 'observed in both frames',
        filtered_out_current: 'filtered out of selected frame', filtered_out_previous: 'filtered out of comparison' })[status]
        || status.replaceAll('_', ' ');
    }

    function changeLedger() {
      const section = node('section', '', 'temporal-ledger');
      section.append(node('p', 'WHAT CHANGED AROUND THIS CANDIDATE', 'eyebrow'));
      if (!frame?.changes?.length) {
        section.append(node('p', frame?.focus_present === false
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
        `Showing ${formatCount(frame.edges.length)} of ${formatCount(frame.total_neighbors)} exact neighbors.`, 'muted'));
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
      const change = frame.changes.find(item => item.candidate_id === state.temporalNeighbor);
      panel.append(node('h3', `${detail.focus.name} · ${detail.neighbor.name}`),
        node('p', statusLabel(detail.status), 'temporal-status-label'),
        node('p', detail.status === 'newly_observed_in_selected_frame'
          ? `This exact pair appears in ${state.temporalSource.toUpperCase()} ${state.temporalYear}; the comparison snapshot does not contain the same placement.`
          : detail.status === 'absent_from_selected_frame'
            ? `The comparison contains a matching placement, but the selected source slice does not. This does not show that a project or relationship ended.`
            : 'Both selected and comparison evidence include an exact placement for this pair.', 'muted'));
      if (change?.current_unfiltered_placements?.length && !detail.selected_placements.length) {
        panel.append(node('p', 'A matching placement exists here but the active category filter hides it.', 'temporal-coverage-note'));
      }
      panel.append(node('h4', `Selected evidence · ${detail.selected_placements.length}`, 'section-title'));
      detail.selected_placements.forEach(placement => panel.append(
        placementCard(placement, detail.focus.name, detail.neighbor.name)));
      if (detail.comparison_placements.length) {
        panel.append(node('h4', `Comparison evidence · ${detail.comparison_placements.length}`, 'section-title'));
        detail.comparison_placements.forEach(placement => panel.append(
          placementCard(placement, detail.focus.name, detail.neighbor.name)));
      } else panel.append(node('p', 'No exact matching placement appears in the comparison snapshot.', 'muted'));
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
      if (!frame?.focus) {
        section.append(node('p', 'Choose a candidate above to open its observed neighborhood.', 'temporal-graph-empty'));
        return section;
      }
      const options = { selectedEdge: state.temporalNeighbor,
        onSelectEdge: changeStateNeighbor,
        onSelectCandidate: candidateId => change({ temporalCandidate: candidateId,
          temporalNeighbor: null }, { focus: '#temporal-inspector' }) };
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
        button.addEventListener('click', () => options.onSelectEdge(candidate.id));
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

    function render() {
      root.replaceChildren();
      root.setAttribute('aria-busy', String(frameLoading || (!timeline && !timelineError)));
      if (!timeline) {
        if (timelineError) {
          const retry = node('button', 'retry temporal inventory', 'quiet-button');
          retry.type = 'button';
          retry.addEventListener('click', () => {
            timelineError = null;
            timelineRequest = 0;
            loadTimeline();
          });
          root.append(node('p', `The temporal inventory is unavailable: ${timelineError}`, 'error'), retry);
        } else {
          root.append(node('p', 'Loading retained inventory stops…', 'loading'));
          loadTimeline();
        }
        return;
      }
      loadFrame();
      root.append(controls(), candidateSearch());
      if (frameLoading || (!frame && !frameError)) {
        root.append(node('p', `${state.temporalSource.toUpperCase()} ${state.temporalYear} · loading the selected frame…`, 'loading temporal-loading'));
        return;
      }
      if (frameError) {
        const retry = node('button', 'retry selected frame', 'quiet-button');
        retry.type = 'button';
        retry.addEventListener('click', () => { frameError = null; frame = null; render(); });
        root.append(node('p', `This frame failed to load: ${frameError}`, 'error'), retry);
        return;
      }
      if (frame.status === 'missing_snapshot') {
        root.append(missingFrame());
        return;
      }
      if (!frame.focus) {
        root.append(node('p', `${formatCount(frame.candidate_count)} candidate names match this selected source slice. Select one above to inspect its neighborhood.`, 'muted'));
        return;
      }
      const coverage = append(node('section', '', 'temporal-frame-summary'),
        node('span', `${formatCount(frame.coverage.selected_rows)} retained rows`, 'temporal-count'),
        node('span', `${formatCount(frame.total_neighbors)} exact neighbors`, 'temporal-count'),
        node('span', frame.temporal_mode === 'snapshot'
          ? `compared with ${frame.compare_year || 'no prior retained stop'}`
          : `observed through ${frame.year}; persistence means previously observed`, 'temporal-count'));
      root.append(coverage, graphPanel(), changeLedger(), inspector());
      if (frame.limitations?.length) {
        const disclosure = node('details', '', 'temporal-limitations');
        disclosure.append(node('summary', 'Clock and interpretation limits'));
        frame.limitations.forEach(item => disclosure.append(node('p', item)));
        root.append(disclosure);
      }
    }

    function dispose() { stopPlayback(); }
    return { render, dispose };
  }

  globalScope.LogPoseTemporalTopologyView = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
