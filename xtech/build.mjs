#!/usr/bin/env node
// Gera o site estático da Xtech em xtech/public a partir de xtech/src e site.config.mjs.
// Uso:  node xtech/build.mjs            (usa site.config.mjs)
//       XT_CONFIG=outro.mjs XT_SAIDA=/tmp/x node xtech/build.mjs   (testes)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as P from "./src/paginas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SRC = join(AQUI, "src");
const SAIDA = resolve(process.env.XT_SAIDA || join(AQUI, "public"));
const cfgPath = resolve(process.env.XT_CONFIG || join(AQUI, "site.config.mjs"));
const cfg = (await import(pathToFileURL(cfgPath).href)).default;

/* ---------- Validação e pendências ---------- */
const dominio = (cfg.dominio || "").replace(/\/+$/, "");
const pendencias = [];
if (!dominio) pendencias.push("domínio real (canonical, sitemap, prévias de compartilhamento e dados estruturados)");
if (!cfg.quizUrl) pendencias.push("URL do diagnóstico no Responda.me (os botões levam ao fim da página até lá)");
if (!cfg.whatsapp?.numero) pendencias.push("WhatsApp comercial");
if (!cfg.instagram) pendencias.push("Instagram");
if (!cfg.email) pendencias.push("e-mail de contato e LGPD");
if (!cfg.empresa?.razaoSocial || !cfg.empresa?.cnpj) pendencias.push("razão social e CNPJ");
if (!cfg.responsavel?.foto) pendencias.push("foto real de Jhonie (opcional)");
const m = cfg.mensuracao || {};
if (!m.gtmId && !m.ga4Id && !m.metaPixelId && !m.criativivoScriptUrl) pendencias.push("identificadores de mensuração (GTM/GA4, Pixel da Meta, Criativivo)");
if (dominio && !/^https:\/\/[^/]+$/.test(dominio)) throw new Error(`dominio inválido: "${cfg.dominio}". Use https://www.exemplo.com.br`);
if (cfg.quizUrl) new URL(cfg.quizUrl); // lança erro se não for URL
if (cfg.whatsapp?.numero && !/^\d{12,13}$/.test(cfg.whatsapp.numero)) throw new Error("whatsapp.numero deve ter só dígitos com DDI e DDD (ex.: 5583999999999)");
const producao = cfg.ambiente === "producao";
if (producao && (!dominio || !cfg.quizUrl)) throw new Error('ambiente "producao" exige dominio e quizUrl preenchidos.');

/* ---------- Utilidades ---------- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
const agora = new Date();
const dataISO = agora.toISOString().slice(0, 10);
const dataHumana = agora.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Fortaleza" });

const css = readFileSync(join(SRC, "estilo.css"), "utf8");
const js = readFileSync(join(SRC, "xt.js"), "utf8");
const jsVersao = hash(js);

function minCss(s) {
  // Minificação conservadora: não mexe em ":" para não alterar seletores como ".escuro :focus-visible".
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};,])\s*/g, "$1").replace(/;}/g, "}").trim();
}

function caminho(slug) { return slug ? `/${slug}/` : "/"; }

/* ---------- Componentes compartilhados ---------- */
function criarHelpers(pagina) {
  const raiz = pagina.raiz;
  const url = (slug) => (slug ? `${raiz}${slug}/` : raiz || "./");
  const cta = ({ posicao, texto = "Fazer diagnóstico gratuito", classe = "" }) =>
    `<a class="botao${classe ? " " + classe : ""}" href="${esc(cfg.quizUrl || "#diagnostico")}" data-xt="diagnostico" data-xt-posicao="${esc(posicao)}">${texto}<span class="botao__seta" aria-hidden="true"></span></a>`;
  const linkWhats = ({ posicao, texto, mensagem, classe = "" }) => {
    if (!cfg.whatsapp?.numero) return "";
    const href = `https://wa.me/${cfg.whatsapp.numero}?text=${encodeURIComponent(mensagem || cfg.whatsapp.mensagemPadrao || "")}`;
    return `<a${classe ? ` class="${classe}"` : ""} href="${esc(href)}" data-xt="whatsapp" data-xt-posicao="${esc(posicao)}" rel="noopener">${texto}</a>`;
  };
  const r = cfg.responsavel || {};
  const responsavel = () => `<div class="responsavel">
      <div class="responsavel__retrato">${r.foto
        ? `<img src="${raiz}fotos/${esc(r.foto)}" alt="${esc(r.fotoDescricao || r.nome)}" width="800" height="1000" loading="lazy" decoding="async">`
        : `<div class="responsavel__monograma" aria-hidden="true"><span>${esc(r.nome.split(/\s+/).map((p) => p[0]).slice(0, 2).join(""))}</span></div>`}</div>
      <div>
        <p class="rotulo">Quem conduz</p>
        <h3>${esc(r.nome)}</h3>
        <p>Jhonie lidera a Xtech em João Pessoa (PB) e participa pessoalmente das reuniões de diagnóstico e da implantação dos serviços. Você fala com quem vai implantar, do primeiro contato à entrega.</p>
        <p>A experiência prática vem da operação de captação e atendimento da AC Harmony, clínica de estética em João Pessoa: o mesmo caminho entre o primeiro contato e a agenda que a Xtech implanta para outras clínicas.</p>
      </div>
    </div>`;
  return { cfg, esc, url, cta, linkWhats, responsavel, dataHumana, raiz };
}

