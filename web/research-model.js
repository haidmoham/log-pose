(function exposeResearchModel(globalScope) {
  'use strict';

  const VALID_VIEWS = new Set(['data', 'overview', 'compare', 'explore', 'topology']);
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
    if (predicate === 'integrates_with' || predicate === 'announced_partnership_with') {
      return 'collaboration';
    }
    if (predicate === 'invested_in') return 'investment';
    if (predicate === 'shared_exposure_hypothesis') return 'performance_exposure';
    return 'unknown';
  }

  function claimSourceDate(claim) {
    return claim.sources.reduce((latest, source) =>
      source.source_date > latest ? source.source_date : latest, '');
  }

  function safeDataRecord(value) {
    return typeof value === 'string' && value.length <= 160
      && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : '';
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

  function topologyPositions3d(claims) {
    // Stable placement aids navigation; separation does not encode claim strength.
    const slugs = [...new Set(claims.flatMap(claim => [claim.subject_slug, claim.object_slug]))].sort();
    const positions = new Map();
    slugs.forEach((slug, index) => {
      const y = 1 - 2 * (index + 0.5) / slugs.length;
      const radius = Math.sqrt(1 - y * y);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      positions.set(slug, { x: radius * Math.cos(angle), y,
        z: radius * Math.sin(angle) });
    });
    return positions;
  }

  function projectTopologyPoint(point, yawDegrees, tiltDegrees, zoom) {
    const yaw = yawDegrees * Math.PI / 180;
    const tilt = tiltDegrees * Math.PI / 180;
    const turnedX = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
    const turnedZ = point.z * Math.cos(yaw) - point.x * Math.sin(yaw);
    const turnedY = point.y * Math.cos(tilt) - turnedZ * Math.sin(tilt);
    const depth = point.y * Math.sin(tilt) + turnedZ * Math.cos(tilt);
    const scale = zoom / (3.7 - depth);
    return { x: turnedX * scale, y: turnedY * scale, depth };
  }

  function topologyGraphSlice(claims, focus = null, maxNodes = 16, maxClaims = 48,
    selectedClaimId = null) {
    const slugs = [...new Set(claims.flatMap(claim => [claim.subject_slug, claim.object_slug]))];
    const degree = new Map(slugs.map(slug => [slug, 0]));
    for (const claim of claims) {
      degree.set(claim.subject_slug, degree.get(claim.subject_slug) + 1);
      degree.set(claim.object_slug, degree.get(claim.object_slug) + 1);
    }
    const compareByDegree = (left, right) => degree.get(right) - degree.get(left)
      || left.localeCompare(right);
    const neighbors = focus ? [...new Set(claims.filter(claim =>
      claim.subject_slug === focus || claim.object_slug === focus).map(claim =>
      claim.subject_slug === focus ? claim.object_slug : claim.subject_slug))]
      .sort(compareByDegree) : [];
    const chosen = focus
      ? [focus, ...neighbors].slice(0, maxNodes)
      : [...slugs].sort(compareByDegree).slice(0, maxNodes);
    const selected = claims.find(claim => claim.id === selectedClaimId);
    if (selected) {
      const requiredSlugs = [selected.subject_slug, selected.object_slug];
      const missingRequired = requiredSlugs.filter(slug => !chosen.includes(slug));
      const removable = chosen.map((slug, index) => ({ slug, index }))
        .filter(({ slug }) => slug !== focus && !requiredSlugs.includes(slug))
        .sort((left, right) => degree.get(left.slug) - degree.get(right.slug)
          || right.slug.localeCompare(left.slug));
      for (const item of removable.slice(0, missingRequired.length).sort((a, b) => b.index - a.index)) {
        chosen.splice(item.index, 1);
      }
      chosen.push(...missingRequired.slice(0, Math.max(0, maxNodes - chosen.length)));
    }
    const chosenSlugs = new Set(chosen);
    const connectedClaims = claims.filter(claim => chosenSlugs.has(claim.subject_slug)
      && chosenSlugs.has(claim.object_slug))
      .sort((left, right) => Number(right.id === selectedClaimId) - Number(left.id === selectedClaimId)
        || left.id.localeCompare(right.id));
    const graphClaims = connectedClaims.slice(0, maxClaims);
    return { claims: graphClaims,
      hiddenClaims: claims.length - graphClaims.length,
      hiddenNodes: slugs.length - chosen.length };
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
    if (topology.entities !== undefined && !Array.isArray(topology.entities)) {
      throw new Error('source export has invalid market_topology.entities');
    }
    if (topology.nodes !== undefined && !Array.isArray(topology.nodes)) {
      throw new Error('source export has invalid market_topology.nodes');
    }
    const nodeIds = new Set();
    for (const graphNode of [...(topology.entities || []), ...(topology.nodes || [])]) {
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

  function validateInventoryPartition(artifact, partition) {
    if (partition?.source !== artifact.source || partition.year !== artifact.year
        || partition.raw_sha256 !== artifact.raw_sha256 || !Array.isArray(partition.rows)
        || partition.rows.length !== artifact.raw_item_count) {
      throw new Error('partition does not match its pinned source');
    }
    const ids = new Set();
    for (const row of partition.rows) {
      if (!row.id || ids.has(row.id) || row.artifact_sha256 !== artifact.raw_sha256
          || row.source !== artifact.source || row.year !== artifact.year
          || !Array.isArray(row.source_path)
          || !['mapped_category', 'unmapped_category'].includes(row.mapping_status)) {
        throw new Error('partition has an invalid or duplicate source row');
      }
      ids.add(row.id);
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

  function parseUrlState(search, validSlugs, years, artifacts = [], pilotSlugs = new Set()) {
    const params = new URLSearchParams(search);
    const requestedView = params.get('view');
    const hasLegacyExploreState = ['company', 'pinned', 'inventory', 'inventoryQuery', 'q',
      'recordYear', 'source', 'type', 'us', 'category'].some(name => params.has(name));
    const view = VALID_VIEWS.has(requestedView) ? requestedView
      : requestedView === null && hasLegacyExploreState ? 'explore' : 'data';
    const requestedYear = Number(params.get('year'));
    const year = years.includes(requestedYear) ? requestedYear : Math.max(...years);
    const company = validSlugs.has(params.get('company')) ? params.get('company') : null;
    const pinned = [];
    for (const slug of (params.get('pinned') || '').split(',')) {
      if (validSlugs.has(slug) && !pinned.includes(slug) && pinned.length < MAX_PINNED) pinned.push(slug);
    }
    const inventoryArtifact = artifacts.includes(params.get('inventory'))
      ? params.get('inventory') : artifacts[0] || null;
    const searchYear = artifacts.some(artifact => artifact.endsWith('-' + params.get('recordYear')))
      ? params.get('recordYear') : 'all';
    const allowedSource = new Set(['all', 'cncf', 'lfai']);
    const allowedType = new Set(['all', 'provider', 'lead', 'pilot', 'financing', 'financial']);
    const allowedUs = new Set(['all', 'documented', 'unresolved']);
    const allowedCategory = new Set(['all', 'data_infrastructure', 'developer_tools',
      'security_observability', 'ai_automation']);
    const allowedDataFamily = new Set(['all', 'inventory', 'pages', 'sec', 'market', 'topology']);
    const allowedTopologyCategory = new Set(['all', 'competition', 'collaboration',
      'investment', 'performance_exposure']);
    const allowedTopologyStatus = new Set(['all', ...TOPOLOGY_STATUSES]);
    const choice = (name, allowed) => allowed.has(params.get(name)) ? params.get(name) : 'all';
    const requestedDataYear = params.get('dataYear') || 'all';
    const dataYear = requestedDataYear === 'all'
      || (/^20(?:20|2[1-6])$/.test(requestedDataYear)) ? requestedDataYear : 'all';
    const requestedDataCompany = params.get('dataCompany') || 'all';
    const dataCompany = requestedDataCompany === 'all' || pilotSlugs.has(requestedDataCompany)
      ? requestedDataCompany : 'all';
    const dataRecord = safeDataRecord(params.get('dataRecord') || '');
    const dataMarketDay = /^20\d{2}-\d{2}-\d{2}$/.test(params.get('dataMarketDay') || '')
      ? params.get('dataMarketDay') : null;
    const allowedMarketMeasures = new Set(['total_shares', 'total_trade_count', 'total_notional']);
    const dataMarketMeasure = allowedMarketMeasures.has(params.get('dataMarketMeasure'))
      ? params.get('dataMarketMeasure') : 'total_shares';
    const topologyLayer = params.get('topologyLayer') === 'reviewed'
      || (!params.has('topologyLayer') && params.has('selectedClaim')) ? 'reviewed' : 'field';
    const fieldSource = ['all', 'cncf', 'lfai'].includes(params.get('fieldSource'))
      ? params.get('fieldSource') : 'all';
    const fieldYear = /^20(?:20|2[1-6])$/.test(params.get('fieldYear') || '')
      ? params.get('fieldYear') : 'all';
    const fieldTag = ['all', 'ai_automation', 'data_infrastructure',
      'developer_tools', 'security_observability'].includes(params.get('fieldTag'))
      ? params.get('fieldTag') : 'all';
    const fieldIdentity = ['all', 'reviewed', 'unreviewed'].includes(params.get('fieldIdentity'))
      ? params.get('fieldIdentity') : 'all';
    const requestedFieldCategory = params.get('fieldCategory') || 'all';
    const fieldCategory = requestedFieldCategory.length <= 120 && !/[\x00-\x1f]/.test(requestedFieldCategory)
      ? requestedFieldCategory : 'all';
    const requestedTopologyYear = params.get('topologySourceYear') || 'all';
    const topologySourceYear = requestedTopologyYear === 'all'
      || /^20(?:20|2[1-6])$/.test(requestedTopologyYear) ? requestedTopologyYear : 'all';
    return { view, year, company, pinned, inventoryArtifact,
      inventoryQuery: (params.get('inventoryQuery') || '').slice(0, 200),
      query: (params.get('q') || '').slice(0, 200), searchYear,
      searchSource: choice('source', allowedSource), searchType: choice('type', allowedType),
      searchUs: choice('us', allowedUs), category: choice('category', allowedCategory),
      dataFamily: choice('dataFamily', allowedDataFamily),
      dataQuery: (params.get('dataQuery') || '').slice(0, 200), dataCompany,
      dataYear, dataRecord, dataMarketDay, dataMarketMeasure,
      dataMarketParticipant: safeDataRecord(params.get('dataMarketParticipant') || '') || null,
      topologyLayer, fieldQuery: (params.get('fieldQuery') || '').slice(0, 200),
      fieldSource, fieldYear, fieldTag, fieldCategory, fieldIdentity,
      fieldCandidate: safeDataRecord(params.get('fieldCandidate') || '') || null,
      fieldNeighbor: safeDataRecord(params.get('fieldNeighbor') || '') || null,
      topologySourceYear, topologyCategory: choice('topologyCategory', allowedTopologyCategory),
      topologyStatus: choice('topologyStatus', allowedTopologyStatus),
      selectedClaim: safeDataRecord(params.get('selectedClaim') || '') || null };
  }

  function toUrlParams(state) {
    const params = new URLSearchParams();
    if (state.view !== 'data') params.set('view', state.view);
    if (state.view === 'data' && (state.company || state.compareSlugs.length)) {
      params.set('view', 'data');
    }
    if (state.view !== 'data' && state.view !== 'explore' && state.year) {
      params.set('year', String(state.year));
    }
    if (state.company) params.set('company', state.company);
    if (state.compareSlugs.length) params.set('pinned', state.compareSlugs.join(','));
    if (state.view === 'explore') {
      params.set('view', 'explore');
      if (state.inventoryArtifact && state.inventoryArtifact !== 'cncf-2026')
        params.set('inventory', state.inventoryArtifact);
      if (state.inventoryQuery) params.set('inventoryQuery', state.inventoryQuery);
      if (state.query) params.set('q', state.query);
      if (state.searchYear !== 'all') params.set('recordYear', state.searchYear);
      if (state.searchSource !== 'all') params.set('source', state.searchSource);
      if (state.searchType !== 'all') params.set('type', state.searchType);
      if (state.searchUs !== 'all') params.set('us', state.searchUs);
      if (state.category !== 'all') params.set('category', state.category);
    }
    if (state.view === 'data') {
      if (state.dataFamily && state.dataFamily !== 'all') params.set('dataFamily', state.dataFamily);
      if (state.dataQuery) params.set('dataQuery', state.dataQuery.slice(0, 200));
      if (state.dataCompany && state.dataCompany !== 'all') params.set('dataCompany', state.dataCompany);
      if (state.dataYear && state.dataYear !== 'all') params.set('dataYear', state.dataYear);
      const dataRecord = safeDataRecord(state.dataRecord);
      if (dataRecord) params.set('dataRecord', dataRecord);
      if (state.dataFamily === 'market' && dataRecord?.startsWith('market-file:')) {
        if (state.dataMarketDay) params.set('dataMarketDay', state.dataMarketDay);
        if (state.dataMarketMeasure && state.dataMarketMeasure !== 'total_shares')
          params.set('dataMarketMeasure', state.dataMarketMeasure);
        const participant = safeDataRecord(state.dataMarketParticipant);
        if (participant) params.set('dataMarketParticipant', participant);
      }
    }
    if (state.view === 'topology') {
      if (state.topologyLayer === 'reviewed') {
        params.set('topologyLayer', 'reviewed');
        if (state.topologySourceYear && state.topologySourceYear !== 'all')
          params.set('topologySourceYear', state.topologySourceYear);
        if (state.topologyCategory && state.topologyCategory !== 'all')
          params.set('topologyCategory', state.topologyCategory);
        if (state.topologyStatus && state.topologyStatus !== 'all')
          params.set('topologyStatus', state.topologyStatus);
        const selectedClaim = safeDataRecord(state.selectedClaim);
        if (selectedClaim) params.set('selectedClaim', selectedClaim);
      } else {
        if (state.fieldQuery) params.set('fieldQuery', state.fieldQuery.slice(0, 200));
        if (state.fieldSource !== 'all') params.set('fieldSource', state.fieldSource);
        if (state.fieldYear !== 'all') params.set('fieldYear', state.fieldYear);
        if (state.fieldTag !== 'all') params.set('fieldTag', state.fieldTag);
        if (state.fieldCategory !== 'all') params.set('fieldCategory', state.fieldCategory);
        if (state.fieldIdentity !== 'all') params.set('fieldIdentity', state.fieldIdentity);
        const fieldCandidate = safeDataRecord(state.fieldCandidate);
        const fieldNeighbor = safeDataRecord(state.fieldNeighbor);
        if (fieldCandidate) params.set('fieldCandidate', fieldCandidate);
        if (fieldNeighbor) params.set('fieldNeighbor', fieldNeighbor);
      }
    }
    return params.toString();
  }

  // Keep existing bookmarks usable after the study moved to its own application.
  function legacyResearchSetTarget(search) {
    const previous = new URLSearchParams(search);
    if (previous.get('view') !== 'research-set') return null;
    const study = new URLSearchParams();
    for (const name of ['member', 'role', 'disposition', 'researchQuery']) {
      if (previous.has(name)) study.set(name, previous.get(name));
    }
    const query = study.toString();
    return './experimental/mlops-2024/index.html' + (query ? '?' + query : '');
  }

  function togglePinned(pinned, slug) {
    if (pinned.includes(slug)) return pinned.filter(item => item !== slug);
    if (pinned.length >= MAX_PINNED) return pinned.slice();
    return [...pinned, slug];
  }

  const model = {
    legacyResearchSetTarget,
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
    topologyPositions3d,
    projectTopologyPoint,
    topologyGraphSlice,
    topologyPairGroups,
    validateTopology,
    validateInventoryPartition
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (globalScope) globalScope.LogPoseResearchModel = model;
}(typeof globalThis !== 'undefined' ? globalThis : this));
