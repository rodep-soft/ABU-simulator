const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../action-plan.js');
const S = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const Planner = require('../score-planner.js');
function program(steps, end = 'wait') { return { enabled: true, end, steps }; }
function world(config = {}) { const s = new S.Simulation({ recordActions: true, ...config }); s.robots.forEach(r => { r.auto = false; }); return s; }
function until(s, condition, max = 100) { while (!s.ended && s.time < max && !condition()) s.step(.05, C); assert.ok(condition(), JSON.stringify(s.robots.map(r => ({ id: r.id, job: r.job?.type, program: r.program, status: r.status })))); }
function runJob(s, r, a) { s.startJob(r, a); assert.ok(r.job, JSON.stringify(r.failure)); while (r.job && !s.ended) s.step(.05); assert.equal(r.failure, null); }
function stock(s, id) { const o = s.object(id), slot = s.freeSlot('red', o); Object.assign(o, { location: 'transfer', transferTeam: 'red', holder: null, touchedBy: null, ...slot }); o.id = id; s.changed(); }
test('plans and robot times validate, clone and preserve legacy defaults when absent', () => {
  const data = { redBR: program([{ type: 'wait', seconds: 2 }]) }, times = { redBR: { place: 4, receive: .6 } };
  const s = world({ robotPrograms: data, robotTiming: times }); data.redBR.steps[0].seconds = 9; times.redBR.place = 12;
  assert.equal(s.config.robotPrograms.redBR.steps[0].seconds, 2); assert.equal(s.config.robotTiming.redBR.place, 4);
  assert.equal(P.duration(s.view(s.robot('redBR')).motion, 'place'), 4);
  assert.equal(P.duration(s.view(s.robot('redBR')).motion, 'receive'), .6);
  assert.equal(P.duration(s.view(s.robot('blueBR')).motion, 'place'), 2.5);
  assert.throws(() => world({ robotTiming: { redBR: { place: -1 } } }));
  assert.throws(() => world({ robotTiming: { redBR: { teleport: 1 } } }));
  assert.throws(() => world({ robotPrograms: { redTR: program([{ type: 'place', objectType: 'earth', spotId: 'r2' }]) } }));
  assert.throws(() => world({ robotPrograms: { redBR: program([{ type: 'move', destination: 'coordinates', target: { x: 20, y: 3 } }]) } }));
});
test('wait steps complete at their own times while both robots share one clock', () => {
  const s = world({ robotPrograms: { redBR: program([{ type: 'wait', seconds: 1 }, { type: 'wait', seconds: .5 }]), blueBR: program([{ type: 'wait', seconds: 2 }]) } });
  s.robot('redBR').auto = s.robot('blueBR').auto = true;
  until(s, () => s.robot('redBR').program?.index === 2);
  assert.equal(s.time, 1.5); assert.equal(s.robot('blueBR').program.index, 0);
  until(s, () => s.robot('blueBR').program.index === 1);
  assert.deepEqual(s.events.filter(e => e.kind === 'timing').map(e => [e.robot, e.duration]), [['redBR', 1], ['redBR', .5], ['blueBR', 2]]);
});
test('robot-specific scan, receive and place times govern actual execution, not just labels', () => {
  const s = world({ brObservationMode: 'stopped', robotTiming: { redBR: { scan: .6, receive: .4, place: 4 } } }), r = s.robot('redBR');
  Object.assign(r, F.points.red.transferBR, { enteredL1: true, z: .6 }); stock(s, 'red-E1');
  runJob(s, r, { type: 'scan' }); runJob(s, r, { type: 'receive', objectId: 'red-E1' }); runJob(s, r, { type: 'scan' });
  Object.assign(r, F.spotApproaches(F.spotById.r2, 'red')[0]);
  runJob(s, r, { type: 'place', objectId: 'red-E1', spotId: 'r2' });
  assert.deepEqual(s.events.filter(e => e.kind === 'timing').map(e => e.duration), [.6, .4, .6, 4]);
  assert.equal(s.tower('r2').length, 1);
});
test('Earth template builds both selected places with stopped and after-work observations', () => {
  for (const local of [false, true]) {
    const s = world({ supplyMode: 'ideal', brObservationMode: 'stopped', ...(local ? { brObservation: { model: 'level-radius', replan: 'after-work' } } : {}), robotPrograms: { redBR: program(P.template('redBR')) } });
    s.robot('redBR').auto = true;
    until(s, () => s.robot('redBR').program?.index === P.template('redBR').length);
    assert.deepEqual(s.events.filter(e => e.kind === 'action' && e.action === 'place').map(e => e.spotId), ['s2', 'r2']);
    assert.equal(s.robot('redBR').program.error, undefined);
    assert.equal(s.events.filter(e => e.kind === 'timing' && e.programStep !== undefined).length, P.template('redBR').length);
  }
});
test('illegal TR shortcuts stop the program at the failed step and never teleport or advance', () => {
  const s = world({ robotPrograms: { redTR: program([{ type: 'move', destination: 'coordinates', target: { x: 5, y: 5 } }, { type: 'wait', seconds: 1 }]) } }), r = s.robot('redTR'); r.auto = true;
  const pose = { x: r.x, y: r.y }; s.step(.05, C); assert.ok(r.program.error); assert.equal(r.program.index, 0);
  for (let i = 0; i < 30; i++) s.step(.05, C);
  assert.deepEqual({ x: r.x, y: r.y }, pose); assert.equal(r.program.index, 0);
});
test('live plan updates keep completed prefix immutable and reject changing an active action', () => {
  const s = world({ robotPrograms: { redTR: program([{ type: 'wait', seconds: 1 }]) } }), r = s.robot('redTR'); r.auto = true;
  s.step(.05, C); assert.throws(() => s.setRobotProgram(r.id, program([{ type: 'wait', seconds: 4 }])));
  until(s, () => r.program.index === 1);
  assert.throws(() => s.setRobotProgram(r.id, program([{ type: 'wait', seconds: 2 }])));
  s.setRobotProgram(r.id, program([{ type: 'wait', seconds: 1 }, { type: 'wait', seconds: .5 }]));
  until(s, () => r.program.index === 2); assert.equal(s.time, 1.5);
});
test('movement timing includes acceleration and changes for only the configured robot', () => {
  const durations = [];
  for (const speed of [1, 3]) {
    const s = world({ robotTiming: { redTR: { maxSpeed: speed, acceleration: speed } }, robotPrograms: { redTR: program([{ type: 'move', destination: 'coordinates', target: { x: .35, y: 9 } }]) } });
    s.robot('redTR').auto = true; until(s, () => s.robot('redTR').program?.index === 1);
    durations.push(s.events.find(e => e.kind === 'timing').duration); assert.equal(s.view(s.robot('blueTR')).motion.maxSpeed, 7);
  }
  assert.ok(durations[0] > durations[1]);
});
test('planner prices receiving and placement with the selected robot timing', () => {
  const s = world({ brObservationMode: 'stopped', robotTiming: { redBR: { receive: 3, place: 5, scan: 1 } } }), r = s.robot('redBR');
  Object.assign(r, F.points.red.transferBR, { enteredL1: true, z: .6 }); stock(s, 'red-E1'); s.observe(r); r.scanLoaded = true; r.batchRemaining = 2;
  const view = s.view(r), plan = Planner.specifiedPlan(view, [s.object('red-E1')], [{ type: 'place', objectId: 'red-E1', spotId: 'r2' }]);
  assert.ok(plan); assert.ok(plan.completeSeconds >= 9);
  assert.equal(S.actionSeconds(view.motion, 'receive'), 3); assert.equal(S.actionSeconds(view.motion, 'flip'), 2.5);
});
test('program block selection uses observed inventory and does not bypass two-box capacity', () => {
  const s = world({ supplyMode: 'ideal', brObservationMode: 'stopped', robotPrograms: { redBR: program([...P.template('redBR').slice(0, 8), { type: 'receive', objectType: 'earth' }]) } }), r = s.robot('redBR'); r.auto = true;
  until(s, () => !!r.program?.error);
  assert.equal(S.blockCount(r.cargo, id => s.object(id)), 2); assert.equal(r.program.index, 8);
  assert.match(r.program.error.reason, /最大2個/);
  const before = C.next(s.view(r)); s.object('blue-E1').location = 'removed'; s.changed(); assert.deepEqual(C.next(s.view(r)), before);
});
test('buzzer never completes an unfinished program step', () => {
  const s = world({ robotPrograms: { redBR: program([{ type: 'wait', seconds: 2 }]) } }), r = s.robot('redBR'); r.auto = true; s.time = 179;
  while (!s.ended) s.step(.05, C);
  assert.equal(r.program.index, 0); assert.equal(s.events.some(e => e.kind === 'timing'), false);
});
test('TR template actually collects accessible Earth and unloads through the legal ramp/stairs route', () => {
  for (const team of ['red', 'blue']) {
    const id = team + 'TR', s = world({ robotPrograms: { [id]: program(P.template(id)) } }); s.robot(id).auto = true;
    until(s, () => s.robot(id).program?.index === 4);
    assert.equal(s.stock(team).length, 1); assert.equal(s.transferPoints[team], 5);
    assert.equal(s.robot(id).program.error, undefined);
  }
});
test('a step duration overrides its robot setting without changing following steps', () => {
  const s = world({ brObservationMode: 'stopped', robotTiming: { redBR: { scan: 2 } }, robotPrograms: { redBR: program([{ type: 'scan', seconds: .3 }, { type: 'scan' }]) } });
  const r = s.robot('redBR'); Object.assign(r, F.points.red.brStandby, { enteredL1: true, z: .6, auto: true });
  until(s, () => r.program?.index === 2);
  assert.deepEqual(s.events.filter(e => e.kind === 'timing').map(e => e.duration), [.3, 2]);
  assert.equal(s.time, 2.3);
});
