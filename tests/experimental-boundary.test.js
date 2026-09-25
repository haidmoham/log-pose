const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const model = require('../web/research-model.js');
const marketFieldApi = require('../api/market-field.js');
const web = path.resolve(__dirname, '../web');

test('normal console works without requesting experimental assets', async () => {
  const requests = [];
  const errors = [];
  class LocalResources extends ResourceLoader {
    fetch(url) {
      if (!url.startsWith('https://logpose.test/')) return null;
      const pathname = new URL(url).pathname;
      requests.push(pathname);
      if (pathname.includes('experimental') || pathname.includes('research-set')) {
        throw new Error('normal console requested an experimental asset');
      }
      return fs.readFile(path.join(web, pathname));
    }
  }
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(await fs.readFile(path.join(web, 'index.html'), 'utf8'), {
    url: 'https://logpose.test/', runScripts: 'dangerously', resources: new LocalResources(),
    virtualConsole,
    beforeParse(window) {
      window.fetch = async url => {
        const parsed = new URL(url, window.location.href);
        const pathname = parsed.pathname;
        requests.push(pathname);
        if (pathname.includes('experimental') || pathname.includes('research-set')) {
          throw new Error('normal console requested experimental data');
        }
        if (pathname === '/api/market-field') {
          const result = marketFieldApi.handleMarketField(parsed.searchParams);
          return { ok: result.status < 400, status: result.status, json: async () => result.body };
        }
        return { ok: true, json: async () => JSON.parse(await fs.readFile(path.join(web, pathname), 'utf8')) };
      };
    }
  });
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (dom.window.document.querySelector('.constellation-map')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const document = dom.window.document;
    assert.equal(document.querySelector('#view').getAttribute('aria-busy'), 'false');
    assert.deepEqual(errors, []);
    assert.ok(document.querySelector('[href="./experimental/index.html"]'));
    assert.equal(document.querySelector('[data-view="research-set"]'), null);
    assert.equal(dom.window.LogPoseResearchSetView, undefined);
    assert.ok(requests.every(item => !/experimental|research-set/.test(item)));
    assert.ok(document.querySelector('.constellation-map'));
    assert.equal(document.body.dataset.layer, 'temporal');
  } finally {
    dom.window.close();
  }
});

test('legacy study links preserve study filters when leaving the normal console', () => {
  assert.equal(model.legacyResearchSetTarget('?view=data'), null);
  assert.equal(model.legacyResearchSetTarget('?view=research-set&member=weights-and-biases&role=platform&disposition=unresolved&researchQuery=paid&company=other'),
    './experimental/mlops-2024/index.html?member=weights-and-biases&role=platform&disposition=unresolved&researchQuery=paid');
  assert.equal(model.parseUrlState('?view=research-set', new Set(), [2024]).view, 'data');
});
