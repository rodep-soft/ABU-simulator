const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'results', `tr-collision-qa-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ROBO_BROWSER_CHANNEL ? { channel: process.env.ROBO_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.evaluate(() => {
      const s = fieldApp.sim;
      s.robots.forEach(r => { r.auto = false; });
      s.objects.filter(o => o.type === 'sky').forEach(o => { o.location = 'removed'; });
      const r = s.robot('redTR'), other = s.robot('blueTR');
      Object.assign(r, { x: 5.2425, y: 9.75, z: 0, auto: true, cargo: ['red-E1'] });
      Object.assign(other, { x: 5.7575, y: 9.75, z: 0 });
      Object.assign(s.object('red-E1'), { location: 'cargo', holder: r.id, touchedBy: r.id });
      const target = { x: 5.5, y: 9.75 };
      r.job = { type: 'move', target, destination: target, route: [target] };
      s.findPath = () => null;
      for (let i = 0; i < 19; i++) s.step(.05);
      fieldApp.render();
    });
    assert.match(await page.locator('#robot-status').textContent(), /相手TRと競合/);
    const before = await page.evaluate(() => fieldApp.sim.events.filter(e => e.action === 'tr-restart').length);
    assert.equal(before, 0);
    await page.evaluate(() => { fieldApp.sim.step(.05); fieldApp.render(); });
    assert.match(await page.locator('#robot-status').textContent(), /TR競合復帰/);
    const recovery = await page.evaluate(() => ({ robot: fieldApp.sim.snapshot().robots.find(r => r.id === 'redTR'), events: fieldApp.sim.events.filter(e => e.action.startsWith('tr-restart')) }));
    assert.equal(recovery.robot.x, .35); assert.equal(recovery.robot.y, 10.65);
    assert.deepEqual(recovery.robot.cargo, ['red-E1']); assert.equal(recovery.events.at(-1).time, 1);
    await page.locator('.field-panel').screenshot({ path: path.join(output, 'restart-desktop.png') });
    await page.locator('#timeline').fill('0.5');
    assert.match(await page.locator('#robot-status').textContent(), /相手TRと競合/);
    await page.locator('#timeline').fill('1');
    assert.match(await page.locator('#robot-status').textContent(), /TR競合復帰/);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.events.filter(e => e.action === 'tr-restart').length), 0);
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 240000 });
    const match = await page.evaluate(() => ({ time: fieldApp.sim.time, scores: fieldApp.sim.scores(),
      restarts: fieldApp.sim.events.filter(e => e.action === 'tr-restart').map(e => ({ time: e.time, robot: e.robot, cargo: e.cargo })),
      afterBuzzer: fieldApp.sim.events.some(e => e.action === 'tr-restart' && e.time >= 180) }));
    assert.equal(match.time, 180); assert.equal(match.afterBuzzer, false);
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('.field-panel').screenshot({ path: path.join(output, 'match-mobile.png') });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ recovery, match, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, output, match }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
