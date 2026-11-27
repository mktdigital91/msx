# Site da Xtech Soluções Digitais

Site estático em português do Brasil, gerado por um script Node sem dependências. Ele fica separado do restante deste repositório.

## Páginas

| Endereço | Intenção principal | H1 |
|---|---|---|
| `/` | tráfego pago e automação de atendimento para clínicas (marca) | Mais contatos para sua clínica. Mais organização para transformar conversas em agendamentos. |
| `/automacao-de-atendimento/` | automação de WhatsApp para clínicas de estética | Automação de WhatsApp para clínicas de estética |
| `/trafego-pago/` | gestão de tráfego pago para clínicas de estética | Gestão de tráfego pago para clínicas de estética |
| `/clinicas-de-estetica/` | diagnóstico gratuito para clínicas de estética (página de campanha, com cabeçalho enxuto) | Diagnóstico gratuito de captação e atendimento para clínicas de estética |
| `/privacidade/` | política de privacidade | Política de privacidade |
| `/404.html` | página de erro (fora do índice) | — |

Sistemas e IA ficam na home (`/#sistemas-e-ia`) até haver material para uma página própria.

## Visual novo (em andamento)

A home foi refeita com o kit do [taste-skill](https://github.com/Leonxlnx/taste-skill) (licença MIT), copiado em `src/kit/` e publicado em `public/assets/`. Ele traz o sistema de layout, as telas de exemplo (chat, notificações, checklist, interruptores), os diagramas animados, o efeito de fundo do herói e a seção "Como funciona" que acompanha a rolagem.

- `src/v2/home.html`: o modelo da home nova. Marcadores como `{{QUIZ}}` são trocados pelo build com os dados de `site.config.mjs`.
- `src/v2/xtech.css`: cores da marca, fonte e as telas próprias da Xtech sobre o kit.
- `src/v2/css-ordem.txt`: a ordem dos estilos juntados em `assets/site.css`.
- Os ícones reais (WhatsApp, Instagram, Facebook) estão em `src/kit/icons/`.

Uma página com um arquivo `src/v2/<endereço>.html` usa o visual novo. As demais seguem no visual anterior até serem refeitas.

## Estrutura

```
xtech/
  site.config.mjs     configuração central (domínio, quiz, WhatsApp, Instagram, mensuração)
  build.mjs           gera xtech/public
  src/
    paginas.mjs       textos e HTML de cada página
    estilo.css        estilos (embutidos em cada página no build)
    xt.js             comportamento: parâmetros de campanha, eventos, menu, demonstração, cookies
    marca/            SVGs oficiais do kit + símbolo X extraído do vetor + imagens derivadas
    fontes/           Manrope variável (subconjunto latino, licença OFL)
  ferramentas/
    gerar-imagens.mjs regenera og-xtech.png, apple-touch-icon.png e xtech-logo.png a partir dos SVGs
  public/             resultado pronto para publicar (não edite à mão)
```

## Como atualizar

1. Preencha `xtech/site.config.mjs`.
2. Rode `node xtech/build.mjs`. O terminal lista o que ainda falta.
3. Publique a pasta `xtech/public`.

Para publicar no Cloudflare Pages, crie um projeto separado com diretório raiz `xtech`, comando de build `node build.mjs` e pasta de saída `public`. O arquivo `_headers` gerado mantém os endereços `*.pages.dev` fora do índice e define o cache de fontes e scripts.

## Prévia × produção

- `ambiente: "previa"`: todas as páginas saem com `noindex`. Uma faixa no topo lista as pendências.
- `ambiente: "producao"`: libera a indexação e gera `robots.txt` com o sitemap. O build recusa esse modo sem `dominio` e `quizUrl`.

Canonical, `sitemap.xml`, `og:image` e dados estruturados (Organization na home, BreadcrumbList nas internas) só são gerados quando o `dominio` estiver preenchido. Depois de publicar, confira a indexação no Google Search Console.

## Mensuração

| Etapa | Evento | Quem registra |
|---|---|---|
| Clique para o diagnóstico | `diagnostico_clique` | o site (`dataLayer`, GA4 e Pixel, quando aceitos) |
| Clique no WhatsApp | `whatsapp_clique` | o site |
| Conclusão do quiz | `diagnostico_concluido` | Responda.me, ao final do quiz |
| Reunião marcada | `reuniao_agendada` | Melina Chat ou a agenda de Jhonie |
| Venda | `venda` | registro comercial da Xtech / Criativivo |

O site registra apenas cliques. As outras etapas precisam ser registradas na ferramenta onde acontecem, e só quando acontecem.

Quem chega com `utm_*`, `gclid`, `fbclid` e parâmetros semelhantes tem esses valores guardados durante a sessão. Eles são repassados ao link do quiz, junto com `xt_origem`, que indica a página e o botão de origem (ex.: `home-topo`).

Os scripts de GTM, GA4, Pixel da Meta e Criativivo só carregam depois que o visitante aceita o aviso de cookies. O aviso aparece apenas quando algum identificador estiver configurado. Não use identificadores nem telefones da AC Harmony.

## Pendências atuais

Domínio, URL do quiz no Responda.me, WhatsApp comercial, Instagram, e-mail, razão social e CNPJ, identificadores de mensuração e foto real de Jhonie (opcional; sem ela, o site usa um bloco gráfico).
