/* Display-only constellation. Evidence, eligibility and deltas come from the server. */
(function (root) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const camera2d = { x: 0, y: 0, zoom: 1 };
  const camera3d = { x: 0, y: 0, zoom: 1, yaw: -.52, pitch: -.28,
    targetYaw: -.52, targetPitch: -.28 };
  let camera = camera2d;
  let viewMode = '2d';
  let cameraScope = null;
  let camera3dScope = null;
  let populationScope = null;
  let populationPresent = new Set();
  const DETAIL_SCALE = 1.4;
  const appearance = { labels: 32, threads: 45, context: false,
    motion: !root.matchMedia?.('(prefers-reduced-motion: reduce)').matches };

  function hash(text) {
    let value = 2166136261;
    for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return value >>> 0;
  }

  // A fixed map address, not a distance, strength, chronology or confidence metric.
  function position(id) {
    const angle = hash(id + ':angle') / 4294967296 * Math.PI * 2;
    const radius = Math.sqrt(0.07 + 0.93 * hash(id + ':radius') / 4294967296);
    return { x: 500 + Math.cos(angle) * radius * 375,
      y: 340 + Math.sin(angle) * radius * 240 };
  }

  // Stable display depth. It is not chronology, strength, confidence or evidence.
  function spatialPosition(id, point = position(id)) {
    return root.LogPoseResearchModel.temporalSpatialPosition(id, point);
  }

  function project3d(point, orbit = camera3d) {
    return root.LogPoseResearchModel.projectTemporalPoint(point, orbit.yaw, orbit.pitch);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
    return node;
  }

  function fittedCamera(points, detailScale = 1) {
    const left = Math.min(...points.map(point => point.x));
    const right = Math.max(...points.map(point => point.x));
    const top = Math.min(...points.map(point => point.y));
    const bottom = Math.max(...points.map(point => point.y));
    const baseZoom = Math.max(.65, Math.min(8, 680 / Math.max(80, right - left), 440 / Math.max(80, bottom - top)));
    const zoom = Math.max(.65, Math.min(8, baseZoom * detailScale));
    return { zoom,
      x: (500 - (left + right) / 2) * zoom,
      y: (340 - (top + bottom) / 2) * zoom + 30 };
  }

  function render(frame, options = {}) {
    const selected = options.selectedEdge || '';
    const semantics = frame.semantics || {};
    // A replaced scene adopts the pending orbit target and leaves no half-settled camera behind.
    camera3d.yaw = camera3d.targetYaw;
    camera3d.pitch = camera3d.targetPitch;
    camera = viewMode === '3d' ? camera3d : camera2d;
    const scene = element('section', 'temporal-constellation');
    scene.setAttribute('aria-label', semantics.sceneLabel || 'inventory constellation');
    const header = element('div', 'constellation-heading');
    const title = element('div');
    title.append(element('span', 'constellation-eyebrow', semantics.eyebrow || `${frame.source?.toUpperCase() || 'inventory'} / ${frame.temporal_mode === 'accumulated' ? 'observed through' : 'inventory year'} ${frame.year || ''}`));
    const focus = frame.nodes.find(node => node.id === frame.focus);
    title.append(element('h3', '', focus?.name || semantics.overviewTitle || 'the source constellation'));
    header.append(title);
    const count = element('div', 'constellation-count');
    count.append(element('strong', '', String(frame.focus ? frame.edges.length : frame.nodes.length)),
      element('span', '', frame.focus ? semantics.focusCountLabel || 'visible co-listings'
        : semantics.overviewCountLabel || 'observed candidates'));
    header.append(count);
    scene.append(header);

    const modeSwitch = element('div', 'constellation-mode-switch');
    modeSwitch.setAttribute('role', 'group');
    modeSwitch.setAttribute('aria-label', 'graph view');
    const modeButtons = new Map();
    for (const mode of ['2d', '3d']) {
      const button = element('button', '', mode);
      button.type = 'button'; button.setAttribute('aria-label', `${mode} graph`);
      button.addEventListener('click', () => activateMode(mode));
      modeButtons.set(mode, button); modeSwitch.append(button);
    }
    scene.append(modeSwitch);

    const svg = svgElement('svg', { viewBox: '0 0 1000 680', class: 'constellation-map',
      role: 'group', tabindex: '0', 'aria-label': 'observation map. drag to pan; mouse wheel, pinch, or plus and minus to zoom; arrow keys to move. select a node to inspect its connection.' });
    const svgTitle = svgElement('title');
    svgTitle.textContent = 'stable candidate positions; distances and brightness are display choices, not evidence strength';
    svg.append(svgTitle);
    const field = svgElement('g', { class: 'constellation-camera' });
    svg.append(field);
    const basePositions = new Map(frame.nodes.map(node => [node.id, node.position || position(node.id)]));
    const tints = new Map(frame.nodes.map(node => [node.id, root.LogPoseResearchModel.temporalDisplayTint(node.id)]));
    const spatialPositions = new Map(frame.nodes.map(node => [node.id, spatialPosition(node.id, basePositions.get(node.id))]));
    const orbitCenter = [...spatialPositions.values()].reduce((center, point) => ({
      x: center.x + point.x / spatialPositions.size,
      y: center.y + point.y / spatialPositions.size,
      z: center.z + point.z / spatialPositions.size
    }), { x: 0, y: 0, z: 0 });
    const centeredSpatialPoint = point => ({ x: point.x - orbitCenter.x,
      y: point.y - orbitCenter.y, z: point.z - orbitCenter.z });
    const positions = new Map();
    let projectedMode = null;
    function projectPositions() {
      positions.clear();
      for (const node of frame.nodes) {
        positions.set(node.id, viewMode === '3d'
          ? project3d(centeredSpatialPoint(spatialPositions.get(node.id))) : basePositions.get(node.id));
      }
      projectedMode = viewMode;
    }
    projectPositions();
    function fitView() {
      const points = [...basePositions.values()];
      if (!points.length || !frame.focus) {
        camera.x = 0; camera.y = 0; camera.zoom = 1;
        return;
      }
      Object.assign(camera, fittedCamera(points, options.fitScale ?? DETAIL_SCALE));
    }
    function fit3dView() {
      const points = [...spatialPositions.values()].map(point => project3d(centeredSpatialPoint(point), camera3d));
      const fitted = fittedCamera(points, frame.focus ? 1.18 : .92);
      camera3d.x = fitted.x; camera3d.y = fitted.y; camera3d.zoom = fitted.zoom;
    }
    // Fit only when entering a different neighborhood, never when its year changes.
    const scope = `${frame.build_id || ''}:${frame.source || ''}:${frame.focus || ''}`;
    if (scope !== cameraScope) { cameraScope = scope; camera = camera2d; projectPositions(); fitView(); }
    if (scope !== camera3dScope) {
      camera3dScope = scope; camera3d.yaw = -.52; camera3d.pitch = -.28;
      camera3d.targetYaw = camera3d.yaw; camera3d.targetPitch = camera3d.pitch; fit3dView();
    }
    camera = viewMode === '3d' ? camera3d : camera2d;
    projectPositions();
    const present = new Set(frame.focus
      ? [...frame.edges.map(edge => edge.candidate_id), ...(frame.focus_present ? [frame.focus] : [])]
      : frame.nodes.map(node => node.id));
    const entering = new Set(scope === populationScope ? [...present].filter(id => !populationPresent.has(id)) : present);
    const enteringOrder = new Map(frame.nodes.filter(node => entering.has(node.id)).map((node, index) => [node.id, index]));
    const enterDelay = id => entering.size < 2 ? 0 : Math.round((enteringOrder.get(id) || 0) / (entering.size - 1) * 240);
    populationScope = scope;
    populationPresent = present;
    const changes = new Map((frame.changes || []).map(change => [change.candidate_id, change]));
    const current = new Set(frame.edges.map(edge => edge.candidate_id));
    const labelNodes = [];
    const contextElements = [];
    const contextVisible = () => !frame.focus || appearance.context;
    let deferContextProjection = false;
    let hovered = '';
    let gpu = null;
    const peers = svgElement('g', { class: 'constellation-context', 'aria-hidden': 'true' });
    for (const edge of frame.context_edges || []) {
      const left = positions.get(edge.left);
      const right = positions.get(edge.right);
      if (!left || !right) continue;
      const line = svgElement('line', { x1: left.x, y1: left.y, x2: right.x, y2: right.y,
        'data-left': edge.left, 'data-right': edge.right });
      line.style.setProperty('--edge-tint', tints.get(edge.left).hex);
      peers.append(line);
      contextElements.push({ edge, line });
    }
    field.append(peers);
    const threads = svgElement('g', { class: 'constellation-threads', 'aria-hidden': 'true' });
    const origin = positions.get(frame.focus);
    const threadElements = new Map();
    if (origin) {
      for (const edge of frame.edges) {
        const point = positions.get(edge.candidate_id);
        if (!point) continue;
        const thread = svgElement('line', { x1: origin.x, y1: origin.y, x2: point.x, y2: point.y,
          class: `constellation-thread${edge.candidate_id === selected ? ' is-selected' : ''}${entering.has(edge.candidate_id) ? ' is-entering' : ''}`,
          'data-neighbor': edge.candidate_id });
        if (entering.has(edge.candidate_id)) thread.style.setProperty('--enter-delay', `${enterDelay(edge.candidate_id)}ms`);
        thread.style.setProperty('--edge-tint', tints.get(edge.candidate_id).hex);
        threads.append(thread);
        threadElements.set(edge.candidate_id, thread);
      }
    }
    field.append(threads);
    const hitThreads = svgElement('g', { class: 'constellation-edge-hits', 'aria-hidden': 'true' });
    const hitThreadElements = new Map();
    for (const [id, thread] of threadElements) {
      const hit = thread.cloneNode(false);
      hit.setAttribute('class', 'constellation-edge-hit');
      hit.addEventListener('click', () => inspect(id));
      hit.addEventListener('pointerenter', () => emphasize(id));
      hit.addEventListener('pointerleave', () => emphasize(''));
      hitThreads.append(hit);
      hitThreadElements.set(id, hit);
    }
    field.append(hitThreads);

    function emphasize(id) {
      hovered = id;
      for (const [key, thread] of threadElements) thread.classList.toggle('is-hovered', key === id);
      const nearby = new Set();
      if (id) {
        nearby.add(id);
        if (frame.focus && (id === frame.focus || threadElements.has(id))) nearby.add(frame.focus);
        for (const { edge } of contextVisible() ? contextElements : []) {
          if (edge.left === id) nearby.add(edge.right);
          if (edge.right === id) nearby.add(edge.left);
        }
      }
      peers.classList.toggle('has-active-neighborhood', Boolean(id));
      for (const { edge, line } of contextElements) {
        line.classList.toggle('is-nearby', contextVisible() && Boolean(id) && (edge.left === id || edge.right === id));
      }
      for (const record of labelNodes) {
        record.group.classList.toggle('is-hovered', record.id === id);
        record.group.classList.toggle('is-nearby', Boolean(id) && record.id !== id && nearby.has(record.id));
      }
      updateGPU();
    }
    function inspect(id) {
      if (!frame.focus) options.onSelectCandidate?.(id);
      else if (id !== frame.focus) options.onSelectEdge?.(id);
    }
    for (const node of frame.nodes) {
      const point = positions.get(node.id);
      const isFocus = node.id === frame.focus;
      const isAbsent = frame.focus ? (isFocus ? !frame.focus_present : !current.has(node.id)) : false;
      const isNew = changes.get(node.id)?.status === 'newly_observed_in_selected_frame';
      const group = svgElement('g', { class: `constellation-node${isFocus ? ' is-focus' : ''}${isAbsent ? ' is-absent' : ''}${isNew ? ' is-new' : ''}${node.id === selected ? ' is-selected' : ''}`,
        transform: `translate(${point.x} ${point.y})`, role: 'button', tabindex: '0',
        'aria-label': !frame.focus ? `explore ${node.name}` : isFocus ? `${node.name}, pinned ${semantics.focusKind || 'candidate'}${isAbsent ? ', absent from this slice' : ''}`
          : `inspect ${node.name}${isAbsent ? ', comparison only' : node.connection_label
            ? `, ${node.connection_label}` : isNew ? ', newly observed in selected slice' : `, ${semantics.neighborKind || 'co-listed'}`}`,
        'aria-pressed': String(node.id === selected), 'data-candidate': node.id });
      group.style.setProperty('--node-tint', tints.get(node.id).hex);
      const name = svgElement('title');
      name.textContent = `${node.name} · ${isAbsent ? 'comparison context, not observed in this slice'
        : node.identity_label || 'unreviewed inventory candidate'}`;
      group.append(name);
      const scale = svgElement('g', { class: 'constellation-scale' });
      scale.append(svgElement('circle', { r: 18, class: 'constellation-hit' }));
      const visual = svgElement('g', { class: `constellation-visual${entering.has(node.id) ? ' is-entering' : ''}` });
      if (entering.has(node.id)) visual.style.setProperty('--enter-delay', `${enterDelay(node.id)}ms`);
      visual.addEventListener('animationend', event => {
        if (event.animationName === 'constellation-pop-in') visual.classList.remove('is-entering');
      });
      visual.append(svgElement('circle', { r: isFocus ? 34 : 21, class: 'constellation-aura constellation-aura-outer' }));
      visual.append(svgElement('circle', { r: isFocus ? 22 : 13, class: 'constellation-aura constellation-aura-inner' }));
      visual.append(svgElement('circle', { r: isFocus ? 6 : frame.focus ? 3.8 : 2.2, class: 'constellation-core' }));
      if (isNew && !isFocus) visual.append(svgElement('path', { d: 'M -8 0 L 0 -8 L 8 0 L 0 8 Z', class: 'constellation-new-mark' }));
      if (isFocus || node.id === selected) visual.append(svgElement('circle', { r: 11, class: 'constellation-selection' }));
      const label = svgElement('text', { x: 13, y: 4, class: 'constellation-label' });
      label.textContent = node.name.length > 30 ? node.name.slice(0, 28) + '…' : node.name;
      scale.append(visual, label); group.append(scale);
      group.addEventListener('pointerenter', () => emphasize(node.id));
      group.addEventListener('pointerleave', () => emphasize(''));
      group.addEventListener('focus', () => emphasize(node.id));
      group.addEventListener('blur', () => emphasize(''));
      group.addEventListener('click', () => inspect(node.id));
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(node.id); }
      });
      labelNodes.push({ id: node.id, group, point, name: node.name, priority: isFocus || node.id === selected });
      field.append(group);
    }
    function updateContextProjection() {
      for (const { edge, line } of contextElements) {
        const left = positions.get(edge.left); const right = positions.get(edge.right);
        line.setAttribute('x1', left.x); line.setAttribute('y1', left.y);
        line.setAttribute('x2', right.x); line.setAttribute('y2', right.y);
      }
    }
    function applyProjection() {
      projectPositions();
      if (!deferContextProjection && contextVisible()) updateContextProjection();
      for (const [id, thread] of threadElements) {
        const left = positions.get(frame.focus); const right = positions.get(id);
        for (const line of [thread, hitThreadElements.get(id)]) {
          line.setAttribute('x1', left.x); line.setAttribute('y1', left.y);
          line.setAttribute('x2', right.x); line.setAttribute('y2', right.y);
        }
      }
      for (const record of labelNodes) {
        const point = positions.get(record.id); record.point = point;
        record.group.setAttribute('transform', `translate(${point.x} ${point.y})`);
        const visual = record.group.querySelector('.constellation-visual');
        if (viewMode === '3d') {
          visual.setAttribute('transform', `scale(${point.scale})`);
          visual.style.setProperty('--depth-opacity', String(point.opacity));
        } else {
          visual.removeAttribute('transform');
          visual.style.removeProperty('--depth-opacity');
        }
      }
      if (!deferContextProjection) {
        const paintOrder = viewMode === '3d'
          ? [...labelNodes].sort((left, right) => Number(left.priority) - Number(right.priority)
            || right.point.depth - left.point.depth)
          : labelNodes;
        for (const record of paintOrder) field.append(record.group);
      }
    }
    function activateMode(mode) {
      if (mode !== '2d' && mode !== '3d') return;
      if (orbitFrame !== null) {
        root.cancelAnimationFrame(orbitFrame); orbitFrame = null;
        camera3d.yaw = camera3d.targetYaw; camera3d.pitch = camera3d.targetPitch;
      }
      deferContextProjection = false;
      scene.classList.remove('is-orbiting');
      emphasize('');
      viewMode = mode; camera = mode === '3d' ? camera3d : camera2d;
      scene.classList.toggle('is-view-3d', mode === '3d');
      for (const [key, button] of modeButtons) button.setAttribute('aria-pressed', String(key === mode));
      svg.setAttribute('aria-label', mode === '3d'
        ? 'three dimensional observation map. drag or use arrow keys to orbit; shift-drag, middle-drag, right-drag, or shift-arrow to pan; mouse wheel, plus, or minus to zoom.'
        : 'observation map. drag to pan; mouse wheel, pinch, or plus and minus to zoom; arrow keys to move. select a node to inspect its connection.');
      if (mode === '2d' && scene.isConnected) attachGPU();
      updateCamera();
    }
    function resetCamera() {
      if (viewMode === '3d') {
        camera3d.yaw = -.52; camera3d.pitch = -.28;
        camera3d.targetYaw = camera3d.yaw; camera3d.targetPitch = camera3d.pitch; fit3dView();
      } else fitView();
      updateCamera();
    }
    scene.append(svg);
    function attachGPU() {
      if (gpu || viewMode !== '2d') return;
      gpu = root.LogPoseTemporalGPU?.attach(scene, svg) || null;
      updateGPU();
    }
    if (!appearance.motion || !entering.size) attachGPU();
    else root.setTimeout(() => {
      if (!scene.isConnected) return;
      if (!document.hidden && viewMode === '2d') attachGPU();
      else document.addEventListener('visibilitychange', () => {
        if (scene.isConnected && viewMode === '2d') attachGPU();
      }, { once: true });
    }, 1000);

    const footer = element('div', 'constellation-footer');
    const legend = element('div', 'constellation-legend');
    for (const [kind, text] of semantics.legend || [['solid', 'observed'], ['diamond', 'new in slice'], ['hollow', 'comparison only']]) {
      const item = element('span');
      item.append(element('i', `legend-${kind}`), document.createTextNode(text));
      legend.append(item);
    }
    footer.append(legend);
    const modeHint = element('span', 'constellation-mode-hint');
    footer.append(modeHint);
    const controls = element('div', 'constellation-camera-controls');
    const zoomText = element('output', '', '100%');
    function action(text, label, callback) {
      const button = element('button', '', text);
      button.type = 'button'; button.setAttribute('aria-label', label);
      button.addEventListener('click', callback); return button;
    }
    controls.append(action('−', 'zoom out graph', () => zoomTo(camera.zoom / 1.25)), zoomText,
      action('+', 'zoom in graph', () => zoomTo(camera.zoom * 1.25)),
      action('↺', 'reset graph view', resetCamera));
    footer.append(controls); scene.append(footer);
    controls.title = 'pinch or ctrl/⌘ + scroll to zoom; plain scrolling moves the page';
    scene.append(element('p', 'constellation-note', (frame.context_edges_truncated ? `${(frame.context_edges || []).length.toLocaleString()} of ${(frame.total_context_edges || 0).toLocaleString()} context connections loaded. ` : '') + 'positions stay fixed through time. spacing, depth, color, light and line length carry no evidence meaning or measure of strength.'));

    const tuning = element('details', 'constellation-tuning');
    tuning.append(element('summary', '', 'view settings'));
    function slider(label, key, unit) {
      const wrapper = element('label');
      const text = element('span', '', label);
      const input = element('input'); input.type = 'range'; input.min = '0'; input.max = '100';
      input.value = String(appearance[key]); input.setAttribute('aria-label', label);
      const value = element('output', '', `${appearance[key]}${unit}`);
      input.addEventListener('input', () => {
        appearance[key] = Number(input.value); value.textContent = `${appearance[key]}${unit}`; updateAppearance();
      });
      wrapper.append(text, input, value); return wrapper;
    }
    tuning.append(slider('label density', 'labels', '%'), slider('thread visibility', 'threads', '%'));
    if (frame.focus) {
      const context = element('label', 'constellation-context-control');
      const contextInput = element('input'); contextInput.type = 'checkbox'; contextInput.checked = appearance.context;
      contextInput.addEventListener('change', () => {
        appearance.context = contextInput.checked;
        if (appearance.context) updateContextProjection();
        updateAppearance();
      });
      context.append(contextInput, element('span', '', 'context connections'));
      tuning.append(context);
    }
    const motion = element('label', 'constellation-motion-control');
    const motionInput = element('input'); motionInput.type = 'checkbox'; motionInput.checked = appearance.motion;
    motionInput.addEventListener('change', () => { appearance.motion = motionInput.checked; updateAppearance(); });
    motion.append(motionInput, element('span', '', 'graph motion'));
    tuning.append(motion);
    scene.append(tuning);

    function updateGPU() {
      if (!gpu) return;
      if (viewMode !== '2d') {
        gpu.setActive?.(false);
        return;
      }
      gpu.setActive?.(true);
      gpu?.update({ frame, positions, camera, selected, hover: hovered, threads: appearance.threads,
        context: !frame.focus || appearance.context, motion: appearance.motion && viewMode === '2d', tints });
    }
    function updateAppearance() {
      scene.classList.toggle('is-motion-off', !appearance.motion);
      scene.classList.toggle('is-context-off', Boolean(frame.focus) && !appearance.context);
      if (!appearance.motion) scene.querySelectorAll('.is-entering').forEach(node => node.classList.remove('is-entering'));
      scene.style.setProperty('--thread-opacity', String(0.06 + appearance.threads / 100 * 0.32));
      modeHint.textContent = viewMode === '3d' ? 'drag to orbit · shift-drag or right-drag to pan · scroll to zoom' : 'drag to pan · scroll to zoom';
      const occupiedByCell = new Map();
      const cellSize = 48 / camera.zoom;
      const order = labelNodes.toSorted((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id));
      for (const record of order) {
        const width = Math.min(record.name.length, 30) * 8.5 / camera.zoom;
        const box = { x: record.point.x + 12 / camera.zoom, y: record.point.y - 9 / camera.zoom, width, height: 17 / camera.zoom };
        const left = Math.floor(box.x / cellSize);
        const right = Math.floor((box.x + box.width) / cellSize);
        const top = Math.floor(box.y / cellSize);
        const bottom = Math.floor((box.y + box.height) / cellSize);
        const nearby = new Set();
        for (let x = left; x <= right; x += 1) {
          for (let y = top; y <= bottom; y += 1) {
            for (const other of occupiedByCell.get(`${x}:${y}`) || []) nearby.add(other);
          }
        }
        const overlaps = [...nearby].some(other => box.x < other.x + other.width && box.x + box.width > other.x
          && box.y < other.y + other.height && box.y + box.height > other.y);
        const eligible = options.showAllLabels || hash(record.id + ':label') % 100 < appearance.labels;
        const visible = record.priority || (eligible && !overlaps);
        record.group.classList.toggle('has-label', visible);
        if (visible) {
          for (let x = left; x <= right; x += 1) {
            for (let y = top; y <= bottom; y += 1) {
              const key = `${x}:${y}`;
              const boxes = occupiedByCell.get(key) || [];
              boxes.push(box);
              occupiedByCell.set(key, boxes);
            }
          }
        }
      }
      updateGPU();
    }
    let previousZoom = null;
    let previousMode = null;
    let cameraFrame = null;
    function drawCamera() {
      const started = performance.now();
      const projectionChanged = viewMode === '3d' || projectedMode !== viewMode;
      if (projectionChanged) applyProjection();
      field.setAttribute('transform', `translate(${500 + camera.x} ${340 + camera.y}) scale(${camera.zoom}) translate(-500 -340)`);
      const scaleChanged = camera.zoom !== previousZoom || viewMode !== previousMode;
      if (scaleChanged) {
        for (const record of labelNodes) {
          record.group.querySelector('.constellation-scale').setAttribute('transform', `scale(${1 / camera.zoom})`);
        }
        previousZoom = camera.zoom;
        previousMode = viewMode;
        zoomText.textContent = `${Math.round(camera.zoom * 100)}%`;
      }
      // A 2d pan preserves label collisions; an orbit changes their projected positions.
      if (scaleChanged || projectionChanged) updateAppearance();
      else updateGPU();
      scene.dataset.cameraFrameMs = String(performance.now() - started);
    }
    function scheduleCameraUpdate() {
      if (cameraFrame !== null) return;
      cameraFrame = root.requestAnimationFrame(() => {
        cameraFrame = null;
        if (scene.isConnected) drawCamera();
      });
    }
    function updateCamera() {
      if (!options.scheduleCamera || !scene.isConnected) drawCamera();
      else scheduleCameraUpdate();
    }
    function zoomTo(value) { camera.zoom = Math.max(0.65, Math.min(12, value)); updateCamera(); }
    let drag = null;
    let suppressClick = false;
    let orbitFrame = null;
    let orbitTime = null;
    function settleOrbit() {
      if (orbitFrame !== null) return;
      orbitTime = null;
      const step = time => {
        orbitFrame = null;
        if (!scene.isConnected) return;
        const yawGap = camera3d.targetYaw - camera3d.yaw;
        const pitchGap = camera3d.targetPitch - camera3d.pitch;
        const settled = Math.abs(yawGap) < .001 && Math.abs(pitchGap) < .001;
        if (!appearance.motion || settled) {
          camera3d.yaw = camera3d.targetYaw;
          camera3d.pitch = camera3d.targetPitch;
          deferContextProjection = false;
          scene.classList.remove('is-orbiting');
        } else {
          const elapsed = orbitTime === null ? 16.67 : Math.min(50, time - orbitTime);
          const amount = 1 - Math.pow(1 - .24, elapsed / 16.67);
          orbitTime = time;
          camera3d.yaw += yawGap * amount;
          camera3d.pitch += pitchGap * amount;
        }
        updateCamera();
        if (!settled && appearance.motion) orbitFrame = root.requestAnimationFrame(step);
      };
      orbitFrame = root.requestAnimationFrame(step);
    }
    function finishDrag(event, cancelled = false) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.owned && !cancelled) suppressClick = true;
      drag = null;
      svg.classList.remove('is-dragging');
      if (!appearance.motion || cancelled) {
        deferContextProjection = false;
        scene.classList.remove('is-orbiting');
        updateCamera();
      }
    }
    svg.addEventListener('pointerdown', event => {
      const panButton = viewMode === '3d' && (event.button === 1 || event.button === 2);
      if ((event.button !== 0 && !panButton) || drag) return;
      if (panButton) event.preventDefault();
      suppressClick = false;
      if (viewMode === '2d' && event.target.closest('.constellation-node, .constellation-edge-hit')) return;
      drag = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY,
        cameraX: camera.x, cameraY: camera.y, yaw: camera3d.yaw, pitch: camera3d.pitch,
        pan: viewMode === '2d' || event.shiftKey || panButton, owned: viewMode === '2d', rect: svg.getBoundingClientRect() };
      if (drag.owned) { svg.setPointerCapture?.(event.pointerId); svg.classList.add('is-dragging'); }
    });
    svg.addEventListener('pointermove', event => {
      if (!drag || (drag.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const rect = drag.rect;
      const deltaX = event.clientX - drag.x; const deltaY = event.clientY - drag.y;
      if (!drag.owned) {
        const threshold = drag.pointerType === 'touch' ? 9 : 5;
        if (Math.hypot(deltaX, deltaY) < threshold) return;
        drag.owned = true; emphasize(''); svg.setPointerCapture?.(event.pointerId); svg.classList.add('is-dragging');
      }
      const scale = 1000 / rect.width;
      if (drag.pan) {
        camera.x = drag.cameraX + deltaX * scale;
        camera.y = drag.cameraY + deltaY * scale;
      } else {
        deferContextProjection = true;
        scene.classList.add('is-orbiting');
        const orbitScale = Math.PI * .45 / Math.max(1, rect.height);
        camera3d.targetYaw = drag.yaw + deltaX * orbitScale;
        camera3d.targetPitch = Math.max(-1.2, Math.min(1.2, drag.pitch - deltaY * orbitScale));
        if (appearance.motion) settleOrbit();
        else { camera3d.yaw = camera3d.targetYaw; camera3d.pitch = camera3d.targetPitch; }
      }
      if (drag.pan || !appearance.motion) scheduleCameraUpdate();
    });
    svg.addEventListener('pointerup', event => finishDrag(event));
    svg.addEventListener('pointercancel', event => finishDrag(event, true));
    svg.addEventListener('lostpointercapture', event => finishDrag(event, true));
    svg.addEventListener('click', event => {
      if (!suppressClick) return;
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    svg.addEventListener('contextmenu', event => {
      if (viewMode === '3d') event.preventDefault();
    });
    svg.addEventListener('wheel', event => {
      event.preventDefault();
      // Wheel deltas may be pixels, lines, or pages.
      const deltaUnit = event.deltaMode === 1 ? 16
        : event.deltaMode === 2 ? svg.getBoundingClientRect().height : 1;
      zoomTo(camera.zoom * Math.exp(-event.deltaY * deltaUnit * 0.001));
    }, { passive: false });
    svg.addEventListener('keydown', event => {
      if (event.target !== svg) return;
      const steps = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
      if (steps[event.key]) {
        event.preventDefault();
        if (viewMode === '3d' && !event.shiftKey) {
          camera3d.yaw += steps[event.key][0] / 300;
          camera3d.pitch = Math.max(-1.2, Math.min(1.2, camera3d.pitch + steps[event.key][1] / 300));
          camera3d.targetYaw = camera3d.yaw; camera3d.targetPitch = camera3d.pitch;
        } else { camera.x += steps[event.key][0]; camera.y += steps[event.key][1]; }
        updateCamera();
      }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(camera.zoom * 1.25); }
      if (event.key === '-') { event.preventDefault(); zoomTo(camera.zoom / 1.25); }
      if (event.key === '0') resetCamera();
    });
    activateMode(viewMode);
    return scene;
  }
  const api = { render, position, spatialPosition, project3d, fittedCamera };
  root.LogPoseTemporalGraph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
