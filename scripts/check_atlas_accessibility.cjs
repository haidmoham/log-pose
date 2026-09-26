// Exercise the shared atlas access paths in a real constrained browser context.
'use strict';

const assert = require('node:assert/strict');

async function tabTo(page, selector, key = 'Tab') {
  for (let step = 0; step < 160; step += 1) {
    if (await page.locator(selector).evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`keyboard did not reach ${selector}`);
}

async function verifyAccessibleAtlas(browser, url, layer, report) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => report.page_errors.push(error.message));
  await page.addInitScript(() => {
    window.atlasTestAnimationCalls = 0;
    const originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.atlasTestAnimationCalls += 1;
      return originalAnimate.apply(this, args);
    };
  });
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('.atlas-candidate-list button').first().waitFor({ state: 'attached', timeout: 30000 });
    await tabTo(page, '.atlas-access summary');
    await page.keyboard.press('Enter');
    await page.locator('.atlas-candidate-list button').first().waitFor({ state: 'visible', timeout: 30000 });
    const capabilities = await page.evaluate(() => ({
      reduced_motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      touch_points: navigator.maxTouchPoints,
      webgl_available: Boolean(document.createElement('canvas').getContext('webgl')),
      webgl2_available: Boolean(document.createElement('canvas').getContext('webgl2')),
    }));
    assert(capabilities.reduced_motion && capabilities.touch_points > 0);
    assert.equal(capabilities.webgl_available, false, 'fallback check must disable WebGL');
    assert.equal(capabilities.webgl2_available, false, 'fallback check must disable WebGL2');
    const frame = await page.locator('#atlas-frame-label').getAttribute('data-frame-id');
    const neighbors = await page.locator('.atlas-candidate-list button').count();
    assert(await page.locator('.constellation-node').count() > 0, 'SVG remains usable without WebGL');

    await tabTo(page, '#atlas-list-toggle');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.constellation-map').count(), 0);
    assert.equal(await page.locator('.atlas-candidate-list button').count(), neighbors);
    assert.equal(await page.locator('#atlas-frame-label').getAttribute('data-frame-id'), frame);
    await tabTo(page, '.atlas-candidate-list button:first-child');
    const focusStyle = await page.locator('.atlas-candidate-list button:first-child').evaluate(element => ({
      visible: element.matches(':focus-visible'), width: parseFloat(getComputedStyle(element).outlineWidth),
    }));
    assert(focusStyle.visible && focusStyle.width >= 2, 'keyboard selection needs a visible focus indicator');
    await page.keyboard.press('Enter');
    const evidenceSelector = layer === 'reviewed' ? '.atlas-claim' : '.atlas-premise';
    await page.locator(`#atlas-inspector ${evidenceSelector}`).first().waitFor({ state: 'visible' });
    assert(await page.locator('.atlas-candidate-list button:first-child')
      .evaluate(element => element === document.activeElement), 'inspection must preserve list focus');
    assert.equal(await page.locator('#atlas-inspector').getAttribute('data-frame-id'), frame);

    const stepControl = layer === 'reviewed' ? '#atlas-next' : '#atlas-previous';
    await tabTo(page, stepControl, 'Shift+Tab');
    await page.keyboard.press('Enter');
    await page.waitForFunction(previous => {
      const next = document.querySelector('#atlas-frame-label')?.dataset.frameId;
      return next && next !== previous && !document.querySelector('#atlas-status')?.textContent;
    }, frame, { timeout: 30000 });
    assert(await page.locator(stepControl).evaluate(element => element === document.activeElement),
      'a committed frame update must preserve the active time control');
    const nextFrame = await page.locator('#atlas-frame-label').getAttribute('data-frame-id');
    const firstNeighbor = page.locator('.atlas-candidate-list button').first();
    const target = await firstNeighbor.boundingBox();
    assert(target && target.width >= 44 && target.height >= 44, 'list selection needs a 44px touch target');
    await firstNeighbor.tap();
    await page.locator(`#atlas-inspector ${evidenceSelector}`).first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('#atlas-inspector').getAttribute('data-frame-id'), nextFrame);
    assert.equal(await page.evaluate(() => window.atlasTestAnimationCalls), 0,
      'reduced motion must suppress accepted-frame Web Animations');
    const activeAnimations = await page.evaluate(() => document.getAnimations().filter(animation =>
      animation.playState === 'running').length);
    assert.equal(activeAnimations, 0, 'reduced motion must suppress active CSS animations');
    report.checks.push({ name: `${layer}-keyboard-touch-reduced-motion-without-webgl`, passed: true,
      viewport: { width: 390, height: 844 }, capabilities,
      keyboard_reached_list: true, focus_preserved_on_inspection: true,
      focus_preserved_on_frame_change: true, selected_touch_target: target,
      reduced_motion_animation_calls: 0, list_frame_id: frame, changed_frame_id: nextFrame,
      limitation: 'emulated touch and reduced motion; not a physical-device or screen-reader audit' });
  } finally {
    await context.close();
  }
}

module.exports = { verifyAccessibleAtlas };
