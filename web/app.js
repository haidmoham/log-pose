const root = document.querySelector('#view');
const tabs = [...document.querySelectorAll('[data-view]')];
const pinCount = document.querySelector('#pin-count');
const model = window.LogPoseResearchModel;
const { node, append, link, title, metric, table } = window.LogPoseUI;
const seriesChart = (...args) => window.LogPoseUI.seriesChart(model, ...args);
const state = { view: 'data', year: 2024, category: 'all', query: '', company: null,
  dataFamily: 'all', dataQuery: '', dataCompany: 'all', dataYear: 'all', dataRecord: null,
  dataMarketDay: null, dataMarketMeasure: 'total_shares', dataMarketParticipant: null,
  searchYear: 'all', searchSource: 'all', searchType: 'all', searchUs: 'all',
  inventoryArtifact: 'cncf-2026', inventoryQuery: '',
  selectedCandidate: null, selectedProvider: null, searchLimit: 30, compareSlugs: [],
  topologySourceYear: 'all', topologyCategory: 'all', topologyStatus: 'all',
  topologyListLimit: 40, selectedClaim: null };
let data;
let discovery;
let dataIndex;
let occurrenceById;
let identityReviewById;
let financialIndex;
let exploreView;
let topologyView;
let dataView;

function categoryName(value) {
  return {
    ai_automation: 'AI / automation',
    data_infrastructure: 'Data infrastructure',
    developer_tools: 'Developer tools',
    security_observability: 'Security / observability'
  }[value] || value;
}

function financingFor(slug) {
  return data.financing_announcements.filter(event => event.slug === slug);
}

function locationReviewFor(slug) {
  return data.us_location_reviews.find(review => review.slug === slug);
}

function locationReviewInSelectedYear(slug) {
  const review = locationReviewFor(slug);
  return review && (state.searchYear === 'all' || review.source_year === Number(state.searchYear))
    ? review : null;
}

function identityReviewFor(candidate) {
  return candidate.identity_review_id
    ? identityReviewById.get(candidate.identity_review_id) : null;
}

function candidateLocationFor(candidate) {
  const review = identityReviewFor(candidate);
  if (!review) return null;
  if (review.pilot_slug) return locationReviewInSelectedYear(review.pilot_slug);
  const evidence = review.us_evidence;
  if (!evidence || (state.searchYear !== 'all'
    && evidence.source_year !== Number(state.searchYear))) return null;
  return { ...evidence, decision: 'documented_us_base' };
}

function providerLocationInSelectedYear(provider) {
  return provider.us_evidence.find(item => state.searchYear === 'all'
    || item.source_year === Number(state.searchYear));
}

function formatNumber(value, places = 1) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: places }).format(value);
}

function money(value) {
  if (value === null || value === undefined) return '—';
  const absolute = Math.abs(value);
  const scale = absolute >= 1e9 ? 1e9 : 1e6;
  return (value < 0 ? '−' : '') + '$' + formatNumber(absolute / scale, scale === 1e9 ? 2 : 1)
    + (scale === 1e9 ? 'b' : 'm');
}

function percent(value) {
  if (value === null) return '—';
  return (value > 0 ? '+' : value < 0 ? '−' : '') + formatNumber(Math.abs(value)) + '%';
}

function evidence(slug, year) {
  return data.evidence.find(item => item.slug === slug && item.year === year);
}

function financials(slug, year) {
  return model.financialsFor(financialIndex, slug, year);
}

