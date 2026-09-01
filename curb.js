/* ============================================================
   CURB — the behaviour layer over Fiver's spending data.

   Everything here is a pure READER. It takes the money state
   (logic.js's shape) plus its own small state, and returns
   numbers. It never mutates and never touches the DOM, exactly
   like logic.js — the writes live in template.html.

   Its own state lives under its own key (fiver.curb.v1) and the
   money side never reads it, so this whole layer can be lifted
   out or switched off without disturbing anything below it.

   Design rules that come from the research, not from taste:
     · You are only ever compared against YOURSELF. No cohort,
       no friends, no dollar figure leaves this device.
     · Nothing here ever says "you're under average, you have
       room to spend" — that is the documented boomerang.
     · A broken streak costs you a freeze, not your standing.
   ============================================================ */

if (typeof dayKey === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./dates.js'));
}
if (typeof dayTotals === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./logic.js'));
}

var MAX_FREEZES = 2;        // never hold more than two
var FREEZE_EVERY = 7;       // one earned per seven logged days
var PAUSE_MIN_CENTS = 2000; // don't interrupt someone over a $6 coffee
var PAUSE_REPEAT = 3;       // nth of a category in a week before we speak up
var LATE_HOUR = 20;         // "after 8pm"

/* ------------------------------------------------------------
   the week window
   ------------------------------------------------------------ */

/* Days of the week containing `key` that have actually happened.
   A week in progress is judged on the days elapsed, never on the
   seven it will eventually have — otherwise Monday always looks
   like a catastrophe. */
function weekDays(key, todayKey) {
  var start = weekStart(key);
  var out = [];
  for (var i = 0; i < 7; i++) {
    var d = shiftDay(start, i);
    if (todayKey && daysApart(d, todayKey) < 0) break; // in the future
    out.push(d);
  }
  return out;
}

/* The number a given day was trying to beat: an explicit daily
   goal if one is set, otherwise whatever baseline applied then. */
function targetFor(state, key) {
  var goal = state.settings && state.settings.goalDaily;
  if (goal != null && goal > 0) return { value: goal, source: 'goal' };
  var b = baselineFor(state, key);
  if (!b) return null;
  return { value: b.value, source: b.source };
}

/* Did this day come in at or under its target?
   null = we can't say (no target existed yet, or nothing logged). */
function dayUnder(state, key) {
  if (!isTracked(state, key)) return null;
  var t = targetFor(state, key);
  if (!t) return null;
  return dayTotals(state, key).flex <= t.value;
}

/* ------------------------------------------------------------
   the discipline score

   Deliberately NOT a function of how much you spent. It measures
   adherence to your own target, so a week where you spent more
   than usual but stayed inside a raised target still scores well.
   That is the whole reason this can ever be shared: it carries no
   information about income or lifestyle.
   ------------------------------------------------------------ */

function disciplineScore(state, curb, weekKey, todayKey) {
  var days = weekDays(weekKey, todayKey);
  if (!days.length) return null;

  /* A day counts toward the target component if a target EXISTED
     that day — logged or not. Judging only the days you logged
     would mean skipping a bad day scored better than admitting to
     it, which is the ostrich effect with a scoreboard attached. */
  var loggedDays = 0, judged = 0, under = 0;
  for (var i = 0; i < days.length; i++) {
    var tracked = isTracked(state, days[i]);
    if (tracked) loggedDays++;
    if (!targetFor(state, days[i])) continue;   // no target yet — not judgeable
    judged++;
    if (tracked && dayTotals(state, days[i]).flex <= targetFor(state, days[i]).value) under++;
  }

  var pl = planStats(curb, days[0], days[days.length - 1]);

  // Without a single judgeable day there is no honest score to give.
  if (!judged) {
    return { score: null, elapsed: days.length, logged: loggedDays,
             judged: 0, under: 0, plans: pl, reason: 'not-enough-history' };
  }

  var pUnder  = under / judged;
  var pLogged = loggedDays / days.length;
  var pPlans  = pl.triggered ? pl.kept / pl.triggered : null;

  // Plans only carry weight once one has actually fired; until then
  // their 20% is handed back to the two components that are real,
  // so an unused feature can't cap your score at 80.
  var score = pPlans === null
    ? (0.5 * pUnder + 0.3 * pLogged) / 0.8
    : (0.5 * pUnder + 0.3 * pLogged + 0.2 * pPlans);

  return {
    score: Math.round(score * 100),
    elapsed: days.length, logged: loggedDays,
    judged: judged, under: under, plans: pl, reason: null
  };
}

