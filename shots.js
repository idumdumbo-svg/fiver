/* Phone-sized screenshots of every screen, for eyeballing a change.
   Run: npm run shots — writes s-*.png next to this file. */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
function launchOpts() {
  const local = '/opt/pw-browsers/chromium';
  const opts = { args: ['--no-sandbox'] };
  if (fs.existsSync(local)) opts.executablePath = local;
  return opts;
}
(async () => {
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-NZ', timezoneId: 'Pacific/Auckland' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.route('**/api.frankfurter.dev/**', r => r.fulfill({ status: 503, body: 'x' }));
  await page.goto('file://' + path.join(__dirname, 'fiver-standalone.html'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 's-welcome.png' });
  await page.click('#useLocal'); await page.waitForTimeout(300);
  await page.click('#intentBtn'); await page.waitForTimeout(200);
  await page.click('#demoBtn'); await page.waitForTimeout(300);
  const ok = (await page.locator('#askSheet.on').count()) === 1;
  if (ok) { await page.click('#askOk'); await page.waitForTimeout(400); }
  for (const m of ['execute', 'eliminate', 'explore']) {
    await page.click(`.mode-btn[data-mode="${m}"]`); await page.waitForTimeout(400);
    await page.screenshot({ path: `s-${m}.png` });
  }
  await page.click('#lockBtn'); await page.waitForTimeout(300);
  await page.screenshot({ path: 's-protect.png' });
  await page.click('#intentBtn'); await page.waitForTimeout(300);
  await page.screenshot({ path: 's-setup.png', fullPage: true });
  await page.click('#setupDone'); await page.click('#openAdd'); await page.waitForTimeout(400);
  await page.screenshot({ path: 's-add.png' });
  await browser.close();
  console.log('shots done');
})();
