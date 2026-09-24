const root = document.querySelector('#view');
const tabs = [...document.querySelectorAll('[data-view]')];
const state = { view: 'companies', year: 2024, category: 'all', query: '', company: null, sort: 'growth' };
let data;

function node(tag, text = '', className = '') {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}

function append(parent, ...items) {
  parent.append(...items);
  return parent;
}

function link(label, url) {
  const item = node('a', label);
  item.href = url;
  item.target = '_blank';
  item.rel = 'noopener noreferrer';
  return item;
}

function title(kicker, text, description) {
  return append(node('div', '', 'view-heading'), node('p', kicker, 'eyebrow'),
    node('h2', text), node('p', description, 'view-note'));
}

function metric(value, label, note) {
  return append(node('div', '', 'metric'), node('strong', value),
    node('span', label), node('small', note));
}

function categoryName(value) {
  return {
    ai_automation: 'AI / automation',
    data_infrastructure: 'Data infrastructure',
    developer_tools: 'Developer tools',
    security_observability: 'Security / observability'
  }[value] || value;
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

function facts(slug, year) {
  return Object.fromEntries(data.financials.cells
    .filter(item => item.slug === slug && item.year === year)
    .map(item => [item.concept, item.selected]));
}

function financials(slug, year) {
  const current = facts(slug, year);
  const prior = year > 2021 ? facts(slug, year - 1) : {};
  const revenue = current.revenue ? Number(current.revenue.value) : null;
  const netIncome = current.net_income ? Number(current.net_income.value) : null;
  const priorRevenue = prior.revenue ? Number(prior.revenue.value) : null;
  const aligned = current.revenue && current.net_income
    && current.revenue.start_date === current.net_income.start_date
    && current.revenue.end_date === current.net_income.end_date;
  return {
    revenue, netIncome,
    growth: revenue !== null && priorRevenue > 0 ? (revenue / priorRevenue - 1) * 100 : null,
    margin: aligned && revenue > 0 ? netIncome / revenue * 100 : null,
    assets: current.assets ? Number(current.assets.value) : null,
    periodEnd: current.revenue?.end_date,
    filed: current.revenue?.filed_date
  };
}

function table(headers, rows) {
  const wrap = node('div', '', 'table-wrap');
  const tableNode = node('table');
  const header = node('tr');
  headers.forEach(label => header.append(node('th', label)));
  tableNode.append(append(node('thead'), header), append(node('tbody'), ...rows));
  wrap.append(tableNode);
  return wrap;
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
    }
    grid.append(card);
  }
  section.append(grid, node('p', 'A company page records what its publisher said at capture time. It does not verify adoption, customer outcomes, or when a feature first appeared.', 'caveat'));
  return section;
}

function renderCompanies() {
  const good = data.evidence.filter(item => item.status === 'retrieved').length;
  root.append(title('01 / COMPANY LENS', 'Companies in the study',
    'Scan evidence availability, then open a company to inspect dated pages and reported facts.'),
    append(node('div', '', 'metric-row'),
      metric(String(data.companies.length), 'Selected companies', 'Fixed, purposive cohort'),
      metric(good + ' / 80', 'Extractable page cells', 'Not all reviewed for useful claims'),
      metric('10 / 20', 'SEC registrants', 'Annual reported facts available')));

  const controls = node('div', '', 'toolbar');
  const search = node('input');
  search.type = 'search';
  search.placeholder = 'Find a company';
  search.setAttribute('aria-label', 'Find a company');
  search.value = state.query;
  search.addEventListener('input', () => {
    state.query = search.value;
    updateCompanyResults();
  });
  const select = node('select');
  select.setAttribute('aria-label', 'Filter by category');
  select.add(new Option('All categories', 'all'));
  [...new Set(data.companies.map(item => item.category))]
    .forEach(value => select.add(new Option(categoryName(value), value)));
  select.value = state.category;
  select.addEventListener('change', () => { state.category = select.value; updateCompanyResults(); });
  root.append(append(controls, search, select));
  const results = node('div');
  results.id = 'company-results';
  root.append(results);
  updateCompanyResults();
}

