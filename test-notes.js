/* Logic tests for notes & reminders. Run: node test-notes.js */
var N = require('./notes.js');
var D = require('./dates.js');

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// Tuesday 8 Sep 2026, 10:00 local
var NOW = new Date(2026, 8, 8, 10, 0, 0).getTime();
var TODAY = D.dayKey(NOW, 0);
function at(d, h, m) { var x = new Date(NOW); x.setDate(x.getDate() + d); x.setHours(h, m || 0, 0, 0); return x.getTime(); }

/* ---------- 1. parsing "when" ---------- */
var p = N.parseNote('call mum', NOW);
eq('plain text has no time', [p.text, p.due], ['call mum', null]);
p = N.parseNote('call mum tomorrow', NOW);
eq('tomorrow is an all-day reminder', [p.text, p.due, p.hasTime], ['call mum', at(1, 0), false]);
p = N.parseNote('call mum tomorrow 9am', NOW);
eq('tomorrow 9am', [p.text, p.due, p.hasTime], ['call mum', at(1, 9), true]);
p = N.parseNote('call mum 9am tomorrow', NOW);
eq('9am tomorrow (either order)', [p.text, p.due], ['call mum', at(1, 9)]);
p = N.parseNote('call mum tomorrow at 9:30pm', NOW);
eq('"at" is swallowed', [p.text, p.due], ['call mum', at(1, 21, 30)]);
p = N.parseNote('gym 6pm', NOW);
eq('a bare time still ahead means today', [p.text, p.due], ['gym', at(0, 18)]);
p = N.parseNote('gym 6am', NOW);
eq('a bare time already passed means tomorrow', [p.text, p.due], ['gym', at(1, 6)]);
p = N.parseNote('wax board tonight', NOW);
eq('tonight defaults to 8pm', [p.text, p.due, p.hasTime], ['wax board', at(0, 20), true]);
p = N.parseNote('pay rent fri', NOW);
eq('weekday name → next such day (Tue→Fri = +3)', [p.text, p.due], ['pay rent', at(3, 0)]);
p = N.parseNote('pay rent tue', NOW);
eq('same weekday means next week, not today', p.due, at(7, 0));
p = N.parseNote('book lesson monday 7am', NOW);
eq('full weekday name + time', [p.text, p.due], ['book lesson', at(6, 7)]);
p = N.parseNote('check lift status in 2h', NOW);
eq('"in 2h" is relative', [p.text, p.due, p.hasTime], ['check lift status', NOW + 2 * 36e5, true]);
p = N.parseNote('reply to kyoko in 30m', NOW);
eq('"in 30m"', p.due, NOW + 30 * 6e4);
p = N.parseNote('renew visa in 3d', NOW);
eq('"in 3d" is all-day', [p.due, p.hasTime], [NOW + 3 * 864e5, false]);
p = N.parseNote('buy 9 eggs', NOW);
eq('a bare number is not a time', [p.text, p.due], ['buy 9 eggs', null]);
p = N.parseNote('tomorrow never comes', NOW);
eq('a when-word not at the end is left alone', [p.text, p.due], ['tomorrow never comes', null]);
p = N.parseNote('mon', NOW);
eq('a line that is only a when-word keeps its text', [p.text, p.due != null], ['mon', true]);
p = N.parseNote('  spaced   out   text  ', NOW);
eq('whitespace is tidied', p.text, 'spaced out text');
p = N.parseNote('13pm nonsense', NOW);
eq('13pm is not a time', p.due, null);
p = N.parseNote('meet at 14:30', NOW);
eq('24h time works', p.due, at(0, 14, 30));

/* ---------- 2. notes lifecycle ---------- */
var s = N.blankNotes();
var a = N.addNote(s, 'wax board', NOW);
var b = N.addNote(s, 'call mum tomorrow 9am', NOW + 1);
var c = N.addNote(s, 'gym 6pm', NOW + 2);
ok('empty text is refused', N.addNote(s, '   ', NOW) === null);
eq('three notes stored', s.notes.length, 3);
eq('reminders first, soonest at the top, then plain notes oldest first',
  N.openNotes(s).map(function (x) { return x.text; }), ['gym', 'call mum', 'wax board']);
N.addNote(s, 'another plain one', NOW + 3);
eq('a new plain note goes to the BOTTOM (queue, not feed)',
  N.openNotes(s).map(function (x) { return x.text; }), ['gym', 'call mum', 'wax board', 'another plain one']);

