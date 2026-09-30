(function exposeDecisionBrief(globalScope) {
  'use strict';

  const STORAGE_KEY = 'log-pose.decision-brief.v1';
  const NOTE_LABELS = {
    why: 'why this company deserves attention',
    counterevidence: 'strongest counterargument or counterevidence',
    unknowns: 'what is still unknown',
    next_action: 'what evidence or next action could change your decision'
  };
  const STATUS_LABELS = { undecided: 'undecided', investigate: 'investigate next',
    watch: 'watch', pass: 'pass for this question' };

  function create({ model, index, pilot, state, openRecord }) {
    const { node, append } = globalScope.LogPoseUI;
    let draft = model.emptyDecisionDraft();
    let storageMessage = 'notes stay in this browser. download a copy before sharing or clearing browser data.';
    let maySave = true;
    let lastSavedText = null;
    let visibleStatus = null;
    try {
      const saved = globalScope.localStorage.getItem(STORAGE_KEY);
      if (saved) draft = model.parseDecisionDraft(saved);
      lastSavedText = saved;
    } catch {
      maySave = false;
      storageMessage = 'the saved draft could not be read. it has not been overwritten. '
        + 'new notes stay in this open tab; download them before leaving.';
    }

    function pauseConflictingSave() {
      maySave = false;
      storageMessage = 'another tab changed the saved draft. your notes remain in this tab and have not overwritten it. '
        + 'download your version before reloading to read the other draft.';
      if (visibleStatus?.isConnected) visibleStatus.textContent = storageMessage;
    }

    globalScope.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY && event.newValue !== lastSavedText) pauseConflictingSave();
    });

    function saveDraft(status) {
      if (maySave) {
        try {
          if (globalScope.localStorage.getItem(STORAGE_KEY) !== lastSavedText) {
            pauseConflictingSave();
            status.textContent = storageMessage;
            return;
          }
          const serialized = JSON.stringify(draft);
          model.parseDecisionDraft(serialized);
          globalScope.localStorage.setItem(STORAGE_KEY, serialized);
          lastSavedText = serialized;
          storageMessage = 'saved in this browser only. notes are excluded from page URLs; download a copy to keep or share.';
        } catch {
          maySave = false;
          storageMessage = 'this draft could not be saved in browser storage. notes remain in this open tab; download them before leaving.';
        }
      }
      status.textContent = storageMessage;
    }

    function editableNote(slug) {
      let note = draft.notes.find(item => item.slug === slug);
      if (!note) {
        note = model.decisionNote(draft, slug);
        draft.notes.push(note);
      }
      return note;
    }

    function textField(label, id, value, onInput) {
      const control = node('label', '', 'decision-field');
      control.htmlFor = id;
      const input = node('textarea');
      input.id = id;
      input.rows = 2;
      input.maxLength = 2000;
      input.value = value;
      input.addEventListener('input', () => onInput(input.value.slice(0, 2000)));
      control.append(node('span', label), input);
      return control;
    }

    function evidenceChoices(company, status) {
      const note = model.decisionNote(draft, company.slug);
      const details = node('details', '', 'decision-evidence');
      const records = model.decisionEvidence(index, company.slug);
      const selectedIds = new Set(note.citations.map(item => item.id));
      // Keep source alternatives available in the desk. Initially offer captured
      // pages, selected-period facts and reviewed claims, plus any cited record.
      const offered = records.filter(record => record.family !== 'sec'
        || (record.selected && record.year === state.year) || selectedIds.has(record.id));
      const summary = node('summary');
      const updateSummary = () => {
        const count = model.decisionNote(draft, company.slug).citations.length;
        summary.textContent = `link retained evidence · ${count} cited`;
      };
      updateSummary();
      details.append(summary, node('p', 'choose the role each record plays in your reasoning. '
        + 'a cited publisher statement is not independently verified. SEC choices below use the selected reporting year.', 'caveat'));
      for (const record of offered) {
        const row = node('div', '', 'decision-evidence-row');
        const inspect = node('button', record.label + ' →', 'text-button');
        inspect.type = 'button';
        inspect.addEventListener('click', () => openRecord(record));
        const role = node('select');
        role.setAttribute('aria-label', `${company.name}: role of ${record.label}`);
        [['', 'not cited'], ['supports', 'supports my case'], ['challenges', 'challenges my case'],
          ['context', 'context only']].forEach(([value, label]) => role.add(new Option(label, value)));
        role.value = note.citations.find(item => item.id === record.id
          && item.catalog_build_id === index.build_id)?.role || '';
        role.addEventListener('change', () => {
          const current = editableNote(company.slug);
          const previous = current.citations.find(item =>
            item.id === record.id && item.catalog_build_id === index.build_id);
          const retained = current.citations.filter(item =>
            item.id !== record.id || item.catalog_build_id !== index.build_id);
          if (role.value && retained.length >= model.MAX_DECISION_CITATIONS) {
            role.value = previous?.role || '';
            status.textContent = 'citation limit reached. remove a current or unavailable citation before adding another; your saved draft is unchanged.';
            return;
          }
          current.citations = retained;
          if (role.value) current.citations.push({ id: record.id, role: role.value,
            catalog_build_id: index.build_id });
          saveDraft(status);
          updateSummary();
        });
        row.append(inspect, role);
        details.append(row);
      }
      const unresolved = note.citations.filter(citation => citation.catalog_build_id !== index.build_id
        || !records.some(record => record.id === citation.id));
      if (unresolved.length) {
        const stale = node('section', '', 'decision-stale-citations');
        stale.append(node('p', 'these saved citations belong to another catalog build or are unavailable here. '
          + 'the export preserves their IDs as unresolved. remove a reference only when you no longer need it.', 'caveat'));
        const rows = node('div');
        for (const citation of unresolved) {
          const row = node('div', '', 'decision-stale-citation');
          const remove = node('button', `remove unavailable citation ${citation.id}`, 'text-button');
          remove.type = 'button';
          remove.addEventListener('click', () => {
            const current = editableNote(company.slug);
            current.citations = current.citations.filter(item =>
              item.id !== citation.id || item.catalog_build_id !== citation.catalog_build_id);
            row.remove();
            if (!rows.children.length) stale.remove();
            saveDraft(status);
            updateSummary();
          });
          row.append(node('p', `${citation.id} · ${citation.role} · build ${citation.catalog_build_id.slice(0, 12)}`, 'caption'), remove);
          rows.append(row);
        }
        stale.append(rows);
        details.append(stale);
      }
      if (!offered.length) details.append(node('p', 'no retained record is available for this company.', 'muted'));
      return details;
    }

    function render(companies) {
      const section = node('section', '', 'decision-brief');
      section.setAttribute('aria-labelledby', 'decision-brief-title');
      const status = node('p', storageMessage, 'decision-storage caption');
      visibleStatus = status;
      status.setAttribute('role', 'status');
      const download = node('button', 'download decision brief · JSON', 'quiet-button');
      download.type = 'button';
      const updateDownload = () => { download.disabled = !companies.length || !draft.question.trim(); };
      updateDownload();
      section.append(node('p', 'your research decision', 'eyebrow'),
        Object.assign(node('h3', 'what deserves your next hour?'), { id: 'decision-brief-title' }),
        node('p', 'start with your investment question. compare retained observations, '
          + 'record your own judgment, and name the evidence you need next. no score or recommendation is generated.', 'view-note'),
        textField('your investor question', 'decision-question', draft.question, value => {
          draft.question = value; saveDraft(status); updateDownload();
        }),
        textField('your scope and constraints · market, stage, geography, horizon', 'decision-scope', draft.scope,
          value => { draft.scope = value; saveDraft(status); }),
        node('p', 'scope is your research note; it does not filter or verify company eligibility. '
          + `this comparison uses ${companies.length} user-pinned companies from ${index.companies.length} selected pilot companies.`, 'caveat'));
      section.append(node('p', 'company notes persist when you change the question, scope or reporting year. '
        + 'review earlier reasoning and citations before applying them to a new decision.', 'caption'));
      const cards = node('div', '', 'decision-company-grid');
      for (const company of companies) {
        const note = model.decisionNote(draft, company.slug);
        const card = node('article', '', 'decision-company');
        card.append(node('p', 'your interpretation', 'eyebrow'), node('h4', company.name));
        const disposition = node('label', '', 'decision-field');
        const select = node('select');
        select.setAttribute('aria-label', `${company.name}: your next decision`);
        model.DECISION_STATUSES.forEach(value => select.add(new Option(STATUS_LABELS[value], value)));
        select.value = note.status;
        select.addEventListener('change', () => {
          editableNote(company.slug).status = select.value; saveDraft(status);
        });
        disposition.append(node('span', 'your next decision'), select);
        card.append(disposition);
        for (const field of model.DECISION_NOTE_FIELDS) {
          card.append(textField(NOTE_LABELS[field], `decision-${company.slug}-${field}`, note[field], value => {
            editableNote(company.slug)[field] = value; saveDraft(status);
          }));
        }
        card.append(evidenceChoices(company, status));
        cards.append(card);
      }
      if (companies.length) section.append(cards);
      else section.append(node('p', 'choose companies below to write a source-linked research brief. '
        + 'your question can be saved before you pin anything.', 'muted'));
      download.addEventListener('click', () => {
        try {
          const exported = model.exportDecisionBrief(draft, companies.map(company => company.slug),
            index, pilot, state.year, new Date().toISOString(),
            new URL('./index.html', globalScope.location.href).href);
          const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = node('a');
          anchor.href = url;
          anchor.download = 'log-pose-decision-brief.json';
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = 'download requested. the file includes your notes and cited record references; '
            + 'check it before sharing. it is not a historical replay or investment recommendation.';
        } catch {
          status.textContent = 'the brief could not be downloaded. your notes remain here; try again before leaving.';
        }
      });
      section.append(append(node('div', '', 'decision-actions'), download,
        node('p', 'add an investor question and at least one company to export.', 'caption')), status);
      return section;
    }
    return { render };
  }
  globalScope.LogPoseDecisionBrief = { create };
}(globalThis));
