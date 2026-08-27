/* Verifies the hosted build really is installable and really works offline. */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* This repo's tests run both in a sandbox with a preinstalled Chromium and on
   CI where Playwright fetches its own. Only pin the path when it exists. */
function launchOpts() {
  const local = '/opt/pw-browsers/chromium';
  const opts = { args: ['--no-sandbox'] };
  if (fs.existsSync(local)) opts.executablePath = local;
  return opts;
}


const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, 'dist', p);
  if (!file.startsWith(path.join(__dirname, 'dist')) || !fs.existsSync(file)) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(8788, r));
  const results = [];
  const check = (n, c, d) => results.push((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  <- ' + d));

  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Pacific/Auckland' });
  const page = await ctx.newPage();
  const errors = [];
  const ignorable = t => /ERR_TUNNEL|fonts\.googleapis|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(t);
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });

  await page.goto('http://localhost:8788/');
  await page.waitForTimeout(700);

  /* ---- manifest ---- */
  const man = await page.evaluate(async () => {
    const r = await fetch('./manifest.webmanifest');
    return r.ok ? r.json() : null;
  });
  check('manifest served', !!man);
  check('manifest is standalone', man && man.display === 'standalone', man && man.display);
  check('manifest has a 512 icon', !!(man && man.icons.find(i => i.sizes === '512x512')));
  check('manifest has a maskable icon', !!(man && man.icons.find(i => i.purpose === 'maskable')));

  const iconOk = await page.evaluate(async () => {
    const r = await fetch('./icons/icon-192.png');
    return r.ok && r.headers.get('content-type').includes('png');
  });
  check('icons served', iconOk);
  check('apple-touch-icon declared', (await page.locator('link[rel="apple-touch-icon"]').count()) === 1);

  /* ---- service worker ---- */
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
    .catch(() => {});
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { registered: !!reg, controlled: !!navigator.serviceWorker.controller };
  });
  check('service worker registered', swState.registered, JSON.stringify(swState));
  check('service worker controls the page', swState.controlled, JSON.stringify(swState));

  /* ---- get past the welcome and log something ---- */
  await page.click('#useLocal');
  await page.waitForTimeout(300);
  await page.click('#openAdd');
  await page.waitForTimeout(350);
  for (const k of ['8']) await page.click(`.key:text-is("${k}")`);
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  check('logged $8 online', (await page.textContent('#heroVal')) === '10', await page.textContent('#heroVal'));

  /* ---- pull the plug ---- */
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(900);
  check('app loads with no network', (await page.locator('#app').count()) === 1);
  check('data intact offline', (await page.textContent('#heroVal')) === '10', await page.textContent('#heroVal'));

  await page.click('#openAdd');
  await page.waitForTimeout(350);
  for (const k of ['3']) await page.click(`.key:text-is("${k}")`);
  await page.click('#saveEntry');
  await page.waitForTimeout(400);
  check('can log a spend while offline', (await page.textContent('#heroVal')) === '15', await page.textContent('#heroVal'));

  await ctx.setOffline(false);
  await page.reload();
  await page.waitForTimeout(700);
  check('offline entry survives coming back online', (await page.textContent('#heroVal')) === '15',
    await page.textContent('#heroVal'));

  /* ---- storage persistence + install copy ---- */
  await page.click('.tab[data-view="setup"]');
  await page.waitForTimeout(400);
  const storage = await page.textContent('#storageLabel');
  check('storage status reported', /protected|backup/.test(storage), storage);
  const install = await page.textContent('#installNote');
  check('install guidance shown', install.length > 20, install);

  check('no JS errors on the hosted build', errors.length === 0, errors.join(' | '));

  console.log('\n' + results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\n  ' + (results.length - fails) + ' passed, ' + fails + ' failed\n');
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})();