ok('complete returns the note', N.completeNote(s, a.id, NOW + 100) === a);
eq('it leaves the open list', N.openNotes(s).length, 3);
eq('and joins done', N.doneNotes(s).map(function (x) { return x.id; }), [a.id]);
ok('completing twice is a no-op', N.completeNote(s, a.id, NOW + 200) === null);
eq('done timestamp is the first one', a.done, NOW + 100);
ok('reopen brings it back', N.reopenNote(s, a.id) === a && !a.done);
eq('open again', N.openNotes(s).length, 4);
ok('remove returns it', N.removeNote(s, a.id) === a);
ok('remove of unknown id is null', N.removeNote(s, 'nope') === null);
eq('gone', s.notes.length, 3);

/* ---------- 3. done notes fade after a week ---------- */
s = N.blankNotes();
var old = N.addNote(s, 'old', NOW - 10 * 864e5); N.completeNote(s, old.id, NOW - 8 * 864e5);
var recent = N.addNote(s, 'recent', NOW - 2 * 864e5); N.completeNote(s, recent.id, NOW - 6 * 864e5);
var open = N.addNote(s, 'still open', NOW - 30 * 864e5);
eq('prune drops one', N.pruneDone(s, NOW), 1);
eq('the eight-day-old one', s.notes.map(function (x) { return x.text; }), ['recent', 'still open']);
ok('an old OPEN note is never pruned', s.notes.some(function (x) { return x.text === 'still open'; }));

/* ---------- 4. due states & labels ---------- */
s = N.blankNotes();
var late = N.addNote(s, 'late 8am', NOW);           // 8am already passed → tomorrow 8am
late.due = at(0, 8);                                  // force it into the past for the test
var soon = N.addNote(s, 'soon 6pm', NOW);
var tmrw = N.addNote(s, 'tmrw tomorrow', NOW);
var plain = N.addNote(s, 'plain', NOW);
eq('past time is overdue', N.dueState(late, NOW), 'overdue');
eq('later today is today', N.dueState(soon, NOW), 'today');
eq('tomorrow is later', N.dueState(tmrw, NOW), 'later');
eq('no time → no state', N.dueState(plain, NOW), null);
var allToday = N.addNote(s, 'allday today', NOW);
eq('an all-day reminder for today stays "today" all day, never overdue', N.dueState(allToday, NOW + 12 * 36e5), 'today');
eq('…until the day is over', N.dueState(allToday, NOW + 24 * 36e5), 'overdue');
eq('label: today with a time shows just the time', N.fmtWhen(soon, NOW), '6pm');
eq('label: tomorrow all-day', N.fmtWhen(tmrw, NOW), 'Tomorrow');
eq('label: tomorrow with time', N.fmtWhen(N.addNote(s, 'x tomorrow 9:30am', NOW), NOW), 'Tomorrow 9:30am');
eq('label: within the week shows the weekday', N.fmtWhen(N.addNote(s, 'x fri', NOW), NOW), 'Fri');
eq('label: further out shows the date', N.fmtWhen(N.addNote(s, 'x in 20d', NOW), NOW), '28 Sep');
eq('label: yesterday', N.fmtWhen({ due: at(-1, 9), allDay: false }, NOW), 'Yesterday 9am');

/* ---------- 5. "due now" fires once ---------- */
s = N.blankNotes();
var r = N.addNote(s, 'ring 11am', NOW);
eq('not due yet', N.dueNow(s, NOW).length, 0);
eq('due at 11', N.dueNow(s, at(0, 11)).map(function (x) { return x.id; }), [r.id]);
r.notified = true;
eq('once told, not again', N.dueNow(s, at(0, 11, 5)).length, 0);
var ad = N.addNote(s, 'allday tomorrow', NOW);
eq('all-day reminders never "fire" — nothing to alert at', N.dueNow(s, at(1, 12)).length, 0);
N.completeNote(s, r.id, NOW); r.notified = false;
eq('done notes never fire', N.dueNow(s, at(0, 12)).length, 0);

/* ---------- 6. today: a plan of three ---------- */
s = N.blankNotes();
var n1 = N.addNote(s, 'one', NOW), n2 = N.addNote(s, 'two', NOW + 1),
    n3 = N.addNote(s, 'three', NOW + 2), n4 = N.addNote(s, 'four', NOW + 3);
