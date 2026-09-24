(function exposeExploreView(globalScope) {
  'use strict';

  function create(context) {
    const {
      root, state, data, discovery, occurrenceById, identityReviewById, model,
      categoryName, financingFor, locationReviewFor, locationReviewInSelectedYear,
      identityReviewFor, candidateLocationFor, providerLocationInSelectedYear,
      money, financials, companyDetail, commitState, writeUrl, pinCount
    } = context;
    const { node, append, link, title, metric, table } = globalScope.LogPoseUI;

    function occurrenceText(occurrence) {
      return [occurrence.name, occurrence.description, occurrence.homepage_url, occurrence.repo_url,
        occurrence.source_category, occurrence.source_subcategory,
        ...occurrence.candidate_tags.map(categoryName)]
        .join(' ').toLocaleLowerCase();
    }

    function matchingOccurrences(candidate, terms) {
      const review = identityReviewFor(candidate);
      const reviewText = review && (state.searchYear === 'all'
        || review.source_year === Number(state.searchYear))
        ? [review.provider_name, review.review_note, review.provider_relation].join(' ').toLocaleLowerCase()
        : '';
      return candidate.occurrence_ids.map(id => occurrenceById.get(id)).filter(item =>
        (state.category === 'all' || item.candidate_tags.includes(state.category))
        && (state.searchYear === 'all' || item.year === Number(state.searchYear))
        && (state.searchSource === 'all' || item.source === state.searchSource)
        && terms.every(term => occurrenceText(item).includes(term) || reviewText.includes(term)));
    }

    function renderSearch() {
      root.append(title('03 / EXPLORE', 'explore evidence',
        'filter leads. open source records or selected company history.'));

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
      [['all', 'All record types'], ['provider', 'Reviewed provider leads'],
        ['lead', 'Directory leads'],
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

    function searchAggregation(hits, providers, pilots) {
      const panel = node('details', '', 'search-aggregation');
      panel.append(node('summary', 'break down current matches by tag and year'));
      const body = node('div', '', 'aggregation-body');
      body.append(node('p', 'aggregation / current result set', 'eyebrow'),
        node('h3', 'where the matches appear'));
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
      const byProviderCategory = node('div');
      byProviderCategory.append(node('h4', 'Reviewed provider tags'));
      ['data_infrastructure', 'developer_tools', 'security_observability', 'ai_automation']
        .forEach(tag => byProviderCategory.append(append(node('p', '', 'aggregate-row'),
          node('span', categoryName(tag)),
          node('strong', String(providers.filter(item => item.candidate_tags.includes(tag)).length)))));
      const byProviderYear = node('div');
      byProviderYear.append(node('h4', 'Provider inventory years'));
      data.years.forEach(year => byProviderYear.append(append(node('p', '', 'aggregate-row'),
        node('span', String(year)),
        node('strong', String(providers.filter(item =>
          item.observed_inventory_years.includes(year)).length)))));
      counts.append(byCategory, byYear, byProviderCategory, byProviderYear,
        byPilotCategory, byPilotYear);
      const reviewedProviders = new Set(hits.map(hit => hit.candidate.identity_review_id)
        .filter(id => id && identityReviewById.get(id)?.provider_name));
      const usProviderGroups = new Set(hits.filter(hit =>
        candidateLocationFor(hit.candidate)?.decision === 'documented_us_base')
        .map(hit => hit.candidate.identity_review_id));
      body.append(counts, node('p', hits.length + ' distinct directory candidate keys · '
        + reviewedProviders.size + ' reviewed provider relationships · '
        + usProviderGroups.size + ' with dated U.S. base evidence · '
        + providers.length + ' reviewed provider leads in results ('
        + providers.filter(item => providerLocationInSelectedYear(item)?.decision === 'documented_us_base').length
        + ' with dated U.S. base evidence) · '
        + pilots.length + ' selected pilot companies · '
        + pilots.filter(hit => financingFor(hit.company.slug).length).length
        + ' with a financing announcement. Tags and years overlap; these are not market-size counts.', 'muted'));
      panel.append(body);
      return panel;
    }

    function providerDetail(provider) {
      const section = node('section', '', 'candidate-detail');
      section.append(node('p', 'REVIEWED PROVIDER LEAD / COMPANY ELIGIBILITY UNREVIEWED', 'eyebrow'),
        node('h3', provider.name),
        node('p', provider.directory_item_names.join(' · ') + ' · '
          + provider.provider_relations.map(item => item.replaceAll('_', ' ')).join(', '), 'muted'));
      const location = providerLocationInSelectedYear(provider);
      if (location) section.append(append(node('div', '', 'identity-review'),
        node('p', 'U.S. LOCATION SOURCE / ' + location.source_year, 'eyebrow'),
        node('p', location.source_note), link('Open location source ↗', location.source_url)));
      else section.append(node('p', provider.us_status === 'reviewed_unresolved'
        ? 'Location review is unresolved for this provider and selected year.'
        : 'No reviewed U.S. base source for this provider and selected year.', 'caveat'));
      provider.identity_review_ids.forEach(id => {
        const review = identityReviewById.get(id);
        section.append(append(node('div', '', 'identity-review'),
          node('p', review.item_kind.replaceAll('_', ' ') + ' · '
            + review.provider_relation.replaceAll('_', ' ') + ' · source ' + review.source_year, 'eyebrow'),
          node('p', review.review_note), link('Open relationship source ↗', review.source_url)));
      });
      const list = node('div', '', 'occurrence-list');
      provider.directory_candidate_ids.forEach(id => {
        const candidate = discovery.candidates.find(item => item.id === id);
        const first = occurrenceById.get(candidate.occurrence_ids[0]);
        list.append(append(node('article', '', 'occurrence'),
          node('p', candidate.name + ' · inventory years '
            + candidate.observed_years.join(', '), 'eyebrow'),
          node('p', candidate.homepage_url || candidate.repo_url || 'No listed URL.'),
          link('Pinned source row ↗', first.source_url),
          node('small', 'Row path ' + first.source_path.join('.') + ' · SHA-256 '
            + first.artifact_sha256.slice(0, 12) + '…')));
      });
      section.append(node('h4', 'Linked directory keys'), list,
        node('p', 'The provider relationship is reviewed, but the source inventories do not establish company eligibility or continuous U.S. status.', 'caveat'));
      return section;
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

    function candidateDetail(candidate) {
      const section = node('section', '', 'candidate-detail');
      const review = identityReviewFor(candidate);
      section.append(node('p', review ? 'DIRECTORY LEAD / MANUAL IDENTITY REVIEW' :
        'DIRECTORY LEAD / IDENTITY AND U.S. LOCATION UNREVIEWED', 'eyebrow'),
        node('h3', candidate.name),
        node('p', candidate.description || 'The source inventory provides no description.', 'muted'));
      if (candidate.homepage_url) section.append(link('Source-listed website ↗', candidate.homepage_url));
      if (review) {
        const identity = node('div', '', 'identity-review');
        identity.append(node('p', review.item_kind.replaceAll('_', ' ') + ' · '
          + (review.provider_name ? review.provider_relation.replaceAll('_', ' ') + ': '
            + review.provider_name : 'no single provider established'), 'eyebrow'),
        node('p', review.review_note),
        link('Open identity source ↗', review.source_url),
        node('p', 'Reviewed source year ' + review.source_year + ' · '
          + review.candidate_ids.length + ' linked directory keys', 'caption'));
        if (review.candidate_ids.length > 1) {
          const aliases = node('ul', '', 'identity-aliases');
          review.candidate_ids.forEach(id => {
            const linked = discovery.candidates.find(item => item.id === id);
            aliases.append(append(node('li'), node('span', linked.observed_years.join(', ') + ' · '),
              link(linked.homepage_url || linked.repo_url || linked.name,
                linked.homepage_url || linked.repo_url)));
          });
          identity.append(aliases);
        }
        section.append(identity);
        const location = candidateLocationFor(candidate);
        if (location) section.append(append(node('div', '', 'identity-review'),
          node('p', 'U.S. LOCATION SOURCE / ' + location.source_year, 'eyebrow'),
          node('p', location.source_note),
          link('Open location source ↗', location.source_url)));
      }
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
      section.append(list, node('p', 'Inventory presence is a dated directory observation. A reviewed provider relationship does not establish exclusive ownership, U.S. location, financing, or traction.', 'caveat'));
      return section;
    }

    function updateSearchResults() {
      const target = document.querySelector('#search-results');
      target.replaceChildren();
      const terms = state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      const hits = ['provider', 'pilot', 'financial', 'financing'].includes(state.searchType) ? []
        : discovery.candidates.map(candidate => ({
          candidate,
          occurrences: matchingOccurrences(candidate, terms)
        })).filter(hit => hit.occurrences.length && (state.searchUs === 'all'
          || candidateLocationFor(hit.candidate)?.decision ===
            (state.searchUs === 'documented' ? 'documented_us_base' : 'unresolved')));
      const providers = !['all', 'provider'].includes(state.searchType) ? []
        : discovery.provider_candidates.filter(provider =>
          (state.searchUs === 'all' || providerLocationInSelectedYear(provider)?.decision ===
            (state.searchUs === 'documented' ? 'documented_us_base' : 'unresolved'))
          && provider.directory_candidate_ids.some(id => {
            const candidate = discovery.candidates.find(item => item.id === id);
            return matchingOccurrences(candidate, terms).length > 0;
          }));
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
        && !['lead', 'provider'].includes(state.searchType)
        && (state.searchUs === 'all'
          || (state.searchUs === 'documented' && locationReviewInSelectedYear(item.slug)?.decision === 'documented_us_base')
          || (state.searchUs === 'unresolved' && locationReviewInSelectedYear(item.slug)?.decision === 'unresolved'))
        && (state.searchType !== 'financial' || item.cik)
        && (state.searchType !== 'financing' || financingMatches.length)
        && (terms.every(term => [item.name, item.purpose, item.url].join(' ')
          .toLocaleLowerCase().includes(term)) || evidenceMatches.length > 0
          || financingMatches.length > 0));
      hits.sort((left, right) => candidateScore(right.candidate, state.query)
        - candidateScore(left.candidate, state.query)
        || left.candidate.name.localeCompare(right.candidate.name));
      target.append(append(node('div', '', 'search-summary'),
        metric(String(hits.length), 'Directory leads', 'Product or project keys; U.S. evidence varies'),
        metric(String(providers.length), 'Provider leads', 'Reviewed relationships; eligibility open'),
        metric(String(pilots.length), 'Pilot companies', 'Selected and separately sourced'),
        metric(String(pilots.filter(hit => hit.company.cik).length), 'With SEC facts', 'Reported fundamentals; no price series'),
        metric(String(pilots.filter(hit => financingFor(hit.company.slug).length).length),
          'With financing news', 'Company announcements; selected events only'),
        metric(String(pilots.filter(hit => locationReviewInSelectedYear(hit.company.slug)?.decision === 'documented_us_base').length),
          'With U.S. base evidence', 'Source year matches selected year')));
      target.append(searchAggregation(hits, providers, pilots));
      const resultList = node('div', '', 'search-result-list');
      providers.forEach(provider => {
        const button = node('button', state.selectedProvider === provider.id
          ? 'Hide reviewed evidence' : 'Inspect reviewed evidence →', 'text-button');
        button.type = 'button';
        button.addEventListener('click', () => {
          state.selectedProvider = state.selectedProvider === provider.id ? null : provider.id;
          updateSearchResults();
          document.querySelector('#provider-' + provider.id)?.scrollIntoView({ block: 'nearest' });
        });
        const location = providerLocationInSelectedYear(provider);
        const card = append(node('article', '', 'search-result'),
          node('p', 'REVIEWED PROVIDER LEAD · '
            + provider.observed_inventory_years.join(', '), 'eyebrow'),
          node('h3', provider.name),
          node('p', provider.directory_item_names.join(' · '), 'muted'),
          node('p', provider.provider_relations.map(item => item.replaceAll('_', ' ')).join(' · '), 'search-tags'),
          node('p', location?.decision === 'documented_us_base'
            ? 'U.S. ' + location.location_kind.replaceAll('_', ' ') + ' · '
              + location.place + ' · source ' + location.source_year
            : location ? 'U.S. location review unresolved · source ' + location.source_year
              : 'U.S. location unreviewed', 'search-tags'), button);
        card.id = 'provider-' + provider.id;
        resultList.append(card);
        if (state.selectedProvider === provider.id) resultList.append(providerDetail(provider));
      });
      pilots.forEach(({ company: item, evidenceMatches }) => {
        const announcements = financingFor(item.slug);
        const locationReview = locationReviewInSelectedYear(item.slug);
        const button = node('button', 'Open dated company evidence →', 'text-button');
        button.type = 'button';
        button.addEventListener('click', () => {
          commitState({ view: 'explore', company: item.slug, query: item.name }, {
            focus: '#company-detail'
          });
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
          state.compareSlugs = model.togglePinned(state.compareSlugs, item.slug);
          updateSearchResults();
          pinCount.textContent = String(state.compareSlugs.length);
          writeUrl();
          document.querySelector(`[data-compare="${item.slug}"]`)?.focus();
        });
        compare.dataset.compare = item.slug;
        card.append(compare);
        if (locationReview) card.append(node('p', locationReview.decision === 'documented_us_base'
          ? 'U.S. ' + locationReview.location_kind.replaceAll('_', ' ') + ' · '
            + locationReview.place + ' · source ' + locationReview.source_year
          : 'location review unresolved · source ' + locationReview.source_year
            + ' · no headquarters declared', 'search-tags'));
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
        const review = identityReviewFor(item);
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
        if (review) card.append(node('p', review.provider_name
          ? 'reviewed ' + review.item_kind.replaceAll('_', ' ') + ' · '
            + review.provider_relation.replaceAll('_', ' ') + ': ' + review.provider_name
          : 'reviewed project · no single company established', 'search-tags'));
        const leadLocation = candidateLocationFor(item);
        if (leadLocation) card.append(node('p', leadLocation.decision === 'documented_us_base'
          ? 'U.S. ' + leadLocation.location_kind.replaceAll('_', ' ') + ' · '
            + leadLocation.place + ' · source ' + leadLocation.source_year
          : 'location review unresolved · source ' + leadLocation.source_year, 'search-tags'));
        if (item.pilot_match) {
          const evidenceButton = node('button', 'Open pilot company evidence →', 'text-button');
          evidenceButton.type = 'button';
          evidenceButton.addEventListener('click', () => {
            const company = data.companies.find(entry => entry.slug === item.pilot_match.slug);
            commitState({ view: 'explore', company: item.pilot_match.slug,
              query: company?.name || item.pilot_match.slug }, { focus: '#company-detail' });
          });
          card.append(node('p', review?.pilot_slug === item.pilot_match.slug
            ? 'reviewed provider link to pilot; location evidence is separate.'
            : 'possible link: exact name and listed homepage. Legal identity unreviewed.', 'caption'),
            evidenceButton);
        }
        card.id = 'candidate-' + item.id;
        resultList.append(card);
        if (state.selectedCandidate === item.id) resultList.append(candidateDetail(item));
      });
      if (state.company) {
        const detail = companyDetail(state.company);
        detail.id = 'company-detail';
        detail.tabIndex = -1;
        target.append(detail);
      }
      target.append(resultList);
      if (hits.length > state.searchLimit) {
        const more = node('button', 'Show 30 more leads', 'quiet-button');
        more.type = 'button';
        more.addEventListener('click', () => { state.searchLimit += 30; updateSearchResults(); });
        target.append(more);
      }
      if (!hits.length && !providers.length && !pilots.length) target.append(node('p', 'No records match these filters.', 'muted'));
    }

    return { render: renderSearch };
  }

  globalScope.LogPoseExplore = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
