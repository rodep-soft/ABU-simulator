const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = process.env.ROBO_QA_DIR ? path.resolve(process.env.ROBO_QA_DIR) : path.join(root, 'results', `supply-trips-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ROBO_BROWSER_CHANNEL ? { channel: process.env.ROBO_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.waitForFunction(() => window.fieldApp?.sim);
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#red-mode').selectOption('mustika-fast');
    await page.locator('#blue-mode').selectOption('l2-earth');
    await page.locator('#red-add-trip').click(); await page.locator('#red-add-trip').click();
    await page.locator('#red-tr-trip-1-1').selectOption('sky'); await page.locator('#red-tr-trip-1-2').selectOption('sky');
    await page.locator('#blue-add-trip').click();
    await page.locator('#blue-tr-trip-0-1').selectOption('sky'); await page.locator('#blue-tr-trip-0-2').selectOption('none');
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redTrTrips), []);
    await page.locator('#red-tr-trips [data-trip-action="up"]').nth(1).click();
    assert.equal(await page.locator('#red-tr-trip-0-1').inputValue(), 'sky');
    await page.locator('#red-tr-trips [data-trip-action="down"]').first().click();
    assert.equal(await page.locator('#red-tr-trip-0-1').inputValue(), 'earth');
    await page.locator('#apply-strategies').click();
    const trips = await page.evaluate(() => ({ red: fieldApp.sim.config.redTrTrips, blue: fieldApp.sim.config.blueTrTrips }));
    assert.deepEqual(trips.red, [['earth', 'earth', 'earth'], ['earth', 'sky', 'sky']]);
    assert.deepEqual(trips.blue, [['earth', 'sky', 'none']]);
    assert.match(await page.locator('#red-strategy-summary').textContent(), /指定1便目 E3/);
    for (let slot = 0; slot < 3; slot++) await page.locator(`#blue-tr-trip-0-${slot}`).selectOption('none');
    assert.equal(await page.locator('#apply-strategies').isDisabled(), true);
    assert.match(await page.locator('#strategy-status').textContent(), /最低1個/);
    await page.locator('#revert-strategies').click();
    assert.equal(await page.locator('#blue-tr-trip-0-0').inputValue(), 'earth');
    await page.locator('#blue-tr-trips [data-trip-action="remove"]').click();
    assert.equal(await page.locator('#blue-tr-trips select').count(), 0);
    await page.locator('#revert-strategies').click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const layout = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth,
        rows: [...document.querySelectorAll('.tr-trip-row, .trip-cargo')].every(row => row.scrollWidth <= row.clientWidth + 1),
        selects: [...document.querySelectorAll('.trip-cargo select')].every(select => select.getBoundingClientRect().width >= 65) }));
      assert.ok(layout.page <= width + 1 && layout.rows && layout.selects, JSON.stringify(layout));
      await page.screenshot({ path: path.join(output, `trips-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#supply-mode').selectOption('ideal');
    assert.equal(await page.locator('#red-add-trip').isDisabled(), true);
    assert.equal(await page.locator('#supply-details').isVisible(), true);
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.supplyMode), 'ideal');
    assert.match(await page.locator('#supply-summary').textContent(), /補給待ちなし/);
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 180000 });
    const result = await page.evaluate(() => ({ time: fieldApp.sim.time, scores: fieldApp.sim.scores(), config: fieldApp.sim.export().config,
      supplyCount: fieldApp.sim.events.filter(e => e.action === 'ideal-supply').length,
      placedBy: [...new Set(fieldApp.sim.events.filter(e => e.action === 'place' && e.kind === 'action').map(e => e.robot))] }));
    assert.equal(result.time, 180); assert.ok(result.supplyCount >= 14); assert.deepEqual(result.placedBy.sort(), ['blueBR', 'redBR']);
    assert.equal(result.scores.red.transfer, 0); assert.equal(result.scores.blue.transfer, 0);
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.export()));
    await page.locator('#review-toggle').click();
    await page.locator('#review-towers button').first().click();
    await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.export())), original);
    await page.locator('#review-exit').click();
    await page.locator('[data-tab="state"]').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'ideal-finished.png'), fullPage: true });
    const pixels = await page.evaluate(() => {
      const canvas = document.getElementById('field'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
      for (let i = 0; i < data.length; i += 160) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    });
    assert.ok(pixels > 40);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.time), 0);
    assert.equal(await page.evaluate(() => fieldApp.sim.config.supplyMode), 'ideal');
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#supply-mode').selectOption('normal');
    assert.equal(await page.locator('#red-tr-trip-1-2').inputValue(), 'sky');
    assert.equal(await page.locator('#red-tr-trip-1-2').isDisabled(), false);
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.supplyMode), 'normal');
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redTrTrips), trips.red);
    await page.locator('#red-mode').selectOption('mustika-fast');
    assert.equal(await page.locator('#red-tr-trips select').count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result, pixels, errors, viewports: [1440, 390, 320] }, null, 2));
    console.log(JSON.stringify({ output, result, pixels, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
