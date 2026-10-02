/* Read-only company context for an explicit reviewed pilot identity. */
(function (root) {
  'use strict';
  const { node } = root.LogPoseUI;
  const model = root.LogPoseResearchModel;
  let retained;
  let generation = 0;

  async function load() {
    if (!retained) retained = Promise.all(['./dashboard.json', './data/index.json'].map(async path => {
      const response = await root.fetch(path);
      if (!response.ok) throw new Error('company evidence could not be loaded');
      return response.json();
    })).then(([pilot, catalog]) => {
      if (!catalog.build_id || !Array.isArray(catalog.sec) || !Array.isArray(pilot.years)
          || !pilot.years.length || !Array.isArray(pilot.companies) || !Array.isArray(pilot.financials?.cells))
        throw new Error('company evidence is incomplete');
      return { pilot, catalog };
    }).catch(error => { retained = null; throw error; });
    return retained;
  }
  function sourceLink(label, fact, slug, catalog) {
    const anchor = node('a', label);
    anchor.href = `./index.html?${new URLSearchParams({ view: 'data', dataFamily: 'sec',
      dataCompany: slug, dataRecord: `sec:${fact.fact_id}`, dataBuild: catalog.build_id })}`;
    return anchor;
  }
  function money(value) {
    if (value === null) return 'Unknown';
    const scale = Math.abs(value) >= 1e9 ? 1e9 : 1e6;
    return `${value < 0 ? '−' : ''}$${new Intl.NumberFormat('en-US', {
      maximumFractionDigits: scale === 1e9 ? 2 : 1 }).format(Math.abs(value) / scale)}${scale === 1e9 ? 'b' : 'm'}`;
  }
  function percent(value) {
    return value === null ? 'Unknown' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Math.abs(value))}%`;
  }
  function show(candidate, inspector, isCurrent) {
    const slug = candidate.identity_review?.pilot_slug;
    if (!slug) return;
    const ticket = ++generation;
    const panel = node('section', '', 'atlas-company-summary');
    panel.dataset.company = slug;
    panel.setAttribute('aria-label', `${candidate.name} company facts`);
    panel.append(node('p', 'loading retained company facts…', 'atlas-company-loading'));
    inspector.append(panel);
    const active = () => ticket === generation && panel.isConnected && isCurrent();
    (async () => {
      try {
        const { pilot, catalog } = await load();
        if (!active()) return;
        // Reporting time stays independent of the inventory slider's clock.
        const year = Math.max(...pilot.years);
        const summary = model.companyStatsFor(pilot, slug, year);
        if (!summary) throw new Error('reviewed identity has no retained company sheet');
        const { company, current, revenue, priorRevenue, netIncome, cutoff } = summary;
        for (const fact of [revenue, priorRevenue, netIncome].filter(Boolean)) {
          const record = catalog.sec.find(item => item.id === `sec:${fact.fact_id}`);
          if (!record || record.company_slug !== slug || record.value !== fact.value
              || record.start_date !== fact.start_date || record.end_date !== fact.end_date
              || record.filed_date !== fact.filed_date || record.unit !== fact.unit || !record.selected)
            throw new Error('company metric and retained source disagree');
        }
        panel.replaceChildren(node('p', company.purpose.replace('Company homepage candidate; ', ''), 'atlas-company-product'),
          node('p', `company reporting · periods ending ${year}`, 'atlas-company-clock'));
        const metrics = node('div', '', 'atlas-company-stats');
        const rows = [
          { name: 'annual revenue', value: money(current.revenue), basis: 'reported · USD',
            sources: revenue ? [['source', revenue]] : [] },
          { name: 'annual growth', value: percent(current.growth), basis: 'derived · revenue change',
            sources: current.growth === null ? [] : [['current', revenue], ['prior', priorRevenue]] },
          { name: 'net-income margin', value: percent(current.margin), basis: 'derived · net income ÷ revenue',
            sources: current.margin === null ? [] : [['income', netIncome], ['revenue', revenue]] }
        ];
        for (const row of rows) {
          const metric = node('article', '', 'atlas-company-stat');
          if (row.value === 'Unknown') metric.classList.add('is-unknown');
          metric.append(node('span', row.name), node('strong', row.value), node('small', row.basis));
          const links = node('div', '', 'atlas-stat-sources');
          row.sources.forEach(([label, fact]) => links.append(sourceLink(label, fact, slug, catalog)));
          metric.append(links); metrics.append(metric);
        }
        panel.append(metrics);
        if (current.revenue !== null) {
          const period = node('p', `${current.periodStart} to ${current.periodEnd}`, 'atlas-company-period');
          period.append(node('span', ` filed ${current.filed}`, 'atlas-company-filed'));
          panel.append(period);
        }
        const provenance = node('p', `filings through ${cutoff}.`, 'atlas-company-period');
        provenance.append(node('span', ' historical company periods; independent of the graph’s inventory year.', 'atlas-company-time-note'));
        panel.append(provenance,
          node('p', 'MRR / ARR / retention / cash flow: Unknown in this collection.', 'atlas-company-gaps'));
        const deeper = node('a', 'full stat sheet, sources & further reading →', 'atlas-company-detail-link');
        deeper.href = root.LogPoseAtlasModel.companyRoute(candidate, year);
        panel.append(deeper);
      } catch (error) {
        if (!active()) return;
        panel.replaceChildren(node('p', `company facts unavailable: ${error.message}`));
        const retry = node('button', 'retry company facts', 'quiet-button'); retry.type = 'button';
        retry.addEventListener('click', () => {
          if (!active()) return;
          retained = null; panel.remove(); show(candidate, inspector, isCurrent);
        });
        const deeper = node('a', 'open company research →');
        deeper.href = `./index.html?${new URLSearchParams({ view: 'explore', company: slug })}#company-detail`;
        panel.append(retry, deeper);
      }
    })();
  }
  root.LogPoseAtlasCompany = { show, clear: () => { generation += 1; } };
})(globalThis);
