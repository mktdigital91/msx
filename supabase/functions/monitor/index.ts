// Gold Play: monitor das DNS. Roda a cada minuto (pg_cron). Checa cada DNS, registra o resultado,
// avisa no Telegram quando cai/volta e, se estiver ligado, move os usuários para outra DNS do mesmo servidor.

const SB = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const INTERVALO_MS = 45_000; // não checa a mesma DNS mais de uma vez a cada 45 s
const TIMEOUT_MS = 8_000;

type Dns = {
  id: string; grupo_id: string; owner_id: string | null; nome: string | null; host: string; protocolo: string; porta: number | null;
  ativo: boolean; prioridade: number; status: string; falhas_seguidas: number; alertado: boolean; latencia_ms: number | null;
  ultima_checagem: string | null; ultimo_erro: string | null;
};
type Grupo = { id: string; owner_id: string | null; nome: string; dns_ativa_id: string | null; auto_troca: boolean; falhas_para_trocar: number };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...((init.headers as Record<string, string>) ?? {}) }, signal: AbortSignal.timeout(12000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`rest ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const patch = (tab: string, filtro: string, corpo: unknown) => rest(`${tab}?${filtro}`, { method: "PATCH", body: JSON.stringify(corpo) });
const rpc = (fn: string, corpo: unknown) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(corpo) });

// ---------- chave do token do Telegram (mesmo esquema do "painel") ----------
let _k: CryptoKey | null = null;
async function chave() {
  if (_k) return _k;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("painel-tg:" + KEY));
  _k = await crypto.subtle.importKey("raw", h, "AES-GCM", false, ["decrypt"]);
  return _k;
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function tokenTelegram(enc: string): Promise<string | null> {
  try {
    const raw = unb64(enc);
    const d = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await chave(), raw.slice(12));
    return new TextDecoder().decode(d);
  } catch { return null; }
}

// ---------- Telegram ----------
type Cfg = { token: string; chat: string } | null;
const cacheCfg = new Map<string, Cfg>();
async function configTelegram(owner: string | null): Promise<Cfg> {
  const k = owner ?? "global";
  if (cacheCfg.has(k)) return cacheCfg.get(k)!;
  let cfg: Cfg = null;
  try {
    const consulta = async (o: string | null) => {
      const f = o ? `owner_id=eq.${o}` : "owner_id=is.null";
      const j = await rest(`telegram_config?${f}&ativo=eq.true&select=chat_id,bot_token_enc&limit=1`);
      return Array.isArray(j) && j[0] ? j[0] : null;
    };
    const linha = (owner && (await consulta(owner))) || (await consulta(null));
    if (linha?.chat_id && linha?.bot_token_enc) {
      const token = await tokenTelegram(linha.bot_token_enc);
      if (token) cfg = { token, chat: String(linha.chat_id) };
    }
  } catch { /* sem aviso */ }
  cacheCfg.set(k, cfg);
  return cfg;
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function avisar(owner: string | null, texto: string, botoes?: unknown) {
  const cfg = await configTelegram(owner);
  if (!cfg) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true, ...(botoes ? { reply_markup: botoes } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch { return false; }
}

// ---------- checagem ----------
async function sondar(d: Dns) {
  const base = `${d.protocolo}://${d.host}${d.porta ? ":" + d.porta : ""}`;
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/player_api.php`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (GoldPlay monitor)" } });
    const ms = Math.round(performance.now() - t0);
    try { await r.body?.cancel(); } catch { /* ignora */ }
    if (r.status >= 500) return { ok: false, status: r.status, ms, erro: `HTTP ${r.status}` };
    return { ok: true, status: r.status, ms, erro: null as string | null };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const nome = (e as Error)?.name;
    const msg = nome === "TimeoutError" || nome === "AbortError" ? `sem resposta em ${TIMEOUT_MS / 1000}s` : String((e as Error)?.message ?? e).slice(0, 160);
    return { ok: false, status: null as number | null, ms, erro: msg };
  }
}

async function ehPainel(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  try {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, authorization: auth }, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return false;
    const uid = (await u.json())?.id;
    if (!uid) return false;
    const p = await rest(`perfis?user_id=eq.${uid}&ativo=eq.true&select=papel&limit=1`);
    return Array.isArray(p) && !!p[0];
  } catch { return false; }
}

const nomeDns = (d: Dns) => `${esc(d.nome || d.host)} (${esc(d.host)})`;

async function ciclo(forcar: boolean, soDns: string | null) {
  const grupos: Grupo[] = await rest("grupos?select=id,owner_id,nome,dns_ativa_id,auto_troca,falhas_para_trocar");
  const todas: Dns[] = await rest("dns?select=*&order=prioridade.asc");
  const gPorId = new Map(grupos.map((g) => [g.id, g]));
  const agora = Date.now();
  const devidas = todas.filter((d) => d.ativo && (!soDns || d.id === soDns) &&
    (forcar || !d.ultima_checagem || agora - new Date(d.ultima_checagem).getTime() >= INTERVALO_MS));

  const resultados = await Promise.all(devidas.map(async (d) => ({ d, r: await sondar(d) })));

  // 1) grava resultados e atualiza o estado em memória
  const estado = new Map<string, Dns>(todas.map((d) => [d.id, { ...d }]));
  const novasQuedas: { d: Dns; erro: string | null; falhas: number }[] = [];
  const voltas: { d: Dns; ms: number }[] = [];
  for (const { d, r } of resultados) {
    const g = gPorId.get(d.grupo_id);
    const falhas = r.ok ? 0 : d.falhas_seguidas + 1;
    const limiar = g?.falhas_para_trocar ?? 3;
    const confirmouQueda = !r.ok && falhas >= limiar && !d.alertado;
    const voltou = r.ok && d.alertado;
    const novo = {
      status: r.ok ? "online" : "offline",
      falhas_seguidas: falhas,
      latencia_ms: r.ok ? r.ms : d.latencia_ms,
      ultima_checagem: new Date().toISOString(),
      ultimo_erro: r.ok ? null : r.erro,
      alertado: confirmouQueda ? true : voltou ? false : d.alertado,
    };
    Object.assign(estado.get(d.id)!, novo);
    try {
      await patch("dns", `id=eq.${d.id}`, novo);
      await rest("dns_checks", { method: "POST", body: JSON.stringify({ dns_id: d.id, owner_id: d.owner_id, ok: r.ok, status_http: r.status, latencia_ms: r.ms, erro: r.erro }) });
    } catch (e) { console.log("falha ao gravar", d.host, String(e)); }
    if (confirmouQueda) novasQuedas.push({ d, erro: r.erro, falhas });
    if (voltou) voltas.push({ d, ms: r.ms });
  }

  // 2) avisos de queda e de volta
  for (const q of novasQuedas) {
    const g = gPorId.get(q.d.grupo_id);
    const alt = melhorAlternativa(q.d, [...estado.values()]);
    let txt = `🔴 <b>DNS offline</b>\n${nomeDns(q.d)}\nServidor: ${esc(g?.nome)}\nMotivo: ${esc(q.erro)}\nFalhas seguidas: ${q.falhas}`;
    if (!alt) txt += `\n\n⚠️ Nenhuma outra DNS deste servidor está online. Mantive ${esc(q.d.host)}.`;
    else if (!g?.auto_troca) txt += `\n\nTroca automática desligada neste servidor.`;
    await avisar(q.d.owner_id, txt);
  }
  for (const v of voltas) {
    await avisar(v.d.owner_id, `🟢 <b>DNS de volta</b>\n${nomeDns(v.d)}\nResposta em ${v.ms} ms`);
  }

  // 3) troca automática: qualquer DNS confirmada offline que ainda tenha usuários (ou seja a ativa)
  const trocas: { de: string; para: string; usuarios: number }[] = [];
  for (const g of grupos) {
    if (!g.auto_troca) continue;
    for (const d of [...estado.values()].filter((x) => x.grupo_id === g.id && x.status === "offline" && x.falhas_seguidas >= g.falhas_para_trocar)) {
      const gAtual = g.dns_ativa_id;
      const us = await rest(`usuarios_app?dns_id=eq.${d.id}&select=usuario&limit=1`);
      const temUsuarios = Array.isArray(us) && us.length > 0;
      if (gAtual !== d.id && !temUsuarios) continue;
      const alt = melhorAlternativa(d, [...estado.values()]);
      if (!alt) continue;
      try {
        const res = await rpc("trocar_dns_em_massa", { p_de: d.id, p_para: alt.id, p_motivo: "auto", p_status: "aguardando" });
        if (g.dns_ativa_id === d.id) g.dns_ativa_id = alt.id;
        trocas.push({ de: d.id, para: alt.id, usuarios: res?.usuarios ?? 0 });
        const botoes = { inline_keyboard: [[{ text: "✅ Manter", callback_data: `k:${res?.troca_id}` }, { text: "↩️ Voltar para a antiga", callback_data: `v:${res?.troca_id}` }]] };
        await avisar(g.owner_id, `🔁 <b>Troca de DNS realizada</b>\nDe: ${nomeDns(d)}\nPara: ${nomeDns(alt)}\nUsuários movidos: ${res?.usuarios ?? 0}\n\nDeseja manter ou voltar para a DNS antiga?`, botoes);
      } catch (e) { console.log("falha na troca", String(e)); }
    }
  }
  return { checadas: resultados.length, quedas: novasQuedas.length, voltas: voltas.length, trocas: trocas.length };
}

// ---------- qualidade de reprodução (telemetria enviada pelo player da TV) ----------
type Ev = { owner_id: string | null; host: string | null; canal: string | null; tipo: string; dur_ms: number | null; ctrl_ms: number | null; prov_ms: number | null; causa: string | null; em: string };
const LIM_TRAVADAS = 3, JANELA_MIN = 10, DUR_LONGA_MS = 20_000, ESPERA_ALERTA_MS = 30 * 60 * 1000;
const _alertaQ = new Map<string, number>(); // reserva em memória se a coluna do banco não existir
const mediana = (n: number[]) => { if (!n.length) return null; const s = [...n].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const ROTULO: Record<string, string> = {
  internet: "🌐 Sua internet/Wi-Fi: o teste contra o nosso servidor também ficou lento ou falhou na hora da travada.",
  provedor: "📡 O provedor: a sua internet estava boa, mas o servidor do provedor respondeu lento ou não respondeu.",
  tv: "📺 A TV: rede e provedor normais, mas o aparelho perdeu muitos quadros de vídeo.",
  canal: "🎞️ A origem do canal: rede e provedor responderam bem; a falha foi no sinal desse canal específico.",
};
async function qualidade() {
  let evs: Ev[] = [];
  try {
    const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    evs = await rest(`play_eventos?em=gte.${desde}&select=owner_id,host,canal,tipo,dur_ms,ctrl_ms,prov_ms,causa,em&order=em.desc&limit=3000`) ?? [];
  } catch { return { avaliados: 0 }; } // tabela ainda não criada
  if (!evs.length) return { avaliados: 0 };
  const dnsTodas: Dns[] = await rest("dns?select=*");
  const corte = Date.now() - JANELA_MIN * 60 * 1000;
  const grupos = new Map<string, Ev[]>();
  for (const e of evs) { const k = `${e.owner_id ?? ""}|${e.host ?? ""}`; (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(e); }
  let enviados = 0;
  for (const [k, lista] of grupos) {
    const [owner, host] = k.split("|");
    const rec = lista.filter((e) => new Date(e.em).getTime() >= corte);
    const trav = rec.filter((e) => e.tipo === "travada" || e.tipo === "reconexao");
    const maior = Math.max(0, ...trav.map((e) => e.dur_ms ?? 0));
    const dns = dnsTodas.find((d) => d.host === host && (d.owner_id ?? "") === owner) ?? dnsTodas.find((d) => d.host === host);
    const antes = dns && (dns as unknown as { qualidade_alertada?: string | null }).qualidade_alertada
      ? new Date((dns as unknown as { qualidade_alertada: string }).qualidade_alertada).getTime() : (_alertaQ.get(k) ?? 0);
    const marcar = async (v: string | null) => {
      if (v) _alertaQ.set(k, Date.now()); else _alertaQ.delete(k);
      if (dns) { try { await patch("dns", `id=eq.${dns.id}`, { qualidade_alertada: v }); } catch { /* coluna ainda não existe */ } }
    };
    const critico = trav.length >= LIM_TRAVADAS || maior >= DUR_LONGA_MS;
    if (critico && Date.now() - antes >= ESPERA_ALERTA_MS) {
      const cont: Record<string, number> = {};
      for (const e of trav) cont[e.causa ?? "canal"] = (cont[e.causa ?? "canal"] ?? 0) + 1;
      const principal = Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "canal";
      const amostras = rec.filter((e) => e.tipo === "amostra");
      const ct = mediana([...trav, ...amostras].map((e) => e.ctrl_ms).filter((x): x is number => typeof x === "number" && x >= 0));
      const pv = mediana([...trav, ...amostras].map((e) => e.prov_ms).filter((x): x is number => typeof x === "number" && x >= 0));
      const canais = [...new Set(trav.map((e) => e.canal).filter(Boolean))].slice(0, 4);
      const nomeH = dns ? nomeDns(dns) : esc(host);
      let txt = `⚠️ <b>Travamentos na reprodução</b>\n${nomeH}\n${trav.length} travada(s) em ${JANELA_MIN} min, a maior de ${Math.round(maior / 1000)} s`;
      if (canais.length) txt += `\nCanais: ${esc(canais.join(", "))}`;
      txt += `\n\n<b>Causa mais provável</b>\n${ROTULO[principal] ?? principal}`;
      const detalhes = Object.entries(cont).map(([c, n]) => `${c}: ${n}`).join(" · ");
      txt += `\n\nDistribuição: ${esc(detalhes)}`;
      if (ct !== null || pv !== null) txt += `\nTempo de resposta típico: nosso servidor ${ct ?? "–"} ms · provedor ${pv ?? "–"} ms`;
      if (principal === "canal" && canais.length === 1) txt += `\n\nSó este canal falhou: tente outro canal para confirmar.`;
      if (await avisar(owner || null, txt)) { await marcar(new Date().toISOString()); enviados++; }
    } else if (!critico && antes && Date.now() - antes >= 5 * 60 * 1000) {
      const calmo = rec.some((e) => e.tipo === "amostra") && trav.length === 0;
      if (calmo) {
        const nomeH = dns ? nomeDns(dns) : esc(host);
        if (await avisar(owner || null, `🟢 <b>Reprodução normalizada</b>\n${nomeH}\nSem travadas nos últimos ${JANELA_MIN} min.`)) await marcar(null);
      }
    }
  }
  if (new Date().getMinutes() === 0) { // limpeza semanal dos eventos antigos
    try { await rest(`play_eventos?em=lt.${new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()}`, { method: "DELETE", headers: { prefer: "return=minimal" } }); } catch { /* ignora */ }
  }
  return { avaliados: evs.length, alertas: enviados };
}

function melhorAlternativa(d: Dns, todas: Dns[]): Dns | null {
  return todas
    .filter((x) => x.grupo_id === d.grupo_id && x.id !== d.id && x.ativo && x.status === "online")
    .sort((a, b) => a.prioridade - b.prioridade || (a.latencia_ms ?? 1e9) - (b.latencia_ms ?? 1e9))[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  const forcar = u.searchParams.get("forcar") === "1";
  if (forcar && !(await ehPainel(req))) return new Response(JSON.stringify({ erro: "não autorizado" }), { status: 401, headers: CORS });
  try {
    const r = await ciclo(forcar, u.searchParams.get("dns"));
    let ql: unknown = null;
    try { ql = await qualidade(); } catch (e) { console.log("erro na qualidade", String(e)); }
    return new Response(JSON.stringify({ ok: true, ...r, qualidade: ql }), { headers: CORS });
  } catch (e) {
    console.log("erro no ciclo", String(e));
    return new Response(JSON.stringify({ ok: false, erro: String((e as Error)?.message ?? e) }), { status: 500, headers: CORS });
  }
});
