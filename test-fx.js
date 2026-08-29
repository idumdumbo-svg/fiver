/* Currency tests. Run: node test-fx.js */
var X = require('./currency.js');

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// 1 USD buys this much — roughly plausible values, exactness is not the point
var R = { NZD: 1.6000, AUD: 1.5000, JPY: 150.00 };

/* ---------- 1. the step follows the currency ---------- */
eq('NZ$ steps in fives', X.stepFor('NZD'), 500);
eq('A$ steps in fives', X.stepFor('AUD'), 500);
eq('yen steps in 500s', X.stepFor('JPY'), 500);
eq('unknown code falls back to NZD', X.stepFor('XYZ'), 500);
eq('USD is known but not offered', X.CURRENCY_ORDER.indexOf('USD'), -1);
eq('...though it still has proper decimals', X.minorPerMajor('USD'), 100);

eq('$14.00 rounds to $15.00', X.roundUpIn(1400, 'NZD'), 1500);
eq('$15.00 stays', X.roundUpIn(1500, 'NZD'), 1500);
eq('¥1320 rounds to ¥1500', X.roundUpIn(1320, 'JPY'), 1500);
eq('¥1500 stays', X.roundUpIn(1500, 'JPY'), 1500);
eq('¥1 rounds to ¥500', X.roundUpIn(1, 'JPY'), 500);
eq('zero stays zero', X.roundUpIn(0, 'JPY'), 0);
eq('negative is zero', X.roundUpIn(-100, 'NZD'), 0);

/* ---------- 2. minor units differ ---------- */
eq('dollars have cents', X.minorPerMajor('NZD'), 100);
eq('yen does not', X.minorPerMajor('JPY'), 1);

/* ---------- 3. conversion ---------- */
eq('same currency is a no-op', X.convert(1500, 'NZD', 'NZD', R), 1500);
// NZ$15 -> USD 9.375 -> AUD 14.0625 -> 1406 cents
eq('NZD to AUD', X.convert(1500, 'NZD', 'AUD', R), 1406);
// NZ$15 -> USD 9.375 -> ¥1406.25 -> 1406 yen (no minor unit)
eq('NZD to JPY loses the cents', X.convert(1500, 'NZD', 'JPY', R), 1406);
// ¥1500 -> USD 10 -> NZ$16.00 -> 1600 cents
eq('JPY to NZD gains cents', X.convert(1500, 'JPY', 'NZD', R), 1600);
eq('to USD directly', X.convert(1600, 'NZD', 'USD', R), 1000);   // NZ$16 -> US$10.00
eq('from USD directly', X.convert(100, 'USD', 'NZD', R), 160);   // US$1 -> NZ$1.60

// a round trip should land back within a rounding unit
var trip = X.convert(X.convert(10000, 'NZD', 'JPY', R), 'JPY', 'NZD', R);
ok('round trip stays within a cent', Math.abs(trip - 10000) <= 100);

// missing rates must not invent a number
eq('unknown rate -> null', X.convert(1500, 'NZD', 'JPY', null), null);
eq('missing currency in table -> null', X.convert(1500, 'NZD', 'GBP', R), null);
eq('same currency works with no rates at all', X.convert(1500, 'JPY', 'JPY', null), 1500);
eq('rateBetween identity', X.rateBetween('NZD', 'NZD', null), 1);
eq('rateBetween missing', X.rateBetween('NZD', 'GBP', R), null);

/* ---------- 4. mixed-currency totals ---------- */
var mixed = X.sumIn([
  { amount: 1500, currency: 'NZD' },
  { amount: 1500, currency: 'JPY' },   // -> NZ$16.00
  { amount: 1000, currency: 'NZD' }
], 'NZD', R);
eq('mixed total in NZD', mixed.total, 1500 + 1600 + 1000);
eq('converted count', mixed.converted, 1);
eq('nothing unconvertible', mixed.unconvertible, 0);

var partial = X.sumIn([
  { amount: 1500, currency: 'NZD' },
  { amount: 500, currency: 'GBP' }
], 'NZD', R);
eq('unconvertible items are excluded', partial.total, 1500);
eq('...and counted', partial.unconvertible, 1);

// entries with no currency are assumed to be in the display currency
eq('legacy entry assumed native', X.sumIn([{ amount: 2000 }], 'NZD', R).total, 2000);
eq('empty list', X.sumIn([], 'NZD', R).total, 0);
eq('undefined list', X.sumIn(null, 'NZD', R).total, 0);

/* ---------- 5. formatting ---------- */
eq('NZD whole', X.fmtMoneyIn(1500, 'NZD'), 'NZ$15');
eq('NZD with cents', X.fmtMoneyIn(1234, 'NZD'), 'NZ$12.34');
eq('NZD thousands', X.fmtMoneyIn(123400, 'NZD'), 'NZ$1,234');
eq('AUD symbol', X.fmtMoneyIn(1500, 'AUD'), 'A$15');
eq('JPY has no decimals', X.fmtMoneyIn(1500, 'JPY'), '¥1,500');
eq('JPY never shows cents', X.fmtMoneyIn(1234, 'JPY'), '¥1,234');
eq('negative', X.fmtMoneyIn(-1500, 'NZD'), '-NZ$15');
eq('zero', X.fmtMoneyIn(0, 'JPY'), '¥0');
eq('forced whole', X.fmtMoneyIn(1234, 'NZD', { decimals: false }), 'NZ$12');

eq('parse dollars', X.parseMoneyIn('14.50', 'NZD'), 1450);
eq('parse yen', X.parseMoneyIn('1320', 'JPY'), 1320);
eq('parse yen ignores a typed decimal', X.parseMoneyIn('1320.7', 'JPY'), 1321);
eq('parse with symbol', X.parseMoneyIn('NZ$14.50', 'NZD'), 1450);
eq('parse junk', X.parseMoneyIn('abc', 'NZD'), 0);
eq('parse empty', X.parseMoneyIn('', 'NZD'), 0);

/* ---------- 6. the daily move against USD ---------- */
// rate is "USD buys N of local", so a FALL in that number = local currency up
var up = X.dailyMove('NZD', 1.60, 1.62);
eq('local currency strengthened', up.dir, 'up');
eq('percent up', up.pct, 1.23);
ok('usd per unit', Math.abs(up.usdPerUnit - 0.625) < 0.001);

var down = X.dailyMove('NZD', 1.65, 1.62);
eq('local currency weakened', down.dir, 'down');
ok('percent is negative', down.pct < 0);

eq('no move', X.dailyMove('NZD', 1.60, 1.60).dir, 'flat');
eq('USD against itself is meaningless', X.dailyMove('USD', 1, 1), null);
eq('missing previous -> null', X.dailyMove('NZD', 1.6, 0), null);
eq('missing today -> null', X.dailyMove('NZD', null, 1.6), null);

/* ---------- 7. stale rates ---------- */
var now = 1756000000000;
ok('no cache is stale', X.ratesAreStale(null, now));
ok('empty cache is stale', X.ratesAreStale({}, now));
ok('fresh cache is not stale', !X.ratesAreStale({ fetchedAt: now - 3600000 }, now));
ok('two days old is still usable', !X.ratesAreStale({ fetchedAt: now - 2 * 86400000 }, now));
ok('four days old is stale', X.ratesAreStale({ fetchedAt: now - 4 * 86400000 }, now));

/* ---------- report ---------- */
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
if (fail) { failures.forEach(function (f) { console.log('  FAIL ' + f + '\n'); }); process.exit(1); }
