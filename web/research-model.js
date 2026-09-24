(function exposeResearchModel(globalScope) {
  'use strict';

  const VALID_VIEWS = new Set(['overview', 'compare', 'explore', 'topology']);
  const MAX_PINNED = 4;
  const TOPOLOGY_PREDICATES = new Set([
    'possible_substitute_for', 'named_competitor_of', 'integrates_with',
    'announced_partnership_with', 'invested_in', 'shared_exposure_hypothesis'
  ]);
  const TOPOLOGY_STATUSES = new Set(['documented', 'reviewed_inference', 'hypothesis']);
  const TOPOLOGY_DIRECTIONS = new Set(['symmetric', 'subject_to_object', 'object_to_subject']);

  function topologyCategory(predicate) {
    if (predicate === 'possible_substitute_for' || predicate === 'named_competitor_of') {
      return 'competition';
    }
    if (predicate === 'shared_exposure_hypothesis') return 'performance_exposure';
    return 'collaboration';
  }

  function claimSourceDate(claim) {
    return claim.sources.reduce((latest, source) =>
      source.source_date > latest ? source.source_date : latest, '');
  }

  function filterTopologyClaims(claims, { sourceYear = 'all', category = 'all', status = 'all',
    company = null } = {}) {
    const cutoff = sourceYear === 'all' ? null : `${sourceYear}-12-31`;
    return claims.filter(claim =>
      (!cutoff || claimSourceDate(claim) <= cutoff)
      && (category === 'all' || topologyCategory(claim.predicate) === category)
      && (status === 'all' || claim.claim_status === status)
      && (!company || claim.subject_slug === company || claim.object_slug === company));
  }

  function topologyPositions(claims) {
    const slugs = [...new Set(claims.flatMap(claim => [claim.subject_slug, claim.object_slug]))].sort();
    const positions = new Map();
    slugs.forEach((slug, index) => {
      const angle = -Math.PI / 2 + index * 2 * Math.PI / slugs.length;
      const radius = slugs.length <= 6 ? 245 : 275;
      positions.set(slug, {
        x: Math.round(500 + Math.cos(angle) * radius),
        y: Math.round(350 + Math.sin(angle) * radius)
      });
    });
    return positions;
  }

  function topologyGraphSlice(claims, focus = null, maxNodes = 16, maxClaims = 48) {
    const slugs = [...new Set(claims.flatMap(claim => [claim.subject_slug, claim.object_slug]))].sort();
    const neighbors = focus ? [...new Set(claims.filter(claim =>
      claim.subject_slug === focus || claim.object_slug === focus).map(claim =>
      claim.subject_slug === focus ? claim.object_slug : claim.subject_slug))].sort() : [];
    const chosen = focus ? [focus, ...neighbors].slice(0, maxNodes) : slugs.slice(0, maxNodes);
    const chosenSlugs = new Set(chosen);
    const connectedClaims = claims.filter(claim => chosenSlugs.has(claim.subject_slug)
      && chosenSlugs.has(claim.object_slug)).sort((left, right) => left.id.localeCompare(right.id));
    return { claims: connectedClaims.slice(0, maxClaims),
      hiddenClaims: claims.length - Math.min(connectedClaims.length, maxClaims),
      hiddenNodes: (focus ? neighbors.length + 1 : slugs.length) - chosen.length };
  }

  function topologyPairGroups(claims) {
    const groups = new Map();
    for (const claim of claims) {
      const pair = [claim.subject_slug, claim.object_slug].sort().join(':');
      if (!groups.has(pair)) groups.set(pair, []);
      groups.get(pair).push(claim);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([pair, groupClaims]) => ({
        pair,
        claims: groupClaims.slice().sort((left, right) => left.id.localeCompare(right.id))
      }));
  }

  function validateTopology(topology, slugs) {
    if (!topology) return true;
    if (!Array.isArray(topology.claims)) throw new Error('source export is missing market_topology.claims');
    if (topology.nodes !== undefined && !Array.isArray(topology.nodes)) {
      throw new Error('source export has invalid market_topology.nodes');
    }
    const nodeIds = new Set();
    for (const graphNode of topology.nodes || []) {
      if (!graphNode.slug || !graphNode.name || nodeIds.has(graphNode.slug)) {
        throw new Error(`invalid or duplicate topology node: ${graphNode.slug || 'missing slug'}`);
      }
      nodeIds.add(graphNode.slug);
      slugs.add(graphNode.slug);
    }
    const ids = new Set();
    for (const claim of topology.claims) {
      if (!claim.id || ids.has(claim.id)) throw new Error(`invalid or duplicate topology claim: ${claim.id || 'missing id'}`);
      ids.add(claim.id);
      if (!slugs.has(claim.subject_slug) || !slugs.has(claim.object_slug)) {
        throw new Error(`topology claim references unknown company: ${claim.id}`);
      }
      if (claim.subject_slug === claim.object_slug) throw new Error(`topology claim has identical endpoints: ${claim.id}`);
      if (!TOPOLOGY_PREDICATES.has(claim.predicate) || !TOPOLOGY_STATUSES.has(claim.claim_status)
          || !TOPOLOGY_DIRECTIONS.has(claim.direction)) {
        throw new Error(`topology claim has invalid predicate, status, or direction: ${claim.id}`);
      }
      if (!claim.scope || !claim.interpretation || !claim.alternative_or_unknown
          || !Array.isArray(claim.sources) || !claim.sources.length) {
        throw new Error(`topology claim lacks scope or source detail: ${claim.id}`);
      }
      for (const source of claim.sources) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(source.source_date || '') || !source.source_url
            || !source.evidence_text || !source.publisher || !source.source_type) {
          throw new Error(`topology claim has incomplete dated source: ${claim.id}`);
        }
      }
    }
    return true;
  }

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
    validateTopology(pilot.market_topology, slugs);
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
    togglePinned,
    topologyCategory,
    claimSourceDate,
    filterTopologyClaims,
    topologyPositions,
    topologyGraphSlice,
    topologyPairGroups,
    validateTopology
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (globalScope) globalScope.LogPoseResearchModel = model;
}(typeof globalThis !== 'undefined' ? globalThis : this));
