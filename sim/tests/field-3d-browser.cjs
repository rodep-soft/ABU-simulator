const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'results', `field-3d-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge', args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator-3d.html')).href);
    await page.waitForFunction(() => window.fieldApp?.scene3d?.diagnostics().calls > 0);
    assert.equal(await page.evaluate(() => fieldApp.displayMode), '3d');
    await page.locator('.field-panel').screenshot({ path: path.join(output, 'desktop-start.png') });
    const immutable = await page.evaluate(() => {
      const before = JSON.stringify(fieldApp.sim.snapshot());
      fieldApp.setDisplayMode('2d'); fieldApp.setDisplayMode('3d');
      return JSON.stringify(fieldApp.sim.snapshot()) === before;
    });
    assert.equal(immutable, true);
    // Actual rendered pixels, not just an existing WebGL canvas.
    const pixels = await page.evaluate(() => new Promise(resolve => {
      const image = new Image(); image.onload = () => {
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data, colors = new Set();
        for (let i = 0; i < data.length; i += 80) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        resolve(colors.size);
      }; image.src = document.querySelector('#field-3d').toDataURL();
    }));
    assert.ok(pixels > 60, `nonblank pixels: ${pixels}`);
    const beforeCamera = await page.evaluate(() => fieldApp.scene3d.diagnostics().camera);
    const canvas = page.locator('#field-3d'), bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .6);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .65, { steps: 8 }); await page.mouse.up();
    assert.notDeepEqual(await page.evaluate(() => fieldApp.scene3d.diagnostics().camera), beforeCamera);
    await page.locator('[data-camera="top"]').click();
    const robotPoint = await page.evaluate(() => {
      const r = fieldApp.sim.robot('blueBR'); return fieldApp.scene3d.project({ x: r.x, y: r.y, z: .4 });
    });
    await page.mouse.click(robotPoint.x, robotPoint.y);
    assert.equal(await page.locator('[data-robot="blueBR"]').getAttribute('class'), 'active');
    await page.locator('#camera-follow').click(); assert.equal(await page.locator('#camera-follow').getAttribute('aria-pressed'), 'true');
    await page.locator('#camera-fit').click();
    const oldPositions = await page.evaluate(() => fieldApp.scene3d.diagnostics().positions);
    await page.locator('#step').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.time), .5);
    assert.notDeepEqual(await page.evaluate(() => fieldApp.scene3d.diagnostics().positions), oldPositions);
    await page.locator('#reset').click();
    await page.locator('[data-tab="strategies"]').click();
    assert.equal(await page.locator('#blue-br-plan').inputValue(), 'private-first-short');
    assert.equal(await page.locator('#supply-mode').inputValue(), 'normal');
    await page.locator('#red-add-turn').click();
    await page.locator('#red-br-target-0-0').selectOption('s2');
    await page.locator('#red-br-target-0-1').selectOption('r2');
    await page.locator('#apply-strategies').click();
    await page.locator('#finish').click(); await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => ({ time: fieldApp.sim.time, scores: fieldApp.sim.scores(),
      config: fieldApp.sim.config, diagnostics: fieldApp.scene3d.diagnostics(),
      places: fieldApp.sim.events.filter(e => e.kind === 'action' && e.action === 'place').length }));
    assert.equal(result.time, 180); assert.ok(result.places > 0);
    await page.locator('#timeline').fill('60');
    assert.match(await page.locator('#match-state').textContent(), /リプレイ/);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#camera-fit').click();
      await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const corners = await page.evaluate(() => [[0, 0], [11, 0], [11, 11], [0, 11]].map(([x, y]) => fieldApp.scene3d.project({ x, y, z: 0 })));
      const b = await canvas.boundingBox();
      assert.ok(corners.every(p => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height), JSON.stringify({ width, corners, b }));
      await page.locator('.field-panel').screenshot({ path: path.join(output, `replay-${width}.png`) });
      if (width === 390) {
        await page.locator('[data-camera="top"]').click();
        const tap = await page.evaluate(() => fieldApp.scene3d.project({ x: 5.5, y: 8.2, z: .65 }));
        await page.touchscreen.tap(tap.x, tap.y);
        assert.equal(await page.locator('#destination').inputValue(), 's2');
      }
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#timeline').fill('180');
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot()));
    await page.locator('#review-toggle').click();
    await page.locator('[data-camera="top"]').click();
    const block = await page.evaluate(() => {
      const t = fieldApp.sim.objects.filter(o => o.location === 'spot' && o.spotId === 'r2').sort((a, b) => b.layer - a.layer)[0];
      return { id: t.id, pixel: fieldApp.scene3d.project({ x: t.x, y: t.y, z: t.z + t.height }) };
    });
    await page.mouse.click(block.pixel.x, block.pixel.y);
    assert.equal(await page.locator(`#review-block-${block.id}`).getAttribute('aria-pressed'), 'true');
    await page.locator('#review-towers button').first().click(); await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    await page.locator('.field-panel').screenshot({ path: path.join(output, 'review.png') });
    await page.locator('#review-reset').click(); await page.locator('#review-exit').click();
    // Identical engine run with no renderer: scores, events, and final board must match.
    const parity = await page.evaluate(() => {
      const baseline = new RoboSim.Simulation(fieldApp.sim.config);
      while (!baseline.ended) baseline.step(.05, RoboControllers);
      return { scores: JSON.stringify(baseline.scores()) === JSON.stringify(fieldApp.sim.scores()),
        events: JSON.stringify(baseline.events) === JSON.stringify(fieldApp.sim.events),
        state: JSON.stringify(baseline.snapshot()) === JSON.stringify(fieldApp.sim.snapshot()) };
    });
    assert.deepEqual(parity, { scores: true, events: true, state: true });
    await page.locator('#reset').click();
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#supply-mode').selectOption('normal');
    await page.locator('#red-add-trip').click();
    await page.locator('#apply-strategies').click();
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const normal = await page.evaluate(() => ({ time: fieldApp.sim.time, supplyMode: fieldApp.sim.config.supplyMode,
      shipments: fieldApp.sim.robot('redTR').transport.completed.length, scores: fieldApp.sim.scores() }));
    assert.equal(normal.time, 180); assert.ok(normal.shipments > 0); assert.equal(normal.supplyMode, 'normal');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result, normal, pixels, parity, errors }, null, 2));
    console.log(JSON.stringify({ output, result, normal, pixels, parity, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
