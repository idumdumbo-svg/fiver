/* Logic tests for the CURB behaviour layer. Run: node test-curb.js */
var C = require('./curb.js');
var L = require('./logic.js');
var D = require('./dates.js');
Object.assign(C, D, L);

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* ---------- helpers ----------
   2026-08-31 is a Monday, which makes the week maths easy to read. */
var MON = '2026-08-31';
var ID = 0;
function at(day, hour) {
  var p = day.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2], hour == null ? 12 : hour, 0, 0, 0).getTime();
}
function entry(day, dollars, opts) {
  opts = opts || {};
  var actual = Math.round(dollars * 100);
  return {
    id: ++ID, day: day, ts: at(day, opts.hour),
    actual: actual, rounded: L.roundUp(actual),
    category: opts.category || 'Other', fixed: !!opts.fixed,
    note: '', photo: null
  };
}
function mk(entries, opts) {
  opts = opts || {};
  return {
    entries: entries || [], income: [], sweeps: [], noSpend: opts.noSpend || [],
    settings: { baselineMode: 'week7', dayStartHour: 0,
                goalDaily: opts.goalDaily || null, currency: 'NZD' }
  };
}
function curb(o) {
  o = o || {};
  return { version: 1, plans: o.plans || [], planEvents: o.planEvents || [],
           averted: o.averted || [], seenLandmarks: o.seenLandmarks || [],
           settings: o.settings || {} };
}
/* A run of days each spending the same amount, so baselines are predictable. */
function run(fromDay, n, dollars, opts) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(entry(D.shiftDay(fromDay, i), dollars, opts));
  return out;
}

/* ============================================================
   1. the week window
   ============================================================ */
eq('a finished week is seven days', C.weekDays(MON, null).length, 7);
eq('a week in progress stops at today', C.weekDays(MON, D.shiftDay(MON, 2)).length, 3);
eq('week starts Monday', C.weekDays(MON, null)[0], MON);
eq('Sunday belongs to the week that started Monday',
   C.weekDays(D.shiftDay(MON, 6), null)[0], MON);
eq('today outside the week does not truncate it',
   C.weekDays(MON, D.shiftDay(MON, 30)).length, 7);

/* ============================================================
   2. targets
   ============================================================ */
(function () {
  var s = mk(run(MON, 3, 20), { goalDaily: 5000 });
  eq('an explicit goal wins', C.targetFor(s, D.shiftDay(MON, 3)).source, 'goal');
  eq('goal value passes through', C.targetFor(s, D.shiftDay(MON, 3)).value, 5000);

  var s2 = mk(run(MON, 3, 20));
  eq('without a goal it falls back to the baseline',
     C.targetFor(s2, D.shiftDay(MON, 3)).source, 'avg7');
  eq('no history means no target', C.targetFor(mk([]), MON), null);
})();

/* ============================================================
   3. under / over
   ============================================================ */
(function () {
  // three $20 days, then a $10 day — comfortably under
  var days = run(MON, 3, 20).concat([entry(D.shiftDay(MON, 3), 10)]);
  var s = mk(days);
  eq('a cheap day is under', C.dayUnder(s, D.shiftDay(MON, 3)), true);

  var days2 = run(MON, 3, 20).concat([entry(D.shiftDay(MON, 3), 90)]);
  eq('an expensive day is over', C.dayUnder(mk(days2), D.shiftDay(MON, 3)), false);

  eq('an unlogged day is unjudgeable', C.dayUnder(mk(run(MON, 3, 20)), D.shiftDay(MON, 5)), null);
  eq('day one is unjudgeable — nothing to compare to',
     C.dayUnder(mk([entry(MON, 20)]), MON), null);

  // exactly on target counts as under, not over
  var s3 = mk(run(MON, 3, 20).concat([entry(D.shiftDay(MON, 3), 20)]));
  eq('exactly on target is a win', C.dayUnder(s3, D.shiftDay(MON, 3)), true);

  // fixed costs sit outside the comparison
  var s4 = mk(run(MON, 3, 20).concat([
    entry(D.shiftDay(MON, 3), 10),
    entry(D.shiftDay(MON, 3), 300, { fixed: true, category: 'Rent' })
  ]));
  eq('rent does not push a day over', C.dayUnder(s4, D.shiftDay(MON, 3)), true);
})();

