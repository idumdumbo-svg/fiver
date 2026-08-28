/* Logic tests for FIVER. Run: node test.js */
var L = require('./logic.js');
var D = require('./dates.js');
// date helpers moved to their own module; keep the old L.* spellings working
Object.assign(L, D);

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* ---------- helpers ---------- */
var ID = 0;
function entry(day, actualDollars, opts) {
  opts = opts || {};
  var actual = actualDollars == null ? null : Math.round(actualDollars * 100);
  return {
    id: ++ID, day: day, ts: 0,
    actual: actual,
    rounded: opts.rounded != null ? opts.rounded * 100 : L.roundUp(actual),
    category: opts.category || 'Other',
    fixed: !!opts.fixed, note: '', photo: null
  };
}
function mk(entries, opts) {
  opts = opts || {};
  return {
    entries: entries || [], sweeps: opts.sweeps || [], noSpend: opts.noSpend || [],
    savings: opts.savings || 0,
    settings: { baselineMode: opts.baselineMode || 'week7', dayStartHour: opts.dayStartHour || 0, goalDaily: opts.goalDaily || null }
  };
}

/* ---------- 1. rounding ---------- */
eq('roundUp $2 -> $5', L.roundUp(200), 500);
eq('roundUp $14 -> $15', L.roundUp(1400), 1500);
eq('roundUp $15 stays $15', L.roundUp(1500), 1500);
eq('roundUp $0.01 -> $5', L.roundUp(1), 500);
eq('roundUp $4.99 -> $5', L.roundUp(499), 500);
eq('roundUp $5.01 -> $10', L.roundUp(501), 1000);
eq('roundUp $275 stays $275', L.roundUp(27500), 27500);
eq('roundUp $0 -> $0', L.roundUp(0), 0);
eq('roundUp negative -> 0', L.roundUp(-500), 0);
eq('roundUp NaN -> 0', L.roundUp(NaN), 0);
eq('delta $14 -> $1', L.roundUpDelta(1400), 100);
eq('delta $15 -> $0', L.roundUpDelta(1500), 0);
eq('delta $2 -> $3', L.roundUpDelta(200), 300);
// floating point trap: 0.1 + 0.2 style inputs
eq('parse "4.35" -> 435c', L.parseAmount('4.35'), 435);
eq('parse "$12.10" -> 1210c', L.parseAmount('$12.10'), 1210);
eq('parse "" -> 0', L.parseAmount(''), 0);
eq('parse "abc" -> 0', L.parseAmount('abc'), 0);
eq('parse "0" -> 0', L.parseAmount('0'), 0);
eq('parse "3.999" rounds to 400c', L.parseAmount('3.999'), 400);
eq('roundUp(parse 3.999) -> $5', L.roundUp(L.parseAmount('3.999')), 500);

/* ---------- 2. day keys & DST ---------- */
eq('shiftDay forward', L.shiftDay('2026-08-25', 1), '2026-08-26');
eq('shiftDay back over month', L.shiftDay('2026-08-01', -1), '2026-07-31');
eq('shiftDay back over year', L.shiftDay('2026-01-01', -1), '2025-12-31');
eq('leap day exists', L.shiftDay('2028-02-28', 1), '2028-02-29');
// NZ DST transitions: clocks go forward last Sun of Sep, back first Sun of Apr
eq('DST forward (NZ 27 Sep 2026)', L.shiftDay('2026-09-26', 1), '2026-09-27');
eq('DST forward +2', L.shiftDay('2026-09-26', 2), '2026-09-28');
eq('DST back (NZ 5 Apr 2026)', L.shiftDay('2026-04-04', 1), '2026-04-05');
eq('DST back +2', L.shiftDay('2026-04-04', 2), '2026-04-06');
eq('daysApart week', L.daysApart('2026-08-18', '2026-08-25'), 7);
eq('daysApart across DST', L.daysApart('2026-09-20', '2026-09-30'), 10);
eq('weekStart Tue -> Mon', L.weekStart('2026-08-25'), '2026-08-24');
eq('weekStart Mon -> itself', L.weekStart('2026-08-24'), '2026-08-24');
eq('weekStart Sun -> prev Mon', L.weekStart('2026-08-23'), '2026-08-17');

