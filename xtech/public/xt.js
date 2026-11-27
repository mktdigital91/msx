/* Xtech — comportamento do site (sem dependências).
   1. Preserva parâmetros de campanha e os repassa ao quiz.
   2. Registra cliques em diagnóstico e WhatsApp (somente o clique).
   3. Menu do celular, barra fixa de CTA e demonstração de atendimento.
   4. Aviso de cookies: ferramentas de mensuração só carregam após aceite. */
(function () {
  "use strict";
  var cfgEl = document.getElementById("xt-config");
  var cfg = {};
  try { cfg = JSON.parse(cfgEl ? cfgEl.textContent : "{}"); } catch (e) { cfg = {}; }
  var reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function guardar(chave, valor) { try { window.sessionStorage.setItem(chave, valor); } catch (e) {} }
  function ler(chave) { try { return window.sessionStorage.getItem(chave); } catch (e) { return null; } }
  function guardarLocal(chave, valor) { try { window.localStorage.setItem(chave, valor); } catch (e) {} }
  function lerLocal(chave) { try { return window.localStorage.getItem(chave); } catch (e) { return null; } }

  /* ---------- 1. Parâmetros de origem ---------- */
  var lista = cfg.parametros || [];
  var origem = {};
  try { origem = JSON.parse(ler("xt_origem_params") || "{}") || {}; } catch (e) { origem = {}; }
  var atuais = new URLSearchParams(window.location.search);
  var chegouComCampanha = lista.some(function (p) { return atuais.has(p); });
  if (chegouComCampanha) {
    // Nova visita de campanha substitui a anterior (último clique de anúncio na sessão).
    origem = {};
    lista.forEach(function (p) { if (atuais.get(p)) origem[p] = atuais.get(p).slice(0, 200); });
    guardar("xt_origem_params", JSON.stringify(origem));
  }

  function urlDoQuiz(posicao) {
    if (!cfg.quizUrl) return null;
    var u;
    try { u = new URL(cfg.quizUrl); } catch (e) { return null; }
    Object.keys(origem).forEach(function (p) { if (!u.searchParams.has(p)) u.searchParams.set(p, origem[p]); });
    if (cfg.parametroOrigem && posicao && !u.searchParams.has(cfg.parametroOrigem)) u.searchParams.set(cfg.parametroOrigem, posicao);
    return u.toString();
  }

  function atualizarLinksQuiz() {
    var links = document.querySelectorAll('a[data-xt="diagnostico"]');
    for (var i = 0; i < links.length; i++) {
      var href = urlDoQuiz(links[i].getAttribute("data-xt-posicao"));
      if (href) links[i].setAttribute("href", href);
    }
  }
  atualizarLinksQuiz();

  /* ---------- 2. Registro de eventos ---------- */
  window.dataLayer = window.dataLayer || [];
  function registrar(nome, dados) {
    var ev = { event: nome, pagina: cfg.pagina || window.location.pathname };
    for (var k in dados) if (Object.prototype.hasOwnProperty.call(dados, k)) ev[k] = dados[k];
    window.dataLayer.push(ev);
    if (typeof window.gtag === "function" && cfg.ga4) window.gtag("event", nome, dados);
    if (typeof window.fbq === "function") window.fbq("trackCustom", nome, dados);
  }

  document.addEventListener("click", function (ev) {
    var a = ev.target.closest ? ev.target.closest("a[data-xt]") : null;
    if (!a) return;
    var tipo = a.getAttribute("data-xt");
    var posicao = a.getAttribute("data-xt-posicao") || "";
    if (tipo === "diagnostico") {
      var href = urlDoQuiz(posicao);
      if (href) a.setAttribute("href", href);
      if (cfg.quizUrl) registrar(cfg.eventos.cliqueDiagnostico, { posicao: posicao });
    } else if (tipo === "whatsapp") {
      registrar(cfg.eventos.cliqueWhatsapp, { posicao: posicao });
    }
  });

  /* ---------- 3a. Menu do celular ---------- */
  var botaoMenu = document.querySelector(".menu-botao");
  var nav = document.getElementById("menu-principal");
  if (botaoMenu && nav) {
    var abrir = function (sim) {
      botaoMenu.setAttribute("aria-expanded", sim ? "true" : "false");
      nav.classList.toggle("aberto", sim);
    };
    botaoMenu.addEventListener("click", function () {
      var aberto = botaoMenu.getAttribute("aria-expanded") === "true";
      abrir(!aberto);
      if (!aberto) { var primeiro = nav.querySelector("a"); if (primeiro) primeiro.focus(); }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && botaoMenu.getAttribute("aria-expanded") === "true") { abrir(false); botaoMenu.focus(); }
    });
    nav.addEventListener("click", function (ev) { if (ev.target.closest("a")) abrir(false); });
    document.addEventListener("click", function (ev) {
      if (botaoMenu.getAttribute("aria-expanded") === "true" && !nav.contains(ev.target) && !botaoMenu.contains(ev.target)) abrir(false);
    });
    nav.addEventListener("focusout", function (ev) {
      if (window.matchMedia("(min-width: 64rem)").matches) return;
      if (ev.relatedTarget && !nav.contains(ev.relatedTarget) && ev.relatedTarget !== botaoMenu) abrir(false);
    });
  }

  /* ---------- 3b. Barra fixa de CTA (celular) ---------- */
  var barra = document.querySelector(".barra-cta");
  if (barra && "IntersectionObserver" in window) {
    document.body.classList.add("tem-barra");
    var vigiados = document.querySelectorAll("[data-esconde-barra]");
    var visiveis = new Set();
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) { if (en.isIntersecting) visiveis.add(en.target); else visiveis.delete(en.target); });
      var mostrar = visiveis.size === 0;
      barra.classList.toggle("visivel", mostrar);
      barra.setAttribute("aria-hidden", mostrar ? "false" : "true");
      var link = barra.querySelector("a");
      if (link) { if (mostrar) link.removeAttribute("tabindex"); else link.setAttribute("tabindex", "-1"); }
    });
    for (var v = 0; v < vigiados.length; v++) obs.observe(vigiados[v]);
  }

  /* ---------- 3c. Demonstração de atendimento ---------- */
  var demos = document.querySelectorAll(".demo");
  Array.prototype.forEach.call(demos, function (demo) {
    var planos = demo.querySelectorAll(".plano");
    var botoes = demo.querySelectorAll(".demo__controles button");
    var linha = demo.querySelector(".demo__linha polyline");
    var svg = demo.querySelector(".demo__linha");
    var ponto = demo.querySelector(".demo__ponto");
    var palco = demo.querySelector(".demo__palco");
    if (!palco) return;
    var etapa = 3, timer = null, pontos = [];

    function medir() {
      var base = palco.getBoundingClientRect();
      pontos = Array.prototype.map.call(demo.querySelectorAll(".porta"), function (p) {
        var r = p.getBoundingClientRect();
        return [r.left - base.left + r.width / 2, r.top - base.top + r.height / 2];
      });
      if (svg) svg.setAttribute("viewBox", "0 0 " + base.width + " " + base.height);
      if (linha) linha.setAttribute("points", pontos.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));
      posicionarPonto();
    }
    function posicionarPonto() {
      var p = pontos[etapa - 1];
      if (p && ponto) ponto.style.transform = "translate(" + p[0].toFixed(1) + "px," + p[1].toFixed(1) + "px)";
    }
    function irPara(n) {
      etapa = n;
      demo.setAttribute("data-ativa", String(n));
      for (var i = 0; i < planos.length; i++) {
        planos[i].classList.toggle("alcancado", i < n);
        planos[i].classList.toggle("atual", i === n - 1);
      }
      for (var j = 0; j < botoes.length; j++) botoes[j].setAttribute("aria-pressed", j === n - 1 ? "true" : "false");
      posicionarPonto();
    }
    function parar() { if (timer) { clearTimeout(timer); timer = null; } }
    function tocar() {
      parar();
      irPara(1);
      if (reduzir) { irPara(3); return; }
      var seq = [2, 3], k = 0;
      (function proximo() {
        timer = setTimeout(function () { irPara(seq[k]); k++; if (k < seq.length) proximo(); else timer = null; }, 1500);
      })();
    }

    // Ponto e linha sem transição na primeira medição
    if (ponto) ponto.style.transition = "none";
    medir();
    irPara(3);
    requestAnimationFrame(function () { if (ponto) ponto.style.transition = ""; });
    if (window.ResizeObserver) new ResizeObserver(medir).observe(palco);
    else window.addEventListener("resize", medir);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(medir);

    Array.prototype.forEach.call(botoes, function (b, i) {
      b.addEventListener("click", function () { parar(); irPara(i + 1); });
    });
    demo.addEventListener("xt:tocar", tocar);

    // Toca a sequência uma vez quando a demonstração aparece na tela
    if (!reduzir && "IntersectionObserver" in window) {
      var jaTocou = false;
      var io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting && !jaTocou) { jaTocou = true; tocar(); io.disconnect(); }
      }, { threshold: 0.45 });
      io.observe(demo);
    }
  });

  // "Ver como funciona" leva à demonstração e reinicia a sequência
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[href="#exemplo"]') : null;
    if (!a) return;
    var alvo = document.getElementById("exemplo");
    if (!alvo) return;
    setTimeout(function () { alvo.dispatchEvent(new CustomEvent("xt:tocar")); }, reduzir ? 0 : 350);
  });

  /* ---------- 4. Consentimento e mensuração ---------- */
  var m = cfg.mensuracao || {};
  var temMensuracao = !!(m.gtmId || m.ga4Id || m.metaPixelId || m.criativivoScriptUrl);
  function script(src) { var s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); }
  function carregarMensuracao() {
    if (m.gtmId) {
      window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
      script("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(m.gtmId));
    }
    if (m.ga4Id) {
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", m.ga4Id);
      cfg.ga4 = true;
      script("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(m.ga4Id));
    }
    if (m.metaPixelId) {
      /* Código base do Pixel da Meta */
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", m.metaPixelId);
      window.fbq("track", "PageView");
    }
    if (m.criativivoScriptUrl) script(m.criativivoScriptUrl);
  }
  if (temMensuracao) {
    var escolha = lerLocal("xt_consentimento");
    if (escolha === "aceito") carregarMensuracao();
    else if (escolha !== "recusado") {
      var aviso = document.getElementById("consentimento");
      if (aviso) {
        aviso.hidden = false;
        aviso.addEventListener("click", function (ev) {
          var b = ev.target.closest("button[data-consentimento]");
          if (!b) return;
          var aceitou = b.getAttribute("data-consentimento") === "aceito";
          guardarLocal("xt_consentimento", aceitou ? "aceito" : "recusado");
          aviso.hidden = true;
          if (aceitou) carregarMensuracao();
        });
      }
    }
  }
})();
