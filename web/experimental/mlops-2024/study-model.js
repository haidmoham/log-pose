(function exposeStudyModel(globalScope) {
  'use strict';

  function parseUrlState(search) {
    const params = new URLSearchParams(search);
    const value = (name, limit = 120) => {
      const text = params.get(name) || '';
      return /[\x00-\x1f]/.test(text) ? '' : text.slice(0, limit);
    };
    const member = value('member');
    return {
      view: 'research-set',
      researchMember: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(member) ? member : null,
      researchRole: value('role') || 'all',
      researchDisposition: value('disposition') || 'all',
      researchQuery: value('researchQuery', 200)
    };
  }

  function toUrlParams(state) {
    const params = new URLSearchParams();
    if (state.researchMember) params.set('member', state.researchMember);
    if (state.researchRole !== 'all') params.set('role', state.researchRole);
    if (state.researchDisposition !== 'all') params.set('disposition', state.researchDisposition);
    if (state.researchQuery) params.set('researchQuery', state.researchQuery.slice(0, 200));
    return params.toString();
  }

  const model = { parseUrlState, toUrlParams };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  globalScope.LogPoseStudyModel = model;
}(typeof globalThis !== 'undefined' ? globalThis : this));
