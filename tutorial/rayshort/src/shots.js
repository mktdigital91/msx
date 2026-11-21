const { chromium } = require('playwright');
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  let pixStatus = 'pending';
  const exp = new Date(Date.now() + 32*60000).toISOString();
  async function mk(logged) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    if (logged) await ctx.addInitScript(() => { localStorage.setItem('rstv_tok', JSON.stringify('demo')); localStorage.setItem('rstv_conta', JSON.stringify({ name: 'Cliente', vip: false })); });
    await ctx.route(/rayshort\.live\/api\/tv\//, async (route) => {
      const u = route.request().url(), m = route.request().method();
      const acc = { name: 'Cliente', vip: pixStatus === 'approved', vipExpiresAt: pixStatus === 'approved' ? new Date(Date.now()+30*864e5).toISOString() : null };
      let body = { account: acc };
      if (u.includes('/api/tv/vip')) body = { account: acc, options: { customer: true, whatsapp: null, plans: [
        { id: 'a', name: 'Semanal', price: 14.99, durationDays: 7, pix: true },
        { id: 'b', name: 'Mensal', price: 19.99, durationDays: 30, pix: true },
        { id: 'c', name: 'Anual', price: 149.9, durationDays: 365, pix: true } ] } };
      else if (u.includes('/api/tv/checkout')) body = { order: { id: 'demo1', status: pixStatus, amount: 19.99, expiresAt: exp,
        accessExpiresAt: new Date(Date.now()+30*864e5).toISOString(),
        qrCode: '00020126580014BR.GOV.BCB.PIX0136DEMONSTRACAO-RAYSHORT-TV-NAO-PAGAR5204000053039865406019.995802BR5908RAYSHORT6009SAO PAULO62070503***6304ABCD' } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const p = await ctx.newPage();
    await p.goto('https://tv.rayshort.live/', { waitUntil: 'networkidle' });
    await sleep(2500);
    return p;
  }
  const key = async (p, k, n = 1, w = 350) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(w); } };
  const shot = async (p, n, w = 1500) => { await sleep(w); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log(n); };

  const p = await mk(false);
  await shot(p, 'inicio', 3000);
  // descer pela grade
  for (let i = 1; i <= 5; i++) { await key(p, 'ArrowDown'); await shot(p, 'grade' + i, 2200); }
  // conta (Entrar)
  await p.evaluate(() => document.getElementById('nvConta').click());
  await shot(p, 'conta');
  await key(p, 'Enter'); await shot(p, 'login0');
  await key(p, 'Enter');
  for (const d of '11987654321') await key(p, 'Digit' + d, 1, 80);
  await key(p, 'ArrowDown'); await key(p, 'ArrowDown'); await key(p, 'Enter');
  for (const c of 'rayshort24') await key(p, isNaN(c) ? 'Key' + c.toUpperCase() : 'Digit' + c, 1, 80);
  await key(p, 'ArrowDown', 7, 120); await key(p, 'Enter');
  await shot(p, 'login1');
  // ir para botões e ver "Criar conta"
  await p.evaluate(() => document.getElementById('nvConta').click());
  await sleep(600); await key(p, 'ArrowRight'); await key(p, 'Enter'); await shot(p, 'cadastro0');
  await key(p, 'Enter'); for (const c of 'K7M3XR') await key(p, isNaN(c) ? 'Key' + c : 'Digit' + c, 1, 80);
  await shot(p, 'cadastro1');

  const q = await mk(true);
  await q.evaluate(() => document.getElementById('nvConta').click());
  await shot(q, 'conta_logado');
  await key(q, 'Enter'); await shot(q, 'vip0', 2000);
  await key(q, 'ArrowRight'); await shot(q, 'vip1', 800);
  await key(q, 'Enter'); await shot(q, 'pix0', 2500);
  for (let i = 1; i <= 6; i++) await shot(q, 'pix' + i, 1000 - 30);
  pixStatus = 'approved';
  await key(q, 'Enter'); await shot(q, 'pixok', 3000);
  await browser.close();
})();
