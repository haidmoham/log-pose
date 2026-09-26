/* Display-only constellation. Evidence, eligibility and deltas come from the server. */
(function (root) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const camera = { x: 0, y: 0, zoom: 1 };
  let cameraScope = null;
  const appearance = { labels: 40, threads: 45 };

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

  function render(frame, options = {}) {
    const selected = options.selectedEdge || '';
    const scene = element('section', 'temporal-constellation');
    scene.setAttribute('aria-label', 'inventory constellation');
    const header = element('div', 'constellation-heading');
    const title = element('div');
    title.append(element('span', 'constellation-eyebrow', `${frame.source?.toUpperCase() || 'inventory'} / ${frame.temporal_mode === 'accumulated' ? 'observed through' : 'inventory year'} ${frame.year || ''}`));
    const focus = frame.nodes.find(node => node.id === frame.focus);
    title.append(element('h3', '', focus?.name || 'the source constellation'));
    header.append(title);
    const count = element('div', 'constellation-count');
    count.append(element('strong', '', String(frame.focus ? frame.edges.length : frame.nodes.length)), element('span', '', frame.focus ? 'visible co-listings' : 'observed candidates'));
    header.append(count);
    scene.append(header);

    const svg = svgElement('svg', { viewBox: '0 0 1000 680', class: 'constellation-map',
      role: 'group', tabindex: '0', 'aria-label': 'observation map. drag to pan; pinch, control-scroll, command-scroll, or plus and minus to zoom; arrow keys to move. select a node to inspect its connection.' });
    const svgTitle = svgElement('title');
    svgTitle.textContent = 'stable candidate positions; distances and brightness are display choices, not evidence strength';
    svg.append(svgTitle);
    const field = svgElement('g', { class: 'constellation-camera' });
    svg.append(field);
    const positions = new Map(frame.nodes.map(node => [node.id, node.position || position(node.id)]));
    function fitView() {
      const points = [...positions.values()];
      if (!points.length || !frame.focus) {
        camera.x = 0; camera.y = 0; camera.zoom = 1;
        return;
      }
      const left = Math.min(...points.map(point => point.x));
      const right = Math.max(...points.map(point => point.x));
      const top = Math.min(...points.map(point => point.y));
      const bottom = Math.max(...points.map(point => point.y));
      camera.zoom = Math.max(.65, Math.min(8, 680 / Math.max(80, right - left), 440 / Math.max(80, bottom - top)));
      camera.x = (500 - (left + right) / 2) * camera.zoom;
      camera.y = (340 - (top + bottom) / 2) * camera.zoom + 30;
    }
    // Fit only when entering a different neighborhood, never when its year changes.
    const scope = `${frame.build_id || ''}:${frame.source || ''}:${frame.focus || ''}`;
    if (scope !== cameraScope) { cameraScope = scope; fitView(); }
    const changes = new Map((frame.changes || []).map(change => [change.candidate_id, change]));
    const current = new Set(frame.edges.map(edge => edge.candidate_id));
    const labelNodes = [];
    let hovered = '';
    let gpu = null;
    const peers = svgElement('g', { class: 'constellation-context', 'aria-hidden': 'true' });
    for (const edge of frame.context_edges || []) {
      const left = positions.get(edge.left);
      const right = positions.get(edge.right);
      if (!left || !right) continue;
      peers.append(svgElement('line', { x1: left.x, y1: left.y, x2: right.x, y2: right.y }));
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
          class: `constellation-thread${edge.candidate_id === selected ? ' is-selected' : ''}`,
          'data-neighbor': edge.candidate_id });
        threads.append(thread);
        threadElements.set(edge.candidate_id, thread);
      }
    }
    field.append(threads);
    const hitThreads = svgElement('g', { class: 'constellation-edge-hits', 'aria-hidden': 'true' });
    for (const [id, thread] of threadElements) {
      const hit = thread.cloneNode(false);
      hit.setAttribute('class', 'constellation-edge-hit');
      hit.addEventListener('click', () => inspect(id));
      hit.addEventListener('pointerenter', () => emphasize(id));
      hit.addEventListener('pointerleave', () => emphasize(''));
      hitThreads.append(hit);
    }
    field.append(hitThreads);

    function emphasize(id) {
      hovered = id;
      for (const [key, thread] of threadElements) thread.classList.toggle('is-hovered', key === id);
      for (const record of labelNodes) record.group.classList.toggle('is-hovered', record.id === id);
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
        'aria-label': !frame.focus ? `explore ${node.name}` : isFocus ? `${node.name}, pinned candidate${isAbsent ? ', absent from this slice' : ''}`
          : `inspect ${node.name}${isAbsent ? ', comparison only' : isNew ? ', newly observed in selected slice' : ', co-listed'}`,
        'aria-pressed': String(node.id === selected), 'data-candidate': node.id });
      const name = svgElement('title');
      name.textContent = `${node.name} · ${isAbsent ? 'comparison context, not observed in this slice' : 'unreviewed inventory candidate'}`;
      group.append(name);
      group.append(svgElement('circle', { r: 18, class: 'constellation-hit' }));
      group.append(svgElement('circle', { r: isFocus ? 22 : 13, class: 'constellation-aura' }));
      group.append(svgElement('circle', { r: isFocus ? 6 : frame.focus ? 3.8 : 2.2, class: 'constellation-core' }));
      if (isNew && !isFocus) group.append(svgElement('path', { d: 'M -8 0 L 0 -8 L 8 0 L 0 8 Z', class: 'constellation-new-mark' }));
      if (isFocus || node.id === selected) group.append(svgElement('circle', { r: 11, class: 'constellation-selection' }));
      const label = svgElement('text', { x: 13, y: 4, class: 'constellation-label' });
      label.textContent = node.name.length > 30 ? node.name.slice(0, 28) + '…' : node.name;
      group.append(label);
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
    scene.append(svg);
    gpu = root.LogPoseTemporalGPU?.attach(scene, svg) || null;

    const footer = element('div', 'constellation-footer');
    const legend = element('div', 'constellation-legend');
    for (const [kind, text] of [['solid', 'observed'], ['diamond', 'new in slice'], ['hollow', 'comparison only']]) {
      const item = element('span');
      item.append(element('i', `legend-${kind}`), document.createTextNode(text));
      legend.append(item);
    }
    footer.append(legend);
    const controls = element('div', 'constellation-camera-controls');
    const zoomText = element('output', '', '100%');
    function action(text, label, callback) {
      const button = element('button', '', text);
      button.type = 'button'; button.setAttribute('aria-label', label);
      button.addEventListener('click', callback); return button;
    }
    controls.append(action('−', 'zoom out graph', () => zoomTo(camera.zoom / 1.25)), zoomText,
      action('+', 'zoom in graph', () => zoomTo(camera.zoom * 1.25)),
      action('↺', 'reset graph view', () => { fitView(); updateCamera(); }));
    footer.append(controls); scene.append(footer);
    controls.title = 'pinch or ctrl/⌘ + scroll to zoom; plain scrolling moves the page';
    scene.append(element('p', 'constellation-note', (frame.context_edges_truncated ? `${(frame.context_edges || []).length.toLocaleString()} of ${(frame.total_context_edges || 0).toLocaleString()} context connections drawn. ` : '') + 'positions stay fixed through time. spacing, light and line length carry no measure of strength.'));

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
    scene.append(tuning);

    function updateGPU() {
      gpu?.update({ frame, positions, camera, selected, hover: hovered, threads: appearance.threads });
    }
    function updateAppearance() {
      scene.style.setProperty('--thread-opacity', String(0.06 + appearance.threads / 100 * 0.32));
      const occupied = [];
      const order = [...labelNodes].sort((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id));
      for (const record of order) {
        const width = Math.min(record.name.length, 30) * 8.5 / camera.zoom;
        const box = { x: record.point.x + 12 / camera.zoom, y: record.point.y - 9 / camera.zoom, width, height: 17 / camera.zoom };
        const overlaps = occupied.some(other => box.x < other.x + other.width && box.x + box.width > other.x
          && box.y < other.y + other.height && box.y + box.height > other.y);
        const eligible = hash(record.id + ':label') % 100 < appearance.labels || camera.zoom >= 1.6;
        const visible = record.priority || (eligible && !overlaps);
        record.group.classList.toggle('has-label', visible);
        if (visible) occupied.push(box);
      }
      updateGPU();
    }
    let previousZoom = null;
    let cameraFrame = null;
    function drawCamera() {
      const started = performance.now();
      field.setAttribute('transform', `translate(${500 + camera.x} ${340 + camera.y}) scale(${camera.zoom}) translate(-500 -340)`);
      // Panning does not change label collisions or inverse-size glyphs.
      if (camera.zoom !== previousZoom) {
        for (const record of labelNodes) {
          for (const child of record.group.children) child.setAttribute('transform', `scale(${1 / camera.zoom})`);
        }
        previousZoom = camera.zoom;
        zoomText.textContent = `${Math.round(camera.zoom * 100)}%`;
        updateAppearance();
      } else {
        updateGPU();
      }
      scene.dataset.cameraFrameMs = String(performance.now() - started);
    }
    function updateCamera() {
      if (!options.scheduleCamera || !scene.isConnected) { drawCamera(); return; }
      if (cameraFrame !== null) return;
      cameraFrame = root.requestAnimationFrame(() => {
        cameraFrame = null;
        if (scene.isConnected) drawCamera();
      });
    }
    function zoomTo(value) { camera.zoom = Math.max(0.65, Math.min(12, value)); updateCamera(); }
    let drag = null;
    svg.addEventListener('pointerdown', event => {
      if (event.target.closest('.constellation-node, .constellation-edge-hit') || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
      svg.setPointerCapture?.(event.pointerId); svg.classList.add('is-dragging');
    });
    svg.addEventListener('pointermove', event => {
      if (!drag) return;
      const scale = 1000 / svg.getBoundingClientRect().width;
      camera.x = drag.cameraX + (event.clientX - drag.x) * scale;
      camera.y = drag.cameraY + (event.clientY - drag.y) * scale;
      updateCamera();
    });
    function endDrag() { drag = null; svg.classList.remove('is-dragging'); }
    svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('wheel', event => {
      // Plain scrolling belongs to the page; pinch and modified wheel target the map.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(camera.zoom * Math.exp(-event.deltaY * 0.001));
    }, { passive: false });
    svg.addEventListener('keydown', event => {
      if (event.target !== svg) return;
      const steps = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
      if (steps[event.key]) { event.preventDefault(); camera.x += steps[event.key][0]; camera.y += steps[event.key][1]; updateCamera(); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(camera.zoom * 1.25); }
      if (event.key === '-') { event.preventDefault(); zoomTo(camera.zoom / 1.25); }
      if (event.key === '0') { fitView(); updateCamera(); }
    });
    updateCamera();
    return scene;
  }
  const api = { render, position };
  root.LogPoseTemporalGraph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
