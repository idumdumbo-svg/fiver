/* ============================================================
   FIVER / LESS — the essentialist layer. Pure functions, no DOM.

   Reads the money state and the behaviour state; owns only what the
   book adds on top of them:

   THE INTENT. One line, written by you, shown above every screen.
   Not a goal with a number — a direction every question is asked
   against.

   THE CLOSET TEST. Every recurring bill gets asked whether you'd
   sign up for it today. A "go" is recorded with the yearly figure
   it frees, because "$16.99 a month" never sounds like much and
   "$204 a year" sometimes does.

   MARKS. After the week, the three biggest spends each get one
   question — was it essential? — and the answer is kept against
   the entry. Not a score; a habit of looking.

   ONE LINE. A sentence a week, in your words. That is the whole
   journal.

   Everything else the screens show — buffer left, days inside the
   line, noes this week — is derived here from state the money and
   curb modules already keep, so nothing is counted twice.
   ============================================================ */

if (typeof dayKey === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./dates.js'));
  Object.assign(globalThis, require('./logic.js'));
  Object.assign(globalThis, require('./curb.js'));
}

var LESS_VERSION = 1;
var PERIODS = { week: 52, fortnight: 26, month: 12, year: 1 };

function blankLess() {
  return { version: LESS_VERSION, intent: '', recurring: [], marks: {}, lines: {} };
}

function migrateLess(l) {
  var b = blankLess();
  if (!l || typeof l !== 'object') return b;
  return {
    version: LESS_VERSION,
    intent: typeof l.intent === 'string' ? l.intent : '',
    recurring: Array.isArray(l.recurring) ? l.recurring : [],
    marks: l.marks && typeof l.marks === 'object' ? l.marks : {},
    lines: l.lines && typeof l.lines === 'object' ? l.lines : {}
  };
}

/* ------------------------------------------------------------
   the closet test
   ------------------------------------------------------------ */

function yearlyCents(item) {
  var n = PERIODS[item.period] || 12;
  return Math.round((item.cents || 0) * n);
}

function lessId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addRecurring(less, item) {
  var l = migrateLess(less);
  l.recurring = l.recurring.concat([{
    id: item.id || lessId(),
    name: (item.name || '').trim() || 'Untitled',
    cents: Math.max(0, Math.round(item.cents || 0)),
    period: PERIODS[item.period] ? item.period : 'month',
    decision: item.decision === 'keep' || item.decision === 'go' ? item.decision : null,
    decided: item.decided || 0
  }]);
  return l;
}

function updateRecurring(less, id, patch) {
  var l = migrateLess(less);
  l.recurring = l.recurring.map(function (r) {
    if (r.id !== id) return r;
    var out = {};
    for (var k in r) { if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k]; }
    for (var j in patch) { if (Object.prototype.hasOwnProperty.call(patch, j)) out[j] = patch[j]; }
    if (out.period && !PERIODS[out.period]) out.period = 'month';
    return out;
  });
  return l;
}

function removeRecurring(less, id) {
  var l = migrateLess(less);
  l.recurring = l.recurring.filter(function (r) { return r.id !== id; });
  return l;
}

/* keep / go / null (undecided). Deciding stamps the time so "you said
   go three weeks ago and it's still billing" can be said later. */
function decideRecurring(less, id, decision, nowMs) {
  var d = decision === 'keep' || decision === 'go' ? decision : null;
  return updateRecurring(less, id, { decision: d, decided: d ? (nowMs || 0) : 0 });
}

/* Yearly total of everything marked go — the figure the screen shows. */
function freedYearly(less) {
  var l = migrateLess(less), sum = 0;
  for (var i = 0; i < l.recurring.length; i++) {
    if (l.recurring[i].decision === 'go') sum += yearlyCents(l.recurring[i]);
  }
  return sum;
}

/* Undecided first (they're the ones being asked), then kept, then gone. */
function sortedRecurring(less) {
  var l = migrateLess(less);
  var rank = { null: 0, keep: 1, go: 2 };
  return l.recurring.slice().sort(function (a, b) {
    var ra = rank[a.decision || 'null'], rb = rank[b.decision || 'null'];
    if (ra !== rb) return ra - rb;
    return yearlyCents(b) - yearlyCents(a);
  });
}

/* ------------------------------------------------------------
   marks and the line
   ------------------------------------------------------------ */