function updateCompanyResults() {
  const results = document.querySelector('#company-results');
  results.replaceChildren();
  const matches = data.companies.filter(item =>
    (state.category === 'all' || item.category === state.category)
    && item.name.toLowerCase().includes(state.query.toLowerCase()));
  const rows = matches.map(item => {
    const retrieved = data.evidence.filter(cell => cell.slug === item.slug
      && cell.status === 'retrieved').length;
    const button = node('button', item.name, 'text-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      state.company = item.slug;
      updateCompanyResults();
      document.querySelector('#company-detail')?.scrollIntoView({ block: 'start' });
    });
    return append(node('tr'), append(node('td'), button), node('td', categoryName(item.category)),
      node('td', retrieved + ' / 4 extractable'),
      node('td', item.cik ? '10-K candidates' : 'No SEC series'));
  });
  if (!rows.length) rows.push(append(node('tr'), node('td', 'No companies match this filter.')));
  results.append(table(['Company', 'Category', 'Archived pages', 'SEC facts'], rows));
  if (state.company) {
    const detail = companyDetail(state.company);
    detail.id = 'company-detail';
    results.append(detail);
  }
}

function yearControl() {
  const select = node('select');
  select.setAttribute('aria-label', 'Select period-end year');
  data.years.forEach(year => select.add(new Option('Periods ending ' + year, year)));
  select.value = state.year;
  select.addEventListener('change', () => { state.year = Number(select.value); render(); });
  return select;
}

function bar(value, maximum) {
  const track = node('div', '', 'bar-track');
  const fill = node('span', '', 'bar-fill');
  fill.style.width = Math.max(2, value / maximum * 100) + '%';
  return append(track, fill);
}

function fundamentalsDetail(slug) {
  const company = data.companies.find(item => item.slug === slug);
  const section = node('section', '', 'detail-panel');
  section.id = 'financial-detail';
  const close = node('button', 'Close ×', 'quiet-button');
  close.type = 'button';
  close.addEventListener('click', () => { state.company = null; render(); });
  section.append(append(node('div', '', 'detail-head'),
    append(node('div'), node('p', 'FOUR REPORTED PERIODS', 'eyebrow'), node('h3', company.name)), close));
  const values = data.years.map(year => financials(slug, year));
  const maximum = Math.max(...values.map(item => item.revenue || 0));
  const series = node('div', '', 'finance-series');
  data.years.forEach((year, index) => {
    const item = values[index];
    series.append(append(node('div', '', 'finance-row'), node('span', String(year)),
      bar(item.revenue, maximum), node('strong', money(item.revenue)),
      node('span', item.growth === null ? 'First period' : percent(item.growth) + ' vs prior')));
  });
  section.append(series);
  const selected = facts(slug, state.year);
  const current = financials(slug, state.year);
  section.append(append(node('div', '', 'provenance'),
    node('p', 'Selected period: ' + selected.revenue.start_date + ' to ' + current.periodEnd
      + '. Filed ' + current.filed + '. Accession ' + selected.revenue.accession_number + '.', 'muted'),
    node('p', 'Net income ' + money(current.netIncome) + ' · Assets ' + money(current.assets)
      + ' · SEC member ' + selected.revenue.raw_sha256.slice(0, 16) + '…', 'muted'),
    link('SEC companyfacts source ↗', data.financials.artifact_url)));
  section.append(node('p', 'These are period-end-year buckets, not common calendar years. Values were selected from a later SEC bulk snapshot using filings through 2025-04-01.', 'caveat'));
  return section;
}

