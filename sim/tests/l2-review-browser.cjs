const { chromium } = require('C:/Users/sasah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), out = path.join(root, 'results/l2-review-qa');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.waitForFunction(() => window.fieldApp);
    assert.ok(await page.locator('#review-toggle').isDisabled());
    assert.ok(await page.locator('#review-tab').isDisabled());
    assert.equal(await page.locator('#destination option[value="homeL2"]').count(), 1);
    await page.screenshot({ path: path.join(out, 'l2-start-desktop.png'), fullPage: true });
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 120000 });
    const match = await page.evaluate(() => ({ scores: fieldApp.sim.scores(), l2Scans: fieldApp.sim.events.filter(e => e.action === 'scan' && e.level === 'l2').length }));
    assert.ok(match.l2Scans > 0, JSON.stringify(match));
    await page.locator('#review-toggle').click();
    assert.match(await page.locator('#match-state').textContent(), /仮想盤面/);
    assert.ok(await page.locator('#tab-review').isVisible());
    await page.screenshot({ path: path.join(out, 'review-real-match.png'), fullPage: true });
    await page.locator('#review-exit').click();
    assert.equal(await page.locator('#match-state').textContent(), '競技終了');
    await page.locator('#reset').click();
    // Deterministic final board exercises both scoring levels and all block layers.
    await page.evaluate(() => {
      const s = fieldApp.sim;
      for (const r of s.robots) r.auto = false;
      for (const id of ['s1', 'u1', 'u4', 'r2']) {
        const p = RoboField.spotById[id], team = id === 'r2' ? 'red' : 'blue';
        for (let layer = 0; layer < 3; layer++) {
          const type = layer === 2 ? 'sky' : 'earth';
          const o = s.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
          Object.assign(o, { location: 'spot', spotId: id, layer, placedBy: team, color: layer === 2 ? team : null, touchedBy: null,
            x: p.x, y: p.y, z: (p.level === 2 ? .9 : .6) + layer * .35 });
        }
      }
      s.transferPoints.red = 30; s.transferPoints.blue = 45; s.changed(); s.time = 179.95; s.step(.05); fieldApp.render();
    });
    const original = await page.evaluate(() => JSON.stringify(fieldApp.sim.export()));
    const ids = await page.evaluate(() => ({ sky: fieldApp.sim.tower('u1')[2].id, earth: fieldApp.sim.tower('u1')[1].id,
      red: fieldApp.sim.scores().red.total, blue: fieldApp.sim.scores().blue.total }));
    await page.locator('#review-tab').click();
    await page.locator(`[data-object-id="${ids.sky}"]`).click();
    assert.equal(await page.locator('#review-flip-label').textContent(), 'Sky反転');
    await page.locator('#review-flip').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red + 80);
    assert.equal(Number(await page.locator('#blue-score').textContent()), ids.blue - 80);
    await page.locator(`[data-object-id="${ids.earth}"]`).click();
    assert.ok(await page.locator('#review-flip').isEnabled());
    assert.equal(await page.locator('#review-flip-label').textContent(), 'Earth反転');
    await page.locator('#review-flip').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red + 120);
    await page.locator('#review-flip').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red + 80);
    await page.locator('#review-flip').click();
    assert.equal(await page.locator('#review-count').textContent(), '変更2個');
    await page.locator('#review-undo').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red + 80);
    await page.locator('#review-redo').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red + 120);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, 'review-edited-desktop.png'), fullPage: true });
    for (const width of [320, 390, 900]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth,
        overflow: [...document.querySelectorAll('button,select,dd,th,td,h2')].filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 2).map(e => e.id || e.textContent) }));
      assert.deepEqual(layout, { page: false, overflow: [] }, `review at ${width}`);
      if (width === 390) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(out, 'review-mobile.png'), fullPage: true });
      }
    }
    const downloadEvent = page.waitForEvent('download'); await page.locator('#review-download').click();
    const download = await downloadEvent; await download.saveAs(path.join(out, 'review-export.json'));
    const saved = JSON.parse(fs.readFileSync(path.join(out, 'review-export.json'), 'utf8'));
    assert.equal(saved.format, 'robocon-post-match-review-v1'); assert.equal(saved.changes.length, 2);
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.export())), original);
    await page.locator('#timeline').fill('0');
    assert.equal(await page.locator('#match-state').textContent(), 'リプレイ');
    assert.equal(await page.locator('#red-score').textContent(), '0');
    await page.locator('#review-toggle').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red + 120);
    await page.locator('#review-reset').click();
    assert.equal(Number(await page.locator('#red-score').textContent()), ids.red);
    assert.equal(await page.locator('#review-count').textContent(), '変更0個');
    await page.locator('#review-exit').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.export())), original);
    await page.locator('#review-toggle').click(); await page.locator('#reset').click();
    assert.ok(await page.locator('#review-tab').isDisabled());
    assert.ok(await page.locator('#tab-operate').isVisible());
    assert.equal(await page.locator('#red-score').textContent(), '0');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, match, screenshots: out }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