function markEntry(less, entryId, mark) {
  var l = migrateLess(less);
  var m = {};
  for (var k in l.marks) { if (Object.prototype.hasOwnProperty.call(l.marks, k)) m[k] = l.marks[k]; }
  if (mark === 'yes' || mark === 'no') m[entryId] = mark; else delete m[entryId];
  l.marks = m;
  return l;
}

function markOf(less, entryId) {
  var l = migrateLess(less);
  return l.marks[entryId] || null;
}

function setLine(less, weekKey, text) {
  var l = migrateLess(less);
  var lines = {};
  for (var k in l.lines) { if (Object.prototype.hasOwnProperty.call(l.lines, k)) lines[k] = l.lines[k]; }
  var t = (text || '').trim();
  if (t) lines[weekKey] = t; else delete lines[weekKey];
  l.lines = lines;
  return l;
}

function lineFor(less, weekKey) {
  var l = migrateLess(less);
  return l.lines[weekKey] || '';
}

/* ------------------------------------------------------------
   derived from the money and curb state
   ------------------------------------------------------------ */

/* The line is a ceiling with room under it, so the number the home
   screen shows is what's left, not what's gone. Null until there's a
   target at all — with no line there is no buffer to speak of. */
function bufferLeft(state, key) {
  var t = targetFor(state, key);
  if (!t) return null;
  var flex = dayTotals(state, key).flex;
  return { left: t.value - flex, line: t.value, spent: flex, source: t.source };
}

/* Each day of this week so far: inside the line, over it, a no-spend
   day, or simply not logged. The wall in Explore. */
function weekWall(state, todayKey) {
  var days = weekDays(weekStart(todayKey), todayKey);
  var out = [], under = 0, judged = 0;
  for (var i = 0; i < days.length; i++) {
    var k = days[i], tracked = isTracked(state, k), t = targetFor(state, k);
    var totals = dayTotals(state, k);
    var st;
    if (!tracked) st = 'untracked';
    else if (totals.count === 0) st = 'none';
    else if (!t) st = 'inside';                 // logged, nothing to be over
    else st = totals.flex <= t.value ? 'inside' : 'over';
    if (tracked && t) { judged++; if (totals.flex <= t.value) under++; }
    else if (tracked && totals.count === 0) { judged++; under++; }
    out.push({ key: k, state: st, flex: totals.flex });
  }
  return { days: out, under: under, judged: judged };
}

/* The three biggest discretionary spends this week, for the question. */
function biggestThisWeek(state, todayKey, n) {
  var days = weekDays(weekStart(todayKey), todayKey);
  var first = days[0], last = days[days.length - 1];
  var list = [];
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.fixed) continue;
    if (e.day < first || e.day > last) continue;
    list.push(e);
  }
  list.sort(function (a, b) { return b.rounded - a.rounded || b.ts - a.ts; });
  return list.slice(0, n || 3);
}

/* Noes this week, from the curb layer's averted list. */
function noesThisWeek(curb, todayKey) {
  var days = weekDays(weekStart(todayKey), todayKey);
  return avertedTotals(curb, days[0], days[days.length - 1]);
}

/* Today's list with the noes woven in by time, so a no sits where it
   happened rather than in a separate box. */
function dayWithNoes(state, curb, key) {
  var out = [];
  for (var i = 0; i < state.entries.length; i++) {
    if (state.entries[i].day === key) out.push({ kind: 'spend', ts: state.entries[i].ts, entry: state.entries[i] });
  }
  var av = (curb && curb.averted) || [];
  for (var j = 0; j < av.length; j++) {
    if (av[j].day === key) out.push({ kind: 'no', ts: av[j].ts, averted: av[j] });
  }
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LESS_VERSION: LESS_VERSION, PERIODS: PERIODS,
    blankLess: blankLess, migrateLess: migrateLess,
    yearlyCents: yearlyCents, addRecurring: addRecurring, updateRecurring: updateRecurring,
    removeRecurring: removeRecurring, decideRecurring: decideRecurring, freedYearly: freedYearly,
    sortedRecurring: sortedRecurring,
    markEntry: markEntry, markOf: markOf, setLine: setLine, lineFor: lineFor,
    bufferLeft: bufferLeft, weekWall: weekWall, biggestThisWeek: biggestThisWeek,
    noesThisWeek: noesThisWeek, dayWithNoes: dayWithNoes
  };
}
