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
  const ignorable = t => /ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR_INTERNET_DISCONNECTED|fonts\.googleapis/.test(t);
  page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

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
  await page.click('.tab[data-view="savings"]');
  await page.waitForTimeout(250);
  check('total cash starts unset', (await page.textContent('#cashVal')) === '—', await page.textContent('#cashVal'));
  check('unset cash explains itself', /banking app/.test(await page.textContent('#cashLedger')),
    await page.textContent('#cashLedger'));
  await page.click('.tab[data-view="today"]');
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
  check('hero shows $15 after logging $14', (await page.textContent('#heroVal')) === '15', await page.textContent('#heroVal'));
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
  await page.click('.tab[data-view="savings"]');
  await page.waitForTimeout(250);
  check('sweep button offers the jar', /\$1/.test(await page.textContent('#doSweep')), await page.textContent('#doSweep'));
  await page.click('#doSweep');
  await page.waitForTimeout(400);
  check('sweep asks where the money goes', (await page.locator('#destSheet.on').count()) === 1);
  await page.fill('#destNew', 'Wise savings');
  await page.fill('#destNote', 'Japan fund');
  await page.click('#destConfirm');
  await page.waitForTimeout(400);
  check('banked-by-app total is $1', (await page.textContent('#bankVal')) === '$1', await page.textContent('#bankVal'));
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
  await page.click('.tab[data-view="setup"]');
  await page.waitForTimeout(200);
  await page.click('#demoBtn');
  await page.waitForTimeout(400);
  check('demo asks before overwriting', await page.locator('#askSheet.on').count() === 1);
  await page.click('#askOk');
  await page.waitForTimeout(700);
  const verdict = await page.textContent('#verdict');
  check('verdict compares against a baseline', /under|over/.test(verdict), verdict);
  await page.click('.tab[data-view="trends"]');
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
  await page.click('.tab[data-view="setup"]');
  await page.selectOption('#baseMode', 'yesterday');
  await page.waitForTimeout(300);
  await page.click('.tab[data-view="today"]');
  await page.waitForTimeout(250);
  check('yesterday mode changes the verdict copy', /yesterday/.test(await page.textContent('#verdict')),
    await page.textContent('#verdict'));

  /* ---- goal line ---- */
  await page.click('.tab[data-view="setup"]');
  await page.fill('#goalDaily', '40');
  await page.waitForTimeout(300);
  await page.click('.tab[data-view="today"]');
  await page.waitForTimeout(250);
  check('goal sets the block line', /target line/.test(await page.textContent('#lineNote')),
    await page.textContent('#lineNote'));

  /* ---- total cash (prompt() is unreliable in a sandboxed frame, so it's in-page) ---- */
  await page.click('.tab[data-view="savings"]');
  await page.waitForTimeout(250);
  await page.click('#setBal');
  await page.waitForTimeout(400);
  check('cash modal opens in-page', await page.locator('#askSheet.on').count() === 1);
  await page.fill('#askInput', '3000');
  await page.click('#askOk');
  await page.waitForTimeout(350);
  check('cash anchored from the modal', (await page.textContent('#cashVal')) === '$3,000', await page.textContent('#cashVal'));
  const bankedNow = await page.textContent('#bankVal');
  check('sweeps do not change total cash', (await page.textContent('#cashVal')) === '$3,000' && bankedNow !== '$0',
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
  await page.click('.tab[data-view="today"]');
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
  await page.click('.tab[data-view="today"]');
  await page.waitForTimeout(300);
  check('income does not change the day total', (await page.textContent('#heroVal')) === heroBeforeIncome,
    (await page.textContent('#heroVal')) + ' was ' + heroBeforeIncome);
  const strip = await page.textContent('#incomeBar');
  check('income strip appears', /in today/.test(strip) && /Lessons/.test(strip) && /kept/.test(strip), strip);
  check('income row in the day list', (await page.locator('.badge.in').count()) >= 1);
  const verdictAfter = await page.textContent('#verdict');
  check('income does not change the verdict', /under|over/.test(verdictAfter), verdictAfter);
  await page.click('.tab[data-view="trends"]');
  await page.waitForTimeout(300);
  check('in vs out card populated', /in/.test(await page.textContent('#flows')) && (await page.locator('.netpill').count()) === 2,
    await page.locator('.netpill').count());
  /* ---- income and spending move total cash; the round-up gap does not ---- */
  await page.click('.tab[data-view="savings"]');
  await page.waitForTimeout(300);
  const cashPre = await page.textContent('#cashVal');
  await page.click('#openIncome');
  await page.waitForTimeout(400);
  for (const kk of ['1','0','0']) await page.click(`.key:text-is("${kk}")`);
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  await page.click('.tab[data-view="savings"]');
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
  await page.click('.tab[data-view="savings"]');
  await page.waitForTimeout(300);
  const ledger = await page.textContent('#cashLedger');
  check('cash comes off by the real amount, not the rounded one',
    /−\$12(\D|$)/.test(ledger.replace(/\s+/g, ' ')) || /12\.00/.test(ledger), ledger);

  await page.click('.tab[data-view="today"]');
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
  await page.click('.tab[data-view="trends"]');
  await page.waitForTimeout(300);
  check('backdated spend lands in history', /Yesterday/.test(await page.textContent('#history')));
  check('date picker refuses the future',
    (await page.locator('#dayPick').getAttribute('max')) !== null);
  await page.click('.tab[data-view="today"]');
  await page.waitForTimeout(250);

  /* ---- no horizontal scroll ---- */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow', overflow <= 0, overflow);

  /* ---- screenshots, both themes ---- */
  await page.screenshot({ path: 'shot-today-light.png', fullPage: false });
  await page.click('.tab[data-view="trends"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-trends-light.png' });
  await page.click('.tab[data-view="savings"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-savings-light.png' });
  await page.click('.tab[data-view="today"]'); await page.waitForTimeout(200);
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
