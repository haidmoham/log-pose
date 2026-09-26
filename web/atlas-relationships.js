/* Reviewed claims are contextual evidence for an explicitly mapped inventory identity. */
(function (root) {
  'use strict';
  const { node, link } = root.LogPoseUI;
  const reviewedClient = root.LogPoseAtlasClient.create({
    cache: root.LogPoseAtlasModel.createCache(),
    fallbackMessage: () => 'reviewed claims are unavailable',
    buildMismatchMessage: 'the selected reviewed build changed; reload this link'
  });
  let generation = 0;
  let controller;

  function detail(container, label, value) {
    container.append(node('dt', label), node('dd', value || 'not established'));
  }

  function claimCard(claim) {
    const card = node('article', '', 'atlas-claim');
    card.dataset.claimId = claim.id;
    const status = claim.claim_status.replaceAll('_', ' ');
    const heading = `${claim.subject_slug.replaceAll('-', ' ')} ${claim.predicate.replaceAll('_', ' ')} ${claim.object_slug.replaceAll('-', ' ')}`;
    card.append(node('span', `${status} claim`, `atlas-claim-status${status === 'hypothesis' ? ' is-hypothesis' : ''}`),
      node('h4', heading), node('p', claim.interpretation));
    const sourceSummary = claim.sources?.[0];
    if (sourceSummary) card.append(node('p', `${sourceSummary.publisher} · published ${sourceSummary.source_date}`, 'atlas-source-date'));
    const trail = node('a', 'open retained claim and review trail →');
    trail.href = `./index.html?${new URLSearchParams({ view: 'data', dataFamily: 'topology', dataRecord: claim.id })}`;
    card.append(trail);
    const audit = node('details', '', 'atlas-claim-audit');
    audit.append(node('summary', 'scope, limits and source trail'));
    const meaning = node('dl');
    detail(meaning, 'scope', claim.scope);
    detail(meaning, 'time meaning', claim.temporal_basis);
    detail(meaning, 'remaining unknown', claim.alternative_or_unknown);
    audit.append(meaning);
    for (const source of claim.sources || []) {
      const premise = node('section', '', 'atlas-claim-source');
      premise.append(node('strong', `${source.role} · ${source.title} · ${source.publisher} · published ${source.source_date}`),
        node('p', `evidence summary: ${source.evidence_text}`, 'atlas-evidence-summary'));
      if (source.evidence_quote) premise.append(node('blockquote', source.evidence_quote));
      premise.append(link('source document ↗', source.source_url));
      audit.append(premise);
    }
    audit.append(node('h5', 'claim and review identifiers'));
    const facts = node('dl');
    for (const [label, value] of [['claim id', claim.id], ['database claim id', claim.database_id],
      ['direction', claim.direction], ['valid from / to', `${claim.valid_from || 'unknown'} / ${claim.valid_to || 'unknown'}`],
      ['review decision', claim.review?.decision], ['reviewed at', claim.review?.reviewed_at],
      ['reviewer', claim.review?.reviewer], ['review rationale', claim.review?.rationale]]) detail(facts, label, value);
    audit.append(facts);
    for (const source of claim.sources || []) {
      const sourceFacts = node('dl');
      for (const [label, value] of [['source id', source.id], ['locator', source.evidence_locator],
        ['retrieved', source.retrieved_at || source.retrieved_on], ['source SHA-256', source.artifact_sha256]]) {
        detail(sourceFacts, label, value);
      }
      audit.append(sourceFacts);
    }
    if (claim.review_history?.length) {
      audit.append(node('h5', 'retained review history'));
      for (const review of claim.review_history) audit.append(node('p',
        `${review.decision} · ${review.reviewed_at} · ${review.reviewer}: ${review.rationale}`));
    }
    card.append(audit);
    return card;
  }

  function selection() {
    const url = new URLSearchParams(root.location.search);
    return { clock: 'source_publication', temporal_mode: 'published_through',
      cutoff: url.get('reviewed_cutoff') || '', basis: url.get('reviewed_basis') || 'documented',
      predicate: url.get('reviewed_predicate') || '', direction: url.get('reviewed_direction') || 'both' };
  }

  function show(frame, neighborId, inspector, isCurrent) {
    const ticket = ++generation;
    controller?.abort();
    if (!frame.focus?.identity_review?.id) return;
    controller = new AbortController();
    const signal = controller.signal;
    const section = node('section', '', 'atlas-relationships');
    section.append(node('p', 'relationship evidence', 'eyebrow'));
    const body = node('div', 'loading source-backed claims…', 'atlas-relationship-body');
    section.append(body); inspector.append(section);
    const active = () => ticket === generation && isCurrent() && section.isConnected;
    function showError(message) {
      body.replaceChildren(node('p', message));
      const retry = node('button', 'retry relationship evidence', 'quiet-button');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        if (!active()) return;
        section.remove();
        show(frame, neighborId, inspector, isCurrent);
      });
      body.append(retry);
    }
    const selected = selection();
    const buildId = new URLSearchParams(root.location.search).get('reviewed_build_id') || '';
    const fields = { layer: 'reviewed', ...selected };
    (async () => {
      try {
        const discoveryFields = { ...fields, mode: 'discover' };
        if (buildId) discoveryFields.build_id = buildId;
        const discovery = await reviewedClient.request(discoveryFields, signal);
        if (!active()) return;
        const pinned = { ...fields, build_id: discovery.build_id };
        const focused = await reviewedClient.request({ ...pinned, mode: 'focus', candidate: frame.focus.id,
          top_k: '100', limit: '100' }, signal);
        if (!active()) return;
        body.replaceChildren();
        const basisNote = selected.basis === 'hypothesis' ? ' · hypotheses only' : selected.basis === 'all'
          ? ' · includes hypotheses' : '';
        const linkedEntity = !neighborId ? new URLSearchParams(root.location.search).get('reviewed_neighbor') : '';
        const candidateCount = neighborId || linkedEntity ? ''
          : ` · ${focused.eligible_claim_count} eligible ${focused.eligible_claim_count === 1 ? 'claim' : 'claims'}`;
        body.append(node('p', `limited selected-pilot coverage${candidateCount} · ${selected.cutoff ? `sources published through ${selected.cutoff}` : 'all retained source dates'}${basisNote}.`));
        if (focused.next_cursor || focused.suppressed) body.append(node('p', 'this reviewed neighbor page is bounded; additional neighbors are not shown here.'));
        let matched = null;
        if (neighborId) {
          matched = focused.edges.find(edge => edge.neighbor.candidate_links.some(mapping => mapping.candidate_id === neighborId));
          if (!matched) {
            body.append(node('p', 'this selected co-listing has no eligible reviewed claim through an explicit identity mapping in this pilot and publication scope. this does not establish that no relationship exists.'));
            return;
          }
        } else if (linkedEntity) {
          matched = focused.edges.find(edge => edge.neighbor_id === linkedEntity);
          if (!matched) {
            body.append(node('p', 'this reviewed neighbor has no eligible claim in the retained publication scope. the link has not been widened.'));
            return;
          }
        } else {
          const eligible = focused.edges.slice(0, 3);
          if (!eligible.length) {
            body.append(node('p', 'no reviewed claims are eligible in this selected pilot and publication scope. this is not a finding that relationships are absent.'));
            return;
          }
          const list = node('div', '', 'atlas-relationship-choices');
          for (const edge of eligible) {
            const button = node('button', `${edge.neighbor.name} · ${edge.claim_count} ${edge.claim_count === 1 ? 'claim' : 'claims'}`, 'quiet-button');
            button.type = 'button';
            button.addEventListener('click', () => explain(edge.neighbor_id));
            list.append(button);
          }
          body.append(list);
          return;
        }
        await explain(matched.neighbor_id);

        async function explain(entityId, cursor = '') {
          const explainTicket = ++explainGeneration;
          let exact;
          try {
            const explainFields = { ...pinned, mode: 'explain', candidate: frame.focus.id,
              neighbor: entityId, limit: '10' };
            if (cursor) explainFields.cursor = cursor;
            exact = await reviewedClient.request(explainFields, signal);
          } catch (error) {
            if (active() && explainTicket === explainGeneration && error.name !== 'AbortError') {
              showError(`claim detail unavailable: ${error.message}`);
            }
            return;
          }
          if (!active() || explainTicket !== explainGeneration || exact.frame_id !== focused.frame_id) return;
          const previous = body.querySelector('.atlas-relationship-evidence');
          previous?.remove();
          const evidence = node('div', '', 'atlas-relationship-evidence');
          evidence.append(node('h4', `${focused.focus.name} · ${exact.neighbor.name}`),
            node('p', `${exact.returned} of ${exact.count.value} eligible claims for this explicitly mapped pair. accepted review does not independently verify a claim.`));
          for (const claim of exact.claims) evidence.append(claimCard(claim));
          if (exact.next_cursor) {
            const more = node('button', 'next page of claims →', 'quiet-button'); more.type = 'button';
            more.addEventListener('click', () => explain(entityId, exact.next_cursor)); evidence.append(more);
          }
          body.append(evidence);
        }
      } catch (error) {
        if (active() && error.name !== 'AbortError') showError(`relationship evidence unavailable: ${error.message}`);
      }
    })();
    let explainGeneration = 0;
  }

  function clear() { generation += 1; controller?.abort(); }
  function dispose() { clear(); reviewedClient.clear(); }
  root.LogPoseAtlasRelationships = { show, clear, dispose, claimCard };
})(globalThis);