function cabecalho(h, pg) {
  const atual = (k) => (pg.nav === k ? ' aria-current="page"' : "");
  const marca = `<a class="topo__marca" href="${h.url("")}" aria-label="Xtech Soluções Digitais, página inicial"><img src="${h.raiz}marca/xtech-original.svg" alt="Xtech Soluções Digitais" width="152" height="52"></a>`;
  if (pg.topoSimples) {
    return `<header class="topo topo--simples"><div class="conteiner topo__barra">${marca}${h.cta({ posicao: `${pg.slug || "home"}-cabecalho`, texto: "Fazer diagnóstico", classe: "nav__cta-simples" })}</div></header>`;
  }
  return `<header class="topo">
  <div class="conteiner topo__barra">
    ${marca}
    <button class="menu-botao" type="button" aria-expanded="false" aria-controls="menu-principal"><span class="menu-botao__icone" aria-hidden="true"><span></span></span>Menu</button>
    <nav class="nav" id="menu-principal" aria-label="Principal">
      <ul class="nav__lista">
        <li><a href="${h.url("automacao-de-atendimento")}"${atual("automacao")}>Automação de atendimento</a></li>
        <li><a href="${h.url("trafego-pago")}"${atual("trafego")}>Tráfego pago</a></li>
        <li><a href="${h.url("")}#sistemas-e-ia">Sistemas e IA</a></li>
        <li><a href="${h.url("")}#como-trabalhamos">Como trabalhamos</a></li>
        <li class="nav__cta">${h.cta({ posicao: `${pg.slug || "home"}-menu`, texto: "Fazer diagnóstico gratuito" })}</li>
      </ul>
    </nav>
  </div>
</header>`;
}

function rodape(h) {
  const e = cfg.empresa;
  const whats = h.linkWhats({ posicao: "rodape", texto: "WhatsApp comercial" });
  const contatos = [
    `<li><a href="${esc(cfg.quizUrl || "#diagnostico")}" data-xt="diagnostico" data-xt-posicao="rodape">Diagnóstico gratuito</a></li>`,
    whats && `<li>${whats}</li>`,
    cfg.instagram && `<li><a href="${esc(cfg.instagram)}" rel="noopener">Instagram</a></li>`,
    cfg.email && `<li><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a></li>`,
  ].filter(Boolean).join("");
  const ano = agora.getFullYear();
  return `<footer class="rodape" data-esconde-barra>
  <div class="conteiner">
    <div class="rodape__grade">
      <div class="rodape__marca">
        <img src="${h.raiz}marca/xtech-branca.svg" alt="Xtech Soluções Digitais" width="152" height="52" loading="lazy">
        <p>Tecnologia e marketing para empresas que querem mais contatos e um atendimento organizado.</p>
        <p>${esc(e.cidade)} (${esc(e.uf)}) · Atendimento remoto em todo o Brasil</p>
      </div>
      <div>
        <h2>Serviços</h2>
        <ul>
          <li><a href="${h.url("automacao-de-atendimento")}">Automação de atendimento</a></li>
          <li><a href="${h.url("trafego-pago")}">Gestão de tráfego pago</a></li>
          <li><a href="${h.url("")}#servicos">Tráfego + atendimento</a></li>
          <li><a href="${h.url("")}#sistemas-e-ia">Sistemas e IA sob medida</a></li>
          <li><a href="${h.url("clinicas-de-estetica")}">Para clínicas de estética</a></li>
        </ul>
      </div>
      <div>
        <h2>Contato</h2>
        <ul>${contatos}<li><a href="${h.url("privacidade")}">Política de privacidade</a></li></ul>
      </div>
    </div>
    <div class="rodape__base">
      <p>© ${ano} ${esc(e.razaoSocial || e.nome)}${e.cnpj ? ` · CNPJ ${esc(e.cnpj)}` : ""}</p>
      <p><a href="${h.url("privacidade")}">Privacidade</a></p>
    </div>
  </div>
</footer>`;
}

