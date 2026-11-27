// Gera as imagens derivadas da marca a partir dos SVGs oficiais (usa Playwright/Chromium):
//   src/marca/og-xtech.png         1200x630  prévia de compartilhamento
//   src/marca/apple-touch-icon.png 180x180   ícone para tela inicial do celular
//   src/marca/xtech-logo.png       logo raster para dados estruturados
// Uso: node xtech/ferramentas/gerar-imagens.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AQUI = dirname(fileURLToPath(import.meta.url));
const MARCA = join(AQUI, "..", "src", "marca");
const FONTE = "data:font/woff2;base64," + readFileSync(join(AQUI, "..", "src", "fontes", "manrope-latin-variavel.woff2")).toString("base64");
const branca = readFileSync(join(MARCA, "xtech-branca.svg"), "utf8");
const original = readFileSync(join(MARCA, "xtech-original.svg"), "utf8");
const simbolo = readFileSync(join(MARCA, "xtech-simbolo.svg"), "utf8");
const solto = (svg) => svg.replace(/ width="[^"]+" height="[^"]+"/, ' width="100%" height="100%"');

const base = `<style>@font-face{font-family:M;src:url(${FONTE}) format("woff2");font-weight:200 800}
*{margin:0;box-sizing:border-box}body{font-family:M,sans-serif}</style>`;

const og = `${base}<div style="width:1200px;height:630px;background:#072D3D;position:relative;overflow:hidden;padding:72px 80px;color:#fff">
<div style="position:absolute;right:-120px;top:-80px;width:520px;height:693px;background:#0C3B4F;clip-path:polygon(42.86% 0,100% 0,57.14% 100%,0 100%)"></div>
<div style="position:absolute;right:150px;bottom:-60px;width:150px;height:200px;background:#02C2B9;clip-path:polygon(42.86% 0,100% 0,57.14% 100%,0 100%)"></div>
<div style="width:300px;height:103px;position:relative">${solto(branca)}</div>
<p style="position:relative;margin-top:70px;font-size:56px;line-height:1.08;font-weight:800;letter-spacing:-.03em;max-width:860px">Mais contatos para sua clínica.<br><span style="color:#B9CDD3;font-weight:700">Mais organização para transformar conversas em agendamentos.</span></p>
<p style="position:absolute;left:80px;bottom:64px;font-size:24px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#02C2B9">Tráfego pago + automação de atendimento</p>
</div>`;

const icone = `${base}<div style="width:180px;height:180px;background:#fff;display:grid;place-items:center"><div style="width:140px;height:140px">${solto(simbolo)}</div></div>`;
const logo = `${base}<div style="width:1200px;height:412px;background:#fff;padding:20px"><div style="width:100%;height:100%">${solto(original)}</div></div>`;

const browser = await chromium.launch();
async function foto(html, w, h, arq) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(MARCA, arq), clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
  console.log("gerado", arq);
}
await foto(og, 1200, 630, "og-xtech.png");
await foto(icone, 180, 180, "apple-touch-icon.png");
await foto(logo, 1200, 412, "xtech-logo.png");
await browser.close();
