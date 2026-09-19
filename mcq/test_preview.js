const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.toString()));
  await page.goto('file:///home/admin/Projects/Note-type/mcq/preview/preview_mcq.html');
  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
