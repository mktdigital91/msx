// Gold Play: recebe as respostas do bot do Telegram (botões "Manter" / "Voltar" e o /start de vínculo).
// Só aceita chamadas com o segredo que o próprio Telegram devolve no cabeçalho (definido ao criar o webhook).

const SB = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...((init.headers as Record<string, string>) ?? {}) }, signal: AbortSignal.timeout(12000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`rest ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

let _k: CryptoKey | null = null;
async function chave() {
  if (_k) return _k;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("painel-tg:" + KEY));
  _k = await crypto.subtle.importKey("raw", h, "AES-GCM", false, ["decrypt"]);
  return _k;
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function tokenDe(enc: string): Promise<string | null> {
  try {
    const raw = unb64(enc);
    const d = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await chave(), raw.slice(12));
    return new TextDecoder().decode(d);
  } catch { return null; }
}
async function tg(token: string, metodo: string, corpo: unknown) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000) });
  } catch { /* ignora */ }
}

Deno.serve(async (req) => {
  const ok = () => new Response("ok");
  if (req.method !== "POST") return ok();
  const segredo = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!/^[\w-]{16,256}$/.test(segredo)) return new Response("não autorizado", { status: 401 });
  let cfg: { id: string; chat_id: string | null; bot_token_enc: string | null; codigo_vinculo: string | null } | null = null;
  try {
    const j = await rest(`telegram_config?webhook_secret=eq.${encodeURIComponent(segredo)}&select=id,chat_id,bot_token_enc,codigo_vinculo&limit=1`);
    cfg = Array.isArray(j) && j[0] ? j[0] : null;
  } catch { return ok(); }
  if (!cfg || !cfg.bot_token_enc) return new Response("não autorizado", { status: 401 });
  const token = await tokenDe(cfg.bot_token_enc);
  if (!token) return ok();

  let up: any;
  try { up = await req.json(); } catch { return ok(); }

  // vínculo: /start CODIGO (o código aparece no painel)
  const msg = up?.message;
  if (msg?.text && typeof msg.text === "string") {
    const chat = String(msg.chat?.id ?? "");
    const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,12})$/.exec(msg.text.trim());
    if (m && cfg.codigo_vinculo && m[1].toUpperCase() === cfg.codigo_vinculo.toUpperCase()) {
      await rest(`telegram_config?id=eq.${cfg.id}`, { method: "PATCH", body: JSON.stringify({ chat_id: chat, ativo: true, codigo_vinculo: null, atualizado: new Date().toISOString() }) });
      await tg(token, "sendMessage", { chat_id: chat, text: "✅ Conectado! Vou avisar aqui quando uma DNS cair, voltar ou for trocada." });
    } else if (String(cfg.chat_id ?? "") === chat) {
      await tg(token, "sendMessage", { chat_id: chat, text: "Estou ativo. Você recebe aqui os avisos das DNS." });
    }
    return ok();
  }

  // botões da troca de DNS
  const cb = up?.callback_query;
  if (cb?.data) {
    const chat = String(cb.message?.chat?.id ?? "");
    if (!cfg.chat_id || chat !== String(cfg.chat_id)) { await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Sem permissão." }); return ok(); }
    const m = /^([kv]):([0-9a-f-]{36})$/.exec(String(cb.data));
    if (!m) return ok();
    try {
      const r = await fetch(`${SB}/rest/v1/rpc/decidir_troca`, { method: "POST", headers: H, body: JSON.stringify({ p_troca: m[2], p_manter: m[1] === "k" }), signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      const texto = !r.ok ? "Não consegui aplicar agora."
        : j.status === "mantida" ? "✅ Troca mantida." : j.status === "revertida" ? `↩️ Voltei para a DNS antiga (${j.usuarios} usuário(s)).` : `Esta troca já estava ${j.status}.`;
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: texto });
      await tg(token, "editMessageText", { chat_id: chat, message_id: cb.message.message_id, text: `${cb.message.text}\n\n${texto}` });
    } catch {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Erro ao aplicar a decisão." });
    }
  }
  return ok();
});
