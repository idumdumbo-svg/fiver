/* ============================================================
   FIVER / NOTES — notes and reminders. Pure functions, no DOM.

   Self-contained like the food side: its own state shape, its own
   storage key, borrows only dates.js. A note is a line of text;
   a reminder is a note with a time on it. That is the whole model.

   Three ideas, each doing one job:

   TODAY is a plan of at most three things. You choose them; nothing
   is put there for you. Three is the cap because a plan you can hold
   in your head is a plan you finish, and finishing is what builds
   the habit of planning. Everything else waits in LATER.

   BASICS are the handful of things you want to do every day — the
   gym, fifteen minutes of Japanese, logging your spend. They reset
   at midnight, one tap each, and keep a quiet count of days in a
   row. No fire emoji. The number is the reward.

   CARRY-OVER is honest. A Today item not done by midnight goes back
   to Later with a count of how many times it has been carried. It
   is not nagged about; it is just visible. After three carries the
   app says so, once — the point is to notice that either the thing
   matters and needs a real slot, or it doesn't and can go.

   The "when" parser is deliberately narrow. It only reads a time
   phrase at the END of the line ("call mum tomorrow 9am"), and
   only from a short list of shapes, so a note never gets mangled
   by a word that happened to look like a date. Anything it
   doesn't recognise stays as text.
   ============================================================ */

if (typeof dayKey === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./dates.js'));
}

var NOTE_DONE_KEEP_DAYS = 7;
var TODAY_CAP = 3;
var CARRY_NUDGE_AT = 3;
var DOWS = ['sun','mon','tue','wed','thu','fri','sat'];
var DOW_FULL = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function blankNotes() {
  return { version: 1, notes: [], basics: [], settings: { notify: false }, lastDay: null };
}

/* ---------- parsing "when" off the end of a line ---------- */

function _startOfDay(now) {
  var d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime();
}
function _timeToken(tok) {
  // 9am, 9pm, 9:30am, 21:00, 9.30pm
  var m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/i.exec(tok);
  if (!m) return null;
  var h = +m[1], min = m[2] ? +m[2] : 0, ap = m[3] ? m[3].toLowerCase() : null;
  if (min > 59) return null;
  if (ap) { if (h < 1 || h > 12) return null; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
  else { if (!m[2]) return null; if (h > 23) return null; }   // bare "9" is not a time
  return { h: h, min: min };
}
function _dayToken(tok, now) {
  var t = tok.toLowerCase();
  var day0 = _startOfDay(now);
  if (t === 'today') return { day: day0, dflt: null };
  if (t === 'tonight') return { day: day0, dflt: { h: 20, min: 0 } };
  if (t === 'tomorrow' || t === 'tmrw' || t === 'tmr') return { day: day0 + 864e5, dflt: null };
  var di = DOWS.indexOf(t.slice(0, 3));
  if (di >= 0 && (DOWS[di] === t || DOW_FULL[di] === t)) {
    var cur = new Date(now).getDay();
    var ahead = (di - cur + 7) % 7; if (ahead === 0) ahead = 7;   // "mon" on a Monday means next Monday
    return { day: day0 + ahead * 864e5, dflt: null };
  }
  return null;
}
/* parseNote("call mum tomorrow 9am", now) ->
   { text:"call mum", due: <ts> | null, hasTime: bool } */
function parseNote(raw, now) {
  var text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { text: '', due: null, hasTime: false };
  var words = text.split(' ');
  var day = null, time = null, used = 0;

  // "in 2h" / "in 30m" / "in 3d"
  var n = words.length;
  if (n >= 2 && words[n - 2].toLowerCase() === 'in') {
    var m = /^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/i.exec(words[n - 1]);
    if (m) {
      var q = +m[1], u = m[2][0].toLowerCase();
      var ms = u === 'm' ? q * 6e4 : u === 'h' ? q * 36e5 : q * 864e5;
      return { text: words.slice(0, n - 2).join(' ') || text, due: now + ms, hasTime: u !== 'd' };
    }
  }

  // read up to three trailing tokens: [day] [at] [time] in either order
  for (var i = n - 1; i >= 0 && used < 3; i--) {
    var tok = words[i].replace(/,$/, '');
    if (tok.toLowerCase() === 'at' && time) { used++; continue; }
    var tt = !time && _timeToken(tok);
    if (tt) { time = tt; used++; continue; }
    var dd = !day && _dayToken(tok, now);
    if (dd) { day = dd; used++; continue; }
    break;
  }
  if (!day && !time) return { text: text, due: null, hasTime: false };
  // a time with no day: today if still ahead, else tomorrow
  var base = day ? day.day : _startOfDay(now);
  var tm = time || (day && day.dflt);
  var due;
  if (tm) {
    due = base + tm.h * 36e5 + tm.min * 6e4;
    if (!day && due <= now) due += 864e5;
  } else {
    due = base;   // all-day: midnight marks the day; shown without a time
  }
  var rest = words.slice(0, n - used).join(' ').replace(/[,\s]+$/, '');
  return { text: rest || text, due: due, hasTime: !!tm };
}

/* ---------- state ---------- */

function addNote(state, raw, now) {
  var p = parseNote(raw, now);
  if (!p.text) return null;
  var note = { id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6),
               text: p.text, due: p.due, allDay: !!(p.due && !p.hasTime),
               created: now, done: null, notified: false, today: null, carried: 0 };
  state.notes.push(note);
  return note;
}
function completeNote(state, id, now) {
  var nn = state.notes.filter(function (x) { return x.id === id; })[0];
  if (!nn || nn.done) return null;
  nn.done = now; return nn;
}
function reopenNote(state, id) {
  var nn = state.notes.filter(function (x) { return x.id === id; })[0];
  if (!nn) return null;
  nn.done = null; nn.notified = false; return nn;
}
function removeNote(state, id) {
  var i = state.notes.findIndex(function (x) { return x.id === id; });
  if (i < 0) return null;
  return state.notes.splice(i, 1)[0];
}