// dayStartHour: a 1:30am purchase belongs to the night before when set to 4am
var lateNight = new Date(2026, 7, 26, 1, 30).getTime();
eq('1:30am with 0h start', L.dayKey(lateNight, 0), '2026-08-26');
eq('1:30am with 4h start', L.dayKey(lateNight, 4), '2026-08-25');
var midMorning = new Date(2026, 7, 26, 9, 0).getTime();
eq('9am with 4h start', L.dayKey(midMorning, 4), '2026-08-26');

/* ---------- 3. day totals & the fixed/flex split ---------- */
var s1 = mk([
  entry('2026-08-25', 4.20, { category: 'Coffee' }),          // -> $5, jar $0.80
  entry('2026-08-25', 14.00, { category: 'Eating out' }),     // -> $15, jar $1.00
  entry('2026-08-25', 275.00, { category: 'Rent', fixed: true }) // -> $275, jar $0
]);
var t1 = L.dayTotals(s1, '2026-08-25');
eq('day total includes rent', t1.total, 29500);
eq('flex excludes rent', t1.flex, 2000);
eq('fixed is rent', t1.fixed, 27500);
eq('jar is round-up change', t1.jar, 180);
eq('entry count', t1.count, 3);
eq('empty day totals zero', L.dayTotals(s1, '2026-08-24').total, 0);

// an entry logged with a preset chip has no "actual" — must not poison the jar
var s2 = mk([entry('2026-08-25', null, { rounded: 20 })]);
eq('preset entry contributes no jar', L.dayTotals(s2, '2026-08-25').jar, 0);
eq('preset entry still counts to total', L.dayTotals(s2, '2026-08-25').total, 2000);

/* ---------- 4. tracked vs forgotten days ---------- */
var s3 = mk([entry('2026-08-24', 10)], { noSpend: ['2026-08-23'] });
ok('day with entry is tracked', L.isTracked(s3, '2026-08-24'));
ok('no-spend day is tracked', L.isTracked(s3, '2026-08-23'));
ok('forgotten day is not tracked', !L.isTracked(s3, '2026-08-22'));

/* ---------- 5. baselines ---------- */
// week7: average of TRACKED days only
var week = mk([
  entry('2026-08-18', 20), entry('2026-08-19', 40),
  entry('2026-08-20', 30), entry('2026-08-21', 10)
]);
// 4 tracked days: 20+40+30+10 = 100 -> avg 25
var b = L.baselineFor(week, '2026-08-25');
eq('avg7 over tracked days only', b.value, 2500);
eq('avg7 sample size', b.sampleDays, 4);
eq('avg7 source', b.source, 'avg7');

// a genuine no-spend day SHOULD pull the average down
var week2 = mk([
  entry('2026-08-18', 20), entry('2026-08-19', 40),
  entry('2026-08-20', 30), entry('2026-08-21', 10)
], { noSpend: ['2026-08-22'] });
eq('no-spend day counts as $0 in avg', L.baselineFor(week2, '2026-08-25').value, 2000);
eq('no-spend day grows sample', L.baselineFor(week2, '2026-08-25').sampleDays, 5);

// no history at all
eq('no history -> null baseline', L.baselineFor(mk([]), '2026-08-25'), null);
eq('first ever day -> null baseline', L.baselineFor(mk([entry('2026-08-25', 10)]), '2026-08-25'), null);

// yesterday mode
var yMode = mk([entry('2026-08-24', 60), entry('2026-08-20', 10)], { baselineMode: 'yesterday' });
var by = L.baselineFor(yMode, '2026-08-25');
eq('yesterday mode uses yesterday', by.value, 6000);
eq('yesterday mode source', by.source, 'yesterday');

// yesterday untracked -> falls back to avg, does NOT compare against $0
var yGap = mk([entry('2026-08-20', 50), entry('2026-08-21', 30)], { baselineMode: 'yesterday' });
var bg = L.baselineFor(yGap, '2026-08-25');
eq('untracked yesterday falls back', bg.source, 'avg7-fallback');
eq('fallback value is the avg', bg.value, 4000);

