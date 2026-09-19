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
  const spend = async (digits, cat, expectPause) => {
    await page.click('#openAdd'); await page.waitForTimeout(350);
    for (const k of digits) await page.click(`.key:text-is("${k}")`);
    await page.click(`.chip:text-is("${cat}")`);
    await page.click('#saveEntry'); await page.waitForTimeout(450);
    const paused = await page.locator('#pauseSheet.on').count() === 1;
    if (expectPause === true) check('the pause fired for ' + digits.join(''), paused);
    if (expectPause === false) check('no pause for ' + digits.join(''), !paused);
    return paused;
  };

  /* ---- welcome ---- */
  check('welcome shows on a fresh install', (await page.locator('#welcome.on').count()) === 1);
  await page.click('#useLocal'); await page.waitForTimeout(400);
  check('device-only dismisses the welcome', (await page.locator('#welcome.on').count()) === 0);

  /* ---- the shell ---- */
  check('opens on Execute', await page.locator('#p-execute').isVisible());
  check('Execute is the active word', (await page.getAttribute('.mode-btn[data-mode="execute"]', 'class')).indexOf('on') !== -1);
  check('three words in the nav, no more', (await page.locator('.mode-btn').count()) === 3);
  check('the question is asked', (await page.textContent('#question')) === "What's important now?");
  check('the intent line prompts when empty', /intent/.test(await page.textContent('#intentLine')));
  check('the number starts at 0', (await page.textContent('#heroVal')) === '0');
  check('and shows the NZ$ symbol', (await page.textContent('#heroCur')) === 'NZ$');

  /* ---- the intent ---- */
  await page.click('#intentBtn'); await page.waitForTimeout(300);
  check('tapping the intent opens setup', await page.locator('#p-setup').isVisible());
  check('with its own question', (await page.textContent('#question')) === 'What is this for?');
  await page.fill('#intentInp', 'A season in Japan'); await page.waitForTimeout(200);
  check('the header updates as you type', (await page.textContent('#intentLine')) === 'A season in Japan');
  await page.fill('#goalDaily', '80'); await page.waitForTimeout(200);
  await page.click('#setupDone'); await page.waitForTimeout(300);
  check('done returns to Execute', await page.locator('#p-execute').isVisible());
  check('the intent stays above the page', (await page.textContent('#intentLine')) === 'A season in Japan');
  check('with a line set, the number is buffer', (await page.textContent('#heroVal')) === '80');
  check('and says so', /buffer/.test(await page.textContent('#heroSub')));

  /* ---- today's three ---- */
  const addNote = async (t) => { await page.fill('#ntInp', t); await page.click('#ntAdd'); await page.waitForTimeout(250); };
  await addNote('Wax the board');
  check('a note lands in Later first', (await page.locator('#laterList .trow').count()) === 1);
  await page.click('#laterList .trow .side'); await page.waitForTimeout(250);
  check('and moves to today', (await page.locator('#todayList .trow').count()) === 1);
  await addNote('Book the L3 assessment'); await page.click('#laterList .trow .side'); await page.waitForTimeout(200);
  await addNote('Reply to GALA'); await page.click('#laterList .trow .side'); await page.waitForTimeout(200);
  await addNote('A fourth thing'); await page.click('#laterList .trow .side'); await page.waitForTimeout(300);
  check('three is the cap', (await page.locator('#todayList .trow').count()) === 3);
  check('the fourth stays in Later', (await page.locator('#laterList .trow').count()) === 1);
  check('the head counts them', (await page.textContent('#todayHead')) === '0 of 3');
  await page.click('#todayList .trow .bx'); await page.waitForTimeout(1100);
  check('finishing one counts', (await page.textContent('#todayHead')) === '1 of 3');

  /* ---- basics ---- */
  await page.click('.basic.add'); await page.waitForTimeout(300);
  await page.fill('#askInput', 'Japanese 15'); await page.click('#askOk'); await page.waitForTimeout(300);
  check('a basic is added', (await page.locator('.basic:not(.add)').count()) === 1);
  check('a Japanese basic gets the arrow to the trainer', (await page.locator('.basic.jp .go').count()) === 1);
  await page.click('.basic.jp'); await page.waitForTimeout(400);
  check('ticking it opens the trainer', await page.locator('#jpPage').isVisible());
  check('the frame is mounted', (await page.getAttribute('#jpFrame', 'data-mounted')) === '1');
  await page.click('#jpClose'); await page.waitForTimeout(300);
  check('done closes it', !(await page.locator('#jpPage').isVisible()));
  check('and the basic is on', (await page.locator('.basic.jp.on').count()) === 1);

  /* ---- spending, and the buffer ---- */
  await spend(['1','4'], 'Eating out', false);
  check('14 rounds to 15 and comes off the buffer', (await page.textContent('#heroVal')) === '65');
  await page.click('.mode-btn[data-mode="eliminate"]'); await page.waitForTimeout(300);
  check('Eliminate shows the spend', (await page.locator('#todayEntries .spend').count()) === 1);
  check('with the real amount under it', /was NZ\$14/.test(await page.textContent('#todayEntries')));
  check('the day total is the rounded figure', /NZ\$15/.test(await page.textContent('#dayTotal')));
  check('noes start at zero', (await page.textContent('#noCount')) === '0');

  /* ---- the pause: third eating-out spend over $20 ---- */
  await page.click('.mode-btn[data-mode="execute"]'); await page.waitForTimeout(200);
  await spend(['2','2'], 'Eating out', false);
  const paused = await spend(['3','4','.','5','0'], 'Eating out', true);
  if (paused) {
    check('the pause asks the question', /clear yes/.test(await page.textContent('#pauseSheet .pause-q')));
    check('and names the rule', /90 out of 100/.test(await page.textContent('#pauseSheet')));
    check('and the reason', /3rd eating out/i.test(await page.textContent('#pauseReasons')));
    check('the amount is shown', (await page.textContent('#pauseVal')) === '34.50');
    check('there is no way to change the amount', (await page.locator('#pauseSheet input').count()) === 0);
    await page.click('#pauseAvert'); await page.waitForTimeout(500);
  }
  check('a no logs nothing', (await page.textContent('#heroVal')) === '40');
  await page.click('.mode-btn[data-mode="eliminate"]'); await page.waitForTimeout(300);
  check('the no counts', (await page.textContent('#noCount')) === '1');
  check('and says what it kept', /NZ\$35/.test(await page.textContent('#noSub')));
  check('the no sits in the day list', (await page.locator('#todayEntries .spend.no').count()) === 1);
  check('struck through, not hidden', /said no/.test(await page.textContent('#todayEntries .spend.no')));

  /* the 90 path */
  await page.click('.mode-btn[data-mode="execute"]'); await page.waitForTimeout(200);
  const paused2 = await spend(['2','1'], 'Eating out', true);
  if (paused2) { await page.click('#pauseGo'); await page.waitForTimeout(500); }
  check('a 90 logs the spend', (await page.textContent('#heroVal')) === '15');
  check('and the buffer keeps counting down', /over|buffer/.test(await page.textContent('#heroSub')));

  /* over the line */
  await spend(['1','7'], 'Groceries', false);
  check('over the line, the number is the overshoot', (await page.textContent('#heroVal')) === '5');
  check('and it says over', /over/.test(await page.textContent('#heroSub')));
  check('and is marked', (await page.getAttribute('#heroVal', 'class')).indexOf('over') !== -1);

  /* ---- the closet test ---- */
  await page.click('.mode-btn[data-mode="eliminate"]'); await page.waitForTimeout(300);
  const recur = async (name, amt, period) => {
    await page.click('#addRecur'); await page.waitForTimeout(350);
    await page.fill('#recurName', name); await page.fill('#recurAmt', amt);
    await page.selectOption('#recurPeriod', period);
    await page.click('#recurSave'); await page.waitForTimeout(350);
  };
  await recur('Spotify', '16.99', 'month');
  await recur('Gym', '22', 'week');
  await recur('Adobe', '89', 'month');
  check('three things in the closet', (await page.locator('#closet .crow').count()) === 3);
  check('nothing freed yet', !(await page.locator('#freed').isVisible()));
  await page.click('#closet .crow:has-text("Adobe") .pill:text-is("Uncommit")'); await page.waitForTimeout(250);
  check('uncommitting shows the yearly figure', /NZ\$1,068/.test(await page.textContent('#freed')));
  check('and a nudge to actually cancel', /Cancel it/.test(await page.textContent('#freed')));
  check('the row is struck', (await page.locator('#closet .crow.gone').count()) === 1);
  check('gone sinks to the bottom', /Adobe/.test(await page.textContent('#closet .crow:last-child')));
  await page.click('#closet .crow:has-text("Adobe") .pill:text-is("Keep")'); await page.waitForTimeout(250);
  check('keeping takes it back', !(await page.locator('#freed').isVisible()));
  await page.click('#closet .crow:has-text("Gym") .pill:text-is("Uncommit")'); await page.waitForTimeout(250);
  check('a weekly bill is yearly-ised', /NZ\$1,144/.test(await page.textContent('#freed')));

  /* ---- the jar ---- */
  check('the jar holds the round-up change', /NZ\$/.test(await page.textContent('#jarVal')));
  const jarVal = await page.textContent('#jarVal');
  check('and it is not zero', jarVal !== 'NZ$0', jarVal);
  check('with a way to move it', await page.locator('#goSweep').isVisible());
  await page.click('#jarCard'); await page.waitForTimeout(400);
  check('moving opens the destination sheet', await page.locator('#destSheet.on').isVisible());
  await page.click('#destConfirm'); await page.waitForTimeout(400);
  check('a sweep is recorded', await page.evaluate(() => JSON.parse(localStorage.getItem('fiver.v1')).sweeps.length) === 1);

  /* ---- explore ---- */
  await page.click('.mode-btn[data-mode="explore"]'); await page.waitForTimeout(300);
  check('Explore asks its question', (await page.textContent('#question')) === 'What is essential?');
  check('seven squares', (await page.locator('#wall .day').count()) === 7);
  check('today is over the line', (await page.locator('#wall .sq.over').count()) === 1);
  check('the count says so', (await page.textContent('#insideVal')) === '0');
  check('of one judged day', /of 1 day/.test(await page.textContent('#insideUnit')));
  check('three biggest listed', (await page.locator('#biggest .brow').count()) === 3);
  check('biggest first', /NZ\$25/.test(await page.textContent('#biggest .brow:first-child .amt')));
  await page.click('#biggest .brow:first-child .pill:text-is("No")'); await page.waitForTimeout(250);
  check('marking no strikes it', (await page.locator('#biggest .brow.not').count()) === 1);
  await page.fill('#oneLine', 'Sent the email. Everything else was maintenance.');
  await page.locator('#oneLine').blur(); await page.waitForTimeout(300);
  const lessRaw = await page.evaluate(() => localStorage.getItem('fiver.less.v1'));
  check('the line is saved', /maintenance/.test(lessRaw));
  check('the mark is saved', /"no"/.test(lessRaw));
  check('the intent is saved', /A season in Japan/.test(lessRaw));

  /* ---- what is not here ---- */
  check('no calorie tracker', (await page.locator('#kcalSlider').count()) === 0);
  check('no score dial', (await page.locator('#dial').count()) === 0);
  check('no sub-tabs', (await page.locator('.tab').count()) === 0);
  check('no icons in the nav', (await page.locator('.mode-btn svg').count()) === 0);

  /* ---- the vault, behind the lock ---- */
  await page.click('#lockBtn'); await page.waitForTimeout(300);
  check('the lock opens Protect', await page.locator('#p-protect').isVisible());
  check('a fresh vault asks to set a passcode', (await page.textContent('#vlockTitle')).indexOf('Set') === 0);
  check('no nav word is active there', (await page.locator('.mode-btn.on').count()) === 0);
  await page.fill('#vlockPass', 'a good long passcode');
  await page.fill('#vlockPass2', 'a good long passcode');
  await page.click('#vlockGo'); await page.waitForTimeout(2500);
  check('setting a passcode unlocks it', await page.locator('.vbody').isVisible());
  await page.click('#addDocBtn'); await page.waitForTimeout(450);
  await page.selectOption('#docType', 'passport');
  await page.fill('#docLabel', 'AU Passport');
  await page.fill('#docNumber', 'PA9999123');
  await page.fill('#docExpires', new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10));
  await page.click('#docSave'); await page.waitForTimeout(700);
  check('the document is listed', (await page.locator('.drow').count()) === 1);
  check('with its expiry called out', /days left/.test(await page.textContent('#docList')));
  const rawStore = await page.evaluate(() => JSON.stringify(localStorage));
  check('the passport number is not in localStorage', rawStore.indexOf('PA9999123') === -1);
  check('nor is its label', rawStore.indexOf('AU Passport') === -1);
  await page.click('.drow'); await page.waitForTimeout(450);
  await page.setInputFiles('#docFileInput', { name: 'scan.png', mimeType: 'image/png',
    buffer: Buffer.from('PLAINTEXTMARKER-8842-scan-bytes-here', 'utf8') });
  await page.waitForTimeout(400);
  await page.click('#docSave'); await page.waitForTimeout(900);
  const idb = await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('fiver-vault', 1);
    r.onsuccess = () => { const db = r.result;
      const g = db.transaction('files', 'readonly').objectStore('files').getAll();
      g.onsuccess = () => { res(g.result.map(f => Array.from(new Uint8Array(f.ct)))); db.close(); }; };
  }));
  check('one file stored', idb.length === 1);
  check('the file bytes on disk are not the plaintext', String.fromCharCode.apply(null, idb[0]).indexOf('PLAINTEXTMARKER') === -1);
  await page.click('#addAccBtn'); await page.waitForTimeout(450);
  await page.fill('#accService', 'IRD'); await page.fill('#accEmail', 'test@example.com');
  await page.click('#accSave'); await page.waitForTimeout(600);
  check('an account is listed under its email', /test@example\.com/.test(await page.textContent('#accList')));
  check('no password field anywhere', (await page.locator('#accSheet input[type="password"]').count()) === 0);
  await page.click('#lockNowBtn'); await page.waitForTimeout(400);
  check('locking hides everything', !(await page.locator('.vbody').isVisible()));
  await page.fill('#vlockPass', 'the wrong passcode'); await page.click('#vlockGo'); await page.waitForTimeout(2500);
  check('a wrong passcode is rejected', /not it/.test(await page.textContent('#vlockNote')));
  await page.fill('#vlockPass', 'a good long passcode'); await page.click('#vlockGo'); await page.waitForTimeout(2500);
  check('the right one opens it again', await page.locator('.vbody').isVisible());
  check('the document survived', (await page.locator('.drow').count()) === 1);
  await page.click('#lockBtn'); await page.waitForTimeout(300);
  check('the lock toggles back to Execute', await page.locator('#p-execute').isVisible());

  /* ---- export leaves the vault out ---- */
  const backup = await page.evaluate(() => localStorage.getItem('fiver.v1'));
  check('the money backup has no vault in it', backup.indexOf('vault') === -1 && backup.indexOf('PA9999') === -1);

  /* ---- persistence ---- */
  await page.click('.mode-btn[data-mode="eliminate"]'); await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(700);
  check('the mode is remembered', await page.locator('#p-eliminate').isVisible());
  check('the noes survive a reload', (await page.textContent('#noCount')) === '1');
  check('the closet survives', (await page.locator('#closet .crow').count()) === 3);
  check('the intent survives', (await page.textContent('#intentLine')) === 'A season in Japan');
  check('the vault is locked after a reload', await page.evaluate(() => window.vaultKey === null));

  /* ---- a no-spend day ---- */
  await page.evaluate(() => { localStorage.removeItem('fiver.v1'); localStorage.removeItem('fiver.curb.v1'); });
  await page.reload(); await page.waitForTimeout(700);
  await page.click('#useLocal'); await page.waitForTimeout(300);
  await page.click('.mode-btn[data-mode="eliminate"]'); await page.waitForTimeout(200);
  await page.click('#noSpendBtn'); await page.waitForTimeout(400);
  check('a no-spend day is logged', /No-spend day/.test(await page.textContent('#todayEmpty')));
  await page.click('.mode-btn[data-mode="explore"]'); await page.waitForTimeout(300);
  check('and shows green on the wall', (await page.locator('#wall .sq.none').count()) === 1);

  /* ---- erase ---- */
  await page.click('#intentBtn'); await page.waitForTimeout(300);
  await page.click('#resetBtn'); await page.waitForTimeout(300);
  await page.click('#askOk'); await page.waitForTimeout(400);
  check('erase clears the intent too', /intent/.test(await page.textContent('#intentLine')));
  check('but not the vault', await page.evaluate(() => !!localStorage.getItem('fiver.vault.v1')));

  check('no JS errors across the whole run', errors.length === 0, errors.join(' | '));

  console.log('\n' + results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\n  ' + (results.length - fails) + ' passed, ' + fails + ' failed\n');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
