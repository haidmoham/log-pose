const root = document.querySelector('#view');
const tabs = [...document.querySelectorAll('[data-view]')];
const state = { view: 'search', year: 2024, category: 'all', query: '', company: null, sort: 'growth',
  searchYear: 'all', searchSource: 'all', searchType: 'all', searchUs: 'all',
  selectedCandidate: null, searchLimit: 30, compareSlugs: [] };
let data;
let discovery;
let occurrenceById;

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
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return node('span', label);
  } catch {
    return node('span', label);
  }
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

function occurrenceText(occurrence) {
  return [occurrence.name, occurrence.description, occurrence.homepage_url, occurrence.repo_url,
    occurrence.source_category, occurrence.source_subcategory,
    ...occurrence.candidate_tags.map(categoryName)]
    .join(' ').toLocaleLowerCase();
}

function matchingOccurrences(candidate, terms) {
  return candidate.occurrence_ids.map(id => occurrenceById.get(id)).filter(item =>
    (state.category === 'all' || item.candidate_tags.includes(state.category))
    && (state.searchYear === 'all' || item.year === Number(state.searchYear))
    && (state.searchSource === 'all' || item.source === state.searchSource)
    && terms.every(term => occurrenceText(item).includes(term)));
}

function renderSearch() {
  root.append(title('01 / SOURCE RECORDS', 'Search the software landscape',
    'Find dated product and project leads. Open their original inventory rows; use the reviewed pilot for company pages and SEC facts.'));

  const controls = node('div', '', 'search-controls');
  const query = node('input');
  query.type = 'search';
  query.placeholder = 'Try vector database, observability, API gateway…';
  query.setAttribute('aria-label', 'Search source records');
  query.value = state.query;
  query.addEventListener('input', () => {
    state.query = query.value;
    state.searchLimit = 30;
    updateSearchResults();
  });
  controls.append(query);
  const filters = node('div', '', 'search-filters');
  const category = node('select');
  category.setAttribute('aria-label', 'Candidate category');
  category.add(new Option('All categories', 'all'));
  ['data_infrastructure', 'developer_tools', 'security_observability', 'ai_automation']
    .forEach(value => category.add(new Option(categoryName(value), value)));
  category.value = state.category;
  category.addEventListener('change', () => { state.category = category.value; updateSearchResults(); });
  const year = node('select');
  year.setAttribute('aria-label', 'Record year');
  year.add(new Option('All years', 'all'));
  data.years.forEach(value => year.add(new Option('Record year ' + value, String(value))));
  year.value = state.searchYear;
  year.addEventListener('change', () => { state.searchYear = year.value; updateSearchResults(); });
  const source = node('select');
  source.setAttribute('aria-label', 'Discovery source');
  [['all', 'All sources'], ['cncf', 'CNCF landscape'], ['lfai', 'LF AI & Data']]
    .forEach(([value, label]) => source.add(new Option(label, value)));
  source.value = state.searchSource;
  source.addEventListener('change', () => { state.searchSource = source.value; updateSearchResults(); });
  const type = node('select');
  type.setAttribute('aria-label', 'Record type');
  [['all', 'All record types'], ['lead', 'Directory leads'],
    ['pilot', 'Selected pilot'], ['financing', 'Financing announcement'],
    ['financial', 'SEC facts available']]
    .forEach(([value, label]) => type.add(new Option(label, value)));
  type.value = state.searchType;
  type.addEventListener('change', () => { state.searchType = type.value; updateSearchResults(); });
  const location = node('select');
  location.setAttribute('aria-label', 'U.S. location evidence');
  [['all', 'Any U.S. evidence'], ['documented', 'U.S. base documented'],
    ['unresolved', 'Location review unresolved']]
    .forEach(([value, label]) => location.add(new Option(label, value)));
  location.value = state.searchUs;
  location.addEventListener('change', () => { state.searchUs = location.value; updateSearchResults(); });
  filters.append(category, year, source, type, location);
  root.append(controls, filters);

  const results = node('div');
  results.id = 'search-results';
  root.append(results);
  updateSearchResults();
}