function faixaPrevia() {
  if (producao) return "";
  const itens = pendencias.length
    ? ` <details><summary>${pendencias.length} pendências na configuração</summary><ul>${pendencias.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></details>`
    : "";
  return `<div class="previa" role="region" aria-label="Aviso de prévia"><strong>Prévia para revisão</strong>, fora do índice dos buscadores.${itens}</div>`;
}

function schemaOrganizacao() {
  if (!dominio) return null;
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${dominio}/#organizacao`,
    name: cfg.empresa.nome,
    url: `${dominio}/`,
    logo: `${dominio}/marca/xtech-logo.png`,
    description: "Empresa de tecnologia e marketing: automação de atendimento, gestão de tráfego pago, sistemas e soluções com IA.",
    address: { "@type": "PostalAddress", addressLocality: cfg.empresa.cidade, addressRegion: cfg.empresa.uf, addressCountry: "BR" },
    areaServed: { "@type": "Country", name: "Brasil" },
  };
  if (cfg.empresa.razaoSocial) org.legalName = cfg.empresa.razaoSocial;
  if (cfg.instagram) org.sameAs = [cfg.instagram];
  if (cfg.email) org.email = cfg.email;
  if (cfg.whatsapp?.numero) org.contactPoint = { "@type": "ContactPoint", contactType: "sales", telephone: `+${cfg.whatsapp.numero}`, availableLanguage: "Portuguese" };
  return org;
}

