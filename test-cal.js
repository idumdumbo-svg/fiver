/* Logic tests for the food side. Run: node test-cal.js */
var C = require('./calories.js');
var D = require('./dates.js');

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

var ID = 0;
function e(day, kcal, opts) {
  opts = opts || {};
  return { id: ++ID, ts: opts.ts || 0, day: day, kcal: kcal,
           label: opts.label || 'Something', savedId: opts.savedId || null };
}
function mk(entries, opts) {
  opts = opts || {};
  return {
    entries: entries || [], foods: opts.foods || [],
    settings: { dailyBudget: opts.daily === undefined ? 2200 : opts.daily,
                weeklyBudget: opts.weekly || null }
  };
}

/* ---------- 1. estimates round up ---------- */
eq('237 -> 240', C.roundKcal(237), 240);
eq('200 stays 200', C.roundKcal(200), 200);
eq('201 -> 210', C.roundKcal(201), 210);
eq('1 -> 10', C.roundKcal(1), 10);
eq('0 -> 0', C.roundKcal(0), 0);
eq('negative -> 0', C.roundKcal(-50), 0);
eq('NaN -> 0', C.roundKcal(NaN), 0);
eq('parse "450"', C.parseKcal('450'), 450);
eq('parse "450 kcal"', C.parseKcal('450 kcal'), 450);
eq('parse junk', C.parseKcal('abc'), 0);
eq('parse empty', C.parseKcal(''), 0);
eq('parse decimal drops the fraction', C.parseKcal('237.8'), 2378);
eq('absurd input is capped', C.parseKcal('999999'), 20000);

// the one-tap amounts are the ones asked for
eq('quick amounts', C.QUICK_KCAL.map(function (q) { return q.kcal; }), [100, 200, 300, 600, 900]);

/* ---------- 2. day totals ---------- */
var d1 = mk([e('2026-08-25', 600), e('2026-08-25', 200), e('2026-08-24', 1800)]);
eq('day total', C.dayKcal(d1, '2026-08-25').total, 800);
eq('day count', C.dayKcal(d1, '2026-08-25').count, 2);
eq('empty day', C.dayKcal(d1, '2026-08-23').total, 0);
ok('logged day', C.isLogged(d1, '2026-08-25'));
ok('unlogged day', !C.isLogged(d1, '2026-08-23'));

/* ---------- 3. averages skip forgotten days ---------- */
var wk = mk([
  e('2026-08-20', 2000), e('2026-08-21', 2400),
  e('2026-08-23', 1600)   // 22nd never logged
]);
eq('average over logged days only', C.avgKcal(wk, '2026-08-25', 7).value, 2000);
eq('sample size is logged days', C.avgKcal(wk, '2026-08-25', 7).sampleDays, 3);
eq('no history -> null', C.avgKcal(mk([]), '2026-08-25', 7), null);
eq('today is not in its own average',
   C.avgKcal(mk([e('2026-08-25', 5000), e('2026-08-24', 1000)]), '2026-08-25', 7).value, 1000);
// a day outside the window must not count
eq('8-day-old day excluded',
   C.avgKcal(mk([e('2026-08-17', 9000), e('2026-08-24', 2000)]), '2026-08-25', 7).value, 2000);

/* ---------- 4. the budget ---------- */
var b = mk([e('2026-08-25', 1800)]);
var c = C.compareToBudget(b, '2026-08-25');
eq('under budget diff', c.diff, -400);
eq('calories left', c.left, 400);
ok('not over', c.over === false);
eq('percent of budget', c.pct, 82);

var over = mk([e('2026-08-25', 2600)]);
var co = C.compareToBudget(over, '2026-08-25');
eq('over budget diff', co.diff, 400);
eq('nothing left when over', co.left, 0);
ok('flagged over', co.over === true);

// exactly on budget is not over
var exact = mk([e('2026-08-25', 2200)]);
ok('exactly on budget is not over', C.compareToBudget(exact, '2026-08-25').over === false);
eq('exactly on budget leaves nothing', C.compareToBudget(exact, '2026-08-25').left, 0);

// no budget set -> no verdict, no divide by zero
var nob = mk([e('2026-08-25', 1800)], { daily: 0 });
eq('no budget -> null diff', C.compareToBudget(nob, '2026-08-25').diff, null);
eq('no budget -> null pct', C.compareToBudget(nob, '2026-08-25').pct, null);
eq('no budget -> daily is null', C.dailyBudget(nob), null);

/* ---------- 5. weekly ---------- */
eq('weekly defaults to 7 x daily', C.weeklyBudget(mk([])).value, 15400);
ok('...and is marked as derived', C.weeklyBudget(mk([])).explicit === false);
eq('explicit weekly wins', C.weeklyBudget(mk([], { weekly: 14000 })).value, 14000);
ok('...and is marked explicit', C.weeklyBudget(mk([], { weekly: 14000 })).explicit === true);
eq('no daily and no weekly -> null', C.weeklyBudget(mk([], { daily: 0 })), null);

