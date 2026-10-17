// Gold Play: o administrador gera um código de convite (uso único, vale 2 dias) para criar outro acesso ao painel.

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
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...((init.headers as Record<string, string>) ?? {}) }, signal: AbortSignal.timeout(12000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`rest ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ erro: "não autorizado" }, 401);
  try {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, authorization: auth }, signal: AbortSignal.timeout(8000) });
    const uid = u.ok ? (await u.json())?.id : null;
    const p = uid ? await rest(`perfis?user_id=eq.${uid}&ativo=eq.true&papel=eq.admin&select=user_id&limit=1`) : null;
    if (!Array.isArray(p) || !p[0]) return json({ erro: "somente administradores" }, 403);
    let c: any = {};
    try { c = await req.json(); } catch { /* vazio */ }
    const papel = c.papel === "admin" ? "admin" : "revendedor";
    const nome = String(c.nome ?? "").trim().slice(0, 80) || null;
    const codigo = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    await rest("convites", { method: "POST", body: JSON.stringify({ codigo_hash: await sha256(codigo), papel, nome, criado_por: uid }) });
    return json({ ok: true, codigo, papel });
  } catch (e) {
    console.log("convite erro", String(e));
    return json({ erro: "Erro interno." }, 500);
  }
});