function candidateScore(candidate, query) {
  if (!query) return candidate.observed_years.length;
  const name = candidate.name.toLocaleLowerCase();
  const phrase = query.toLocaleLowerCase().trim();
  if (name === phrase) return 1000;
  if (name.startsWith(phrase)) return 500;
  if (name.includes(phrase)) return 200;
  return candidate.observed_years.length;
}

function searchAggregation(hits, pilots) {
  const panel = node('section', '', 'search-aggregation');
  panel.append(node('p', 'AGGREGATION / CURRENT RESULT SET', 'eyebrow'),
    node('h3', 'Where the matches appear'));
  const counts = node('div', '', 'search-aggregate-grid');
  const byCategory = node('div');
  byCategory.append(node('h4', 'Directory candidate tags'));
  ['data_infrastructure', 'developer_tools', 'security_observability', 'ai_automation']
    .forEach(tag => byCategory.append(append(node('p', '', 'aggregate-row'),
      node('span', categoryName(tag)),
      node('strong', String(hits.filter(hit => hit.occurrences.some(item =>
        item.candidate_tags.includes(tag))).length)))));
  const byYear = node('div');
  byYear.append(node('h4', 'Directory inventory years'));
  data.years.forEach(year => byYear.append(append(node('p', '', 'aggregate-row'),
    node('span', String(year)),
    node('strong', String(hits.filter(hit => hit.occurrences.some(item =>
      item.year === year)).length)))));
  const byPilotCategory = node('div');
  byPilotCategory.append(node('h4', 'Pilot company categories'));
  ['data_infrastructure', 'developer_tools', 'security_observability', 'ai_automation']
    .forEach(tag => byPilotCategory.append(append(node('p', '', 'aggregate-row'),
      node('span', categoryName(tag)),
      node('strong', String(pilots.filter(hit => hit.company.category === tag).length)))));
  const byPilotYear = node('div');
  byPilotYear.append(node('h4', 'Pilot archived-page years'));
  data.years.forEach(year => byPilotYear.append(append(node('p', '', 'aggregate-row'),
    node('span', String(year)),
    node('strong', String(pilots.filter(hit => data.evidence.some(cell =>
      cell.slug === hit.company.slug && cell.year === year && cell.snapshot_id)).length)))));
  counts.append(byCategory, byYear, byPilotCategory, byPilotYear);
  panel.append(counts, node('p', hits.length + ' distinct directory candidate keys · '
    + pilots.length + ' selected pilot companies · '
    + pilots.filter(hit => financingFor(hit.company.slug).length).length
    + ' with a financing announcement. Tags and years overlap; these are not market-size counts.', 'muted'));
  return panel;
}

function financingFor(slug) {
  return data.financing_announcements.filter(event => event.slug === slug);
}

function locationReviewFor(slug) {
  return data.us_location_reviews.find(review => review.slug === slug);
}

function matchingPilotEvidence(slug, terms) {
  return data.evidence.filter(cell => cell.slug === slug && cell.snapshot_id
    && (state.searchYear === 'all' || cell.year === Number(state.searchYear))
    && terms.every(term => (cell.excerpt || '').toLocaleLowerCase().includes(term)));
}

function matchingFinancing(slug, terms) {
  return financingFor(slug).filter(event =>
    (state.searchYear === 'all' || Number(event.announced_on.slice(0, 4)) === Number(state.searchYear))
    && terms.every(term => [event.round, event.announced_on, String(event.amount_usd),
      money(event.amount_usd), event.valuation_usd ? money(event.valuation_usd) : '']
      .join(' ').toLocaleLowerCase().includes(term)));
}