function companyDetail(slug) {
  const company = data.companies.find(item => item.slug === slug);
  const section = node('section', '', 'detail-panel');
  const close = node('button', 'Close ×', 'quiet-button');
  close.type = 'button';
  close.addEventListener('click', () => { state.company = null; render(); });
  section.append(append(node('div', '', 'detail-head'),
    append(node('div'), node('p', 'COMPANY RECORD / 2021–2024', 'eyebrow'), node('h3', company.name)),
    close));
  const openRecords = node('button', 'inspect all retained records →', 'text-button');
  openRecords.type = 'button';
  openRecords.addEventListener('click', () => commitState({ view: 'data', dataFamily: 'all',
    dataCompany: slug, dataYear: 'all', dataQuery: '', dataRecord: null },
  { top: true, focus: '#data-query' }));
  section.append(openRecords);
  const locationReview = locationReviewFor(slug);
  if (locationReview) section.append(append(node('div', '', 'location-review'),
    node('p', 'U.S. LOCATION REVIEW / ' + locationReview.source_year, 'eyebrow'),
    node('p', locationReview.source_note, 'muted'),
    link('Open location source ↗', locationReview.source_url),
    node('p', 'A dated office or headquarters statement does not establish status in every study year.', 'caveat')));
  const grid = node('div', '', 'year-grid');
  for (const year of data.years) {
    const item = evidence(slug, year);
    const card = node('article', '', 'year-card');
    const status = item.status === 'retrieved' ? 'Text captured' : 'Short text';
    card.append(append(node('div', '', 'year-card-head'), node('h4', String(year)),
      node('span', status, 'pill ' + item.status)));
    const quote = data.reviewed_quotes.find(entry => entry.snapshot_id === item.snapshot_id);
    if (item.captured_at) {
      card.append(node('p', 'Captured ' + item.captured_at.slice(0, 10)
        + ' · ' + item.provider, 'muted'));
      if (quote) card.append(node('p', '“' + quote.quote + '”', 'source-quote'),
        node('p', 'Reviewed source passage', 'caption'));
      else card.append(node('p', item.status === 'short'
        ? 'The stored page yielded too little visible text for a product claim.'
        : 'Visible text is available; this page has no reviewed claim in the fixed audit.', 'muted'));
      if (item.status === 'retrieved') card.append(node('p', item.excerpt
        + (item.text_characters > 500 ? '…' : ''), 'excerpt'));
      const inspectCapture = node('button', 'inspect captured text →', 'text-button');
      inspectCapture.type = 'button';
      inspectCapture.addEventListener('click', () => commitState({ view: 'data',
        dataFamily: 'pages', dataCompany: slug, dataYear: 'all', dataQuery: '',
        dataRecord: `page:${item.snapshot_id}` }, { top: true, focus: '#data-inspector' }));
      card.append(inspectCapture);
      if (item.warc_truncated) card.append(node('span', 'WARC body truncated', 'pill warning'));
      const sourceFoot = node('div', '', 'source-foot');
      sourceFoot.append(item.provider === 'wayback'
        ? link('Open archived page ↗', item.archive_url)
        : node('span', 'Common Crawl WARC record'));
      sourceFoot.append(node('span', 'Original URL ' + item.source_url),
        node('span', 'Snapshot ' + item.snapshot_id + ' · SHA-256 ' + item.raw_sha256.slice(0, 12) + '…'));
      if (item.provider_record_id) sourceFoot.append(append(node('details'),
        node('summary', 'Capture locator'), node('code', item.provider_record_id)));
      card.append(sourceFoot);
    } else card.append(node('p', 'No stored capture for this year.', 'muted'));
    if (company.cik) {
      const result = financials(slug, year);
      card.append(node('p', 'SEC period ending ' + (result.periodEnd || 'unavailable')
        + ' · Revenue ' + money(result.revenue), 'year-finance'));
      const inspectFacts = node('button', 'inspect SEC fact candidates →', 'text-button');
      inspectFacts.type = 'button';
      inspectFacts.addEventListener('click', () => commitState({ view: 'data',
        dataFamily: 'sec', dataCompany: slug, dataYear: String(year),
        dataQuery: '', dataRecord: null }, { top: true, focus: '#data-query' }));
      card.append(inspectFacts);
    }
    grid.append(card);
  }
  section.append(grid, node('p', 'A company page records what its publisher said at capture time. It does not verify adoption, customer outcomes, or when a feature first appeared.', 'caveat'));
  section.append(topologyView.companySummary(slug));
  const announcements = financingFor(slug);
  if (announcements.length) {
    const funding = node('section', '', 'funding-events');
    funding.append(node('h4', 'Financing announcements'));
    announcements.forEach(event => funding.append(append(node('article', '', 'funding-event'),
      node('p', event.announced_on + ' · ' + event.round, 'eyebrow'),
      node('p', money(event.amount_usd) + ' announced'
        + (event.valuation_usd ? ' · ' + money(event.valuation_usd) + ' valuation' : ''), 'year-finance'),
      ...(event.valuation_basis ? [node('p', event.valuation_basis, 'caption')] : []),
      link('Company announcement ↗', event.source_url))));
    funding.append(node('p', 'Selected company statements. Amounts and valuations are claims in the linked announcements; this is not a complete financing history.', 'caveat'));
    section.append(funding);
  }
  return section;
}

