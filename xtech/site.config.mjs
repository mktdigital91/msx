// Configuração central do site da Xtech.
// Depois de editar este arquivo, rode:  node xtech/build.mjs
// Campos vazios ("") são pendências: o site continua funcionando, mas o
// build avisa no terminal e a faixa de prévia lista o que falta.

export default {
  // "previa": página fora do índice (noindex) e faixa de pendências visível.
  // "producao": libera indexação. Só use com dominio e quizUrl preenchidos.
  ambiente: "previa",

  // Domínio real, com https e sem barra no fim. Ex.: "https://www.seudominio.com.br"
  // Usado em canonical, sitemap.xml, robots.txt, prévias de compartilhamento e dados estruturados.
  dominio: "",

  // Link do diagnóstico gratuito no Responda.me (o quiz).
  quizUrl: "",

  // WhatsApp comercial da Xtech: só números, com DDI e DDD. Ex.: "5583999999999"
  // Não use números da AC Harmony.
  whatsapp: {
    numero: "",
    mensagemPadrao: "Olá! Vim pelo site da Xtech e quero entender como funciona o diagnóstico.",
    mensagemSistemas: "Olá, Jhonie! Vim pelo site da Xtech e quero melhorar este processo na minha empresa: ",
  },

  // Perfil da Xtech no Instagram (URL completa). Ex.: "https://www.instagram.com/perfil"
  instagram: "",

  // E-mail de contato e para pedidos sobre dados pessoais (LGPD).
  email: "",

  empresa: {
    nome: "Xtech Soluções Digitais",
    razaoSocial: "", // aparece no rodapé e na política de privacidade quando preenchido
    cnpj: "",
    cidade: "João Pessoa",
    uf: "PB",
  },

  responsavel: {
    nome: "Jhonie Michael",
    // Foto real (opcional). Coloque o arquivo em xtech/src/fotos/ e informe o nome,
    // ex.: "jhonie.jpg" (de preferência 800x1000 px). Sem foto, o site usa um bloco gráfico.
    foto: "",
    fotoDescricao: "Jhonie Michael, responsável pela Xtech",
  },

  // Identificadores de mensuração. Só são carregados depois que o visitante
  // aceita no aviso de cookies (o aviso só aparece se algum estiver preenchido).
  mensuracao: {
    gtmId: "", // Google Tag Manager, ex.: "GTM-XXXXXXX"
    ga4Id: "", // Google Analytics 4, ex.: "G-XXXXXXXXXX"
    metaPixelId: "", // Pixel/conjunto de dados da Meta da Xtech (não o da AC Harmony)
    // Criativivo: cole aqui a URL do script de acompanhamento fornecida pela plataforma, se houver.
    criativivoScriptUrl: "",
  },

  // Parâmetros de origem repassados ao quiz quando o visitante chega por anúncio.
  parametrosPreservados: [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
    "gclid", "gbraid", "wbraid", "fbclid", "ttclid",
  ],
  // Parâmetro extra com a página e o botão de onde saiu o clique (ex.: "home-topo").
  // Deixe "" para não enviar.
  parametroOrigem: "xt_origem",

  // Etapas de conversão. O site registra apenas o clique; as demais etapas
  // devem ser registradas pela ferramenta onde acontecem, e só quando acontecem.
  eventos: {
    cliqueDiagnostico: { nome: "diagnostico_clique", registradoPor: "site (este código)" },
    cliqueWhatsapp: { nome: "whatsapp_clique", registradoPor: "site (este código)" },
    conclusaoQuiz: { nome: "diagnostico_concluido", registradoPor: "Responda.me (ao final do quiz)" },
    reuniao: { nome: "reuniao_agendada", registradoPor: "Melina Chat / agenda de Jhonie" },
    venda: { nome: "venda", registradoPor: "registro comercial da Xtech / Criativivo" },
  },
};
