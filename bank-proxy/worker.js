/* ============================================================
   FIVER — bank proxy

   A single Cloudflare Worker that stands between Fiver (a static
   page with no server) and Akahu (which will not talk to a
   browser, and whose token must never sit in one).

   It does three things and nothing else:
     1. checks a shared key that only your phone knows
     2. calls Akahu with credentials that never leave the Worker
     3. returns transactions in the shape Fiver already speaks

   It is read-only. There is no endpoint here that can move money,
   and the Akahu token it holds is a personal token scoped to your
   own accounts. Nothing about this Worker is multi-user: it serves
   exactly one person, which is why a single shared key is enough.

   Secrets (set with `wrangler secret put NAME`, never in this file
   and never in git):
     AKAHU_APP_ID     your app token   (app_token_...)
     AKAHU_USER_TOKEN your user token  (user_token_...)
     FIVER_KEY        a long random string you also paste into Fiver

   Plain vars (in wrangler.toml, not secret):
     ALLOWED_ORIGIN   exactly the origin Fiver is served from
   ============================================================ */

const AKAHU = 'https://api.akahu.io/v1';
const MAX_PAGES = 20;          // ~20 pages is years of history; stops runaway loops
const MAX_WINDOW_DAYS = 400;   // refuse absurd ranges rather than hammering Akahu

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'x-fiver-key,content-type',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, cors);

    // --- gate first, before anything reads a secret or hits the network ---
    if (!env.FIVER_KEY || !safeEqual(request.headers.get('x-fiver-key') || '', env.FIVER_KEY)) {
      return json({ error: 'nope' }, 401, cors);
    }
    if (!env.AKAHU_APP_ID || !env.AKAHU_USER_TOKEN) {
      return json({ error: 'Worker is missing its Akahu secrets' }, 500, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/' || path === '/health') {
        return json({ ok: true, service: 'fiver-bank-proxy' }, 200, cors);
      }
      if (path === '/accounts') {
        const r = await akahu(env, '/accounts');
        return json({ accounts: (r.items || []).map(normAccount) }, 200, cors);
      }
      if (path === '/transactions') {
        return json(await transactions(env, url), 200, cors);
      }
      /* One raw page, so you can see exactly what Akahu returns for
         your own bank before trusting the normaliser above it. */
      if (path === '/debug') {
        const r = await akahu(env, '/transactions?' + rangeQuery(url));
        return json({ count: (r.items || []).length, sample: (r.items || []).slice(0, 3) }, 200, cors);
      }
      return json({ error: 'no such path' }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  }
};

/* ---------------- Akahu ---------------- */

async function akahu(env, path) {
  const res = await fetch(AKAHU + path, {
    headers: {
      'Authorization': 'Bearer ' + env.AKAHU_USER_TOKEN,
      'X-Akahu-Id': env.AKAHU_APP_ID,
      'Accept': 'application/json'
    }
  });
  const body = await res.text();
  if (!res.ok) {
    // Never echo the body verbatim — it can carry account detail.
    throw new Error('Akahu returned ' + res.status);
  }
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { throw new Error('Akahu returned something that was not JSON'); }
  return parsed;
}

function rangeQuery(url) {
  const days = clampInt(url.searchParams.get('days'), 1, MAX_WINDOW_DAYS, 30);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  return new URLSearchParams({ start: start.toISOString(), end: end.toISOString() }).toString();
}

async function transactions(env, url) {
  const base = rangeQuery(url);
  let cursor = null, pages = 0;
  const items = [];

  do {
    const q = base + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const r = await akahu(env, '/transactions?' + q);
    for (const t of (r.items || [])) items.push(t);
    cursor = r.cursor && r.cursor.next ? r.cursor.next : null;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  const spends = [];
  for (const t of items) {
    const n = normTxn(t);
    if (n) spends.push(n);
  }
  spends.sort((a, b) => b.ts - a.ts);
  return { count: spends.length, truncated: !!cursor, transactions: spends };
}

function normAccount(a) {
  return {
    id: a._id || a.id || null,
    name: a.name || null,
    bank: (a.connection && a.connection.name) || null,
    type: a.type || null
  };
}

/* Akahu signs money the way a bank statement does: money leaving
   the account is negative. Fiver only cares about spending, so
   credits are dropped here rather than in the app — an unexpected
   sign convention should show up as "no transactions", which is
   obvious, rather than as income logged as spending, which is not.

   Field names are read defensively because this normaliser was
   written without a live account to test against. Hit /debug once
   and check the three sample rows before you trust it. */
function normTxn(t) {
  const amt = typeof t.amount === 'number' ? t.amount : Number(t.amount);
  if (!isFinite(amt) || amt >= 0) return null;         // credits and zeroes are not spends

  const iso = t.date || t.time || t._id_date || null;
  const ts = iso ? Date.parse(iso) : NaN;
  if (!isFinite(ts)) return null;

  const merchant = (t.merchant && (t.merchant.name || t.merchant)) || null;
  const cat = t.category && (t.category.name || (t.category.groups &&
              t.category.groups.personal_finance && t.category.groups.personal_finance.name)) || null;

  return {
    id: t._id || t.id || (ts + ':' + Math.round(Math.abs(amt) * 100)),
    ts: ts,
    cents: Math.round(Math.abs(amt) * 100),
    currency: t.currency || null,
    merchant: merchant,
    description: t.description || null,
    akahuCategory: cat,
    account: t._account || null,
    pending: !!t.pending
  };
}

/* ---------------- small helpers ---------------- */

function clampInt(raw, lo, hi, dflt) {
  const n = parseInt(raw, 10);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

/* Constant-time-ish comparison so the key can't be guessed a
   character at a time by timing the response. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, cors)
  });
}
