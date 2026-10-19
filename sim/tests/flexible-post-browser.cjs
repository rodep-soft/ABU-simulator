const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'results', 'flexible-post-gui-' + Date.now());
const id = 'private-first-short-flexible'; fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge', args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator-3d.html')).href);
    await page.waitForFunction(() => window.fieldApp?.scene3d?.diagnostics().calls > 0);
    const oldPositions = await page.evaluate(() => fieldApp.scene3d.diagnostics().positions);
    await page.locator('#step').click(); assert.notDeepEqual(await page.evaluate(() => fieldApp.scene3d.diagnostics().positions), oldPositions);
    await page.locator('#reset').click(); await page.locator('[data-tab="strategies"]').click();
    await page.locator('#blue-br-plan').selectOption('tactical-baseline-v2');
    await page.locator('#supply-mode').selectOption('ideal');
    assert.equal(await page.locator('#red-br-plan option').count(), 17);
    assert.ok(await page.locator('#blue-br-plan option[value="' + id + '"]').count());
    await page.locator('#red-br-plan').selectOption(id);
    assert.match(await page.locator('#red-br-plan-details').textContent(), /①.*③/);
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), id);
    assert.equal(await page.evaluate(() => fieldApp.sim.config.blueBrPlan), 'tactical-baseline-v2');
    assert.equal(await page.locator('#supply-mode').inputValue(), 'ideal'); assert.equal(await page.locator('#br-observation-mode').inputValue(), 'stopped');
    await page.locator('#finish').click(); await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => ({ scores: fieldApp.sim.scores(), sanctuary: fieldApp.sim.sanctuary,
      phases: fieldApp.sim.events.filter(e => e.robot === 'redBR' && e.decision?.flexiblePost).map(e => ({ time: e.time, phase: e.decision.flexiblePost.phase, tasks: e.decision.tasks })),
      enshrine: fieldApp.sim.events.find(e => e.robot === 'redBR' && e.kind === 'action' && e.action === 'enshrine')?.time }));
    assert.ok(result.phases.length); assert.ok(result.phases.every(e => e.time >= result.enshrine));
    assert.equal(result.enshrine, 81.75); assert.equal(result.sanctuary.red, 51.25);
    assert.ok(result.scores.red.total > 0 && result.scores.blue.total > 0);
    const parity = await page.evaluate(() => {
      const sim = new RoboSim.Simulation(fieldApp.sim.config); while (!sim.ended) sim.step(.05, RoboControllers);
      return { scores: JSON.stringify(sim.scores()) === JSON.stringify(fieldApp.sim.scores()),
        events: JSON.stringify(sim.events) === JSON.stringify(fieldApp.sim.events),
        state: JSON.stringify(sim.snapshot()) === JSON.stringify(fieldApp.sim.snapshot()) };
    });
    assert.deepEqual(parity, { scores: true, events: true, state: true });
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot()));
    await page.locator('#panel-close').click(); await page.locator('[data-camera="top"]').click();
    const pixels = await page.evaluate(() => new Promise(resolve => {
      const img = new Image(); img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const d = ctx.getImageData(0, 0, c.width, c.height).data, colors = new Set();
        for (let i = 0; i < d.length; i += 80) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); resolve(colors.size);
      }; img.src = document.querySelector('#field-3d').toDataURL();
    }));
    assert.ok(pixels > 60); await page.screenshot({ path: path.join(output, 'desktop-result.png') });
    await page.locator('#timeline').fill('160'); assert.match(await page.locator('#match-state').textContent(), /リプレイ/);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.locator('#camera-fit').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, 'mobile-replay-' + width + '.png') });
      await page.locator('[data-tab="strategies"]').click(); await page.locator('#red-br-plan').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#red-br-plan').inputValue(), id);
      await page.screenshot({ path: path.join(output, 'mobile-selector-' + width + '.png') }); await page.locator('#panel-close').click();
    }
    await page.locator('#view-2d').click(); await page.locator('#timeline').fill('180'); await page.locator('[data-tab="review"]').click();
    await page.locator('#review-towers button').first().click(); await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    await page.locator('#review-reset').click(); assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result, parity, pixels, errors }, null, 2));
    console.log(JSON.stringify({ output, scores: result.scores, parity, pixels, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