/* ---------- today: a plan of three ---------- */

function todayNotes(state, todayKey) {
  return openNotes(state).filter(function (x) { return x.today === todayKey; });
}
function laterNotes(state, todayKey) {
  return openNotes(state).filter(function (x) { return x.today !== todayKey; });
}
/* Put a note on today's plan, or take it off. Returns false when the
   plan is already full — the cap is the feature, so it is never bent. */
function planToday(state, id, todayKey) {
  var nn = state.notes.filter(function (x) { return x.id === id && !x.done; })[0];
  if (!nn) return false;
  if (nn.today === todayKey) { nn.today = null; return true; }
  if (todayNotes(state, todayKey).length >= TODAY_CAP) return false;
  nn.today = todayKey; return true;
}
function planFull(state, todayKey) { return todayNotes(state, todayKey).length >= TODAY_CAP; }
function todayProgress(state, todayKey) {
  var planned = state.notes.filter(function (x) { return x.today === todayKey; });
  var done = planned.filter(function (x) { return x.done; }).length;
  return { done: done, of: planned.length, complete: planned.length > 0 && done === planned.length };
}

/* Midnight. Unfinished Today items go back to Later and remember they
   were carried; basics reset by virtue of being keyed by day. Returns
   the notes that were carried so the UI can mention it once. */
function rollover(state, todayKey) {
  var carried = [];
  if (state.lastDay && state.lastDay !== todayKey) {
    state.notes.forEach(function (x) {
      if (!x.done && x.today && x.today < todayKey) {
        x.today = null; x.carried = (x.carried || 0) + 1; carried.push(x);
      }
    });
  }
  state.lastDay = todayKey;
  return carried;
}
function needsDecision(note) { return (note.carried || 0) >= CARRY_NUDGE_AT; }

/* ---------- basics: the same few things, every day ---------- */

function addBasic(state, name, now) {
  name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!name) return null;
  if (state.basics.some(function (b) { return b.name.toLowerCase() === name.toLowerCase(); })) return null;
  var b = { id: 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6), name: name, days: {}, created: now };
  state.basics.push(b);
  return b;
}
function removeBasic(state, id) {
  var i = state.basics.findIndex(function (b) { return b.id === id; });
  if (i < 0) return null;
  return state.basics.splice(i, 1)[0];
}
function tickBasic(state, id, todayKey) {
  var b = state.basics.filter(function (x) { return x.id === id; })[0];
  if (!b) return null;
  if (b.days[todayKey]) delete b.days[todayKey]; else b.days[todayKey] = true;
  return !!b.days[todayKey];
}
function basicDone(b, todayKey) { return !!b.days[todayKey]; }
/* Days in a row ending today — or ending yesterday if today isn't
   ticked yet, so the number doesn't drop to zero at breakfast. */