eq('nothing planned to start', N.todayNotes(s, TODAY).length, 0);
eq('everything is in later', N.laterNotes(s, TODAY).length, 4);
ok('plan one', N.planToday(s, n1.id, TODAY));
ok('plan two', N.planToday(s, n2.id, TODAY));
ok('plan three', N.planToday(s, n3.id, TODAY));
ok('the fourth is refused', !N.planToday(s, n4.id, TODAY));
ok('plan is full', N.planFull(s, TODAY));
eq('today holds three', N.todayNotes(s, TODAY).map(function (x) { return x.text; }), ['one', 'two', 'three']);
eq('later holds the rest', N.laterNotes(s, TODAY).map(function (x) { return x.text; }), ['four']);
ok('tapping a planned one takes it off', N.planToday(s, n2.id, TODAY) && n2.today === null);
ok('which makes room', N.planToday(s, n4.id, TODAY));
eq('progress 0 of 3', N.todayProgress(s, TODAY), { done: 0, of: 3, complete: false });
N.completeNote(s, n1.id, NOW + 10);
eq('progress 1 of 3', N.todayProgress(s, TODAY), { done: 1, of: 3, complete: false });
eq('done items leave the today list but still count', N.todayNotes(s, TODAY).length, 2);
N.completeNote(s, n3.id, NOW + 11); N.completeNote(s, n4.id, NOW + 12);
eq('all three done = day complete', N.todayProgress(s, TODAY).complete, true);
eq('an empty plan is not "complete"', N.todayProgress(N.blankNotes(), TODAY), { done: 0, of: 0, complete: false });
ok('a done note cannot be planned', !N.planToday(s, n1.id, TODAY));

/* ---------- 7. midnight: honest carry-over ---------- */
s = N.blankNotes();
var YDAY = D.shiftDay(TODAY, -1);
var did = N.addNote(s, 'did it', NOW - 864e5), didnt = N.addNote(s, 'did not', NOW - 864e5);
s.lastDay = YDAY;
N.planToday(s, did.id, YDAY); N.planToday(s, didnt.id, YDAY);
N.completeNote(s, did.id, NOW - 36e5);
var carried = N.rollover(s, TODAY);
eq('the unfinished one is carried', carried.map(function (x) { return x.text; }), ['did not']);
eq('it is back in later with a count', [didnt.today, didnt.carried], [null, 1]);
eq('the finished one is untouched', [did.today, did.done > 0], [YDAY, true]);
eq('lastDay moves on', s.lastDay, TODAY);
eq('rolling over again the same day does nothing', N.rollover(s, TODAY).length, 0);
ok('first ever open sets lastDay without carrying', (function () {
  var f = N.blankNotes(); var x = N.addNote(f, 'x', NOW); x.today = YDAY;
  return N.rollover(f, TODAY).length === 0 && f.lastDay === TODAY;
})());
didnt.carried = 2;
ok('two carries: no decision yet', !N.needsDecision(didnt));
didnt.carried = 3;
ok('three carries: time to decide', N.needsDecision(didnt));

/* ---------- 8. basics ---------- */
s = N.blankNotes();
var gym = N.addBasic(s, 'Gym', NOW), jp = N.addBasic(s, '  Japanese  15 min ', NOW + 1);
eq('names are tidied', jp.name, 'Japanese 15 min');
ok('duplicates (any case) refused', N.addBasic(s, 'gym', NOW) === null);
ok('empty refused', N.addBasic(s, '', NOW) === null);
eq('long names are cut to 24', N.addBasic(s, 'a very long basic name that goes on and on', NOW).name.length, 24);
N.removeBasic(s, s.basics[2].id);
eq('two basics', s.basics.length, 2);
eq('nothing ticked', N.basicsProgress(s, TODAY), { done: 0, of: 2, complete: false });
ok('tick returns true', N.tickBasic(s, gym.id, TODAY) === true);
ok('done today', N.basicDone(gym, TODAY));
ok('untick returns false', N.tickBasic(s, gym.id, TODAY) === false);
N.tickBasic(s, gym.id, TODAY); N.tickBasic(s, jp.id, TODAY);
eq('all ticked = complete', N.basicsProgress(s, TODAY).complete, true);
ok('unknown basic is null', N.tickBasic(s, 'nope', TODAY) === null);

// streaks
gym.days = {}; [3, 2, 1].forEach(function (d) { gym.days[D.shiftDay(TODAY, -d)] = true; });
eq('three days ending yesterday, today not yet ticked → 3 (does not drop at breakfast)', N.basicStreak(gym, TODAY), 3);
gym.days[TODAY] = true;
eq('tick today → 4', N.basicStreak(gym, TODAY), 4);
gym.days = {}; gym.days[D.shiftDay(TODAY, -2)] = true; gym.days[D.shiftDay(TODAY, -3)] = true;
eq('a gap yesterday breaks it → 0', N.basicStreak(gym, TODAY), 0);
eq('no history → 0', N.basicStreak({ days: {} }, TODAY), 0);
eq('basics with no days do not count as complete', N.basicsProgress(N.blankNotes(), TODAY), { done: 0, of: 0, complete: false });

/* ---------- report ---------- */
console.log('\nnotes: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n' + failures.map(function (f) { return '  ✗ ' + f; }).join('\n\n')); process.exit(1); }