function yearControl() {
  const select = node('select');
  select.setAttribute('aria-label', 'Select period-end year');
  data.years.forEach(year => select.add(new Option('Periods ending ' + year, year)));
  select.value = state.year;
  select.addEventListener('change', () => commitState({ year: Number(select.value) }));
  return select;
}

function bar(value, maximum) {
  const track = node('div', '', 'bar-track');
  const fill = node('span', '', 'bar-fill');
  fill.style.width = Number.isFinite(value) && maximum > 0
    ? Math.max(2, value / maximum * 100) + '%' : '0';
  return append(track, fill);
}

function writeUrl(replace = false) {
  const query = model.toUrlParams(state);
  const url = location.pathname + (query ? `?${query}` : '');
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

function commitState(changes, options = {}) {
  Object.assign(state, changes);
  render();
  writeUrl(Boolean(options.replace));
  if (options.top) root.scrollIntoView({ block: 'start' });
  if (options.focus) document.querySelector(options.focus)?.focus();
}

function pinButton(company, className = 'quiet-button') {
  const selected = state.compareSlugs.includes(company.slug);
  const atCapacity = !selected && state.compareSlugs.length >= model.MAX_PINNED;
  const button = node('button', selected ? 'unpin' : atCapacity ? '4 pinned' : 'pin to compare', className);
  button.type = 'button';
  button.disabled = atCapacity;
  button.dataset.pin = company.slug;
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    state.compareSlugs = model.togglePinned(state.compareSlugs, company.slug);
    render();
    writeUrl();
    document.querySelector(`[data-pin="${company.slug}"]`)?.focus();
  });
  return button;
}

function companySeries(company, key) {
  return data.years.map(year => financials(company.slug, year)[key]);
}

function overviewCompanyPanel(company) {
  const section = node('section', '', 'overview-inspector');
  const current = financials(company.slug, state.year);
  section.append(append(node('div', '', 'inspector-head'),
    append(node('div'), node('p', 'selected company / public subset', 'eyebrow'),
      node('h3', company.name), node('p', categoryName(company.category), 'muted')),
    pinButton(company)));
  const numbers = node('div', '', 'inspector-numbers');
  numbers.append(metric(money(current.revenue), 'revenue', 'reported period ending ' + (current.periodEnd || 'unknown')),
    metric(percent(current.growth), 'change', 'versus prior selected period'),
    metric(percent(current.margin), 'net income margin', 'aligned reported periods'));
  section.append(numbers);
  const charts = node('div', '', 'inspector-charts');
  const revenue = append(node('div', '', 'trend-panel'),
    node('p', 'revenue / usd', 'eyebrow'), node('h4', 'four reported periods'),
    seriesChart(companySeries(company, 'revenue'), data.years, money,
      `${company.name} reported revenue, 2021 through 2024`));
  const margins = append(node('div', '', 'trend-panel'),
    node('p', 'net income margin / percent', 'eyebrow'), node('h4', 'same-period revenue and net income'),
    seriesChart(companySeries(company, 'margin'), data.years, percent,
      `${company.name} net income margin, 2021 through 2024`));
  charts.append(revenue, margins);
  const inspect = node('button', 'inspect dated evidence →', 'text-button');
  inspect.type = 'button';
  inspect.addEventListener('click', () => commitState({
    view: 'explore', company: company.slug, query: company.name, category: 'all',
    searchYear: 'all', searchSource: 'all', searchType: 'all', searchUs: 'all'
  }, { top: true, focus: '#company-detail' }));
  section.append(charts, node('p', 'period-end-year buckets can reflect different fiscal calendars. change compares adjacent periods for the same company; missing values remain gaps.', 'caveat'), inspect);
  return section;
}

