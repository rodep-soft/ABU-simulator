const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'results', 'normal-blue-baseline-gui-' + Date.now());
fs.mkdirSync(output, { recursive: true });
const expected = { supplyMode: 'normal', blueBrPlan: 'private-first-short', redBrPlan: 'efficient',
  redTrPlan: 'adaptive', blueTrPlan: 'adaptive', brObservationMode: 'stopped' };
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge', args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    page.setDefaultTimeout(120000);
    const errors = [], initial = []; page.on('pageerror', e => errors.push(e.message));
    async function defaults() {
      const config = await page.evaluate(() => fieldApp.sim.config);
      for (const [key, value] of Object.entries(expected)) assert.equal(config[key], value, key);
      for (const key of ['redTrTrips', 'blueTrTrips', 'redBrTurns', 'blueBrTurns']) assert.deepEqual(config[key], []);
      assert.equal(config.trMustikaPickupSignal || 'off', 'off');
      assert.equal(await page.locator('#supply-mode').inputValue(), 'normal');
      assert.equal(await page.locator('#blue-br-plan').inputValue(), 'private-first-short');
      assert.equal(await page.evaluate(() => fieldApp.sim.time), 0);
      assert.deepEqual(await page.evaluate(() => ['red', 'blue'].map(t => fieldApp.sim.stock(t).length)), [0, 0]);
      return config;
    }
    for (const file of ['field-simulator.html', 'field-simulator-3d.html']) {
      await page.goto(pathToFileURL(path.join(root, file)).href);
      await page.waitForFunction(() => window.fieldApp?.sim);
      await page.locator('[data-tab="strategies"]').click();
      initial.push(await defaults());
      assert.match(await page.locator('#blue-br-plan-details').textContent(), /6番/);
      await page.locator('#reset').click(); await defaults();
      if (file === 'field-simulator.html') {
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await page.locator('[data-tab="strategies"]').click();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.locator('#blue-br-plan').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `defaults-${width}.png`) });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('#supply-mode').selectOption('ideal');
        await page.locator('#blue-br-plan').selectOption('tactical-baseline-v2');
        await page.locator('#apply-strategies').click();
        await page.locator('#reset').click();
        assert.equal(await page.locator('#supply-mode').inputValue(), 'ideal');
        assert.equal(await page.locator('#blue-br-plan').inputValue(), 'tactical-baseline-v2');
        await page.reload(); await page.waitForFunction(() => window.fieldApp?.sim); await defaults();
      }
    }
    assert.deepEqual(initial[0], initial[1]);
    await page.waitForFunction(() => fieldApp.scene3d?.diagnostics().calls > 0);
    await page.locator('#finish').click(); await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => ({ time: fieldApp.sim.time, config: fieldApp.sim.config, scores: fieldApp.sim.scores(),
      blueFirstPlace: fieldApp.sim.events.find(e => e.kind === 'action' && e.robot === 'blueBR' && e.action === 'place')?.spotId,
      bluePhases: [...new Set(fieldApp.sim.events.filter(e => e.robot === 'blueBR' && e.decision?.privateFirst).map(e => e.decision.privateFirst.phase))],
      deliveries: Object.fromEntries(['red', 'blue'].map(t => [t, fieldApp.sim.events.filter(e => e.kind === 'action' && e.robot === t + 'TR' && e.action === 'unload').length])),
      idealSupplies: fieldApp.sim.events.filter(e => e.action === 'ideal-supply').length,
      capacityOK: fieldApp.sim.robots.every(r => RoboSim.blockCount(r.cargo, id => fieldApp.sim.object(id)) <= (r.role === 'BR' ? 2 : 3)) }));
    assert.equal(result.time, 180); assert.equal(result.blueFirstPlace, 'b2'); assert.ok(result.bluePhases.length);
    assert.ok(result.deliveries.red > 0 && result.deliveries.blue > 0); assert.equal(result.idealSupplies, 0); assert.ok(result.capacityOK);
    const parity = await page.evaluate(() => {
      const plain = new RoboSim.Simulation(fieldApp.sim.config); while (!plain.ended) plain.step(.05, RoboControllers);
      return { scores: JSON.stringify(plain.scores()) === JSON.stringify(fieldApp.sim.scores()), events: JSON.stringify(plain.events) === JSON.stringify(fieldApp.sim.events),
        state: JSON.stringify(plain.snapshot()) === JSON.stringify(fieldApp.sim.snapshot()) };
    });
    assert.deepEqual(parity, { scores: true, events: true, state: true });
    await page.locator('#panel-close').click(); await page.screenshot({ path: path.join(output, 'default-match.png') });
    await page.locator('#reset').click(); await defaults(); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ initial, result, parity, errors }, null, 2));
    console.log(JSON.stringify({ output, result, parity, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