function comparisonPanel(pilots) {
  const selected = pilots.map(hit => hit.company)
    .filter(company => state.compareSlugs.includes(company.slug));
  if (!selected.length) return null;
  const section = node('section', '', 'comparison-panel');
  section.append(node('p', 'COMPARISON / SELECTED PILOT COMPANIES', 'eyebrow'),
    node('h3', 'Review evidence side by side'));
  const year = state.searchYear === 'all' ? 2024 : Number(state.searchYear);
  const rows = selected.map(company => {
    const location = locationReviewFor(company.slug);
    const event = financingFor(company.slug)
      .filter(item => state.searchYear === 'all'
        || Number(item.announced_on.slice(0, 4)) === year).at(-1);
    const reported = company.cik ? financials(company.slug, year) : null;
    const locationCell = node('td');
    if (location) locationCell.append(node('span', location.decision === 'documented_us_base'
      ? location.location_kind.replaceAll('_', ' ') + ' · ' + location.place
      : 'reviewed; unresolved'), link(' source ↗', location.source_url));
    else locationCell.textContent = 'unreviewed';
    const fundingCell = node('td');
    if (event) fundingCell.append(node('span', event.announced_on + ' · ' + event.round
      + ' · ' + money(event.amount_usd)), link(' source ↗', event.source_url));
    else fundingCell.textContent = 'no selected announcement';
    return append(node('tr'), node('td', company.name),
      node('td', categoryName(company.category)), locationCell, fundingCell,
      node('td', reported ? money(reported.revenue) : 'no SEC series'));
  });
  section.append(node('p', 'SEC revenue uses periods ending in ' + year
    + '. Funding values are company announcements from their own dates. Missing evidence is not a zero.', 'muted'),
  table(['Company', 'Pilot category', 'U.S. location evidence', 'Financing news', 'SEC revenue'], rows));
  return section;
}

function candidateDetail(candidate) {
  const section = node('section', '', 'candidate-detail');
  section.append(node('p', 'DIRECTORY LEAD / IDENTITY AND U.S. LOCATION UNREVIEWED', 'eyebrow'),
    node('h3', candidate.name),
    node('p', candidate.description || 'The source inventory provides no description.', 'muted'));
  if (candidate.homepage_url) section.append(link('Source-listed website ↗', candidate.homepage_url));
  const observations = candidate.occurrence_ids.map(id => occurrenceById.get(id));
  section.append(node('h4', 'Dated source occurrences'));
  const list = node('div', '', 'occurrence-list');
  observations.forEach(item => list.append(append(node('article', '', 'occurrence'),
    node('p', item.source.toUpperCase() + ' · ' + item.year + ' · '
      + item.source_category + ' / ' + item.source_subcategory, 'eyebrow'),
    node('p', item.description || 'No source description.'),
    link('Pinned inventory ↗', item.source_url),
    node('small', 'Row path ' + item.source_path.join('.') + ' · SHA-256 '
      + item.artifact_sha256.slice(0, 12) + '…'))));
  section.append(list, node('p', 'Inventory presence is a dated directory observation. It does not verify the vendor, U.S. location, product launch date, financing, or traction.', 'caveat'));
  return section;
}

