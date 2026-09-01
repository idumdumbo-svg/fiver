# The bank proxy

Fiver is a static page. It has no server, and it's served from a public
repo — so an Akahu token can't live in it. This Worker is the smallest
thing that fixes that: it holds the token, Fiver holds a key that opens
the Worker, and the token never reaches your phone.

It is **read-only**. There is no code path here that can move money.

---

## What you need first

An Akahu **personal app**, which is free and covers your own accounts
only. From [my.akahu.nz](https://my.akahu.nz): connect your bank, turn on
two-factor auth, then create a personal app. You end up with two strings:

- an **app token**, starting `app_token_`
- a **user token**, starting `user_token_`

Both are passwords for your bank data. They go into Cloudflare in step 3
and nowhere else — not into this repo, not into a chat window, not into
the app.

---

## Deploying it

**1. Install the CLI and log in.** Cloudflare's free tier is far more than
this needs (100,000 requests a day; you'll use maybe ten).

```bash
cd bank-proxy
npx wrangler login
```

**2. Make a key for the app to use.** Any long random string. This one is
fine to generate wherever, as long as it's long:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy it. You'll paste it into Fiver later.

**3. Put in the three secrets.** Each command prompts, you paste, it goes
straight to Cloudflare:

```bash
npx wrangler secret put AKAHU_APP_ID       # app_token_...
npx wrangler secret put AKAHU_USER_TOKEN   # user_token_...
npx wrangler secret put FIVER_KEY          # the random string from step 2
```

**4. Check `ALLOWED_ORIGIN` in `wrangler.toml`** matches where Fiver is
served from, exactly — scheme, host, no trailing slash.

**5. Deploy.**

```bash
npx wrangler deploy
```

It prints a URL like `https://fiver-bank-proxy.<you>.workers.dev`. That
plus your key go into Fiver under **Setup → Bank**.

---

## Check it before you trust it

I wrote the transaction normaliser without a live Akahu account to test
against, so the field names are read defensively and the first thing
worth doing is looking at the real shape:

```bash
curl -H "x-fiver-key: YOUR_KEY" \
  "https://fiver-bank-proxy.<you>.workers.dev/debug?days=7"
```

That returns three raw transactions exactly as Akahu sends them. If
`amount`, `date`, `merchant` or `category` are named differently for your
bank, `normTxn` in `worker.js` is the one function to adjust.

Then check the normalised version:

```bash
curl -H "x-fiver-key: YOUR_KEY" \
  "https://fiver-bank-proxy.<you>.workers.dev/transactions?days=7"
```

**If `/transactions` comes back empty but `/debug` shows rows**, the sign
convention is the opposite of what I assumed — spends are positive rather
than negative for your bank. Flip the `amt >= 0` test in `normTxn`. I made
that failure mode "nothing appears" rather than "income appears as
spending" on purpose: silence is obvious, wrong data isn't.

---

## Endpoints

Every one of them needs the `x-fiver-key` header.

| Path | What it does |
| --- | --- |
| `/health` | confirms the key works and the Worker is up |
| `/accounts` | the accounts Akahu can see, names and banks only |
| `/transactions?days=30` | debits only, normalised for Fiver |
| `/debug?days=7` | three raw rows, for checking field names |

`days` is capped at 400 and pagination stops after 20 pages.

---

## What this is not

- **Not multi-user.** One person, one key. If you ever wanted other
  people on this, none of it survives — you'd need real accounts, real
  auth, and Akahu's commercial tier with its own accreditation review.
- **Not a payment path.** Akahu can initiate payments; this Worker
  deliberately has no code for it. Automating the Thursday sweep would
  mean write access to your bank, and that is a much bigger decision than
  reading a balance.
- **Not a sync engine.** It hands Fiver a list. Fiver decides what to do
  with it, and asks you before anything lands.

## If you want it gone

```bash
npx wrangler delete
```

Then revoke the tokens at my.akahu.nz. Deleting the Worker alone leaves
the tokens live.
