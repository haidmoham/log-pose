(function exposeDataView(globalScope) {
  'use strict';

  const FAMILY_LABELS = {
    inventory: 'source inventory',
    pages: 'page captures',
    sec: 'SEC facts',
    market: 'market activity',
    topology: 'relationships'
  };
  const FAMILY_ORDER = Object.keys(FAMILY_LABELS);
  const formatCount = value => Number(value || 0).toLocaleString();

  function create({ root, state, index, discovery, commitState, persistDetail,
    openCompany, openTopology }) {
    const { node, append, link, title, svgNode } = globalScope.LogPoseUI;
    const cache = new Map();
    let inventoryRecords = null;
    let inventoryError = null;
    let inventoryLoading = false;
    let resultLimit = 60;
    let activeRequest = 0;
    const candidateById = new Map(discovery.candidates.map(item => [item.id, item]));
    const identityReviewById = new Map(discovery.identity_reviews.map(item => [item.id, item]));
    let cachedRecords = null;

    function reviewedCompanySlug(candidate) {
      if (!candidate?.identity_review_id) return null;
      const review = identityReviewById.get(candidate.identity_review_id);
      return review?.candidate_ids.includes(candidate.id) ? review.pilot_slug : null;
    }

    function readJson(path) {
      if (!cache.has(path)) {
        const pending = fetch(`./${path}`).then(response => {
          if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
          return response.json();
        }).catch(error => {
          cache.delete(path);
          throw error;
        });
        cache.set(path, pending);
      }
      return cache.get(path);
    }

    function loadInventory() {
      const path = index.discovery?.search_path;
      if (!path || inventoryRecords || inventoryError || inventoryLoading) return;
      inventoryLoading = true;
      readJson(path).then(payload => {
        if (!Array.isArray(payload.records)
            || payload.records.length !== index.counts.inventory_rows) {
          throw new Error('inventory search count differs from the build manifest');
        }
        inventoryRecords = payload.records;
        cachedRecords = null;
        inventoryLoading = false;
        if (state.view === 'data') commitState({}, { replace: true });
      }).catch(error => {
        inventoryError = error.message;
        inventoryLoading = false;
        if (state.view === 'data') commitState({}, { replace: true });
      });
    }

    function recordFamily(record) {
      return record.family;
    }

    function records() {
      if (cachedRecords) return cachedRecords;
      const inventory = (inventoryRecords || []).map(item => ({ ...item, family: 'inventory' }));
      const pages = (index.pages || []).map(item => ({ ...item, family: 'pages' }));
      const sec = (index.sec || []).map(item => ({ ...item, family: 'sec' }));
      const market = (index.market || []).map(item => ({ ...item, family: 'market' }));
      const topology = (index.topology?.claims || []).map(item => ({ ...item, family: 'topology' }));
      cachedRecords = [...inventory, ...pages, ...sec, ...market, ...topology];
      return cachedRecords;
    }

    function recordYear(record) {
      if (record.family === 'inventory' || record.family === 'market') return Number(record.year);
      if (record.family === 'pages') return Number((record.captured_at || '').slice(0, 4));
      if (record.family === 'sec') return Number((record.end_date || '').slice(0, 4));
      return Number((record.sources?.[0]?.source_date || '').slice(0, 4));
    }

    function recordCompany(record) {
      if (record.family === 'topology') return [record.subject_slug, record.object_slug];
      if (record.family === 'inventory') {
        const candidate = candidateById.get(record.candidate_id);
        const slug = reviewedCompanySlug(candidate);
        return slug ? [slug] : [];
      }
      return record.company_slug ? [record.company_slug] : [];
    }

    function recordText(record) {
      if (record.family === 'topology') {
        return [recordTitle(record), recordMeta(record), record.predicate, record.scope,
          record.interpretation, record.subject_slug, record.object_slug].join(' ');
      }
      return [FAMILY_LABELS[record.family], recordTitle(record), recordMeta(record),
        record.name, record.description, record.company_name, record.company_slug,
        record.concept_group, record.source_category, record.source_subcategory,
        record.text_status, record.excerpt, record.attribution,
        ...(record.participants || []), record.year, record.id].join(' ');
    }

    function matchingRecords() {
      const terms = state.dataQuery.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = records().filter(record =>
        (state.dataFamily === 'all' || recordFamily(record) === state.dataFamily)
        && (state.dataCompany === 'all' || recordCompany(record).includes(state.dataCompany))
        && (state.dataYear === 'all' || recordYear(record) === Number(state.dataYear))
        && terms.every(term => recordText(record).toLocaleLowerCase().includes(term)));
      if (state.dataFamily !== 'all' || terms.length || state.dataCompany !== 'all'
          || state.dataYear !== 'all') return matches;
      const byFamily = new Map(FAMILY_ORDER.map(family => [family,
        matches.filter(record => record.family === family)]));
      const inventory = byFamily.get('inventory').filter(record =>
        candidateById.get(record.candidate_id)?.pilot_match);
      inventory.sort((left, right) => right.year - left.year || left.name.localeCompare(right.name));
      const seenInventoryCandidates = new Set();
      byFamily.set('inventory', inventory.filter(item => {
        if (seenInventoryCandidates.has(item.candidate_id)) return false;
        seenInventoryCandidates.add(item.candidate_id);
        return true;
      }));
      const distinctCompanies = items => {
        const seen = new Set();
        return items.filter(item => {
          if (seen.has(item.company_slug)) return false;
          seen.add(item.company_slug);
          return true;
        });
      };
      byFamily.set('pages', distinctCompanies(byFamily.get('pages')
        .filter(item => item.selected_for_pilot)
        .sort((left, right) => right.captured_at.localeCompare(left.captured_at))));
      byFamily.set('sec', distinctCompanies(byFamily.get('sec')
        .filter(item => item.selected && item.year === 2024)
        .sort((left, right) => left.company_name.localeCompare(right.company_name))));
      byFamily.set('market', byFamily.get('market').sort((left, right) => right.year - left.year));
      const balanced = [];
      for (let row = 0; row < 4; row++) {
        for (const family of FAMILY_ORDER) {
          const item = byFamily.get(family)[row];
          if (item) balanced.push(item);
        }
      }
      return balanced;
    }

    function recordTitle(record) {
      if (record.family === 'inventory') return record.name;
      if (record.family === 'pages') return `${record.company_name} · ${record.captured_at?.slice(0, 10) || 'undated capture'}`;
      if (record.family === 'sec') return `${record.company_name} · ${String(record.concept_group || 'fact').replaceAll('_', ' ')}`;
      if (record.family === 'market') return `Cboe · ${record.year}`;
      const subject = index.companies.find(item => item.slug === record.subject_slug)?.name || record.subject_slug;
      const object = index.companies.find(item => item.slug === record.object_slug)?.name || record.object_slug;
      return `${subject} / ${object}`;
    }

    function recordMeta(record) {
      if (record.family === 'inventory') {
        const candidate = candidateById.get(record.candidate_id);
        const identity = reviewedCompanySlug(candidate) ? 'reviewed company relation'
          : candidate?.pilot_match ? 'unreviewed navigation lead' : 'source row';
        return `${record.source?.toUpperCase()} ${record.year} · ${record.source_category} · ${identity}`;
      }
      if (record.family === 'pages') return `${record.text_status} · ${formatCount(record.text_characters)} characters`;
      if (record.family === 'sec') return `${record.end_date} · filed ${record.filed_date} · ${record.selected ? 'selected' : 'candidate'}`;
      if (record.family === 'market') return `${formatCount(record.rows)} participant rows · ${formatCount(record.trading_days)} trade dates`;
      return `${record.predicate.replaceAll('_', ' ')} · ${record.claim_status.replaceAll('_', ' ')}`;
    }

    function chooseRecord(record) {
      const marketReset = record.family === 'market' && state.dataRecord !== record.id
        ? { dataMarketDay: null, dataMarketMeasure: 'total_shares', dataMarketParticipant: null }
        : {};
      commitState({ dataFamily: record.family, dataRecord: record.id, ...marketReset },
        { focus: '#data-inspector' });
    }

    function coverage() {
      const section = node('section', '', 'data-coverage');
      const metrics = [
        ['inventory', index.counts.inventory_rows, 'source rows', '14 pinned snapshots · leads'],
        ['pages', index.counts.pages ?? index.counts.page_snapshots, 'page captures', 'retained text + source trail'],
        ['sec', index.counts.sec ?? index.counts.sec_candidates, 'SEC fact candidates', 'selection visible'],
        ['market', index.counts.market_rows ?? index.counts.market_participant_rows, 'market rows', 'participant and date grain'],
        ['topology', index.counts.topology_claims, 'reviewed claims', 'source and review trail']
      ];
      for (const [family, value, label, note] of metrics) {
        const button = node('button', '', 'data-coverage-card');
        button.type = 'button';
        button.append(node('span', FAMILY_LABELS[family], 'eyebrow'),
          node('strong', formatCount(value)), node('span', label), node('small', note));
        button.addEventListener('click', () => commitState({ dataFamily: family,
          dataQuery: '', dataRecord: null }, { focus: '#data-query' }));
        section.append(button);
      }
      return section;
    }

    function deskToy() {
      const frame = node('div', '', 'desk-toy');
      frame.append(node('p', 'PICK A LENS', 'eyebrow'));
      const cradle = node('div', '', 'desk-toy-cradle');
      FAMILY_ORDER.forEach((family, index) => {
        const button = node('button', '', 'desk-toy-pendulum');
        button.type = 'button';
        button.title = FAMILY_LABELS[family];
        button.setAttribute('aria-label', `Inspect ${FAMILY_LABELS[family]}`);
        button.setAttribute('aria-pressed', String(state.dataFamily === family));
        button.style.setProperty('--toy-index', String(index));
        button.append(node('span', '', 'desk-toy-string'),
          node('span', '', 'desk-toy-ball'),
          node('span', FAMILY_LABELS[family], 'desk-toy-label'));
        button.addEventListener('click', () => commitState({ dataFamily: family,
          dataQuery: '', dataRecord: null }, { focus: '#data-query' }));
        cradle.append(button);
      });
      frame.append(cradle);
      return frame;
    }

    function controls() {
      const form = node('div', '', 'data-controls');
      const query = node('input');
      query.id = 'data-query';
      query.type = 'search';
      query.placeholder = 'search names, categories, companies, concepts…';
      query.setAttribute('aria-label', 'Search retained record metadata');
      query.value = state.dataQuery;
      query.addEventListener('input', () => {
        state.dataQuery = query.value.slice(0, 200);
        state.dataRecord = null;
        resultLimit = 60;
        commitState({}, { focus: '#data-query', replace: true });
      });
      form.append(query);
      const facets = node('div', '', 'data-facets');
      function select(label, choices, value, update) {
        const control = node('select');
        control.setAttribute('aria-label', label);
        choices.forEach(([key, name]) => control.add(new Option(name, key)));
        control.value = value;
        control.addEventListener('change', () => {
          resultLimit = 60;
          update(control.value);
        });
        return control;
      }
      facets.append(
        select('Record family', [['all', 'all evidence'], ...FAMILY_ORDER.map(family =>
          [family, FAMILY_LABELS[family]])], state.dataFamily,
        value => commitState({ dataFamily: value, dataRecord: null })),
        select('Company', [['all', 'all companies'], ...index.companies.map(company =>
          [company.slug, company.name])], state.dataCompany,
        value => commitState({ dataCompany: value, dataRecord: null })),
        select('Source or period year', [['all', 'all years'], ...Array.from({ length: 7 },
          (_, offset) => [String(2020 + offset), String(2020 + offset)])], state.dataYear,
        value => commitState({ dataYear: value, dataRecord: null })));
      form.append(facets);
      return form;
    }

    function fact(label, value) {
      return append(node('div', '', 'data-fact'), node('dt', label), node('dd', String(value ?? 'unknown')));
    }

    function metadata(record) {
      const grid = node('dl', '', 'data-facts');
      grid.append(fact('record', record.id), fact('grain', FAMILY_LABELS[record.family]));
      return grid;
    }

    function companyAction(slug) {
      const company = index.companies.find(item => item.slug === slug);
      if (!company) return null;
      const button = node('button', `inspect ${company.name} records →`, 'text-button');
      button.type = 'button';
      button.addEventListener('click', () => commitState({ view: 'data', dataFamily: 'all',
        dataCompany: slug, dataYear: 'all', dataQuery: '', dataRecord: null },
      { focus: '#data-query' }));
      return button;
    }

    function companyContext() {
      if (state.dataCompany === 'all') return null;
      const company = index.companies.find(item => item.slug === state.dataCompany);
      if (!company) return null;
      const section = node('section', '', 'data-company-context');
      const head = node('div', '', 'data-company-context-head');
      head.append(node('p', 'REVIEWED COMPANY CONTEXT', 'eyebrow'), node('h3', company.name));
      const study = node('button', 'open company study →', 'text-button');
      study.type = 'button';
      study.addEventListener('click', () => openCompany(company.slug));
      head.append(study);
      section.append(head);
      const pages = index.pages.filter(item => item.company_slug === company.slug);
      const facts = index.sec.filter(item => item.company_slug === company.slug);
      const claims = (index.topology.claims || []).filter(item =>
        item.subject_slug === company.slug || item.object_slug === company.slug);
      const linkedCandidates = discovery.candidates.filter(item =>
        reviewedCompanySlug(item) === company.slug);
      const navigationLeads = discovery.candidates.filter(item =>
        item.pilot_match?.slug === company.slug && !reviewedCompanySlug(item));
      const row = node('div', '', 'data-company-counts');
      [['captures', pages.length], ['SEC candidates', facts.length],
        ['reviewed inventory relations', linkedCandidates.length],
        ['unreviewed navigation leads', navigationLeads.length],
        ['claims', claims.length]].forEach(
        ([label, count]) => row.append(append(node('span'),
          node('strong', formatCount(count)), node('small', label))));
      section.append(row);
      const location = (index.research?.us_location_reviews || []).find(item =>
        item.slug === company.slug);
      if (location) section.append(node('p',
        `U.S. location review · ${location.source_year} · ${location.decision.replaceAll('_', ' ')} · ${location.place || location.source_note}`, 'data-company-note'));
      const events = (index.research?.financing_announcements || []).filter(item =>
        item.slug === company.slug);
      events.forEach(item => section.append(node('p',
        `Financing announcement · ${item.announced_on} · ${item.round} · ${formatCount(item.amount_usd)} USD. Company statement; selected events only.`, 'data-company-note')));
      section.append(node('p', 'Inventory links, company identity, SEC reporting, and relationship claims have separate evidence rules. Missing records do not prove absence.', 'caveat'));
      return section;
    }

    function renderInventoryDetail(record, payload, body) {
      const row = payload.rows?.find(item => item.id === record.id);
      if (!row) throw new Error('selected inventory row is absent from its partition');
      body.append(node('p', row.description || 'The pinned listing has no description.', 'data-reading'),
        append(node('dl', '', 'data-facts'),
          fact('source', `${row.source.toUpperCase()} ${row.year}`),
          fact('source category', `${row.source_category} / ${row.source_subcategory}`),
          fact('mapping', row.mapping_status),
          fact('source path', row.source_path.join('.')),
          fact('artifact hash', row.artifact_sha256),
          fact('candidate tags', row.candidate_tags.join(', ') || 'none')));
      const candidate = candidateById.get(record.candidate_id);
      if (candidate) {
        const reviewedSlug = reviewedCompanySlug(candidate);
        body.append(node('h4', 'identity status'), node('p', reviewedSlug
          ? `Reviewed relationship to ${reviewedSlug}. The listing itself does not establish independent company eligibility.`
          : candidate.pilot_match
            ? `Navigation match to ${candidate.pilot_match.slug} is unreviewed (${candidate.pilot_match.status}). Name or homepage similarity does not establish a company relationship.`
            : 'This candidate has no reviewed pilot company relationship.', 'muted'));
        if (reviewedSlug) body.append(companyAction(reviewedSlug));
      } else body.append(node('p', 'No candidate tag or reviewed company link is attached to this row.', 'muted'));
      const links = node('div', '', 'data-provenance-links');
      links.append(link('pinned source ↗', row.source_url));
      if (row.homepage_url) links.append(link('listed website ↗', row.homepage_url));
      if (row.repo_url) links.append(link('listed repository ↗', row.repo_url));
      body.append(links);
    }

    function renderPageDetail(record, payload, body) {
      const item = payload.records?.find(entry => entry.id === record.id);
      if (!item) throw new Error('selected page capture is absent from its partition');
      body.append(append(node('dl', '', 'data-facts'),
        fact('captured', item.captured_at), fact('ingested', item.ingested_at),
        fact('provider', item.provider), fact('status', item.text_status),
        fact('source hash', item.raw_sha256)));
      body.append(node('h4', 'captured text'),
        node('p', item.normalized_text || item.display_text || item.text || 'No extractable text.', 'data-reading'));
      if (item.text_truncated) body.append(node('p',
        `${formatCount(item.displayed_characters)} of ${formatCount(item.text_characters)} characters in this export. Full retained text remains in the local evidence store.`, 'caveat'));
      body.append(companyAction(item.company_slug || record.company_slug));
      if (item.archive_url) body.append(link('original archive ↗', item.archive_url));
    }

    function renderSecDetail(record, payload, body) {
      const item = payload.records?.find(entry => entry.id === record.id || entry.fact_id === record.fact_id);
      if (!item) throw new Error('selected SEC fact is absent from its partition');
      body.append(append(node('dl', '', 'data-facts'),
        fact('concept', item.concept_group || item.concept), fact('reported value', `${item.value} ${item.unit}`),
        fact('period', `${item.start_date || 'instant'} → ${item.end_date}`),
        fact('filed', item.filed_date), fact('selection', item.selection_status || (item.selected ? 'selected' : 'candidate')),
        fact('tag', item.tag), fact('accession', item.accession_number),
        fact('source hash', item.raw_sha256)));
      body.append(node('p', `Selection policy: ${item.selection_policy || payload.policy_version || 'unavailable'}. This is a retained candidate fact; only selected facts feed the company series.`, 'caveat'));
      const alternatives = (payload.records || []).filter(entry =>
        entry.concept_group === item.concept_group && entry.year === item.year);
      if (alternatives.length > 1) {
        body.append(node('h4', `${alternatives.length} retained candidates for this measure and year`));
        const list = node('div', '', 'data-alternatives');
        alternatives.forEach(entry => {
          const button = node('button', `${entry.selected ? 'selected' : entry.selection_status} · ${entry.value} ${entry.unit} · filed ${entry.filed_date}`, 'data-alternative');
          button.type = 'button';
          button.addEventListener('click', () => chooseRecord({ ...entry, family: 'sec' }));
          list.append(button);
        });
        body.append(list);
      }
      body.append(companyAction(item.company_slug || record.company_slug));
    }

    function renderMarketDetail(record, payload, body) {
      const daily = payload.daily || [];
      const participants = payload.participants || [];
      body.append(node('p', `${formatCount(daily.length)} trade dates · ${formatCount(participants.length)} participant rows. Market-wide activity, not software-company performance.`, 'caveat'));
      const day = node('select');
      day.setAttribute('aria-label', 'Trade date');
      daily.forEach(item => day.add(new Option(item.trade_date, item.trade_date)));
      if (daily.some(item => item.trade_date === state.dataMarketDay)) day.value = state.dataMarketDay;
      const measure = node('select');
      measure.setAttribute('aria-label', 'Market activity measure');
      [['total_shares', 'shares'], ['total_trade_count', 'trades'],
        ['total_notional', 'notional USD']].forEach(([key, label]) =>
        measure.add(new Option(label, key)));
      measure.value = state.dataMarketMeasure || 'total_shares';
      const chart = node('div', '', 'data-market-chart');
      const output = node('div', '', 'data-market-day');
      function drawChart() {
        const values = daily.map(item => Number(item[measure.value]));
        const maximum = Math.max(...values, 1);
        const width = 600;
        const height = 160;
        const x = index => 12 + index * (width - 24) / Math.max(1, daily.length - 1);
        const y = value => height - 15 - value / maximum * (height - 30);
        const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img',
          'aria-label': `Daily Cboe ${measure.options[measure.selectedIndex].text} for ${record.year}` });
        svg.append(svgNode('line', { x1: 12, y1: height - 15, x2: width - 12,
          y2: height - 15, class: 'data-chart-axis' }));
        svg.append(svgNode('polyline', { points: values.map((value, index) =>
          `${x(index)},${y(value)}`).join(' '), class: 'data-chart-line' }));
        const selectedIndex = daily.findIndex(item => item.trade_date === day.value);
        if (selectedIndex >= 0) {
          svg.append(svgNode('line', { x1: x(selectedIndex), y1: 8,
            x2: x(selectedIndex), y2: height - 15, class: 'data-chart-cursor' }));
          svg.append(svgNode('circle', { cx: x(selectedIndex), cy: y(values[selectedIndex]),
            r: 5, class: 'data-chart-point' }));
        }
        const hit = svgNode('rect', { x: 0, y: 0, width, height, fill: 'transparent' });
        hit.addEventListener('click', event => {
          const bounds = svg.getBoundingClientRect();
          const fraction = (event.clientX - bounds.left) / bounds.width;
          const index = Math.max(0, Math.min(daily.length - 1,
            Math.round((fraction * width - 12) / (width - 24) * (daily.length - 1))));
          day.value = daily[index].trade_date;
          persistDetail({ dataMarketDay: day.value, dataMarketParticipant: null });
          showDay();
        });
        svg.append(hit);
        chart.replaceChildren(svg, node('p', 'select a point or date to inspect its participant rows', 'caption'));
      }
      function showDay() {
        const selected = daily.find(item => item.trade_date === day.value);
        const rows = participants.filter(item => item.trade_date === day.value);
        output.replaceChildren();
        if (!selected) return;
        output.append(append(node('dl', '', 'data-facts'),
          fact('date', selected.trade_date), fact('shares', formatCount(selected.total_shares)),
          fact('trades', formatCount(selected.total_trade_count)),
          fact('notional USD', formatCount(selected.total_notional)),
          fact('participants', rows.length)));
        const table = node('table');
        table.append(append(node('thead'), append(node('tr'),
          node('th', 'participant'), node('th', 'shares'), node('th', 'trades'), node('th', 'notional USD'))));
        const tbody = node('tbody');
        function showParticipant(item) {
          const breakdown = node('div', '', 'data-participant-breakdown');
          breakdown.append(node('h4', `${item.market_participant} · ${item.trade_date}`),
            append(node('dl', '', 'data-facts'),
              ...['a', 'b', 'c'].flatMap(tape => [
                fact(`tape ${tape} shares`, formatCount(item[`tape_${tape}_shares`])),
                fact(`tape ${tape} trades`, formatCount(item[`tape_${tape}_trade_count`])),
                fact(`tape ${tape} notional USD`, formatCount(item[`tape_${tape}_notional`]))
              ])));
          const prior = output.querySelector('.data-participant-breakdown');
          if (prior) prior.replaceWith(breakdown);
          else output.append(breakdown);
        }
        rows.forEach(item => {
          const detail = node('button', item.market_participant, 'data-participant-button');
          detail.type = 'button';
          detail.addEventListener('click', () => {
            persistDetail({ dataMarketParticipant: item.id });
            showParticipant(item);
          });
          tbody.append(append(node('tr'), node('td', '', ''),
            node('td', formatCount(item.total_shares)),
            node('td', formatCount(item.total_trade_count)),
            node('td', formatCount(item.total_notional))));
          tbody.lastChild.firstChild.append(detail);
        });
        table.append(tbody);
        output.append(append(node('div', '', 'table-wrap'), table));
        const selectedParticipant = rows.find(item => item.id === state.dataMarketParticipant);
        if (selectedParticipant) showParticipant(selectedParticipant);
        drawChart();
      }
      day.addEventListener('change', () => {
        persistDetail({ dataMarketDay: day.value, dataMarketParticipant: null });
        showDay();
      });
      measure.addEventListener('change', () => {
        persistDetail({ dataMarketMeasure: measure.value });
        drawChart();
      });
      body.append(append(node('div', '', 'data-market-controls'), measure, day), chart, output);
      showDay();
      if (payload.source?.source_url) body.append(link('source file ↗', payload.source.source_url));
    }

    function renderTopologyDetail(record, body) {
      body.append(node('p', record.interpretation, 'data-reading'),
        append(node('dl', '', 'data-facts'), fact('scope', record.scope),
          fact('basis', record.claim_status), fact('time meaning', record.temporal_basis),
          fact('remaining unknown', record.alternative_or_unknown)));
      if (record.review) body.append(append(node('dl', '', 'data-facts'),
        fact('reviewer', record.review.reviewer), fact('reviewed', record.review.reviewed_at),
        fact('rationale', record.review.rationale)));
      for (const source of record.sources || []) {
        const sourcePanel = node('article', '', 'data-source');
        sourcePanel.append(node('strong', `${source.role || 'support'} · ${source.publisher} · published ${source.source_date}`),
          node('p', source.evidence_text, 'data-reading'));
        if (source.evidence_quote) sourcePanel.append(node('blockquote', source.evidence_quote));
        sourcePanel.append(link('source ↗', source.source_url));
        body.append(sourcePanel);
      }
      const history = (index.topology.review_history || []).filter(item =>
        item.candidate_id === record.database_id);
      if (history.length) {
        body.append(node('h4', 'review history'));
        history.forEach(item => body.append(node('p',
          `${item.decision} · ${item.reviewer} · ${item.reviewed_at}: ${item.rationale}`, 'data-reading')));
      }
      body.append(companyAction(record.subject_slug), companyAction(record.object_slug));
      const map = node('button', 'open claim map →', 'text-button');
      map.type = 'button';
      map.addEventListener('click', () => openTopology(record.id));
      body.append(map);
    }

    function inspector(selected) {
      const panel = node('aside', '', 'data-inspector');
      panel.id = 'data-inspector';
      panel.tabIndex = -1;
      if (!selected) {
        panel.classList.add('is-empty');
        panel.append(node('p', 'INSPECTOR', 'eyebrow'), node('h3', 'Select a record'),
          node('p', 'Open a row to read the retained evidence and its provenance here.', 'muted'));
        return panel;
      }
      panel.append(node('p', FAMILY_LABELS[selected.family], 'eyebrow'),
        node('h3', recordTitle(selected)), metadata(selected));
      const body = node('div', '', 'data-inspector-body');
      panel.append(body);
      if (selected.family === 'topology') {
        renderTopologyDetail(selected, body);
        return panel;
      }
      if (!selected.partition_path) {
        body.append(node('p', 'No partition is available for this record.', 'error'));
        return panel;
      }
      const request = ++activeRequest;
      body.append(node('p', 'loading retained record…', 'loading'));
      function load() {
        readJson(selected.partition_path).then(payload => {
          if (request !== activeRequest || state.dataRecord !== selected.id) return;
          body.replaceChildren();
          if (selected.family === 'inventory') renderInventoryDetail(selected, payload, body);
          else if (selected.family === 'pages') renderPageDetail(selected, payload, body);
          else if (selected.family === 'sec') renderSecDetail(selected, payload, body);
          else if (selected.family === 'market') renderMarketDetail(selected, payload, body);
        }).catch(error => {
          if (request !== activeRequest || state.dataRecord !== selected.id) return;
          const retry = node('button', 'retry record', 'quiet-button');
          retry.type = 'button';
          retry.addEventListener('click', load);
          body.replaceChildren(node('p', error.message, 'error'), retry);
        });
      }
      load();
      return panel;
    }

    function render() {
      activeRequest++;
      root.append(title('RESEARCH DESK / RETAINED EVIDENCE', 'research the record',
        'Search across source rows, dated page captures, reported facts, market activity, and reviewed relationships. Open a row to inspect it here.'));
      root.append(deskToy(), coverage(), controls());
      const context = companyContext();
      if (context) root.append(context);
      if ((state.dataFamily === 'all' || state.dataFamily === 'inventory')
          && !inventoryRecords && !inventoryError) loadInventory();
      if (inventoryError) {
        const retry = node('button', 'retry inventory index', 'quiet-button');
        retry.type = 'button';
        retry.addEventListener('click', () => {
          inventoryError = null;
          loadInventory();
          commitState({}, { replace: true });
        });
        root.append(append(node('p', '', 'error'), node('span', inventoryError), retry));
      }
      const hits = matchingRecords();
      const openingSet = state.dataFamily === 'all' && !state.dataQuery.trim()
        && state.dataCompany === 'all' && state.dataYear === 'all';
      const resultArea = node('div', '', 'data-workspace');
      const resultList = node('section', '', 'data-results');
      const header = node('div', '', 'data-results-head');
      header.append(node('p', `${formatCount(hits.length)} ${openingSet ? 'starting records' : 'matching records'}`
        + (!inventoryRecords && (state.dataFamily === 'all' || state.dataFamily === 'inventory')
          ? ' · loading full inventory index' : ''), 'eyebrow'),
        node('p', openingSet
          ? 'Entry points across the five record families. Inventory navigation leads are unreviewed unless a separate identity review is attached.'
          : 'Filters use record metadata. Open a result to read the retained detail.', 'muted'));
      resultList.append(header);
      const selected = hits.find(item => item.id === state.dataRecord);
      for (const record of hits.slice(0, resultLimit)) {
        const button = node('button', '', 'data-result');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(selected?.id === record.id));
        button.append(node('span', FAMILY_LABELS[record.family], 'data-result-kind'),
          node('strong', recordTitle(record)), node('span', recordMeta(record), 'data-result-meta'));
        button.addEventListener('click', () => chooseRecord(record));
        resultList.append(button);
      }
      if (hits.length > resultLimit) {
        const more = node('button', `show ${Math.min(60, hits.length - resultLimit)} more records`,
          'quiet-button data-more');
        more.type = 'button';
        more.addEventListener('click', () => {
          resultLimit += 60;
          commitState({}, { focus: '.data-more' });
        });
        resultList.append(more);
      }
      if (!hits.length && inventoryRecords) resultList.append(node('p',
        'No retained records match these filters. Clear a filter or try a broader term.', 'empty-state'));
      resultArea.append(resultList, inspector(selected));
      root.append(resultArea);
    }

    return { render };
  }

  globalScope.LogPoseDataView = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
