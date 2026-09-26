(function (root) {
  'use strict';
  const requestedLayer = new URLSearchParams(location.search).get('layer') || 'inventory';
  for (const layer of ['inventory', 'reviewed']) {
    document.getElementById(`atlas-${layer}-link`).setAttribute('aria-current', requestedLayer === layer ? 'page' : 'false');
  }
  if (requestedLayer === 'reviewed') {
    if (root.LogPoseReviewedAtlas) root.LogPoseReviewedAtlas.start();
    else {
      const script = document.createElement('script');
      script.src = './atlas-reviewed-view.js';
      script.onload = () => root.LogPoseReviewedAtlas.start();
      script.onerror = () => {
        document.getElementById('atlas-status').textContent = 'reviewed claims could not load. reload to retry.';
      };
      document.body.append(script);
    }
    return;
  }
  if (requestedLayer !== 'inventory') {
    document.getElementById('atlas-status').textContent = 'this evidence layer is not supported.';
    return;
  }
  const { node, append, link } = root.LogPoseUI;
  const model = root.LogPoseAtlasModel;
  const byId = id => document.getElementById(id);
  const cache = model.createCache();
  let manifest = null;
  let displayed = null;
  let inspected = null;
  let generation = 0;
  let controller = null;
  let currentRequest = null;
  let committedRequest = null;
  let listOnly = false;
  let disposed = false;
  let controlTimer = null;
  let densityFrame = null;
  const featuredCandidate = '4d9ade2bfb2aa6cb4afb';
  let featuredExample = false;

  function status(text, failed = false) {
    byId('atlas-status').textContent = text;
    byId('atlas-retry').hidden = !failed;
  }

  function selection() {
    const artifact = manifest.artifacts.find(item => item.artifact_id === byId('atlas-revision').value);
    const temporalMode = byId('atlas-mode').value;
    return { source: artifact.source, year: String(artifact.inventory_year), temporal_mode: temporalMode,
      artifact: temporalMode === 'snapshot' ? artifact.artifact_id : '' };
  }

  async function request(fields, signal) {
    const params = new URLSearchParams(fields);
    const key = params.toString();
    const saved = cache.get(key);
    if (saved) return saved;
    const response = await fetch(`./api/atlas?${key}`, { signal, headers: { accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || `request failed (${response.status})`);
    if (fields.build_id && result.build_id !== fields.build_id) throw new Error('snapshot changed; reload to discover its version');
    cache.put(key, result);
    return result;
  }

  function replaceUrl(fields) {
    const params = new URLSearchParams(fields);
    params.delete('limit');
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }

  async function load(fields) {
    if (fields.candidate !== featuredCandidate || fields.source !== 'cncf' || fields.year !== '2024') {
      featuredExample = false;
    }
    const started = performance.now();
    currentRequest = fields;
    const ticket = ++generation;
    controller?.abort();
    controller = new AbortController();
    status('loading requested frame; the displayed evidence stays under its prior label…');
    try {
      const result = await request(fields, controller.signal);
      if (disposed || ticket !== generation) return;
      displayed = result;
      committedRequest = fields;
      inspected = null;
      render();
      byId('atlas-scene').dataset.frameReadyMs = String(performance.now() - started);
      if (!byId('atlas-scene').dataset.graphReadyMs) {
        root.requestAnimationFrame(() => {
          if (disposed) return;
          byId('atlas-scene').dataset.graphReadyMs = String(performance.now());
          const resources = performance.getEntriesByType('resource');
          const navigation = performance.getEntriesByType('navigation')[0];
          byId('atlas-scene').dataset.initialDecodedBytes = String(resources.reduce((total, item) => total + item.decodedBodySize,
            navigation?.decodedBodySize || 0));
          byId('atlas-scene').dataset.initialGraphBytes = String(resources.filter(item => item.name.includes('/api/atlas?'))
            .reduce((total, item) => total + item.decodedBodySize, 0));
        });
      }
      replaceUrl(fields);
      status('');
      return result;
    } catch (error) {
      if (disposed || ticket !== generation || error.name === 'AbortError') return;
      status(error.message, true);
    }
  }

  function base(mode, extra = {}) {
    const fields = { mode, build_id: manifest.build_id, ...selection(), ...extra };
    if (mode === 'focus') fields.top_k = byId('atlas-top-k').value;
    return fields;
  }

  function focus(id) {
    load(base('focus', { candidate: id }));
  }

  function countText(result) {
    return result.count?.status === 'exact'
      ? `${result.returned} of ${result.count.value} ${result.count.grain.replaceAll('_', ' ')}${result.ranking?.top_k ? ` · top ${result.ranking.top_k} by shared placements` : ''}`
      : `${result.returned} returned · total not computed · ${result.next_cursor ? 'more pages available' : 'end of this lookup'}`;
  }

  function renderList(candidates, isFocus) {
    const list = node('div', '', 'atlas-candidate-list');
    candidates.forEach(candidate => {
      const button = node('button', candidate.name);
      button.type = 'button';
      button.dataset.candidate = candidate.id;
      button.append(node('small', isFocus ? 'inspect exact co-listing →' : 'focus candidate →'));
      button.addEventListener('click', () => isFocus ? inspect(candidate.id) : focus(candidate.id));
      list.append(button);
    });
    return list;
  }

  function render(result = displayed, animate = true) {
    const renderStarted = performance.now();
    const scene = byId('atlas-scene');
    const results = byId('atlas-results');
    const inspector = byId('atlas-inspector');
    scene.replaceChildren(); results.replaceChildren();
    const label = `${featuredExample ? 'example neighborhood · ' : ''}${result.selection.source} · ${result.selection.temporal_mode === 'accumulated'
      ? 'observed through' : 'inventory year'} ${result.selection.year} · ${countText(result)}`;
    byId('atlas-frame-label').textContent = label;
    byId('atlas-frame-label').dataset.frameId = result.frame_id;
    inspector.dataset.frameId = result.frame_id;
    inspector.replaceChildren(node('p', result.operation === 'focus' ? 'selected candidate' : 'how to use this view', 'eyebrow'),
      node('h3', result.operation === 'focus' ? result.focus.name : 'start with a source'),
      node('p', result.operation === 'focus'
        ? `${result.returned} visible co-listings from ${result.count.value} exact neighbors in this source frame. select a connection to inspect its retained rows.`
        : 'choose a category or search for a candidate. each view stays tied to the source and time shown above.'));
    if (result.operation === 'regions') {
      const grid = node('div', '', 'atlas-region-grid');
      result.regions.forEach(region => {
        const button = append(node('button', '', 'atlas-region'), node('strong', region.category),
          node('span', `${region.member_count} candidate memberships · ${region.source} ${region.inventory_year}`));
        button.type = 'button'; button.dataset.region = region.id;
        button.addEventListener('click', () => load(base('search', { placement: region.id })));
        grid.append(button);
      });
      scene.append(grid);
      if (!result.regions.length) scene.append(node('p', 'no regions on this page. continue the lookup if another page is available.'));
    } else if (result.operation === 'search' || result.operation === 'focus') {
      const focused = result.operation === 'focus';
      const candidates = focused ? result.edges.map(edge => edge.candidate) : result.candidates;
      if (!focused && candidates.length === 0) {
        scene.append(node('h3', 'no matching candidates in this source frame'),
          node('p', `${result.selection.source.toUpperCase()} ${result.selection.year} returned no candidates for this search. try another term or browse its categories.`));
        const browse = node('button', 'browse categories', 'quiet-button');
        browse.type = 'button'; browse.addEventListener('click', () => load(base('regions')));
        scene.append(browse);
        inspector.replaceChildren(node('h3', 'nothing to inspect yet'),
          node('p', 'this search returned no visible candidates in the selected source frame. broaden the search or change the source revision.'));
      } else {
        if (!listOnly) scene.append(root.LogPoseTemporalGraph.render(model.graphFrame(result), {
          onSelectCandidate: focus, onSelectEdge: inspect, scheduleCamera: true }));
        else scene.append(node('p', 'list mode · the same selected frame and evidence, without graph rendering.'));
        results.append(node('p', 'keyboard and list access · the same visible candidates'), renderList(candidates, focused));
      }
      if (focused) {
        inspector.append(node('p', 'a co-listing is a shared source placement, not evidence of competition or adoption.', 'atlas-inspector-note'));
        const compare = node('button', 'compare with previous retained year', 'quiet-button');
        compare.type = 'button'; compare.addEventListener('click', comparePrevious);
        inspector.append(compare);
        if (result.focus.identity_review?.pilot_slug) {
          const reviewed = node('a', `reviewed claims for ${result.focus.name} →`, 'atlas-reviewed-navigation');
          reviewed.href = `./atlas.html?${new URLSearchParams({ layer: 'reviewed', candidate: result.focus.id })}`;
          inspector.append(reviewed, node('p', `explicit identity link ${result.focus.identity_review.id}. reviewed claims use a separate source-publication clock.`));
        }
      }
    } else if (result.operation === 'compare') {
      scene.append(node('h3', `compare ${result.comparison_selection.year} → ${result.selection.year}`),
        node('p', result.meaning));
      result.changes.forEach(change => scene.append(node('p', `${change.candidate.name} · ${change.status.replaceAll('_', ' ')}`)));
    }
    byId('atlas-more').hidden = !result.next_cursor;
    byId('atlas-export').disabled = result.operation !== 'focus';
    scene.dataset.renderMs = String(performance.now() - renderStarted);
    if (animate && !root.matchMedia?.('(prefers-reduced-motion: reduce)').matches && scene.animate) {
      scene.animate([{ opacity: 0.65 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    }
  }

  async function inspect(neighbor, cursor = '') {
    if (displayed?.operation !== 'focus') return;
    const ticket = ++generation;
    controller?.abort(); controller = new AbortController();
    const frame = displayed;
    status('loading exact premises…');
    try {
      const evidence = await request({ mode: 'explain', build_id: frame.build_id, ...frame.selection,
        candidate: frame.focus.id, neighbor, cursor }, controller.signal);
      if (disposed || ticket !== generation || displayed.frame_id !== frame.frame_id || evidence.frame_id !== frame.frame_id) return;
      inspected = evidence;
      const inspector = byId('atlas-inspector');
      inspector.replaceChildren(node('h3', `${evidence.subject.name} ↔ ${evidence.object.name}`),
        node('p', `${evidence.count.value} exact shared placements · unreviewed co-listing`));
      evidence.premises.forEach(premise => {
        const block = append(node('section', '', 'atlas-premise'), node('strong', premise.placement.category),
          node('p', `${premise.placement.source} · inventory year ${premise.placement.inventory_year}`),
          node('code', premise.placement.raw_sha256), link('pinned source ↗', premise.artifact.url));
        for (const [role, membership] of [['subject', premise.subject], ['object', premise.object]]) {
          membership.rows.forEach(row => {
            const route = new URL('./index.html', location.href);
            route.search = new URLSearchParams({ view: 'data', dataFamily: 'inventory', dataRecord: row.id });
            const sourceLink = node('a', `${role}: ${row.name || row.id} · retained row →`);
            sourceLink.href = route.href;
            block.append(sourceLink, node('p', row.description || 'no description retained'), node('code', row.id));
          });
        }
        inspector.append(block);
      });
      if (evidence.next_cursor) {
        const more = node('button', 'next page of exact premises →', 'quiet-button');
        more.type = 'button';
        more.addEventListener('click', () => inspect(neighbor, evidence.next_cursor));
        inspector.append(more, node('p', 'this inspector and its export contain the selected evidence page.'));
      }
      const navigate = node('button', 'focus this neighbor →', 'quiet-button');
      navigate.type = 'button'; navigate.addEventListener('click', () => focus(neighbor));
      inspector.append(navigate, node('p', 'supporting membership is not competition, adoption, revenue or investment.'));
      if (frame.focus.identity_review?.pilot_slug) {
        const reviewed = node('a', `reviewed claims for ${frame.focus.name} →`, 'atlas-reviewed-navigation');
        reviewed.href = `./atlas.html?${new URLSearchParams({ layer: 'reviewed', candidate: frame.focus.id })}`;
        inspector.append(reviewed);
      }
      const params = new URLSearchParams(location.search); params.set('neighbor', neighbor);
      if (cursor) params.set('evidence_cursor', cursor);
      else params.delete('evidence_cursor');
      history.replaceState(null, '', `${location.pathname}?${params}`);
      status('');
    } catch (error) {
      if (!disposed && ticket === generation && error.name !== 'AbortError') status(error.message, true);
    }
  }

  function sourceStops() {
    const source = selection().source;
    return manifest.artifacts.filter(item => item.source === source)
      .sort((left, right) => left.inventory_year - right.inventory_year || left.artifact_id.localeCompare(right.artifact_id));
  }

  function step(amount) {
    const stops = sourceStops();
    const index = stops.findIndex(item => item.artifact_id === byId('atlas-revision').value);
    const stop = stops[index + amount];
    if (!stop) { status('no retained stop in that direction.'); return; }
    byId('atlas-revision').value = stop.artifact_id;
    load(base(displayed?.operation === 'focus' ? 'focus' : 'regions',
      displayed?.operation === 'focus' ? { candidate: displayed.focus.id } : {}));
  }

  function comparePrevious() {
    const stops = sourceStops().filter(item => item.inventory_year < Number(displayed.selection.year));
    const previous = stops.at(-1);
    if (!previous) { status('no earlier retained year is available.'); return; }
    load({ mode: 'compare', build_id: displayed.build_id, ...displayed.selection,
      candidate: displayed.focus.id, compare_year: String(previous.inventory_year), compare_artifact: previous.artifact_id });
  }

  async function exportInvestigation() {
    if (displayed?.operation !== 'focus') return;
    const frame = displayed;
    const evidence = inspected;
    const investigation = { schema_version: '1.0', record_type: 'saved_investigation', layer: 'gold',
      question: byId('atlas-question').value, observations_and_interpretation: byId('atlas-interpretation').value,
      counterevidence_and_next_question: byId('atlas-counterevidence').value,
      interpretation_status: 'user_note_not_a_review_decision', build_id: frame.build_id,
      versions: frame.versions, frame_id: frame.frame_id, selection: frame.selection,
      cohort: { grain: 'selected_neighbor_page', focus: frame.focus.id,
        candidate_ids: frame.edges.map(edge => edge.candidate_id), eligible_count: frame.count,
        returned: frame.returned, suppressed: frame.suppressed, next_cursor: frame.next_cursor },
      selected_premises: evidence, neighborhood: frame,
      geometry: { use: 'presentation_only', historically_eligible_model_input: false },
      limitations: frame.limitations, model_outputs: [], scenarios: [] };
    const blob = new Blob([JSON.stringify(investigation, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = node('a', 'download'); anchor.href = url;
    anchor.download = `log-pose-investigation-${frame.frame_id.slice(0, 12)}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    status('investigation downloaded with its exact selected page and limitations.');
  }

  async function start() {
    const ticket = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const url = new URLSearchParams(location.search);
      const discoveryRequest = { mode: 'discover' };
      if (url.get('build_id')) discoveryRequest.build_id = url.get('build_id');
      const discovery = await request(discoveryRequest, signal);
      if (disposed || ticket !== generation) return;
      manifest = { ...discovery, artifacts: [...discovery.artifacts] };
      // Discovery itself is paged; no silent loss of a future source revision.
      while (manifest.next_cursor) {
        const next = await request({ mode: 'discover', build_id: manifest.build_id, cursor: manifest.next_cursor }, signal);
        if (disposed || ticket !== generation) return;
        manifest.artifacts.push(...next.artifacts); manifest.next_cursor = next.next_cursor;
        if (manifest.artifacts.length > 1000) throw new Error('source navigation exceeds this interface budget');
      }
      const revisions = byId('atlas-revision');
      revisions.replaceChildren();
      manifest.artifacts.sort((left, right) => left.source.localeCompare(right.source)
        || left.inventory_year - right.inventory_year);
      manifest.artifacts.forEach(artifact => revisions.add(new Option(
        `${artifact.source.toUpperCase()} · ${artifact.inventory_year}`,
        artifact.artifact_id)));
      const initial = manifest.artifacts.find(item => item.artifact_id === url.get('artifact'))
        || manifest.artifacts.find(item => item.source === (url.get('source') || 'cncf')
          && item.inventory_year === Number(url.get('year') || 2024)) || manifest.artifacts.at(-1);
      revisions.value = initial.artifact_id;
      byId('atlas-mode').value = url.get('temporal_mode') === 'accumulated' ? 'accumulated' : 'snapshot';
      byId('atlas-query').value = url.get('query') || '';
      byId('atlas-top-k').value = /^[1-9]\d?$|^100$/.test(url.get('top_k') || '') ? url.get('top_k') : '24';
      byId('atlas-density').value = byId('atlas-top-k').value;
      byId('atlas-density-value').textContent = `${byId('atlas-top-k').value} connections`;
      byId('atlas-coverage').textContent = `${manifest.counts.candidates.toLocaleString()} inventory candidates · ${manifest.counts.memberships.toLocaleString()} memberships · ${manifest.counts.artifacts} retained revisions. evidence coverage is not a market census.`;
      byId('atlas-version').textContent = `build ${manifest.build_id.slice(0, 12)} · inventory-year clock`;
      byId('atlas-limitations').replaceChildren(...manifest.limitations.map(text => node('li', text)));
      const isFeaturedEntry = !['candidate', 'mode', 'query', 'placement', 'source', 'year', 'artifact', 'temporal_mode']
        .some(key => url.has(key));
      const mode = url.get('candidate') || isFeaturedEntry ? 'focus' : url.get('mode') === 'search' ? 'search' : 'regions';
      const fields = base(mode, isFeaturedEntry ? { candidate: featuredCandidate } : {});
      featuredExample = isFeaturedEntry;
      for (const key of ['candidate', 'query', 'placement', 'cursor']) if (url.get(key)) fields[key] = url.get(key);
      let initialFrame = await load(fields);
      if (isFeaturedEntry && !initialFrame) initialFrame = await load(base('regions'));
      if (!disposed && initialFrame && displayed === initialFrame && url.get('neighbor') && displayed.operation === 'focus') {
        await inspect(url.get('neighbor'), url.get('evidence_cursor') || '');
      }
    } catch (error) {
      if (!disposed && ticket === generation && error.name !== 'AbortError') status(error.message, true);
    }
  }

  byId('atlas-controls').addEventListener('submit', event => {
    event.preventDefault(); if (manifest) load(base('search', { query: byId('atlas-query').value }));
  });
  for (const id of ['atlas-revision', 'atlas-mode', 'atlas-top-k']) byId(id).addEventListener('change', () => {
    root.clearTimeout(controlTimer);
    controlTimer = root.setTimeout(() => {
      if (manifest) load(base(displayed?.operation === 'focus' ? 'focus' : 'regions',
        displayed?.operation === 'focus' ? { candidate: displayed.focus.id } : {}));
    }, 80);
  });
  function previewDensity(value) {
    byId('atlas-top-k').value = value;
    byId('atlas-density').value = value;
    byId('atlas-density-value').textContent = `${value} connections`;
    if (densityFrame !== null) return;
    densityFrame = root.requestAnimationFrame(() => {
      densityFrame = null;
      if (disposed || displayed?.operation !== 'focus') return;
      const k = Number(byId('atlas-top-k').value);
      if (k <= displayed.edges.length) {
        const edges = displayed.edges.slice(0, k);
        render({ ...displayed, edges, returned: edges.length, suppressed: displayed.count.value - edges.length,
          ranking: { ...displayed.ranking, top_k: k } }, false);
      }
      byId('atlas-export').disabled = true;
      status('connection preview · release to accept the selected budget');
    });
  }
  byId('atlas-density').addEventListener('input', () => previewDensity(byId('atlas-density').value));
  byId('atlas-density').addEventListener('change', () => byId('atlas-top-k').dispatchEvent(new Event('change')));
  byId('atlas-top-k').addEventListener('input', () => {
    if (byId('atlas-top-k').checkValidity()) previewDensity(byId('atlas-top-k').value);
  });
  byId('atlas-density-reset').addEventListener('click', () => {
    previewDensity('24'); byId('atlas-top-k').dispatchEvent(new Event('change'));
  });
  byId('atlas-regions').addEventListener('click', () => manifest && load(base('regions')));
  byId('atlas-previous').addEventListener('click', () => manifest && step(-1));
  byId('atlas-next').addEventListener('click', () => manifest && step(1));
  byId('atlas-more').addEventListener('click', () => load({ ...committedRequest, cursor: displayed.next_cursor }));
  byId('atlas-retry').addEventListener('click', () => currentRequest ? load(currentRequest) : start());
  byId('atlas-list-toggle').addEventListener('click', () => {
    listOnly = !listOnly; byId('atlas-list-toggle').setAttribute('aria-pressed', String(listOnly));
    if (displayed) render();
  });
  byId('atlas-export').addEventListener('click', exportInvestigation);
  root.addEventListener('pagehide', () => {
    disposed = true; generation += 1; controller?.abort(); root.clearTimeout(controlTimer); cache.clear();
    if (densityFrame !== null) root.cancelAnimationFrame(densityFrame);
  });
  root.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; start(); } });
  start();
})(globalThis);
