const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = process.env.ROBO_QA_DIR ? path.resolve(process.env.ROBO_QA_DIR) : path.join(root, 'results', `l2-earth-turns-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ROBO_BROWSER_CHANNEL ? { channel: process.env.ROBO_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.waitForFunction(() => window.fieldApp?.sim);
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#red-mode').selectOption('l2-earth');
    assert.equal(await page.locator('#red-tr-plan').inputValue(), 'stock-e3');
    assert.equal(await page.locator('#red-br-plan').inputValue(), 'l2-earth');
    await page.locator('#red-add-turn').click(); await page.locator('#red-add-turn').click();
    await page.locator('#red-br-turn-0').selectOption('l2-earth');
    await page.locator('#red-br-turn-1').selectOption('mustika-fast');
    await page.locator('#red-br-plan').selectOption('earth-late');
    assert.equal(await page.locator('#red-br-turns [data-turn-action="up"]').first().isDisabled(), true);
    await page.locator('#red-br-turns [data-turn-action="up"]').nth(1).click();
    assert.equal(await page.locator('#red-br-turn-0').inputValue(), 'mustika-fast');
    await page.locator('#red-br-turns [data-turn-action="down"]').first().click();
    assert.equal(await page.locator('#red-br-turn-0').inputValue(), 'l2-earth');
    await page.locator('#blue-mode').selectOption('mustika-fast');
    await page.locator('#blue-add-turn').click();
    await page.locator('#blue-br-turn-0').selectOption('second-layer');
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redBrTurns), []);
    await page.locator('#apply-strategies').click();
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redBrTurns), ['l2-earth', 'mustika-fast']);
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.blueBrTurns), ['second-layer']);
    assert.match(await page.locator('#red-strategy-summary').textContent(), /1回目.*L2 Earth/);
    await page.locator('#red-add-turn').click();
    await page.locator('#revert-strategies').click();
    assert.equal(await page.locator('#red-br-turns select').count(), 2);
    await page.locator('#blue-br-turns [data-turn-action="remove"]').click();
    assert.equal(await page.locator('#blue-br-turns select').count(), 0);
    await page.locator('#revert-strategies').click();
    assert.equal(await page.locator('#blue-br-turns select').count(), 1);
    await page.screenshot({ path: path.join(output, 'desktop-strategies.png'), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth,
        rows: [...document.querySelectorAll('.br-turn-row')].every(row => row.scrollWidth <= row.clientWidth + 1) }));
      assert.ok(layout.page <= width + 1 && layout.rows, JSON.stringify(layout));
      await page.screenshot({ path: path.join(output, `strategies-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    const pixels = await page.evaluate(() => {
      const canvas = document.getElementById('field'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
      for (let i = 0; i < data.length; i += 160) colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);
      return colors.size;
    });
    assert.ok(pixels > 40);
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 120000 });
    const result = await page.evaluate(() => ({ time: fieldApp.sim.time, scores: fieldApp.sim.scores(), config: fieldApp.sim.export().config,
      turns: fieldApp.sim.events.filter(e => e.action === 'br-turn-complete') }));
    assert.equal(result.time, 180);
    for (const team of ['red', 'blue']) assert.ok(result.turns.some(e => e.robot === `${team}BR`));
    assert.equal(result.turns.find(e => e.robot === 'redBR').nextStrategy, 'mustika-fast');
    await page.locator('#timeline').fill('10');
    assert.match(await page.locator('#red-strategy-summary').textContent(), /1回目.*L2 Earth/);
    await page.locator('#timeline').fill('180');
    await page.locator('[data-tab="state"]').click();
    await page.screenshot({ path: path.join(output, 'finished-match.png'), fullPage: true });
    await page.locator('#reset').click();
    assert.match(await page.locator('#red-strategy-summary').textContent(), /1回目.*L2 Earth/);
    assert.deepEqual(await page.evaluate(() => fieldApp.sim.config.redBrTurns), ['l2-earth', 'mustika-fast']);
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#red-mode').selectOption('l2-earth');
    assert.equal(await page.locator('#red-br-turns select').count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ ...result, errors, pixels }, null, 2));
    console.log(JSON.stringify({ output, ...result.scores, completedTurns: result.turns.length, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
