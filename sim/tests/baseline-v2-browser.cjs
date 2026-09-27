const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'results', `baseline-v2-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ROBO_BROWSER_CHANNEL ? { channel: process.env.ROBO_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], matches = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.locator('[data-tab="strategies"]').click();
    assert.equal(await page.locator('#supply-mode').inputValue(), 'ideal');
    assert.equal(await page.locator('#blue-br-plan').inputValue(), 'tactical-baseline-v2');
    assert.equal(await page.locator('#red-br-plan').inputValue(), 'efficient');
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.supplyMode), 'ideal');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.blueBrPlan), 'tactical-baseline-v2');
    for (const team of ['red', 'blue']) await page.locator(`#${team}-br-plan`).selectOption('tactical-baseline-v2');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.brObservationMode), 'stopped');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.supplyMode), 'ideal');
    await page.locator('#supply-mode').selectOption('normal');
    await page.locator('#apply-strategies').click();
    for (const team of ['red', 'blue']) {
      await page.locator(`#${team}-add-trip`).click();
      await page.locator(`#${team}-tr-trip-0-2`).selectOption('sky');
      await page.locator(`#${team}-add-turn`).click();
      await page.locator(`#${team}-br-turn-0`).selectOption('tactical-baseline-v2');
    }
    await page.locator('#br-observation-mode').selectOption('level-radius');
    await page.locator('#mustika-pickup-signal').selectOption('global-instant');
    await page.locator('#apply-strategies').click();
    const config = await page.evaluate(() => fieldApp.sim.config);
    assert.deepEqual(config.brObservation, { model: 'level-radius', crossLevelRadius: 3, replan: 'after-work' });
    assert.equal(config.trMustikaPickupSignal, 'global-instant');
    assert.deepEqual(config.redTrTrips, [['earth', 'earth', 'sky']]);
    assert.deepEqual(config.redBrTurns, ['tactical-baseline-v2']);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `strategies-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const supply of ['normal', 'ideal']) {
      await page.locator('[data-tab="strategies"]').click();
      await page.locator('#supply-mode').selectOption(supply);
      await page.locator('#apply-strategies').click();
      await page.locator('#finish').click();
      await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
      const result = await page.evaluate(() => {
        const s = fieldApp.sim;
        return { supply: s.config.supplyMode, time: s.time, scores: s.scores(),
          transferPoints: s.transferPoints,
          placements: ['red', 'blue'].map(team => s.events.filter(e => e.robot === team + 'BR' && e.kind === 'action' && e.action === 'place').map(e => e.spotId)),
          policyErrors: s.events.filter(e => e.kind === 'policy'),
          scans: s.events.filter(e => e.kind === 'action' && e.action === 'scan').length,
          capacityOK: s.robots.every(r => RoboSim.blockCount(r.cargo, id => s.object(id)) <= (r.role === 'BR' ? 2 : 3)) };
      });
      assert.equal(result.time, 180); assert.equal(result.capacityOK, true);
      assert.deepEqual(result.policyErrors, []); assert.ok(result.scans > 0);
      assert.ok(['s2', 'r2', 'u3'].includes(result.placements[0][0]));
      assert.ok(['s2', 'b2', 'u4'].includes(result.placements[1][0]));
      if (supply === 'ideal') assert.deepEqual(result.transferPoints, { red: 0, blue: 0 });
      matches.push(result);
      const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.export()));
      await page.locator('#review-toggle').click();
      await page.locator('#review-towers button').first().click();
      await page.locator('#review-flip').click();
      assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.export())), original);
      await page.screenshot({ path: path.join(output, `review-${supply}.png`), fullPage: true });
      await page.locator('#review-exit').click();
      await page.locator('#timeline').fill('20');
      await page.locator('#reset').click();
      assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redTrTrips), config.redTrTrips);
      assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redBrTurns), config.redBrTurns);
    }
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#br-observation-mode').selectOption('after-work');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.brObservation.model), 'ideal');
    await page.locator('#br-observation-mode').selectOption('stopped');
    await page.locator('#mustika-pickup-signal').selectOption('off');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.brObservation), undefined);
    const pixels = await page.evaluate(() => {
      const canvas = document.getElementById('field'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
      for (let i = 0; i < data.length; i += 160) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    });
    assert.ok(pixels > 40); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ matches, pixels, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, output, matches }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