function basicStreak(b, todayKey) {
  var n = 0, k = todayKey;
  if (!b.days[k]) k = shiftDay(k, -1);
  while (b.days[k]) { n++; k = shiftDay(k, -1); }
  return n;
}
function basicsProgress(state, todayKey) {
  var done = state.basics.filter(function (b) { return b.days[todayKey]; }).length;
  return { done: done, of: state.basics.length, complete: state.basics.length > 0 && done === state.basics.length };
}

/* Open notes, in the order you'd work down them: anything with a time
   first (soonest at the top, overdue included), then plain notes oldest
   first. A new plain note goes to the bottom, not the top — the list is
   a queue, not a feed. */
function openNotes(state) {
  return state.notes.filter(function (x) { return !x.done; }).sort(function (a, b) {
    if (a.due && b.due) return a.due - b.due;
    if (a.due) return -1;
    if (b.due) return 1;
    return a.created - b.created;
  });
}
function doneNotes(state) {
  return state.notes.filter(function (x) { return x.done; })
    .sort(function (a, b) { return b.done - a.done; });
}
/* Done notes are kept a week so an accidental tap is recoverable, then
   dropped. The list of things you finished is not a trophy cabinet. */
function pruneDone(state, now) {
  var cutoff = now - NOTE_DONE_KEEP_DAYS * 864e5, dropped = 0;
  state.notes = state.notes.filter(function (x) {
    if (x.done && x.done < cutoff) { dropped++; return false; }
    return true;
  });
  return dropped;
}

/* ---------- due state & labels ---------- */

function dueState(note, now) {
  if (!note.due) return null;
  var day0 = _startOfDay(now);
  if (note.allDay) {
    if (note.due < day0) return 'overdue';
    if (note.due < day0 + 864e5) return 'today';
    return 'later';
  }
  if (note.due <= now) return 'overdue';
  if (note.due < day0 + 864e5) return 'today';
  return 'later';
}
/* notes whose time has just passed and nobody has been told yet */
function dueNow(state, now) {
  return state.notes.filter(function (x) {
    return !x.done && x.due && !x.allDay && x.due <= now && !x.notified;
  });
}
function _fmtTime(ts) {
  var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
  var ap = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12;
  return h + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ap;
}
function fmtWhen(note, now) {
  if (!note.due) return '';
  var day0 = _startOfDay(now), d = new Date(note.due);
  var dayPart;
  var diff = Math.floor((_startOfDay(note.due) - day0) / 864e5);
  if (diff === 0) dayPart = 'Today';
  else if (diff === 1) dayPart = 'Tomorrow';
  else if (diff === -1) dayPart = 'Yesterday';
  else if (diff > 1 && diff < 7) dayPart = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  else dayPart = d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  if (note.allDay) return dayPart;
  return (diff === 0 ? '' : dayPart + ' ') + _fmtTime(note.due);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NOTE_DONE_KEEP_DAYS: NOTE_DONE_KEEP_DAYS, TODAY_CAP: TODAY_CAP, CARRY_NUDGE_AT: CARRY_NUDGE_AT,
    blankNotes: blankNotes, parseNote: parseNote,
    todayNotes: todayNotes, laterNotes: laterNotes, planToday: planToday, planFull: planFull,
    todayProgress: todayProgress, rollover: rollover, needsDecision: needsDecision,
    addBasic: addBasic, removeBasic: removeBasic, tickBasic: tickBasic, basicDone: basicDone,
    basicStreak: basicStreak, basicsProgress: basicsProgress,
    addNote: addNote, completeNote: completeNote, reopenNote: reopenNote, removeNote: removeNote,
    openNotes: openNotes, doneNotes: doneNotes, pruneDone: pruneDone,
    dueState: dueState, dueNow: dueNow, fmtWhen: fmtWhen
  };
}
