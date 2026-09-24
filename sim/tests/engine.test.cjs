const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, box, overlap } = require('../engine.js');
const F = require('../field.js');
const controllers = require('../controllers.js');
function world() { const s = new Simulation(); for (const r of s.robots) r.auto = false; return s; }
function at(r, p, entered = true) { Object.assign(r, p, { z: F.surface(p).z, enteredL1: r.role === 'BR' && entered }); }
function carry(s, r, ids) { r.cargo = ids; for (const id of ids) Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id }); s.changed(); }
function ready(s, r) { s.observe(r); r.scanLoaded = true; r.batchRemaining = 2; }
function tower(s, id, teams, color) {
  const spot = F.spotById[id];
  for (const [i, team] of teams.entries()) {
    const o = s.objects.find(o => o.type === 'earth' && o.team === team && o.location === 'source');
    Object.assign(o, { location: 'spot', spotId: id, layer: i, placedBy: team, x: spot.x, y: spot.y, z: (spot.level === 1 ? .6 : .9) + i * .35, touchedBy: null });
  }
  if (color) { const o = s.objects.find(o => o.type === 'sky' && o.location === 'source'); Object.assign(o, { location: 'spot', spotId: id, layer: 2, placedBy: color, color, x: spot.x, y: spot.y, z: (spot.level === 1 ? .6 : .9) + .7, touchedBy: null }); }
  s.changed();
}
function finishJob(s, r, action) { s.startJob(r, action); assert.ok(r.job, JSON.stringify(r.failure)); for (let i = 0; i < 300 && r.job; i++) s.step(.05); assert.equal(r.job, null); assert.equal(r.failure, null); }
test('F01/F02: four separate ground starts, TR outside and BR inside', () => {
  const s = world(); assert.equal(s.objects.length, 53);
  assert.deepEqual([...s.robots].sort((a,b) => a.x-b.x).map(r=>r.id), ['redTR','redBR','blueBR','blueTR']);
  for (const r of s.robots) { assert.equal(F.surface(r).type, 'ground'); assert.ok(s.footprintAllowed(r, r)); }
});
test('F03/F06/F07/F09/F11: role, footprint and side barriers', () => {
  const s = world(), tr=s.robot('redTR'), br=s.robot('redBR');
  assert.equal(s.footprintAllowed(tr, F.points.red.home), false);
  assert.equal(s.footprintAllowed(tr, {x:4.65,y:5.5}), false);
  assert.equal(s.footprintAllowed(tr, {x:5.4,y:8.8}), false);
  assert.equal(s.segmentAllowed(tr,{x:1.15,y:4},{x:1.8,y:4}), false);
  br.enteredL1=true; assert.equal(s.footprintAllowed(br,F.points.red.sky),false);
  assert.equal(s.footprintAllowed(br,{x:2.7,y:4.5}),false);
});
test('F04/F05: transfer reached via full ramp or staircase, not sideways', () => {
  const s=world(),r=s.robot('redTR');
  const path=s.findPath(r,F.points.red.transferTR);assert.ok(path?.length);
  assert.ok(path.some(p=>F.surface(p).type==='stairs'));
  at(r,{x:1.8,y:2.4}); const up=s.findPath(r,F.points.red.transferTR);
  assert.ok(up?.some(p=>F.surface(p).type==='ramp'));
  let prev={x:r.x,y:r.y};for(const p of up){assert.ok(s.segmentAllowed(r,prev,p));prev=p;}
});
test('F08/F10/F12: BR ascent and upper platform avoidance',()=>{
  const s=world(),r=s.robot('redBR'); assert.ok(s.findPath(r,F.points.red.home));
  at(r,{x:4.7,y:3.6}); const destination={x:4.7,y:7.5};
  assert.equal(s.segmentAllowed(r,r,destination),false);
  const path=s.findPath(r,destination); assert.ok(path?.length);
  let prev=r; for(const p of path){assert.ok(s.segmentAllowed(r,prev,p));prev=p;}
});