// rent must not distort the baseline
var rentWeek = mk([
  entry('2026-08-18', 20), entry('2026-08-19', 20),
  entry('2026-08-20', 20), entry('2026-08-21', 275, { category: 'Rent', fixed: true })
]);
eq('rent day contributes $0 flex to baseline', L.baselineFor(rentWeek, '2026-08-25').value, 1500);

// baseline window is exactly 7 days — day 8 must not count
var edge = mk([entry('2026-08-17', 100), entry('2026-08-24', 20)]);
eq('8-day-old data excluded', L.baselineFor(edge, '2026-08-25').value, 2000);
eq('...and not in the sample', L.baselineFor(edge, '2026-08-25').sampleDays, 1);

/* ---------- 6. comparison ---------- */
var cmpState = mk([
  entry('2026-08-24', 40), entry('2026-08-25', 15)
]);
var c = L.compareToBaseline(cmpState, '2026-08-25');
eq('diff is under', c.diff, -2500);
eq('pct under', c.pct, -63);
ok('winning when under', c.winning === true);

var cmpOver = mk([entry('2026-08-24', 10), entry('2026-08-25', 50)]);
ok('not winning when over', L.compareToBaseline(cmpOver, '2026-08-25').winning === false);

// equal to baseline counts as a win, not a loss
var cmpEq = mk([entry('2026-08-24', 20), entry('2026-08-25', 20)]);
eq('equal diff is zero', L.compareToBaseline(cmpEq, '2026-08-25').diff, 0);
ok('equal counts as winning', L.compareToBaseline(cmpEq, '2026-08-25').winning === true);

// baseline of $0 must not divide by zero
var cmpZero = mk([entry('2026-08-25', 20)], { noSpend: ['2026-08-24'] });
var cz = L.compareToBaseline(cmpZero, '2026-08-25');
eq('zero baseline pct is null', cz.pct, null);
eq('zero baseline diff still works', cz.diff, 2000);

// no baseline -> no fake verdict
eq('no baseline -> null diff', L.compareToBaseline(mk([entry('2026-08-25', 20)]), '2026-08-25').diff, null);

/* ---------- 7. streaks & wins ---------- */
var streakState = mk([
  entry('2026-08-21', 10), entry('2026-08-22', 10),
  entry('2026-08-23', 10), entry('2026-08-24', 10)
]);
eq('streak counts back from yesterday when today empty', L.trackingStreak(streakState, '2026-08-25'), 4);
streakState.entries.push(entry('2026-08-25', 5));
eq('streak includes today once logged', L.trackingStreak(streakState, '2026-08-25'), 5);
var broken = mk([entry('2026-08-20', 10), entry('2026-08-24', 10)]);
eq('gap breaks the streak', L.trackingStreak(broken, '2026-08-25'), 1);
eq('no data -> zero streak', L.trackingStreak(mk([]), '2026-08-25'), 0);

var winState = mk([
  entry('2026-08-19', 50), entry('2026-08-20', 50),
  entry('2026-08-21', 10), entry('2026-08-22', 10),
  entry('2026-08-23', 10), entry('2026-08-24', 10)
]);
var w = L.winsIn(winState, '2026-08-25', 7);
ok('wins counted within tracked days', w.of === 6 && w.wins >= 1 && w.wins <= 6);

/* ---------- 8. the sweep ---------- */
var sweepState = mk([
  entry('2026-08-24', 40),                       // baseline day: flex $40
  entry('2026-08-25', 4.20), entry('2026-08-25', 14.00) // today: $20 rounded, $1.80 jar
], { baselineMode: 'yesterday' });
var off = L.sweepOffer(sweepState, '2026-08-25');
eq('jar offered', off.jar, 180);
eq('bonus = how far under baseline', off.bonus, 2000);
eq('sweep total', off.total, 2180);

// sweeping the jar leaves only the bonus
sweepState.sweeps.push({ id: 1, day: '2026-08-25', kind: 'jar', cents: 180, ts: 0 });
var off2 = L.sweepOffer(sweepState, '2026-08-25');
eq('jar no longer offered twice', off2.jar, 0);
eq('bonus untouched by jar sweep', off2.bonus, 2000);

