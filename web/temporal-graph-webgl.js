/* GPU geometry under the accessible SVG interaction/label surface. */
(function (root) {
  'use strict';
  let renderer = null;
  function create() {
    if (!root.WebGLRenderingContext) return null;
    const canvas = document.createElement('canvas');
    canvas.className = 'constellation-gpu';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return null;
    function shader(type, code) {
      const result = gl.createShader(type); gl.shaderSource(result, code); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('graph shader compilation failed'); }
      return result;
    }
    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec2 position;
      attribute vec4 color;
      attribute float size;
      uniform vec2 viewport;
      uniform vec3 camera;
      uniform float pixelRatio;
      varying vec4 tint;
      void main() {
        float scale = min(viewport.x / 1000.0, viewport.y / 680.0);
        vec2 map = (position - vec2(500.0, 340.0)) * camera.z + vec2(500.0, 340.0) + camera.xy;
        vec2 pixel = (map - vec2(500.0, 340.0)) * scale + viewport * 0.5;
        gl_Position = vec4(pixel.x / viewport.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.y * 2.0, 0.0, 1.0);
        gl_PointSize = size * scale * camera.z * pixelRatio;
        tint = color;
      }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform bool points;
      varying vec4 tint;
      void main() {
        float alpha = tint.a;
        if (points) {
          float distance = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float core = 1.0 - smoothstep(0.27, 0.38, distance);
          float aura = exp(-distance * distance * 5.0) * 0.17;
          alpha *= min(1.0, core + aura) * (1.0 - smoothstep(0.8, 1.0, distance));
        }
        gl_FragColor = vec4(tint.rgb, alpha);
      }
    `);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const buffer = gl.createBuffer();
    const locations = { viewport: gl.getUniformLocation(program, 'viewport'), camera: gl.getUniformLocation(program, 'camera'),
      pixelRatio: gl.getUniformLocation(program, 'pixelRatio'), points: gl.getUniformLocation(program, 'points') };
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, count, offset] of [['position', 2, 0], ['color', 4, 2], ['size', 1, 6]]) {
      const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, count, gl.FLOAT, false, 28, offset * 4);
    }
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let scene = null;
    let map = null;
    let current = null;
    const observer = new ResizeObserver(() => draw());
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); scene?.classList.remove('has-webgl'); current = null; });
    canvas.addEventListener('webglcontextrestored', () => { renderer = null; scene?.classList.remove('has-webgl'); });
    function geometry(vertices, points) {
      gl.uniform1i(locations.points, points ? 1 : 0);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      gl.drawArrays(points ? gl.POINTS : gl.LINES, 0, vertices.length / 7);
    }
    function draw() {
      if (!current || !map?.isConnected || gl.isContextLost()) return;
      const rect = map.getBoundingClientRect();
      const ratio = Math.min(root.devicePixelRatio || 1, 2);
      canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
      const width = Math.round(rect.width * ratio); const height = Math.round(rect.height * ratio);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(locations.viewport, rect.width, rect.height);
      gl.uniform3f(locations.camera, current.camera.x, current.camera.y, current.camera.zoom);
      gl.uniform1f(locations.pixelRatio, ratio);
      const { frame, positions, selected, hover, threads } = current;
      const lines = [];
      const addLine = (left, right, tint) => {
        const a = positions.get(left); const b = positions.get(right);
        if (!a || !b) return;
        for (const point of [a, b]) lines.push(point.x, point.y, ...tint, 1);
      };
      for (const edge of frame.context_edges || []) {
        const active = edge.left === hover || edge.right === hover;
        addLine(edge.left, edge.right, active ? [.79, .68, .9, .6] : [.71, .63, .8, .055 + threads / 100 * .065]);
      }
      for (const edge of frame.edges) {
        const active = edge.candidate_id === selected || edge.candidate_id === hover;
        addLine(frame.focus, edge.candidate_id, active ? [.96, .82, .57, .95] : [.77, .66, .85, .08 + threads / 100 * .3]);
      }
      geometry(lines, false);
      const vertices = [];
      const observed = new Set(frame.edges.map(edge => edge.candidate_id));
      for (const node of frame.nodes) {
        const focus = node.id === frame.focus;
        const absent = frame.focus && (focus ? !frame.focus_present : !observed.has(node.id));
        // Hollow comparison markers are retained in SVG; they must never become luminous observed points.
        if (absent) continue;
        const point = positions.get(node.id);
        const active = focus || node.id === selected || node.id === hover;
        const color = active ? [1, .86, .63, 1] : [.77, .71, .86, .92];
        vertices.push(point.x, point.y, ...color, focus ? 34 : frame.focus ? 24 : 15);
      }
      geometry(vertices, true);
      scene.classList.add('has-webgl');
      scene.dataset.renderer = 'webgl';
    }
    return { attach(nextScene, nextMap) {
      scene?.classList.remove('has-webgl'); observer.disconnect();
      scene = nextScene; map = nextMap;
      scene.insertBefore(canvas, map); observer.observe(map);
    }, update(value) { current = value; draw(); } };
  }
  root.LogPoseTemporalGPU = { attach(scene, map) {
    try { if (!renderer) renderer = create(); }
    catch { return null; }
    if (!renderer) return null;
    renderer.attach(scene, map); return renderer;
  } };
})(typeof window === 'undefined' ? globalThis : window);
