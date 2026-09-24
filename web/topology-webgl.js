(function exposeTopologyWebGL(globalScope) {
  'use strict';

  const COLORS = {
    competition: [0.894, 0.722, 0.424],
    collaboration: [0.804, 0.651, 0.929],
    investment: [0.89, 0.663, 0.545],
    performance_exposure: [0.608, 0.82, 0.82]
  };

  function create({ claims, visibleClaims, model, companyName, selectedClaim, onCompany, view }) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!gl) return null;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, `
      attribute vec2 position;
      attribute vec3 color;
      attribute float pointSize;
      varying vec3 tint;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        gl_PointSize = pointSize;
        tint = color;
      }
    `);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, `
      precision mediump float;
      varying vec3 tint;
      void main() { gl_FragColor = vec4(tint, 0.88); }
    `);
    gl.compileShader(fragmentShader);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    const frame = document.createElement('div');
    frame.className = 'topology-webgl-frame';
    canvas.className = 'topology-webgl-canvas';
    canvas.width = 1000;
    canvas.height = 700;
    canvas.setAttribute('aria-hidden', 'true');
    const labels = document.createElement('div');
    labels.className = 'topology-webgl-labels';
    frame.append(canvas, labels);

    const controls = document.createElement('div');
    controls.className = 'topology-webgl-controls';
    const values = view;
    const inputs = {};
    const outputs = {};
    const settings = [
      ['yaw', 'rotate', -180, 180, 1, '°'],
      ['tilt', 'tilt', -70, 70, 1, '°'],
      ['zoom', 'zoom', 1.6, 3.2, 0.1, '×']
    ];
    for (const [key, label, minimum, maximum, step, unit] of settings) {
      const wrapper = document.createElement('label');
      wrapper.className = 'topology-webgl-control';
      const name = document.createElement('span');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(minimum);
      input.max = String(maximum);
      input.step = String(step);
      input.value = String(values[key]);
      input.setAttribute('aria-label', `${label} graph in ${unit === '°' ? 'degrees' : 'times'}`);
      const output = document.createElement('input');
      output.type = 'number';
      output.min = String(minimum);
      output.max = String(maximum);
      output.step = String(step);
      output.value = String(values[key]);
      output.setAttribute('aria-label', `${label} exact value in ${unit === '°' ? 'degrees' : 'times'}`);
      input.addEventListener('input', () => {
        values[key] = Number(input.value);
        draw();
      });
      output.addEventListener('change', () => {
        const requested = Number(output.value);
        values[key] = Number.isFinite(requested)
          ? Math.max(minimum, Math.min(maximum, requested)) : values[key];
        input.value = String(values[key]);
        draw();
      });
      wrapper.append(name, input, output);
      controls.append(wrapper);
      inputs[key] = input;
      outputs[key] = output;
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'quiet-button';
    reset.textContent = 'reset view';
    reset.addEventListener('click', () => {
      Object.assign(values, { yaw: 22, tilt: -14, zoom: 2.4 });
      for (const key of Object.keys(inputs)) inputs[key].value = String(values[key]);
      draw();
    });
    controls.append(reset);

    const positions = model.topologyPositions3d(claims);
    const visibleIds = new Set(visibleClaims.map(claim => claim.id));
    const activeSlugs = new Set(visibleClaims.flatMap(claim =>
      [claim.subject_slug, claim.object_slug]));
    const buffer = gl.createBuffer();
    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [attribute, width, offset] of [['position', 2, 0], ['color', 3, 2],
      ['pointSize', 1, 5]]) {
      const location = gl.getAttribLocation(program, attribute);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, width, gl.FLOAT, false, stride,
        offset * Float32Array.BYTES_PER_ELEMENT);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    function projected(slug) {
      const point = model.projectTopologyPoint(positions.get(slug),
        values.yaw, values.tilt, values.zoom);
      return { x: point.x * 0.72, y: point.y * 0.92, depth: point.depth };
    }

    function drawGeometry(vertices, primitive) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      gl.drawArrays(primitive, 0, vertices.length / 6);
    }

    function draw() {
      for (const key of Object.keys(outputs)) outputs[key].value = String(Number(values[key].toFixed(1)));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const edges = [];
      for (const group of model.topologyPairGroups(claims)) {
        group.claims.forEach((claim, index) => {
          if (!visibleIds.has(claim.id)) return;
          const first = projected(claim.direction === 'object_to_subject'
            ? claim.object_slug : claim.subject_slug);
          const second = projected(claim.direction === 'object_to_subject'
            ? claim.subject_slug : claim.object_slug);
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const length = Math.hypot(dx, dy) || 1;
          const offset = (index - (group.claims.length - 1) / 2) * 0.055;
          const middle = { x: (first.x + second.x) / 2 - dy / length * offset,
            y: (first.y + second.y) / 2 + dx / length * offset };
          const color = COLORS[model.topologyCategory(claim.predicate)] || [0.7, 0.7, 0.7];
          const light = claim.id === selectedClaim ? 1 : 0.76;
          for (const point of [first, middle, middle, second]) edges.push(point.x, point.y,
            ...color.map(channel => channel * light), 1);
          if (claim.direction !== 'symmetric') {
            const tailLength = Math.hypot(second.x - middle.x, second.y - middle.y) || 1;
            const forwardX = (second.x - middle.x) / tailLength;
            const forwardY = (second.y - middle.y) / tailLength;
            const tip = { x: second.x - forwardX * 0.045,
              y: second.y - forwardY * 0.045 };
            const base = { x: tip.x - forwardX * 0.065,
              y: tip.y - forwardY * 0.065 };
            for (const side of [-1, 1]) {
              const wing = { x: base.x - forwardY * side * 0.035,
                y: base.y + forwardX * side * 0.035 };
              for (const point of [wing, tip]) edges.push(point.x, point.y,
                ...color.map(channel => channel * light), 1);
            }
          }
        });
      }
      drawGeometry(edges, gl.LINES);
      const nodes = [];
      const ordered = [...positions].map(([slug]) => ({ slug, ...projected(slug) }))
        .sort((left, right) => left.depth - right.depth);
      labels.replaceChildren();
      for (const point of ordered) {
        const active = activeSlugs.has(point.slug);
        const depthScale = Math.max(0, Math.min(1, (point.depth + 1) / 2));
        const color = active ? [0.95, 0.9, 0.94] : [0.45, 0.39, 0.46];
        nodes.push(point.x, point.y, ...color, active ? 11 + depthScale * 7 : 8);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `topology-webgl-node${active ? '' : ' is-muted'}`;
        button.textContent = companyName(point.slug);
        button.style.left = `${(point.x + 1) * 50}%`;
        button.style.top = `${(1 - point.y) * 50}%`;
        button.style.zIndex = String(Math.round((point.depth + 2) * 10));
        button.style.transform = `translate(-50%, -50%) scale(${(0.84 + depthScale * 0.32).toFixed(2)})`;
        button.setAttribute('aria-label', `focus ${companyName(point.slug)} relationships`);
        button.addEventListener('click', () => onCompany(point.slug));
        labels.append(button);
      }
      drawGeometry(nodes, gl.POINTS);
    }

    let drag = null;
    frame.addEventListener('pointerdown', event => {
      if (event.target !== canvas) return;
      drag = { x: event.clientX, y: event.clientY, yaw: values.yaw, tilt: values.tilt };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      values.yaw = Math.max(-180, Math.min(180, drag.yaw + (event.clientX - drag.x) * 0.35));
      values.tilt = Math.max(-70, Math.min(70, drag.tilt - (event.clientY - drag.y) * 0.35));
      inputs.yaw.value = String(values.yaw);
      inputs.tilt.value = String(values.tilt);
      draw();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    draw();
    const container = document.createElement('div');
    container.append(frame, controls);
    container.dispose = () => {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    return container;
  }

  globalScope.LogPoseTopologyWebGL = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
