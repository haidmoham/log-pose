(function startExperimentalStudy() {
  'use strict';
  const model = window.LogPoseStudyModel;
  const root = document.querySelector('#view');
  const state = model.parseUrlState(location.search);

  function writeUrl(replace = false) {
    const query = model.toUrlParams(state);
    const url = location.pathname + (query ? `?${query}` : '');
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
  }

  function commitState(changes, { replace = false, focus } = {}) {
    const active = document.activeElement;
    const selection = active?.tagName === 'INPUT' ? active.selectionStart : null;
    Object.assign(state, changes);
    writeUrl(replace);
    view.render();
    if (focus) {
      const target = root.querySelector(focus);
      target?.focus({ preventScroll: true });
      if (selection !== null && target?.setSelectionRange) target.setSelectionRange(selection, selection);
    }
  }

  const view = window.LogPoseResearchSetView.create({ root, state, commitState, writeUrl });
  window.addEventListener('popstate', () => {
    Object.assign(state, model.parseUrlState(location.search));
    view.render();
  });
  writeUrl(true);
  view.render();
}());
