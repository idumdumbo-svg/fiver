/* ============================================================
   FIVER / VAULT — documents and accounts, behind a passcode.
   Pure functions plus the crypto. No DOM.

   The passcode is not a screen lock. It is the key. Everything in
   here is stored as AES-GCM ciphertext, so a locked vault is
   genuinely unreadable — in devtools, in an export, in a backup.
   The cost of that is absolute: there is no server, so there is no
   reset. A forgotten passcode is lost data, and the UI says so
   before it lets you set one.

   WHAT IS STORED WHERE. The record list (document details, account
   details) is one encrypted blob in localStorage, re-encrypted
   whole on every change — at a few dozen records that is cheaper
   than the bookkeeping of per-record crypto, and it means there is
   never a half-decrypted state to reason about. File bytes are
   different: a passport scan is megabytes and must not be
   re-encrypted because you renamed an account, so each file is
   encrypted on its own and lives in IndexedDB, keyed by an id the
   record holds. Bytes are encrypted raw rather than base64'd first,
   which keeps a 5 MB scan 5 MB instead of 6.7.

   NO PASSWORDS. There is deliberately no password field. Keeping
   account names and which email each one uses solves the problem
   of losing track; keeping passwords here would mean competing
   with a real password manager on the one axis — surviving attack —
   where a single-file hobby app should not be asking for trust.

   EXPIRY IS THE POINT. A stored passport is mildly useful; knowing
   in October that it expires in December is the thing that saves
   the trip. Anything with a date gets a countdown, and the
   ninety-day mark is where it starts speaking up.
   ============================================================ */

if (typeof dayKey === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./dates.js'));
}

var VAULT_VERSION = 1;
var VAULT_ROUNDS = 250000;      /* PBKDF2-SHA256; ~250ms on a mid phone */
var VAULT_MIN_PASS = 8;
var VAULT_WARN_DAYS = 90;       /* when an expiry starts being mentioned */
var VAULT_SOON_DAYS = 30;       /* when it becomes urgent */
var VAULT_AUTOLOCK_MS = 300000; /* 5 minutes idle */
var VAULT_MAX_FILE = 12 * 1024 * 1024;
var VAULT_VERIFY_TEXT = 'fiver.vault.ok';

/* Document kinds. `expires` decides whether the form asks for a date
   and whether the record can ever show a countdown. */
var DOC_TYPES = [
  { id: 'cv',        label: 'CV / Resume',        expires: false },
  { id: 'passport',  label: 'Passport',           expires: true  },
  { id: 'licence',   label: "Driver's licence",   expires: true  },
  { id: 'idp',       label: 'Intl driving permit', expires: true },
  { id: 'visa',      label: 'Visa / work permit', expires: true  },
  { id: 'cert',      label: 'Certification',      expires: true  },
  { id: 'insurance', label: 'Insurance',          expires: true  },
  { id: 'other',     label: 'Other',              expires: false }
];

var ACCOUNT_KINDS = [
  { id: 'work',     label: 'Work' },
  { id: 'govt',     label: 'Government' },
  { id: 'money',    label: 'Money' },
  { id: 'travel',   label: 'Travel' },
  { id: 'personal', label: 'Personal' }
];

function blankVault() {
  return { version: VAULT_VERSION, docs: [], accounts: [] };
}

function docType(id) {
  for (var i = 0; i < DOC_TYPES.length; i++) {
    if (DOC_TYPES[i].id === id) return DOC_TYPES[i];
  }
  return DOC_TYPES[DOC_TYPES.length - 1];
}

function docTypeLabel(id) { return docType(id).label; }

function accountKindLabel(id) {
  for (var i = 0; i < ACCOUNT_KINDS.length; i++) {
    if (ACCOUNT_KINDS[i].id === id) return ACCOUNT_KINDS[i].label;
  }
  return 'Personal';
}

/* ------------------------------------------------------------
   expiry
   ------------------------------------------------------------ */

/* Days from today until `key` (a YYYY-MM-DD). Negative once past.
   Whole days only — an expiry is a date, not a moment. */
function daysUntil(key, nowMs) {
  if (!key) return null;
  return daysApart(dayKey(nowMs, 0), key);
}

/* One of: none (nothing to track), expired, soon (<=30d),
   warn (<=90d), valid. The bucket, not the number, drives colour. */
