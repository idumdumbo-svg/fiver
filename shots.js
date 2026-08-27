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
  async function run(scheme) {
    const ctx = await browser.newContext({
      viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, isMobile: true,
      hasTouch: true, colorScheme: scheme, timezoneId: 'Pacific/Auckland'
    });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto('file://' + path.join(__dirname, 'fiver-standalone.html'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `s-welcome-${scheme}.png` });
    await page.click('#useLocal');
    await page.waitForTimeout(400);
    await page.click('.tab[data-view="setup"]');
    await page.click('#demoBtn');
    await page.waitForTimeout(400);
    await page.click('.tab[data-view="today"]');
    await page.waitForTimeout(3600); // let the toast clear
    await page.screenshot({ path: `s-today-${scheme}.png` });
    await page.evaluate(() => window.scrollTo(0, 99999));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `s-today-bottom-${scheme}.png` });
    await page.click('.tab[data-view="trends"]'); await page.waitForTimeout(400);
    await page.screenshot({ path: `s-trends-${scheme}.png` });
    await page.evaluate(() => window.scrollTo(0, 99999)); await page.waitForTimeout(300);
    await page.screenshot({ path: `s-trends-bottom-${scheme}.png` });
    await page.click('.tab[data-view="savings"]'); await page.waitForTimeout(400);
    await page.screenshot({ path: `s-savings-${scheme}.png` });
    await page.click('.tab[data-view="today"]'); await page.waitForTimeout(200);
    await page.click('#openAdd'); await page.waitForTimeout(600);
    for (const k of ['1','4']) await page.click(`.key:text-is("${k}")`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `s-add-${scheme}.png` });
    await page.click('.seg-btn[data-kind="income"]'); await page.waitForTimeout(300);
    for (const k of ['5']) await page.click(`.key:text-is("${k}")`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `s-income-${scheme}.png` });
    await page.click('#closeAdd'); await page.waitForTimeout(350);
    await page.click('.tab[data-view="savings"]'); await page.waitForTimeout(300);
    await page.click('#doSweep'); await page.waitForTimeout(600);
    await page.screenshot({ path: `s-dest-${scheme}.png` });
    await page.click('#closeDest'); await page.waitForTimeout(300);
    await ctx.close();
  }
  await run('light');
  await run('dark');
  await browser.close();
  console.log('shots done');
})();
