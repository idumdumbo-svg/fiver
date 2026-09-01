const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs');
function launchOpts(){ const l='/opt/pw-browsers/chromium'; const o={args:['--no-sandbox']};
  if(fs.existsSync(l)) o.executablePath=l; return o; }
(async () => {
  const b = await chromium.launch(launchOpts());
  for (const scheme of ['light','dark']) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: scheme,
      locale:'en-NZ', timezoneId:'Pacific/Auckland' });
    const p = await ctx.newPage();
    await p.route('**/api.frankfurter.dev/**', r => r.fulfill({status:503,body:'x'}));
    await p.goto('file://' + path.join(__dirname, 'fiver-standalone.html'));
    await p.waitForTimeout(500);
    await p.click('#useLocal'); await p.waitForTimeout(300);
    await p.click('#moneyTabs .tab[data-view="setup"]'); await p.waitForTimeout(300);
    await p.locator('#demoBtn').scrollIntoViewIfNeeded();
    await p.click('#demoBtn'); await p.waitForTimeout(600);
    // the demo only asks first when there is data to overwrite
    if (await p.locator('#askSheet.on').count()) { await p.click('#askOk'); }
    await p.waitForTimeout(900);

    // a plan, so the score screen shows one
    await p.click('#moneyTabs .tab[data-view="score"]'); await p.waitForTimeout(300);
    await p.click('#addPlan'); await p.waitForTimeout(400);
    await p.fill('#askInput', "it's a weeknight after 8pm"); await p.click('#askOk'); await p.waitForTimeout(450);
    await p.fill('#askInput', "eat what's already in the fridge"); await p.click('#askOk'); await p.waitForTimeout(600);

    // three eating-out to trip the pause, averting the last
    for (const amt of ['40','45']) {
      await p.click('#moneyTabs .tab[data-view="today"]'); await p.waitForTimeout(120);
      await p.click('#openAdd'); await p.waitForTimeout(350);
      for (const c of amt) await p.click(`.key:text-is("${c}")`);
      await p.click('#catChips .chip:text-is("Eating out")'); await p.waitForTimeout(100);
      await p.click('#saveEntry'); await p.waitForTimeout(400);
      if (await p.locator('#pauseSheet.on').count()) { await p.click('#pauseGo'); await p.waitForTimeout(400); }
    }
    await p.click('#openAdd'); await p.waitForTimeout(350);
    for (const c of '48') await p.click(`.key:text-is("${c}")`);
    await p.click('#catChips .chip:text-is("Eating out")'); await p.waitForTimeout(100);
    await p.click('#saveEntry'); await p.waitForTimeout(600);
    await p.screenshot({ path: `c-pause-${scheme}.png` });
    await p.click('#pauseAvert'); await p.waitForTimeout(3600);

    await p.click('#moneyTabs .tab[data-view="score"]'); await p.waitForTimeout(500);
    await p.screenshot({ path: `c-score-${scheme}.png` });
    await p.evaluate(() => window.scrollTo(0, 99999)); await p.waitForTimeout(300);
    await p.screenshot({ path: `c-score-bottom-${scheme}.png` });

    await p.click('#moneyTabs .tab[data-view="setup"]'); await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById('bankUrl').scrollIntoView({block:'center'}));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `c-setup-${scheme}.png` });

    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(scheme, 'overflow', ov);
    await ctx.close();
  }
  await b.close();
  console.log('shots done');
})();