function overviewRanking(companies, selectedSlug) {
  const panel = node('section', '', 'ranking-panel');
  panel.append(node('p', 'public subset / selected period', 'eyebrow'),
    node('h3', 'reported revenue, growth, and margin'),
    append(node('div', '', 'rank-legend'), node('span', 'company'), node('span', 'revenue'),
      node('span', 'usd'), node('span', 'change'), node('span', 'margin')));
  const maximum = Math.max(...companies.map(company => financials(company.slug, state.year).revenue || 0));
  companies.forEach(company => {
    const current = financials(company.slug, state.year);
    const button = node('button', '', 'rank-row');
    button.type = 'button';
    button.dataset.company = company.slug;
    if (selectedSlug === company.slug) button.setAttribute('aria-current', 'true');
    button.setAttribute('aria-pressed', String(selectedSlug === company.slug));
    button.setAttribute('aria-label', `inspect ${company.name}`);
    button.append(node('strong', company.name), bar(current.revenue, maximum),
      node('span', money(current.revenue), 'rank-value'),
      node('span', percent(current.growth), current.growth >= 0 ? 'positive' : 'negative'),
      node('span', percent(current.margin), current.margin >= 0 ? 'positive' : 'negative'));
    button.addEventListener('click', () => {
      if (selectedSlug === company.slug) {
        button.focus();
        return;
      }
      commitState({ company: company.slug }, { focus: `[data-company="${company.slug}"]` });
    });
    panel.append(button);
  });
  return panel;
}

function coverageStrip() {
  const extractable = data.evidence.filter(item => item.status === 'retrieved').length;
  const panel = node('section', '', 'coverage-strip');
  panel.append(metric(String(data.companies.length), 'selected companies', 'purposive cohort'),
    metric(`${extractable} / 80`, 'extractable pages', 'four dated cells each'),
    metric('10', 'public issuers', 'four reported periods'),
    metric(String(discovery.provider_candidates.length), 'provider leads', 'identity reviewed'),
    metric(String(data.reviewed_quotes.length), 'reviewed passages', 'fixed evidence audit'));
  return panel;
}

function marketDetails() {
  const details = node('details', '', 'desk-disclosure');
  details.append(node('summary', 'market-wide context / Cboe activity'));
  const body = node('div', '', 'disclosure-body');
  const panels = node('div', '', 'market-panels');
  const measures = [
    ['mean_daily_notional', 'mean daily notional', 'usd billions', 1e9],
    ['mean_daily_shares', 'mean daily shares', 'billions of shares', 1e9],
    ['mean_daily_trades', 'mean daily trades', 'millions of trades', 1e6]
  ];
  measures.forEach(([key, name, unit, scale]) => {
    const panel = append(node('section', '', 'market-panel'), node('p', unit, 'eyebrow'), node('h3', name));
    const maximum = Math.max(...data.market.map(item => item[key]));
    data.market.forEach(item => panel.append(append(node('div', '', 'market-row'),
      node('span', String(item.year)), bar(item[key], maximum), node('strong', formatNumber(item[key] / scale)))));
    panels.append(panel);
  });
  body.append(panels, node('p', '19,093 stored participant-day rows from four annual Cboe files. this is all U.S. equity activity, not software-company performance.', 'caveat'));
  details.append(body);
  return details;
}

