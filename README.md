# Fiver

Two small trackers sharing one shell, switched with a toggle in the top bar,
and a behaviour layer over the spending side.

**Money** — round every spend up to the next five. Watch the day fill up as a
wall of $5 blocks. The gap between what you spent and what you logged gets
swept somewhere you won't spend it.

**Food** — calorie estimates against a daily budget. One tap for a snack or a
meal, and anything you eat often becomes its own chip.

**Score** — the behaviour layer. A weekly discipline score, your current week
ranked against your own past weeks, forgiving streaks, and a pause that speaks
up before a spend you've already made three times this week.

Same idea on both trackers: one big number for today, an average of the days
you actually logged, and rounding that always goes **up** so you never flatter
yourself.

No accounts and no server — everything lives in the browser on your device. A
bank connection is optional, off by default, read-only, and needs a small
Worker of your own; see [Your bank](#your-bank-optional).

---

## How it works

**Rounding.** Every spend rounds up to the next $5. Spend $14, log $15. The $1
difference is the round-up change — you've already mentally spent it, so it's
free to save.

**Fixed costs.** Rent and bills count toward the day's total but sit outside
the comparison. Without that, rent week looks like a spending disaster and
wrecks your baseline for the week after.

**Forgotten days.** A day you never opened is skipped, not counted as $0. Only
days with entries — or a tapped no-spend day — feed the average, so forgetting
to log can't quietly make tomorrow impossible to beat.

**Income** is logged exactly, never rounded, and never touches the day total,
the blocks or the baseline. Those are about spending.

**Money you have** is one figure for everything you own. You read it off your
bank once; after that every spend and every payday moves it. Spending moves it
by what you *actually* paid, not the rounded figure, so it keeps matching
reality. Sweeps don't move it — parking money in a savings account doesn't make
you richer.

**Currency.** NZD, AUD or JPY. The symbol, the decimals and the round-up step
all follow it — $5 in dollar countries, ¥500 in Japan, because ¥5 is not a unit
anyone thinks in. Every entry is stamped with the currency it was logged in, so
switching converts old entries *for display* at today's rate and never rewrites
what you actually spent. Rates are ECB reference rates via
[Frankfurter](https://frankfurter.dev), fetched at most once every six hours and
cached, with a small indicator showing how your currency moved against the US
dollar that day. A failed fetch is silent — logging works offline regardless.

**The score** measures adherence, not thrift: days inside your own target, days
logged, and plans kept. It is deliberately not a function of how much you
spent, so it says nothing about your income. Days you didn't log still count
against the target — otherwise skipping a bad day would score better than
admitting to it, and the app would be teaching you to look away.

**The league** is you against your own previous weeks. Nobody else is ever in
it. The research this came from is one-directional: seeing you're above average
moves overspenders a lot, and seeing you're *below* average moves people about
1% — in the wrong direction. So there is no cohort, no friends, and no message
that ever implies you have room to spend more.

**Freezes.** One earned per seven logged days, two held at most, spent
automatically to bridge a missed day. A freeze only ever joins two stretches of
logging — it can't extend a streak backwards into the time before you started.

**The pause** fires on discretionary spends above $20 when there's a real
pattern to show: the third of a category this week, a cluster after 8pm, or
something much larger than usual for that category. Never on rent, bills or
groceries. It can only do two things — log what you were going to log anyway,
or record that you didn't. It cannot change the amount.

**Fresh starts** only appear on real landmarks (the 1st of a month, New Year).
In the trial this came from, placebo dates did nothing at all, so a random
Tuesday gets no prompt.

**The drift check.** When you re-check your balance, the app tells you what it
expected first, then remembers the difference. That number is the honest
measure of whether the logging habit is sticking.

---

## Layout

```
dates.js         day/week helpers shared by every tracker
currency.js      currencies, conversion and the round-up step
logic.js         the money maths — pure functions, no DOM, fully tested
calories.js      the food maths — same deal, and deliberately isolated
curb.js          the behaviour maths — score, league, freezes, the pause
template.html    the app: markup, styles, and the UI layer over logic.js
sw-template.js   service worker; the build stamps a version into it
build.js         assembles the three outputs below
icons.py         regenerates assets/icons — run only when the mark changes
assets/          committed icons and favicon
test.js          157 money logic tests
test-cal.js      77 food logic tests
test-fx.js       64 currency tests
test-curb.js     100 behaviour tests
uitest.js        142 browser tests against the built app
pwatest.js       16 tests that the hosted build installs and works offline
```

`logic.js`, `calories.js` and `curb.js` are DOM-free so the maths can be tested
exhaustively without a browser. `build.js` concatenates `dates.js`, then the
rest, into the page. `curb.js` is a pure reader: it takes the spending state
and returns numbers, and never writes to it — deleting its storage key
(`fiver.curb.v1`) resets the score and leaves every logged spend untouched.

**The food side is built to be liftable.** It has its own state shape, its own
`localStorage` key (`fiver.food.v1`), and reads nothing from the spending
state — the one thing it borrows is the day-boundary setting, so both halves
agree on when "today" ends. Moving it to its own service means taking
`calories.js`, `dates.js` and that key; nothing has to be untangled first.

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
```

`npm run shots` writes phone-sized screenshots of every screen in both themes —
useful for eyeballing a change without picking up your phone.

Every push to `main` runs all five suites in CI and only deploys if they pass.

---

## Your bank (optional)

Fiver works with nothing connected and that is the default. If you want your
actual spending in it, `bank-proxy/` is a small Cloudflare Worker that holds an
Akahu personal token so your phone never has to. Read-only, one user, no
payment path. Setup is in [bank-proxy/README.md](bank-proxy/README.md).

Imported rows are never added silently: you see them, tick the ones you want,
and they round up to the next five like anything else. Anything that looks like
a spend you already logged by hand is flagged and left unticked.

---

## Deploying

Covered in [DEPLOY.md](DEPLOY.md). Short version: push to `main` and GitHub
Actions builds, tests and publishes to Pages.

After it's live, open it on your phone and **Add to Home Screen**. That is not
housekeeping — an uninstalled site can have its storage cleared by Safari after
about a week of not being opened, and installing is what makes the browser treat
your data as worth keeping. Setup → *Keep it on your phone* tells you your real
status.

---

## Not done yet

- **No sync.** Your phone and your laptop are separate databases. That needs a
  backend, and everything below follows from it.
- **Sign in with Apple / Google** are on the welcome screen and say plainly that
  they aren't connected. Real OAuth needs a server to verify the token.
- **No cloud backup.** Export is manual, from Setup.
- **Recurring bills** aren't automated — rent gets logged by hand every time.
- **No friends or shared leagues.** The league is your own weeks only. Anything
  social needs a backend and real accounts.
- **The bank feed is read-only and manual.** It fetches when you ask it to;
  nothing syncs on its own, and nothing can move money.
- **Fonts** load from Google. Self-hosting them would make the app fully
  offline and drop the third-party request.