function renderFundamentals() {
  const sort = node('select');
  sort.setAttribute('aria-label', 'Sort public companies');
  [['growth', 'Revenue growth'], ['revenue', 'Revenue'], ['margin', 'Net income margin'], ['name', 'Company name']]
    .forEach(([value, label]) => sort.add(new Option('Sort: ' + label, value)));
  sort.value = state.sort;
  sort.addEventListener('change', () => { state.sort = sort.value; render(); });
  root.append(title('02 / REPORTED RESULTS', 'Public fundamentals',
    'Compare reported revenue and net income across the public subset. Open a company for its four selected periods and filing trail.'),
    append(node('div', '', 'section-controls'), yearControl(), sort,
      node('p', 'USD · Filings through ' + data.financials.as_of + ' · 10 public companies', 'muted')));
  const companies = data.companies.filter(item => item.cik);
  companies.sort((left, right) => {
    if (state.sort === 'name') return left.name.localeCompare(right.name);
    const first = financials(left.slug, state.year)[state.sort];
    const second = financials(right.slug, state.year)[state.sort];
    if (first === null) return 1;
    if (second === null) return -1;
    return second - first;
  });
  const rows = companies.map(company => {
    const result = financials(company.slug, state.year);
    const button = node('button', company.name, 'text-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      state.company = company.slug;
      render();
      document.querySelector('#financial-detail')?.scrollIntoView({ block: 'start' });
    });
    return append(node('tr'), append(node('td'), button),
      node('td', money(result.revenue)),
      node('td', percent(result.growth), result.growth >= 0 ? 'positive' : 'negative'),
      node('td', percent(result.margin), result.margin >= 0 ? 'positive' : 'negative'),
      node('td', result.periodEnd || '—'));
  });
  root.append(table(['Company', 'Revenue', 'Change vs prior period', 'Net income margin', 'Period end'], rows));
  if (state.company && data.companies.find(item => item.slug === state.company)?.cik) {
    root.append(fundamentalsDetail(state.company));
  }
  root.append(node('p', 'Revenue change compares adjacent period-end years for the same company. Net income margin uses matching revenue and net income periods. Neither is a valuation, retention, or capital-efficiency measure.', 'caveat'));
}

function renderMarket() {
  root.append(title('03 / EXTERNAL CONTEXT', 'U.S. equity activity',
    'Cboe market-wide daily data, averaged within each year. This series spans all U.S. equities, not only software companies.'));
  const panels = node('div', '', 'market-panels');
  const measures = [
    ['mean_daily_notional', 'Mean daily notional', 'USD BILLIONS', 1e9],
    ['mean_daily_shares', 'Mean daily shares', 'BILLIONS OF SHARES', 1e9],
    ['mean_daily_trades', 'Mean daily trades', 'MILLIONS OF TRADES', 1e6]
  ];
  for (const [key, name, unit, scale] of measures) {
    const panel = append(node('section', '', 'market-panel'), node('p', unit, 'eyebrow'), node('h3', name));
    const maximum = Math.max(...data.market.map(item => item[key]));
    data.market.forEach(item => panel.append(append(node('div', '', 'market-row'),
      node('span', String(item.year)), bar(item[key], maximum),
      node('strong', formatNumber(item[key] / scale)))));
    panels.append(panel);
  }
  root.append(panels);
  const source = append(node('section', '', 'market-source'), node('h3', 'Source and scope'),
    node('p', '19,093 stored participant-day rows from four annual Cboe CSVs. Each annual value sums market participants by trading day, then divides by observed trading days.'),
    node('p', 'Cboe Exchange, Inc. These values show market-wide trading activity. They cannot establish company returns or software demand.', 'caveat'));
  const list = node('div', '', 'source-list');
  data.market.forEach(item => list.append(link(item.year + ' CSV ↗', item.source_url),
    node('span', item.rows.toLocaleString() + ' rows · ' + item.trading_days
      + ' days · SHA-256 ' + item.raw_sha256.slice(0, 12) + '…')));
  root.append(append(source, list));
}