/* ============================================================
   4. the discipline score
   ============================================================ */
(function () {
  var s = mk([]);
  var r = C.disciplineScore(s, curb(), MON, MON);
  eq('empty week scores null', r.score, null);
  eq('and says why', r.reason, 'not-enough-history');

  // a full clean week after a week of history
  var prior = run(D.shiftDay(MON, -7), 7, 30);
  var week = run(MON, 7, 10);
  var good = C.disciplineScore(mk(prior.concat(week)), curb(), MON, D.shiftDay(MON, 6));
  eq('a perfect week scores 100', good.score, 100);
  eq('and counts all seven days', good.logged, 7);

  // same history, but every day blows the target
  var bad = C.disciplineScore(mk(prior.concat(run(MON, 7, 200))), curb(), MON, D.shiftDay(MON, 6));
  ok('a bad week scores well below a good one', bad.score < 50);

  // the score never leaves 0..100
  ok('score has a floor', bad.score >= 0);
  ok('score has a ceiling', good.score <= 100);

  // a partial week is judged on elapsed days only
  var mid = C.disciplineScore(mk(prior.concat(run(MON, 3, 10))), curb(), MON, D.shiftDay(MON, 2));
  eq('Wednesday is judged on three days', mid.elapsed, 3);
  eq('a clean partial week still scores 100', mid.score, 100);

  // missing days cost the logging component but not the whole score
  var gappy = mk(prior.concat([entry(MON, 10), entry(D.shiftDay(MON, 6), 10)]));
  var g = C.disciplineScore(gappy, curb(), MON, D.shiftDay(MON, 6));
  eq('gappy week logs two of seven', g.logged, 2);
  ok('but still scores above zero for staying under', g.score > 0);
  ok('and below a fully logged week', g.score < good.score);

  // The property that matters most: owning up to a bad day must never
  // score worse than hiding it. If this ever inverts, the app is
  // teaching avoidance.
  var honest = mk(prior.concat(run(MON, 6, 10)).concat([entry(D.shiftDay(MON, 6), 300)]));
  var hidden = mk(prior.concat(run(MON, 6, 10)));   // same week, bad day simply unlogged
  var hs = C.disciplineScore(honest, curb(), MON, D.shiftDay(MON, 6));
  var xs = C.disciplineScore(hidden, curb(), MON, D.shiftDay(MON, 6));
  ok('logging a blowout beats hiding it', hs.score > xs.score);
  eq('an unlogged day still counts against the target', xs.judged, 7);
})();


/* ============================================================
   5. plans inside the score
   ============================================================ */
(function () {
  var prior = run(D.shiftDay(MON, -7), 7, 30);
  var week = run(MON, 7, 10);
  var s = mk(prior.concat(week));

  var noPlans = C.disciplineScore(s, curb(), MON, D.shiftDay(MON, 6));
  eq('an unused plan feature cannot cap the score', noPlans.score, 100);

  var kept = curb({ planEvents: [{ day: MON, kept: true }, { day: D.shiftDay(MON, 1), kept: true }] });
  eq('kept plans keep it at 100', C.disciplineScore(s, kept, MON, D.shiftDay(MON, 6)).score, 100);

  var broke = curb({ planEvents: [{ day: MON, kept: false }, { day: D.shiftDay(MON, 1), kept: false }] });
  var b = C.disciplineScore(s, broke, MON, D.shiftDay(MON, 6));
  eq('broken plans cost exactly the plan weight', b.score, 80);
  eq('and are counted', b.plans, { kept: 0, broken: 2, triggered: 2 });

  var half = curb({ planEvents: [{ day: MON, kept: true }, { day: MON, kept: false }] });
  eq('half kept costs half the weight',
     C.disciplineScore(s, half, MON, D.shiftDay(MON, 6)).score, 90);

  // events outside the week are ignored
  var stale = curb({ planEvents: [{ day: D.shiftDay(MON, -3), kept: false }] });
  eq('last week\'s broken plan does not follow you',
     C.disciplineScore(s, stale, MON, D.shiftDay(MON, 6)).score, 100);
})();