function updateSearchResults() {
  const target = document.querySelector('#search-results');
  target.replaceChildren();
  const terms = state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const hits = state.searchUs !== 'all' || ['pilot', 'financial', 'financing'].includes(state.searchType) ? []
    : discovery.candidates.map(candidate => ({
      candidate,
      occurrences: matchingOccurrences(candidate, terms)
    })).filter(hit => hit.occurrences.length);
  const pilots = data.companies.map(item => ({
    company: item,
    evidenceMatches: matchingPilotEvidence(item.slug, terms),
    financingMatches: matchingFinancing(item.slug, terms)
  })).filter(({ company: item, evidenceMatches, financingMatches }) =>
    (state.category === 'all' || item.category === state.category)
    && (state.searchYear === 'all' || (state.searchType === 'financing'
      ? financingFor(item.slug).some(event => Number(event.announced_on.slice(0, 4)) === Number(state.searchYear))
      : data.evidence.some(cell => cell.slug === item.slug
        && cell.year === Number(state.searchYear) && cell.snapshot_id)))
    && state.searchSource === 'all'
    && state.searchType !== 'lead'
    && (state.searchUs === 'all'
      || (state.searchUs === 'documented' && locationReviewFor(item.slug)?.decision === 'documented_us_base')
      || (state.searchUs === 'unresolved' && locationReviewFor(item.slug)?.decision === 'unresolved'))
    && (state.searchType !== 'financial' || item.cik)
    && (state.searchType !== 'financing' || financingMatches.length)
    && (terms.every(term => [item.name, item.purpose, item.url].join(' ')
      .toLocaleLowerCase().includes(term)) || evidenceMatches.length > 0
      || financingMatches.length > 0));
  hits.sort((left, right) => candidateScore(right.candidate, state.query)
    - candidateScore(left.candidate, state.query)
    || left.candidate.name.localeCompare(right.candidate.name));
  target.append(append(node('div', '', 'search-summary'),
    metric(String(hits.length), 'Directory leads', 'Product or project keys; U.S. status unreviewed'),
    metric(String(pilots.length), 'Pilot companies', 'Selected and separately sourced'),
    metric(String(pilots.filter(hit => hit.company.cik).length), 'With SEC facts', 'Reported fundamentals; no price series'),
    metric(String(pilots.filter(hit => financingFor(hit.company.slug).length).length),
      'With financing news', 'Company announcements; selected events only'),
    metric(String(pilots.filter(hit => locationReviewFor(hit.company.slug)?.decision === 'documented_us_base').length),
      'With U.S. base evidence', 'Dated headquarters or principal office')));
  target.append(searchAggregation(hits, pilots));
  const comparison = comparisonPanel(pilots);
  if (comparison) target.append(comparison);
  const resultList = node('div', '', 'search-result-list');
  pilots.forEach(({ company: item, evidenceMatches }) => {
    const announcements = financingFor(item.slug);
    const locationReview = locationReviewFor(item.slug);
    const button = node('button', 'Open dated company evidence →', 'text-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      state.view = 'companies';
      state.company = item.slug;
      render();
      document.querySelector('#company-detail')?.scrollIntoView({ block: 'start' });
    });
    const card = append(node('article', '', 'search-result'),
      node('p', 'SELECTED PILOT COMPANY' + (item.cik ? ' · SEC FACTS' : '')
        + (announcements.length ? ' · FINANCING NEWS' : ''), 'eyebrow'),
      node('h3', item.name), node('p', item.purpose || '', 'muted'),
      ...(announcements.length ? [node('p', announcements.map(event =>
        event.announced_on + ' · ' + event.round + ' · ' + money(event.amount_usd)).join(' / '), 'search-tags')] : []),
      button);
    const compare = node('button', state.compareSlugs.includes(item.slug)
      ? 'Remove from comparison' : 'Add to comparison', 'quiet-button');
    compare.type = 'button';
    compare.setAttribute('aria-pressed', String(state.compareSlugs.includes(item.slug)));
    compare.addEventListener('click', () => {
      if (state.compareSlugs.includes(item.slug)) {
        state.compareSlugs = state.compareSlugs.filter(slug => slug !== item.slug);
      } else {
        state.compareSlugs.push(item.slug);
      }
      updateSearchResults();
    });
    card.append(compare);
    if (locationReview) card.append(node('p', locationReview.decision === 'documented_us_base'
      ? 'U.S. ' + locationReview.location_kind.replaceAll('_', ' ') + ' · ' + locationReview.place
      : 'location review unresolved · no headquarters declared', 'search-tags'));
    if (terms.length && evidenceMatches.length) {
      const match = evidenceMatches[0];
      card.append(node('p', 'Archived page · ' + match.year + ' · captured '
        + match.captured_at.slice(0, 10), 'caption'),
      node('p', match.excerpt.slice(0, 240) + (match.excerpt.length > 240 ? '…' : ''), 'muted'),
      link('Open archived page ↗', match.archive_url));
    }
    resultList.append(card);
  });
  hits.slice(0, state.searchLimit).forEach(hit => {
    const item = hit.candidate;
    const matchingDescription = hit.occurrences.find(occurrence => occurrence.description)?.description
      || hit.occurrences.map(occurrence => occurrence.source_category + ' / '
        + occurrence.source_subcategory).join(' · ');
    const matchedYears = [...new Set(hit.occurrences.map(occurrence => occurrence.year))].sort();
    const matchedSources = [...new Set(hit.occurrences.map(occurrence => occurrence.source))].sort();
    const matchedTags = [...new Set(hit.occurrences.flatMap(occurrence => occurrence.candidate_tags))];
    const button = node('button', state.selectedCandidate === item.id ? 'Hide source records' : 'Inspect source records →', 'text-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      state.selectedCandidate = state.selectedCandidate === item.id ? null : item.id;
      updateSearchResults();
      document.querySelector('#candidate-' + item.id)?.scrollIntoView({ block: 'nearest' });
    });
    const card = append(node('article', '', 'search-result'),
      node('p', 'DIRECTORY LEAD · ' + matchedYears.join(', ') + ' · '
        + matchedSources.join(' + ').toUpperCase(), 'eyebrow'),
      node('h3', item.name),
      node('p', matchingDescription, 'muted'),
      node('p', matchedTags.map(categoryName).join(' · '), 'search-tags'), button);
    if (item.pilot_match) {
      const evidenceButton = node('button', 'Open pilot company evidence →', 'text-button');
      evidenceButton.type = 'button';
      evidenceButton.addEventListener('click', () => {
        state.view = 'companies';
        state.company = item.pilot_match.slug;
        render();
        document.querySelector('#company-detail')?.scrollIntoView({ block: 'start' });
      });
      card.append(node('p', 'Possible link: exact name and listed homepage. Legal identity unreviewed.', 'caption'),
        evidenceButton);
    }
    card.id = 'candidate-' + item.id;
    resultList.append(card);
    if (state.selectedCandidate === item.id) resultList.append(candidateDetail(item));
  });
  target.append(resultList);
  if (hits.length > state.searchLimit) {
    const more = node('button', 'Show 30 more leads', 'quiet-button');
    more.type = 'button';
    more.addEventListener('click', () => { state.searchLimit += 30; updateSearchResults(); });
    target.append(more);
  }
  if (!hits.length && !pilots.length) target.append(node('p', 'No records match these filters.', 'muted'));
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

