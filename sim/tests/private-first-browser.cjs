const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'results', 'private-first-gui-' + Date.now());
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator-3d.html')).href);
    await page.waitForFunction(() => window.fieldApp?.scene3d?.diagnostics().calls > 0);
    await page.locator('[data-tab="strategies"]').click();
    await page.locator('#blue-br-plan').selectOption('tactical-baseline-v2');
    await page.locator('#supply-mode').selectOption('ideal');
    for (const id of ['private-first-now', 'private-first-short', 'private-first-observe']) {
      assert.ok(await page.locator('#blue-br-plan option[value="' + id + '"]').count());
      await page.locator('#red-br-plan').selectOption(id);
      assert.match(await page.locator('#red-br-plan-details').textContent(), /2番/);
      await page.locator('#apply-strategies').click();
      assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), id);
      assert.equal(await page.evaluate(() => fieldApp.sim.config.blueBrPlan), 'tactical-baseline-v2');
      assert.equal(await page.locator('#supply-mode').inputValue(), 'ideal');
      assert.equal(await page.locator('#br-observation-mode').inputValue(), 'stopped');
    }
    await page.locator('#red-br-plan').selectOption('private-first-short');
    await page.locator('#apply-strategies').click(); await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => ({ scores: fieldApp.sim.scores(), config: fieldApp.sim.config,
      sanctuary: fieldApp.sim.sanctuary, calls: fieldApp.scene3d.diagnostics().calls,
      phases: fieldApp.sim.events.filter(e => e.decision?.privateFirst).map(e => ({ at: e.time, phase: e.decision.privateFirst.phase })) }));
    assert.equal(result.scores.red.total, 570); assert.equal(result.scores.blue.total, 340);
    assert.equal(result.sanctuary.red, 51.25); assert.ok(result.calls > 0);
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot()));
    await page.locator('#panel-close').click();
    await page.screenshot({ path: path.join(output, 'desktop-result.png') });
    await page.locator('#timeline').fill('44');
    assert.match(await page.locator('#match-state').textContent(), /リプレイ/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile-opening.png') });
    await page.locator('[data-tab="strategies"]').click();
    assert.equal(await page.locator('#red-br-plan').inputValue(), 'private-first-short');
    await page.locator('#red-br-plan').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'mobile-selector.png') });
    await page.locator('#panel-close').click(); await page.locator('#view-2d').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    await page.locator('#timeline').fill('180'); await page.locator('[data-tab="review"]').click();
    await page.locator('#review-towers button').first().click(); await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result, errors }, null, 2));
    console.log(JSON.stringify({ output, scores: result.scores, sanctuary: result.sanctuary, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
