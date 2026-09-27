const { chromium } = require('C:/Users/sasah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'results', `mustika-cargo-qa-${Date.now()}`);

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.waitForFunction(() => window.fieldApp?.sim);
    await page.evaluate(() => {
      const s = fieldApp.sim, br = s.robot('redBR'), tr = s.robot('redTR');
      for (const r of s.robots) r.auto = false;
      Object.assign(br, RoboField.points.red.transferBR, { z: .6, enteredL1: true, cargo: ['red-E1', 'S1'] });
      Object.assign(tr, RoboField.points.red.transferTR, { z: .6, cargo: ['M'] });
      for (const r of [br, tr]) for (const id of r.cargo) Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id });
      s.sanctuary.red = 0; s.changed(); s.capture();
      fieldApp.selectRobot(br.id); fieldApp.render();
    });
    await page.locator('#object-select').selectOption('M');
    await page.locator('#receive').click();
    await page.waitForFunction(() => fieldApp.sim.object('M').holder === 'redBR');
    await page.locator('#play').click();
    assert.equal(await page.locator('#robot-cargo').textContent(), 'E 1 · S 1 · M 1');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `mixed-cargo-${width}.png`), fullPage: true });
    }
    const result = await page.evaluate(() => {
      const s = fieldApp.sim, br = s.robot('redBR'); br.auto = true; br.brain = { stage: 'return' };
      for (let n = 0; n < 3600 && s.object('M').location !== 'pillar' && !s.ended; n++) s.step(.05, RoboControllers);
      br.auto = false; fieldApp.render();
      return { location: s.object('M').location, cargo: br.cargo, score: s.scores().red.mustika, ended: s.ended };
    });
    assert.equal(result.location, 'pillar'); assert.deepEqual(result.cargo, ['red-E1', 'S1']);
    assert.equal(result.score, 250); assert.equal(result.ended, false);
    assert.equal(await page.locator('#robot-cargo').textContent(), 'E 1 · S 1');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result, errors, widths: [1440, 390, 320] }, null, 2));
    console.log(output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
