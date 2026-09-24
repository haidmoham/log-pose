(function exposeResearchModel(globalScope) {
  'use strict';

  const VALID_VIEWS = new Set(['overview', 'compare', 'explore']);
  const MAX_PINNED = 4;

  function finiteNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean'
        || (typeof value === 'string' && value.trim() === '')) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function buildFinancialIndex(cells) {
    const index = new Map();
    for (const cell of cells) {
      const key = `${cell.slug}:${cell.year}`;
      if (!index.has(key)) index.set(key, {});
      if (Object.hasOwn(index.get(key), cell.concept)) {
        throw new Error(`duplicate financial cell: ${key}:${cell.concept}`);
      }
      index.get(key)[cell.concept] = cell.selected;
    }
    return index;
  }

  function validateExports(pilot, discovery) {
    for (const [name, value] of [
      ['pilot.years', pilot?.years],
      ['pilot.companies', pilot?.companies],
      ['pilot.evidence', pilot?.evidence],
      ['pilot.reviewed_quotes', pilot?.reviewed_quotes],
      ['pilot.financing_announcements', pilot?.financing_announcements],
      ['pilot.us_location_reviews', pilot?.us_location_reviews],
      ['pilot.market', pilot?.market],
      ['pilot.financials.cells', pilot?.financials?.cells],
      ['discovery.artifacts', discovery?.artifacts],
      ['discovery.candidates', discovery?.candidates],
      ['discovery.occurrences', discovery?.occurrences],
      ['discovery.identity_reviews', discovery?.identity_reviews],
      ['discovery.provider_candidates', discovery?.provider_candidates]
    ]) {
      if (!Array.isArray(value)) throw new Error(`source export is missing ${name}`);
    }
    const slugs = new Set();
    for (const company of pilot.companies) {
      if (!company.slug || slugs.has(company.slug)) {
        throw new Error(`invalid or duplicate company slug: ${company.slug || 'missing'}`);
      }
      slugs.add(company.slug);
    }
    for (const item of [...pilot.evidence, ...pilot.financials.cells]) {
      if (!slugs.has(item.slug)) throw new Error(`source export references unknown company: ${item.slug}`);
    }
    const occurrenceIds = new Set(discovery.occurrences.map(item => item.id));
    for (const candidate of discovery.candidates) {
      if (!Array.isArray(candidate.occurrence_ids)
          || candidate.occurrence_ids.some(id => !occurrenceIds.has(id))) {
        throw new Error(`candidate references an unknown occurrence: ${candidate.id || 'missing id'}`);
      }
    }
    return true;
  }

  function financialsFor(index, slug, year) {
    const current = index.get(`${slug}:${year}`) || {};
    const prior = index.get(`${slug}:${year - 1}`) || {};
    const revenue = finiteNumber(current.revenue?.value);
    const netIncome = finiteNumber(current.net_income?.value);
    const priorRevenue = finiteNumber(prior.revenue?.value);
    const periodsAlign = Boolean(current.revenue && current.net_income
      && current.revenue.start_date === current.net_income.start_date
      && current.revenue.end_date === current.net_income.end_date);
    return {
      revenue,
      netIncome,
      growth: revenue !== null && priorRevenue !== null && priorRevenue > 0
        ? (revenue / priorRevenue - 1) * 100 : null,
      margin: periodsAlign && revenue > 0 && netIncome !== null ? netIncome / revenue * 100 : null,
      assets: finiteNumber(current.assets?.value),
      periodStart: current.revenue?.start_date || null,
      periodEnd: current.revenue?.end_date || null,
      filed: current.revenue?.filed_date || null,
      accession: current.revenue?.accession_number || null,
      rawSha256: current.revenue?.raw_sha256 || null
    };
  }

  function chartScale(values, width, height, padding = 3) {
    const numeric = values.filter(Number.isFinite);
    const low = Math.min(0, ...numeric);
    const high = Math.max(0, ...numeric);
    const span = high - low || 1;
    const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
    const points = values.map((value, index) => value === null || !Number.isFinite(value)
      ? null
      : {
        x: padding + index * step,
        y: padding + (high - value) / span * (height - padding * 2),
        value
      });
    const zeroY = padding + high / span * (height - padding * 2);
    return { low, high, zeroY, points };
  }

  function contiguousSegments(points) {
    const segments = [];
    let active = [];
    for (const point of points) {
      if (point) active.push(point);
      else if (active.length) {
        segments.push(active);
        active = [];
      }
    }
    if (active.length) segments.push(active);
    return segments;
  }

  function parseUrlState(search, validSlugs, years) {
    const params = new URLSearchParams(search);
    const view = VALID_VIEWS.has(params.get('view')) ? params.get('view') : 'overview';
    const requestedYear = Number(params.get('year'));
    const year = years.includes(requestedYear) ? requestedYear : Math.max(...years);
    const company = validSlugs.has(params.get('company')) ? params.get('company') : null;
    const pinned = [];
    for (const slug of (params.get('pinned') || '').split(',')) {
      if (validSlugs.has(slug) && !pinned.includes(slug) && pinned.length < MAX_PINNED) pinned.push(slug);
    }
    return { view, year, company, pinned };
  }

  function toUrlParams(state) {
    const params = new URLSearchParams();
    if (state.view !== 'overview') params.set('view', state.view);
    if (state.year) params.set('year', String(state.year));
    if (state.company) params.set('company', state.company);
    if (state.compareSlugs.length) params.set('pinned', state.compareSlugs.join(','));
    return params.toString();
  }

  function togglePinned(pinned, slug) {
    if (pinned.includes(slug)) return pinned.filter(item => item !== slug);
    if (pinned.length >= MAX_PINNED) return pinned.slice();
    return [...pinned, slug];
  }

  const model = {
    MAX_PINNED,
    VALID_VIEWS,
    finiteNumber,
    buildFinancialIndex,
    validateExports,
    financialsFor,
    chartScale,
    contiguousSegments,
    parseUrlState,
    toUrlParams,
    togglePinned
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (globalScope) globalScope.LogPoseResearchModel = model;
}(typeof globalThis !== 'undefined' ? globalThis : this));