function expiryState(doc, nowMs) {
  if (!doc || !doc.expires || !docType(doc.type).expires) {
    return { state: 'none', days: null };
  }
  var d = daysUntil(doc.expires, nowMs);
  if (d === null) return { state: 'none', days: null };
  if (d < 0) return { state: 'expired', days: d };
  if (d <= VAULT_SOON_DAYS) return { state: 'soon', days: d };
  if (d <= VAULT_WARN_DAYS) return { state: 'warn', days: d };
  return { state: 'valid', days: d };
}

function expiryLabel(doc, nowMs) {
  var e = expiryState(doc, nowMs);
  if (e.state === 'none') return '';
  if (e.state === 'expired') {
    var n = Math.abs(e.days);
    return n === 0 ? 'Expires today' : 'Expired ' + n + ' day' + (n === 1 ? '' : 's') + ' ago';
  }
  if (e.days === 0) return 'Expires today';
  if (e.days === 1) return 'Expires tomorrow';
  if (e.days < 45) return e.days + ' days left';
  var months = Math.round(e.days / 30.44);
  if (months < 24) return 'About ' + months + ' month' + (months === 1 ? '' : 's') + ' left';
  return 'About ' + Math.floor(e.days / 365.25) + ' years left';
}

/* Everything worth mentioning, worst first. Drives the banner. */
function needsAttention(vault, nowMs) {
  var out = [];
  var docs = (vault && vault.docs) || [];
  for (var i = 0; i < docs.length; i++) {
    var e = expiryState(docs[i], nowMs);
    if (e.state === 'expired' || e.state === 'soon' || e.state === 'warn') {
      out.push({ doc: docs[i], state: e.state, days: e.days });
    }
  }
  out.sort(function (a, b) { return a.days - b.days; });
  return out;
}

/* ------------------------------------------------------------
   records
   ------------------------------------------------------------ */

/* Hex, not base64. Stripping the non-alphanumerics out of base64 left
   ids anywhere from 8 to 12 characters and threw away entropy with
   them; hex needs no stripping, so every id is a full 64 bits. */
function newId() {
  var b = cryptoObj().getRandomValues(new Uint8Array(8)), out = '';
  for (var i = 0; i < b.length; i++) out += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return out;
}

function addDoc(vault, doc) {
  var v = cloneVault(vault);
  var rec = {
    id: doc.id || newId(),
    type: doc.type || 'other',
    label: (doc.label || '').trim() || docTypeLabel(doc.type || 'other'),
    number: (doc.number || '').trim(),
    issued: doc.issued || '',
    expires: doc.expires || '',
    note: (doc.note || '').trim(),
    fileId: doc.fileId || null,
    fileName: doc.fileName || '',
    fileType: doc.fileType || '',
    fileSize: doc.fileSize || 0,
    updated: doc.updated || 0
  };
  v.docs.push(rec);
  return v;
}

function updateDoc(vault, id, patch) {
  var v = cloneVault(vault);
  for (var i = 0; i < v.docs.length; i++) {
    if (v.docs[i].id === id) { v.docs[i] = patched(v.docs[i], patch); break; }
  }
  return v;
}

function removeDoc(vault, id) {
  var v = cloneVault(vault);
  v.docs = v.docs.filter(function (d) { return d.id !== id; });
  return v;
}

function findDoc(vault, id) {
  var docs = (vault && vault.docs) || [];
  for (var i = 0; i < docs.length; i++) { if (docs[i].id === id) return docs[i]; }
  return null;
}

/* Expiring things first, then the dated ones, then the rest. A CV has
   no date and should not outrank a passport with six weeks on it. */
function sortedDocs(vault, nowMs) {
  var docs = ((vault && vault.docs) || []).slice();
  var rank = { expired: 0, soon: 1, warn: 2, valid: 3, none: 4 };
  docs.sort(function (a, b) {
    var ea = expiryState(a, nowMs), eb = expiryState(b, nowMs);
    if (rank[ea.state] !== rank[eb.state]) return rank[ea.state] - rank[eb.state];
    if (ea.days !== null && eb.days !== null && ea.days !== eb.days) return ea.days - eb.days;
    return (a.label || '').localeCompare(b.label || '');
  });
  return docs;
}

function addAccount(vault, acc) {
  var v = cloneVault(vault);
  v.accounts.push({
    id: acc.id || newId(),
    service: (acc.service || '').trim(),
    email: (acc.email || '').trim(),
    username: (acc.username || '').trim(),
    kind: acc.kind || 'personal',
    note: (acc.note || '').trim(),
    updated: acc.updated || 0
  });
  return v;
}

