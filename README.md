# Fiver

Two small trackers sharing one shell, switched with a toggle in the top bar.

**Money** — round every spend up to the next five. Watch the day fill up as a
wall of $5 blocks. The gap between what you spent and what you logged gets
swept somewhere you won't spend it.

**Food** — calorie estimates against a daily budget. One tap for a snack or a
meal, and anything you eat often becomes its own chip.

Same idea both sides: one big number for today, an average of the days you
actually logged, and rounding that always goes **up** so you never flatter
yourself.

No accounts, no bank connection, no server. Everything lives in the browser on
your device.

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

**The drift check.** When you re-check your balance, the app tells you what it
expected first, then remembers the difference. That number is the honest
measure of whether the logging habit is sticking.

---

## Layout

```
dates.js         day/week helpers shared by both trackers
logic.js         the money maths — pure functions, no DOM, fully tested
calories.js      the food maths — same deal, and deliberately isolated
template.html    the app: markup, styles, and the UI layer over logic.js
sw-template.js   service worker; the build stamps a version into it
build.js         assembles the three outputs below
icons.py         regenerates assets/icons — run only when the mark changes
assets/          committed icons and favicon
test.js          157 money logic tests
test-cal.js      77 food logic tests
uitest.js        83 browser tests against the built app
pwatest.js       16 tests that the hosted build installs and works offline
```

`logic.js` and `calories.js` are DOM-free so the maths can be tested
exhaustively without a browser. `build.js` concatenates `dates.js`, then both,
into the page.

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

Every push to `main` runs all three suites in CI and only deploys if they pass.

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
- **Currency is hardcoded** to `$` and $5 steps.
- **Fonts** load from Google. Self-hosting them would make the app fully
  offline and drop the third-party request.