function schemaMigalhas(pg) {
  if (!dominio || !pg.migalha) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${dominio}/` },
      { "@type": "ListItem", position: 2, name: pg.migalha, item: `${dominio}${caminho(pg.slug)}` },
    ],
  };
}

function migalhasVisiveis(h, pg) {
  if (!pg.migalha) return "";
  return `<nav class="migalhas conteiner" aria-label="Você está em"><ol><li><a href="${h.url("")}">Início</a></li><li aria-current="page">${esc(pg.migalha)}</li></ol></nav>`;
}

/* ---------- Montagem da página ---------- */
function montar(fn, { raiz, slugSaida }) {
  const h = criarHelpers({ raiz });
  const pg = fn(h);
  const canon = dominio && !pg.naoIndexar ? `${dominio}${caminho(pg.slug)}` : "";
  const indexar = producao && !pg.naoIndexar;
  const ogImg = dominio ? `${dominio}/marca/og-xtech.png` : "";
  const schemas = [pg.slug === "" ? schemaOrganizacao() : null, schemaMigalhas(pg)].filter(Boolean);
  const cfgCliente = {
    quizUrl: cfg.quizUrl || "",
    parametros: cfg.parametrosPreservados || [],
    parametroOrigem: cfg.parametroOrigem || "",
    pagina: caminho(pg.slug),
    eventos: { cliqueDiagnostico: cfg.eventos.cliqueDiagnostico.nome, cliqueWhatsapp: cfg.eventos.cliqueWhatsapp.nome },
    mensuracao: { gtmId: m.gtmId || "", ga4Id: m.ga4Id || "", metaPixelId: m.metaPixelId || "", criativivoScriptUrl: m.criativivoScriptUrl || "" },
  };
  const temMensuracao = !!(m.gtmId || m.ga4Id || m.metaPixelId || m.criativivoScriptUrl);
  const barra = !pg.semBarra
    ? `<div class="barra-cta" aria-hidden="true">${h.cta({ posicao: `${pg.slug || "home"}-barra` })}</div>`
    : "";
  const consent = temMensuracao
    ? `<div class="consentimento" id="consentimento" role="region" aria-label="Aviso de cookies" hidden><p>Usamos cookies de mensuração para entender quais páginas e anúncios ajudam as pessoas a chegar até a Xtech. Você escolhe. <a href="${h.url("privacidade")}">Saiba mais</a>.</p><div class="acoes"><button class="botao" type="button" data-consentimento="aceito">Aceitar</button><button class="botao botao--linha" type="button" data-consentimento="recusado">Recusar</button></div></div>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>document.documentElement.className="js"</script>
<title>${esc(pg.titulo)}</title>
<meta name="description" content="${esc(pg.descricao)}">
${indexar ? "" : '<meta name="robots" content="noindex, nofollow">\n'}${canon ? `<link rel="canonical" href="${canon}">\n` : ""}<meta name="theme-color" content="#072D3D">
<link rel="icon" href="${raiz}marca/xtech-simbolo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${raiz}marca/apple-touch-icon.png">
<link rel="preload" href="${raiz}fontes/manrope-latin-variavel.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Xtech Soluções Digitais">
<meta property="og:title" content="${esc(pg.titulo)}">
<meta property="og:description" content="${esc(pg.descricao)}">
${canon ? `<meta property="og:url" content="${canon}">\n` : ""}${ogImg ? `<meta property="og:image" content="${ogImg}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="Xtech Soluções Digitais: tráfego pago e automação de atendimento para clínicas">\n` : ""}<meta name="twitter:card" content="summary_large_image">
<style>${minCss(css.replaceAll("{{RAIZ}}", raiz))}</style>
${schemas.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("\n")}
<script id="xt-config" type="application/json">${JSON.stringify(cfgCliente).replace(/</g, "\\u003c")}</script>
<script src="${raiz}xt.js?v=${jsVersao}" defer></script>
</head>
<body>
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
${faixaPrevia()}
${cabecalho(h, pg)}
${migalhasVisiveis(h, pg)}
<main id="conteudo" tabindex="-1">
${pg.corpo.trim()}
</main>
${rodape(h)}
${barra}
${consent}
</body>
</html>
`;
  const destino = slugSaida === "404" ? join(SAIDA, "404.html") : join(SAIDA, pg.slug, "index.html");
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, html);
  return { pg, destino, bytes: Buffer.byteLength(html) };
}

/* ---------- Execução ---------- */
rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });
cpSync(join(SRC, "marca"), join(SAIDA, "marca"), { recursive: true });
cpSync(join(SRC, "fontes"), join(SAIDA, "fontes"), { recursive: true });
if (cfg.responsavel?.foto) {
  const f = join(SRC, "fotos", cfg.responsavel.foto);
  if (!existsSync(f)) throw new Error(`Foto não encontrada: ${f}`);
  mkdirSync(join(SAIDA, "fotos"), { recursive: true });
  cpSync(f, join(SAIDA, "fotos", cfg.responsavel.foto));
}
writeFileSync(join(SAIDA, "xt.js"), js);

const paginas = [
  [P.home, ""],
  [P.automacao, "automacao-de-atendimento"],
  [P.trafego, "trafego-pago"],
  [P.campanha, "clinicas-de-estetica"],
  [P.privacidade, "privacidade"],
];
const gerados = paginas.map(([fn, slug]) => montar(fn, { raiz: slug ? "../" : "", slugSaida: slug }));
gerados.push(montar(P.erro404, { raiz: "/", slugSaida: "404" }));

// robots.txt e sitemap.xml
const indexaveis = gerados.filter((g) => !g.pg.naoIndexar);
writeFileSync(join(SAIDA, "robots.txt"),
  `User-agent: *\n${producao ? "Allow: /" : "Disallow:"}\n${dominio && producao ? `\nSitemap: ${dominio}/sitemap.xml\n` : ""}`);
if (dominio) {
  writeFileSync(join(SAIDA, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexaveis.map((g) => `  <url><loc>${dominio}${caminho(g.pg.slug)}</loc><lastmod>${dataISO}</lastmod></url>`).join("\n")}
</urlset>
`);
}

// Cabeçalhos HTTP (Cloudflare Pages / Netlify)
writeFileSync(join(SAIDA, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
${producao ? "" : "  X-Robots-Tag: noindex\n"}
https://:project.pages.dev/*
  X-Robots-Tag: noindex

https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex

/fontes/*
  Cache-Control: public, max-age=31536000, immutable

/xt.js
  Cache-Control: public, max-age=31536000, immutable

/marca/*
  Cache-Control: public, max-age=604800
`);

console.log(`Site gerado em ${SAIDA} (${producao ? "produção" : "prévia"})`);
for (const g of gerados) console.log(`  ${g.destino.replace(SAIDA, "")}  ${(g.bytes / 1024).toFixed(1)} KB`);
if (pendencias.length) {
  console.log("\nPendências na configuração (site.config.mjs):");
  for (const p of pendencias) console.log(`  - ${p}`);
}
for (const f of ["og-xtech.png", "apple-touch-icon.png", "xtech-logo.png"]) {
  if (!existsSync(join(SRC, "marca", f))) console.log(`  ! Falta src/marca/${f}: rode node xtech/ferramentas/gerar-imagens.mjs`);
}
