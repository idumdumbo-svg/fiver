/* ============================================================
   FIVER — core spending logic. Pure functions, no DOM.
   All money is handled in CENTS (integers) to avoid float drift.
   ============================================================ */

var STEP = 500; // $5.00 in cents

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* Round a spend UP to the next $5. Exact multiples stay put.
   $2.00 -> $5.00   $14.00 -> $15.00   $15.00 -> $15.00 */
function roundUp(cents, step) {
  step = step || STEP;
  if (!isFinite(cents) || cents <= 0) return 0;
  return Math.ceil(cents / step) * step;
}

/* How much "free" money the round-up created. */
function roundUpDelta(cents, step) {
  return roundUp(cents, step) - Math.max(0, Math.round(cents || 0));
}

/* Which day does a timestamp belong to?
   dayStartHour lets a 1am kebab count as the previous night. */
function dayKey(ts, dayStartHour) {
  var d = new Date(ts - (dayStartHour || 0) * 3600000);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* Parse a day key at local noon — immune to DST shifts. */
function keyToDate(key) {
  var p = key.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0, 0);
}

function shiftDay(key, n) {
  var d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function daysApart(a, b) {
  return Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
}

/* Monday-start week key, matching NZ/AU convention. */
function weekStart(key) {
  var d = keyToDate(key);
  var dow = (d.getDay() + 6) % 7; // Mon = 0
  return shiftDay(key, -dow);
}

function monthKey(key) { return key.slice(0, 7); }

/* ---------------- day aggregates ---------------- */

/* total  = everything spent that day, rounded up (the hero number)
   fixed  = rent / bills / anything flagged as not-a-choice
   flex   = day-to-day spending — the only number worth comparing
   jar    = round-up change created that day */
function dayTotals(state, key) {
  var total = 0, fixed = 0, flex = 0, jar = 0, count = 0;
  var e = state.entries;
  for (var i = 0; i < e.length; i++) {
    if (e[i].day !== key) continue;
    count++;
    total += e[i].rounded;
    if (e[i].fixed) fixed += e[i].rounded; else flex += e[i].rounded;
    if (e[i].actual != null) jar += e[i].rounded - e[i].actual;
  }
  return { total: total, fixed: fixed, flex: flex, jar: jar, count: count };
}

/* A day counts as "tracked" if it has entries OR was explicitly
   marked a no-spend day. Days you simply forgot are excluded, so
   forgetting can't quietly drag your average down. */
function isTracked(state, key) {
  if (state.noSpend && state.noSpend.indexOf(key) !== -1) return true;
  for (var i = 0; i < state.entries.length; i++) {
    if (state.entries[i].day === key) return true;
  }
  return false;
}

function trackedDaysBefore(state, key, span) {
  var out = [];
  for (var i = 1; i <= span; i++) {
    var k = shiftDay(key, -i);
    if (isTracked(state, k)) out.push(k);
  }
  return out;
}

/* The number you are trying to beat today.
   mode 'yesterday' falls back to the 7-day average if yesterday
   was never tracked, rather than silently comparing against zero. */
function baselineFor(state, key) {
  var mode = (state.settings && state.settings.baselineMode) || 'week7';

  if (mode === 'yesterday') {
    var y = shiftDay(key, -1);
    if (isTracked(state, y)) {
      return { value: dayTotals(state, y).flex, source: 'yesterday', sampleDays: 1 };
    }
  }

  var days = trackedDaysBefore(state, key, 7);
  if (!days.length) return null;
  var sum = 0;
  for (var i = 0; i < days.length; i++) sum += dayTotals(state, days[i]).flex;
  return {
    value: Math.round(sum / days.length),
    source: mode === 'yesterday' ? 'avg7-fallback' : 'avg7',
    sampleDays: days.length
  };
}

/* Negative diff = spent less than the baseline = a win. */
function compareToBaseline(state, key) {
  var base = baselineFor(state, key);
  var t = dayTotals(state, key);
  if (!base) return { baseline: null, diff: null, pct: null, winning: null, totals: t };
  var diff = t.flex - base.value;
  // round the magnitude, not the signed value, so -62.5% and +62.5%
  // don't render as -62% and +63%
  var pct = base.value > 0
    ? (diff < 0 ? -1 : 1) * Math.round(Math.abs(diff / base.value) * 100)
    : null;
  return {
    baseline: base, diff: diff, pct: pct,
    winning: diff <= 0, totals: t
  };
}

/* Consecutive days logged, counting back from today.
   Today only breaks the streak once it has been missed entirely,
   so an untouched morning doesn't read as a failure. */
function trackingStreak(state, todayKey) {
  var n = 0;
  var k = isTracked(state, todayKey) ? todayKey : shiftDay(todayKey, -1);
  while (isTracked(state, k)) { n++; k = shiftDay(k, -1); }
  return n;
}

/* How many of the last `span` tracked days came in under the
   baseline that applied on that day. */
function winsIn(state, todayKey, span) {
  var days = trackedDaysBefore(state, todayKey, span);
  if (isTracked(state, todayKey)) days.unshift(todayKey);
  var wins = 0;
  for (var i = 0; i < days.length; i++) {
    var c = compareToBaseline(state, days[i]);
    if (c.diff !== null && c.diff <= 0) wins++;
  }
  return { wins: wins, of: days.length };
}

/* ---------------- the end-of-day sweep ---------------- */

function sweptOn(state, key, kind) {
  var s = 0, sw = state.sweeps || [];
  for (var i = 0; i < sw.length; i++) {
    if (sw[i].day === key && (!kind || sw[i].kind === kind)) s += sw[i].cents;
  }
  return s;
}

/* Two separate pots, never double-counted:
   jar   — change created by rounding up. Already mentally spent.
   bonus — how far under your baseline you finished. Only real
           once the day is done, so it is offered, not assumed. */
function sweepOffer(state, key) {
  var t = dayTotals(state, key);
  var c = compareToBaseline(state, key);
  var jar = Math.max(0, t.jar - sweptOn(state, key, 'jar'));
  var bonusTotal = c.diff !== null ? Math.max(0, -c.diff) : 0;
  var bonus = Math.max(0, bonusTotal - sweptOn(state, key, 'bonus'));
  return { jar: jar, bonus: bonus, total: jar + bonus, bonusTotal: bonusTotal };
}

/* ---------------- range aggregates ---------------- */

function rangeTotals(state, fromKey, toKey) {
  var total = 0, flex = 0, fixed = 0, jar = 0, days = {}, tracked = 0;
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.day < fromKey || e.day > toKey) continue;
    total += e.rounded;
    if (e.fixed) fixed += e.rounded; else flex += e.rounded;
    if (e.actual != null) jar += e.rounded - e.actual;
    days[e.day] = true;
  }
  var k = fromKey;
  while (k <= toKey) { if (isTracked(state, k)) tracked++; k = shiftDay(k, 1); }
  return {
    total: total, flex: flex, fixed: fixed, jar: jar,
    trackedDays: tracked,
    avgFlex: tracked ? Math.round(flex / tracked) : 0
  };
}

