const crypto = require('node:crypto');
const S = require('../sim/engine.js');
const grids = new Map(), decisions = new Map();
const footprint = S.Simulation.prototype.footprintAllowed;
let installed = false;
function install() {
  if (installed) return; installed = true;
  S.Simulation.prototype.footprintAllowed = function (robot, p) {
    const x = Math.round(p.x * 10 - .5), y = Math.round(p.y * 10 - .5);
    if (x < 0 || x >= 110 || y < 0 || y >= 110 || (x + .5) / 10 !== p.x || (y + .5) / 10 !== p.y) return footprint.call(this, robot, p);
    const key = `${this.config.bodySize}:${robot.team}:${robot.role}:${robot.enteredL1}`;
    if (!grids.has(key)) grids.set(key, new Uint8Array(12100));
    const grid = grids.get(key), index = x * 110 + y;
    if (!grid[index]) grid[index] = footprint.call(this, robot, p) ? 2 : 1;
    return grid[index] === 2;
  };
}
function next(controller, view) {
  if (view.role !== 'BR' || !view.observation || ['basic', 'split-seed'].includes(view.brPlan)) return controller.next(view);
  const key = crypto.createHash('sha256').update(JSON.stringify(view)).digest('hex');
  if (!decisions.has(key)) {
    const value = JSON.stringify(controller.next(view));
    if (decisions.size >= 2048) decisions.delete(decisions.keys().next().value);
    decisions.set(key, value);
  }
  return JSON.parse(decisions.get(key));
}
function uninstall() { S.Simulation.prototype.footprintAllowed = footprint; installed = false; grids.clear(); decisions.clear(); }
module.exports = { install, next, uninstall };
