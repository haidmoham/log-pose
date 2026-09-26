const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const modelSource = fs.readFileSync(require.resolve('../web/research-model.js'), 'utf8');
const source = fs.readFileSync(require.resolve('../web/temporal-graph.js'), 'utf8');
function setup(configure) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  configure?.(dom.window);
  dom.window.eval(modelSource);
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
  assert(!context.querySelector('line').classList.contains('is-nearby'));
  assert(!scene.querySelector('[data-candidate="three"]').classList.contains('is-nearby'));
  const contextControl = scene.querySelector('.constellation-context-control input');
  contextControl.checked = true;
  contextControl.dispatchEvent(new dom.window.Event('change'));
  scene.querySelector('[data-candidate="two"]').dispatchEvent(new dom.window.MouseEvent('pointerenter'));
  assert(context.querySelector('line').classList.contains('is-nearby'));
  assert(scene.querySelector('[data-candidate="three"]').classList.contains('is-nearby'));
  assert(scene.querySelector('[data-candidate="three"]').classList.contains('is-absent'));
  scene.querySelector('[data-candidate="two"]').dispatchEvent(new dom.window.MouseEvent('pointerleave'));
  assert(!context.classList.contains('has-active-neighborhood'));
  assert(!scene.querySelector('[data-candidate="three"]').classList.contains('is-nearby'));
  dom.window.close();
});

test('2d and 3d views retain independent cameras and mode across temporal renders', () => {
  const dom = setup(); const api = dom.window.LogPoseTemporalGraph;
  const selected = [];
  const first = api.render({ ...frame, build_id: 'spatial-mode' }, { onSelectEdge: id => selected.push(id) });
  dom.window.document.body.append(first);
  const initial2d = first.querySelector('.constellation-camera').getAttribute('transform');
  assert.equal(first.querySelector('[aria-label="2d graph"]').getAttribute('aria-pressed'), 'true');
  first.querySelector('[aria-label="3d graph"]').click();
  assert.equal(first.querySelector('[aria-label="3d graph"]').getAttribute('aria-pressed'), 'true');
  const initial3dNode = first.querySelector('[data-candidate="two"]').getAttribute('transform');
  first.querySelector('.constellation-map').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  assert.notEqual(first.querySelector('[data-candidate="two"]').getAttribute('transform'), initial3dNode);
  first.querySelector('[data-candidate="two"]').dispatchEvent(new dom.window.MouseEvent('click'));
  assert.deepEqual(selected, ['two']);
  const next = api.render({ ...frame, build_id: 'spatial-mode', year: 2025 }, { selectedEdge: 'two' });
  assert.equal(next.querySelector('[aria-label="3d graph"]').getAttribute('aria-pressed'), 'true');
  assert(next.querySelector('[data-candidate="two"]').classList.contains('is-selected'));
  next.querySelector('[aria-label="2d graph"]').click();
  assert.equal(next.querySelector('.constellation-camera').getAttribute('transform'), initial2d);
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

test('3d camera updates suspend the hidden gpu renderer without rebuilding it', () => {
  let updates = 0;
  const active = [];
  const dom = setup(window => {
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    window.LogPoseTemporalGPU = { attach: () => ({
      setActive(value) { active.push(value); },
      update() { updates += 1; }
    }) };
  });
  const scene = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'gpu-3d-suspend' });
  dom.window.document.body.append(scene);
  const before3d = updates;
  scene.querySelector('[aria-label="3d graph"]').click();
  assert(updates <= before3d + 1);
  const afterSwitch = updates;
  const map = scene.querySelector('.constellation-map');
  map.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  map.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  assert.equal(updates, afterSwitch);
  assert.equal(active.at(-1), false);
  scene.querySelector('[aria-label="2d graph"]').click();
  assert.equal(active.at(-1), true);
  assert(updates > afterSwitch);
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

test('focused fit increases fixed-anchor screen separation by forty percent', () => {
  const dom = setup();
  const points = [{ x: 120, y: 120 }, { x: 880, y: 560 }];
  const base = dom.window.LogPoseTemporalGraph.fittedCamera(points);
  const focused = dom.window.LogPoseTemporalGraph.fittedCamera(points, 1.4);
  const mapDistance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  assert.equal(focused.zoom / base.zoom, 1.4);
  assert.equal(mapDistance * focused.zoom / (mapDistance * base.zoom), 1.4);
  dom.window.close();
});

test('focused context connections are opt-in while overview context remains visible', () => {
  const dom = setup();
  const focused = dom.window.LogPoseTemporalGraph.render({ ...frame,
    context_edges: [{ left: 'two', right: 'three' }]
  });
  const control = focused.querySelector('.constellation-context-control input');
  assert.equal(control.checked, false);
  assert(focused.classList.contains('is-context-off'));
  assert.equal(focused.querySelectorAll('.constellation-thread').length, 1);
  control.checked = true;
  control.dispatchEvent(new dom.window.Event('change'));
  assert(!focused.classList.contains('is-context-off'));
  const overview = dom.window.LogPoseTemporalGraph.render({ ...frame, focus: null, edges: [],
    context_edges: [{ left: 'two', right: 'three' }]
  });
  assert(!overview.classList.contains('is-context-off'));
  assert.equal(overview.querySelector('.constellation-context-control'), null);
  dom.window.close();
});

test('3d drag owns node gestures only after threshold and suppresses the trailing click', () => {
  const frames = [];
  const dom = setup(window => {
    window.matchMedia = () => ({ matches: true });
    window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  });
  let selected = '';
  const scene = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'gesture-threshold' },
    { onSelectEdge: id => { selected = id; } });
  dom.window.document.body.append(scene);
  scene.querySelector('[aria-label="3d graph"]').click();
  const map = scene.querySelector('.constellation-map');
  map.getBoundingClientRect = () => ({ width: 800, height: 500 });
  const node = scene.querySelector('[data-candidate="two"]');
  node.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200 }));
  map.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 280, clientY: 230 }));
  map.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 280, clientY: 230 }));
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(selected, '');
  while (frames.length) frames.shift()(16.67);
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(selected, 'two');
  const afterOrbit = node.getAttribute('transform');
  map.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
  map.dispatchEvent(new dom.window.MouseEvent('pointercancel', { bubbles: true }));
  map.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 300 }));
  assert.equal(node.getAttribute('transform'), afterOrbit);
  dom.window.close();
});

