const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const web = path.resolve(__dirname, '../web');
const evidence = {
  id: 'source-1', title: 'Dated product statement', publisher: 'Example publisher',
  url: 'https://example.test/source', publication_date: '2024-03-02',
  captured_at: '2024-03-03T00:00:00Z', artifact_sha256: 'a'.repeat(64),
  record_id: 'page:record-1', passage: 'The retained passage describes a dated product statement.',
  review_note: 'This passage supports only the statement that the publisher made this claim.'
};
const members = Array.from({ length: 8 }, (_, index) => ({
  id: `lead-${index + 1}`, name: `Lead ${index + 1}`,
  disposition: index === 0 ? 'include' : 'hold', disposition_reason: 'Bounded review note.',
  identity: { name: `Lead ${index + 1}`, status: index < 5 ? 'reviewed' : 'unreviewed', aliases: [] },
  gates: { product: { decision: 'pass', note: 'Dated evidence retained.', evidence_ids: index === 0 ? ['source-1'] : [] },
    private: { decision: 'unknown', note: 'Not established.', evidence_ids: [] },
    us_base: { decision: 'unknown', note: 'Not established.', evidence_ids: [] } },
  roles: [index === 0 ? 'observability' : 'platform'],
  comparison: { buyer: 'engineering teams', offering: 'monitoring', distribution: 'direct',
    financing: 'unknown', competitive_context: 'unknown', unknowns: ['adoption'] },
  claims: index === 0 ? [{ id: 'claim-1', statement: 'The company describes a monitoring product.',
    basis: 'Publisher statement.', evidence_ids: ['source-1'], counterevidence_ids: [], unknowns: ['adoption'] }] : []
}));
const researchSet = { schema_version: '1.0', id: 'mlops-2024', title: 'MLOps eight-lead study',
  as_of: '2024-12-31', members, evidence: [evidence] };

class LocalResources extends ResourceLoader {
  fetch(url) {
    if (!url.startsWith('https://logpose.test/')) return null;
    return fs.readFile(path.join(web, new URL(url).pathname));
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('research set route did not reach expected state');
}

async function page(route, failResearchOnce = false) {
  const errors = [];
  let researchFetches = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const html = await fs.readFile(path.join(web, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: `https://logpose.test/${route}`,
    runScripts: 'dangerously',
    resources: new LocalResources(),
    virtualConsole,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      window.fetch = async url => {
        const pathname = new URL(url, window.location.href).pathname;
        if (pathname === '/data/research-set-mlops-2024.json') {
          researchFetches += 1;
          if (failResearchOnce && researchFetches === 1) return { ok: false, status: 503 };
          return { ok: true, json: async () => researchSet };
        }
        try {
          const body = await fs.readFile(path.join(web, pathname), 'utf8');
          return { ok: true, json: async () => JSON.parse(body) };
        } catch {
          return { ok: false, status: 404 };
        }
      };
    }
  });
  await waitFor(() => dom.window.document.querySelector('#view')?.getAttribute('aria-busy') === 'false');
  assert.deepEqual(errors, []);
  return { dom, researchFetches: () => researchFetches };
}

test('saved research set loads lazily, filters all eight leads, and opens passage details with URL state', async () => {
  const { dom, researchFetches } = await page('?view=data');
  const { document, Event } = dom.window;
  assert.equal(researchFetches(), 0);
  document.querySelector('[data-view="research-set"]').click();
  await waitFor(() => document.querySelectorAll('.research-set-table tbody tr').length === 8);
  assert.equal(researchFetches(), 1);
  assert.match(document.querySelector('.research-set-identity-count').textContent, /5 \/ 8/);

  const role = document.querySelector('[aria-label="role"]');
  role.value = 'observability';
  role.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(document.querySelectorAll('.research-set-table tbody tr').length, 1);
  assert.equal(new URL(dom.window.location.href).searchParams.get('role'), 'observability');
  document.querySelector('.research-set-open').click();
  await waitFor(() => document.querySelector('.research-set-evidence blockquote'));
  assert.equal(new URL(dom.window.location.href).searchParams.get('member'), 'lead-1');
  assert.match(document.querySelector('.research-set-evidence blockquote').textContent,
    /retained passage describes a dated product statement/);
  assert.match(document.querySelector('.research-set-passages').textContent, /does not establish economic truth/);
  assert.equal(document.querySelector('.research-set-evidence a').getAttribute('href'), 'https://example.test/source');
  dom.window.close();
});

test('saved research set shows a retry after a lazy data load fails', async () => {
  const { dom, researchFetches } = await page('?view=research-set', true);
  const { document } = dom.window;
  await waitFor(() => document.querySelector('.research-set-error'));
  assert.match(document.querySelector('.research-set-error').textContent, /HTTP 503/);
  document.querySelector('.research-set-error button').click();
  await waitFor(() => document.querySelectorAll('.research-set-table tbody tr').length === 8);
  assert.equal(researchFetches(), 2);
  dom.window.close();
});
