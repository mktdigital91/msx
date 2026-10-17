// Gold Play: ações do painel que precisam de segredo (token do bot do Telegram).
// O painel chama com o login do administrador; o token nunca volta para o navegador.

const SB = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...((init.headers as Record<string, string>) ?? {}) }, signal: AbortSignal.timeout(12000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`rest ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
let _k: CryptoKey | null = null;
async function chave() {
  if (_k) return _k;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("painel-tg:" + KEY));
  _k = await crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
  return _k;
}
async function cifrar(txt: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), new TextEncoder().encode(txt)));
  const t = new Uint8Array(iv.length + c.length); t.set(iv); t.set(c, iv.length);
  return b64(t);
}
async function decifrar(enc: string): Promise<string | null> {
  try {
    const raw = unb64(enc);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await chave(), raw.slice(12)));
  } catch { return null; }
}
const aleatorio = (n: number, alfabeto: string) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => alfabeto[x % alfabeto.length]).join("");

async function quem(req: Request): Promise<{ uid: string; papel: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  try {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, authorization: auth }, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return null;
    const uid = (await u.json())?.id;
    if (!uid) return null;
    const p = await rest(`perfis?user_id=eq.${uid}&ativo=eq.true&select=papel&limit=1`);
    return Array.isArray(p) && p[0] ? { uid, papel: p[0].papel } : null;
  } catch { return null; }
}
async function tgApi(token: string, metodo: string, corpo: unknown = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000) });
  return await r.json().catch(() => ({ ok: false }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const eu = await quem(req);
  if (!eu) return json({ erro: "não autorizado" }, 401);
  let c: any = {};
  try { c = await req.json(); } catch { /* corpo vazio */ }
  const owner = eu.papel === "admin" ? null : eu.uid; // admin cuida da configuração global
  const filtro = owner ? `owner_id=eq.${owner}` : "owner_id=is.null";

  try {
    if (c.acao === "telegram_salvar") {
      const token = String(c.token ?? "").trim();
      if (!/^\d{6,12}:[\w-]{30,60}$/.test(token)) return json({ erro: "Token inválido. Cole o token que o BotFather entregou." }, 400);
      const me = await tgApi(token, "getMe");
      if (!me?.ok) return json({ erro: "O Telegram não aceitou esse token." }, 400);
      const segredo = aleatorio(40, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
      const codigo = aleatorio(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
      const corpo = { owner_id: owner, bot_username: me.result?.username ?? null, bot_token_enc: await cifrar(token), webhook_secret: segredo, codigo_vinculo: codigo, chat_id: null, ativo: false, atualizado: new Date().toISOString() };
      const ex = await rest(`telegram_config?${filtro}&select=id&limit=1`);
      if (Array.isArray(ex) && ex[0]) await rest(`telegram_config?id=eq.${ex[0].id}`, { method: "PATCH", body: JSON.stringify(corpo) });
      else await rest("telegram_config", { method: "POST", body: JSON.stringify(corpo) });
      const hook = await tgApi(token, "setWebhook", { url: `${SB}/functions/v1/telegram`, secret_token: segredo, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      if (!hook?.ok) return json({ erro: "Não consegui ligar o bot ao painel (webhook)." }, 502);
      return json({ ok: true, bot: me.result?.username, codigo });
    }
    if (c.acao === "telegram_novo_codigo") {
      const codigo = aleatorio(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
      await rest(`telegram_config?${filtro}`, { method: "PATCH", body: JSON.stringify({ codigo_vinculo: codigo, atualizado: new Date().toISOString() }) });
      return json({ ok: true, codigo });
    }
    if (c.acao === "telegram_testar") {
      const l = await rest(`telegram_config?${filtro}&select=chat_id,bot_token_enc&limit=1`);
      const cfg = Array.isArray(l) ? l[0] : null;
      const token = cfg?.bot_token_enc ? await decifrar(cfg.bot_token_enc) : null;
      if (!token || !cfg?.chat_id) return json({ erro: "O Telegram ainda não está vinculado." }, 400);
      const r = await tgApi(token, "sendMessage", { chat_id: cfg.chat_id, text: "🔔 Teste do painel Gold Play: os avisos estão funcionando." });
      return r?.ok ? json({ ok: true }) : json({ erro: "O Telegram recusou a mensagem." }, 502);
    }
    if (c.acao === "telegram_remover") {
      const l = await rest(`telegram_config?${filtro}&select=bot_token_enc&limit=1`);
      const token = Array.isArray(l) && l[0]?.bot_token_enc ? await decifrar(l[0].bot_token_enc) : null;
      if (token) await tgApi(token, "deleteWebhook", { drop_pending_updates: true });
      await rest(`telegram_config?${filtro}`, { method: "DELETE" });
      return json({ ok: true });
    }
    return json({ erro: "ação desconhecida" }, 400);
  } catch (e) {
    console.log("painel erro", String(e));
    return json({ erro: "Erro interno." }, 500);
  }
});
