/* ============================================================
   FIVER — day and date helpers, shared by every tracker in the
   app. Pure functions, no DOM, no domain knowledge.
   ============================================================ */

function pad2(n) { return (n < 10 ? '0' : '') + n; }

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

/* A timestamp that lands inside the chosen day and never in the
   future. Keeps the current time of day so a backdated entry still
   sorts sensibly, but falls back to midday when the day-boundary
   setting would push it into the wrong bucket.

   Lives here rather than in logic.js because both trackers backdate
   and the food side must not depend on the money side. */
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
  module.exports = {
    pad2: pad2, dayKey: dayKey, keyToDate: keyToDate, shiftDay: shiftDay,
    daysApart: daysApart, weekStart: weekStart, monthKey: monthKey,
    timestampForDay: timestampForDay
  };
}