function categoryTotals(state, fromKey, toKey) {
  var map = {};
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.day < fromKey || e.day > toKey) continue;
    map[e.category] = (map[e.category] || 0) + e.rounded;
  }
  var out = [];
  for (var k in map) if (map.hasOwnProperty(k)) out.push({ category: k, cents: map[k] });
  out.sort(function (a, b) { return b.cents - a.cents; });
  return out;
}

/* Last n days of flex spend, oldest first — for the sparkline.
   Untracked days come back as null so the chart shows a gap
   instead of pretending you spent nothing. */
function series(state, todayKey, n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    var k = shiftDay(todayKey, -i);
    out.push({ day: k, cents: isTracked(state, k) ? dayTotals(state, k).flex : null });
  }
  return out;
}

/* ---------------- money formatting ---------------- */

function fmt(cents, opts) {
  opts = opts || {};
  var neg = cents < 0;
  var v = Math.abs(cents) / 100;
  var s = (opts.decimals === false || v % 1 === 0)
    ? String(Math.round(v))
    : v.toFixed(2);
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + '$' + s;
}

/* Parse whatever the keypad produced into cents. */
function parseAmount(str) {
  if (str == null) return 0;
  var n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STEP: STEP, roundUp: roundUp, roundUpDelta: roundUpDelta,
    dayKey: dayKey, shiftDay: shiftDay, daysApart: daysApart,
    weekStart: weekStart, monthKey: monthKey,
    dayTotals: dayTotals, isTracked: isTracked, baselineFor: baselineFor,
    compareToBaseline: compareToBaseline, trackingStreak: trackingStreak,
    winsIn: winsIn, sweptOn: sweptOn, sweepOffer: sweepOffer,
    rangeTotals: rangeTotals, categoryTotals: categoryTotals,
    series: series, fmt: fmt, parseAmount: parseAmount
  };
}

