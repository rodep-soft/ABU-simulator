const { chromium } = require('C:/Users/sasah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = process.env.ROBO_QA_DIR ? path.resolve(process.env.ROBO_QA_DIR) : path.join(root, 'results/field-sim-qa');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(filename)] || 'text/plain');
  fs.createReadStream(filename).pipe(response);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/field-simulator.html`);
    await page.waitForFunction(() => window.fieldApp?.sim.robots.length === 4);
    assert.equal(await page.locator('#red-score').textContent(), '0');
    assert.ok(await page.locator('svg.lucide').count() > 10);
    assert.equal(await page.locator('#red-tr-plan option').count(), 5);
    assert.equal(await page.locator('#red-br-plan option').count(), 10);
    assert.equal(await page.locator('#rate').inputValue(), '3');
    assert.equal(await page.locator('#scan-seconds').inputValue(), '1');
    for (const team of ['red', 'blue']) assert.equal(await page.locator(`#${team}-br-plan`).inputValue(), 'efficient');
    assert.match(await page.locator('#red-strategy-summary').textContent(), /TR 必要量補給/);
    await page.screenshot({ path: path.join(output, 'desktop-start.png'), fullPage: true });
    await page.locator('#auto').uncheck();
    await page.locator('#destination').selectOption('pillar');
    await page.locator('#move').click();
    assert.match(await page.locator('#feedback').textContent(), /置けません/);
    await page.locator('#reset').click();
    await page.locator('#play').click();
    await page.waitForFunction(() => fieldApp.sim.time >= 8);
    await page.locator('#play').click();
    assert.ok(await page.evaluate(() => fieldApp.sim.robots.some(r => r.y < 10)));
    await page.locator('#stop-robot').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.robot('redTR').auto), false);
    await page.locator('#auto').check();
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 90000 });
    assert.equal(await page.locator('#clock').textContent(), '0:00.0');
    await page.locator('[data-tab="state"]').click();
    assert.match(await page.locator('#sanctuary-state').textContent(), /秒に.*で達成済/);
    assert.match(await page.locator('#transfer-state').textContent(), /Earth専用.*Sky専用/);
    await page.screenshot({ path: path.join(output, 'desktop-finish.png'), fullPage: true });
    await page.locator('#timeline').fill('90');
    assert.match(await page.locator('#match-state').textContent(), /リプレイ/);
    assert.ok(await page.locator('#move').isDisabled());
    await page.locator('[data-tab="operate"]').click();
    await page.locator('[data-robot="redBR"]').click();
    assert.ok(await page.locator('#br-decision').isVisible());
    assert.match(await page.locator('#decision-summary').textContent(), /配置|反転|奉納|回収|候補なし/);
    assert.match(await page.locator('#decision-horizon').textContent(), /点.*秒/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'desktop-score-search.png'), fullPage: true });
    const replayRate = await page.evaluate(async () => {
      const timeline = document.getElementById('timeline'), play = document.getElementById('play');
      const before = Number(timeline.value), start = performance.now(); play.click();
      await new Promise(resolve => setTimeout(resolve, 1000)); play.click();
      return (Number(timeline.value) - before) / ((performance.now() - start) / 1000);
    });
    assert.ok(replayRate > 2.5 && replayRate < 3.5, `replay rate ${replayRate}`);
    const pixels = await page.evaluate(() => { const data = document.getElementById('field').getContext('2d').getImageData(0, 0, document.getElementById('field').width, document.getElementById('field').height).data; const colors = new Set(); for(let i=0;i<data.length;i+=160) colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);return colors.size; });
    assert.ok(pixels > 40, `canvas only ${pixels} colors`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tab="operate"]').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'mobile-score-search.png'), fullPage: true });
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, bad: [...document.querySelectorAll('button,select,h1,dd')].filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 2).map(e => e.id || e.textContent) }));
    assert.ok(overflow.scroll <= overflow.viewport, JSON.stringify(overflow));
    assert.deepEqual(overflow.bad, []);
    await page.locator('#zoom-in').click();
    assert.equal(await page.locator('.field-wrap').evaluate(e => e.classList.contains('zoomed')), true);
    await page.locator('#zoom-out').click();
    await page.locator('#edit-strategies').click();
    assert.ok(await page.locator('#tab-strategies').isVisible());
    await page.locator('#red-tr-plan').selectOption('e3-e1s2');
    await page.locator('#blue-tr-plan').selectOption('e3-e1s2');
    assert.match(await page.locator('#strategy-status').textContent(), /未適用/);
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redTrPlan), 'adaptive');
    assert.match(await page.locator('#red-strategy-summary').textContent(), /必要量補給/);
    await page.locator('#revert-strategies').click();
    assert.equal(await page.locator('#red-tr-plan').inputValue(), 'adaptive');
    assert.equal(await page.locator('#blue-tr-plan').inputValue(), 'adaptive');
    assert.ok(await page.locator('#revert-strategies').isDisabled());
    await page.locator('#red-tr-plan').selectOption('e3-e1s2');
    await page.locator('#blue-tr-plan').selectOption('balanced');
    await page.locator('#red-br-plan').selectOption('split-seed');
    assert.match(await page.locator('#red-br-plan-details').textContent(), /Earth1段: E1\+S1/);
    assert.match(await page.locator('#red-tr-plan-details').textContent(), /Earth 3個/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'mobile-strategies.png'), fullPage: true });
    for (const width of [320, 390, 900]) {
      await page.setViewportSize({ width, height: 844 });
      const strategyOverflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth, bad: [...document.querySelectorAll('button,select,dd,.strategy-current')].filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 2).map(e => e.id || e.textContent) }));
      assert.deepEqual(strategyOverflow, { page: false, bad: [] }, `strategy layout at ${width}px`);
    }
    await page.locator('[data-tab="settings"]').click();
    await page.locator('#red-speed').selectOption('0.75');
    assert.ok(await page.evaluate(() => RoboScorePlanner.cacheInfo().geometries > 0));
    await page.locator('#apply-settings').click();
    assert.deepEqual(await page.evaluate(() => RoboScorePlanner.cacheInfo()), { geometries: 0, routes: 0 });
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redSpeed), .75);
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redTrPlan), 'adaptive');
    await page.locator('[data-tab="strategies"]').click();
    assert.equal(await page.locator('#red-tr-plan').inputValue(), 'e3-e1s2');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redTrPlan), 'e3-e1s2');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.blueTrPlan), 'balanced');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redSpeed), .75);
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), 'split-seed');
    assert.equal(await page.locator('#strategy-status').textContent(), '適用済み');
    assert.match(await page.locator('#red-strategy-summary').textContent(), /E3 → E1\+S2/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'desktop-strategies.png'), fullPage: true });
    await page.locator('[data-tab="settings"]').click();
    await page.locator('#apply-settings').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redTrPlan), 'e3-e1s2');
    await page.locator('[data-tab="operate"]').click();
    await page.locator('[data-robot="redTR"]').click();
    assert.match(await page.locator('#robot-plan').textContent(), /1便目 · E3/);
    await page.locator('#finish').click();
    await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 90000 });
    const shipments = await page.evaluate(() => fieldApp.sim.robot('redTR').transport.completed.slice(0, 2).map(d => d.items.map(o => o.type)));
    assert.deepEqual(shipments, [['earth', 'earth', 'earth'], ['earth', 'sky', 'sky']]);
    const opening = await page.evaluate(() => fieldApp.sim.events.filter(e => e.robot === 'redBR' && e.action === 'place' && e.kind === 'action').slice(0, 2).map(e => e.spotId));
    assert.deepEqual(opening, ['s2', 'r2']);
    assert.match(await page.locator('#robot-deliveries').textContent(), /1便目 E 3 · S 0/);
    await page.locator('#timeline').fill('0');
    assert.equal(await page.locator('#robot-deliveries').textContent(), 'なし');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click(); const download = await downloadPromise; await download.saveAs(path.join(output, 'export-smoke.json'));
    const exported = JSON.parse(fs.readFileSync(path.join(output, 'export-smoke.json')));
    assert.equal(exported.format, 'robocon-field-sim-v1');
    assert.equal(exported.config.redTrPlan, 'e3-e1s2');
    assert.equal(exported.config.redBrPlan, 'split-seed');
    assert.deepEqual(exported.events.filter(e => e.robot === 'redTR' && e.action === 'delivery-complete').slice(0, 2).map(e => e.delivery.items.map(o => o.type)), shipments);
    await page.goto(require('node:url').pathToFileURL(path.join(root, 'field-simulator.html')).href);
    await page.waitForFunction(() => window.fieldApp?.sim.robots.length === 4);
    await page.locator('#edit-strategies').click();
    await page.locator('#blue-tr-plan').selectOption('e3-e1s2');
    await page.locator('#blue-br-plan').selectOption('split-seed');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.blueTrPlan), 'e3-e1s2');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redTrPlan), 'adaptive');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.blueBrPlan), 'split-seed');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), 'efficient');
    await page.evaluate(() => {
      fieldApp.reset(); const s = fieldApp.sim, tr = s.robot('redTR'), br = s.robot('redBR');
      for (const r of s.robots) r.auto = false;
      Object.assign(tr, RoboField.points.red.transferTR, { z: .6, cargo: ['M'] });
      Object.assign(br, RoboField.points.red.transferBR, { z: .6, enteredL1: true });
      Object.assign(s.object('M'), { location: 'cargo', holder: tr.id, touchedBy: tr.id }); s.sanctuary.red = 0;
      for (const id of ['red-E1', 'red-E2', 'red-E3', 'S1', 'S2', 'S3', 'S4']) {
        const o = s.object(id), slot = s.freeSlot('red', o);
        Object.assign(o, { location: 'transfer', transferTeam: 'red', slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
      }
      fieldApp.selectRobot('redBR'); fieldApp.render();
    });
    await page.locator('[data-tab="state"]').click();
    assert.match(await page.locator('#transfer-state').textContent(), /TR保持・直接受渡待ち/);
    await page.screenshot({ path: path.join(output, 'mustika-direct-handoff.png'), fullPage: true });
    await page.locator('[data-tab="operate"]').click();
    await page.locator('#object-select').selectOption('M');
    assert.match(await page.locator('#object-select option:checked').textContent(), /TR保持・直接受渡/);
    await page.locator('#receive').click();
    await page.waitForFunction(() => fieldApp.sim.object('M').holder === 'redBR');
    await page.locator('#play').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.stock('red').length), 7);
    assert.match(await page.locator('#robot-cargo').textContent(), /M 1/);
    assert.doesNotMatch(await page.locator('#object-select option:checked').textContent(), /TR保持/);
    await page.evaluate(() => {
      fieldApp.reset(); const s = fieldApp.sim, r = s.robot('redBR');
      for (const robot of s.robots) robot.auto = false;
      Object.assign(r, RoboField.points.red.transferBR, { z: .6, enteredL1: true, cargo: ['S1', 'S2'] });
      for (const id of r.cargo) Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id });
      fieldApp.selectRobot('redBR'); fieldApp.render();
    });
    for (const id of ['S1', 'S2']) {
      await page.locator('#object-select').selectOption(id); await page.locator('#return').click();
      await page.waitForFunction(id => fieldApp.sim.object(id).location === 'transfer', id);
      await page.locator('#play').click();
    }
    await page.locator('[data-tab="state"]').click();
    assert.match(await page.locator('#transfer-state').textContent(), /Sky専用 2\/4/);
    assert.equal(await page.evaluate(() => fieldApp.sim.transferPoints.red), 0);
    await page.screenshot({ path: path.join(output, 'typed-return.png'), fullPage: true });
    const cancelledRun = await page.evaluate(async () => {
      fieldApp.reset(); document.getElementById('finish').click(); fieldApp.reset();
      await new Promise(resolve => setTimeout(resolve, 250));
      return { time: fieldApp.sim.time, cache: RoboScorePlanner.cacheInfo() };
    });
    assert.deepEqual(cancelledRun, { time: 0, cache: { geometries: 0, routes: 0 } });
    await page.evaluate(() => {
      fieldApp.reset();
      const s = fieldApp.sim, r = s.robot('redBR'), other = s.robot('blueBR');
      for (const robot of s.robots) robot.auto = false;
      Object.assign(r, { x: 5.1, y: 4.9, z: .9, enteredL1: true, auto: true });
      Object.assign(other, { x: 5.615, y: 4.9, z: .9, enteredL1: true });
      r.cargo = ['red-E1', 'S1'];
      for (const id of r.cargo) Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id });
      const target = { x: 5.9, y: 4.9 };
      r.job = { type: 'move', destination: target, target, route: [target] };
      s.findPath = () => null;
      for (let i = 0; i < 90; i++) s.step(.05);
      fieldApp.selectRobot('redBR'); fieldApp.render();
    });
    await page.locator('[data-tab="operate"]').click();
    assert.match(await page.locator('#robot-status').textContent(), /自動Retryまで 0.5秒/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'desktop-auto-retry-countdown.png'), fullPage: true });
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) fieldApp.sim.step(.05);
      fieldApp.render();
    });
    assert.match(await page.locator('#robot-status').textContent(), /自動Retry完了.*L1 Retryエリア/);
    assert.match(await page.locator('#robot-cargo').textContent(), /E 1.*S 1/);
    assert.equal(await page.evaluate(() => fieldApp.sim.events.find(e => e.automatic).time), 5);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'mobile-auto-retry.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const freshScan = await page.evaluate(() => {
      const s = fieldApp.sim, r = s.robot('redBR'); delete s.findPath;
      for (let i = 0; i < 600 && !r.observation; i++) s.step(.05, RoboControllers);
      fieldApp.render();
      return { at: r.observation?.at, x: r.x, y: r.y, fresh: r.scanLoaded, cargo: r.cargo };
    });
    assert.ok(freshScan.at > 5); assert.equal(freshScan.fresh, true);
    assert.equal(freshScan.x, 3.05); assert.equal(freshScan.y, 5.5); assert.deepEqual(freshScan.cargo, ['red-E1', 'S1']);
    await page.evaluate(() => fieldApp.reset(RoboSim.DEFAULTS));
    await page.locator('#edit-strategies').click();
    await page.locator('#red-mode').selectOption('mustika-fast'); await page.locator('#blue-mode').selectOption('earth-late');
    assert.equal(await page.locator('#red-tr-plan').inputValue(), 'stock-e3');
    assert.equal(await page.locator('#blue-tr-plan').inputValue(), 'stock-e3');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), 'efficient');
    await page.locator('#apply-strategies').click();
    assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), 'mustika-fast');
    assert.equal(await page.evaluate(() => fieldApp.sim.config.blueBrPlan), 'earth-late');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, 'desktop-two-modes.png'), fullPage: true });
    await page.locator('#finish').click(); await page.waitForFunction(() => fieldApp.sim.ended, null, { timeout: 90000 });
    const firstMoves = await page.evaluate(() => ['red', 'blue'].map(team => fieldApp.sim.events.filter(e => e.robot === `${team}BR` && e.kind === 'action' && e.action === 'place').slice(0, 2).map(e => e.spotId)));
    assert.deepEqual([...firstMoves[0]].sort(), ['r2', 's2']);
    assert.ok(firstMoves[1].every(id => id.startsWith('u')));
    await page.evaluate(() => {
      fieldApp.reset(); const s = fieldApp.sim, r = s.robot('blueBR');
      for (const robot of s.robots) robot.auto = false;
      Object.assign(r, RoboField.points.blue.home, { z: .6, enteredL1: true, brain: { stage: 'choose' }, auto: true });
      for (const id of ['u1', 'u2']) {
        const p = RoboField.spotById[id];
        for (let layer = 0; layer < 3; layer++) {
          const o = s.objects.find(o => o.location === 'source' && o.type === (layer < 2 ? 'earth' : 'sky') && (!o.team || o.team === 'red'));
          Object.assign(o, { location: 'spot', spotId: id, x: p.x, y: p.y, z: .9 + layer * .35, layer, placedBy: 'red', color: layer === 2 ? 'red' : null });
        }
      }
      s.changed(); s.time = 150; s.observe(r); r.scanLoaded = true; r.batchRemaining = RoboSim.scanBudget(r);
      s.step(.05, RoboControllers); fieldApp.selectRobot('blueBR'); fieldApp.render();
    });
    await page.locator('[data-tab="operate"]').click();
    assert.equal(await page.locator('#pending-work li').count(), 2);
    assert.match(await page.locator('#pending-work').textContent(), /L2左上.*Sky反転/);
    assert.match(await page.locator('#robot-phase').textContent(), /終盤/);
    await page.screenshot({ path: path.join(output, 'desktop-flip-queue.png'), fullPage: true });
    for (const width of [320, 390, 900]) {
      await page.setViewportSize({ width, height: 844 });
      for (const tab of ['operate', 'strategies']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth, bad: [...document.querySelectorAll('button,select,dd,.strategy-current')].filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 2).map(e => e.id || e.textContent) }));
        assert.deepEqual(overflow, { page: false, bad: [] }, `${tab} at ${width}px`);
      }
      if (width === 390) await page.screenshot({ path: path.join(output, 'mobile-two-modes.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-tab="strategies"]').click();
    for (const id of ['second-layer', 'score-adaptive', 'endgame']) {
      await page.locator('#red-mode').selectOption(id);
      await page.locator('#blue-mode').selectOption('endgame');
      await page.locator('#apply-strategies').click();
      assert.equal(await page.evaluate(() => fieldApp.sim.config.redBrPlan), id);
      assert.equal(await page.evaluate(() => fieldApp.sim.config.redTrPlan), 'stock-e3');
    }
    await page.locator('#red-mode').selectOption('score-adaptive');
    await page.locator('#apply-strategies').click();
    await page.screenshot({ path: path.join(output, 'desktop-competitive-modes.png'), fullPage: true });
    await page.evaluate(() => {
      const s = fieldApp.sim, r = s.robot('blueBR');
      for (const robot of s.robots) robot.auto = false;
      Object.assign(r, RoboField.points.blue.home, { z: .6, enteredL1: true, brain: { stage: 'choose' }, auto: true });
      const o = s.objects.find(o => o.location === 'source' && o.type === 'earth' && o.team === 'blue');
      const slot = s.freeSlot('blue', o);
      Object.assign(o, { location: 'transfer', transferTeam: 'blue', slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
      s.changed(); s.time = 150; s.observe(r); r.scanLoaded = true; r.batchRemaining = RoboSim.scanBudget(r);
      s.step(.05, RoboControllers); fieldApp.selectRobot('blueBR'); fieldApp.render();
    });
    await page.locator('[data-tab="operate"]').click();
    assert.match(await page.locator('#decision-reason').textContent(), /1個運搬/);
    assert.match(await page.locator('#decision-reason').textContent(), /観測点差/);
    assert.equal(await page.evaluate(() => fieldApp.sim.robot('blueBR').queue.filter(a => a.type === 'receive').length), 1);
    await page.screenshot({ path: path.join(output, 'desktop-endgame-single.png'), fullPage: true });
    for (const width of [320, 390, 900]) {
      await page.setViewportSize({ width, height: 844 });
      for (const tab of ['operate', 'strategies']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        const bad = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth,
          items: [...document.querySelectorAll('button,select,dd,.strategy-current')].filter(e => e.getBoundingClientRect().width && e.scrollWidth > e.clientWidth + 2).map(e => e.id || e.textContent) }));
        assert.deepEqual(bad, { page: false, items: [] }, `competitive ${tab} ${width}`);
      }
      if (width === 390) await page.screenshot({ path: path.join(output, 'mobile-competitive-modes.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', screenshots: output, canvasColors: pixels, overflow }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