// Tue 25 Aug 2026; week starts Mon 24
var wp = C.weekProgress(mk([e('2026-08-24', 2000), e('2026-08-25', 1500)]), '2026-08-25');
eq('week to date total', wp.total, 3500);
eq('week logged days', wp.loggedDays, 2);
eq('week elapsed days', wp.elapsedDays, 2);
eq('week budget', wp.budget, 15400);
eq('week left', wp.left, 11900);
// a mid-week gap doesn't inflate the total
var wpGap = C.weekProgress(mk([e('2026-08-24', 2000)]), '2026-08-25');
eq('unlogged day adds nothing', wpGap.total, 2000);
eq('...but the week has still elapsed', wpGap.elapsedDays, 2);

/* ---------- 6. days under ---------- */
var du = mk([
  e('2026-08-25', 2000), e('2026-08-24', 2500),
  e('2026-08-23', 1900), e('2026-08-22', 2100)
]);
eq('days under budget', C.daysUnder(du, '2026-08-25', 7).under, 3);
eq('of logged days', C.daysUnder(du, '2026-08-25', 7).of, 4);
eq('no budget -> nothing counted', C.daysUnder(mk([e('2026-08-25', 100)], { daily: 0 }), '2026-08-25', 7).under, 0);

/* ---------- 7. streak ---------- */
var st = mk([e('2026-08-22', 100), e('2026-08-23', 100), e('2026-08-24', 100)]);
eq('streak counts back from yesterday when today is empty', C.loggingStreak(st, '2026-08-25'), 3);
st.entries.push(e('2026-08-25', 100));
eq('streak includes today once logged', C.loggingStreak(st, '2026-08-25'), 4);
eq('a gap breaks it', C.loggingStreak(mk([e('2026-08-20', 100), e('2026-08-24', 100)]), '2026-08-25'), 1);
eq('nothing logged -> 0', C.loggingStreak(mk([]), '2026-08-25'), 0);

/* ---------- 8. series ---------- */
var ser = C.kcalSeries(mk([e('2026-08-25', 1000), e('2026-08-23', 2000)]), '2026-08-25', 3);
eq('series length', ser.length, 3);
eq('oldest first', ser[0].day, '2026-08-23');
eq('gap is null not zero', ser[1].kcal, null);
eq('today last', ser[2].kcal, 1000);

/* ---------- 9. saved foods ---------- */
var foods = mk([], { foods: [
  { id: 'a', name: 'Flat white', kcal: 120, uses: 2, lastUsed: 10 },
  { id: 'b', name: 'Porridge', kcal: 350, uses: 9, lastUsed: 5 },
  { id: 'c', name: 'Pie', kcal: 700, uses: 2, lastUsed: 40 }
]});
eq('most used first', C.sortedFoods(foods).map(function (f) { return f.id; }), ['b', 'c', 'a']);
eq('found by id', C.findFood(foods, 'b').name, 'Porridge');
eq('missing id -> null', C.findFood(foods, 'zz'), null);
eq('found by name', C.foodByName(foods, 'flat white').id, 'a');
eq('name match ignores spacing', C.foodByName(foods, '  Flat   White ').id, 'a');
eq('unknown name -> null', C.foodByName(foods, 'Sushi'), null);
eq('empty name -> null', C.foodByName(foods, '   '), null);

var used = mk([
  e('2026-08-25', 350, { savedId: 'b' }),
  e('2026-08-24', 350, { savedId: 'b' }),
  e('2026-08-24', 120, { savedId: 'a' })
], { foods: foods.foods });
eq('totals for a saved food', C.totalsForFood(used, 'b').total, 700);
eq('count for a saved food', C.totalsForFood(used, 'b').count, 2);
eq('date-bounded totals', C.totalsForFood(used, 'b', '2026-08-25', '2026-08-25').total, 350);
eq('untouched food totals zero', C.totalsForFood(used, 'c').count, 0);

/* ---------- 10. formatting + isolation ---------- */
eq('thousands separator', C.fmtKcal(1850), '1,850');
eq('small number', C.fmtKcal(300), '300');
eq('zero', C.fmtKcal(0), '0');

// The food module must not read or need anything from the money state.
var moneyish = { entries: [{ day: '2026-08-25', rounded: 1500, actual: 1400, fixed: false }] };
eq('a foreign entry contributes 0, not NaN', C.dayKcal(moneyish, '2026-08-25').total, 0);
ok('missing food fields do not throw', C.dayKcal({}, '2026-08-25').total === 0);
ok('missing foods list is fine', C.sortedFoods({}).length === 0);
ok('missing settings is fine', C.dailyBudget({}) === null);

/* ---------- report ---------- */
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
if (fail) { failures.forEach(function (f) { console.log('  FAIL ' + f + '\n'); }); process.exit(1); }
