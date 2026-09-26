const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'results', `br-stops-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ROBO_BROWSER_CHANNEL ? { channel: process.env.ROBO_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    assert.equal(await page.evaluate(() => fieldApp.sim.config.brObservationMode), 'stopped');
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#supply-mode').selectOption('ideal');
    await page.locator('#red-mode').selectOption('mustika-fast');
    await page.locator('#blue-mode').selectOption('earth-late');
    for (const team of ['red', 'blue']) {
      await page.locator(`#${team}-add-turn`).click();
      assert.equal(await page.locator(`#${team}-br-turn-0`).inputValue(), 'specified');
      assert.equal(await page.locator(`#${team}-br-box-0-0`).isVisible(), true);
      assert.equal(await page.locator(`#${team}-br-target-0-1`).isVisible(), true);
    }
    await page.locator('#red-add-turn').click();
    assert.equal(await page.locator('#red-br-box-1-1').inputValue(), 'earth');
    await page.locator('#red-br-box-1-1').selectOption('sky');
    await page.locator('#red-br-target-1-1').selectOption('s2');
    await page.locator('#blue-br-target-0-0').selectOption('u4');
    await page.locator('#blue-br-box-0-1').selectOption('none');
    assert.equal(await page.locator('#blue-br-target-0-1').isDisabled(), true);
    assert.equal(await page.locator('#red-br-target-0-0 option[value="b1"]').count(), 0);
    assert.equal(await page.locator('#blue-br-target-0-0 option[value="r2"]').count(), 0);
    const numbering = { s2: 1, r2: 2, r1: 3, s1: 4, b1: 5, b2: 6, u3: 7, u1: 8, u2: 9, u4: 10 };
    assert.deepEqual(await page.evaluate(() => RoboField.spotNumbers), numbering);
    for (const team of ['red', 'blue']) {
      const choices = await page.locator(`#${team}-br-target-0-0 option`).evaluateAll(options => options.map(o => ({ id: o.value, text: o.textContent })));
      for (const choice of choices) assert.ok(choice.text.startsWith(`${numbering[choice.id]} · `), JSON.stringify(choice));
    }
    await page.locator('#red-br-turns [data-turn-action="up"]').nth(1).click();
    assert.equal(await page.locator('#red-br-box-0-1').inputValue(), 'sky');
    await page.locator('#red-br-turns [data-turn-action="down"]').first().click();
    await page.locator('#apply-strategies').click();
    const config = await page.evaluate(() => fieldApp.sim.config);
    assert.deepEqual(config.redBrTurns[0].slots, [{ type: 'earth', spotId: 's2' }, { type: 'earth', spotId: 'r2' }]);
    assert.deepEqual(config.redBrTurns[1].slots, [{ type: 'earth', spotId: 's2' }, { type: 'sky', spotId: 's2' }]);
    assert.equal(config.blueBrTurns[0].slots[1].type, 'none');
    assert.match(await page.locator('#red-strategy-summary').textContent(), /E → 1/);
    await page.locator('#red-br-box-0-0').selectOption('none');
    await page.locator('#red-br-box-0-1').selectOption('none');
    assert.equal(await page.locator('#apply-strategies').isDisabled(), true);
    assert.match(await page.locator('#strategy-status').textContent(), /赤BR 1回目/);
    await page.locator('#revert-strategies').click();
    assert.equal(await page.locator('#red-br-box-0-0').inputValue(), 'earth');
    await page.locator('#red-br-turns [data-turn-action="remove"]').nth(1).click();
    await page.locator('#revert-strategies').click();
    assert.equal(await page.locator('#red-br-box-1-1').inputValue(), 'sky');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      const layout = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth,
        rows: [...document.querySelectorAll('.br-turn-row,.br-slot')].every(e => e.scrollWidth <= e.clientWidth + 1) }));
      assert.ok(layout.page <= width + 1 && layout.rows, JSON.stringify(layout));
      await page.locator('#red-br-turns').screenshot({ path: path.join(output, `turns-${width}.png`) });
      await page.locator('#red-br-turns').locator('..').screenshot({ path: path.join(output, `editor-${width}.png`) });
      await page.locator('.field-panel').screenshot({ path: path.join(output, `field-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => ({ time: fieldApp.sim.time, scores: fieldApp.sim.scores(),
      redPlaces: fieldApp.sim.events.filter(e => e.robot === 'redBR' && e.action === 'place' && e.kind === 'action').map(e => e.spotId),
      initialScans: ['red', 'blue'].map(team => fieldApp.sim.events.find(e => e.robot === `${team}BR` && e.action === 'scan')),
      scans: fieldApp.sim.events.filter(e => e.action === 'scan' && e.kind === 'action').length }));
    assert.equal(result.time, 180); assert.deepEqual(result.redPlaces.slice(0, 4), ['s2', 'r2', 's2', 's2']);
    assert.deepEqual(result.initialScans.map(e => e.origin), [{ x: 3.7, y: 6.8 }, { x: 7.3, y: 6.8 }]);
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.export()));
    await page.locator('#review-toggle').click();
    await page.locator('#review-towers button').first().click(); await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.export())), original);
    await page.locator('#review-exit').click();
    await page.locator('#timeline').fill('20');
    await page.locator('[data-tab="operate"]').click();
    await page.locator('[data-robot="redBR"]').click();
    assert.match(await page.locator('#br-manifest').textContent(), /1回目: E → 1/);
    await page.locator('#reset').click();
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#br-observation-mode').selectOption('fixed');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.brObservationMode), 'fixed');
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redBrTurns), config.redBrTurns);
    await page.locator('#br-observation-mode').selectOption('stopped'); await page.locator('#apply-strategies').click();
    const pixels = await page.evaluate(() => {
      const canvas = document.getElementById('field'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
      for (let i = 0; i < data.length; i += 160) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    });
    assert.ok(pixels > 40); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result, pixels, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, output, result }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