function renderCompanies() {
  const good = data.evidence.filter(item => item.status === 'retrieved').length;
  root.append(title('02 / COMPANY LENS', 'Companies in the study',
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
  root.append(title('03 / REPORTED RESULTS', 'Public fundamentals',
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
  root.append(title('04 / EXTERNAL CONTEXT', 'U.S. equity activity',
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
  root.append(title('05 / RESEARCH BOUNDARY', 'What can we answer?',
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
  const searchButton = node('button', 'Search source records →', 'text-button');
  searchButton.type = 'button';
  searchButton.addEventListener('click', () => {
    state.view = 'search';
    render();
    root.scrollIntoView({ block: 'start' });
  });
  root.append(searchButton);
}

function render() {
  tabs.forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  root.replaceChildren();
  if (state.view === 'search') renderSearch();
  else if (state.view === 'companies') renderCompanies();
  else if (state.view === 'fundamentals') renderFundamentals();
  else if (state.view === 'market') renderMarket();
  else renderReadiness();
}

tabs.forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  state.company = null;
  render();
}));

Promise.all(['./dashboard.json', './discovery.json'].map(url =>
  fetch(url).then(response => {
    if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
    return response.json();
  })))
  .then(([pilot, pulled]) => {
    data = pilot;
    discovery = pulled;
    occurrenceById = new Map(pulled.occurrences.map(item => [item.id, item]));
    render();
  })
  .catch(error => { root.replaceChildren(node('p', 'Source export unavailable: ' + error.message, 'error')); });
