/* End-to-end smoke test of the built app in a real browser. */
const { chromium, devices } = require('playwright');
const path = require('path');

const fs_ = require('fs');

/* This repo's tests run both in a sandbox with a preinstalled Chromium and on
   CI where Playwright fetches its own. Only pin the path when it exists. */
function launchOpts() {
  const local = '/opt/pw-browsers/chromium';
  const opts = { args: ['--no-sandbox'] };
  if (fs_.existsSync(local)) opts.executablePath = local;
  return opts;
}


(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  const results = [];
  function check(name, cond, detail) {
    results.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  <- ' + detail));
  }

  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    colorScheme: 'light',
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland'
  });
  const page = await ctx.newPage();
  // font requests fail in this sandbox; only real script errors matter
  // Fonts and the rate API are third-party fetches the app is designed to
  // survive losing. A failed request to either is not a JS error — and the
  // browser's message for one says nothing about which URL failed, so the
  // check has to look at where the message came from.
  const THIRD_PARTY = /fonts\.googleapis|fonts\.gstatic|frankfurter/;
  const ignorable = m => {
    const t = m.text();
    if (/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR_INTERNET_DISCONNECTED/.test(t)) return true;
    if (THIRD_PARTY.test(t)) return true;
    const loc = m.location && m.location();
    return !!(loc && loc.url && THIRD_PARTY.test(loc.url));
  };
  page.on('console', m => { if (m.type() === 'error' && !ignorable(m)) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  // Block the rate API for the whole run. The tests must behave identically
  // on a laptop with no signal and on a CI runner with a fat pipe, and a
  // third-party API having a bad day must never fail this build. Rates are
  // injected directly where the tests need them.
  // A 503 rather than an abort: it exercises the same failure path without
  // logging a network error the "no JS errors" check would then trip over.
  await page.route('**/api.frankfurter.dev/**', route =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'blocked in tests' }));

  await page.goto('file://' + path.join(__dirname, 'fiver-standalone.html'));
  await page.waitForTimeout(600);

  check('page boots without JS errors', errors.length === 0, errors.join(' | '));

  /* ---- welcome / sign-in ---- */
  check('welcome shows on a fresh install', (await page.locator('#welcome.on').count()) === 1);
  await page.click('.signin.apple');
  await page.waitForTimeout(300);
  const signinNote = await page.textContent('#signinNote');
  check('sign-in is honest about not being connected',
    /isn't connected yet/.test(signinNote) && /server/.test(signinNote), signinNote);
  check('sign-in did not fake a session', (await page.locator('#welcome.on').count()) === 1);
  await page.click('.signin.google');
  await page.waitForTimeout(250);
  check('google behaves the same', (await page.locator('#welcome.on').count()) === 1);
  await page.click('#useLocal');
  await page.waitForTimeout(400);
  check('device-only dismisses the welcome', (await page.locator('#welcome.on').count()) === 0);
  await page.reload();
  await page.waitForTimeout(500);
  check('welcome does not come back', (await page.locator('#welcome.on').count()) === 0);

  check('hero starts at $0', (await page.textContent('#heroVal')) === '0', await page.textContent('#heroVal'));
  await page.click('#moneyTabs .tab[data-view="savings"]');
  await page.waitForTimeout(250);
  check('total cash starts unset', (await page.textContent('#cashVal')) === '—', await page.textContent('#cashVal'));
  check('unset cash explains itself', /banking app/.test(await page.textContent('#cashLedger')),
    await page.textContent('#cashLedger'));
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(200);

  /* ---- log $14.00 via the keypad ---- */
  await page.click('#openAdd');
  await page.waitForTimeout(350);
  for (const k of ['1', '4']) await page.click(`.key:text-is("${k}")`);
  const note = await page.textContent('#amtNote');
  check('keypad shows the round-up', /15/.test(note) && /\$1/.test(note), note);
  await page.click('.chip:text-is("Eating out")');
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  check('hero shows 15 after logging 14', (await page.textContent('#heroVal')) === '15', await page.textContent('#heroVal'));
  check('hero shows the NZ$ symbol', (await page.textContent('#heroCur')) === 'NZ$', await page.textContent('#heroCur'));
  check('3 blocks rendered', (await page.locator('.blk:not(.ghost):not(.more)').count()) === 3,
    await page.locator('.blk:not(.ghost):not(.more)').count());

  /* ---- log rent as a fixed cost ---- */
  await page.click('#openAdd');
  await page.waitForTimeout(300);
  for (const k of ['2', '7', '5']) await page.click(`.key:text-is("${k}")`);
  await page.click('.chip:text-is("Rent")');
  const swOn = await page.locator('#fixedSw.on').count();
  check('Rent auto-flags as fixed', swOn === 1, swOn);
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  check('hero total includes rent ($290)', (await page.textContent('#heroVal')) === '290', await page.textContent('#heroVal'));
  check('blocks still show only flex (3)', (await page.locator('.blk:not(.ghost):not(.more)').count()) === 3,
    await page.locator('.blk:not(.ghost):not(.more)').count());
  check('fixed bar explains itself', !(await page.locator('#fixedBar').getAttribute('class')).includes('hidden'));

  /* ---- jar + sweep ---- */
  const jar = await page.textContent('#jarToday');
  check('jar shows $1 of round-up change', /\$1/.test(jar), jar);
  await page.click('#moneyTabs .tab[data-view="savings"]');
  await page.waitForTimeout(250);
  check('sweep button offers the jar', /\$1/.test(await page.textContent('#doSweep')), await page.textContent('#doSweep'));
  await page.click('#doSweep');
  await page.waitForTimeout(400);
  check('sweep asks where the money goes', (await page.locator('#destSheet.on').count()) === 1);
  await page.fill('#destNew', 'Wise savings');
  await page.fill('#destNote', 'Japan fund');
  await page.click('#destConfirm');
  await page.waitForTimeout(400);
  check('banked-by-app total is NZ$1', (await page.textContent('#bankVal')) === 'NZ$1', await page.textContent('#bankVal'));
  check('destination recorded', /Wise savings/.test(await page.textContent('#dests')), await page.textContent('#dests'));
  check('note recorded in the log', /Japan fund/.test(await page.textContent('#sweepLog')), await page.textContent('#sweepLog'));
  check('jar cannot be swept twice', await page.locator('#doSweep').isDisabled(), await page.textContent('#doSweep'));

  /* ---- persistence across reload ---- */
  await page.reload();
  await page.waitForTimeout(500);
  check('data survives a reload', (await page.textContent('#heroVal')) === '290', await page.textContent('#heroVal'));

  /* ---- edit + delete ---- */
  await page.click('.entry >> nth=1');
  await page.waitForTimeout(300);
  check('edit sheet opens with delete', (await page.locator('#delEntry:visible').count()) === 1);
  await page.click('#delEntry');
  await page.waitForTimeout(350);
  const heroAfterDel = await page.textContent('#heroVal');
  check('deleting removes it from the total', heroAfterDel === '15' || heroAfterDel === '275', heroAfterDel);
  await page.click('#toastAct');
  await page.waitForTimeout(300);
  check('undo restores it', (await page.textContent('#heroVal')) === '290', await page.textContent('#heroVal'));

  /* ---- demo data, trends, baselines ---- */
  page.on('dialog', d => d.accept());
  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.waitForTimeout(200);
  await page.click('#demoBtn');
  await page.waitForTimeout(400);
  check('demo asks before overwriting', await page.locator('#askSheet.on').count() === 1);
  await page.click('#askOk');
  await page.waitForTimeout(700);
  const verdict = await page.textContent('#verdict');
  check('verdict compares against a baseline', /under|over/.test(verdict), verdict);
  await page.click('#moneyTabs .tab[data-view="trends"]');
  await page.waitForTimeout(300);
  check('chart drew 14 columns', (await page.locator('#chart .bwrap').count()) === 14,
    await page.locator('#chart .bwrap').count());
  check('untracked days render as gaps', (await page.locator('#chart .gap').count()) >= 1,
    await page.locator('#chart .gap').count());
  check('baseline line drawn', (await page.locator('.baseline-line').count()) === 1);
  check('categories listed', (await page.locator('#cats .catrow').count()) >= 1,
    await page.locator('#cats .catrow').count());
  check('history grouped by day', (await page.locator('#history .daygroup').count()) >= 10,
    await page.locator('#history .daygroup').count());

  /* ---- baseline mode switch ---- */
  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.selectOption('#baseMode', 'yesterday');
  await page.waitForTimeout(300);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(250);
  check('yesterday mode changes the verdict copy', /yesterday/.test(await page.textContent('#verdict')),
    await page.textContent('#verdict'));

  /* ---- goal line ---- */
  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.fill('#goalDaily', '40');
  await page.waitForTimeout(300);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(250);
  check('goal sets the block line', /target line/.test(await page.textContent('#lineNote')),
    await page.textContent('#lineNote'));

  /* ---- total cash (prompt() is unreliable in a sandboxed frame, so it's in-page) ---- */
  await page.click('#moneyTabs .tab[data-view="savings"]');
  await page.waitForTimeout(250);
  await page.click('#setBal');
  await page.waitForTimeout(400);
  check('cash modal opens in-page', await page.locator('#askSheet.on').count() === 1);
  await page.fill('#askInput', '3000');
  await page.click('#askOk');
  await page.waitForTimeout(350);
  check('cash anchored from the modal', (await page.textContent('#cashVal')) === 'NZ$3,000', await page.textContent('#cashVal'));
  const bankedNow = await page.textContent('#bankVal');
  check('sweeps do not change total cash', (await page.textContent('#cashVal')) === 'NZ$3,000' && bankedNow !== 'NZ$0',
    (await page.textContent('#cashVal')) + ' / ' + bankedNow);
  check('yesterday card offers unswept money', (await page.locator('#ydayCard:not(.hidden)').count()) === 1,
    await page.locator('#ydayCard').getAttribute('class'));
  var bankBefore = await page.textContent('#bankVal');
  var cashBefore = await page.textContent('#cashVal');
  await page.click('#ydaySweep');
  await page.waitForTimeout(400);
  check('yesterday sweep also asks for a destination', (await page.locator('#destSheet.on').count()) === 1);
  await page.click('#destChips .chip >> nth=0');
  await page.click('#destConfirm');
  await page.waitForTimeout(400);
  check('yesterday sweep raises the banked total', (await page.textContent('#bankVal')) !== bankBefore,
    await page.textContent('#bankVal'));
  check('yesterday card clears once swept', (await page.locator('#ydayCard.hidden').count()) === 1);
  check('total cash still untouched after a sweep', (await page.textContent('#cashVal')) === cashBefore,
    (await page.textContent('#cashVal')) + ' was ' + cashBefore);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(250);

  /* ---- income ---- */
  await page.click('#openIncome');
  await page.waitForTimeout(450);
  check('no preset amount chips', (await page.locator('#quickChips').count()) === 0);
  check('income button opens straight into income mode',
    (await page.locator('.seg-btn[data-kind="income"].on').count()) === 1);
  check('sheet title follows the mode', (await page.textContent('#addTitle')) === 'Log what you earned',
    await page.textContent('#addTitle'));
  for (const kk of ['1','6','5']) await page.click(`.key:text-is("${kk}")`);
  const inote = await page.textContent('#amtNote');
  check('income is not rounded', /never rounded/.test(inote) && /165/.test(inote), inote);
  check('fixed-cost toggle hidden for income', (await page.locator('#fixedToggle.hidden').count()) === 1);
  await page.click('.chip:text-is("Lessons")');
  const heroBeforeIncome = await page.textContent('#heroVal');
  await page.click('#saveEntry');
  await page.waitForTimeout(450);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(300);
  check('income does not change the day total', (await page.textContent('#heroVal')) === heroBeforeIncome,
    (await page.textContent('#heroVal')) + ' was ' + heroBeforeIncome);
  const strip = await page.textContent('#incomeBar');
  check('income strip appears', /in today/.test(strip) && /Lessons/.test(strip) && /kept/.test(strip), strip);
  check('income row in the day list', (await page.locator('.badge.in').count()) >= 1);
  const verdictAfter = await page.textContent('#verdict');
  check('income does not change the verdict', /under|over/.test(verdictAfter), verdictAfter);
  await page.click('#moneyTabs .tab[data-view="trends"]');
  await page.waitForTimeout(300);
  check('in vs out card populated', /in/.test(await page.textContent('#flows')) && (await page.locator('.netpill').count()) === 2,
    await page.locator('.netpill').count());
  /* ---- income and spending move total cash; the round-up gap does not ---- */
  await page.click('#moneyTabs .tab[data-view="savings"]');
  await page.waitForTimeout(300);
  const cashPre = await page.textContent('#cashVal');
  await page.click('#openIncome');
  await page.waitForTimeout(400);
  for (const kk of ['1','0','0']) await page.click(`.key:text-is("${kk}")`);
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  await page.click('#moneyTabs .tab[data-view="savings"]');
  await page.waitForTimeout(300);
  const cashAfterIncome = await page.textContent('#cashVal');
  check('income raises total cash', cashAfterIncome !== cashPre, cashAfterIncome + ' was ' + cashPre);
  check('ledger shows what moved', /Earned since/.test(await page.textContent('#cashLedger')),
    await page.textContent('#cashLedger'));

  await page.click('#openAdd');
  await page.waitForTimeout(400);
  for (const kk of ['1','2']) await page.click(`.key:text-is("${kk}")`);
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  await page.click('#moneyTabs .tab[data-view="savings"]');
  await page.waitForTimeout(300);
  const ledger = await page.textContent('#cashLedger');
  check('cash comes off by the real amount, not the rounded one',
    /−NZ\$12(\D|$)/.test(ledger.replace(/\s+/g, ' ')) || /12\.00/.test(ledger), ledger);

  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(250);

  /* ---- backdating ---- */
  await page.click('#openAdd');
  await page.waitForTimeout(400);
  check('day defaults to today', (await page.locator('.chip.when[data-when="0"].on').count()) === 1);
  await page.click('.chip.when[data-when="1"]');
  await page.waitForTimeout(200);
  check('yesterday selectable', (await page.locator('.chip.when[data-when="1"].on').count()) === 1);
  const heroBeforeBackdate = await page.textContent('#heroVal');
  for (const kk of ['9']) await page.click(`.key:text-is("${kk}")`);
  await page.click('#saveEntry');
  await page.waitForTimeout(450);
  check('a backdated spend does not touch today', (await page.textContent('#heroVal')) === heroBeforeBackdate,
    (await page.textContent('#heroVal')) + ' was ' + heroBeforeBackdate);
  await page.click('#moneyTabs .tab[data-view="trends"]');
  await page.waitForTimeout(300);
  check('backdated spend lands in history', /Yesterday/.test(await page.textContent('#history')));
  check('date picker refuses the future',
    (await page.locator('#dayPick').getAttribute('max')) !== null);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(250);

  /* ---- food: a separate app in the same shell ---- */
  const moneyHero = await page.textContent('#heroVal');   // snapshot before we touch food
  await page.click('.mode-btn[data-mode="food"]');
  await page.waitForTimeout(400);
  check('food mode swaps the views', (await page.locator('#v-eat.on').count()) === 1);
  check('food tabs replace the money tabs',
    (await page.locator('#moneyTabs').isVisible()) === false && await page.locator('#foodTabs').isVisible());
  check('food starts at zero', (await page.textContent('#eatVal')) === '0', await page.textContent('#eatVal'));

  /* ---- the slider ---- */
  check('log button starts disabled', await page.locator('#logSlider').isDisabled());
  check('slider steps in 50s', (await page.locator('#kcalSlider').getAttribute('step')) === '50');
  check('slider tops out at 1000', (await page.locator('#kcalSlider').getAttribute('max')) === '1000');
  await page.locator('#kcalSlider').fill('600');
  await page.waitForTimeout(250);
  check('slider readout follows', (await page.textContent('#sliderVal')) === '600',
    await page.textContent('#sliderVal'));
  check('log button lights up once set', !(await page.locator('#logSlider').isDisabled()));
  check('log button names the amount', /600/.test(await page.textContent('#logSlider')),
    await page.textContent('#logSlider'));
  await page.click('#logSlider');
  await page.waitForTimeout(400);
  check('slider logs the amount', (await page.textContent('#eatVal')) === '600', await page.textContent('#eatVal'));
  check('slider resets after logging', (await page.textContent('#sliderVal')) === '0',
    await page.textContent('#sliderVal'));
  check('log button disabled again', await page.locator('#logSlider').isDisabled());
  await page.locator('#kcalSlider').fill('200');
  await page.waitForTimeout(200);
  await page.click('#logSlider');
  await page.waitForTimeout(400);
  check('amounts add up', (await page.textContent('#eatVal')) === '800', await page.textContent('#eatVal'));
  check('budget verdict shown', /left/.test(await page.textContent('#eatVerdict')),
    await page.textContent('#eatVerdict'));
  check('entries listed', (await page.locator('#eatEntries .entry').count()) === 2,
    await page.locator('#eatEntries .entry').count());

  // saving a food, then logging it in one tap
  await page.click('#foodTabs .tab[data-view="foods"]');
  await page.waitForTimeout(300);
  await page.fill('#foodName', 'Porridge');
  await page.fill('#foodKcal', '347');
  await page.click('#addFood');
  await page.waitForTimeout(400);
  check('saved food rounds up to 350', /350/.test(await page.textContent('#foodList')),
    await page.textContent('#foodList'));
  await page.click('#foodTabs .tab[data-view="eat"]');
  await page.waitForTimeout(300);
  check('saved food appears as a chip', (await page.locator('#favChips .chip').count()) >= 1,
    await page.locator('#favChips .chip').count());
  const beforeChip = await page.textContent('#eatVal');
  await page.click('#favChips .chip:text-is("Porridge 350")');
  await page.waitForTimeout(400);
  check('one tap logs the saved food', (await page.textContent('#eatVal')) !== beforeChip,
    (await page.textContent('#eatVal')) + ' was ' + beforeChip);

  /* ---- naming a food must give a text keyboard, not a number pad ---- */
  await page.click('#openEat');
  await page.waitForTimeout(400);
  check('amount step asks for digits',
    (await page.locator('#askInput').getAttribute('inputmode')) === 'decimal',
    await page.locator('#askInput').getAttribute('inputmode'));
  await page.fill('#askInput', '450');
  await page.click('#askOk');
  await page.waitForTimeout(400);
  check('name step asks for letters',
    (await page.locator('#askInput').getAttribute('inputmode')) === 'text',
    await page.locator('#askInput').getAttribute('inputmode'));
  await page.fill('#askInput', 'Chicken roll');
  await page.click('#askOk');
  await page.waitForTimeout(400);
  check('named entry logged', (await page.textContent('#eatVal')) === '1,600',
    await page.textContent('#eatVal'));
  check('naming it saved it as a chip',
    /Chicken roll/.test(await page.textContent('#favChips')), await page.textContent('#favChips'));

  // budget
  await page.click('#foodTabs .tab[data-view="foods"]');
  await page.waitForTimeout(300);
  await page.fill('#dailyBudget', '1000');
  await page.waitForTimeout(400);
  await page.click('#foodTabs .tab[data-view="eat"]');
  await page.waitForTimeout(300);
  check('going over is flagged', /over/.test(await page.textContent('#eatVerdict')),
    await page.textContent('#eatVerdict'));
  check('meter fills', (await page.locator('#eatFill').getAttribute('style')).includes('width'),
    await page.locator('#eatFill').getAttribute('style'));

  // the two apps are genuinely separate
  await page.click('.mode-btn[data-mode="money"]');
  await page.waitForTimeout(400);
  check('money side is untouched by food logging', (await page.textContent('#heroVal')) === moneyHero,
    (await page.textContent('#heroVal')) + ' was ' + moneyHero);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('food has its own storage key', keys.includes('fiver.food.v1'), keys.join(','));
  check('money key untouched', keys.includes('fiver.v1'), keys.join(','));
  const noLeak = await page.evaluate(() => {
    const money = JSON.parse(localStorage.getItem('fiver.v1'));
    return !JSON.stringify(money).includes('Porridge') && !('foods' in money);
  });
  check('no food data leaked into the money state', noLeak);

  // mode survives a reload
  await page.click('.mode-btn[data-mode="food"]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(600);
  check('mode is remembered', (await page.locator('#v-eat.on').count()) === 1);
  check('food data survives a reload', (await page.textContent('#eatVal')) === '1,600',
    await page.textContent('#eatVal'));
  await page.click('.mode-btn[data-mode="money"]');
  await page.waitForTimeout(300);

  /* ---- currency ---- */
  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.waitForTimeout(300);
  check('three currencies offered', (await page.locator('#curChips .chip').count()) === 3,
    await page.locator('#curChips .chip').count());
  check('NZD selected by default', (await page.locator('#curChips .chip.on').textContent()).includes('NZD'),
    await page.locator('#curChips .chip.on').textContent());
  check('rates degrade gracefully when the API is unreachable',
    /unavailable|not fetched/.test(await page.textContent('#fxLabel')), await page.textContent('#fxLabel'));

  // with rates cached, switching converts the history instead of rewriting it
  await page.evaluate(() => {
    localStorage.setItem('fiver.rates.v1', JSON.stringify({
      today: { NZD: 1.6, AUD: 1.5, JPY: 150 },
      prev:  { NZD: 1.62, AUD: 1.5, JPY: 151 },
      date: '2026-08-28', fetchedAt: Date.now()
    }));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.waitForTimeout(300);
  check('rate line shows USD value', /US\$/.test(await page.textContent('#fxLabel')),
    await page.textContent('#fxLabel'));
  check('daily move against USD shown', /▲|▼|flat/.test(await page.textContent('#fxLabel')),
    await page.textContent('#fxLabel'));

  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(300);
  const nzTotal = await page.textContent('#heroVal');
  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.waitForTimeout(250);
  await page.click('#curChips .chip:has-text("JPY")');
  await page.waitForTimeout(500);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(400);
  check('symbol switches to yen', (await page.textContent('#heroCur')) === '¥',
    await page.textContent('#heroCur'));
  const jpyTotal = await page.textContent('#heroVal');
  check('history converts rather than staying put', jpyTotal !== nzTotal, jpyTotal + ' vs ' + nzTotal);
  check('yen total is roughly 94x the NZ one',
    Math.abs((parseFloat(jpyTotal.replace(/,/g,'')) / parseFloat(nzTotal.replace(/,/g,''))) - 93.75) < 5,
    jpyTotal + ' / ' + nzTotal);

  // the round-up step follows the currency
  await page.click('#openAdd');
  await page.waitForTimeout(400);
  for (const kk of ['1','3','2','0']) await page.click(`.key:text-is("${kk}")`);
  const yenNote = await page.textContent('#amtNote');
  check('yen rounds up to the next 500', /1,500/.test(yenNote), yenNote);
  await page.click('#closeAdd');
  await page.waitForTimeout(300);

  // and the stored data is untouched by the display switch
  const untouched = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('fiver.v1'));
    return m.entries.every(e => e.currency === 'NZD');
  });
  check('stored entries keep the currency they were logged in', untouched);

  await page.click('#moneyTabs .tab[data-view="setup"]');
  await page.waitForTimeout(250);
  await page.click('#curChips .chip:has-text("NZD")');
  await page.waitForTimeout(400);
  await page.click('#moneyTabs .tab[data-view="today"]');
  await page.waitForTimeout(300);
  check('switching back restores the original total', (await page.textContent('#heroVal')) === nzTotal,
    (await page.textContent('#heroVal')) + ' was ' + nzTotal);

  /* ---- no horizontal scroll ---- */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow', overflow <= 0, overflow);

  /* ---- screenshots, both themes ---- */
  await page.screenshot({ path: 'shot-today-light.png', fullPage: false });
  await page.click('#moneyTabs .tab[data-view="trends"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-trends-light.png' });
  await page.click('#moneyTabs .tab[data-view="savings"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-savings-light.png' });
  await page.click('#moneyTabs .tab[data-view="today"]'); await page.waitForTimeout(200);
  await page.click('#openAdd'); await page.waitForTimeout(450);
  await page.screenshot({ path: 'shot-add-light.png' });
  await page.click('#closeAdd'); await page.waitForTimeout(300);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-today-dark.png' });

  check('no JS errors across the whole run', errors.length === 0, errors.join(' | '));

  console.log('\n' + results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\n  ' + (results.length - fails) + ' passed, ' + fails + ' failed\n');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
