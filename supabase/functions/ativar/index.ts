// Gold Play: primeiro acesso ao painel. Troca um código de convite (de uso único) por uma conta com e-mail e senha.
// A senha é digitada na tela do painel e vai direto para o Supabase Auth; não passa por conversa nenhuma.

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
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...((init.headers as Record<string, string>) ?? {}) }, signal: AbortSignal.timeout(12000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`rest ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  let c: any = {};
  try { c = await req.json(); } catch { return json({ erro: "pedido inválido" }, 400); }
  const codigo = String(c.codigo ?? "").trim().replace(/[\s-]/g, "");
  const email = String(c.email ?? "").trim().toLowerCase();
  const senha = String(c.senha ?? "");
  const nome = String(c.nome ?? "").trim().slice(0, 80);
  if (!/^[A-Za-z0-9]{8,32}$/.test(codigo)) { await dorme(600); return json({ erro: "Código inválido ou expirado." }, 400); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return json({ erro: "E-mail inválido." }, 400);
  if (senha.length < 10 || senha.length > 72) return json({ erro: "A senha precisa ter de 10 a 72 caracteres." }, 400);
  try {
    const hash = await sha256(codigo.toUpperCase());
    const agora = encodeURIComponent(new Date().toISOString());
    const conv = await rest(`convites?codigo_hash=eq.${hash}&usado_em=is.null&expira=gt.${agora}&select=id,papel,nome&limit=1`);
    if (!Array.isArray(conv) || !conv[0]) { await dorme(800); return json({ erro: "Código inválido ou expirado." }, 400); }
    // reserva o código antes de criar a conta, para ele não valer duas vezes
    const reserva = await rest(`convites?id=eq.${conv[0].id}&usado_em=is.null`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ usado_em: new Date().toISOString(), usado_por: email }) });
    if (!Array.isArray(reserva) || !reserva[0]) return json({ erro: "Código inválido ou expirado." }, 400);
    await rest("admins_permitidos?on_conflict=email", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ email, papel: conv[0].papel }) });
    const r = await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { nome: nome || conv[0].nome || null } }), signal: AbortSignal.timeout(12000) });
    if (!r.ok) {
      const t = (await r.text()).toLowerCase();
      // devolve o código para poder tentar de novo
      await rest(`convites?id=eq.${conv[0].id}`, { method: "PATCH", body: JSON.stringify({ usado_em: null, usado_por: null }) });
      if (t.includes("already") || t.includes("registered") || t.includes("exists")) return json({ erro: "Este e-mail já tem conta." }, 409);
      if (t.includes("weak") || t.includes("password")) return json({ erro: "Senha fraca. Use letras, números e símbolos." }, 400);
      return json({ erro: "Não foi possível criar a conta." }, 400);
    }
    const nomeFinal = nome || conv[0].nome;
    if (nomeFinal) await rest(`perfis?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ nome: nomeFinal }) }).catch(() => {});
    return json({ ok: true });
  } catch (e) {
    console.log("ativar erro", String(e));
    return json({ erro: "Erro interno." }, 500);
  }
});
