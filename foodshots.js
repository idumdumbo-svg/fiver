const { chromium, devices } = require('playwright');
const path=require('path'), fs=require('fs');
function opts(){const l='/opt/pw-browsers/chromium';const o={args:['--no-sandbox']};if(fs.existsSync(l))o.executablePath=l;return o;}
(async()=>{
  const b=await chromium.launch(opts());
  for(const sc of ['light','dark']){
    const c=await b.newContext({...devices['iPhone 13'],colorScheme:sc,locale:'en-NZ',timezoneId:'Pacific/Auckland'});
    const p=await c.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.route('**/api.frankfurter.dev/**',r=>r.fulfill({status:503,body:'x'}));
    await p.goto('file://'+path.join(__dirname,'fiver-standalone.html'));
    await p.waitForTimeout(500);
    await p.click('#useLocal'); await p.waitForTimeout(300);
    await p.click('.mode-btn[data-mode="food"]'); await p.waitForTimeout(400);
    // a budget and some history so the screen isn't bare
    await p.click('#foodTabs .tab[data-view="foods"]'); await p.waitForTimeout(250);
    await p.fill('#dailyBudget','2200'); await p.waitForTimeout(250);
    await p.fill('#foodName','Porridge'); await p.fill('#foodKcal','350');
    await p.click('#addFood'); await p.waitForTimeout(300);
    await p.click('#foodTabs .tab[data-view="eat"]'); await p.waitForTimeout(300);
    await p.locator('#kcalSlider').fill('600'); await p.click('#logSlider'); await p.waitForTimeout(400);
    await p.screenshot({path:`f-today-${sc}.png`});
    // step back two days and log there
    await p.click('#eatPrev'); await p.waitForTimeout(250);
    await p.click('#eatPrev'); await p.waitForTimeout(300);
    await p.locator('#kcalSlider').fill('450'); await p.waitForTimeout(250);
    await p.screenshot({path:`f-past-${sc}.png`});
    await p.click('#logSlider'); await p.waitForTimeout(3600);
    await p.screenshot({path:`f-past-logged-${sc}.png`});
    const ov=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    console.log(sc,'overflow',ov,'errors',errs);
    await c.close();
  }
  await b.close(); console.log('done');
})();