test('cached paths can return to a prior starting node without any board change', () => {
  const s = world(), r = s.robot('redBR');
  const home = F.points.red.home, shared = F.spotApproaches(F.spotById.s2, 'red')[0];
  at(r, home);
  for (let i = 0; i < 6; i++) {
    const target = i % 2 ? home : shared, path = s.findPath(r, target);
    assert.ok(path?.length, `route ${i} must remain reachable`);
    let previous = { x: r.x, y: r.y };
    for (const point of path) { assert.ok(s.segmentAllowed(r, previous, point)); previous = point; }
    at(r, target);
  }
});
test('O01/O02/O03/O04: carry capacities are checked',()=>{
  const s=world(),tr=s.robot('redTR'),br=s.robot('redBR');
  at(tr,{x:.59,y:1.35}); carry(s,tr,['red-E1','red-E2','red-E3']);
  assert.match(s.validate(tr,{type:'pickup',objectId:'red-E14'}).reason,/最大3/);
  at(br,F.points.red.transferBR);carry(s,br,['red-E4','red-E5']);
  const o=s.object('S1');Object.assign(o,{location:'transfer',transferTeam:'red',x:2.275,y:6.55,slot:'red-0',layer:0});
  assert.match(s.validate(br,{type:'receive',objectId:'S1'}).reason,/最大2/);
});
test('O05/O06: ground deposit and overhanging handover rejected',()=>{
  const s=world(),tr=s.robot('redTR'),br=s.robot('redBR');carry(s,tr,['red-E1']);
  assert.equal(s.validate(tr,{type:'unload'}).ok,false);
  at(br,F.points.red.transferBR);const o=s.object('red-E2');Object.assign(o,{location:'transfer',transferTeam:'red',x:2.49,y:6.55,slot:'red-0',layer:0});
  assert.equal(s.validate(br,{type:'receive',objectId:o.id}).rule,'6.3');
});
test('O07/O09: floor handover conserves IDs and keeps transfer points',()=>{
  const s=world(),tr=s.robot('redTR'),br=s.robot('redBR');at(tr,F.points.red.transferTR);carry(s,tr,['red-E1']);
  finishJob(s,tr,{type:'unload'});assert.equal(s.scores().red.transfer,5);assert.equal(s.stock('red').length,1);
  at(br,F.points.red.transferBR);finishJob(s,br,{type:'receive',objectId:'red-E1'});
  assert.deepEqual(br.cargo,['red-E1']);assert.equal(s.stock('red').length,0);assert.equal(s.scores().red.transfer,5);assert.equal(br.scanLoaded,false);
});
test('O10: simultaneous object claims neither duplicate nor favor array order',()=>{
  for(const reversed of [false,true]){const s=world();if(reversed)s.robots.reverse();const a=s.robot('redTR'),b=s.robot('blueTR');s.sanctuary.red=s.sanctuary.blue=0;at(a,F.points.red.mustika);at(b,F.points.blue.mustika);s.enqueue(a.id,{type:'pickup',objectId:'M'});s.enqueue(b.id,{type:'pickup',objectId:'M'});for(let i=0;i<20;i++)s.step(.05);assert.equal(s.object('M').location,'source');assert.equal(a.cargo.length+b.cargo.length,0);}
});
test('O11/O12: missing inventory and pushing fail explicitly',()=>{
  const s=world(),r=s.robot('redBR');assert.equal(s.validate(r,{type:'receive',objectId:'not-present'}).ok,false);assert.equal(s.validate(r,{type:'push'}).rule,'6.1');
});
test('O13: dropped Mustika returns to its original pillar',()=>{
  const s=world(),r=s.robot('redTR');carry(s,r,['M']);s.resetMustika();assert.equal(s.object('M').location,'source');assert.equal(r.cargo.length,0);
});
test('O15: finite transfer capacity and top-down withdrawal',()=>{
  const s=world(),r=s.robot('redTR');at(r,F.points.red.transferTR);
  for(const id of ['red-E1','red-E2','red-E3','S1','S2','S3','S4']){carry(s,r,[id]);finishJob(s,r,{type:'unload'});}
  carry(s,r,['red-E5']);assert.equal(s.freeSlot('red',s.object('red-E5')),null);
  const br=s.robot('redBR');at(br,F.points.red.transferBR);assert.match(s.validate(br,{type:'receive',objectId:'red-E1'}).reason,/上の物体/);
});
test('B01/B04/B05/B06: opponent territory and protected Earth ownership',()=>{
  const s=world(),r=s.robot('redBR');at(r,F.points.red.home);ready(s,r);
  assert.equal(s.validate(r,{type:'place',spotId:'b1'}).rule,'6.2.2');
  tower(s,'s2',['blue']);at(r,F.spotApproaches(F.spotById.s2,'red')[0]);assert.equal(s.validate(r,{type:'recover',spotId:'s2'}).ok,false);
  tower(s,'r2',['red']);at(r,F.spotApproaches(F.spotById.r2,'red')[0]);assert.equal(s.validate(r,{type:'recover',spotId:'r2'}).ok,true);
});
test('B02/B03: mixed tower scoring, flipping never changes Earth ownership',()=>{
  const s=world();tower(s,'s2',['red','blue'],'blue');assert.equal(s.scores().red.tower,10);assert.equal(s.scores().blue.tower,60);
  const r=s.robot('redBR');at(r,F.spotApproaches(F.spotById.s2,'red')[0]);ready(s,r);finishJob(s,r,{type:'flip',spotId:'s2'});
  assert.equal(s.scores().red.tower,50);assert.equal(s.scores().blue.tower,20);
});
test('B07: L2 Sky must be placed from L2',()=>{
  const s=world(),r=s.robot('redBR');tower(s,'u1',['red','red']);at(r,{x:3.65,y:4.25});carry(s,r,['S1']);ready(s,r);
  assert.equal(s.validate(r,{type:'place',spotId:'u1',objectId:'S1'}).rule,'3.5.4');
});
test('B08/B09: incomplete Earth scores; irregular placement is unscored, not disqualification',()=>{
  const s=world(),r=s.robot('redBR');tower(s,'r2',['red']);assert.equal(s.scores().red.tower,10);
  carry(s,r,['S1']);at(r,F.spotApproaches(F.spotById.r2,'red')[0]);ready(s,r);assert.equal(s.validate(r,{type:'place',spotId:'r2',objectId:'S1'}).kind,'unscored');
});
test('B10/B11/B13: ambiguous Sky, contact and lost blocks do not score',()=>{
  const s=world();tower(s,'r2',['red','red'],'red');const top=s.tower('r2').at(-1);top.color=null;assert.equal(s.scores().red.tower,30);
  top.color='red';top.touchedBy='blueBR';assert.equal(s.scores().red.tower,30);
  s.tower('r2')[1].location='removed';assert.equal(s.scores().red.tower,10);
});
test('M01/M02/M03/M04: mandate uses simultaneous completion and latches independently',()=>{
  const s=world();tower(s,'r1',['red','red'],'red');tower(s,'r2',['red','red'],'red');s.updateSanctuary();assert.equal(s.sanctuary.red,null);
  tower(s,'s2',['red','red'],'red');s.updateSanctuary();assert.equal(s.sanctuary.red,0);s.tower('s2').at(-1).color='blue';s.updateSanctuary();assert.equal(s.sanctuary.red,0);assert.equal(s.sanctuary.blue,null);
  const u=world();tower(u,'r1',['red','red'],'red');u.updateSanctuary();u.tower('r1').at(-1).color='blue';tower(u,'s2',['red','red'],'red');u.updateSanctuary();assert.equal(u.sanctuary.red,null);
});
test('M05/M06: actual mandate required and BR cannot harvest Mustika',()=>{
  const s=world(),tr=s.robot('redTR'),br=s.robot('redBR');at(tr,F.points.red.mustika);assert.equal(s.validate(tr,{type:'pickup',objectId:'M'}).rule,'4.5.1');assert.equal(s.validate(br,{type:'pickup',objectId:'M'}).ok,false);
});
test('M07/M08: enshrinement does not end match; final physical state determines score',()=>{
  const s=world(),r=s.robot('redBR');s.time=100;s.sanctuary.red=90;carry(s,r,['M']);at(r,F.points.red.pillar);ready(s,r);finishJob(s,r,{type:'enshrine'});assert.equal(s.ended,false);assert.equal(s.scores().red.mustika,250);s.resetMustika();assert.equal(s.scores().red.mustika,0);
});
test('P01/P02/P03/P04: scan after pickup authorizes one two-object batch; observation stays stale',()=>{
  const s=world(),r=s.robot('redBR');carry(s,r,['red-E1','red-E2']);at(r,F.spotApproaches(F.spotById.r2,'red')[0]);
  assert.equal(s.validate(r,{type:'place',spotId:'r2',objectId:'red-E1'}).kind,'perception');
  at(r,F.points.red.home);finishJob(s,r,{type:'scan'});const observed=JSON.stringify(r.observation);at(r,F.spotApproaches(F.spotById.r2,'red')[0]);
  finishJob(s,r,{type:'place',spotId:'r2',objectId:'red-E1'});finishJob(s,r,{type:'place',spotId:'r2',objectId:'red-E2'});assert.equal(r.batchRemaining,0);assert.equal(JSON.stringify(r.observation),observed);
});
test('P05/P06: controllers only receive isolated observations, no opponent live state',()=>{
  const s=world(),r=s.robot('redBR');ready(s,r);const v=s.view(r);assert.equal(v.robots,undefined);assert.equal(v.world,undefined);v.observation.stock.push({id:'fake'});assert.equal(r.observation.stock.length,0);
});
test('T03/T04: retry eligibility and unresolved cargo policy',()=>{
  const s=world(),r=s.robot('redBR');assert.equal(s.validate(r,{type:'retry',level:1}).ok,false);r.enteredL1=true;assert.equal(s.validate(r,{type:'retry',level:1}).ok,true);carry(s,r,['red-E1']);assert.equal(s.validate(r,{type:'retry',level:1}).kind,'unsupported');
});
test('B12: no post-buzzer completion and no extra motion',()=>{
  const s=world(),r=s.robot('redTR');at(r,F.points.red.transferTR);carry(s,r,['red-E1']);s.time=179.9;s.startJob(r,{type:'unload'});for(let i=0;i<50;i++)s.step(.05);assert.equal(s.time,180);assert.equal(s.stock('red').length,0);assert.equal(s.scores().red.transfer,0);assert.deepEqual(r.cargo,['red-E1']);
});
test('T02: acceleration scales with speed factor, while observation time stays fixed',()=>{
  const travel=[];
  for(const factor of [1,.75,.5,.25]) {const s=world();s.config.redSpeed=factor;const r=s.robot('redTR');s.enqueue(r.id,{type:'move',target:{x:.35,y:9.5}});s.step(.05);travel.push(10.65-r.y);assert.equal(s.config.scanSeconds,1);}
  for(let i=0;i<4;i++)assert.ok(Math.abs(travel[i]/travel[0]-[1,.75,.5,.25][i])<1e-6);
});
test('lost foundation does not renumber an unsupported Earth into a valid first layer',()=>{
  const s=world();tower(s,'r2',['red','red'],'red');s.tower('r2')[0].location='removed';assert.equal(s.scores().red.tower,0);
});
test('180-second continuous runs: all four speeds preserve objects, zones and capacity',()=>{
  for(const speed of [1,.75,.5,.25]){
    const s=new Simulation({redSpeed:speed});
    for(let i=0;i<3600;i++){
      s.step(.05,controllers);
      for(const r of s.robots){assert.ok(r.cargo.length<=(r.role==='TR'?3:2));assert.ok(s.footprintAllowed(r,r),`${r.id} invalid at ${s.time}`);}
    }
    assert.equal(s.time,180);assert.equal(new Set(s.objects.map(o=>o.id)).size,53);
    const held=s.robots.flatMap(r=>r.cargo);assert.equal(new Set(held).size,held.length);
    for(const o of s.objects) assert.equal(held.includes(o.id),o.location==='cargo');
      for(const team of ['red','blue'])for(const [type,limit] of Object.entries(F.stockLimits))assert.ok(s.stock(team).filter(o=>o.type===type).length<=limit);
    assert.ok(s.events.some(e=>e.action==='place'));assert.ok(s.events.some(e=>e.action==='scan'));assert.ok(s.events.every(e=>e.time<=180));
  }
});