function sourceDetails() {
  const details = node('details', '', 'desk-disclosure');
  details.append(node('summary', 'coverage, methods, and pinned inventories'));
  const body = node('div', '', 'disclosure-body');
  const rows = discovery.artifacts.map(item => append(node('tr'),
    node('td', item.source.toUpperCase()), node('td', String(item.year)),
    node('td', item.raw_item_count.toLocaleString()), node('td', item.mapped_occurrence_count.toLocaleString()),
    append(node('td'), link(item.commit.slice(0, 12) + ' ↗', item.url))));
  body.append(node('p', 'directory membership is a dated lead. identity, U.S. location, and company eligibility are reviewed separately. the selected cohort is not a representative market sample.', 'caveat'),
    table(['source', 'year', 'raw items', 'mapped occurrences', 'pinned file'], rows),
    node('p', `SEC facts use ${data.financials.policy_version}; filings through ${data.financials.as_of}. price series, market share, customer traction, and valuation remain unavailable.`, 'muted'));
  details.append(body);
  return details;
}

function renderOverview() {
  root.append(title('02 / SELECTED COMPANY RESEARCH · 2021–2024', 'public-company comparison',
    'select a company to inspect. pin up to four to compare.'));
  const inventoryYears = discovery.artifacts.map(artifact => artifact.year);
  const exploreEntry = node('section', '', 'overview-inventory-entry');
  exploreEntry.append(node('p', 'WIDER SOURCE INVENTORY', 'eyebrow'),
    node('strong', `${Math.min(...inventoryYears)}–${Math.max(...inventoryYears)} · `
      + `${discovery.candidates.length.toLocaleString()} candidate keys`),
    node('p', 'Search pinned software inventories by year and source. Directory rows are leads; the company and relationship review is narrower.', 'muted'));
  const exploreButton = node('button', 'explore source rows →', 'text-button');
  exploreButton.type = 'button';
  exploreButton.addEventListener('click', () => commitState({ view: 'explore',
    searchYear: 'all', searchType: 'all', query: '', company: null }, { top: true }));
  exploreEntry.append(exploreButton);
  root.append(exploreEntry);
  const publicCompanies = data.companies.filter(company => company.cik)
    .sort((left, right) => (financials(right.slug, state.year).revenue || -Infinity)
      - (financials(left.slug, state.year).revenue || -Infinity));
  const selected = publicCompanies.find(company => company.slug === state.company) || publicCompanies[0];
  const controls = append(node('div', '', 'section-controls'), yearControl(),
    node('p', `ranking: SEC periods ending ${state.year} · inspector charts: all four periods · selected facts through ${data.financials.as_of}`, 'muted'));
  const dashboard = node('div', '', 'overview-grid');
  dashboard.append(overviewRanking(publicCompanies, selected.slug), overviewCompanyPanel(selected));
  root.append(controls, dashboard, coverageStrip(), marketDetails(), sourceDetails());
}

function comparePicker() {
  const panel = node('section', '', 'compare-picker');
  panel.append(node('p', `pin up to ${model.MAX_PINNED} selected companies`, 'eyebrow'));
  const controls = node('div', '', 'pin-controls');
  data.companies.forEach(company => controls.append(pinButton(company, 'pin-chip')));
  data.companies.forEach((company, index) => {
    controls.children[index].prepend(company.name + ' · ');
  });
  panel.append(controls);
  return panel;
}

