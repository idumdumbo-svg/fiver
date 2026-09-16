/* Logic and crypto tests for the vault. Run: node test-vault.js */
var V = require('./vault.js');
var D = require('./dates.js');

var pass = 0, fail = 0, failures = [];
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(name + '\n     got:  ' + g + '\n     want: ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* Wednesday 16 Sep 2026, 10:00 local */
var NOW = new Date(2026, 8, 16, 10, 0, 0).getTime();
var TODAY = D.dayKey(NOW, 0);
function inDays(n) { return D.shiftDay(TODAY, n); }

/* ---------- 1. document types ---------- */
eq('passport expires', V.docType('passport').expires, true);
eq('a CV does not', V.docType('cv').expires, false);
eq('unknown type falls back to Other', V.docTypeLabel('nonsense'), 'Other');
eq('licence label', V.docTypeLabel('licence'), "Driver's licence");
eq('account kind label', V.accountKindLabel('govt'), 'Government');
eq('unknown kind falls back', V.accountKindLabel('zzz'), 'Personal');

/* ---------- 2. expiry maths ---------- */
eq('days until today is 0', V.daysUntil(TODAY, NOW), 0);
eq('days until tomorrow is 1', V.daysUntil(inDays(1), NOW), 1);
eq('days until yesterday is -1', V.daysUntil(inDays(-1), NOW), -1);
eq('no date, no number', V.daysUntil('', NOW), null);

function doc(type, expires) { return { type: type, expires: expires }; }

eq('expired yesterday', V.expiryState(doc('passport', inDays(-1)), NOW).state, 'expired');
eq('expiring today counts as soon', V.expiryState(doc('passport', TODAY), NOW).state, 'soon');
eq('30 days is still soon', V.expiryState(doc('passport', inDays(30)), NOW).state, 'soon');
eq('31 days is warn', V.expiryState(doc('passport', inDays(31)), NOW).state, 'warn');
eq('90 days is warn', V.expiryState(doc('passport', inDays(90)), NOW).state, 'warn');
eq('91 days is valid', V.expiryState(doc('passport', inDays(91)), NOW).state, 'valid');
eq('a CV never has a state', V.expiryState(doc('cv', inDays(5)), NOW).state, 'none');
eq('a dateless passport has no state', V.expiryState(doc('passport', ''), NOW).state, 'none');
eq('null doc is safe', V.expiryState(null, NOW).state, 'none');

/* ---------- 3. expiry wording ---------- */
eq('expires today', V.expiryLabel(doc('passport', TODAY), NOW), 'Expires today');
eq('expires tomorrow', V.expiryLabel(doc('passport', inDays(1)), NOW), 'Expires tomorrow');
eq('a fortnight', V.expiryLabel(doc('passport', inDays(14)), NOW), '14 days left');
eq('two months', V.expiryLabel(doc('passport', inDays(61)), NOW), 'About 2 months left');
eq('years, not 700 days', V.expiryLabel(doc('passport', inDays(900)), NOW), 'About 2 years left');
eq('one day past', V.expiryLabel(doc('passport', inDays(-1)), NOW), 'Expired 1 day ago');
eq('a week past', V.expiryLabel(doc('passport', inDays(-7)), NOW), 'Expired 7 days ago');
eq('no date, no words', V.expiryLabel(doc('cv', ''), NOW), '');

/* ---------- 4. what needs attention ---------- */
var v = V.blankVault();
v = V.addDoc(v, { type: 'passport', label: 'Passport', expires: inDays(200) });
v = V.addDoc(v, { type: 'licence', label: 'NZ licence', expires: inDays(12) });
v = V.addDoc(v, { type: 'idp', label: 'IDP', expires: inDays(-3) });
v = V.addDoc(v, { type: 'cv', label: 'CV' });
v = V.addDoc(v, { type: 'cert', label: 'First aid', expires: inDays(70) });

var att = V.needsAttention(v, NOW);
eq('three things need attention', att.length, 3);
eq('the expired one is first', att[0].doc.label, 'IDP');
eq('then the soonest', att[1].doc.label, 'NZ licence');
eq('then the ninety-day warning', att[2].doc.label, 'First aid');
eq('the healthy passport is absent', att.filter(function (a) { return a.doc.label === 'Passport'; }).length, 0);
eq('the CV is absent', att.filter(function (a) { return a.doc.label === 'CV'; }).length, 0);
eq('an empty vault needs nothing', V.needsAttention(V.blankVault(), NOW).length, 0);

/* ---------- 5. sorting ---------- */
var order = V.sortedDocs(v, NOW).map(function (d) { return d.label; });
eq('worst first, dateless last', order, ['IDP', 'NZ licence', 'First aid', 'Passport', 'CV']);

/* ---------- 6. records are immutable ---------- */
var base = V.blankVault();
var one = V.addDoc(base, { type: 'cv', label: 'CV' });
eq('adding does not touch the original', base.docs.length, 0);
eq('the copy has it', one.docs.length, 1);

var two = V.updateDoc(one, one.docs[0].id, { label: 'CV 2026' });
eq('updating does not touch the original', one.docs[0].label, 'CV');
eq('the copy is updated', two.docs[0].label, 'CV 2026');

var three = V.removeDoc(two, two.docs[0].id);
eq('removing does not touch the original', two.docs.length, 1);
eq('the copy is empty', three.docs.length, 0);
eq('removing something absent is a no-op', V.removeDoc(two, 'nope').docs.length, 1);
eq('findDoc finds', V.findDoc(two, two.docs[0].id).label, 'CV 2026');
eq('findDoc misses safely', V.findDoc(two, 'nope'), null);

var labelled = V.addDoc(V.blankVault(), { type: 'passport' });
eq('a blank label falls back to the type', labelled.docs[0].label, 'Passport');
eq('ids are unique', V.newId() === V.newId(), false);
eq('ids are a fixed length', V.newId().length, 16);
var idLens = {};
for (var n = 0; n < 500; n++) idLens[V.newId().length] = 1;
eq('every id, every time', Object.keys(idLens), ['16']);
ok('ids are hex', /^[0-9a-f]{16}$/.test(V.newId()));

/* ---------- 7. accounts ---------- */
var a = V.blankVault();
a = V.addAccount(a, { service: 'IRD', email: 'd@example.com', kind: 'govt' });
a = V.addAccount(a, { service: 'NZSki payroll', email: 'd@example.com', kind: 'work' });
a = V.addAccount(a, { service: 'Kiwibank', email: 'other@example.com', kind: 'money' });
a = V.addAccount(a, { service: 'Airline', kind: 'travel' });

var groups = V.accountsByEmail(a);
eq('three groups', groups.length, 3);
eq('the busiest email leads', groups[0].email, 'd@example.com');
eq('and holds both', groups[0].accounts.length, 2);
eq('sorted inside the group', groups[0].accounts[0].service, 'IRD');
eq('a missing email gets a bucket', groups.filter(function (g) { return g.email === '(no email)'; }).length, 1);

var upd = V.updateAccount(a, a.accounts[0].id, { note: 'myIR login' });
eq('account update is a copy', a.accounts[0].note, '');
eq('the copy has the note', upd.accounts[0].note, 'myIR login');
eq('account removal', V.removeAccount(a, a.accounts[0].id).accounts.length, 3);
eq('whitespace is trimmed', V.addAccount(V.blankVault(), { service: '  IRD  ' }).accounts[0].service, 'IRD');

/* ---------- 8. odds and ends ---------- */
eq('no bytes, no label', V.fmtBytes(0), '');
eq('bytes', V.fmtBytes(900), '900 B');
eq('kilobytes', V.fmtBytes(2048), '2 KB');
eq('megabytes', V.fmtBytes(3 * 1024 * 1024), '3.0 MB');

eq('too short is rejected', V.passcodeCheck('abc123').ok, false);
eq('a short pin is rejected', V.passcodeCheck('12345678').ok, false);
eq('a long pin is allowed', V.passcodeCheck('123456789012').ok, true);
eq('eight characters just passes', V.passcodeCheck('winter26').ok, true);
eq('a phrase is called strong', /Strong/.test(V.passcodeCheck('four random words here').why), true);
eq('empty is rejected', V.passcodeCheck('').ok, false);
eq('undefined is rejected', V.passcodeCheck().ok, false);

/* ---------- 9. crypto ---------- */
(async function () {
  /* round trips */
  var salt = V.bytesToBase64(V.randomBytes(16));
  var key = await V.deriveKey('correct horse battery', salt, 1000);

  var blob = await V.encryptJSON(key, { hello: 'world', n: 42 });
  ok('ciphertext is not the plaintext', blob.ct.indexOf('world') === -1);
  eq('json round trips', await V.decryptJSON(key, blob), { hello: 'world', n: 42 });

  var bytes = V.randomBytes(2048);
  var fileBlob = await V.encryptBytes(key, bytes);
  var back = new Uint8Array(await V.decryptBytes(key, fileBlob));
  eq('bytes round trip', Array.from(back).slice(0, 8), Array.from(bytes).slice(0, 8));
  eq('and keep their length', back.length, 2048);

  /* the same passcode with a different salt is a different key */
  var salt2 = V.bytesToBase64(V.randomBytes(16));
  var key2 = await V.deriveKey('correct horse battery', salt2, 1000);
  var failed = false;
  try { await V.decryptJSON(key2, blob); } catch (e) { failed = true; }
  ok('a different salt cannot read it', failed);

  /* base64 helpers are symmetric */
  var raw = V.randomBytes(300);
  eq('base64 round trips', Array.from(V.base64ToBytes(V.bytesToBase64(raw))), Array.from(raw));

  /* a real vault */
  var made = await V.newVaultMeta('a decent long passcode');
  eq('meta records the rounds', made.meta.kdf.rounds, V.VAULT_ROUNDS);
  ok('the salt is stored in the clear', typeof made.meta.kdf.salt === 'string');
  ok('the verifier is not', made.meta.verifier.ct.indexOf('fiver.vault.ok') === -1);

  var started = await V.readVault(made.key, made.meta);
  eq('a new vault is empty', [started.docs.length, started.accounts.length], [0, 0]);

  var good = await V.unlockVault('a decent long passcode', made.meta);
  ok('the right passcode returns a key', good !== null);
  var bad = await V.unlockVault('a decent long passcodf', made.meta);
  eq('one wrong character returns null, not a throw', bad, null);
  eq('an empty passcode returns null', await V.unlockVault('', made.meta), null);
  eq('no meta returns null', await V.unlockVault('x', null), null);

  /* two vaults made with the same passcode still differ */
  var madeB = await V.newVaultMeta('a decent long passcode');
  ok('salts are per-vault', made.meta.kdf.salt !== madeB.meta.kdf.salt);
  ok('so the payloads differ', made.meta.payload.ct !== madeB.meta.payload.ct);

  /* writing and reading back */
  var filled = V.addDoc(started, { type: 'passport', label: 'AU Passport', number: 'PA123', expires: inDays(400) });
  filled = V.addAccount(filled, { service: 'IRD', email: 'd@example.com', kind: 'govt' });
  var meta2 = await V.writeVault(made.key, made.meta, filled);
  var reread = await V.readVault(made.key, meta2);
  eq('the document survives the round trip', reread.docs[0].label, 'AU Passport');
  eq('as does the number', reread.docs[0].number, 'PA123');
  eq('and the account', reread.accounts[0].service, 'IRD');
  ok('the passport number is not in the ciphertext', meta2.payload.ct.indexOf('PA123') === -1);
  eq('the kdf is carried forward', meta2.kdf.salt, made.meta.kdf.salt);

  /* tampering is caught, not silently accepted */
  var tampered = { iv: meta2.payload.iv, ct: flipOneChar(meta2.payload.ct) };
  var caught = false;
  try { await V.decryptJSON(made.key, tampered); } catch (e) { caught = true; }
  ok('a flipped byte is rejected', caught);

  var ivSwapped = { iv: V.bytesToBase64(V.randomBytes(12)), ct: meta2.payload.ct };
  caught = false;
  try { await V.decryptJSON(made.key, ivSwapped); } catch (e) { caught = true; }
  ok('a swapped iv is rejected', caught);

  /* every encryption uses a fresh iv */
  var x1 = await V.encryptJSON(made.key, { same: 'payload' });
  var x2 = await V.encryptJSON(made.key, { same: 'payload' });
  ok('ivs are never reused', x1.iv !== x2.iv);
  ok('so identical payloads look different', x1.ct !== x2.ct);

  /* changing the passcode re-wraps the files and retires the old key */
  var f1 = await V.encryptBytes(made.key, V.randomBytes(512));
  f1.id = 'file1';
  var moved = await V.changePasscode(made.key, meta2, filled, [f1], 'a different long passcode');
  var afterOld = await V.unlockVault('a decent long passcode', moved.meta);
  eq('the old passcode no longer opens it', afterOld, null);
  var afterNew = await V.unlockVault('a different long passcode', moved.meta);
  ok('the new passcode does', afterNew !== null);
  var movedVault = await V.readVault(afterNew, moved.meta);
  eq('the records came across', movedVault.docs[0].label, 'AU Passport');
  eq('the file came across', moved.files.length, 1);
  eq('keeping its id', moved.files[0].id, 'file1');
  var fileBack = new Uint8Array(await V.decryptBytes(afterNew, moved.files[0]));
  eq('and its bytes', fileBack.length, 512);
  caught = false;
  try { await V.decryptBytes(made.key, moved.files[0]); } catch (e) { caught = true; }
  ok('the old key cannot read the re-wrapped file', caught);

  report();
})().catch(function (e) {
  console.error('\n  crypto tests threw:', e && e.stack || e);
  process.exit(1);
});

function flipOneChar(b64) {
  var i = Math.floor(b64.length / 2);
  var c = b64[i] === 'A' ? 'B' : 'A';
  return b64.slice(0, i) + c + b64.slice(i + 1);
}

function report() {
  console.log('');
  failures.forEach(function (f) { console.log('  FAIL ' + f); });
  console.log('  vault: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}
