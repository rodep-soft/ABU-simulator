(function (root) {
  'use strict';
  function create() {
    const $ = id => document.getElementById(id), compact = matchMedia('(max-width: 900px)');
    let collapsed = compact.matches, lastSim = null, previous = null, mode = null;
    function setCollapsed(value) {
      collapsed = value; document.body.classList.toggle('panel-collapsed', value);
      $('panel-toggle').setAttribute('aria-expanded', String(!value));
      for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-expanded', String(!value && button.classList.contains('active')));
      if (value && $('inspector').contains(document.activeElement)) $('panel-toggle').focus({ preventScroll: true });
    }
    $('panel-toggle').onclick = () => setCollapsed(!collapsed);
    $('panel-close').onclick = () => setCollapsed(true);
    compact.addEventListener('change', () => setCollapsed(compact.matches));
    for (const [button, panel] of [['display-options-toggle', 'display-options'], ['action-options-toggle', 'action-options']]) {
      $(button).onclick = () => { $(panel).hidden = !$(panel).hidden; $(button).setAttribute('aria-expanded', String(!$(panel).hidden)); };
    }
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      let closed = false;
      for (const [button, panel] of [['display-options-toggle', 'display-options'], ['action-options-toggle', 'action-options']]) {
        if (!$(panel).hidden) { $(panel).hidden = true; $(button).setAttribute('aria-expanded', 'false'); $(button).focus({ preventScroll: true }); closed = true; }
      }
      if (!closed && !collapsed) setCollapsed(true);
    });
    $('tab-settings').append(document.querySelector('footer'));
    setCollapsed(collapsed);
    function render(state, sim, { reviewActive, reviewBase, replay }) {
      const context = reviewActive ? 'review' : replay ? 'replay' : 'live', gap = state.scores.red.total - state.scores.blue.total;
      $('score-gap').textContent = gap === 0 ? '同点' : `${gap > 0 ? '赤' : '青'} +${Math.abs(gap)}`;
      $('score-gap').setAttribute('aria-label', `${reviewActive ? '仮想盤面' : replay ? '再生時点' : '現在'}の得点差: 赤 ${state.scores.red.total} 対 青 ${state.scores.blue.total}`);
      // Read recorded scores; do not duplicate the engine's scoring rules.
      const changes = {}, totals = { red: 0, blue: 0 };
      for (const frame of [...sim.history.filter(f => f.time <= state.time), state]) {
        for (const team of ['red', 'blue']) {
          const delta = frame.scores[team].total - totals[team];
          if (delta) changes[team] = { delta, at: frame.time };
          totals[team] = frame.scores[team].total;
        }
      }
      for (const team of ['red', 'blue']) {
        const change = reviewActive ? { delta: state.scores[team].total - reviewBase[team].total } : changes[team];
        const badge = $(`${team}-score-change`), delta = change?.delta || 0;
        badge.textContent = delta ? `${delta > 0 ? '+' : ''}${delta}` : '';
        badge.classList.toggle('negative', delta < 0);
        badge.title = reviewActive ? `試合終了時との差: ${delta}点` : change ? `直近の記録間の変化: ${delta}点（${change.at.toFixed(1)}秒の記録）` : '得点変化なし';
        const total = state.scores[team].total;
        if (lastSim === sim && mode === context && previous && total !== previous[team]) {
          const tile = $(`${team}-score`).closest('.team-score');
          tile.classList.remove('score-flash'); void tile.offsetWidth; tile.classList.add('score-flash');
        }
      }
      previous = { red: state.scores.red.total, blue: state.scores.blue.total }; lastSim = sim; mode = context;
      $('action-step-status').title = $('action-step-status').textContent;
      for (const tile of document.querySelectorAll('.robot-tile')) tile.title = tile.textContent;
    }
    return { open() { setCollapsed(false); }, render };
  }
  root.RoboWorkspaceUI = { create };
})(globalThis);
