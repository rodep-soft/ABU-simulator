const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'results', `workspace-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge', args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator-3d.html')).href);
    await page.waitForFunction(() => window.fieldApp?.scene3d?.diagnostics().calls > 0);
    const metrics = [];
    async function layout(label) {
      await page.waitForTimeout(180);
      const state = await page.evaluate(() => {
        const rect = selector => {
          const b = document.querySelector(selector).getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom, right: b.right };
        };
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight, score: rect('.matchbar'), canvas: rect(fieldApp.displayMode === '3d' ? '#field-3d' : '#field'),
          panel: rect('#inspector'), tabs: rect('.tabs'), open: document.getElementById('panel-toggle').getAttribute('aria-expanded') };
      });
      assert.ok(state.scrollWidth <= state.width + 1, JSON.stringify(state));
      assert.ok(state.scrollHeight <= state.height + 1, JSON.stringify(state));
      assert.ok(state.score.y >= 0 && state.score.bottom < state.height, JSON.stringify(state));
      assert.ok(state.canvas.height > 100 && state.canvas.width > 100, JSON.stringify(state));
      assert.ok(state.canvas.y >= state.score.bottom - 1 && state.canvas.bottom <= state.height + 1, JSON.stringify(state));
      metrics.push({ label, ...state }); return state;
    }
    const before = await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot()));
    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [768, 1024], [390, 844], [320, 640], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#camera-fit').click();
      await layout('field');
      if (!await page.locator('[data-tab="sequence"]').isVisible()) await page.locator('#panel-toggle').click();
      await page.locator('[data-tab="sequence"]').click();
      await page.locator('#program-robot').selectOption('redBR');
      if (!await page.locator('.action-row').count()) await page.locator('#program-template').click();
      const open = await layout('editor');
      await page.evaluate(() => { document.getElementById('tab-sequence').scrollTop = 100000; });
      const scrolled = await layout('editor-scrolled');
      assert.deepEqual(scrolled.score, open.score); assert.deepEqual(scrolled.canvas, open.canvas);
      assert.ok(await page.locator('#program-apply').isVisible());
      await page.screenshot({ path: path.join(output, `editor-${width}x${height}.png`) });
      await page.locator('#panel-close').click();
      const closed = await layout('closed');
      assert.ok(closed.canvas.width >= open.canvas.width);
      assert.ok(closed.canvas.height >= open.canvas.height);
      await page.screenshot({ path: path.join(output, `field-${width}x${height}.png`) });
      await page.locator('#view-2d').click(); const two = await layout('2d');
      assert.ok(Math.abs(two.canvas.width - two.canvas.height) < 1);
      await page.locator('#zoom-in').click(); await page.locator('#zoom-out').click();
      await page.locator('#view-3d').click();
    }
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), before);
    await page.setViewportSize({ width: 1440, height: 900 });
    const pixels = await page.evaluate(async () => {
      const image = new Image(); image.src = document.getElementById('field-3d').toDataURL(); await image.decode();
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data, colors = new Set();
      for (let i = 0; i < data.length; i += 80) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    });
    assert.ok(pixels > 60);
    await page.locator('#camera-fullscreen').click();
    assert.ok(await page.evaluate(() => !!document.fullscreenElement));
    await layout('fullscreen');
    await page.locator('#camera-fullscreen').click();
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
    if (!await page.locator('[data-tab="sequence"]').isVisible()) await page.locator('#panel-toggle').click();
    await page.locator('[data-tab="sequence"]').click();
    await page.locator('#program-apply').click();
    await page.locator('#next-action').click();
    await page.waitForFunction(() => !document.getElementById('next-action').disabled);
    assert.ok(await page.evaluate(() => fieldApp.sim.events.some(e => e.robot === 'redBR' && e.kind === 'timing')));
    await page.locator('#action-options-toggle').click(); await page.locator('#pause-each-action').check();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#action-options').isVisible(), false);
    await page.locator('#action-options-toggle').click(); await page.locator('#pause-each-action').uncheck(); await page.keyboard.press('Escape');
    await page.locator('#finish').click(); await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => {
      const sim = fieldApp.sim, headless = new RoboSim.Simulation(sim.config);
      while (!headless.ended) headless.step(.05, RoboControllers);
      return { scores: sim.scores(), eventsEqual: JSON.stringify(sim.events) === JSON.stringify(headless.events),
        finalEqual: JSON.stringify(sim.snapshot()) === JSON.stringify(headless.snapshot()),
        red: document.getElementById('red-score').textContent, blue: document.getElementById('blue-score').textContent,
        gap: document.getElementById('score-gap').textContent };
    });
    assert.equal(result.eventsEqual, true); assert.equal(result.finalEqual, true);
    assert.equal(Number(result.red), result.scores.red.total); assert.equal(Number(result.blue), result.scores.blue.total);
    assert.ok(await page.locator('#blue-score-change').textContent());
    await page.locator('#timeline').fill('90');
    assert.match(await page.locator('#match-state').textContent(), /リプレイ/);
    assert.ok(await page.evaluate(() => Number(document.getElementById('red-score').textContent) === fieldApp.sim.history.filter(f => f.time <= 90).at(-1).scores.red.total));
    await page.locator('#timeline').fill('180'); await page.locator('#review-toggle').click();
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot()));
    await page.locator('#review-towers button').first().click(); await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    assert.match(await page.locator('#red-score-change').getAttribute('title'), /試合終了時との差/);
    assert.match(await page.locator('#match-state').textContent(), /仮想盤面/);
    await page.screenshot({ path: path.join(output, 'review-desktop.png') });
    await page.locator('#review-reset').click(); await page.locator('#review-exit').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), result.scores.red.total);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#red-add-turn').click(); await page.locator('#red-br-target-0-0').selectOption('u1');
    // Keep editor drafts, but do not initialize or modify the completed match.
    await layout('mobile-strategy');
    await page.locator('#panel-close').click();
    await page.screenshot({ path: path.join(output, 'final-mobile.png') });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ metrics, pixels, result, errors }, null, 2));
    console.log(JSON.stringify({ output, pixels, result, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