test('3d orbit uses viewport-normalized pointer movement', () => {
  function projectedAfterDrag(height, delta) {
    const frames = [];
    const dom = setup(window => {
      window.matchMedia = () => ({ matches: true });
      window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
    });
    const scene = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: `normalized-${height}` });
    dom.window.document.body.append(scene); scene.querySelector('[aria-label="3d graph"]').click();
    const map = scene.querySelector('.constellation-map');
    map.getBoundingClientRect = () => ({ width: height * 1.5, height });
    map.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    map.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true,
      clientX: 100 + delta, clientY: 100 + delta / 2 }));
    while (frames.length) frames.shift()(16.67);
    const projected = scene.querySelector('[data-candidate="two"]').getAttribute('transform');
    dom.window.close();
    return projected;
  }
  assert.equal(projectedAfterDrag(400, 80), projectedAfterDrag(800, 160));
});

test('3d orbit defers context mesh writes and refreshes hidden context when enabled', () => {
  const dom = setup(window => {
    window.matchMedia = () => ({ matches: true });
    window.requestAnimationFrame = () => 1;
  });
  const scene = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'context-orbit-lod',
    context_edges: [{ left: 'two', right: 'three' }] });
  dom.window.document.body.append(scene);
  const line = scene.querySelector('.constellation-context line');
  const base2d = line.getAttribute('x1');
  scene.querySelector('[aria-label="3d graph"]').click();
  const map = scene.querySelector('.constellation-map');
  map.getBoundingClientRect = () => ({ width: 800, height: 500 });
  const initial = line.getAttribute('x1');
  map.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0,
    clientX: 100, clientY: 100 }));
  map.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true,
    clientX: 220, clientY: 160 }));
  assert(scene.classList.contains('is-orbiting'));
  assert.equal(line.getAttribute('x1'), initial);
  map.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true,
    clientX: 220, clientY: 160 }));
  assert(!scene.classList.contains('is-orbiting'));
  const context = scene.querySelector('.constellation-context-control input');
  context.checked = true;
  context.dispatchEvent(new dom.window.Event('change'));
  assert.notEqual(line.getAttribute('x1'), initial);
  context.checked = false;
  context.dispatchEvent(new dom.window.Event('change'));
  scene.querySelector('[aria-label="2d graph"]').click();
  context.checked = true;
  context.dispatchEvent(new dom.window.Event('change'));
  assert.equal(line.getAttribute('x1'), base2d);
  dom.window.close();
});

test('motion-on orbit restores the context mesh after damped settling', () => {
  const frames = [];
  const dom = setup(window => {
    window.matchMedia = () => ({ matches: false });
    window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  });
  const scene = dom.window.LogPoseTemporalGraph.render({ ...frame, build_id: 'context-orbit-settle',
    focus: null, edges: [], context_edges: [{ left: 'two', right: 'three' }] });
  dom.window.document.body.append(scene);
  scene.querySelector('[aria-label="3d graph"]').click();
  const map = scene.querySelector('.constellation-map');
  map.getBoundingClientRect = () => ({ width: 800, height: 500 });
  const line = scene.querySelector('.constellation-context line');
  const initial = line.getAttribute('x1');
  map.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0,
    clientX: 100, clientY: 100 }));
  map.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true,
    clientX: 220, clientY: 160 }));
  map.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true,
    clientX: 220, clientY: 160 }));
  assert(scene.classList.contains('is-orbiting'));
  for (let index = 0; frames.length && index < 100; index += 1) frames.shift()((index + 1) * 16.67);
  assert(!scene.classList.contains('is-orbiting'));
  assert.notEqual(line.getAttribute('x1'), initial);
  dom.window.close();
});

test('a second pointer cannot steal or end the active orbit gesture', () => {
  const frames = [];
  const dom = setup(window => {
    window.matchMedia = () => ({ matches: true });
    window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  });
  const scene = dom.window.LogPoseTemporalGraph.render(frame);
  dom.window.document.body.append(scene);
  scene.querySelector('[aria-label="3d graph"]').click();
  const map = scene.querySelector('.constellation-map');
  map.getBoundingClientRect = () => ({ width: 800, height: 500 });
  const point = scene.querySelector('[data-candidate="two"]');
  function pointer(type, id, x) {
    const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 200 });
    Object.defineProperty(event, 'pointerId', { value: id });
    map.dispatchEvent(event);
    while (frames.length) frames.shift()(16.67);
  }
  pointer('pointerdown', 1, 100);
  pointer('pointermove', 1, 200);
  const firstPosition = point.getAttribute('transform');
  pointer('pointerdown', 2, 300);
  pointer('pointerup', 2, 300);
  pointer('pointermove', 1, 250);
  assert.notEqual(point.getAttribute('transform'), firstPosition);
  pointer('lostpointercapture', 1, 250);
  const releasedPosition = point.getAttribute('transform');
  pointer('pointermove', 1, 350);
  assert.equal(point.getAttribute('transform'), releasedPosition);
  dom.window.close();
});
