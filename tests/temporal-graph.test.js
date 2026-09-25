const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../web/temporal-graph.js'), 'utf8');
function setup() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(source);
  return dom;
}
const nodes = [{ id: 'one', name: 'one' }, { id: 'two', name: 'two' }, { id: 'three', name: 'three' }];
const frame = { nodes, focus: 'one', focus_present: true,
  edges: [{ candidate_id: 'two', status: 'previously_observed' }], changes: [], context_edges: [] };
test('adjacent frames keep node addresses and camera while absence is visibly distinct', () => {
  const dom = setup(); const api = dom.window.LogPoseTemporalGraph;
  const first = api.render(frame); dom.window.document.body.append(first);
  first.querySelector('[aria-label="zoom in graph"]').click();
  const second = api.render({ ...frame, edges: [{ candidate_id: 'three' }] });
  for (const node of nodes) assert.equal(first.querySelector(`[data-candidate="${node.id}"]`).getAttribute('transform'),
    second.querySelector(`[data-candidate="${node.id}"]`).getAttribute('transform'));
  assert.equal(first.querySelector('.constellation-camera').getAttribute('transform'),
    second.querySelector('.constellation-camera').getAttribute('transform'));
  assert(second.querySelector('[data-candidate="two"]').classList.contains('is-absent'));
  assert(!second.querySelector('[data-candidate="three"]').classList.contains('is-absent'));
  dom.window.close();
});
test('keyboard inspection and overview navigation dispatch distinct actions', () => {
  const dom = setup(); const api = dom.window.LogPoseTemporalGraph; let selected;
  const local = api.render(frame, { onSelectEdge: id => { selected = id; } });
  local.querySelector('[data-candidate="two"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(selected, 'two');
  const overview = api.render({ ...frame, focus: null, edges: [] }, { onSelectCandidate: id => { selected = id; } });
  overview.querySelector('[data-candidate="three"]').dispatchEvent(new dom.window.MouseEvent('click'));
  assert.equal(selected, 'three');
  assert.equal(overview.querySelectorAll('.is-absent').length, 0);
  dom.window.close();
});

test('ordinary scrolling reaches the page while modified scrolling zooms the graph', () => {
  const dom = setup();
  const scene = dom.window.LogPoseTemporalGraph.render(frame);
  dom.window.document.body.append(scene);
  const map = scene.querySelector('.constellation-map');
  const camera = scene.querySelector('.constellation-camera');
  const before = camera.getAttribute('transform');
  const ordinary = new dom.window.WheelEvent('wheel', { deltaY: 100, cancelable: true });
  map.dispatchEvent(ordinary);
  assert.equal(ordinary.defaultPrevented, false);
  assert.equal(camera.getAttribute('transform'), before);
  const zoom = new dom.window.WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true });
  map.dispatchEvent(zoom);
  assert.equal(zoom.defaultPrevented, true);
  assert.notEqual(camera.getAttribute('transform'), before);
  dom.window.close();
});
