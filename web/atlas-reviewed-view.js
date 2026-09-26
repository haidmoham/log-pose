/* A separate source-publication frame over retained, accepted reviews. */
(function (root) {
  'use strict';
  const { node, append, link } = root.LogPoseUI;
  const model = root.LogPoseAtlasModel;
  const byId = id => document.getElementById(id);

  function start() {
    const client = root.LogPoseAtlasClient.create({
      cache: model.createCache(),
      fallbackMessage: () => 'reviewed claims are unavailable',
      buildMismatchMessage: 'the reviewed build changed; reload to discover its version'
    });
    const names = new Map();
    let discovery;
    let displayed;
    let inspected;
    let committedRequest;
    let retryAction;
    let controller;
    let generation = 0;
    let disposed = false;
    let listOnly = false;
    let filterTimer;

    function status(text, failed = false) {
      byId('atlas-status').textContent = text;
      byId('atlas-retry').hidden = !failed;
    }

    function label(text, control) {
      return append(node('label', text), control);
    }

    function select(id, options) {
      const input = node('select'); input.id = id;
      options.forEach(([value, text]) => input.add(new Option(text, value)));
      return input;
    }

    const cutoff = node('input'); cutoff.type = 'date'; cutoff.id = 'atlas-cutoff';
    const predicate = select('atlas-predicate', [['', 'all predicates']]);
    const basis = select('atlas-basis', [['documented', 'documented + reviewed inference'],
      ['hypothesis', 'hypotheses only'], ['all', 'include hypotheses']]);
    const direction = select('atlas-direction', [['both', 'either direction'], ['out', 'outgoing'], ['in', 'incoming']]);
    const query = node('input'); query.id = 'atlas-query'; query.type = 'search'; query.maxLength = 200;
    query.placeholder = 'reviewed company name';
    const limit = byId('atlas-top-k'); limit.value = '24';
    const search = node('button', 'search', 'quiet-button'); search.type = 'submit';
    const all = node('button', 'all entities', 'quiet-button'); all.type = 'button';
    const filters = node('details', '', 'atlas-reviewed-filters');
    filters.append(node('summary', 'filter claims'), label('predicate', predicate),
      label('claim basis', basis), label('claim direction', direction));
    byId('atlas-controls').replaceChildren(label('sources published through', cutoff),
      label('find an entity', query), search, all, filters);
    document.querySelector('.atlas-density label').textContent = 'neighbor limit';
    byId('atlas-density').setAttribute('aria-label', 'neighbor limit');
    document.querySelector('.atlas-limitations > p').textContent =
      'one visible connection groups claims for navigation. each claim keeps its predicate, direction, scope and premises.';
    const legacy = document.querySelector('.atlas-limitations > a');
    legacy.href = './index.html?view=topology&topologyLayer=reviewed'; legacy.textContent = 'open the reviewed-claims research desk →';
    byId('atlas-previous').textContent = '← earlier source date';
    byId('atlas-next').textContent = 'later source date →';

    function selected() {
      return { clock: 'source_publication', temporal_mode: 'published_through',
        cutoff: cutoff.value, predicate: predicate.value, basis: basis.value, direction: direction.value };
    }

    function fields(mode, extra = {}) {
      return { layer: 'reviewed', mode, build_id: discovery.build_id, ...selected(), ...extra };
    }

    function replaceUrl(parameters) {
      history.replaceState(null, '', `${location.pathname}?${new URLSearchParams(parameters)}`);
    }

    async function load(parameters) {
      retryAction = () => load(parameters);
      const ticket = ++generation;
      controller?.abort(); controller = new AbortController();
      status('loading the requested claims; the displayed frame keeps its previous cutoff…');
      const started = performance.now();
      try {
        const result = await client.request(parameters, controller.signal);
        if (disposed || ticket !== generation) return;
        displayed = result; committedRequest = parameters; inspected = null;
        render(); replaceUrl(parameters); status('');
        byId('atlas-scene').dataset.frameReadyMs = String(performance.now() - started);
        return result;
      } catch (error) {
        if (!disposed && ticket === generation && error.name !== 'AbortError') status(error.message, true);
      }
    }

    function focus(entity) { return load(fields('focus', { entity, top_k: limit.value })); }

    function dateText(selection) {
      return selection.cutoff ? `sources published through ${selection.cutoff}` : 'all retained source dates';
    }

    function remember(entity) { names.set(entity.id, entity.name); return entity; }
    function name(slug) { return names.get(slug) || slug; }

    function render() {
      const started = performance.now();
      const scene = byId('atlas-scene'); const inspector = byId('atlas-inspector');
      const results = byId('atlas-results');
      scene.replaceChildren(); results.replaceChildren();
      const result = displayed;
      const count = result.operation === 'compare' ? `${result.additions.length + result.removals.length}`
        : result.count?.status === 'exact' ? `${result.returned} of ${result.count.value}` : `${result.returned || 0}`;
      const grain = result.operation === 'focus' ? 'eligible neighbors' : result.operation === 'compare' ? 'claim changes' : 'reviewed entities';
      byId('atlas-frame-label').textContent = `reviewed claims · ${dateText(result.selection)} · ${count} ${grain} · current accepted reviews at this build`;
      byId('atlas-frame-label').dataset.frameId = result.frame_id;
      inspector.dataset.frameId = result.frame_id;
      inspector.replaceChildren(node('h3', result.focus?.name || 'scoped claims, separate clocks'),
        node('p', 'source publication does not establish when a relationship was active. these are the accepted reviews retained in this build.'));
      if (result.operation === 'compare') {
        scene.append(node('h3', 'source-publication comparison'),
          node('p', `from ${result.compare_cutoff} to ${result.selection.cutoff || 'all retained source dates'}`),
          node('p', result.caveat));
        for (const [kind, changes] of [['newly eligible', result.additions], ['no longer eligible', result.removals]]) {
          scene.append(node('h4', `${changes.length} ${kind} claims`));
          for (const change of changes) {
            scene.append(node('p', `${change.id} · ${change.predicate.replaceAll('_', ' ')} · ${change.status.replaceAll('_', ' ')}`));
          }
        }
        const back = node('button', 'return to focused claims', 'quiet-button'); back.type = 'button';
        back.addEventListener('click', () => load({ ...committedRequest, mode: 'focus', compare_cutoff: '', top_k: limit.value }));
        scene.append(back);
      } else {
        const focused = result.operation === 'focus';
        const entities = focused ? result.edges.map(edge => remember(edge.neighbor)) : result.entities.map(remember);
        if (focused) remember(result.focus);
        if (entities.length || focused) {
          if (listOnly) scene.append(node('p', 'list mode · the same eligible entities and claims.'));
          else scene.append(root.LogPoseTemporalGraph.render(model.reviewedGraphFrame(result), {
            onSelectCandidate: focus, onSelectEdge: inspect, scheduleCamera: true, fitScale: 1,
            showAllLabels: entities.length <= 3 }));
        } else scene.append(node('p', 'no reviewed entities match these filters. this is not evidence that relationships are absent.'));
        const list = node('div', '', 'atlas-candidate-list');
        entities.forEach((entity, index) => {
          const button = append(node('button', entity.name), node('small', focused
            ? `${result.edges[index].claim_count} distinct claims · inspect →` : 'focus reviewed entity →'));
          button.type = 'button'; button.dataset.entity = entity.id;
          button.addEventListener('click', () => focused ? inspect(entity.id) : focus(entity.id));
          list.append(button);
        });
        results.append(node('p', 'keyboard and list access · the same visible entities'), list);
        if (!focused) inspector.append(node('p', 'entity search lists reviewed identities retained in this build. focus an entity to apply the claim filters; its presence is not historical existence evidence.'));
        if (focused) {
          inspector.append(node('p', `${result.eligible_claim_count} eligible claims across ${result.count.value} distinct neighbors. each claim keeps its own meaning and direction.`),
            node('p', 'neighbor display order is stable by identifier. it is not strength, relevance or confidence.'));
          const compare = node('button', 'compare with earlier source date', 'quiet-button');
          compare.type = 'button'; compare.addEventListener('click', compareEarlier); inspector.append(compare);
          appendIdentityLinks(inspector, result.focus);
          if (inspected) renderEvidence(inspected);
        }
      }
      byId('atlas-more').hidden = !result.next_cursor;
      byId('atlas-export').disabled = result.operation !== 'focus';
      scene.dataset.renderMs = String(performance.now() - started);
      if (!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches && scene.animate) {
        scene.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
      }
    }

    function appendIdentityLinks(container, entity) {
      if (!entity.candidate_links.length) {
        container.append(node('p', 'reviewed external entity · no reviewed inventory candidate mapping is retained.'));
        return;
      }
      entity.candidate_links.forEach(mapping => {
        const anchor = node('a', `inventory candidate via ${mapping.identity_review_id} →`, 'atlas-reviewed-navigation');
        anchor.href = `./atlas.html?${new URLSearchParams({ candidate: mapping.candidate_id })}`;
        container.append(anchor);
      });
    }

    function facts(container, items) {
      const list = node('dl');
      items.forEach(([labelText, value]) => list.append(node('dt', labelText), node('dd', value || 'not established')));
      container.append(list);
    }

    function claimCard(claim) {
      const arrow = claim.direction === 'symmetric' ? '↔' : claim.direction === 'object_to_subject' ? '←' : '→';
      const card = node('section', '', 'atlas-claim'); card.dataset.claimId = claim.id;
      card.append(node('span', claim.claim_status.replaceAll('_', ' '), `atlas-claim-status${claim.claim_status === 'hypothesis' ? ' is-hypothesis' : ''}`),
        node('h4', `${name(claim.subject_slug)} ${arrow} ${name(claim.object_slug)}`),
        node('strong', claim.predicate.replaceAll('_', ' ')), node('p', claim.interpretation));
      facts(card, [['scope', claim.scope], ['time meaning', claim.temporal_basis],
        ['event date', claim.event_date], ['unknowns and alternatives', claim.alternative_or_unknown]]);
      const audit = node('details', '', 'atlas-claim-audit');
      audit.append(node('summary', 'claim and review trail'));
      facts(audit, [['valid from / to', `${claim.valid_from || 'unknown'} / ${claim.valid_to || 'unknown'}`],
        ['claim id', claim.id], ['database claim id', claim.database_id],
        ['candidate record created', claim.created_at], ['derivation', `${claim.generator} · ${claim.generator_version}`]]);
      for (const source of claim.sources) {
        const premise = node('section', '', 'atlas-premise');
        premise.append(node('strong', `${source.role} · ${source.title}`), node('p', source.publisher),
          node('p', source.evidence_text));
        if (source.evidence_quote) premise.append(node('blockquote', source.evidence_quote));
        facts(premise, [['published', source.source_date]]);
        premise.append(link('source document ↗', source.source_url));
        const sourceAudit = node('details', '', 'atlas-source-audit');
        sourceAudit.append(node('summary', 'source record and hash'));
        facts(sourceAudit, [['source location', source.evidence_locator],
          ['reporting period', `${source.period_start || 'unknown'} → ${source.period_end || 'unknown'}`],
          ['source event date', source.event_date], ['retrieved', source.retrieved_at || source.retrieved_on],
          ['captured', source.captured_at], ['source id', source.id]]);
        sourceAudit.append(node('code', source.artifact_sha256));
        premise.append(sourceAudit);
        card.append(premise);
      }
      const review = claim.review;
      facts(audit, [['review decision', `${review.decision} · review ${review.id}`], ['reviewer', review.reviewer],
        ['review date and precision', `${review.reviewed_at} · ${review.date_precision || 'timestamp precision unspecified'}`],
        ['review rationale', review.rationale]]);
      if (claim.review_history?.length) {
        const history = node('details'); history.append(node('summary', 'retained review history'));
        claim.review_history.forEach(item => history.append(node('p', `${item.decision} · ${item.reviewed_at} · ${item.reviewer}: ${item.rationale}`)));
        audit.append(history);
      }
      card.append(audit);
      const trail = node('a', 'open the retained claim and review trail →');
      trail.href = `./index.html?${new URLSearchParams({ view: 'data', dataFamily: 'topology', dataRecord: claim.id })}`;
      card.append(trail);
      return card;
    }

    function renderEvidence(evidence) {
      const frame = displayed;
      const neighbor = evidence.neighbor?.id;
      const inspector = byId('atlas-inspector');
      inspector.replaceChildren(node('h3', `${frame.focus.name}${neighbor ? ` · ${name(neighbor)}` : ''}`),
        node('p', `${evidence.returned} of ${evidence.count.value} eligible claims. acceptance retains the stated basis; hypotheses remain hypotheses.`));
      evidence.claims.forEach(value => inspector.append(claimCard(value)));
      if (evidence.next_cursor) {
        const more = node('button', 'next page of claims →', 'quiet-button'); more.type = 'button';
        more.addEventListener('click', () => inspect(neighbor || '', evidence.next_cursor, evidence.claims.length === 1 && !neighbor ? evidence.claims[0].id : ''));
        inspector.append(more);
      }
      if (neighbor) {
        appendIdentityLinks(inspector, evidence.neighbor);
        const navigate = node('button', 'focus this entity →', 'quiet-button'); navigate.type = 'button';
        navigate.addEventListener('click', () => focus(neighbor)); inspector.append(navigate);
      }
    }

    async function inspect(neighbor, cursor = '', claim = '') {
      if (displayed?.operation !== 'focus') return;
      retryAction = () => inspect(neighbor, cursor, claim);
      const frame = displayed;
      const ticket = ++generation;
      controller?.abort(); controller = new AbortController();
      status('loading the exact reviewed claims and premises…');
      try {
        const parameters = { layer: 'reviewed', mode: 'explain', build_id: frame.build_id,
          ...frame.selection, entity: frame.focus.id, neighbor, cursor };
        if (claim) parameters.claim = claim;
        const evidence = await client.request(parameters, controller.signal);
        if (disposed || ticket !== generation || displayed.frame_id !== frame.frame_id || evidence.frame_id !== frame.frame_id) return;
        inspected = evidence;
        renderEvidence(evidence);
        const urlParameters = { ...committedRequest, neighbor };
        if (cursor) urlParameters.evidence_cursor = cursor;
        if (claim) urlParameters.claim = claim;
        replaceUrl(urlParameters);
        status('');
      } catch (error) {
        if (!disposed && ticket === generation && error.name !== 'AbortError') status(error.message, true);
      }
    }

    function adjacentDate(amount) {
      const dates = discovery.source_dates;
      if (!cutoff.value) return amount < 0 ? dates.at(-1) : null;
      return amount < 0 ? dates.filter(date => date < cutoff.value).at(-1) : dates.find(date => date > cutoff.value);
    }

    function reloadSelection() {
      if (!discovery || !byId('atlas-controls').checkValidity()) return;
      if (displayed?.focus) focus(displayed.focus.id);
      else load(fields('search', { query: query.value }));
    }

    function step(amount) {
      const date = adjacentDate(amount);
      if (!date) { status('no retained source date in that direction.'); return; }
      cutoff.value = date; reloadSelection();
    }

    function compareEarlier() {
      const current = displayed.selection.cutoff || discovery.source_dates.at(-1);
      const previous = discovery.source_dates.filter(date => date < current).at(-1);
      if (!previous) { status('no earlier retained source date is available.'); return; }
      load({ layer: 'reviewed', mode: 'compare', build_id: displayed.build_id,
        ...displayed.selection, entity: displayed.focus.id, compare_cutoff: previous });
    }

    function exportInvestigation() {
      if (displayed?.operation !== 'focus') return;
      const result = { schema_version: '1.0', record_type: 'saved_investigation', layer: 'reviewed',
        question: byId('atlas-question').value, observations_and_interpretation: byId('atlas-interpretation').value,
        counterevidence_and_next_question: byId('atlas-counterevidence').value,
        interpretation_status: 'user_note_not_a_review_decision', build_id: displayed.build_id,
        versions: displayed.versions, frame_id: displayed.frame_id, selection: displayed.selection,
        review_lens: 'current_accepted_at_build', neighborhood: displayed, selected_premises: inspected,
        scope: 'selected neighbor and claim pages; continuation cursors name omitted pages',
        geometry: { use: 'presentation_only', historically_eligible_model_input: false },
        limitations: displayed.limitations, model_outputs: [], scenarios: [] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = node('a'); anchor.href = url; anchor.download = `log-pose-reviewed-${displayed.frame_id.slice(0, 12)}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      status('investigation downloaded with its selected typed claims, premises and review lens.');
    }

    async function initialize() {
      retryAction = initialize;
      const ticket = ++generation;
      controller?.abort(); controller = new AbortController();
      const url = new URLSearchParams(location.search);
      status('loading the retained reviewed build…');
      try {
        const parameters = { layer: 'reviewed', mode: 'discover' };
        if (url.get('build_id')) parameters.build_id = url.get('build_id');
        const result = await client.request(parameters, controller.signal);
        if (disposed || ticket !== generation) return;
        discovery = result;
        predicate.replaceChildren(new Option('all predicates', ''));
        result.predicates.forEach(item => predicate.add(new Option(item.id.replaceAll('_', ' '), item.id)));
        cutoff.value = url.get('cutoff') || '';
        predicate.value = url.get('predicate') || '';
        basis.value = url.get('basis') || 'documented'; direction.value = url.get('direction') || 'both';
        query.value = url.get('query') || ''; limit.value = url.get('top_k') || '24';
        syncLimit();
        byId('atlas-coverage').textContent = `${result.counts.entities} reviewed entities · ${result.counts.claims} accepted claims in the retained build. hypotheses need explicit selection.`;
        byId('atlas-version').textContent = `build ${result.build_id.slice(0, 12)} · source-publication clock · current accepted reviews`;
        byId('atlas-limitations').replaceChildren(...result.limitations.map(text => node('li', text)));
        const focused = url.has('entity') || url.has('candidate');
        const mode = url.get('mode') || (focused ? 'focus' : 'search');
        if (!['focus', 'search', 'compare'].includes(mode)) throw new Error('choose a search, focus or comparison view');
        const parametersToLoad = fields(mode, focused ? { top_k: limit.value } : { query: query.value });
        // Preserve requested selectors so malformed or incompatible deep links fail explicitly.
        for (const key of ['entity', 'candidate', 'cursor', 'cutoff', 'predicate', 'basis', 'direction', 'clock', 'temporal_mode',
          'compare_cutoff', 'top_k', 'review_lens', 'year', 'inventory_year', 'source', 'category', 'artifact',
          'valid_at', 'valid_from', 'valid_to', 'replay', 'system_time', 'review_cutoff']) {
          if (url.has(key)) parametersToLoad[key] = url.get(key);
        }
        const frame = await load(parametersToLoad);
        if (!disposed && frame && displayed === frame && mode === 'focus' && (url.get('neighbor') || url.get('claim'))) {
          await inspect(url.get('neighbor') || '', url.get('evidence_cursor') || '', url.get('claim') || '');
        }
      } catch (error) {
        if (!disposed && ticket === generation && error.name !== 'AbortError') status(error.message, true);
      }
    }

    function syncLimit() {
      byId('atlas-density').value = limit.value;
      byId('atlas-density-value').textContent = `${limit.value} neighbors · stable identifier order`;
    }

    byId('atlas-controls').addEventListener('submit', event => {
      event.preventDefault(); if (discovery) load(fields('search', { query: query.value }));
    });
    all.addEventListener('click', () => { query.value = ''; if (discovery) load(fields('search')); });
    for (const control of [cutoff, predicate, basis, direction, limit]) control.addEventListener('change', () => {
      syncLimit(); root.clearTimeout(filterTimer); filterTimer = root.setTimeout(reloadSelection, 80);
    });
    byId('atlas-density').addEventListener('input', () => { limit.value = byId('atlas-density').value; syncLimit(); });
    byId('atlas-density').addEventListener('change', reloadSelection);
    byId('atlas-density-reset').addEventListener('click', () => { limit.value = '24'; syncLimit(); reloadSelection(); });
    byId('atlas-previous').addEventListener('click', () => discovery && step(-1));
    byId('atlas-next').addEventListener('click', () => discovery && step(1));
    byId('atlas-more').addEventListener('click', () => load({ ...committedRequest, cursor: displayed.next_cursor }));
    byId('atlas-retry').addEventListener('click', () => retryAction?.());
    byId('atlas-list-toggle').addEventListener('click', () => {
      listOnly = !listOnly; byId('atlas-list-toggle').setAttribute('aria-pressed', String(listOnly));
      if (displayed) render();
    });
    byId('atlas-export').addEventListener('click', exportInvestigation);
    root.addEventListener('pagehide', () => {
      disposed = true; generation += 1; controller?.abort(); root.clearTimeout(filterTimer); client.clear();
    });
    root.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; initialize(); } });
    initialize();
  }

  root.LogPoseReviewedAtlas = { start };
})(globalThis);