// a late entry after sweeping must offer only the NEW change, not the lot
sweepState.entries.push(entry('2026-08-25', 2.50)); // jar +$2.50, flex +$5
var off3 = L.sweepOffer(sweepState, '2026-08-25');
eq('late entry offers only new jar change', off3.jar, 250);
eq('late entry shrinks the bonus', off3.bonus, 1500);

// over baseline -> no bonus, but jar still stands
var overState = mk([entry('2026-08-24', 10), entry('2026-08-25', 44)], { baselineMode: 'yesterday' });
var offOver = L.sweepOffer(overState, '2026-08-25');
eq('no bonus when over baseline', offOver.bonus, 0);
eq('jar survives a bad day', offOver.jar, 100);

// no baseline -> jar only, no phantom bonus
var offNew = L.sweepOffer(mk([entry('2026-08-25', 12)]), '2026-08-25');
eq('day one: jar only', offNew.jar, 300);
eq('day one: no bonus', offNew.bonus, 0);

// bonus can never exceed the baseline itself
var offNoSpend = L.sweepOffer(mk([], { noSpend: ['2026-08-25'], sweeps: [] }), '2026-08-25');
eq('no-spend day with no history: nothing to sweep', offNoSpend.total, 0);
var offNoSpend2 = L.sweepOffer(
  mk([entry('2026-08-24', 30)], { noSpend: ['2026-08-25'], baselineMode: 'yesterday' }),
  '2026-08-25');
eq('no-spend day sweeps the whole baseline', offNoSpend2.bonus, 3000);

// over-sweeping is impossible
var greedy = mk([entry('2026-08-25', 12)], {
  sweeps: [{ id: 1, day: '2026-08-25', kind: 'jar', cents: 500, ts: 0 }]
});
eq('cannot sweep more than exists', L.sweepOffer(greedy, '2026-08-25').jar, 0);

/* ---------- 9. ranges ---------- */
var rangeState = mk([
  entry('2026-08-24', 20), entry('2026-08-25', 30),
  entry('2026-08-25', 275, { category: 'Rent', fixed: true }),
  entry('2026-08-31', 99) // outside the window
]);
var r = L.rangeTotals(rangeState, '2026-08-24', '2026-08-30');
eq('range total', r.total, 32500);
eq('range flex', r.flex, 5000);
eq('range fixed', r.fixed, 27500);
eq('range tracked days', r.trackedDays, 2);
eq('range avg per tracked day', r.avgFlex, 2500);
eq('avg over zero days is zero not NaN', L.rangeTotals(mk([]), '2026-08-01', '2026-08-07').avgFlex, 0);

var cats = L.categoryTotals(rangeState, '2026-08-24', '2026-08-30');
eq('categories sorted by size', cats[0].category, 'Rent');
eq('category total', cats[0].cents, 27500);

var ser = L.series(rangeState, '2026-08-25', 3);
eq('series length', ser.length, 3);
eq('untracked day is a gap, not zero', ser[0].cents, null);
eq('series ends today', ser[2].day, '2026-08-25');
eq('series today value is flex', ser[2].cents, 3000);

/* ---------- 10. formatting ---------- */
eq('fmt whole dollars', L.fmt(2000), '$20');
eq('fmt cents', L.fmt(1234), '$12.34');
eq('fmt thousands', L.fmt(123400), '$1,234');
eq('fmt zero', L.fmt(0), '$0');
eq('fmt negative', L.fmt(-500), '-$5');
eq('fmt forced whole', L.fmt(1234, { decimals: false }), '$12');
eq('fmt big', L.fmt(1234567), '$12,345.67');

/* ---------- 11. integer safety ---------- */
var drift = mk([]);
for (var i = 0; i < 300; i++) drift.entries.push(entry('2026-08-25', 0.10));
eq('300 x $0.10 rounds to 300 x $5', L.dayTotals(drift, '2026-08-25').total, 150000);
eq('...and the jar is exact', L.dayTotals(drift, '2026-08-25').jar, 147000);

/* ---------- 12. income ---------- */
function inc(day, dollars, source) {
  return { id: ++ID, ts: 0, day: day, cents: Math.round(dollars * 100), source: source || 'Wages', note: '' };
}
var incState = mk([
  entry('2026-08-24', 30),
  entry('2026-08-25', 30), entry('2026-08-25', 275, { category: 'Rent', fixed: true })
]);
incState.income = [inc('2026-08-25', 165, 'Lessons'), inc('2026-08-25', 40, 'Tips'), inc('2026-08-24', 165)];

