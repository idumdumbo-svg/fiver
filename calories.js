/* ============================================================
   FIVER / FOOD — calorie logic. Pure functions, no DOM.

   Deliberately self-contained: its own state shape, its own
   storage key, no reads of the spending state. The only thing
   it borrows is dates.js. Lifting this into its own service
   means taking these two files and the food storage key.

   Calories are integers. Every number here is an estimate and
   the app says so — rounding is UP, so you never flatter
   yourself, the same rule the money side uses.
   ============================================================ */

if (typeof dayKey === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./dates.js'));
}

var KCAL_STEP = 10;

/* One-tap amounts. Guessing "about a snack" is more honest than
   typing 237, and it is the difference between logging and not. */
var QUICK_KCAL = [
  { kcal: 100, label: 'Bite' },
  { kcal: 200, label: 'Snack' },
  { kcal: 300, label: 'Big snack' },
  { kcal: 600, label: 'Meal' },
  { kcal: 900, label: 'Big meal' }
];

function roundKcal(n) {
  if (!isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / KCAL_STEP) * KCAL_STEP;
}

function parseKcal(str) {
  if (str == null) return 0;
  var n = parseInt(String(str).replace(/[^0-9]/g, ''), 10);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(n, 20000);
}

/* ---------------- day aggregates ---------------- */

function dayKcal(state, key) {
  var total = 0, count = 0, e = state.entries || [];
  for (var i = 0; i < e.length; i++) {
    if (e[i].day !== key) continue;
    total += (+e[i].kcal || 0);
    count++;
  }
  return { total: total, count: count };
}

/* A day counts only if something was logged. A day you forgot is
   not a zero-calorie day, and must not drag the average down. */
function isLogged(state, key) {
  var e = state.entries || [];
  for (var i = 0; i < e.length; i++) if (e[i].day === key) return true;
  return false;
}

function loggedDaysBefore(state, key, span) {
  var out = [];
  for (var i = 1; i <= span; i++) {
    var k = shiftDay(key, -i);
    if (isLogged(state, k)) out.push(k);
  }
  return out;
}

/* Average of the logged days in the window before `key`. */
function avgKcal(state, key, span) {
  var days = loggedDaysBefore(state, key, span || 7);
  if (!days.length) return null;
  var sum = 0;
  for (var i = 0; i < days.length; i++) sum += dayKcal(state, days[i]).total;
  return { value: Math.round(sum / days.length), sampleDays: days.length };
}

/* ---------------- the budget ---------------- */

function dailyBudget(state) {
  var b = state.settings && state.settings.dailyBudget;
  return b > 0 ? b : null;
}

/* Weekly is optional. Left blank it is simply seven days of the
   daily budget, which is what most people mean by it. */
function weeklyBudget(state) {
  var w = state.settings && state.settings.weeklyBudget;
  if (w > 0) return { value: w, explicit: true };
  var d = dailyBudget(state);
  return d ? { value: d * 7, explicit: false } : null;
}

/* Positive diff = over budget. */
function compareToBudget(state, key) {
  var budget = dailyBudget(state);
  var t = dayKcal(state, key);
  if (!budget) return { budget: null, diff: null, left: null, over: null, pct: null, totals: t };
  var diff = t.total - budget;
  return {
    budget: budget,
    diff: diff,
    left: Math.max(0, -diff),
    over: diff > 0,
    pct: Math.round((t.total / budget) * 100),
    totals: t
  };
}

/* Monday-start week to date, against the weekly budget. */
function weekProgress(state, key) {
  var from = weekStart(key), total = 0, days = 0;
  var k = from;
  while (k <= key) {
    if (isLogged(state, k)) { total += dayKcal(state, k).total; days++; }
    k = shiftDay(k, 1);
  }
  var wb = weeklyBudget(state);
  var elapsed = daysApart(from, key) + 1;
  return {
    total: total,
    loggedDays: days,
    elapsedDays: elapsed,
    budget: wb ? wb.value : null,
    explicitBudget: !!(wb && wb.explicit),
    // how much of the weekly budget you'd have spent at an even pace
    pace: wb ? Math.round(wb.value * (elapsed / 7)) : null,
    left: wb ? wb.value - total : null
  };
}

function daysUnder(state, key, span) {
  var budget = dailyBudget(state);
  var days = loggedDaysBefore(state, key, span || 7);
  if (isLogged(state, key)) days.unshift(key);
  if (!budget) return { under: 0, of: days.length };
  var under = 0;
  for (var i = 0; i < days.length; i++) {
    if (dayKcal(state, days[i]).total <= budget) under++;
  }
  return { under: under, of: days.length };
}

function loggingStreak(state, todayKey) {
  var n = 0;
  var k = isLogged(state, todayKey) ? todayKey : shiftDay(todayKey, -1);
  while (isLogged(state, k)) { n++; k = shiftDay(k, -1); }
  return n;
}

/* Untracked days come back null so the chart shows a gap rather
   than pretending you ate nothing. */
function kcalSeries(state, todayKey, n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    var k = shiftDay(todayKey, -i);
    out.push({ day: k, kcal: isLogged(state, k) ? dayKcal(state, k).total : null });
  }
  return out;
}

/* ---------------- saved foods ---------------- */

/* Most-used first, so the things you actually eat rise to the top
   without you organising anything. */
function sortedFoods(state) {
  return (state.foods || []).slice().sort(function (a, b) {
    if ((b.uses || 0) !== (a.uses || 0)) return (b.uses || 0) - (a.uses || 0);
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  });
}

function findFood(state, id) {
  var f = state.foods || [];
  for (var i = 0; i < f.length; i++) if (f[i].id === id) return f[i];
  return null;
}

/* Case- and space-insensitive, so "Flat white" and "flat  white"
   don't both end up in the list. */
function foodByName(state, name) {
  var norm = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!norm) return null;
  var f = state.foods || [];
  for (var i = 0; i < f.length; i++) {
    if (String(f[i].name).trim().toLowerCase().replace(/\s+/g, ' ') === norm) return f[i];
  }
  return null;
}

function totalsForFood(state, id, fromKey, toKey) {
  var total = 0, count = 0, e = state.entries || [];
  for (var i = 0; i < e.length; i++) {
    if (e[i].savedId !== id) continue;
    if (fromKey && e[i].day < fromKey) continue;
    if (toKey && e[i].day > toKey) continue;
    total += (+e[i].kcal || 0); count++;
  }
  return { total: total, count: count };
}

/* ---------------- formatting ---------------- */

function fmtKcal(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KCAL_STEP: KCAL_STEP, QUICK_KCAL: QUICK_KCAL,
    roundKcal: roundKcal, parseKcal: parseKcal,
    dayKcal: dayKcal, isLogged: isLogged, avgKcal: avgKcal,
    dailyBudget: dailyBudget, weeklyBudget: weeklyBudget,
    compareToBudget: compareToBudget, weekProgress: weekProgress,
    daysUnder: daysUnder, loggingStreak: loggingStreak, kcalSeries: kcalSeries,
    sortedFoods: sortedFoods, findFood: findFood, foodByName: foodByName,
    totalsForFood: totalsForFood, fmtKcal: fmtKcal
  };
}
