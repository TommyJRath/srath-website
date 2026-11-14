// Anonymous global stats for the srath.dk games: send a result, get back its rank.
// The server (the SRATH relay on Cloudflare, see /relay in the website repository) stores only
// counts, such as "41 players solved today's Gridword in 3 guesses". Nothing that identifies a player.
(function () {
  'use strict';

  var root = document.querySelector('.game-root[data-relay]');
  var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  var base = local ? 'http://127.0.0.1:8787' : root ? root.getAttribute('data-relay').replace(/^ws/, 'http') : '';

  function call(path, body) {
    if (!base) return Promise.reject(new Error('no stats server'));
    var opts = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {};
    return fetch(base + path, opts).then(function (res) {
      return res.json().then(function (data) { if (!res.ok || data.error) throw new Error(data.error || res.status); return data; });
    });
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  // How far a result is from first place, e.g. "First place: 0:41 (1:32 behind)".
  // fmt(value) formats a value in the game's units; it gets the gap too.
  function lead(r, fmt) {
    fmt = fmt || String;
    if (r.best == null || r.total <= 1) return '';
    var others = r.bestCount - (r.added && r.value === r.best ? 1 : 0);
    var ahead = r.lower ? r.value < r.best : r.value > r.best;
    if (ahead || (r.value === r.best && others === 0)) return r.added ? 'First place!' : 'Ahead of everyone so far!';
    if (r.value === r.best) return 'Tied for first place.';
    return 'First place: ' + fmt(r.best) + ' (' + fmt(Math.abs(r.value - r.best)) + (r.lower ? ' behind' : ' to go') + ').';
  }

  window.SrathStats = {
    lead: lead,
    available: !!base,
    // Add a result to a board and get its rank: { value, rank, total, beats } (beats: % of other results it beats).
    submit: function (board, value) { return call('/stats/submit', { board: board, value: value }); },
    // The rank a value would have, without adding it.
    rank: function (board, value) { return call('/stats/rank?board=' + encodeURIComponent(board) + '&value=' + encodeURIComponent(value)); },
    // The best result on a board so far: { top, total }.
    top: function (board) { return call('/stats/top?board=' + encodeURIComponent(board)); },
    // Gridword's daily result; the server checks the guesses against the day's word. Without add, it looks up
    // the ranks of a result that was added earlier.
    gridword: function (result, add) {
      if (add) return call('/stats/gridword', result);
      return call('/stats/gridword?day=' + result.day + '&guesses=' + encodeURIComponent(result.guesses.join(',')) +
        '&time=' + (result.time || 0) + '&streak=' + (result.streak || 0) + '&mine=1');
    },
    // "#3 of 41 players, better than 95%", or "no other players yet" when the board is empty.
    describe: function (r, noun) {
      if (r.total <= 1) return 'no other ' + (noun ? noun + 's' : 'results') + ' yet';
      var text = '#' + r.rank + ' of ' + r.total + (noun ? ' ' + plural(r.total, noun, noun + 's') : '');
      return r.beats > 0 ? text + ', better than ' + r.beats + '%' : text;
    },
  };
})();