/* ============================================================
   income — kept in its own list so it can never leak into a
   spend aggregate, a baseline or a block count
   ============================================================ */

function dayIncome(state, key) {
  var s = 0, list = state.income || [];
  for (var i = 0; i < list.length; i++) if (list[i].day === key) s += list[i].cents;
  return s;
}

function rangeIncome(state, fromKey, toKey) {
  var s = 0, n = 0, list = state.income || [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.day < fromKey || e.day > toKey) continue;
    s += e.cents; n++;
  }
  return { total: s, count: n };
}

/* What you kept, not what you earned: income minus everything
   that went out, fixed costs included. */
function netFor(state, fromKey, toKey) {
  return rangeIncome(state, fromKey, toKey).total - rangeTotals(state, fromKey, toKey).total;
}

function totalSwept(state) {
  var s = 0, sw = state.sweeps || [];
  for (var i = 0; i < sw.length; i++) s += sw[i].cents;
  return s;
}

/* Where the swept money actually went, biggest pile first. */
function sweptByDest(state) {
  var map = {}, sw = state.sweeps || [];
  for (var i = 0; i < sw.length; i++) {
    var d = sw[i].dest || 'Unassigned';
    map[d] = (map[d] || 0) + sw[i].cents;
  }
  var out = [];
  for (var k in map) if (map.hasOwnProperty(k)) out.push({ dest: k, cents: map[k] });
  out.sort(function (a, b) { return b.cents - a.cents; });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.dayIncome = dayIncome;
  module.exports.rangeIncome = rangeIncome;
  module.exports.netFor = netFor;
  module.exports.totalSwept = totalSwept;
  module.exports.sweptByDest = sweptByDest;
}

/* ============================================================
   total cash — what the user actually has, everywhere
   ============================================================ */

/* Real money that left the account, not the rounded-up figure the
   app displays. Older entries without an actual fall back to it. */
function actualSpendSince(state, ts) {
  var s = 0;
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.ts <= ts) continue;
    s += (e.actual != null ? e.actual : e.rounded);
  }
  return s;
}

function incomeSince(state, ts) {
  var s = 0, list = state.income || [];
  for (var i = 0; i < list.length; i++) if (list[i].ts > ts) s += list[i].cents;
  return s;
}

/* Cash is anchored to a figure the user read off their bank, then
   moved by everything logged since. Sweeps are transfers between
   the user's own pots, so they never change this. */
function cashNow(state) {
  var a = state.cash;
  if (!a || a.anchor == null) return null;
  return a.anchor + incomeSince(state, a.ts) - actualSpendSince(state, a.ts);
}

function cashMovement(state) {
  var a = state.cash;
  if (!a || a.anchor == null) return { inn: 0, out: 0 };
  return { inn: incomeSince(state, a.ts), out: actualSpendSince(state, a.ts) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.actualSpendSince = actualSpendSince;
  module.exports.incomeSince = incomeSince;
  module.exports.cashNow = cashNow;
  module.exports.cashMovement = cashMovement;
}

/* ============================================================
   backdating
   ============================================================ */

/* A timestamp that lands inside the chosen day and never in the
   future. Keeps the current time of day so a backdated entry
   still sorts sensibly, but falls back to midday when the day
   boundary setting would push it into the wrong bucket. */
function timestampForDay(dayK, nowMs, dayStartHour) {
  var todayK = dayKey(nowMs, dayStartHour);
  if (dayK >= todayK) return nowMs;
  var now = new Date(nowMs);
  var d = keyToDate(dayK);
  d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  var t = d.getTime();
  if (dayKey(t, dayStartHour) !== dayK) {
    d.setHours(12, 0, 0, 0);
    t = d.getTime();
  }
  return Math.min(t, nowMs);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.timestampForDay = timestampForDay;
}
