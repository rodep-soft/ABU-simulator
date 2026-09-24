(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./engine.js') : root.RoboSim);
  if (typeof module === 'object') module.exports = api;
  else root.RoboReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const editable = o => o.location === 'spot' && ['earth', 'sky'].includes(o.type);
  const owner = o => o.type === 'sky' ? o.color : o.placedBy;
  function scores(state) {
    return S.Simulation.prototype.scores.call({
      transferPoints: Object.fromEntries(['red', 'blue'].map(team => [team, state.scores[team].transfer])),
      sanctuary: state.sanctuary,
      tower: id => state.objects.filter(o => o.location === 'spot' && o.spotId === id).sort((a, b) => a.layer - b.layer),
      object: id => state.objects.find(o => o.id === id),
    });
  }
  class Review {
    constructor(final) {
      if (!final.ended || final.time !== 180) throw new Error('Review requires a finished match');
      this.original = copy(final); this.state = copy(final); this.undoStack = []; this.redoStack = [];
    }
    setColor(id, color) {
      const o = this.state.objects.find(o => o.id === id);
      if (!o || !editable(o) || !['red', 'blue'].includes(color)) throw new Error('Invalid review edit');
      if (owner(o) === color) return false;
      this.undoStack.push({ id, before: owner(o), after: color }); this.redoStack = [];
      this.apply(id, color); return true;
    }
    apply(id, color) {
      const o = this.state.objects.find(o => o.id === id);
      if (o.type === 'sky') o.color = color;
      else o.placedBy = color;
      this.state.scores = scores(this.state);
    }
    flip(id) {
      const o = this.state.objects.find(o => o.id === id);
      if (!o || !editable(o)) throw new Error('Only placed Earth or Sky can be flipped in review');
      return this.setColor(id, owner(o) === 'red' ? 'blue' : 'red');
    }
    undo() {
      const change = this.undoStack.pop(); if (!change) return;
      this.apply(change.id, change.before); this.redoStack.push(change);
    }
    redo() {
      const change = this.redoStack.pop(); if (!change) return;
      this.apply(change.id, change.after); this.undoStack.push(change);
    }
    reset() { this.state = copy(this.original); this.undoStack = []; this.redoStack = []; }
    changes() {
      return this.state.objects.filter(editable).flatMap(o => {
        const before = owner(this.original.objects.find(item => item.id === o.id));
        return before === owner(o) ? [] : [{ id: o.id, type: o.type, spotId: o.spotId, layer: o.layer, before, after: owner(o) }];
      });
    }
    snapshot() { return copy(this.state); }
    export() { return { format: 'robocon-post-match-review-v1', original: copy(this.original), hypothetical: this.snapshot(), changes: this.changes() }; }
  }
  return { Review, scores, editable, owner };
});