function compareFacts(companies) {
  const headers = ['measure', ...companies.map(company => company.name)];
  const measures = [
    ['category', company => categoryName(company.category)],
    [`revenue / ${state.year}`, company => company.cik ? money(financials(company.slug, state.year).revenue) : 'no SEC series'],
    ['change vs prior', company => company.cik ? percent(financials(company.slug, state.year).growth) : '—'],
    ['net income margin', company => company.cik ? percent(financials(company.slug, state.year).margin) : '—'],
    ['reported period', company => {
      const result = company.cik ? financials(company.slug, state.year) : null;
      return result?.periodStart ? `${result.periodStart} to ${result.periodEnd}` : '—';
    }],
    ['filing trail', company => {
      const result = company.cik ? financials(company.slug, state.year) : null;
      return result?.filed ? `${result.filed} · ${result.accession || 'no accession'}` : '—';
    }],
    ['extractable pages', company => `${data.evidence.filter(item => item.slug === company.slug && item.status === 'retrieved').length} / 4`],
    ['U.S. location review', company => {
      const review = locationReviewFor(company.slug);
      return review ? `${review.source_year} · ${review.decision.replaceAll('_', ' ')}` : 'unreviewed';
    }],
    ['inspect', company => {
      const button = node('button', 'dated evidence →', 'text-button');
      button.type = 'button';
      button.addEventListener('click', () => commitState({
        view: 'explore', company: company.slug, query: company.name, category: 'all',
        searchYear: 'all', searchSource: 'all', searchType: 'all', searchUs: 'all'
      }, { top: true, focus: '#company-detail' }));
      return button;
    }]
  ];
  return table(headers, measures.map(([label, read]) => append(node('tr'), node('td', label),
    ...companies.map(company => {
      const value = read(company);
      const cell = node('td');
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      return cell;
    }))));
}

function compareEvidence(companies) {
  const headers = ['source year', ...companies.map(company => company.name)];
  const rows = data.years.map(year => append(node('tr'), node('td', String(year)),
    ...companies.map(company => {
      const item = evidence(company.slug, year);
      const cell = node('td');
      if (!item?.snapshot_id) return append(cell, node('span', 'no stored capture', 'muted'));
      cell.append(node('span', `${item.status} · ${item.captured_at.slice(0, 10)} · ${item.provider}`),
        link(item.provider === 'wayback' ? ' archived page ↗' : ' WARC record ↗',
          item.archive_url || item.source_url));
      return cell;
    })));
  return table(headers, rows);
}

function renderCompare() {
  root.append(title('03 / SELECTED COMPANY RESEARCH', 'compare companies',
    'review selected periods, filing trails, and dated source coverage.'));
  root.append(append(node('div', '', 'section-controls'), yearControl(),
    node('p', 'missing evidence is shown as missing, never as zero.', 'muted')), comparePicker());
  const companies = state.compareSlugs.map(slug => data.companies.find(company => company.slug === slug)).filter(Boolean);
  if (!companies.length) {
    root.append(node('p', 'pin two or more companies to begin a comparison.', 'empty-state'));
    return;
  }
  root.append(node('h3', 'reported facts and coverage', 'section-title'), compareFacts(companies),
    append(node('p', '', 'source-inline'),
      node('span', `selected facts through ${data.financials.as_of} · `),
      link('SEC companyfacts source ↗', data.financials.artifact_url)));
  const series = node('div', '', 'comparison-series');
  companies.filter(company => company.cik).forEach(company => series.append(append(node('section', '', 'trend-panel'),
    node('p', 'reported revenue / usd', 'eyebrow'), node('h4', company.name),
    seriesChart(companySeries(company, 'revenue'), data.years, money,
      `${company.name} reported revenue, 2021 through 2024`))));
  if (series.children.length) root.append(node('h3', 'four-period revenue paths', 'section-title'), series,
    node('p', 'each chart uses its own revenue scale and that company’s selected SEC periods. compare direction and the labeled values; fiscal calendars differ.', 'caveat'));
  root.append(node('h3', 'dated source coverage', 'section-title'), compareEvidence(companies), sourceDetails());
}

function render() {
  if (!data || !exploreView || !topologyView || !dataView) return;
  topologyView.dispose();
  tabs.forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  root.replaceChildren();
  root.setAttribute('aria-busy', 'false');
  pinCount.textContent = String(state.compareSlugs.length);
  if (state.view === 'data') dataView.render();
  else if (state.view === 'overview') renderOverview();
  else if (state.view === 'compare') renderCompare();
  else if (state.view === 'topology') topologyView.render();
  else exploreView.render();
}

