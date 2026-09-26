const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../web/temporal-graph.js'), 'utf8');
function setup(configure) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  configure?.(dom.window);
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

test('hover reveals only the local context neighborhood while preserving absent markers', () => {
  const dom = setup();
  const localFrame = { ...frame,
    context_edges: [{ left: 'two', right: 'three' }]
  };
  const scene = dom.window.LogPoseTemporalGraph.render(localFrame);
  dom.window.document.body.append(scene);
  scene.querySelector('[data-candidate="two"]').dispatchEvent(new dom.window.MouseEvent('pointerenter'));
  const context = scene.querySelector('.constellation-context');
  assert(context.classList.contains('has-active-neighborhood'));
  assert(context.querySelector('line').classList.contains('is-nearby'));
  assert(scene.querySelector('[data-candidate="three"]').classList.contains('is-nearby'));
  assert(scene.querySelector('[data-candidate="three"]').classList.contains('is-absent'));
  scene.querySelector('[data-candidate="two"]').dispatchEvent(new dom.window.MouseEvent('pointerleave'));
  assert(!context.classList.contains('has-active-neighborhood'));
  assert(!scene.querySelector('[data-candidate="three"]').classList.contains('is-nearby'));
  dom.window.close();
});

test('population spring does not replay for a settled scope and only marks newly observed nodes', () => {
  const dom = setup(); const api = dom.window.LogPoseTemporalGraph;
  const initial = api.render({ ...frame, build_id: 'population-test' });
  assert(initial.querySelector('[data-candidate="one"] .constellation-visual').classList.contains('is-entering'));
  assert(initial.querySelector('[data-candidate="two"] .constellation-visual').classList.contains('is-entering'));
  assert(!initial.querySelector('[data-candidate="three"] .constellation-visual').classList.contains('is-entering'));
  const selectionOnly = api.render({ ...frame, build_id: 'population-test' }, { selectedEdge: 'two' });
  assert.equal(selectionOnly.querySelectorAll('.constellation-visual.is-entering').length, 0);
  const nextFrame = api.render({ ...frame, build_id: 'population-test', edges: [...frame.edges, { candidate_id: 'three' }] });
  assert.deepEqual([...nextFrame.querySelectorAll('.constellation-visual.is-entering')].map(node => node.closest('.constellation-node').dataset.candidate), ['three']);
  dom.window.close();
});

test('gpu waits for initial population to settle and does not attach to a discarded scene', () => {
  const timers = [];
  let attachments = 0;
  const dom = setup(window => {
    window.setTimeout = callback => { timers.push(callback); return timers.length; };
    window.LogPoseTemporalGPU = { attach: () => { attachments += 1; return { update() {} }; } };
    Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
  });
  const first = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'gpu-entry-one' });
  assert.equal(attachments, 0);
  dom.window.document.body.append(first);
  timers.shift()();
  assert.equal(attachments, 1);
  const discarded = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'gpu-entry-two' });
  timers.shift()();
  assert.equal(discarded.isConnected, false);
  assert.equal(attachments, 1);
  dom.window.close();
});

test('reduced motion is the initial setting and the explicit control can override it', () => {
  const dom = setup(window => { window.matchMedia = () => ({ matches: true }); });
  const scene = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'motion-preference' });
  const control = scene.querySelector('.constellation-motion-control input');
  assert.equal(control.checked, false);
  assert(scene.classList.contains('is-motion-off'));
  control.checked = true;
  control.dispatchEvent(new dom.window.Event('change'));
  assert(!scene.classList.contains('is-motion-off'));
  control.checked = false;
  control.dispatchEvent(new dom.window.Event('change'));
  assert(scene.classList.contains('is-motion-off'));
  dom.window.close();
});
