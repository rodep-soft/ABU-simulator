const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), args = process.argv.slice(2);
const output = args[0] ? path.resolve(args[0]) : path.join(root, 'results', 'gui-render-performance-' + Date.now());
if (fs.existsSync(output)) throw new Error('Output directory already exists');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge',
    args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], results = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const view of ['2d', '3d']) {
      await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href + '?view=' + view);
      await page.waitForFunction(() => window.fieldApp?.sim);
      if (view === '3d') await page.waitForFunction(() => fieldApp.scene3d?.diagnostics().calls > 0);
      const measured = await page.evaluate(() => {
        const before = JSON.stringify(fieldApp.sim.export()), times = [], mutations = {};
        const observers = ['tower-state', 'event-log', 'action-history', 'robots'].map(id => {
          mutations[id] = 0; const o = new MutationObserver(records => { mutations[id] += records.length; });
          o.observe(document.getElementById(id), { childList: true, subtree: true }); return { id, o };
        });
        for (let i = 0; i < 50; i++) {
          const start = performance.now(); fieldApp.render(); document.getElementById('clock').getBoundingClientRect(); times.push(performance.now() - start);
        }
        observers.forEach(({ id, o }) => { mutations[id] += o.takeRecords().length; o.disconnect(); });
        const sorted = times.sort((a, b) => a - b);
        return { medianMs: sorted[25], p95Ms: sorted[47], maxMs: sorted[49], mutations,
          immutable: before === JSON.stringify(fieldApp.sim.export()) };
      });
      assert.ok(measured.immutable); assert.equal(measured.mutations['tower-state'], 0); assert.equal(measured.mutations.robots, 0);
      results.push({ view, ...measured });
      await page.locator('[data-tab="state"]').click();
      assert.equal(await page.locator('#tower-state .tower-row').count(), 10);
      await page.locator('[data-tab="sequence"]').click();
      assert.ok(await page.locator('#action-history tr').count() === 0);
      await page.locator('[data-tab="operate"]').click();
      for (let i = 0; i < 8; i++) await page.locator('#step').click();
      await page.locator('[data-tab="log"]').click();
      const endLog = await page.locator('#event-log').textContent();
      assert.ok((await page.locator('#event-log li').count()) > 1);
      const saved = await page.evaluate(() => JSON.stringify(fieldApp.sim.export()));
      await page.locator('#timeline').evaluate(e => { e.value = '2'; e.dispatchEvent(new Event('input')); });
      assert.notEqual(await page.locator('#event-log').textContent(), endLog);
      await page.locator('#timeline').evaluate(e => { e.value = String(fieldApp.sim.time); e.dispatchEvent(new Event('input')); });
      assert.equal(await page.locator('#event-log').textContent(), endLog);
      assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.export())), saved);
      await page.locator('[data-tab="sequence"]').click();
      assert.equal(await page.locator('#action-history tr').count(), await page.evaluate(() => fieldApp.sim.events.filter(e => e.kind === 'timing').slice(-24).length));
      assert.ok((await page.locator('#action-history tr').count()) > 0);
      const historyReuse = await page.evaluate(() => {
        const table = document.getElementById('action-history'), first = table.firstChild;
        const count = fieldApp.sim.events.filter(e => e.kind === 'timing').length;
        fieldApp.sim.step(.05, RoboControllers); fieldApp.render();
        return { timingUnchanged: count === fieldApp.sim.events.filter(e => e.kind === 'timing').length, reused: first === table.firstChild };
      });
      assert.deepEqual(historyReuse, { timingUnchanged: true, reused: true });
      await page.screenshot({ path: path.join(output, view + '.png') });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'measurement.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ output, results, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