tabs.forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.view;
  commitState({ view, company: view === 'explore' || view === 'data' ? null : state.company,
    selectedCandidate: null, selectedProvider: null }, { top: true });
}));

function routeState() {
  const slugs = new Set([...data.companies, ...(data.market_topology?.entities || data.market_topology?.nodes || [])]
    .map(company => company.slug));
  const artifacts = ['cncf-2026', ...discovery.artifacts.map(artifact => `${artifact.source}-${artifact.year}`)
    .filter(key => key !== 'cncf-2026')];
  const pilotSlugs = new Set(data.companies.map(company => company.slug));
  return model.parseUrlState(location.search, slugs, data.years, artifacts, pilotSlugs);
}

window.addEventListener('popstate', () => {
  const fromUrl = routeState();
  Object.assign(state, {
    ...fromUrl,
    compareSlugs: fromUrl.pinned
  });
  render();
});

Promise.all(['./dashboard.json', './discovery.json', './data/index.json'].map(url =>
  fetch(url).then(response => {
    if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
    return response.json();
  })))
  .then(([pilot, pulled, researchIndex]) => {
    model.validateExports(pilot, pulled);
    if (researchIndex.schema_version !== '1.0' || !researchIndex.counts
        || !Array.isArray(researchIndex.pages) || !Array.isArray(researchIndex.sec)
        || !Array.isArray(researchIndex.market)) {
      throw new Error('research index is incomplete');
    }
    data = pilot;
    discovery = pulled;
    dataIndex = researchIndex;
    const inventoryYears = pulled.artifacts.map(artifact => artifact.year);
    document.querySelector('#inventory-window').textContent = inventoryYears.length
      ? `${Math.min(...inventoryYears)}–${Math.max(...inventoryYears)}${pulled.artifacts.some(
        artifact => artifact.coverage_status === 'partial_year_snapshot') ? ' / partial' : ''}`
      : 'unavailable';
    financialIndex = model.buildFinancialIndex(pilot.financials.cells);
    occurrenceById = new Map(pulled.occurrences.map(item => [item.id, item]));
    identityReviewById = new Map(pulled.identity_reviews.map(item => [item.id, item]));
    exploreView = window.LogPoseExplore.create({
      root, state, data, discovery, occurrenceById, identityReviewById, model,
      categoryName, financingFor, locationReviewFor, locationReviewInSelectedYear,
      identityReviewFor, candidateLocationFor, providerLocationInSelectedYear,
      money, financials, companyDetail, commitState, writeUrl, pinCount
    });
    topologyView = window.LogPoseTopology.create({ root, state, data, model, commitState });
    dataView = window.LogPoseDataView.create({
      root, state, index: dataIndex, discovery, commitState,
      persistDetail: changes => { Object.assign(state, changes); writeUrl(true); },
      openCompany: slug => commitState({ view: 'explore', company: slug, query: '',
        searchYear: 'all', searchType: 'pilot', category: 'all' }, { top: true, focus: '#company-detail' }),
      openTopology: claimId => commitState({ view: 'topology', selectedClaim: claimId,
        company: null, topologySourceYear: 'all', topologyCategory: 'all',
        topologyStatus: 'all' }, { top: true, focus: '#topology-inspector' })
    });
    const fromUrl = routeState();
    Object.assign(state, {
      ...fromUrl,
      compareSlugs: fromUrl.pinned
    });
    tabs.forEach(button => { button.disabled = false; });
    writeUrl(true);
    render();
  })
  .catch(error => {
    root.setAttribute('aria-busy', 'false');
    const retry = node('button', 'reload exports', 'quiet-button');
    retry.type = 'button';
    retry.addEventListener('click', () => location.reload());
    root.replaceChildren(node('p', 'source exports unavailable: ' + error.message, 'error'), retry);
  });
