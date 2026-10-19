const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'results', 'qualification-flip-gui-' + Date.now());
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ROBO_BROWSER_CHANNEL || 'msedge',
    args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], results = []; page.on('pageerror', e => errors.push(e.message));
    for (const fixture of [{ team: 'red', spot: 's1', full: true, view: '2d' },
      { team: 'blue', spot: 'u4', full: false, view: '3d' }]) {
      await page.goto(pathToFileURL(path.join(root, 'field-simulator.html')).href + '?view=' + fixture.view);
      await page.waitForFunction(() => window.fieldApp?.sim);
      const decision = await page.evaluate(f => {
        fieldApp.reset({ ...fieldApp.sim.config, [f.team + 'BrPlan']: 'private-first-short' });
        const sim = fieldApp.sim, br = sim.robot(f.team + 'BR'), F = RoboField;
        sim.robots.forEach(r => { r.auto = false; });
        Object.assign(br, F.points[f.team].brStandby, { enteredL1: true, z: .6, brain: { stage: 'choose' }, auto: true });
        // A controlled test fixture, never supplied to production controllers as live state.
        function seed(id, team) {
          const spot = F.spotById[id];
          for (let layer = 0; layer < 3; layer++) {
            const o = sim.objects.find(o => o.location === 'source' && o.type === (layer < 2 ? 'earth' : 'sky') && (!o.team || o.team === team));
            Object.assign(o, { location: 'spot', spotId: id, layer, x: spot.x, y: spot.y,
              z: (spot.level === 2 ? .9 : .6) + layer * .35, placedBy: team, color: layer === 2 ? team : null, touchedBy: null });
          }
        }
        seed(f.team === 'red' ? 'r2' : 'b2', f.team); seed(f.spot, f.team === 'red' ? 'blue' : 'red');
        for (const type of (f.full ? ['earth', 'sky'] : ['earth'])) {
          const o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === f.team));
          Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); br.cargo.push(o.id);
        }
        if (f.full) for (let i = 0; i < 4; i++) {
          const o = sim.objects.find(o => o.location === 'source' && o.type === 'sky');
          const slot = sim.freeSlot(f.team, o, true);
          Object.assign(o, { location: 'transfer', transferTeam: f.team, slot: slot.id, layer: slot.layer,
            x: slot.x, y: slot.y, z: slot.z, holder: null, touchedBy: null });
        }
        sim.time = 35; sim.changed(); sim.complete(br, { type: 'scan' });
        fieldApp.selectRobot(br.id); fieldApp.render();
        const response = RoboControllers.next(sim.view(br));
        return { actions: response.actions, phase: response.brain.privateFirst.phase };
      }, fixture);
      const operations = decision.actions.filter(a => ['flip', 'return', 'receive', 'place'].includes(a.type));
      assert.equal(operations[0].type, fixture.full ? 'return' : 'flip');
      if (!fixture.full) assert.equal(operations[0].spotId, fixture.spot);
      if (fixture.view === '3d') await page.waitForFunction(() => fieldApp.scene3d?.diagnostics().calls > 0);
      await page.screenshot({ path: path.join(output, fixture.team + '-before.png') });
      for (let n = 0; n < 20; n++) {
        if (await page.evaluate(team => fieldApp.sim.sanctuary[team] !== null, fixture.team)) break;
        await page.locator('#next-action').click();
        await page.waitForFunction(() => !document.getElementById('next-action').disabled);
      }
      const result = await page.evaluate(f => {
        const sim = fieldApp.sim;
        return { fixture: f, time: sim.time, qualification: sim.sanctuary[f.team], color: sim.tower(f.spot).at(-1).color,
          scores: sim.scores(), events: sim.events, cargo: sim.robot(f.team + 'BR').cargo,
          capacityOK: RoboSim.blockCount(sim.robot(f.team + 'BR').cargo, id => sim.object(id)) <= 2 };
      }, fixture);
      assert.notEqual(result.qualification, null); assert.equal(result.color, fixture.team); assert.ok(result.capacityOK);
      assert.ok(result.events.some(e => e.kind === 'action' && e.action === 'flip' && e.spotId === fixture.spot));
      assert.ok(!result.events.some(e => ['rule', 'perception', 'unsupported', 'unscored'].includes(e.kind)));
      assert.match(await page.locator('#' + fixture.team + '-mandate').textContent(), /達成済/);
      await page.screenshot({ path: path.join(output, fixture.team + '-after.png') });
      results.push({ decision, ...result });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ output, cases: results.map(r => ({ fixture: r.fixture, time: r.time, qualification: r.qualification })), errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
