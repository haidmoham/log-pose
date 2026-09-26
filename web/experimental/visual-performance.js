(function () {
  'use strict';
  const report = document.querySelector('#report');
  const fixture = document.querySelector('#fixture');
  const routeFixture = document.querySelector('#route-fixture');
  const runButton = document.querySelector('#run');

  async function loadFrames() {
    const timeline = await fetch('../api/market-field?mode=timeline').then(response => response.json());
    const shared = { mode: 'frame', build_id: timeline.build_id, source: 'cncf', year: '2024',
      temporal_mode: 'accumulated', category: 'all', query: '', offset: '0', limit: '60' };
    const request = extra => fetch(`../api/market-field?${new URLSearchParams({ ...shared, ...extra })}`)
      .then(response => response.json());
    const overview = await request({});
    const datadog = overview.nodes.find(node => node.name === 'Datadog');
    if (!datadog) throw new Error('The pinned CNCF 2024 frame has no Datadog candidate.');
    const focused = await request({ candidate: datadog.id });
    return { overview, focused, buildId: timeline.build_id, datadogId: datadog.id };
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  async function waitFrames(count) {
    for (let index = 0; index < count; index += 1) await nextFrame();
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function percentile(values, fraction) {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
  }

  async function gesture(svg, startX, startY, endX, endY, steps) {
    svg.setPointerCapture = () => {};
    svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0,
      pointerId: 1, clientX: startX, clientY: startY }));
    const handlerTimes = [];
    const frameTimestamps = [];
    for (let step = 1; step <= steps; step += 1) {
      const before = performance.now();
      svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1,
        clientX: startX + (endX - startX) * step / steps,
        clientY: startY + (endY - startY) * step / steps }));
      handlerTimes.push(performance.now() - before);
      frameTimestamps.push(await nextFrame());
    }
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1,
      clientX: endX, clientY: endY }));
    return { handlerTimes, frameIntervals: frameTimestamps.slice(1)
      .map((timestamp, index) => timestamp - frameTimestamps[index]) };
  }

  function instrument() {
    const metrics = { projection: { calls: 0, milliseconds: 0 },
      setAttribute: { calls: 0, milliseconds: 0 }, append: { calls: 0, milliseconds: 0 },
      gpuUpdate: { calls: 0, milliseconds: 0 } };
    const model = window.LogPoseResearchModel;
    const originalProjection = model.projectTemporalPoint;
    const originalSetAttribute = Element.prototype.setAttribute;
    const originalAppend = Element.prototype.append;
    const gpuApi = window.LogPoseTemporalGPU;
    const originalAttach = gpuApi?.attach;
    const wrappedGpuInstances = new Map();
    model.projectTemporalPoint = function (...args) {
      const start = performance.now();
      try { return originalProjection.apply(this, args); }
      finally { metrics.projection.calls += 1; metrics.projection.milliseconds += performance.now() - start; }
    };
    Element.prototype.setAttribute = function (...args) {
      const start = performance.now();
      try { return originalSetAttribute.apply(this, args); }
      finally { metrics.setAttribute.calls += 1; metrics.setAttribute.milliseconds += performance.now() - start; }
    };
    Element.prototype.append = function (...args) {
      const start = performance.now();
      try { return originalAppend.apply(this, args); }
      finally { metrics.append.calls += 1; metrics.append.milliseconds += performance.now() - start; }
    };
    if (gpuApi && originalAttach) {
      gpuApi.attach = function (...args) {
        const instance = originalAttach.apply(this, args);
        if (!instance || wrappedGpuInstances.has(instance)) return instance;
        const originalUpdate = instance.update;
        wrappedGpuInstances.set(instance, originalUpdate);
        instance.update = function (...updateArgs) {
          const start = performance.now();
          try { return originalUpdate.apply(this, updateArgs); }
          finally { metrics.gpuUpdate.calls += 1; metrics.gpuUpdate.milliseconds += performance.now() - start; }
        };
        return instance;
      };
    }
    return { metrics, restore() {
      model.projectTemporalPoint = originalProjection;
      Element.prototype.setAttribute = originalSetAttribute;
      Element.prototype.append = originalAppend;
      for (const [instance, update] of wrappedGpuInstances) instance.update = update;
      if (gpuApi && originalAttach) gpuApi.attach = originalAttach;
    } };
  }

  async function trial(frames) {
    const observed = instrument();
    const overviewStart = performance.now();
    fixture.replaceChildren(window.LogPoseTemporalGraph.render(frames.overview));
    const overviewRender = performance.now() - overviewStart;
    const scene = fixture.firstElementChild;
    const overviewMotion = scene.querySelector('[aria-label="graph motion"]');
    if (overviewMotion && !overviewMotion.checked) overviewMotion.click();
    scene.querySelector('[aria-label="3d graph"]').click();
    await wait(1100);
    await waitFrames(2);
    const svg = scene.querySelector('.constellation-map');
    const rect = svg.getBoundingClientRect();
    const orbit = await gesture(svg, rect.left + rect.width * .55, rect.top + rect.height * .55,
      rect.left + rect.width * .35, rect.top + rect.height * .42, 24);
    await waitFrames(30);
    scene.querySelector('[aria-label="reset graph view"]').click();
    scene.querySelector('[aria-label="2d graph"]').click();
    scene.querySelector('[aria-label="reset graph view"]').click();

    if (overviewMotion?.checked) overviewMotion.click();
    const focusStart = performance.now();
    fixture.replaceChildren(window.LogPoseTemporalGraph.render(frames.focused));
    const focusedRender = performance.now() - focusStart;
    const focusedScene = fixture.firstElementChild;
    const focusedMotion = focusedScene.querySelector('[aria-label="graph motion"]');
    if (focusedMotion && !focusedMotion.checked) focusedMotion.click();
    focusedScene.querySelector('[aria-label="3d graph"]').click();
    await wait(1100);
    await waitFrames(2);
    const focusedSvg = focusedScene.querySelector('.constellation-map');
    const focusedRect = focusedSvg.getBoundingClientRect();
    const focusedOrbit = await gesture(focusedSvg, focusedRect.left + focusedRect.width * .55,
      focusedRect.top + focusedRect.height * .55, focusedRect.left + focusedRect.width * .35,
      focusedRect.top + focusedRect.height * .42, 24);
    await waitFrames(30);
    focusedScene.querySelector('[aria-label="reset graph view"]').click();
    focusedScene.querySelector('[aria-label="2d graph"]').click();
    focusedScene.querySelector('[aria-label="reset graph view"]').click();
    if (focusedMotion?.checked) focusedMotion.click();
    observed.restore();
    return { overviewRender, focusedRender, orbit, focusedOrbit, operations: observed.metrics };
  }

  async function profileRoute(view) {
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`route fixture timed out: ${view}`)), 30000);
      routeFixture.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      routeFixture.src = `../?view=${view}&performance-fixture=${Date.now()}`;
    });
    routeFixture.scrollIntoView({ block: 'start' });
    await waitFrames(2);
    const readySelector = { data: '.data-workspace', overview: '.overview-grid', explore: '.inventory-coverage' }[view];
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const document = routeFixture.contentDocument;
      if (document.querySelector('#view')?.getAttribute('aria-busy') === 'false'
          && document.querySelector(readySelector)) break;
      await wait(50);
    }
    if (!routeFixture.contentDocument.querySelector(readySelector)) {
      throw new Error(`route fixture did not render: ${view}`);
    }
    const loaded = performance.now() - start;
    const routeWindow = routeFixture.contentWindow;
    const intervals = [];
    let previous = await new Promise(resolve => routeWindow.requestAnimationFrame(resolve));
    for (let index = 1; index <= 12; index += 1) {
      routeWindow.scrollTo(0, index * 120);
      const timestamp = await new Promise(resolve => routeWindow.requestAnimationFrame(resolve));
      intervals.push(timestamp - previous);
      previous = timestamp;
    }
    return { view, load_ms: loaded, scroll_frame_intervals_ms: intervals,
      document_width: routeFixture.contentDocument.documentElement.scrollWidth };
  }

  async function run() {
    runButton.disabled = true;
    fixture.scrollIntoView({ block: 'start' });
    await waitFrames(2);
    report.textContent = 'loading pinned CNCF 2024 frames…';
    const frames = await loadFrames();
    const longTasks = [];
    const observer = 'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration))) : null;
    observer?.observe({ type: 'longtask', buffered: false });
    report.textContent = 'running…';
    const trials = [];
    for (let index = 0; index < 5; index += 1) {
      trials.push(await trial(frames));
      report.textContent = `running ${index + 1} / 5…`;
    }
    report.textContent = 'profiling evidence, companies, and sources routes…';
    const routes = [];
    for (const view of ['data', 'overview', 'explore']) routes.push(await profileRoute(view));
    const overview = trials.map(item => item.overviewRender);
    const focused = trials.map(item => item.focusedRender);
    observer?.disconnect();
    const orbitHandlers = trials.flatMap(item => item.orbit.handlerTimes);
    const orbitIntervals = trials.flatMap(item => item.orbit.frameIntervals);
    const focusedOrbitIntervals = trials.flatMap(item => item.focusedOrbit.frameIntervals);
    const summary = {
      fixture: `retained CNCF 2024 accumulated frame ${frames.buildId}; overview ${frames.overview.nodes.length} nodes / ${frames.overview.context_edges.length} of ${frames.overview.total_context_edges} context edges; Datadog ${frames.datadogId} focused ${frames.focused.nodes.length} nodes / ${frames.focused.edges.length} direct / ${frames.focused.context_edges.length} context edges; 24 fixed orbit steps; reduced-motion render then explicit motion-on orbit`,
      device_pixel_ratio: devicePixelRatio,
      prefers_reduced_motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      visibility_state: document.visibilityState,
      viewport: `${Math.round(fixture.getBoundingClientRect().width)}x680 CSS pixels`,
      trials: trials.length,
      overview_render_ms_median: Number(percentile(overview, .5).toFixed(2)),
      overview_render_ms_max: Number(Math.max(...overview).toFixed(2)),
      focused_render_ms_median: Number(percentile(focused, .5).toFixed(2)),
      overview_orbit_handler_ms_median: Number(percentile(orbitHandlers, .5).toFixed(2)),
      overview_orbit_handler_ms_p95: Number(percentile(orbitHandlers, .95).toFixed(2)),
      overview_frame_interval_ms_median: Number(percentile(orbitIntervals, .5).toFixed(2)),
      overview_frame_interval_ms_p95: Number(percentile(orbitIntervals, .95).toFixed(2)),
      overview_slow_frames_over_20ms: orbitIntervals.filter(value => value > 20).length,
      focused_frame_interval_ms_p95: Number(percentile(focusedOrbitIntervals, .95).toFixed(2)),
      long_tasks_over_50ms: longTasks.length,
      long_task_ms_max: longTasks.length ? Number(Math.max(...longTasks).toFixed(2)) : 0,
      route_profiles: routes,
      raw_trials: trials,
      user_agent: navigator.userAgent
    };
    report.textContent = JSON.stringify(summary, null, 2);
    report.dataset.complete = 'true';
    runButton.disabled = false;
  }

  runButton.addEventListener('click', () => run().catch(error => {
    report.textContent = `benchmark failed: ${error.message}`;
    runButton.disabled = false;
  }));
}());