function updateAccount(vault, id, patch) {
  var v = cloneVault(vault);
  for (var i = 0; i < v.accounts.length; i++) {
    if (v.accounts[i].id === id) { v.accounts[i] = patched(v.accounts[i], patch); break; }
  }
  return v;
}

function removeAccount(vault, id) {
  var v = cloneVault(vault);
  v.accounts = v.accounts.filter(function (a) { return a.id !== id; });
  return v;
}

/* Grouped by the email they sit under, because "which address did I
   sign up with" is the actual question being asked. */
function accountsByEmail(vault) {
  var accs = ((vault && vault.accounts) || []).slice();
  var groups = {}, order = [];
  for (var i = 0; i < accs.length; i++) {
    var key = accs[i].email || '(no email)';
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(accs[i]);
  }
  order.sort(function (a, b) {
    if (groups[b].length !== groups[a].length) return groups[b].length - groups[a].length;
    return a.localeCompare(b);
  });
  return order.map(function (email) {
    var list = groups[email].slice().sort(function (a, b) {
      return (a.service || '').localeCompare(b.service || '');
    });
    return { email: email, accounts: list };
  });
}

/* A record is never edited in place. cloneVault copies the arrays but
   not the objects in them, so patching one directly would reach back
   into the caller's copy — every update swaps in a fresh object. */
function patched(rec, patch) {
  var out = {};
  for (var k in rec) { if (Object.prototype.hasOwnProperty.call(rec, k)) out[k] = rec[k]; }
  for (var j in patch) { if (Object.prototype.hasOwnProperty.call(patch, j)) out[j] = patch[j]; }
  return out;
}

function cloneVault(vault) {
  var v = vault || blankVault();
  return {
    version: v.version || VAULT_VERSION,
    docs: (v.docs || []).slice(),
    accounts: (v.accounts || []).slice()
  };
}

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* A length floor and a variety nudge. Deliberately not a strength
   meter with a green bar — those teach people that "Passw0rd!" is
   strong. Length is what matters against an offline attack on a
   PBKDF2 blob, so length is what it asks for. */
function passcodeCheck(pass) {
  var p = pass || '';
  if (p.length < VAULT_MIN_PASS) {
    return { ok: false, why: 'At least ' + VAULT_MIN_PASS + ' characters — longer beats clever.' };
  }
  if (/^\d+$/.test(p) && p.length < 12) {
    return { ok: false, why: 'All digits is quick to guess. Add words, or make it 12+ digits.' };
  }
  var words = p.trim().split(/\s+/).length;
  if (p.length >= 20 || words >= 4) return { ok: true, why: 'Strong. A phrase is the right shape.' };
  if (p.length >= 12) return { ok: true, why: 'Good. Longer is still better.' };
  return { ok: true, why: 'Acceptable. Four random words would be much stronger.' };
}

/* ------------------------------------------------------------
   crypto — WebCrypto, present in browsers and in node
   ------------------------------------------------------------ */

function cryptoObj() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
  throw new Error('WebCrypto unavailable');
}