function renderReadiness() {
  root.append(title('04 / RESEARCH BOUNDARY', 'What can we answer?',
    'The next data pull should follow a question that the current pilot cannot answer.'));
  root.append(append(node('div', '', 'readiness-grid'),
    metric('72 / 80', 'Extractable page cells', 'Eight yield short visible text'),
    metric('15 / 16', 'Fixed audit cells with claims', 'Four recovery cells reviewed separately'),
    metric('120 / 120', 'Selected SEC concept cells', '10 companies × 4 years × 3 concepts'),
    metric('0', 'Verified security price series', 'No company return or valuation view')));
  const entries = [
    ['How did a company describe its product?', 'Dated pages and 19 reviewed passages', 'Review more pages and resolve eight short-text cells'],
    ['How did reported scale change?', 'Revenue, net income, assets for ten SEC registrants', 'Validate more original filings and fiscal-calendar comparisons'],
    ['How did investors price that change?', 'No verified company-level price series', 'Dated securities, permitted prices, share counts, cash and debt'],
    ['Which companies won a category?', 'Purposive study with no representative denominator', 'A defined universe and comparable adoption or customer measures']
  ];
  root.append(table(['Research question', 'Available now', 'Needed next'],
    entries.map(values => append(node('tr'), ...values.map(value => node('td', value))))));
  root.append(node('p', 'This pilot supports sourced case studies and exploratory public-company trends. It cannot establish market share, investment performance, customer traction, or valuation.', 'caveat'));
  const universeButton = node('button', 'See the universe build →', 'text-button');
  universeButton.type = 'button';
  universeButton.addEventListener('click', () => {
    state.view = 'universe';
    render();
    root.scrollIntoView({ block: 'start' });
  });
  root.append(universeButton);
}

function renderUniverse() {
  const universe = data.universe;
  root.append(title('05 / COMPANY DISCOVERY', 'Building the company universe',
    'The 20 selected companies test retrieval. This research defines a wider U.S. company frame before any market-wide count.'));

  const scope = append(node('section', '', 'universe-scope'),
    node('p', 'WORKING BOUNDARY / CHECKED ' + universe.checked_at, 'eyebrow'),
    node('h3', universe.scope),
    node('p', universe.membership_rule));
  const categories = append(node('div', '', 'universe-categories'),
    ...universe.categories.map(category => node('span', category)));
  scope.append(categories);
  root.append(scope);

  root.append(append(node('div', '', 'metric-row'),
    metric(String(data.companies.length), 'Pilot companies', 'Selected for retrieval tests'),
    metric('Not counted', 'Verified U.S. universe', 'Eligibility review has not started'),
    metric('2 of 4', 'Years with inventory checks', '2021 and 2024 only')));

  root.append(append(node('div', '', 'universe-heading'),
    node('h3', 'Historical inventory checks'),
    node('p', 'Parsed items include products, projects, and member entries. They are not unique companies or verified U.S. firms.', 'muted')));
  const manifestRows = universe.manifest_checks.map(source => {
    const counts = source.counts.map(count => append(node('td'),
      link(count.items.toLocaleString() + ' items ↗', count.url)));
    return append(node('tr'), node('td', source.name), ...counts,
      node('td', source.description));
  });
  root.append(table(['Inventory', '2021 pinned file', '2024 pinned file', 'Contents'], manifestRows));

  root.append(append(node('div', '', 'universe-heading'),
    node('h3', 'Discovery routes'),
    node('p', 'Each route yields candidates. Dated first-party records establish product fit, location, and ownership.', 'muted')));
  const routes = node('div', '', 'route-grid');
  universe.discovery_routes.forEach(source => {
    routes.append(append(node('article', '', 'route-card'),
      node('p', source.status, 'eyebrow'),
      append(node('h4'), link(source.name + ' ↗', source.url)),
      node('p', source.role),
      node('p', source.limit, 'route-limit')));
  });
  root.append(routes);

  const next = append(node('section', '', 'universe-next'),
    node('p', 'NEXT BOUNDED RUN', 'eyebrow'),
    node('h3', 'From candidates to company-years'));
  const steps = node('ol');
  universe.next_batch.forEach(step => steps.append(node('li', step)));
  next.append(steps);
  root.append(next, node('p', 'The source union can become a documented high-recall frame. No listed source proves a complete census, so coverage and unresolved cases must stay visible.', 'caveat'));
}

function render() {
  tabs.forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  root.replaceChildren();
  if (state.view === 'companies') renderCompanies();
  else if (state.view === 'fundamentals') renderFundamentals();
  else if (state.view === 'market') renderMarket();
  else if (state.view === 'readiness') renderReadiness();
  else renderUniverse();
}

tabs.forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  state.company = null;
  render();
}));

fetch('./dashboard.json')
  .then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
  .then(payload => { data = payload; render(); })
  .catch(error => { root.replaceChildren(node('p', 'Pilot export unavailable: ' + error.message, 'error')); });
