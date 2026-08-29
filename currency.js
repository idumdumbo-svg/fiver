/* ============================================================
   FIVER — currency. Pure functions, no DOM, no network.

   Amounts are always integers in the currency's MINOR unit:
   cents for NZD/AUD, whole yen for JPY (which has no minor unit).
   Storing a float would drift; storing "cents" for yen would be
   a lie, so the decimal count travels with the currency.

   Every entry records the currency it was logged in. Switching
   your display currency converts old entries for display at
   today's rate — it never rewrites what you actually spent.
   ============================================================ */

var CURRENCIES = {
  NZD: { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', decimals: 2, step: 500 },
  AUD: { code: 'AUD', symbol: 'A$',  name: 'Australian Dollar',  decimals: 2, step: 500 },
  JPY: { code: 'JPY', symbol: '¥',   name: 'Japanese Yen',       decimals: 0, step: 500 },
  // not offered in the picker — it is the rate base, and conversions
  // through it must not fall back to another currency's decimals
  USD: { code: 'USD', symbol: 'US$', name: 'US Dollar',           decimals: 2, step: 500 }
};
var CURRENCY_ORDER = ['NZD', 'AUD', 'JPY'];
var BASE_RATE_CURRENCY = 'USD';

function currencyOf(code) {
  return CURRENCIES[code] || CURRENCIES.NZD;
}

/* The round-up step, in minor units. $5 in dollar countries;
   ¥500 in Japan, because ¥5 is not a unit anyone thinks in. */
function stepFor(code) {
  return currencyOf(code).step;
}

function roundUpIn(minor, code) {
  var step = stepFor(code);
  if (!isFinite(minor) || minor <= 0) return 0;
  return Math.ceil(minor / step) * step;
}

function minorPerMajor(code) {
  return Math.pow(10, currencyOf(code).decimals);
}

/* ---------------- conversion ---------------- */

/* rates are USD-based: { USD: 1, NZD: 1.63, ... } meaning
   1 USD buys that much of the currency. */
function rateBetween(from, to, rates) {
  if (from === to) return 1;
  if (!rates) return null;
  var f = from === BASE_RATE_CURRENCY ? 1 : rates[from];
  var t = to === BASE_RATE_CURRENCY ? 1 : rates[to];
  if (!(f > 0) || !(t > 0)) return null;
  return t / f;
}

/* Returns null when the rate is unknown, so callers can say
   "rates unavailable" instead of quietly showing a wrong number. */
function convert(minor, from, to, rates) {
  if (from === to) return minor;
  var r = rateBetween(from, to, rates);
  if (r === null) return null;
  var major = minor / minorPerMajor(from);
  return Math.round(major * r * minorPerMajor(to));
}

/* Sum a list of {amount, currency} into one display currency.
   Anything that can't be converted is reported rather than
   silently dropped. */
function sumIn(items, to, rates) {
  var total = 0, converted = 0, unconvertible = 0;
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    var cur = it.currency || to;
    var v = convert(it.amount, cur, to, rates);
    if (v === null) { unconvertible++; continue; }
    total += v;
    if (cur !== to) converted++;
  }
  return { total: total, converted: converted, unconvertible: unconvertible };
}

/* ---------------- formatting ---------------- */

function fmtMoneyIn(minor, code, opts) {
  opts = opts || {};
  var c = currencyOf(code);
  var neg = minor < 0;
  var v = Math.abs(minor) / minorPerMajor(code);
  var s;
  if (c.decimals === 0) s = String(Math.round(v));
  else if (opts.decimals === false || v % 1 === 0) s = String(Math.round(v));
  else s = v.toFixed(c.decimals);
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + c.symbol + s;
}

/* Parse typed input into minor units for the given currency. */
function parseMoneyIn(str, code) {
  if (str == null) return 0;
  var n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * minorPerMajor(code));
}

/* ---------------- the daily market move ---------------- */

/* How the currency moved against the US dollar today. Rates are
   quoted as "1 USD buys N", so a SMALLER number means the local
   currency strengthened — hence the inversion. */
function dailyMove(code, todayRate, prevRate) {
  if (code === BASE_RATE_CURRENCY) return null;
  if (!(todayRate > 0) || !(prevRate > 0)) return null;
  var pct = ((prevRate - todayRate) / prevRate) * 100;
  var rounded = Math.round(pct * 100) / 100;
  return {
    pct: rounded,
    dir: rounded > 0 ? 'up' : (rounded < 0 ? 'down' : 'flat'),
    // what one unit of the local currency is worth in USD
    usdPerUnit: 1 / todayRate
  };
}

/* Rates older than this are shown as stale rather than trusted. */
var RATE_MAX_AGE_MS = 3 * 24 * 3600 * 1000;

function ratesAreStale(cache, nowMs) {
  if (!cache || !cache.fetchedAt) return true;
  return (nowMs - cache.fetchedAt) > RATE_MAX_AGE_MS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CURRENCIES: CURRENCIES, CURRENCY_ORDER: CURRENCY_ORDER,
    BASE_RATE_CURRENCY: BASE_RATE_CURRENCY, RATE_MAX_AGE_MS: RATE_MAX_AGE_MS,
    currencyOf: currencyOf, stepFor: stepFor, roundUpIn: roundUpIn,
    minorPerMajor: minorPerMajor, rateBetween: rateBetween, convert: convert,
    sumIn: sumIn, fmtMoneyIn: fmtMoneyIn, parseMoneyIn: parseMoneyIn,
    dailyMove: dailyMove, ratesAreStale: ratesAreStale
  };
}