eq('day income sums', L.dayIncome(incState, '2026-08-25'), 20500);
eq('day income ignores other days', L.dayIncome(incState, '2026-08-23'), 0);
eq('range income', L.rangeIncome(incState, '2026-08-24', '2026-08-25').total, 37000);
eq('range income count', L.rangeIncome(incState, '2026-08-24', '2026-08-25').count, 3);

// income must never touch a spend aggregate
eq('income does not change the day total', L.dayTotals(incState, '2026-08-25').total, 30500);
eq('income does not change flex', L.dayTotals(incState, '2026-08-25').flex, 3000);
eq('income does not change the jar', L.dayTotals(incState, '2026-08-25').jar, 0);
eq('income does not change the baseline', L.baselineFor(incState, '2026-08-25').value, 3000);
eq('income does not create a sweep bonus', L.sweepOffer(incState, '2026-08-25').bonus, 0);

// net counts fixed costs too — it is what you actually kept
eq('net for the day', L.netFor(incState, '2026-08-25', '2026-08-25'), 20500 - 30500);
eq('net across two days', L.netFor(incState, '2026-08-24', '2026-08-25'), 37000 - 33500);
eq('net with no income is negative spend', L.netFor(mk([entry('2026-08-25', 20)]), '2026-08-25', '2026-08-25'), -2000);
eq('net on an empty range is zero', L.netFor(mk([]), '2026-08-01', '2026-08-07'), 0);

// a day with income but no spending is not a tracked spending day
var incOnly = mk([]); incOnly.income = [inc('2026-08-25', 165)];
ok('income alone does not mark a day tracked', !L.isTracked(incOnly, '2026-08-25'));
eq('income alone leaves the day total at zero', L.dayTotals(incOnly, '2026-08-25').total, 0);

// missing income array must not throw for old saved data
eq('legacy state without income reads as zero', L.dayIncome(mk([]), '2026-08-25'), 0);
eq('legacy state range income', L.rangeIncome(mk([]), '2026-08-01', '2026-08-31').total, 0);

/* ---------- 13. where the swept money went ---------- */
var destState = mk([], { sweeps: [
  { id:1, day:'2026-08-24', kind:'jar',   cents: 380, ts:1, dest:'Wise savings' },
  { id:2, day:'2026-08-24', kind:'bonus', cents:2000, ts:2, dest:'Wise savings' },
  { id:3, day:'2026-08-25', kind:'jar',   cents: 250, ts:3, dest:'Gear fund' },
  { id:4, day:'2026-08-25', kind:'jar',   cents: 100, ts:4 }
]});
eq('total swept', L.totalSwept(destState), 2730);
eq('total swept on empty state', L.totalSwept(mk([])), 0);
var by = L.sweptByDest(destState);
eq('destinations sorted by size', by[0].dest, 'Wise savings');
eq('biggest destination total', by[0].cents, 2380);
eq('second destination', by[1].dest, 'Gear fund');
eq('sweeps with no destination are labelled', by[2].dest, 'Unassigned');
eq('destination totals add back up', by.reduce(function(a,d){return a+d.cents;},0), L.totalSwept(destState));

/* ---------- 14. total cash ---------- */
function tsEntry(ts, actualDollars, opts) {
  var e = entry('2026-08-25', actualDollars, opts);
  e.ts = ts;
  return e;
}
var cash = mk([]);
cash.income = [];
cash.cash = { anchor: 320000, ts: 1000, day: '2026-08-25' };

eq('cash with nothing logged is the anchor', L.cashNow(cash), 320000);

cash.entries.push(tsEntry(2000, 14));           // spent $14, logs as $15
cash.income.push({ id:1, ts:3000, day:'2026-08-25', cents:16500, source:'Wages', note:'' });
eq('cash follows actual spend, not the rounded figure', L.cashNow(cash), 320000 + 16500 - 1400);
eq('movement in', L.cashMovement(cash).inn, 16500);
eq('movement out is the real amount', L.cashMovement(cash).out, 1400);

