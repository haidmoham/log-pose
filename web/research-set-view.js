(function exposeResearchSetView(globalScope) {
  'use strict';

  const DATA_PATH = './data/research-set-mlops-2024.json';
  const GATE_LABELS = [['product', 'product'], ['private', 'private-company status'],
    ['us_base', 'U.S. base']];

  function create({ root, state, commitState, writeUrl }) {
    let payload = null;
    let error = null;
    let loading = false;
    let request = null;
    const node = (tag, text = '', className = '') => {
      const element = document.createElement(tag);
      if (text) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const append = (parent, ...children) => {
      parent.append(...children);
      return parent;
    };
    const roleName = role => typeof role === 'string'
      ? role : role?.name || role?.title || role?.role || 'unspecified';
    const uniqueSorted = values => [...new Set(values.filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));

    function setState(changes, focus) {
      commitState(changes, focus ? { focus } : {});
    }

    function load(retry = false) {
      if (payload || loading) return request;
      if (error && !retry) return null;
      error = null;
      loading = true;
      request = fetch(DATA_PATH).then(response => {
        if (!response.ok) throw new Error(`${DATA_PATH}: HTTP ${response.status}`);
        return response.json();
      }).then(result => {
        if (result.schema_version !== '1.0' || result.id !== 'mlops-2024'
            || !Array.isArray(result.members) || result.members.length !== 8
            || !Array.isArray(result.evidence)) {
          throw new Error('saved research set is incomplete or has an unsupported schema');
        }
        payload = result;
        const knownMembers = new Set(payload.members.map(member => member.id));
        const knownRoles = new Set(payload.members.flatMap(member =>
          (member.roles || []).map(roleName)));
        const knownDispositions = new Set(payload.members.map(member => member.disposition));
        let normalizeUrl = false;
        if (state.researchMember && !knownMembers.has(state.researchMember)) {
          state.researchMember = null;
          normalizeUrl = true;
        }
        if (state.researchRole !== 'all' && !knownRoles.has(state.researchRole)) {
          state.researchRole = 'all';
          normalizeUrl = true;
        }
        if (state.researchDisposition !== 'all' && !knownDispositions.has(state.researchDisposition)) {
          state.researchDisposition = 'all';
          normalizeUrl = true;
        }
        if (normalizeUrl) writeUrl(true);
      }).catch(loadError => {
        error = loadError.message;
      }).finally(() => {
        loading = false;
        if (state.view === 'research-set') render();
      });
      return request;
    }

    function selectControl(label, values, selected, parameter) {
      const wrapper = node('label', '', 'research-set-filter');
      wrapper.append(node('span', label));
      const select = node('select');
      select.setAttribute('aria-label', label);
      for (const [value, text] of values) {
        const option = node('option', text);
        option.value = value;
        option.selected = selected === value;
        select.append(option);
      }
      select.addEventListener('change', () => setState({ [parameter]: select.value },
        `select[aria-label="${label}"]`));
      wrapper.append(select);
      return wrapper;
    }

    function filterPanel(members) {
      const roles = uniqueSorted(members.flatMap(member => (member.roles || []).map(roleName)));
      const dispositions = uniqueSorted(members.map(member => member.disposition));
      const filters = node('section', '', 'research-set-controls');
      const search = node('input');
      search.type = 'search';
      search.value = state.researchQuery || '';
      search.placeholder = 'Search leads, claims, and comparison notes';
      search.setAttribute('aria-label', 'Search saved research set');
      search.addEventListener('input', () => {
        state.researchQuery = search.value.slice(0, 200);
        commitState({}, { replace: true, focus: '[aria-label="Search saved research set"]' });
      });
      filters.append(search,
        selectControl('role', [['all', 'all roles'], ...roles.map(value => [value, value])],
          state.researchRole || 'all', 'researchRole'),
        selectControl('disposition', [['all', 'all dispositions'],
          ...dispositions.map(value => [value, value.replaceAll('_', ' ')])],
        state.researchDisposition || 'all', 'researchDisposition'));
      return filters;
    }

    function memberMatches(member) {
      const query = (state.researchQuery || '').toLocaleLowerCase().trim();
      const searchable = [member.name, member.disposition, member.disposition_reason,
        member.identity?.name, ...(member.identity?.aliases || []),
        ...(member.roles || []).map(roleName), ...Object.values(member.comparison || {}),
        ...(member.claims || []).flatMap(claim => [claim.statement, claim.basis,
          ...(claim.unknowns || [])])].flat(Infinity).join(' ').toLocaleLowerCase();
      return (state.researchRole === 'all' || (member.roles || []).map(roleName).includes(state.researchRole))
        && (state.researchDisposition === 'all' || member.disposition === state.researchDisposition)
        && (!query || query.split(/\s+/).every(term => searchable.includes(term)));
    }

    function gateValue(member, gateKey) {
      const gate = member.gates?.[gateKey];
      const decision = gate?.decision || 'unknown';
      return decision.replaceAll('_', ' ');
    }

    function compactComparison(members) {
      const section = node('section', '', 'research-set-comparison');
      section.append(node('div', '', 'research-set-section-head'));
      section.lastChild.append(node('p', 'COMPACT COMPARISON', 'eyebrow'),
        node('h3', `${members.length} of ${payload.members.length} leads`),
        node('p', 'Filters narrow the table; the saved cohort keeps all eight leads available.', 'muted'));
      const scroller = node('div', '', 'research-set-table-wrap');
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', 'Scrollable research set comparison');
      scroller.tabIndex = 0;
      const table = node('table', '', 'research-set-table');
      const head = node('thead');
      const headerRow = node('tr');
      ['lead / disposition', 'roles', 'product', 'private', 'U.S. base', 'buyer', 'offering', 'distribution']
        .forEach(label => headerRow.append(node('th', label)));
      head.append(headerRow);
      const body = node('tbody');
      for (const member of members) {
        const row = node('tr');
        const lead = node('th', '', 'research-set-lead');
        lead.scope = 'row';
        const open = node('button', member.name, 'research-set-open');
        open.type = 'button';
        open.setAttribute('aria-pressed', String(state.researchMember === member.id));
        open.addEventListener('click', () => setState({ researchMember: member.id }, 'button.research-set-open'));
        lead.append(open, node('span', member.disposition.replaceAll('_', ' '), 'research-set-disposition'));
        row.append(lead,
          cell((member.roles || []).map(roleName).join(', ')),
          cell(gateValue(member, 'product')),
          cell(gateValue(member, 'private')),
          cell(gateValue(member, 'us_base')),
          cell(member.comparison?.buyer || 'unknown'),
          cell(member.comparison?.offering || 'unknown'),
          cell(member.comparison?.distribution || 'unknown'));
        body.append(row);
      }
      if (!members.length) {
        const row = node('tr');
        const empty = node('td', 'No leads match these filters.');
        empty.colSpan = 8;
        row.append(empty);
        body.append(row);
      }
      table.append(head, body);
      scroller.append(table);
      section.append(scroller);
      return section;
    }

    function cell(value) {
      const element = node('td', String(value ?? 'unknown'));
      return element;
    }

    function evidenceIds(member) {
      const ids = new Set();
      for (const [, gateKey] of GATE_LABELS) {
        for (const id of member.gates?.[gateKey]?.evidence_ids || []) ids.add(id);
      }
      for (const claim of member.claims || []) {
        for (const id of [...(claim.evidence_ids || []), ...(claim.counterevidence_ids || [])]) ids.add(id);
      }
      return [...ids];
    }

    function sourceLink(url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        const link = node('a', 'source provenance ↗');
        link.href = parsed.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
      } catch {
        return null;
      }
    }

    function passageCard(item) {
      const card = node('article', '', 'research-set-evidence');
      card.append(node('p', `${item.publication_date || 'undated'} · captured ${item.captured_at || 'unknown'}`,
        'eyebrow'), node('h4', item.title || 'Untitled evidence'),
        node('p', item.publisher || 'Publisher not recorded', 'muted'),
        node('blockquote', item.passage || 'No retained passage is available.'));
      if (item.review_note) card.append(node('p', item.review_note, 'research-set-review-note'));
      const provenance = node('dl', '', 'research-set-provenance');
      [['artifact SHA-256', item.artifact_sha256], ['record id', item.record_id]]
        .filter(([, value]) => value)
        .forEach(([label, value]) => provenance.append(node('dt', label), node('dd', value)));
      if (provenance.children.length) card.append(provenance);
      const link = sourceLink(item.url);
      if (link) card.append(link);
      return card;
    }

    function memberDetail(member) {
      const detail = node('section', '', 'research-set-detail');
      const head = node('div', '', 'research-set-detail-head');
      const close = node('button', 'close ×', 'quiet-button');
      close.type = 'button';
      close.addEventListener('click', () => setState({ researchMember: null }));
      head.append(append(node('div'), node('p', 'LEAD RECORD / AS OF 2024-12-31', 'eyebrow'),
        node('h3', member.name), node('p', member.disposition_reason || 'No disposition note recorded.', 'muted')),
      close);
      detail.append(head);
      const identity = member.identity || {};
      detail.append(append(node('section', '', 'research-set-identity'),
        node('h4', 'Identity review'),
        node('p', `${identity.status || 'unreviewed'} · ${identity.name || member.name}`),
        node('p', (identity.aliases || []).length
          ? `Aliases: ${identity.aliases.join(', ')}` : 'No aliases recorded.')));
      const gates = node('div', '', 'research-set-gates');
      for (const [key, label] of GATE_LABELS) {
        const gate = member.gates?.[key] || {};
        gates.append(append(node('article', '', 'research-set-gate'),
          node('p', label, 'eyebrow'), node('strong', (gate.decision || 'unknown').replaceAll('_', ' ')),
          node('p', gate.note || 'No note recorded.', 'muted')));
      }
      detail.append(gates);
      const comparison = node('section', '', 'research-set-comparison-notes');
      comparison.append(node('h4', 'Comparison notes'));
      for (const key of ['buyer', 'offering', 'distribution', 'financing', 'competitive_context', 'unknowns']) {
        const value = member.comparison?.[key];
        const text = Array.isArray(value) ? value.join('; ') : value;
        comparison.append(append(node('p'), node('strong', key.replaceAll('_', ' ') + ': '),
          document.createTextNode(String(text || 'unknown'))));
      }
      detail.append(comparison);
      const claims = node('section', '', 'research-set-claims');
      claims.append(node('h4', 'Claims and limits'));
      (member.claims || []).forEach(claim => claims.append(append(node('article', '', 'research-set-claim'),
        node('p', claim.statement, 'research-set-claim-statement'),
        node('p', claim.basis || 'Basis not recorded.', 'muted'),
        ...((claim.unknowns || []).length ? [node('p', `Unknowns: ${claim.unknowns.join('; ')}`, 'research-set-review-note')] : []))));
      detail.append(claims);
      const evidenceById = new Map(payload.evidence.map(item => [item.id, item]));
      const references = evidenceIds(member);
      const evidenceSection = node('section', '', 'research-set-passages');
      evidenceSection.append(node('h4', `Retained evidence passages · ${references.length}`),
        node('p', 'Read the captured passage first. Source links identify provenance. A publisher statement records what was said; it does not establish economic truth.', 'caveat'));
      const grid = node('div', '', 'research-set-evidence-grid');
      references.forEach(id => {
        const item = evidenceById.get(id);
        if (item) grid.append(passageCard(item));
        else grid.append(node('p', `Evidence reference ${id} is missing from this set.`, 'error'));
      });
      if (!references.length) grid.append(node('p', 'No evidence passage is linked to this lead.', 'muted'));
      evidenceSection.append(grid);
      detail.append(evidenceSection);
      return detail;
    }

    function render() {
      if (state.view !== 'research-set') return;
      if (!payload && !error) {
        root.setAttribute('aria-busy', 'true');
        root.replaceChildren(node('p', 'loading the saved research set…', 'loading'));
        load();
        return;
      }
      root.setAttribute('aria-busy', 'false');
      if (error) {
        const retry = node('button', 'retry loading research set', 'quiet-button');
        retry.type = 'button';
        retry.addEventListener('click', () => { load(true); render(); });
        root.replaceChildren(append(node('section', '', 'research-set-error'),
          node('p', 'SAVED RESEARCH SET', 'eyebrow'), node('h2', 'research set unavailable'),
          node('p', error, 'error'), retry));
        return;
      }
      const members = payload.members;
      const reviewed = members.filter(member => member.identity?.status === 'reviewed').length;
      const unreviewed = members.length - reviewed;
      const visible = members.filter(memberMatches);
      const heading = node('header', '', 'research-set-heading');
      heading.append(node('p', `SAVED COHORT / ${payload.as_of}`, 'eyebrow'),
        node('h2', payload.title || 'MLOps research set'),
        node('p', 'A fixed eight-lead comparison. Evidence describes dated publisher statements and review decisions; it does not establish adoption, revenue, customer outcomes, or company performance.', 'view-note'));
      const identityMetric = append(node('div', '', 'research-set-identity-count'),
        node('strong', `${reviewed} / ${members.length}`), node('span', 'identities reviewed'),
        node('small', `${unreviewed} unreviewed or unresolved identities`));
      root.replaceChildren(heading, identityMetric, filterPanel(members),
        compactComparison(visible));
      const selected = members.find(member => member.id === state.researchMember);
      if (selected) root.append(memberDetail(selected));
    }

    return { render };
  }

  globalScope.LogPoseResearchSetView = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
