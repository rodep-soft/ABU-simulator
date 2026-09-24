const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const core = require('./case-study-core.cjs');
const root = path.resolve(__dirname, '..');
if (!isMainThread) {
  parentPort.on('message', spec => {
    try {
      const at = Date.now(), result = core.run(spec);
      parentPort.postMessage({ summary: result.summary, detail: zlib.gzipSync(JSON.stringify(result.detail)), ms: Date.now() - at });
    } catch (error) { parentPort.postMessage({ id: spec.id, error: error.stack }); }
  });
} else {
  const args = process.argv.slice(2), dir = path.resolve(args.find(a => !a.startsWith('--')) || path.join(root, 'results', 'case-study-2026-09-24'));
  const flag = (key, fallback) => Number(args.find(a => a.startsWith(`--${key}=`))?.split('=')[1] || fallback);
  const count = flag('workers', 6), limit = flag('limit', Infinity), pilot = args.includes('--pilot'), competitive = args.includes('--competitive');
  const files = ['sim/engine.js', 'sim/field.js', 'sim/controllers.js', 'sim/score-planner.js', 'sim/efficient-strategy.js', 'sim/match-strategies.js', 'sim/competitive-strategies.js', 'tools/case-study-core.cjs', 'tools/case-study-cache.cjs'];
  const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  let all = core.scenarios();
  if (competitive) all = all.filter(s => {
    const c = s.config, newer = ['second-layer', 'score-adaptive', 'endgame'], baseline = ['mustika-fast', 'earth-late'];
    return c.redTrPlan === 'stock-e3' && c.blueTrPlan === 'stock-e3' && (newer.includes(c.redBrPlan) && baseline.includes(c.blueBrPlan) || baseline.includes(c.redBrPlan) && newer.includes(c.blueBrPlan));
  });
  if (pilot) all = Array.from({ length: 16 }, (_, i) => all[Math.round(i * (all.length - 1) / 15)]);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json'), resultsPath = path.join(dir, 'matches.jsonl');
  if (fs.existsSync(manifestPath)) {
    if (!args.includes('--resume')) throw new Error('Output exists; choose a new directory or --resume.');
    const old = JSON.parse(fs.readFileSync(manifestPath));
    if (JSON.stringify(old.hashes) !== JSON.stringify(hashes) || old.pilot !== pilot || !!old.competitive !== competitive) throw new Error('Source hashes or study scope changed; do not mix runs.');
  } else fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), pilot, competitive, hashes,
    scope: competitive ? 'Three new BR policies versus two previous modes; stock-e3 TR; ordered colors; five speed pairs. Not exhaustive action search.' : 'All registered TR x BR pairs, ordered red/blue pairs, speed pairs 1:1, 3/4:1, 1:3/4, 1/2:1, 1:1/2. Not exhaustive action search.',
    total: all.length, dt: .05, duration: 180, profiles: core.profiles(), scenarios: all,
    timelineColumns: ['time', 'redScore', 'blueScore', 'redTransfer', 'blueTransfer', 'redMustika', 'blueMustika', 'redSecureFloor', 'blueOptimisticCeiling', 'blueSecureFloor', 'redOptimisticCeiling'],
    guaranteeAssumptions: 'Model only; preserve own valid Earth, private Sky and enshrined Mustika. Shared Sky discarded. Opponent given unlimited material, zero travel/scan and a free ongoing action. Unsupported actions, interference, tipping and referee discretion excluded.',
  }, null, 2));
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  const finished = new Set(fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).id) : []);
  const queue = all.filter(s => !finished.has(s.id)).slice(0, limit), total = queue.length, started = Date.now();
  let next = 0, done = 0, errors = 0, lastPrint = 0; const workers = [];
  const status = () => ({ completed: finished.size + done, target: all.length, thisRun: done, errors, workers: count,
    elapsedSeconds: Math.round((Date.now() - started) / 1000), etaMinutes: done ? Math.round((total - done) * (Date.now() - started) / done / 60000) : null });
  function dispatch(worker) {
    if (next < queue.length) worker.postMessage(queue[next++]);
    else worker.terminate();
  }
  for (let i = 0; i < Math.min(count, total); i++) {
    const worker = new Worker(__filename); workers.push(worker);
    worker.on('message', result => {
      if (result.error) { errors++; fs.appendFileSync(path.join(dir, 'errors.jsonl'), JSON.stringify(result) + '\n'); }
      else {
        fs.writeFileSync(path.join(dir, 'logs', `${result.summary.id}.json.gz`), result.detail);
        fs.appendFileSync(resultsPath, JSON.stringify({ ...result.summary, wallMs: result.ms }) + '\n');
      }
      done++;
      fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(status(), null, 2));
      if (Date.now() - lastPrint > 30000 || done === total) { console.log(JSON.stringify(status())); lastPrint = Date.now(); }
      dispatch(worker);
    });
    worker.on('error', error => { console.error(error); process.exitCode = 1; workers.forEach(w => w.terminate()); });
    dispatch(worker);
  }
  if (!total) console.log(JSON.stringify(status()));
}