/* ============================================================
   6. the personal league
   ============================================================ */
(function () {
  // three weeks: a bad one, a good one, then a middling current week
  var w1 = run(D.shiftDay(MON, -21), 7, 30);   // establishes history
  var w2 = run(D.shiftDay(MON, -14), 7, 90);   // bad
  var w3 = run(D.shiftDay(MON, -7), 7, 10);    // good
  var w4 = run(MON, 3, 20);                    // current, partial
  var s = mk(w1.concat(w2, w3, w4));
  var st = C.leagueStanding(s, curb(), D.shiftDay(MON, 2), 6);

  ok('the current week is in the table', st !== null);
  ok('there is more than one week to compare', st.of > 1);
  eq('ranks are 1-based', st.rows[0].rank, 1);
  ok('the current week is flagged partial', st.partial);

  var ranks = st.rows.map(function (r) { return r.rank; });
  eq('ranks are dense and ordered', ranks, ranks.slice().sort(function (a, b) { return a - b; }));

  var scores = st.rows.map(function (r) { return r.score; });
  var sorted = scores.slice().sort(function (a, b) { return b - a; });
  eq('rows are sorted by score descending', scores, sorted);

  ok('the best score matches the top row', st.best === st.rows[0].score);

  // a week nobody logged is absent, not a week you beat
  var sparse = mk(w1.concat(run(MON, 3, 20)));
  var st2 = C.leagueStanding(sparse, curb(), D.shiftDay(MON, 2), 6);
  var weeksListed = st2.rows.map(function (r) { return r.week; });
  eq('empty weeks are excluded', weeksListed.indexOf(D.shiftDay(MON, -14)), -1);

  // first ever week: a league of one, and no gap to chase
  var solo = C.leagueStanding(mk(run(D.shiftDay(MON, -7), 7, 20).concat(run(MON, 2, 10))),
                              curb(), D.shiftDay(MON, 1), 6);
  eq('leader has nothing above them', solo.toBeat, null);
})();

/* ============================================================
   7. streaks and freezes
   ============================================================ */
(function () {
  var s = mk(run(MON, 5, 20));
  var r = C.streakWithFreezes(s, D.shiftDay(MON, 4));
  eq('five logged days is a five-day streak', r.days, 5);
  eq('no freeze earned yet', r.freezesLeft, 0);
  eq('two days until the first freeze', r.nextFreezeIn, 2);

  // an untouched today does not break anything
  var r2 = C.streakWithFreezes(s, D.shiftDay(MON, 5));
  eq('an untouched today keeps the streak', r2.days, 5);

  // seven days earns a freeze
  var s3 = mk(run(MON, 7, 20));
  eq('seven days earns one freeze', C.streakWithFreezes(s3, D.shiftDay(MON, 6)).freezesLeft, 1);

  // ... and that freeze bridges a single missed day
  var s4 = mk(run(MON, 7, 20).concat(run(D.shiftDay(MON, 8), 2, 20)));  // day 7 missed
  var r4 = C.streakWithFreezes(s4, D.shiftDay(MON, 9));
  eq('a freeze bridges the gap', r4.logged, 9);
  eq('and the frozen day is named', r4.frozen, [D.shiftDay(MON, 7)]);
  eq('the freeze is spent', r4.freezesLeft, 0);

  // without an earned freeze, a gap ends the streak
  var s5 = mk(run(MON, 3, 20).concat(run(D.shiftDay(MON, 4), 2, 20)));  // day 3 missed
  eq('no freeze means the streak ends at the gap',
     C.streakWithFreezes(s5, D.shiftDay(MON, 5)).days, 2);

  // two gaps need two earned freezes
  var many = run(MON, 14, 20).concat([entry(D.shiftDay(MON, 15), 20), entry(D.shiftDay(MON, 17), 20)]);
  var r6 = C.streakWithFreezes(mk(many), D.shiftDay(MON, 17));
  eq('two freezes bridge two gaps', r6.frozen.length, 2);

  // you can never hold more than the cap
  var r7 = C.streakWithFreezes(mk(run(MON, 60, 20)), D.shiftDay(MON, 59));
  eq('freezes are capped', r7.freezesLeft, C.MAX_FREEZES);
  eq('and stop being counted down once capped', r7.nextFreezeIn, null);

  // a no-spend day counts as logged
  var ns = mk(run(MON, 3, 20), { noSpend: [D.shiftDay(MON, 3)] });
  eq('a no-spend day keeps the streak alive',
     C.streakWithFreezes(ns, D.shiftDay(MON, 3)).days, 4);

  eq('nothing logged is a zero streak', C.streakWithFreezes(mk([]), MON).days, 0);
})();

