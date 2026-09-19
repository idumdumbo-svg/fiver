# Fiver

Less, but better.

One line at the top — your intent — and three movements, borrowed from the
book: **Explore**, **Eliminate**, **Execute**. The app opens to one number and
one question. Behind a lock, a vault for the things that must be kept.

**Execute** — *What's important now?* The number is buffer left under your
line, not spend so far. Today's three (three is the cap, on purpose). The
basics you protect every day — sleep, movement, fifteen minutes of the
language — one tap each, never counted.

**Eliminate** — *What can go?* Every spend rounds up to the next five. Before a
discretionary spend with a pattern behind it, one question: *is this a clear
yes?* If it isn't a 90 out of 100, it's a no — and a no is logged, not
discarded. The screen opens with how many noes this week and what they kept.
Every recurring bill gets the closet test: if you weren't already paying,
would you sign up today? Uncommitting shows the yearly figure it frees.

**Explore** — *What is essential?* A weekly ritual, not a dashboard. Days
inside the line, the week as seven squares, the three biggest spends with one
question each — was it essential? — and one line in your words.

**Protect** — *What must be kept?* Passport, licences, CV, certifications, and
which account sits under which email. Encrypted with a passcode that nothing
can reset. See [The vault](#the-vault).

No accounts and no server — everything lives in the browser on your device. A
bank connection is optional, off by default, read-only, and needs a small
Worker of your own; see [Your bank](#your-bank-optional).

---

## How it works

**Rounding.** Every spend rounds up to the next $5. Spend $14, log $15. The $1
difference is the round-up change — you've already mentally spent it, so it's
free to save. It lands in the jar, and once a day you put it somewhere.

**The line** is a ceiling with room under it. Set one in setup, or leave it
blank and your own seven-day average is the line. Rent and bills count toward
the day's total but sit outside it — otherwise rent week would look like a
spending disaster.

**The pause** fires on discretionary spends over $20 when there's a real
pattern: the third of a category this week, a cluster after 8pm, or something
much larger than usual. Never on rent, bills or groceries. It can do exactly
two things — log it, or record a no. It cannot change the amount.

**Noes** are kept, dated, and shown in the day's list struck through. Taking
one back is possible but asks first.

**Forgotten days.** A day you never opened is skipped, not counted as $0. Only
days with entries — or a tapped no-spend day — feed the average, so forgetting
to log can't quietly make tomorrow impossible to beat.

**Income** is logged exactly, never rounded, and never touches the number.

**Money you have** is one figure for everything you own. Read it off your bank
once; every spend and every payday moves it. Re-checking shows the drift —
the honest measure of whether the logging habit is sticking.

**Currency.** NZD, AUD or JPY. Every entry is stamped with the currency it was
logged in; switching converts old entries for display and never rewrites what
you spent. Rates are ECB reference rates via Frankfurter, fetched at most once
every six hours.

---

## Layout

```
dates.js         day/week helpers shared by everything
currency.js      currencies, conversion and the round-up step
logic.js         the money maths — pure functions, no DOM
curb.js          the pause: patterns, and the memory of your noes
notes.js         today's three, the basics, the when-parser
vault.js         the vault — key derivation, encryption, expiry maths
less.js          the essentialist layer — intent, closet test, marks, buffer, the wall
template.html    the app: markup, styles, and the UI over the modules
nihongo.html     the Japanese trainer — self-contained, opened from a basic
sw-template.js   service worker; the build stamps a version into it
build.js         assembles the three outputs below
test.js          157 money tests
test-fx.js       64 currency tests
test-curb.js     100 pause tests
test-notes.js    95 notes tests
test-vault.js    101 vault tests, crypto included
test-less.js     51 essentialist-layer tests
uitest.js        109 browser tests against the built app
pwatest.js       16 tests that the hosted build installs and works offline
```

Every module is DOM-free so the maths — and the crypto — can be tested
without a browser. `build.js` concatenates `dates.js`, then the rest, into the
page.

`calories.js` and `test-cal.js` are still in the repo but no longer built or
run: the food tracker was cut when the app was reframed, and the file is kept
because it was written to be lifted into its own service. `curbshots.js` and
`foodshots.js` are stale for the same reason and can go.

### Build outputs

| Output | What it's for |
| --- | --- |
| `dist/` | the hosted site — what GitHub Pages serves |
| `fiver-standalone.html` | one self-contained file, opens straight off disk |
| `fiver.html` | body-only, for embedding where a host supplies the shell |

---

## Working on it

```bash
npm install
npx playwright install chromium   # first time only
npm run build
npm test                          # logic + app + offline
npm run serve                     # http://localhost:8080
npm run shots                     # phone-sized screenshots of every screen
```

Every push to `main` runs all the suites in CI and only deploys if they pass.

---

## The vault

The passcode is not a screen lock, it is the key. It is stretched with
PBKDF2-SHA256 (250,000 rounds) into an AES-GCM key that exists only in memory
and only while unlocked. Records are one encrypted blob in localStorage;
file bytes are encrypted individually and kept in IndexedDB.

Locking drops the key, and with it everything on screen. It locks itself after
five idle minutes and whenever the app goes to the background. There is no
recovery: no server means no reset. Changing a passcode asks for it twice and
re-encrypts every file before it commits.

**There is deliberately no password field.** Knowing which service sits under
which email solves the problem of losing track. Storing passwords would mean
competing with a real password manager on the one axis — surviving attack —
where a single-file app should not be asking for that trust.

The vault is not in the export. Keep the original documents somewhere else too.

---

## Your bank (optional)

`bank-proxy/` is a small Cloudflare Worker that holds an Akahu personal token
so your phone never has to. Read-only, one user, no payment path. Setup is in
[bank-proxy/README.md](bank-proxy/README.md). Imported rows are never added
silently: you see them, tick the ones you want, and they round up like
anything else.

---

## Deploying

Covered in [DEPLOY.md](DEPLOY.md). Push to `main` and GitHub Actions builds,
tests and publishes to Pages. Then open it on your phone and **Add to Home
Screen** — an uninstalled site can have its storage cleared by Safari after
about a week, and for the vault that means your documents.

---

## Not done yet

- **No sync.** Your phone and your laptop are separate databases. The vault
  cannot sync without weakening the encryption or putting a key on a server.
- **Sign in with Apple / Google** are on the welcome screen and say plainly
  that they aren't connected.
- **Recurring bills** are in the closet test, not automated — rent still gets
  logged by hand.
- **Fonts** load from Google. Self-hosting them would make the app fully
  offline.