function bytesToBase64(bytes) {
  var s = '', b = new Uint8Array(bytes);
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function base64ToBytes(str) {
  var s = atob(str), b = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function randomBytes(n) {
  return cryptoObj().getRandomValues(new Uint8Array(n));
}

/* passcode + salt -> AES-GCM key. The key never leaves memory and is
   dropped on lock; only salt and rounds are persisted. */
function deriveKey(passcode, saltB64, rounds) {
  var c = cryptoObj();
  var enc = new TextEncoder();
  return c.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey'])
    .then(function (base) {
      return c.subtle.deriveKey(
        { name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations: rounds || VAULT_ROUNDS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
}

function encryptBytes(key, bytes) {
  var iv = randomBytes(12);
  return cryptoObj().subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes)
    .then(function (ct) { return { iv: bytesToBase64(iv), ct: ct }; });
}

function decryptBytes(key, blob) {
  return cryptoObj().subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(blob.iv) }, key, blob.ct
  );
}

function encryptJSON(key, obj) {
  var bytes = new TextEncoder().encode(JSON.stringify(obj));
  return encryptBytes(key, bytes).then(function (r) {
    return { iv: r.iv, ct: bytesToBase64(r.ct) };
  });
}

function decryptJSON(key, blob) {
  return decryptBytes(key, { iv: blob.iv, ct: base64ToBytes(blob.ct) })
    .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
}

/* Build the persisted shell for a brand new passcode. The verifier is
   a known string encrypted under the key: decrypting it is how an
   unlock attempt is judged right or wrong without touching the data. */
function newVaultMeta(passcode) {
  var salt = bytesToBase64(randomBytes(16));
  return deriveKey(passcode, salt, VAULT_ROUNDS).then(function (key) {
    return Promise.all([
      encryptJSON(key, VAULT_VERIFY_TEXT),
      encryptJSON(key, blankVault())
    ]).then(function (parts) {
      return {
        meta: {
          version: VAULT_VERSION,
          kdf: { salt: salt, rounds: VAULT_ROUNDS, hash: 'SHA-256' },
          verifier: parts[0],
          payload: parts[1]
        },
        key: key
      };
    });
  });
}

/* Resolves with the key on the right passcode, with null on the wrong
   one. AES-GCM authenticates, so a wrong key throws rather than
   returning rubbish — and so does a tampered blob. */
function unlockVault(passcode, meta) {
  if (!meta || !meta.kdf) return Promise.resolve(null);
  return deriveKey(passcode, meta.kdf.salt, meta.kdf.rounds).then(function (key) {
    return decryptJSON(key, meta.verifier).then(function (text) {
      return text === VAULT_VERIFY_TEXT ? key : null;
    }).catch(function () { return null; });
  });
}

function readVault(key, meta) {
  return decryptJSON(key, meta.payload).then(function (v) { return cloneVault(v); });
}

function writeVault(key, meta, vault) {
  return encryptJSON(key, cloneVault(vault)).then(function (payload) {
    return {
      version: VAULT_VERSION,
      kdf: meta.kdf,
      verifier: meta.verifier,
      payload: payload
    };
  });
}

/* Re-key under a new passcode. Every file has to be re-encrypted too,
   so the caller passes them in and gets them back re-wrapped; doing it
   in one place keeps a half-migrated vault impossible. */
function changePasscode(oldKey, meta, vault, files, newPass) {
  return newVaultMeta(newPass).then(function (fresh) {
    return writeVault(fresh.key, fresh.meta, vault).then(function (m) {
      var jobs = (files || []).map(function (f) {
        return decryptBytes(oldKey, f)
          .then(function (plain) { return encryptBytes(fresh.key, plain); })
          .then(function (enc) { return { id: f.id, iv: enc.iv, ct: enc.ct }; });
      });
      return Promise.all(jobs).then(function (rewrapped) {
        return { meta: m, key: fresh.key, files: rewrapped };
      });
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VAULT_VERSION: VAULT_VERSION, VAULT_ROUNDS: VAULT_ROUNDS, VAULT_MIN_PASS: VAULT_MIN_PASS,
    VAULT_WARN_DAYS: VAULT_WARN_DAYS, VAULT_SOON_DAYS: VAULT_SOON_DAYS,
    VAULT_AUTOLOCK_MS: VAULT_AUTOLOCK_MS, VAULT_MAX_FILE: VAULT_MAX_FILE,
    DOC_TYPES: DOC_TYPES, ACCOUNT_KINDS: ACCOUNT_KINDS,
    blankVault: blankVault, docType: docType, docTypeLabel: docTypeLabel,
    accountKindLabel: accountKindLabel,
    daysUntil: daysUntil, expiryState: expiryState, expiryLabel: expiryLabel,
    needsAttention: needsAttention,
    newId: newId, addDoc: addDoc, updateDoc: updateDoc, removeDoc: removeDoc,
    findDoc: findDoc, sortedDocs: sortedDocs, patched: patched,
    addAccount: addAccount, updateAccount: updateAccount, removeAccount: removeAccount,
    accountsByEmail: accountsByEmail, cloneVault: cloneVault,
    fmtBytes: fmtBytes, passcodeCheck: passcodeCheck,
    bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes, randomBytes: randomBytes,
    deriveKey: deriveKey, encryptBytes: encryptBytes, decryptBytes: decryptBytes,
    encryptJSON: encryptJSON, decryptJSON: decryptJSON,
    newVaultMeta: newVaultMeta, unlockVault: unlockVault,
    readVault: readVault, writeVault: writeVault, changePasscode: changePasscode
  };
}