/* ============================================================
   8. weeks active
   ============================================================ */
(function () {
  var s = mk([entry(MON, 20), entry(D.shiftDay(MON, -7), 20), entry(D.shiftDay(MON, -21), 20)]);
  eq('three of the last four weeks touched',
     C.weeksActive(s, MON, 4), { active: 3, of: 4 });
  eq('one entry makes a week active', C.weeksActive(mk([entry(MON, 20)]), MON, 4).active, 1);
})();

/* ============================================================
   9. the pause
   ============================================================ */
(function () {
  var base = { day: D.shiftDay(MON, 3), category: 'Eating out', cents: 4800, fixed: false };

  eq('rent never triggers the pause',
     C.pausePattern(mk([]), curb(), Object.assign({}, base, { fixed: true, category: 'Rent' })), null);
  eq('a small spend never triggers it',
     C.pausePattern(mk([]), curb(), Object.assign({}, base, { cents: 400 })), null);
  eq('an uncategorised spend never triggers it',
     C.pausePattern(mk([]), curb(), Object.assign({}, base, { category: null })), null);
  eq('a first-ever spend has no pattern to show',
     C.pausePattern(mk([]), curb(), base), null);

  // three eating-out in the week: repetition
  var three = mk([
    entry(MON, 40, { category: 'Eating out', hour: 21 }),
    entry(D.shiftDay(MON, 1), 45, { category: 'Eating out', hour: 21 })
  ]);
  var p = C.pausePattern(three, curb(), base);
  ok('the third of the week trips it', p !== null);
  eq('and counts them', p.weekCount, 3);
  var kinds = p.reasons.map(function (r) { return r.kind; });
  ok('repetition is one reason', kinds.indexOf('repeat') !== -1);
  ok('late-night clustering is spotted', kinds.indexOf('late') !== -1);

  // daytime spends: repetition but no late-night reason
  var day = mk([
    entry(MON, 40, { category: 'Eating out', hour: 12 }),
    entry(D.shiftDay(MON, 1), 45, { category: 'Eating out', hour: 13 })
  ]);
  var pd = C.pausePattern(day, curb(), base);
  eq('lunchtime spending is not flagged as late',
     pd.reasons.map(function (r) { return r.kind; }).indexOf('late'), -1);

  // an unusually large one-off
  var hist = [];
  for (var i = 0; i < 6; i++) hist.push(entry(D.shiftDay(MON, -20 + i), 10, { category: 'Coffee' }));
  var big = C.pausePattern(mk(hist), curb(),
    { day: MON, category: 'Coffee', cents: 6000, fixed: false });
  ok('a spend far above the usual trips it', big !== null);
  eq('and says what usual is', big.reasons[0].kind, 'big');

  // last week's dinners don't count toward this week
  var lastWeek = mk([
    entry(D.shiftDay(MON, -3), 40, { category: 'Eating out', hour: 21 }),
    entry(D.shiftDay(MON, -2), 45, { category: 'Eating out', hour: 21 })
  ]);
  eq('the count resets each week', C.pausePattern(lastWeek, curb(), base), null);

  // switched off means off
  eq('the pause can be turned off',
     C.pausePattern(three, curb({ settings: { pauseOn: false } }), base), null);

  // the floor is configurable
  eq('the floor is configurable',
     C.pausePattern(three, curb({ settings: { pauseMinCents: 999999 } }), base), null);

  // matching plans come along for the ride
  var withPlan = curb({ plans: [{ id: 'p1', category: 'Eating out', trigger: 'after 8pm', action: 'eat in' }] });
  eq('a matching plan is offered', C.pausePattern(three, withPlan, base).plans.length, 1);
  var otherPlan = curb({ plans: [{ id: 'p2', category: 'Coffee', trigger: 'x', action: 'y' }] });
  eq('an unrelated plan is not', C.pausePattern(three, otherPlan, base).plans.length, 0);
  var anyPlan = curb({ plans: [{ id: 'p3', category: null, trigger: 'x', action: 'y' }] });
  eq('a catch-all plan matches anything', C.pausePattern(three, anyPlan, base).plans.length, 1);
})();

