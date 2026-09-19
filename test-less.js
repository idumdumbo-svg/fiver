/* Logic tests for the essentialist layer. Run: node test-less.js */
var L = require('./less.js');
var D = require('./dates.js');

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* Thursday 17 Sep 2026, 10:00 — week starts Monday the 14th */
var NOW = new Date(2026, 8, 17, 10, 0, 0).getTime();
var TODAY = D.dayKey(NOW, 0);
var MON = D.weekStart(TODAY);
function day(n) { return D.shiftDay(MON, n); }
function at(key, h) { var d = D.keyToDate(key); d.setHours(h, 0, 0, 0); return d.getTime(); }

function money(entries, goal) {
  return { version: 3, entries: entries, income: [], sweeps: [], noSpend: [],
    settings: { baselineMode: 'week7', dayStartHour: 0, goalDaily: goal == null ? null : goal, currency: 'NZD' } };
}
function spend(key, cents, cat, fixed, h) {
  return { id: key + cents, ts: at(key, h || 12), day: key, actual: cents, rounded: Math.ceil(cents / 500) * 500,
    currency: 'NZD', category: cat || 'Eating out', fixed: !!fixed };
}

/* ---------- 1. blank and migrate ---------- */
eq('blank has no intent', L.blankLess().intent, '');
eq('rubbish migrates to blank', L.migrateLess('nope').recurring, []);
eq('a partial object is filled in', L.migrateLess({ intent: 'Japan' }).marks, {});
eq('the intent survives', L.migrateLess({ intent: 'Japan' }).intent, 'Japan');

/* ---------- 2. the closet test ---------- */
var l = L.blankLess();
l = L.addRecurring(l, { name: 'Spotify', cents: 1699, period: 'month' });
l = L.addRecurring(l, { name: 'Gym', cents: 2200, period: 'week' });
l = L.addRecurring(l, { name: 'Adobe', cents: 8900, period: 'month' });
l = L.addRecurring(l, { name: 'Weird', cents: 100, period: 'decade' });

eq('four items', l.recurring.length, 4);
eq('a monthly figure yearly', L.yearlyCents(l.recurring[0]), 1699 * 12);
eq('a weekly figure yearly', L.yearlyCents(l.recurring[1]), 2200 * 52);
eq('an unknown period falls back to monthly', l.recurring[3].period, 'month');
eq('nothing freed yet', L.freedYearly(l), 0);

var gone = L.decideRecurring(l, l.recurring[2].id, 'go', NOW);
eq('deciding does not touch the original', l.recurring[2].decision, null);
eq('go is recorded', gone.recurring[2].decision, 'go');
eq('with a timestamp', gone.recurring[2].decided, NOW);
eq('freed is the yearly figure', L.freedYearly(gone), 8900 * 12);

var both = L.decideRecurring(gone, l.recurring[1].id, 'go', NOW);
eq('freed adds up', L.freedYearly(both), 8900 * 12 + 2200 * 52);
var kept = L.decideRecurring(both, l.recurring[1].id, 'keep', NOW);
eq('changing your mind takes it back out', L.freedYearly(kept), 8900 * 12);
var undec = L.decideRecurring(kept, l.recurring[2].id, 'maybe', NOW);
eq('a nonsense decision clears it', undec.recurring[2].decision, null);
eq('and clears the stamp', undec.recurring[2].decided, 0);

var order = L.sortedRecurring(both).map(function (r) { return r.name; });
eq('undecided first, then kept, then gone, biggest yearly first within', order, ['Spotify', 'Weird', 'Gym', 'Adobe']);

eq('update renames', L.updateRecurring(l, l.recurring[0].id, { name: 'Spotify Duo' }).recurring[0].name, 'Spotify Duo');
eq('remove removes', L.removeRecurring(l, l.recurring[0].id).recurring.length, 3);
eq('blank names get a label', L.addRecurring(L.blankLess(), { cents: 5 }).recurring[0].name, 'Untitled');

/* ---------- 3. marks and the line ---------- */
var m = L.markEntry(L.blankLess(), 'e1', 'no');
eq('a mark is kept', L.markOf(m, 'e1'), 'no');
eq('an unmarked entry is null', L.markOf(m, 'e2'), null);
eq('a bad mark clears', L.markOf(L.markEntry(m, 'e1', 'meh'), 'e1'), null);
eq('marking is a copy', L.markOf(L.blankLess(), 'e1'), null);