// anything logged before the anchor is already baked into it
cash.entries.push(tsEntry(500, 50));
eq('entries before the anchor are ignored', L.cashNow(cash), 320000 + 16500 - 1400);
cash.income.push({ id:2, ts:400, day:'2026-08-24', cents:9900, source:'Tips', note:'' });
eq('income before the anchor is ignored', L.cashNow(cash), 320000 + 16500 - 1400);

// an entry with no actual (imported/legacy) falls back to the rounded figure
var legacy = mk([]); legacy.income = [];
legacy.cash = { anchor: 10000, ts: 0, day: '2026-08-25' };
legacy.entries.push({ id:99, ts:10, day:'2026-08-25', actual:null, rounded:2000,
  category:'Other', fixed:false, note:'', photo:null });
eq('legacy entry uses the rounded amount', L.cashNow(legacy), 8000);

// sweeps are transfers between the user's own pots — cash must not move
var cashSweep = mk([], { sweeps:[{id:1, day:'2026-08-25', kind:'jar', cents:500, ts:5000, dest:'Wise savings'}] });
cashSweep.income = [];
cashSweep.cash = { anchor: 50000, ts: 1000, day:'2026-08-25' };
eq('a sweep does not change total cash', L.cashNow(cashSweep), 50000);

// never anchored yet
eq('no anchor means no figure', L.cashNow(mk([])), null);
eq('empty movement without an anchor', L.cashMovement(mk([])).inn, 0);

// cash can legitimately go negative — do not clamp a real overdraft away
var broke = mk([]); broke.income = [];
broke.cash = { anchor: 1000, ts: 0, day:'2026-08-25' };
broke.entries.push(tsEntry(10, 50));
eq('overdrawn cash is reported honestly', L.cashNow(broke), 1000 - 5000);

/* ---------- 15. backdating ---------- */
var nowMs = new Date(2026, 7, 25, 14, 30).getTime();   // Tue 25 Aug, 2:30pm

eq('today keeps the real clock', L.timestampForDay('2026-08-25', nowMs, 0), nowMs);
var back = L.timestampForDay('2026-08-23', nowMs, 0);
eq('backdated entry lands on the chosen day', L.dayKey(back, 0), '2026-08-23');
ok('backdated entry keeps the time of day', new Date(back).getHours() === 14);
ok('backdated entry is in the past', back < nowMs);

// a future date can never be created
eq('future date collapses to now', L.timestampForDay('2026-09-01', nowMs, 0), nowMs);

// with a 4am boundary, a 2:30am clock must not push the entry a day early
var earlyMs = new Date(2026, 7, 25, 2, 30).getTime();  // 2:30am -> still "24 Aug"
eq('4am boundary: today is yesterday at 2:30am', L.dayKey(earlyMs, 4), '2026-08-24');
var back4 = L.timestampForDay('2026-08-22', earlyMs, 4);
eq('backdating respects the 4am boundary', L.dayKey(back4, 4), '2026-08-22');
ok('...by falling back to midday', new Date(back4).getHours() === 12);

// across a DST change
var dstNow = new Date(2026, 8, 28, 10, 0).getTime();   // after NZ clocks go forward
eq('backdating across DST lands right', L.dayKey(L.timestampForDay('2026-09-26', dstNow, 0), 0), '2026-09-26');

// a backdated spend before the cash anchor is already in the bank balance
var bd = mk([]); bd.income = [];
bd.cash = { anchor: 100000, ts: nowMs, day: '2026-08-25' };
bd.entries.push({ id:1, ts: L.timestampForDay('2026-08-20', nowMs, 0), day:'2026-08-20',
  actual: 5000, rounded: 5000, category:'Other', fixed:false, note:'', photo:null });
eq('backdated spend before the anchor leaves cash alone', L.cashNow(bd), 100000);
// but it still counts as spending on that day
eq('...and still counts on its own day', L.dayTotals(bd, '2026-08-20').total, 5000);
ok('...and makes that day tracked', L.isTracked(bd, '2026-08-20'));

/* ---------- report ---------- */
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
if (fail) {
  failures.forEach(function (f) { console.log('  FAIL ' + f + '\n'); });
  process.exit(1);
}