/* ------------------------------------------------------------
   the personal league

   Your current week ranked against your own previous weeks. This
   is the competitive mechanic with the peer risk taken out: there
   is nobody else in it, so there is nobody to feel poor next to.
   ------------------------------------------------------------ */

function personalLeague(state, curb, todayKey, weeks) {
  weeks = weeks || 6;
  var thisWeek = weekStart(todayKey);
  var rows = [];

  for (var i = 0; i <= weeks; i++) {
    var wk = shiftDay(thisWeek, -7 * i);
    var isNow = i === 0;
    var s = disciplineScore(state, curb, wk, isNow ? todayKey : null);
    if (!s || s.score === null) continue;
    // A past week nobody logged isn't a week you beat — it's absence.
    if (!isNow && s.logged === 0) continue;
    rows.push({ week: wk, score: s.score, isNow: isNow,
                logged: s.logged, elapsed: s.elapsed, partial: isNow && s.elapsed < 7 });
  }

  rows.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.week < b.week ? 1 : -1;   // ties: the newer week wins
  });
  for (var j = 0; j < rows.length; j++) rows[j].rank = j + 1;
  return rows;
}

/* Where the current week sits, and what it would take to move up
   one place. The gap is the motivating number, not the rank. */
function leagueStanding(state, curb, todayKey, weeks) {
  var rows = personalLeague(state, curb, todayKey, weeks);
  var me = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].isNow) me = rows[i];
  if (!me) return null;
  var above = null;
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].rank === me.rank - 1) above = rows[j];
  }
  return {
    rows: rows, rank: me.rank, of: rows.length, score: me.score,
    partial: me.partial,
    toBeat: above ? above.score - me.score : null,
    best: rows.length ? rows[0].score : null
  };
}

/* ------------------------------------------------------------
   forgiving streaks

   Freezes exist because the evidence on streaks is thin and the
   evidence on shame is not: a punishing streak gives someone a
   reason to stop opening the app, which loses you the user and
   helps nobody. One freeze is earned per seven logged days and
   you can hold two.
   ------------------------------------------------------------ */

/* Every distinct day ever logged — what freezes are earned from.
   Counted from the data rather than walked day by day, so it
   costs the same whether you've used this for a week or a year. */
function trackedDayCount(state) {
  var seen = {}, n = 0, i;
  for (i = 0; i < state.entries.length; i++) {
    if (!seen[state.entries[i].day]) { seen[state.entries[i].day] = 1; n++; }
  }
  var ns = state.noSpend || [];
  for (i = 0; i < ns.length; i++) if (!seen[ns[i]]) { seen[ns[i]] = 1; n++; }
  return n;
}

function streakWithFreezes(state, todayKey) {
  var total = trackedDayCount(state);
  var budget = Math.min(MAX_FREEZES, Math.floor(total / FREEZE_EVERY));
  var logged = 0, frozen = [], used = 0;

  // An untouched today is not yet a failure — start at yesterday.
  var k = isTracked(state, todayKey) ? todayKey : shiftDay(todayKey, -1);

  while (true) {
    if (isTracked(state, k)) { logged++; k = shiftDay(k, -1); continue; }

    // A gap. Walk it as far as the remaining freezes allow, and bridge
    // it ONLY if there's a logged day waiting on the other side — a
    // freeze joins two stretches of logging, it never extends the
    // streak backwards into the time before you started.
    var left = budget - used, gap = 0, probe = k;
    while (gap < left && !isTracked(state, probe)) { gap++; probe = shiftDay(probe, -1); }

    if (gap > 0 && isTracked(state, probe)) {
      for (var g = 0; g < gap; g++) frozen.push(shiftDay(k, -g));
      used += gap; k = probe; continue;
    }
    break;
  }

  return {
    days: logged + frozen.length,
    logged: logged,
    frozen: frozen,
    freezesLeft: Math.max(0, budget - used),
    nextFreezeIn: total >= FREEZE_EVERY * MAX_FREEZES
      ? null : FREEZE_EVERY - (total % FREEZE_EVERY)
  };
}

