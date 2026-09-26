const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../web/temporal-graph-webgl.js'), 'utf8');

test('gpu breathing stops after its map disconnects', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  const frames = new Map(); let nextFrame = 1;
  window.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} disconnect() {} };
  window.WebGLRenderingContext = function WebGLRenderingContext() {};
  Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
  const gl = fakeGL();
  window.HTMLCanvasElement.prototype.getContext = () => gl;
  window.eval(source);
  const scene = window.document.createElement('section');
  const map = window.document.createElement('svg');
  map.getBoundingClientRect = () => ({ width: 1000, height: 680 });
  scene.append(map); window.document.body.append(scene);
  const renderer = window.LogPoseTemporalGPU.attach(scene, map);
  renderer.update({ frame: { nodes: [{ id: 'one' }], focus: null, edges: [], context_edges: [] },
    positions: new Map([['one', { x: 500, y: 340 }]]), camera: { x: 0, y: 0, zoom: 1 }, selected: '', hover: '', threads: 45, motion: true });
  assert.equal(frames.size, 1);
  renderer.setActive(false);
  assert.equal(frames.size, 0);
  renderer.setActive(true);
  assert.equal(frames.size, 1);
  scene.remove();
  const callback = frames.values().next().value; frames.clear(); callback(1000);
  assert.equal(frames.size, 0);
  dom.window.close();
});

function fakeGL() {
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, DYNAMIC_DRAW: 6, BLEND: 7, SRC_ALPHA: 8, ONE_MINUS_SRC_ALPHA: 9,
    ONE: 10, COLOR_BUFFER_BIT: 11, LINES: 12, POINTS: 13, FLOAT: 14 };
  for (const name of ['shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'linkProgram', 'deleteProgram',
    'useProgram', 'enable', 'blendFuncSeparate', 'bindBuffer', 'enableVertexAttribArray', 'vertexAttribPointer',
    'bufferData', 'viewport', 'clearColor', 'clear', 'uniform2f', 'uniform3f', 'uniform1f', 'uniform1i', 'drawArrays']) gl[name] = () => {};
  for (const name of ['createShader', 'createProgram', 'createBuffer', 'getUniformLocation']) gl[name] = () => ({});
  gl.getShaderParameter = () => true; gl.getProgramParameter = () => true; gl.getAttribLocation = () => 0;
  gl.isContextLost = () => false;
  return gl;
}
