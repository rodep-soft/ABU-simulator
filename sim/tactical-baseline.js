(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient);
  if (typeof module === 'object') module.exports = api; else root.RoboTacticalBaseline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient) {
  'use strict';
  const ID = 'tactical-baseline-v1';
  const firstSpots = team => team === 'red' ? ['r2','s2','u3'] : ['b2','s2','u4'];
  function firstPlaced(v) {
    return !!v.brain?.tacticalBaseline?.firstPlaced || Object.values(v.observation?.towers || {}).some(t => t.some(o => o.type === 'earth' && o.placedBy === v.team));
  }
  function prepared(v) {
    // A received pickup signal never licenses an out-of-set FIRST placement.
    return firstPlaced(v) ? v : { ...v, brOpeningActive: true };
  }
  function raceActive(v) {
    return v.time < 110 && !v.observation?.sanctuary && !v.observation?.pillar?.placedBy && !v.opponentMustikaPickup;
  }
  function stepsToQualification(v, towers) {
    const rows = F.spots.filter(p => (!p.team || p.team === v.team) && Object.hasOwn(towers,p.id)
      && (!v.brOpeningActive || firstSpots(v.team).includes(p.id))).map(p => {
      const t=towers[p.id], earth=t.filter(o=>o.type==='earth'&&!o.touchedBy).length;
      return {p,steps:Math.max(0,2-earth)+(t[2]?.type==='sky' && t[2].color===v.team && !t[2].touchedBy ? 0 : 1)};
    });
    let best=6;
    for(const a of rows)for(const b of rows)if(a!==b&&(!a.p.team||!b.p.team))best=Math.min(best,a.steps+b.steps);
    return best;
  }
  function rankFor(v) {
    const before=v.observation.towers, race=raceActive(v), steps=stepsToQualification(v,before);
    const other=v.team==='red'?'blue':'red';
    // Score only the proposed/observed tower through the engine's scoring rule.
    // These counterfactuals do not read the simulator's true board or score.
    const towerScore=(id,tower)=>Planner.scoreState({towers:{[id]:tower},mustika:{location:'source'}},v.team);
    const earthScore=(id,tower)=>towerScore(id,tower.filter(o=>o.type==='earth'))[v.team].tower;
    const fixedBefore=Object.fromEntries(Object.entries(before).map(([id,tower])=>[id,earthScore(id,tower)]));
    const fresh=!v.observation.visibility || v.observation.visibility.entries.opponentBR?.status==='current';
    const opponent=fresh?v.observation.opponentBR:null, remaining=180-v.time;
    return c => {
      if(!firstPlaced(v) && c.tasks.some(a=>a.spotId && !firstSpots(v.team).includes(a.spotId)))return null;
      let fixed=0,risk=0;
      for(const id of new Set(c.tasks.map(a=>a.spotId).filter(Boolean))){
        const p=F.spotById[id],tower=c.state.towers[id]||[],top=tower[2];
        fixed+=earthScore(id,tower)-(fixedBefore[id]||0);
        if(p.team||top?.type!=='sky'||top.color!==v.team)continue;
        const at=c.taskTimes[c.tasks.findLastIndex(a=>a.spotId===id)];
        // Only an observed CURRENT pose is used. Stale/unknown poses are not a radar.
        // This heuristic is a possible reply, not a prediction of enemy intent.
        if(opponent && opponent.maxSpeed>0 && opponent.placeSeconds>0){
          const approach=Math.min(...F.spotApproaches(p,v.team==='red'?'blue':'red').map(q=>S.distance(opponent,q)))/opponent.maxSpeed;
          const reply=Math.max(at,approach)+opponent.placeSeconds;
          const exposure=Math.max(0,Math.min(1,(remaining-reply)/opponent.placeSeconds));
          const scored=towerScore(id,tower),reversed=towerScore(id,tower.map((o,i)=>i===2?{...o,color:other}:o));
          const swing=(scored[v.team].tower-scored[other].tower)-(reversed[v.team].tower-reversed[other].tower);
          risk+=swing*exposure*(v.time>=140?.65:.3);
        }
      }
      const diff=c.gain-c.opponentGain;
      const progress=race ? Math.max(0,steps-stepsToQualification(v,c.state.towers))*28+(c.state.sanctuary?45:0) : 0;
      const net=diff-risk;
      const seconds=c.completeSeconds+(v.motion.scanSeconds||1);
      const consumed=v.cargo.length+c.picked.length-c.state.cargo.length;
      const utility=(net+.5*fixed+progress)/seconds+.15*consumed;
      return v.time>=150 ? [net+.35*fixed,utility,-c.completeSeconds] : [utility,progress,fixed,-c.completeSeconds];
    };
  }
  function selectPlan(input, extra={}) {
    if(!input.observation)return null;
    const v=prepared(input),rank=rankFor(v);
    const stockCurrent=!v.observation.visibility || v.observation.visibility.entries.stock?.status==='current';
    const options={efficient:true,oneSortie:true,requirePair:false,noRecover:true,orderSensitive:true,allowRefill:true,...extra,
      noPickup:!!extra.noPickup||!stockCurrent,rank};
    let selected=Planner.plan(v,options);
    // With after-work perception, only the first action is committed, then replanned.
    // Enumerate flip sequences to avoid a nearest-target-only endgame decision.
    if(!v.cargo.length){
      const flips=Planner.flipBatch(v,{...options,maxTasks:3});
      if(flips){const b=rank(flips),a=selected&&rank(selected);if(b&&(!a||b.some((x,i)=>Math.abs(x-a[i])>1e-7 && b.slice(0,i).every((y,j)=>Math.abs(y-a[j])<=1e-7) && x>a[i])))selected=flips;}
    }
    if(selected)selected.assessment={baseline:ID,race:raceActive(v),local:!selected.picked.length,rank:rank(selected),opponentPoseCurrent:!v.observation.visibility||v.observation.visibility.entries.opponentBR?.status==='current'};
    return selected;
  }
  function builder(input) {
    const v=prepared(input), local=v.brObservation?.replan==='after-work', transfer=F.points[v.team].transferBR;
    const standby={x:transfer.x,y:transfer.y-.9};
    if(local&&!v.enteredL1)return {brain:{stage:'choose',initialSupplyWait:true},actions:[{type:'move',target:standby,label:'受渡を塞がない脇で待機へ'},{type:'scan',local:true}]};
    const stockCurrent=!v.observation?.visibility || v.observation.visibility.entries.stock?.status==='current';
    let response=Efficient.builder(v,selectPlan,{preferLocalWork:!stockCurrent,skipSupplyWait:true,pursueMustika:false});
    if(local&&response.wait&&S.distance(v,transfer)<.8&&!v.cargo.some(o=>o.type==='mustika')) {
      response={brain:{...response.brain,stage:'choose'},actions:[{type:'move',target:standby,label:'TRの荷降ろし空間を空ける'},{type:'scan',local:true}],status:'受渡脇へ退避して再観測'};
    }
    // Mustika already offered/carried still has the existing mandatory handoff/enshrine priority.
    // No skip telemetry: this controller does not unlock opening areas just to optimize a route.
    return {...response,brain:{...response.brain,tacticalBaseline:{firstPlaced:firstPlaced(input)}},
      status:response.status||'戦術ベースライン · 観測に基づく計画'};
  }
  return {ID,builder,selectPlan,rankFor,firstPlaced};
});
