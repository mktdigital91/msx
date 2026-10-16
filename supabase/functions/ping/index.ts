// Teste do servidor: confere se esta função consegue falar com o seu provedor.
// Não usa usuário nem senha. Abra no navegador:  https://SEU-PROJETO.supabase.co/functions/v1/ping
const HOSTS_PERMITIDOS = ["horizonmult.site"];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json; charset=utf-8",
};

async function testar(host: string, protocolo: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${protocolo}://${host}/player_api.php`, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const texto = (await r.text()).slice(0, 120);
    return { protocolo, ok: true, status: r.status, ms: Date.now() - t0, inicio_da_resposta: texto };
  } catch (e) {
    return { protocolo, ok: false, erro: String((e as Error).message ?? e), ms: Date.now() - t0 };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const resultados = await Promise.all(
    HOSTS_PERMITIDOS.flatMap((h) => [testar(h, "http"), testar(h, "https")].map(async (p) => ({ host: h, ...(await p) }))),
  );
  return new Response(JSON.stringify({ resultados }, null, 2), { headers: CORS });
});