var ln = L.setLine(L.blankLess(), MON, '  Sent the email.  ');
eq('the line is trimmed', L.lineFor(ln, MON), 'Sent the email.');
eq('another week is empty', L.lineFor(ln, D.shiftDay(MON, -7)), '');
eq('an empty line deletes', L.lineFor(L.setLine(ln, MON, '   '), MON), '');

/* ---------- 4. buffer ---------- */
var s = money([spend(TODAY, 4500), spend(TODAY, 1720), spend(TODAY, 60000, 'Rent', true)], 8000);
var b = L.bufferLeft(s, TODAY);
eq('buffer is line minus flex', b.left, 8000 - 4500 - 2000);
eq('rent is not in it', b.spent, 6500);
eq('source is the goal', b.source, 'goal');
eq('no target, no buffer', L.bufferLeft(money([]), TODAY), null);
var over = L.bufferLeft(money([spend(TODAY, 9900)], 8000), TODAY);
eq('over the line goes negative', over.left, 8000 - 10000);

/* ---------- 5. the week wall ---------- */
var w = money([
  spend(day(0), 3000), spend(day(1), 4000),
  spend(day(2), 9500)
], 8000);
w.noSpend = [day(3)];
var wall = L.weekWall(w, TODAY);
eq('four days so far', wall.days.length, 4);
eq('monday inside', wall.days[0].state, 'inside');
eq('wednesday over', wall.days[2].state, 'over');
eq('thursday is a no-spend day', wall.days[3].state, 'none');
eq('three of four judged inside', [wall.under, wall.judged], [3, 4]);

var wall2 = L.weekWall(money([spend(day(0), 3000)], 8000), TODAY);
eq('an unlogged day is untracked, not over', wall2.days[1].state, 'untracked');
eq('and is not judged', wall2.judged, 1);

var noLine = L.weekWall(money([spend(day(0), 3000)]), TODAY);
eq('with no line at all, a logged day is inside', noLine.days[0].state, 'inside');
eq('but nothing is judged', noLine.judged, 0);

/* ---------- 6. the three biggest ---------- */
var big = money([
  spend(day(0), 12000, 'Snow / gear'), spend(day(1), 6500, 'Transport'),
  spend(day(2), 5800, 'Eating out'), spend(TODAY, 500, 'Coffee'),
  spend(day(1), 60000, 'Rent', true),
  spend(D.shiftDay(MON, -1), 30000, 'Shopping')
]);
var top = L.biggestThisWeek(big, TODAY, 3).map(function (e) { return e.category; });
eq('biggest three, rent excluded, last week excluded', top, ['Snow / gear', 'Transport', 'Eating out']);
eq('n is honoured', L.biggestThisWeek(big, TODAY, 1).length, 1);
eq('an empty week is empty', L.biggestThisWeek(money([]), TODAY, 3), []);

/* ---------- 7. noes and the day ---------- */
var curb = { averted: [
  { id: 'a1', ts: at(day(0), 14), day: day(0), cents: 3500, category: 'Eating out' },
  { id: 'a2', ts: at(TODAY, 14), day: TODAY, cents: 500, category: 'Coffee' },
  { id: 'a3', ts: at(D.shiftDay(MON, -2), 14), day: D.shiftDay(MON, -2), cents: 9000, category: 'Shopping' }
] };
var noes = L.noesThisWeek(curb, TODAY);
eq('two noes this week', noes.count, 2);
eq('worth forty dollars', noes.cents, 4000);
eq('no curb, no noes', L.noesThisWeek({}, TODAY).count, 0);

var mixed = L.dayWithNoes(money([spend(TODAY, 4500, 'Groceries', false, 9), spend(TODAY, 500, 'Coffee', false, 16)]), curb, TODAY);
eq('spends and noes in one list', mixed.length, 3);
eq('newest first', mixed.map(function (x) { return x.kind; }), ['spend', 'no', 'spend']);
eq('the no carries its amount', mixed[1].averted.cents, 500);

console.log('');
failures.forEach(function (f) { console.log('  FAIL ' + f); });
console.log('  less: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