/* ============================================================
   10. medians and typical amounts
   ============================================================ */
eq('median of an odd list', C.median([1, 5, 3]), 3);
eq('median of an even list rounds', C.median([1, 2, 3, 4]), 3);
eq('median of nothing is null', C.median([]), null);
eq('too little history means no typical amount',
   C.typicalFor(mk([entry(MON, 10, { category: 'Coffee' })]), 'Coffee'), null);

/* ============================================================
   11. averted spending
   ============================================================ */
(function () {
  var c = curb({ averted: [
    { day: MON, cents: 4800 }, { day: D.shiftDay(MON, 2), cents: 2000 },
    { day: D.shiftDay(MON, -9), cents: 9900 }
  ]});
  eq('this week only', C.avertedTotals(c, MON, D.shiftDay(MON, 6)), { cents: 6800, count: 2 });
  eq('an empty range is zero', C.avertedTotals(curb(), MON, MON), { cents: 0, count: 0 });
})();

/* ============================================================
   12. fresh starts
   ============================================================ */
(function () {
  eq('the first of a month is a landmark', C.isLandmark('2026-09-01').kind, 'month');
  eq('new year outranks new month', C.isLandmark('2027-01-01').kind, 'year');
  eq('a random Tuesday is not a landmark', C.isLandmark('2026-09-15'), null);

  var nx = C.nextLandmark('2026-08-31', 7);
  eq('September is one day away', nx.daysAway, 1);
  eq('and it is a month landmark', nx.kind, 'month');
  eq('today itself can be the landmark', C.nextLandmark('2026-09-01', 7).daysAway, 0);
  eq('nothing within range returns null', C.nextLandmark('2026-09-10', 7), null);

  eq('an unseen landmark is pending',
     C.landmarkPending(curb(), '2026-08-31', 7).key, '2026-09-01');
  eq('a dismissed landmark stops asking',
     C.landmarkPending(curb({ seenLandmarks: ['2026-09-01'] }), '2026-08-31', 7), null);
})();

/* ============================================================
   13. the whole-week summary holds together
   ============================================================ */
(function () {
  var s = mk(run(D.shiftDay(MON, -7), 7, 30).concat(run(MON, 3, 10)));
  var sum = C.weekSummary(s, curb(), D.shiftDay(MON, 2));
  eq('summary week starts Monday', sum.weekStart, MON);
  ok('it carries a score', sum.score.score !== null);
  ok('it carries a streak', sum.streak.days > 0);
  ok('it carries a league', sum.league !== null);
  eq('it carries averted totals', sum.averted, { cents: 0, count: 0 });

  // and survives a completely empty state without throwing
  var empty = C.weekSummary(mk([]), curb(), MON);
  eq('an empty state gives a null score', empty.score.score, null);
  eq('an empty state gives a zero streak', empty.streak.days, 0);
  eq('an empty state has no league', empty.league, null);
})();

/* ---------- report ---------- */
console.log('\ncurb: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