/* How many of the last n weeks were logged at all. Weekly framing
   is gentler than daily and survives one bad Tuesday. */
function weeksActive(state, todayKey, n) {
  n = n || 4;
  var start = weekStart(todayKey), active = 0;
  for (var i = 0; i < n; i++) {
    var wk = shiftDay(start, -7 * i);
    for (var d = 0; d < 7; d++) {
      if (isTracked(state, shiftDay(wk, d))) { active++; break; }
    }
  }
  return { active: active, of: n };
}

/* ------------------------------------------------------------
   the pause

   Fires only on discretionary spends, only above a floor, and
   only when there is a real pattern to show. The meta-analytic
   effect of payment friction is small in general and survives
   replication specifically for indulgent purchases — so this
   must never appear on rent, bills or groceries.
   ------------------------------------------------------------ */

function hourOf(ts) { return new Date(ts).getHours(); }

/* Entries in the same category inside the current week, most
   recent first. */
function recentInCategory(state, key, category) {
  var start = weekStart(key), out = [];
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.category !== category) continue;
    if (e.day < start || e.day > key) continue;
    out.push(e);
  }
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out;
}

function median(nums) {
  if (!nums.length) return null;
  var s = nums.slice().sort(function (a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/* The typical size of a spend in this category, over history.
   Used to notice an unusually large one. */
function typicalFor(state, category) {
  var amounts = [];
  for (var i = 0; i < state.entries.length; i++) {
    if (state.entries[i].category === category) amounts.push(state.entries[i].rounded);
  }
  return amounts.length >= 4 ? median(amounts) : null;
}

/* Returns null when there's nothing worth interrupting for.
   Everything it returns is an observation about the person's own
   logged history — never a judgement, never a comparison to
   anyone else. */
function pausePattern(state, curb, opts) {
  var key = opts.day, category = opts.category, cents = opts.cents;
  if (opts.fixed) return null;                       // never on rent or bills
  if (!category) return null;
  if (cents < ((curb.settings && curb.settings.pauseMinCents) || PAUSE_MIN_CENTS)) return null;
  if (curb.settings && curb.settings.pauseOn === false) return null;

  var prior = recentInCategory(state, key, category);
  var reasons = [];

  // 1. repetition inside the week
  var n = prior.length + 1;   // this one included
  if (n >= PAUSE_REPEAT) {
    reasons.push({ kind: 'repeat', n: n, category: category });
  }

  // 2. late-night clustering among the recent ones
  var late = 0, look = Math.min(3, prior.length);
  for (var i = 0; i < look; i++) if (hourOf(prior[i].ts) >= LATE_HOUR) late++;
  if (look >= 2 && late >= 2) {
    reasons.push({ kind: 'late', of: look, late: late, hour: LATE_HOUR });
  }

  // 3. unusually large for this category
  var typ = typicalFor(state, category);
  if (typ && cents >= typ * 2) {
    reasons.push({ kind: 'big', typical: typ, times: Math.round((cents / typ) * 10) / 10 });
  }

  if (!reasons.length) return null;
  return {
    reasons: reasons,
    category: category,
    cents: cents,
    weekCount: n,
    plans: plansFor(curb, category)
  };
}

/* ------------------------------------------------------------
   if-then plans
   ("if it's a weeknight after 8pm, then I'll eat what's in the
   fridge") — the strongest small effect in the whole brief, and
   almost free to build.
   ------------------------------------------------------------ */

function plansFor(curb, category) {
  var out = [];
  var plans = (curb && curb.plans) || [];
  for (var i = 0; i < plans.length; i++) {
    if (!plans[i].category || plans[i].category === category) out.push(plans[i]);
  }
  return out;
}

/* Kept vs broken over a date range. A plan is "triggered" when
   the pause offered it; kept when the spend didn't happen. */
function planStats(curb, fromKey, toKey) {
  var events = (curb && curb.planEvents) || [];
  var kept = 0, broken = 0;
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.day < fromKey || e.day > toKey) continue;
    if (e.kept) kept++; else broken++;
  }
  return { kept: kept, broken: broken, triggered: kept + broken };
}

/* ------------------------------------------------------------
   what the pause actually saved
   ------------------------------------------------------------ */

function avertedTotals(curb, fromKey, toKey) {
  var a = (curb && curb.averted) || [];
  var cents = 0, count = 0;
  for (var i = 0; i < a.length; i++) {
    if (a[i].day < fromKey || a[i].day > toKey) continue;
    cents += a[i].cents; count++;
  }
  return { cents: cents, count: count };
}

/* ------------------------------------------------------------
   fresh starts

   Only real temporal landmarks. In the field trial, placebo dates
   did nothing at all — so a random Tuesday gets no prompt.
   ------------------------------------------------------------ */

function isLandmark(key) {
  var d = keyToDate(key);
  if (d.getMonth() === 0 && d.getDate() === 1) return { kind: 'year', label: String(d.getFullYear()) };
  if (d.getDate() === 1) {
    return { kind: 'month', label: d.toLocaleDateString(undefined, { month: 'long' }) };
  }
  return null;
}

/* The next landmark within `within` days, so the app can offer the
   reset just before it lands rather than after. */
function nextLandmark(todayKey, within) {
  within = within || 7;
  for (var i = 0; i <= within; i++) {
    var k = shiftDay(todayKey, i);
    var lm = isLandmark(k);
    if (lm) {
      return { key: k, kind: lm.kind, label: lm.label, daysAway: i,
               weekday: keyToDate(k).toLocaleDateString(undefined, { weekday: 'long' }) };
    }
  }
  return null;
}

/* A landmark is only worth offering once. */
function landmarkPending(curb, todayKey, within) {
  var lm = nextLandmark(todayKey, within);
  if (!lm) return null;
  var seen = (curb && curb.seenLandmarks) || [];
  return seen.indexOf(lm.key) === -1 ? lm : null;
}

/* ------------------------------------------------------------
   a whole-week summary for the score screen
   ------------------------------------------------------------ */

function weekSummary(state, curb, todayKey) {
  var wk = weekStart(todayKey);
  var days = weekDays(wk, todayKey);
  var s = disciplineScore(state, curb, wk, todayKey);
  var st = streakWithFreezes(state, todayKey);
  var av = avertedTotals(curb, days[0], days[days.length - 1]);
  return {
    weekStart: wk,
    score: s,
    streak: st,
    averted: av,
    league: leagueStanding(state, curb, todayKey, 6),
    weeks: weeksActive(state, todayKey, 4),
    landmark: landmarkPending(curb, todayKey, 7)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_FREEZES: MAX_FREEZES, FREEZE_EVERY: FREEZE_EVERY,
    PAUSE_MIN_CENTS: PAUSE_MIN_CENTS, PAUSE_REPEAT: PAUSE_REPEAT, LATE_HOUR: LATE_HOUR,
    weekDays: weekDays, targetFor: targetFor, dayUnder: dayUnder,
    disciplineScore: disciplineScore, personalLeague: personalLeague,
    leagueStanding: leagueStanding, streakWithFreezes: streakWithFreezes,
    weeksActive: weeksActive, trackedDayCount: trackedDayCount, recentInCategory: recentInCategory, median: median,
    typicalFor: typicalFor, pausePattern: pausePattern, plansFor: plansFor,
    planStats: planStats, avertedTotals: avertedTotals,
    isLandmark: isLandmark, nextLandmark: nextLandmark,
    landmarkPending: landmarkPending, weekSummary: weekSummary
  };
}
