const metrics = document.querySelector('#metrics');
const inventory = document.querySelector('#inventory');
const detail = document.querySelector('#detail');
const company = document.querySelector('#company');
const cutoff = document.querySelector('#cutoff');
const result = document.querySelector('#result');
const notice = document.querySelector('#selection-notice');
const requestProgress = document.querySelector('#request-progress');

let overviewData;
let evidenceRequest;
let evidenceVersion = 0;
let pendingRequests = 0;

function el(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function beginRequest() {
  pendingRequests += 1;
  requestProgress.setAttribute('aria-hidden', 'false');
  requestProgress.classList.remove('finishing');
  requestProgress.classList.add('active');
}

function endRequest() {
  pendingRequests = Math.max(0, pendingRequests - 1);
  if (pendingRequests !== 0) return;
  requestProgress.classList.remove('active');
  requestProgress.classList.add('finishing');
  window.setTimeout(() => {
    if (pendingRequests === 0) {
      requestProgress.classList.remove('finishing');
      requestProgress.setAttribute('aria-hidden', 'true');
    }
  }, 280);
}

async function getJson(path, options = {}) {
  beginRequest();
  try {
    const response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`The server returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(payload.error || `The request failed (HTTP ${response.status}).`);
    }
    return payload;
  } finally {
    endRequest();
  }
}

function formatTime(value) {
  if (!value) return 'No capture stored';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatted} UTC`;
}

function showError(container, message, retry) {
  container.replaceChildren(el('p', message, 'message error'));
  if (retry) {
    const button = el('button', 'Retry', 'retry');
    button.type = 'button';
    button.addEventListener('click', retry, { once: true });
    container.append(button);
  }
  container.setAttribute('aria-busy', 'false');
}

function renderMetrics(totals) {
  metrics.replaceChildren();
  for (const [label, value, explanation] of [
    ['Companies', totals.companies, 'Tracked in this database'],
    ['Curated sources', totals.sources, 'Reviewed source URLs'],
    ['Stored captures', totals.captures, 'Distinct archived pages'],
    ['Failed attempts', totals.failed_attempts, 'Cumulative; retries remain visible'],
  ]) {
    const card = el('div', '', 'metric-card');
    card.append(el('span', label, 'metric-label'), el('strong', String(value), 'metric-value'));
    card.append(el('span', explanation, 'metric-note'));
    metrics.append(card);
  }
}

function coverageButton(row, year) {
  const coverage = row.coverage[year];
  const button = el('button', '', 'coverage-button');
  button.type = 'button';
  button.append(el('span', `Dec ${year}`, 'coverage-year'));
  button.append(el('strong', `${coverage.available_sources} / ${row.source_count} sources`));
  button.append(el('small', coverage.latest_capture_at
    ? `Latest: ${formatTime(coverage.latest_capture_at)}`
    : 'No capture by cutoff'));
  button.addEventListener('click', () => navigateTo(row.slug, year));
  return button;
}

function renderInventory(rows) {
  inventory.replaceChildren();
  inventory.setAttribute('aria-busy', 'false');
  if (rows.length === 0) {
    inventory.append(el('p', 'No companies are registered in this database.', 'message'));
    return;
  }

  const grid = el('div', '', 'company-grid');
  for (const row of rows) {
    const card = el('article', '', 'company-card');
    const heading = el('div', '', 'company-card-heading');
    heading.append(el('h3', row.name), el('span', `${row.capture_count} captures`));
    card.append(heading);
    card.append(el('p', `${row.source_count} curated ${row.source_count === 1 ? 'source' : 'sources'}`, 'company-source-count'));
    const choices = el('div', '', 'coverage-choices');
    choices.append(coverageButton(row, '2021'), coverageButton(row, '2024'));
    card.append(choices);
    grid.append(card);
  }
  inventory.append(grid);
}

function showEvidenceLoading() {
  result.replaceChildren();
  result.setAttribute('aria-busy', 'true');
  result.append(el('p', 'Loading evidence…', 'loading-message'));
  const skeleton = el('article', '', 'card card-skeleton');
  skeleton.setAttribute('aria-hidden', 'true');
  const heading = el('div', '', 'skeleton-heading');
  heading.append(el('span', '', 'skeleton-block skeleton-title'), el('span', '', 'skeleton-block skeleton-status'));
  const copy = el('div', '', 'skeleton-copy');
  for (const width of ['100%', '94%', '68%']) {
    const line = el('span', '', 'skeleton-block');
    line.style.width = width;
    copy.append(line);
  }
  skeleton.append(heading, copy);
  result.append(skeleton);
}

function metadataItem(label, value) {
  const item = el('div');
  item.append(el('span', label), el('strong', value == null ? '—' : String(value)));
  return item;
}

function renderEvidence(view) {
  result.replaceChildren();
  result.setAttribute('aria-busy', 'false');
  if (!view || !Array.isArray(view.sources)) {
    showError(result, 'The server returned evidence in an unexpected format.', loadEvidence);
    return;
  }
  if (view.sources.length === 0) {
    result.append(el('p', 'No sources are registered for this company.', 'message'));
    return;
  }

  for (const source of view.sources) {
    const card = el('article', '', 'card evidence-card');
    const heading = el('div', '', 'card-head');
    heading.append(
      el('h3', view.name),
      el('span', source.snapshot ? 'CAPTURE AVAILABLE' : 'NO STORED CAPTURE', 'status'),
    );
    card.append(heading);

    const sourceLine = el('div', '', 'source-line');
    sourceLine.append(el('span', source.purpose), el('span', source.original_url));
    card.append(sourceLine);

    if (source.snapshot) {
      const snapshot = source.snapshot;
      const summary = el('div', '', 'capture-summary');
      const captured = el('p');
      captured.append(el('span', 'Captured '));
      const time = el('time', formatTime(snapshot.captured_at));
      time.dateTime = snapshot.captured_at;
      time.title = snapshot.captured_at;
      captured.append(time);
      summary.append(captured);
      const archive = el('a', 'Open archived page ↗');
      archive.href = snapshot.archive_url;
      archive.target = '_blank';
      archive.rel = 'noopener noreferrer';
      summary.append(archive);
      card.append(summary);
      card.append(el('p', snapshot.normalized_text || 'No normalized text is available.', 'excerpt'));

      const disclosure = el('details', '', 'capture-details');
      disclosure.append(el('summary', 'Capture details'));
      const metadata = el('div', '', 'metadata');
      metadata.append(
        metadataItem('Snapshot ID', snapshot.snapshot_id),
        metadataItem('Ingested', formatTime(snapshot.ingested_at)),
        metadataItem('Raw SHA-256', snapshot.raw_sha256),
        metadataItem('Text SHA-256', snapshot.text_sha256),
      );
      disclosure.append(metadata);
      card.append(disclosure);
    } else {
      card.append(el('p', 'No eligible capture is stored for this source. This does not mean the company or product did not exist.', 'missing'));
    }
    result.append(card);
  }
}

async function loadEvidence() {
  if (!company.value) return;
  const version = ++evidenceVersion;
  if (evidenceRequest) evidenceRequest.abort();
  evidenceRequest = new AbortController();
  showEvidenceLoading();

  const cutoffValue = `${cutoff.value}-12-31T23:59:59Z`;
  const path = `/api/companies/${encodeURIComponent(company.value)}?cutoff=${encodeURIComponent(cutoffValue)}`;
  try {
    const view = await getJson(path, { signal: evidenceRequest.signal });
    if (version === evidenceVersion) renderEvidence(view);
  } catch (error) {
    if (error.name === 'AbortError' || version !== evidenceVersion) return;
    showError(result, `Could not load evidence: ${error.message}`, loadEvidence);
  }
}

function selectionFromUrl() {
  const url = new URL(window.location.href);
  return { slug: url.searchParams.get('company'), year: url.searchParams.get('year') };
}

function scrollToSection(section) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
}

function syncSelection(scroll = false) {
  if (!overviewData) return;
  const { slug, year } = selectionFromUrl();
  if (!slug && !year) {
    detail.hidden = true;
    notice.hidden = true;
    if (evidenceRequest) evidenceRequest.abort();
    evidenceVersion += 1;
    return;
  }
  if (!overviewData.companies.some(item => item.slug === slug) || !['2021', '2024'].includes(year)) {
    if (evidenceRequest) evidenceRequest.abort();
    evidenceVersion += 1;
    detail.hidden = true;
    notice.textContent = 'This company or cutoff is not in the local evidence inventory.';
    notice.hidden = false;
    return;
  }
  notice.hidden = true;
  detail.hidden = false;
  company.value = slug;
  cutoff.value = year;
  loadEvidence();
  if (scroll) scrollToSection(detail);
}

function navigateTo(slug, year) {
  const url = new URL(window.location.href);
  url.searchParams.set('company', slug);
  url.searchParams.set('year', year);
  window.history.pushState({}, '', url);
  syncSelection(true);
}

function clearSelection() {
  const url = new URL(window.location.href);
  url.searchParams.delete('company');
  url.searchParams.delete('year');
  window.history.pushState({}, '', url);
  syncSelection();
  scrollToSection(document.querySelector('#overview'));
}

async function loadOverview() {
  inventory.setAttribute('aria-busy', 'true');
  inventory.replaceChildren(el('p', 'Loading inventory…', 'loading-message'));
  try {
    const data = await getJson('/api/overview');
    if (!data || !data.totals || !Array.isArray(data.companies)) {
      throw new Error('The server returned an unexpected inventory.');
    }
    overviewData = data;
    renderMetrics(data.totals);
    renderInventory(data.companies);
    company.replaceChildren(...data.companies.map(item => new Option(item.name, item.slug)));
    company.disabled = data.companies.length === 0;
    cutoff.disabled = data.companies.length === 0;
    syncSelection(Boolean(selectionFromUrl().slug));
  } catch (error) {
    showError(inventory, `Could not load inventory: ${error.message}`, loadOverview);
  }
}

company.addEventListener('change', () => navigateTo(company.value, cutoff.value));
cutoff.addEventListener('change', () => navigateTo(company.value, cutoff.value));
document.querySelector('#clear-selection').addEventListener('click', clearSelection);
window.addEventListener('popstate', () => syncSelection());
loadOverview();
