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
      uniform float breath;
      varying vec4 tint;
      void main() {
        float scale = min(viewport.x / 1000.0, viewport.y / 680.0);
        vec2 map = (position - vec2(500.0, 340.0)) * camera.z + vec2(500.0, 340.0) + camera.xy;
        vec2 pixel = (map - vec2(500.0, 340.0)) * scale + viewport * 0.5;
        gl_Position = vec4(pixel.x / viewport.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.y * 2.0, 0.0, 1.0);
        gl_PointSize = size * scale * pixelRatio;
        tint = color;
      }`);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform bool points;
      uniform float breath;
      varying vec4 tint;
      void main() {
        float alpha = tint.a;
        if (points) {
          float distance = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float core = 1.0 - smoothstep(0.16, 0.23, distance);
          float inner = exp(-distance * distance * 7.5) * (0.24 + breath * 0.035);
          float outer = exp(-distance * distance * 2.1) * (0.075 + breath * 0.025);
          alpha *= min(1.0, core + inner + outer) * (1.0 - smoothstep(0.88, 1.0, distance));
        }
        gl_FragColor = vec4(tint.rgb, alpha);
      }`);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const locations = { viewport: gl.getUniformLocation(program, 'viewport'), camera: gl.getUniformLocation(program, 'camera'),
      pixelRatio: gl.getUniformLocation(program, 'pixelRatio'), points: gl.getUniformLocation(program, 'points'), breath: gl.getUniformLocation(program, 'breath') };
    const attributes = ['position', 'color', 'size'].map(name => gl.getAttribLocation(program, name));
    const lineBuffer = gl.createBuffer();
    const pointBuffer = gl.createBuffer();
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let scene = null;
    let map = null;
    let current = null;
    let lineCount = 0;
    let pointCount = 0;
    let animationFrame = null;
    let visible = true;
    const observer = root.ResizeObserver ? new root.ResizeObserver(() => draw()) : null;
    const intersection = root.IntersectionObserver ? new root.IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting !== false;
      updateAnimation();
      if (visible) draw();
    }) : null;
    function bind(buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [index, count, offset] of [[0, 2, 0], [1, 4, 2], [2, 1, 6]]) {
        gl.enableVertexAttribArray(attributes[index]);
        gl.vertexAttribPointer(attributes[index], count, gl.FLOAT, false, 28, offset * 4);
      }
    }
    function upload(buffer, values) {
      bind(buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
      return values.length / 7;
    }
    function appendLine(vertices, positions, left, right, tint) {
      const a = positions.get(left);
      const b = positions.get(right);
      if (!a || !b) return;
      for (const point of [a, b]) vertices.push(point.x, point.y, ...tint, 1);
    }
    function rebuild() {
      if (!current) return;
      const { frame, positions, selected, hover, threads, context, tints } = current;
      const tintFor = id => (tints?.get(id)?.rgb || [127, 158, 184]).map(channel => channel / 255);
      const nearby = new Set();
      if (hover) {
        nearby.add(hover);
        if (frame.focus && (hover === frame.focus || frame.edges.some(edge => edge.candidate_id === hover))) nearby.add(frame.focus);
        for (const edge of context ? frame.context_edges || [] : []) {
          if (edge.left === hover) nearby.add(edge.right);
          if (edge.right === hover) nearby.add(edge.left);
        }
      }
      const lines = [];
      for (const edge of context ? frame.context_edges || [] : []) {
        const active = edge.left === hover || edge.right === hover;
        const tint = tintFor(edge.left);
        appendLine(lines, positions, edge.left, edge.right, active ? [.96, .75, .45, .74] : [...tint, .04 + threads / 100 * .06]);
      }
      for (const edge of frame.edges) {
        const active = edge.candidate_id === selected || edge.candidate_id === hover;
        const tint = tintFor(edge.candidate_id);
        appendLine(lines, positions, frame.focus, edge.candidate_id, active ? [1, .79, .43, .96] : [...tint, .08 + threads / 100 * .3]);
      }
      lineCount = upload(lineBuffer, lines);
      const points = [];
      const observed = new Set(frame.edges.map(edge => edge.candidate_id));
      for (const node of frame.nodes) {
        const focus = node.id === frame.focus;
        const absent = frame.focus && (focus ? !frame.focus_present : !observed.has(node.id));
        // Hollow comparison markers remain in SVG and never become luminous observed points.
        if (absent) continue;
        const point = positions.get(node.id);
        if (!point) continue;
        const active = focus || node.id === selected || node.id === hover;
        const local = nearby.has(node.id);
        const tint = tintFor(node.id);
        const color = active ? [1, .82, .49, 1] : local ? [.98, .71, .43, .98] : [...tint, .94];
        points.push(point.x, point.y, ...color, active ? (focus ? 52 : 42) : local ? 31 : frame.focus ? 27 : 19);
      }
      pointCount = upload(pointBuffer, points);
    }
    function canAnimate() {
      return Boolean(current?.motion && map?.isConnected && visible && !document.hidden && !gl.isContextLost());
    }
    function updateAnimation() {
      if (canAnimate() && animationFrame === null) animationFrame = root.requestAnimationFrame(animate);
      if (!canAnimate() && animationFrame !== null) { root.cancelAnimationFrame(animationFrame); animationFrame = null; }
    }
    function animate(time) {
      animationFrame = null;
      draw(time);
      updateAnimation();
    }
    function draw(time = 0) {
      if (!current || !map?.isConnected || !visible || gl.isContextLost()) return;
      const rect = map.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const ratio = Math.min(root.devicePixelRatio || 1, 2); canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
      const width = Math.round(rect.width * ratio); const height = Math.round(rect.height * ratio);
      if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(locations.viewport, rect.width, rect.height); gl.uniform3f(locations.camera, current.camera.x, current.camera.y, current.camera.zoom);
      gl.uniform1f(locations.pixelRatio, ratio);
      gl.uniform1f(locations.breath, !current.motion ? 0 : (Math.sin(time / 2100) + 1) / 2);
      gl.uniform1i(locations.points, 0); bind(lineBuffer); gl.drawArrays(gl.LINES, 0, lineCount);
      gl.uniform1i(locations.points, 1); bind(pointBuffer); gl.drawArrays(gl.POINTS, 0, pointCount);
      scene.classList.add('has-webgl'); scene.dataset.renderer = 'webgl';
    }
    function handleVisibility() { updateAnimation(); if (!document.hidden) draw(); }
    document.addEventListener('visibilitychange', handleVisibility);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); scene?.classList.remove('has-webgl'); current = null; updateAnimation(); });
    function dispose() {
      current = null;
      updateAnimation();
      observer?.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    canvas.addEventListener('webglcontextrestored', () => {
      dispose();
      renderer = null;
      scene?.classList.remove('has-webgl');
    });
    return {
      attach(nextScene, nextMap) {
        scene?.classList.remove('has-webgl'); observer?.disconnect(); intersection?.disconnect();
        scene = nextScene; map = nextMap; visible = true; scene.insertBefore(canvas, map);
        observer?.observe(map); intersection?.observe(map); updateAnimation();
      },
      update(value) { current = value; rebuild(); draw(); updateAnimation(); }
    };
  }
  root.LogPoseTemporalGPU = { attach(scene, map) {
    try { if (!renderer) renderer = create(); } catch { return null; }
    if (!renderer) return null; renderer.attach(scene, map); return renderer;
  } };
})(typeof window === 'undefined' ? globalThis : window);
