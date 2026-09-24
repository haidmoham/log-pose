(function exposeTopologyView(globalScope) {
  'use strict';

  const PREDICATE_LABELS = {
    possible_substitute_for: 'possible substitute',
    named_competitor_of: 'named competitor',
    integrates_with: 'integrates with',
    announced_partnership_with: 'announced partnership',
    invested_in: 'invested in',
    shared_exposure_hypothesis: 'shared exposure hypothesis'
  };
  const CATEGORY_LABELS = {
    competition: 'Competition',
    collaboration: 'Collaboration',
    performance_exposure: 'Performance exposure'
  };
  const STATUS_LABELS = {
    documented: 'Documented',
    reviewed_inference: 'Reviewed inference',
    hypothesis: 'Hypothesis'
  };

  function create({ root, state, data, model, commitState }) {
    const { node, append, link, title, svgNode } = globalScope.LogPoseUI;
    const topology = data.market_topology || { claims: [] };
    const claims = topology.claims;
    const companies = new Map(data.companies.map(company => [company.slug, company]));
    for (const graphNode of topology.entities || topology.nodes || []) companies.set(graphNode.slug,
      { ...companies.get(graphNode.slug), ...graphNode });
    const mappedSlugs = [...new Set(claims.flatMap(claim =>
      [claim.subject_slug, claim.object_slug]))].sort((left, right) =>
      companyName(left).localeCompare(companyName(right)));
    const sourceYears = [...new Set(claims.flatMap(claim =>
      claim.sources.map(source => Number(source.source_date.slice(0, 4)))))].sort((a, b) => a - b);

    function companyName(slug) {
      return companies.get(slug)?.name || slug;
    }

    function claimLabel(claim) {
      const subject = companyName(claim.subject_slug);
      const object = companyName(claim.object_slug);
      const predicate = PREDICATE_LABELS[claim.predicate] || claim.predicate.replaceAll('_', ' ');
      if (claim.direction === 'object_to_subject') return `${object} ${predicate} ${subject}`;
      return `${subject} ${predicate} ${object}`;
    }

    function makeSelect(label, options, value, change) {
      const select = node('select');
      select.setAttribute('aria-label', label);
      options.forEach(([optionValue, optionLabel]) => select.add(new Option(optionLabel, optionValue)));
      select.value = value;
      select.addEventListener('change', () => change(select.value));
      return select;
    }

    function controls() {
      const panel = node('div', '', 'topology-controls');
      const sourceYear = makeSelect('Filter by latest source publication year',
        [['all', 'All source dates'], ...sourceYears.map(year => [String(year), `Sources through ${year}`])],
        state.topologySourceYear, value => commitState({ topologySourceYear: value },
          { focus: '#topology-source-year' }));
      sourceYear.id = 'topology-source-year';
      const category = makeSelect('Filter relationship category',
        [['all', 'All relationship types'], ['competition', 'Competition'],
          ['collaboration', 'Collaboration'], ['performance_exposure', 'Performance exposure']],
        state.topologyCategory, value => commitState({ topologyCategory: value },
          { focus: '#topology-category' }));
      category.id = 'topology-category';
      const status = makeSelect('Filter claim status',
        [['all', 'All claim statuses'], ['documented', 'Documented'],
          ['reviewed_inference', 'Reviewed inference'], ['hypothesis', 'Hypothesis']],
        state.topologyStatus, value => commitState({ topologyStatus: value },
          { focus: '#topology-status' }));
      status.id = 'topology-status';
      const company = makeSelect('Focus a mapped company',
        [['all', 'All mapped companies'], ...mappedSlugs.map(slug =>
          [slug, `${companyName(slug)}${companies.get(slug)?.identity_status
            && companies.get(slug).identity_status !== 'reviewed_pilot_company' ? ' · identity lead' : ''}`])],
        state.company || 'all', value => commitState({ company: value === 'all' ? null : value,
          selectedClaim: null }, { focus: '#topology-company' }));
      company.id = 'topology-company';
      panel.append(sourceYear, category, status, company);
      if (state.company) {
        const clear = node('button', 'Show all mapped companies ×', 'quiet-button');
        clear.type = 'button';
        clear.addEventListener('click', () => commitState({ company: null, selectedClaim: null },
          { focus: '#topology-company' }));
        panel.append(clear);
      }
      return panel;
    }

    function edgePath(start, end, offset) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const midpointX = (start.x + end.x) / 2 - dy / length * offset;
      const midpointY = (start.y + end.y) / 2 + dx / length * offset;
      return `M ${start.x} ${start.y} Q ${midpointX} ${midpointY} ${end.x} ${end.y}`;
    }

    function graph(baseClaims, visibleClaims) {
      const frame = node('div', '', 'topology-graph-frame');
      const positions = model.topologyPositions(baseClaims);
      const svg = svgNode('svg', { viewBox: '0 0 1000 700', class: 'topology-graph',
        role: 'group', 'aria-label': 'Relationship claim map. A matching list follows the map.' });
      const definitions = svgNode('defs');
      for (const category of Object.keys(CATEGORY_LABELS)) {
        const marker = svgNode('marker', { id: `topology-arrow-${category}`,
          viewBox: '0 0 10 10', refX: '23', refY: '5', markerWidth: '7', markerHeight: '7',
          orient: 'auto-start-reverse' });
        marker.append(svgNode('path', { d: 'M 1 1 L 9 5 L 1 9 z',
          class: `topology-arrow topology-${category}` }));
        definitions.append(marker);
      }
      svg.append(definitions);
      const visibleIds = new Set(visibleClaims.map(claim => claim.id));
      const visibleSlugs = new Set(visibleClaims.flatMap(claim => [claim.subject_slug, claim.object_slug]));
      for (const group of model.topologyPairGroups(baseClaims)) {
        group.claims.forEach((claim, index) => {
          if (!visibleIds.has(claim.id)) return;
          const first = positions.get(claim.subject_slug);
          const second = positions.get(claim.object_slug);
          const start = claim.direction === 'object_to_subject' ? second : first;
          const end = claim.direction === 'object_to_subject' ? first : second;
          const offset = (index - (group.claims.length - 1) / 2) * 34;
          const path = edgePath(start, end, offset);
          const category = model.topologyCategory(claim.predicate);
          const line = svgNode('path', { d: path,
            class: `topology-edge topology-${category} topology-${claim.claim_status}`
              + (state.selectedClaim === claim.id ? ' is-selected' : ''),
            'marker-end': claim.direction === 'symmetric' ? '' : `url(#topology-arrow-${category})` });
          const hit = svgNode('path', { d: path, class: 'topology-edge-hit',
            tabindex: '0', role: 'button', 'aria-label': `Inspect ${claimLabel(claim)}` });
          hit.addEventListener('click', () => commitState({ selectedClaim: claim.id },
            { focus: '#topology-inspector' }));
          hit.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              hit.dispatchEvent(new MouseEvent('click'));
            }
          });
          svg.append(line, hit);
        });
      }
      for (const [slug, position] of positions) {
        const active = visibleSlugs.has(slug);
        const focused = state.company === slug;
        const group = svgNode('g', { class: `topology-node${active ? ' is-active' : ' is-muted'}`
          + (focused ? ' is-focused' : ''), tabindex: '0', role: 'button',
        'aria-label': `Focus ${companyName(slug)} relationships` });
        const hit = svgNode('circle', { cx: position.x, cy: position.y, r: 24,
          class: 'topology-node-hit' });
        const circle = svgNode('circle', { cx: position.x, cy: position.y, r: 11,
          class: 'topology-node-core' });
        const label = svgNode('text', { x: position.x, y: position.y - 26,
          'text-anchor': 'middle', class: 'topology-node-label' });
        label.textContent = companyName(slug);
        const descriptor = companies.get(slug)?.identity_status;
        const tooltip = svgNode('title');
        tooltip.textContent = companyName(slug) + (descriptor && descriptor !== 'reviewed_pilot_company'
          ? ` · ${descriptor.replaceAll('_', ' ')}` : '');
        group.append(tooltip, hit, circle, label);
        group.addEventListener('click', () => commitState({ company: slug, selectedClaim: null },
          { focus: '#topology-inspector' }));
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            group.dispatchEvent(new MouseEvent('click'));
          }
        });
        svg.append(group);
      }
      frame.append(svg);
      return frame;
    }

    function legend() {
      const panel = node('div', '', 'topology-legend');
      for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
        panel.append(append(node('span', '', 'topology-legend-item'),
          node('span', '', `topology-line topology-${category}`), node('span', label)));
      }
      for (const [status, label] of Object.entries(STATUS_LABELS)) {
        panel.append(append(node('span', '', 'topology-legend-item'),
          node('span', '', `topology-line topology-${status}`), node('span', label)));
      }
      return panel;
    }

    function claimDetail(claim) {
      const panel = node('div', '', 'topology-claim-detail');
      const category = model.topologyCategory(claim.predicate);
      panel.append(node('p', `${CATEGORY_LABELS[category]} / ${STATUS_LABELS[claim.claim_status]}`, 'eyebrow'),
        node('h3', claimLabel(claim)), node('p', claim.interpretation, 'topology-interpretation'),
        append(node('div', '', 'topology-fact'), node('strong', 'Scope'), node('span', claim.scope)),
        append(node('div', '', 'topology-fact'), node('strong', 'Alternative or unknown'),
          node('span', claim.alternative_or_unknown)));
      const sourceList = node('div', '', 'topology-source-list');
      claim.sources.forEach(source => {
        const sourceCard = node('article', '', 'topology-source');
        sourceCard.append(node('p', `${source.publisher} · published ${source.source_date}`
          + (source.event_date ? ` · event ${source.event_date}` : '')
          + (source.period_end ? ` · reporting period ended ${source.period_end}` : ''), 'eyebrow'),
        node('blockquote', source.evidence_text),
        append(node('div', '', 'topology-source-foot'),
          node('span', source.source_type.replaceAll('_', ' ')),
          link('Open source ↗', source.source_url)));
        if (source.retrieved_on) sourceCard.append(node('p',
          `Retrieved ${source.retrieved_on}; this date does not establish historical page content.`, 'caption'));
        if (source.artifact_sha256) sourceCard.append(node('p',
          `Stored artifact SHA-256 ${source.artifact_sha256}`
          + (source.artifact_path ? ` · ${source.artifact_path}` : ''), 'topology-artifact'));
        sourceList.append(sourceCard);
      });
      panel.append(node('h4', `Sources · ${claim.sources.length}`, 'section-title'), sourceList,
        node('p', `Reviewed ${topology.reviewed_at || 'date unavailable'}. Source and event dates describe evidence; they do not establish an ongoing relationship.`, 'caveat'));
      return panel;
    }

    function inspector(visibleClaims) {
      const panel = node('aside', '', 'topology-inspector');
      panel.id = 'topology-inspector';
      panel.tabIndex = -1;
      const selected = visibleClaims.find(claim => claim.id === state.selectedClaim);
      if (selected) return append(panel, claimDetail(selected));
      if (state.company) {
        const companyClaims = visibleClaims.filter(claim =>
          claim.subject_slug === state.company || claim.object_slug === state.company);
        panel.append(node('p', 'FOCUSED COMPANY', 'eyebrow'), node('h3', companyName(state.company)),
          node('p', `${companyClaims.length} mapped claims under the current filters. Select a relationship to inspect its source.`, 'muted'));
        const identityStatus = companies.get(state.company)?.identity_status;
        if (identityStatus && identityStatus !== 'reviewed_pilot_company') panel.append(node('p',
          `Identity status: ${identityStatus.replaceAll('_', ' ')}. Treat this node as a lead until its company relationship is reviewed.`, 'caveat'));
        if (!companyClaims.length) panel.append(node('p',
          'No mapped claim matches these filters. This does not mean the company has no relationships.', 'empty-state'));
        return panel;
      }
      panel.append(node('p', 'READ THE CLAIMS', 'eyebrow'),
        node('h3', 'A map of sourced statements'),
        node('p', 'Select a line or a relationship below to read its scope, dates, source passage, and uncertainty.', 'muted'),
        node('p', 'Positions aid reading. Distance, line length, and node size have no analytical meaning.', 'caveat'));
      return panel;
    }

    function claimList(visibleClaims) {
      const section = node('section', '', 'topology-list');
      section.append(node('p', 'CLAIM INDEX', 'eyebrow'), node('h3', `${visibleClaims.length} mapped relationships`));
      if (!visibleClaims.length) {
        section.append(node('p', 'No claims match the selected source date, type, status, and company. Change a filter to see the mapped research slice.', 'empty-state'));
        return section;
      }
      for (const claim of visibleClaims.slice(0, state.topologyListLimit)) {
        const button = node('button', '', 'topology-claim-button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(state.selectedClaim === claim.id));
        const category = model.topologyCategory(claim.predicate);
        button.append(node('span', CATEGORY_LABELS[category], `topology-claim-category topology-${category}`),
          node('strong', claimLabel(claim)),
          node('span', `${STATUS_LABELS[claim.claim_status]} · sources through ${model.claimSourceDate(claim)}`, 'topology-claim-meta'));
        button.addEventListener('click', () => commitState({ selectedClaim: claim.id },
          { focus: '#topology-inspector' }));
        section.append(button);
      }
      if (visibleClaims.length > state.topologyListLimit) {
        const more = node('button', `Show ${Math.min(40, visibleClaims.length - state.topologyListLimit)} more claims`, 'quiet-button topology-show-more');
        more.id = 'topology-show-more';
        more.type = 'button';
        more.addEventListener('click', () => commitState({ topologyListLimit: state.topologyListLimit + 40 },
          { focus: '#topology-show-more' }));
        section.append(more);
      }
      return section;
    }

    function coverage(visibleClaims) {
      const allMapped = new Set(claims.flatMap(claim => [claim.subject_slug, claim.object_slug]));
      const visibleMapped = new Set(visibleClaims.flatMap(claim => [claim.subject_slug, claim.object_slug]));
      const unmapped = data.companies.filter(company => !allMapped.has(company.slug));
      const panel = node('div', '', 'topology-coverage');
      panel.append(node('strong', `${visibleClaims.length} shown claims`),
        node('span', `${visibleMapped.size} entities in view · ${allMapped.size} entities mapped in this slice · ${unmapped.length} selected companies with no mapped claim`));
      if (unmapped.length) panel.append(node('p', `Not mapped here: ${unmapped.map(company => company.name).join(', ')}. Missing lines mean no claim is recorded in this bounded review.`, 'muted'));
      return panel;
    }

    function render() {
      root.append(title('04 / TOPOLOGY', 'relationship claims',
        'explore a bounded map of dated, source-backed claims. the map is a reading aid, not a market model.'));
      const visibleClaims = model.filterTopologyClaims(claims, {
        sourceYear: state.topologySourceYear,
        category: state.topologyCategory,
        status: state.topologyStatus,
        company: state.company
      });
      root.append(controls(), coverage(visibleClaims));
      if (!claims.length) {
        root.append(node('p', 'No relationship claims are published in this export yet.', 'empty-state'));
        return;
      }
      const projection = model.topologyGraphSlice(claims, state.company);
      const visibleIds = new Set(visibleClaims.map(claim => claim.id));
      const graphClaims = projection.claims.filter(claim => visibleIds.has(claim.id));
      const layout = node('div', '', 'topology-layout');
      const map = node('section', '', 'topology-map');
      map.append(node('div', '', 'topology-map-head'));
      map.firstChild.append(node('p', 'DATED RELATIONSHIP MAP', 'eyebrow'),
        node('p', 'Select a node or line. Scroll sideways on a narrow screen.', 'muted'));
      map.append(graph(projection.claims, graphClaims), node('p',
        `Map shows ${graphClaims.length} of ${visibleClaims.length} matching claims and ${new Set(graphClaims.flatMap(claim =>
          [claim.subject_slug, claim.object_slug])).size} entities.`
        + (graphClaims.length < visibleClaims.length ? ' All matching claims are in the index below.' : '')
        + (projection.hiddenNodes ? ` Focus a company to navigate ${projection.hiddenNodes} other mapped entities.` : ''),
        'topology-map-coverage'), legend(), node('p',
        'Sources through a year means every cited source for a shown claim was published by that year. It does not mean the relationship was active then. Fiscal reporting periods elsewhere in this console are separate.', 'topology-time-note'));
      layout.append(map, inspector(visibleClaims));
      const body = node('div');
      body.append(layout, claimList(visibleClaims));
      root.append(body);
      body.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || (!state.selectedClaim && !state.company)) return;
        commitState({ selectedClaim: null, company: null }, { focus: '#topology-company' });
      });
    }

    function companySummary(slug) {
      const related = claims.filter(claim => claim.subject_slug === slug || claim.object_slug === slug);
      const section = node('section', '', 'topology-company-summary');
      section.append(node('p', 'RELATIONSHIP MAP / BOUNDED REVIEW', 'eyebrow'),
        node('h4', `${related.length} mapped relationship${related.length === 1 ? '' : 's'}`));
      if (related.length) {
        const neighbors = [...new Set(related.map(claim => claim.subject_slug === slug
          ? claim.object_slug : claim.subject_slug))].map(companyName);
        section.append(node('p', `Mapped here with ${neighbors.join(', ')}. These are dated claims, not a complete market neighborhood.`, 'muted'));
        related.slice(0, 2).forEach(claim => {
          const source = claim.sources[0];
          section.append(append(node('article', '', 'topology-company-claim'),
            node('strong', claimLabel(claim)),
            node('p', `${STATUS_LABELS[claim.claim_status]} · published ${source.source_date} · ${source.publisher}`),
            node('blockquote', source.evidence_text),
            link('Open source ↗', source.source_url)));
        });
      } else section.append(node('p', 'No relationship claim is recorded for this company in the bounded review.', 'muted'));
      const open = node('button', 'Open relationship map →', 'text-button');
      open.type = 'button';
      open.addEventListener('click', () => commitState({ view: 'topology', company: slug,
        selectedClaim: null }, { top: true, focus: '#topology-inspector' }));
      section.append(open);
      return section;
    }

    return { render, companySummary };
  }

  globalScope.LogPoseTopology = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
