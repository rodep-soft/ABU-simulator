const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), study = process.argv[2] || 'results/transport-coordination-2026-10-19-final';
const prefix = study.includes('tr-useful-supply') ? 'tr-useful-supply' : study.includes('tr-logistics') ? 'tr-logistics' : 'transport-coordination';
const output = path.join(root, 'results', prefix + '-gui-' + Date.now());
const expected = JSON.parse(fs.readFileSync(path.join(root, study, 'summary.json'))).rows.find(r => r.strategy === 'private-first-short-flexible' && r.redSpeed === 1);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge', args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator-3d.html')).href);
    await page.waitForFunction(() => window.fieldApp?.scene3d?.diagnostics().calls > 0);
    await page.locator('[data-tab="strategies"]').click();
    assert.equal(await page.locator('#supply-mode').inputValue(), 'normal');
    await page.locator('#supply-mode').selectOption('normal');
    await page.locator('#blue-br-plan').selectOption('tactical-baseline-v2');
    await page.locator('#red-br-plan').selectOption('private-first-short-flexible');
    await page.locator('#apply-strategies').click();
    const config = await page.evaluate(() => fieldApp.sim.config);
    assert.equal(config.blueBrPlan, 'tactical-baseline-v2'); assert.equal(config.redTrPlan, 'adaptive'); assert.equal(config.blueTrPlan, 'adaptive');
    assert.equal(config.brObservationMode, 'stopped'); assert.equal(config.redSpeed, 1);
    await page.locator('#finish').click(); await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const result = await page.evaluate(() => ({ scores: fieldApp.sim.scores(),
      upperRefusals: fieldApp.sim.events.filter(e => e.action === 'receive' && e.kind === 'physical' && e.text.includes('上の物体')),
      enshrine: fieldApp.sim.events.find(e => e.robot === 'redBR' && e.action === 'enshrine' && e.kind === 'action')?.time }));
    assert.deepEqual(result.scores, expected.scores); assert.equal(result.enshrine, expected.enshrine); assert.deepEqual(result.upperRefusals, []);
    const parity = await page.evaluate(() => {
      const sim = new RoboSim.Simulation(fieldApp.sim.config); while (!sim.ended) sim.step(.05, RoboControllers);
      return { scores: JSON.stringify(sim.scores()) === JSON.stringify(fieldApp.sim.scores()),
        events: JSON.stringify(sim.events) === JSON.stringify(fieldApp.sim.events), state: JSON.stringify(sim.snapshot()) === JSON.stringify(fieldApp.sim.snapshot()) };
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
    await page.locator('#timeline').fill('74'); assert.match(await page.locator('#match-state').textContent(), /リプレイ/);
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#camera-fit').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, 'mobile-replay.png') });
    await page.locator('#view-2d').click(); await page.locator('#timeline').fill('180'); await page.locator('[data-tab="review"]').click();
    await page.locator('#review-towers button').first().click(); await page.locator('#review-flip').click();
    assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    await page.locator('#review-reset').click(); assert.equal(await page.evaluate(() => JSON.stringify(fieldApp.sim.snapshot())), original);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ config, result, parity, pixels, errors }, null, 2));
    console.log(JSON.stringify({ output, result, parity, pixels, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
