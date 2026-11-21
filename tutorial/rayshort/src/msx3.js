const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.argv[2]; const seq = JSON.parse(process.argv[3]);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage(); await p.goto('https://msx.benzac.de/', { waitUntil: 'networkidle' }); await sleep(4000);
  let i = 0;
  for (const s of seq) {
    if (s.startsWith('c:')) { const t=s.slice(2); for (let j=0;j<t.length;j++){ await p.keyboard.type(t[j]); await sleep(450); await p.screenshot({ path: `${OUT}/c${String(j+1).padStart(2,'0')}.png` }); } continue; }
    if (s.startsWith('w:')) { await sleep(+s.slice(2)); continue; }
    await p.keyboard.down(s); await sleep(120); await p.keyboard.up(s); await sleep(2000);
    await p.screenshot({ path: `${OUT}/step${String(++i).padStart(2,'0')}.png` });
  }
  await sleep(3000); await p.screenshot({ path: `${OUT}/final.png` });
  await b.close();
})();
