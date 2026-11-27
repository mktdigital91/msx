// Conteúdo das páginas do site da Xtech.
// Cada página recebe "h" (helpers do build) e devolve metadados + HTML do <main>.

const icChat = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6L5 21l4.3-2.2c.9.2 1.8.3 2.7.3 5 0 9-3.6 9-8s-4-8-9-8z"/></svg>`;

export function demo(id = "exemplo") {
  return `<figure class="demo entrada" id="${id}" tabindex="-1">
  <figcaption class="demo__cabecalho">
    <span class="demo__titulo">Exemplo de atendimento</span>
    <span class="demo__aviso">Situação fictícia, para ilustrar o caminho.</span>
  </figcaption>
  <div class="demo__palco">
    <svg class="demo__linha" aria-hidden="true" focusable="false"><polyline points=""/></svg>
    <span class="demo__ponto" aria-hidden="true"></span>
    <ol class="demo__planos">
      <li class="plano plano--1">
        <span class="porta" aria-hidden="true"></span>
        <div class="plano__corpo">
          <p class="plano__etapa"><span class="plano__num" aria-hidden="true">1</span> Mensagem recebida</p>
          <p class="plano__canal">${icChat} WhatsApp · 21:47</p>
          <p class="bolha">Olá, gostaria de agendar uma avaliação</p>
        </div>
      </li>
      <li class="plano plano--2">
        <span class="porta" aria-hidden="true"></span>
        <div class="plano__corpo">
          <p class="plano__etapa"><span class="plano__num" aria-hidden="true">2</span> Organizada</p>
          <p class="plano__titulo">Interesse em avaliação</p>
          <ul class="etiquetas" aria-label="Etiquetas do contato">
            <li class="destaque">Novo contato</li><li>WhatsApp</li><li>Quer agendar</li>
          </ul>
        </div>
      </li>
      <li class="plano plano--3">
        <span class="porta" aria-hidden="true"></span>
        <div class="plano__corpo">
          <p class="plano__etapa"><span class="plano__num" aria-hidden="true">3</span> Encaminhada</p>
          <p class="plano__titulo">Encaminhado à recepção</p>
          <p class="plano__info">A equipe recebe o pedido com o histórico da conversa e confirma o horário.</p>
        </div>
      </li>
    </ol>
  </div>
  <div class="demo__controles" role="group" aria-label="Etapas do exemplo">
    <button type="button" aria-pressed="false">1. Recebida</button>
    <button type="button" aria-pressed="false">2. Organizada</button>
    <button type="button" aria-pressed="true">3. Encaminhada</button>
  </div>
</figure>`;
}

function duvidas(itens) {
  return `<div class="duvidas">
${itens.map(([p, r]) => `  <details class="duvida">
    <summary>${p}</summary>
    <div class="duvida__resposta">${r}</div>
  </details>`).join("\n")}
</div>`;
}

function chamadaFinal(h, { titulo, texto, posicao }) {
  const whats = h.linkWhats({ posicao: `${posicao}-whatsapp`, texto: "chamar a Xtech no WhatsApp" });
  return `<section class="secao escuro recorte-topo chamada" id="diagnostico" aria-labelledby="diagnostico-titulo" data-esconde-barra>
  <div class="conteiner chamada__caixa">
    <div>
      <p class="rotulo">Diagnóstico gratuito</p>
      <h2 id="diagnostico-titulo">${titulo}</h2>
      <p class="lead">${texto}</p>
      ${whats ? `<p class="chamada__alternativa">Prefere conversar antes? Você também pode ${whats}.</p>` : ""}
    </div>
    <div class="acoes">${h.cta({ posicao, texto: "Começar o diagnóstico" })}</div>
  </div>
</section>`;
}

/* =================================================================== */
/* PÁGINA INICIAL                                                       */
/* =================================================================== */
export function home(h) {
  const sistemasCta = h.linkWhats({
    posicao: "home-sistemas",
    texto: "Descrever o processo que quero melhorar",
    mensagem: h.cfg.whatsapp.mensagemSistemas,
    classe: "botao botao--linha",
  }) || h.cta({ posicao: "home-sistemas", texto: "Descrever o processo no diagnóstico", classe: "botao--linha" });

  return {
    slug: "",
    titulo: "Xtech: tráfego pago e automação de WhatsApp para clínicas de estética",
    descricao: "Sua clínica perde pacientes quando a mensagem fica sem resposta. A Xtech une tráfego pago e automação de atendimento, do anúncio à agenda. Faça o diagnóstico gratuito.",
    nav: "inicio",
    corpo: `
<section class="hero" aria-labelledby="titulo-pagina">
  <div class="conteiner hero__grade">
    <div class="hero__texto">
      <p class="rotulo">Tráfego pago e automação para clínicas de estética</p>
      <h1 id="titulo-pagina">Mais contatos para sua clínica. <span>Mais organização para transformar conversas em agendamentos.</span></h1>
      <p class="lead">A Xtech combina tráfego pago e automação de atendimento para cuidar do caminho entre o anúncio, o WhatsApp e a sua recepção.</p>
      <div class="acoes" data-esconde-barra>
        ${h.cta({ posicao: "home-topo" })}
        <a class="botao botao--linha" href="#exemplo">Ver como funciona</a>
      </div>
      <p class="hero__nota"><span>Diagnóstico gratuito, sem compromisso</span><span>De João Pessoa (PB) para todo o Brasil, com atendimento remoto</span></p>
    </div>
    <div class="hero__painel">
      ${demo()}
    </div>
  </div>
</section>

<section class="secao secao--papel" id="situacao" aria-labelledby="situacao-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Por onde começar</p>
      <h2 id="situacao-titulo">Em qual situação sua clínica está hoje?</h2>
      <p class="lead">As duas levam ao mesmo diagnóstico gratuito. O que muda é o trabalho que vem depois.</p>
    </div>
    <ul class="escolhas">
      <li><a class="escolha" href="#mais-contatos"><span>Minha clínica precisa de mais contatos<small>A agenda depende de indicação e de posts que alcançam pouca gente.</small></span><span class="escolha__seta" aria-hidden="true"></span></a></li>
      <li><a class="escolha" href="#perco-agendamentos"><span>Recebo mensagens, mas perco agendamentos<small>As conversas chegam, mas muitas param antes de virar horário marcado.</small></span><span class="escolha__seta" aria-hidden="true"></span></a></li>
    </ul>
    <div class="caminhos">
      <article class="caminho" id="mais-contatos" aria-labelledby="mais-contatos-titulo">
        <span class="servico-nome">Gestão de tráfego pago</span>
        <h3 id="mais-contatos-titulo">Quando faltam contatos, a clínica precisa aparecer para quem procura o procedimento</h3>
        <p>Anúncios planejados colocam a clínica na frente de pessoas da sua região interessadas nos procedimentos que você quer preencher na agenda.</p>
        <ul class="lista-check">
          <li>Campanhas pensadas por procedimento e por região</li>
          <li>Acompanhamento dos anúncios enquanto estão no ar</li>
          <li>Leitura clara de quanto foi investido, quantos contatos chegaram e quantos viraram oportunidade</li>
        </ul>
        <div class="acoes">
          ${h.cta({ posicao: "home-mais-contatos" })}
          <a class="link-seta" href="${h.url("trafego-pago")}">Conhecer a gestão de tráfego pago</a>
        </div>
      </article>
      <article class="caminho" id="perco-agendamentos" aria-labelledby="perco-titulo">
        <span class="servico-nome">Automação de atendimento</span>
        <h3 id="perco-titulo">Quando as mensagens chegam, cada uma precisa de resposta e de alguém responsável</h3>
        <p>A pergunta chega às 21h pelo WhatsApp, outra pelo direct do Instagram, e a recepção só consegue responder no dia seguinte. A automação recebe cada contato na hora, faz as primeiras perguntas e entrega a conversa organizada para uma pessoa da sua equipe.</p>
        <ul class="lista-check">
          <li>Resposta inicial imediata, inclusive fora do horário</li>
          <li>Perguntas definidas com você para entender o interesse</li>
          <li>Passagem para a recepção com o histórico da conversa</li>
        </ul>
        <div class="acoes">
          ${h.cta({ posicao: "home-perco-agendamentos" })}
          <a class="link-seta" href="${h.url("automacao-de-atendimento")}">Conhecer a automação de atendimento</a>
        </div>
      </article>
    </div>
  </div>
</section>

<section class="secao" id="servicos" aria-labelledby="servicos-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Serviços</p>
      <h2 id="servicos-titulo">O que fica funcionando na sua empresa</h2>
      <p class="lead">Cada serviço é descrito pelo que você recebe, não pela ferramenta que usamos.</p>
    </div>
    <ol class="servicos">
      <li class="servico">
        <span class="servico__num" aria-hidden="true">01</span>
        <div>
          <h3>Automação de atendimento</h3>
          <p class="servico__para">Para quem já recebe mensagens e não quer deixar nenhuma sem resposta.</p>
          <a class="link-seta" href="${h.url("automacao-de-atendimento")}">Ver automação de atendimento</a>
        </div>
        <div>
          <ul class="servico__entregas">
            <li>Mapeamento do processo de atendimento</li>
            <li>Implantação da Melina Chat</li>
            <li>Recepção e qualificação de contatos</li>
            <li>Encaminhamento à equipe</li>
            <li>Conversas organizadas em um só lugar</li>
            <li>Treinamento da equipe</li>
          </ul>
          <p class="servico__nota">Uma conta pode reunir até três canais entre WhatsApp, Instagram e Facebook.</p>
        </div>
      </li>
      <li class="servico">
        <span class="servico__num" aria-hidden="true">02</span>
        <div>
          <h3>Gestão de tráfego pago</h3>
          <p class="servico__para">Para quem precisa de mais pessoas interessadas chegando até a clínica.</p>
          <a class="link-seta" href="${h.url("trafego-pago")}">Ver gestão de tráfego pago</a>
        </div>
        <div>
          <ul class="servico__entregas">
            <li>Planejamento de campanhas</li>
            <li>Acompanhamento dos anúncios</li>
            <li>Análise do caminho entre investimento, contato e oportunidade comercial</li>
          </ul>
        </div>
      </li>
      <li class="servico servico--conjunto">
        <span class="servico__num" aria-hidden="true">03</span>
        <div>
          <h3>Tráfego + atendimento</h3>
          <p class="servico__para">Implantação conjunta para clínicas que precisam atrair interessados e acompanhar o que acontece depois da primeira mensagem.</p>
          <div class="acoes">${h.cta({ posicao: "home-conjunto" })}</div>
        </div>
        <div>
          <ol class="trilha" aria-label="Caminho acompanhado na implantação conjunta">
            <li>O anúncio leva a pessoa interessada até a conversa</li>
            <li>A automação responde, pergunta o interesse e organiza</li>
            <li>A recepção assume com o histórico completo</li>
            <li>A análise liga o investimento às oportunidades geradas</li>
          </ol>
        </div>
      </li>
      <li class="servico" id="sistemas-e-ia">
        <span class="servico__num" aria-hidden="true">04</span>
        <div>
          <h3>Sistemas e IA sob medida</h3>
          <p class="servico__para">Para tarefas operacionais específicas que hoje tomam horas da equipe, em clínicas ou em outros tipos de empresa.</p>
        </div>
        <div>
          <p>Desenvolvimento e integração de soluções para um processo bem definido: um relatório montado à mão toda semana, um cadastro digitado em dois sistemas, uma planilha que ninguém consegue manter em dia. Conte qual processo você quer melhorar e avaliamos se faz sentido automatizar.</p>
          <div class="acoes">${sistemasCta}</div>
        </div>
      </li>
    </ol>
  </div>
</section>

<section class="secao escuro recorte-topo" id="como-trabalhamos" aria-labelledby="como-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Como trabalhamos</p>
      <h2 id="como-titulo">Do diagnóstico à implantação, com a mesma pessoa acompanhando</h2>
    </div>
    <ol class="processo">
      <li class="passo"><h3>Diagnóstico gratuito</h3><p>Você responde a algumas perguntas no Responda.me sobre como os contatos chegam e como sua equipe atende. O resultado mostra onde está a necessidade: captação, atendimento ou os dois.</p></li>
      <li class="passo"><h3>Conversa com Jhonie</h3><p>Você pode continuar pelo WhatsApp e, havendo encaixe, marcar uma reunião remota com Jhonie Michael para entender a rotina da clínica.</p></li>
      <li class="passo"><h3>Proposta com escopo definido</h3><p>Você recebe por escrito o que será implantado, quais canais entram, o que cabe à Xtech e o que cabe à sua equipe.</p></li>
      <li class="passo"><h3>Implantação acompanhada</h3><p>Jhonie participa pessoalmente da implantação: configuração, testes com a equipe e treinamento antes de colocar no ar.</p></li>
    </ol>
    ${h.responsavel()}
  </div>
</section>

<section class="secao" id="duvidas" aria-labelledby="duvidas-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Dúvidas frequentes</p>
      <h2 id="duvidas-titulo">Antes de começar</h2>
    </div>
    ${duvidas([
      ["Posso contratar só a automação?", `<p>Sim. A automação de atendimento pode ser contratada sozinha, sem tráfego pago. Ela organiza os contatos que já chegam hoje por WhatsApp, Instagram ou Facebook. Se o diagnóstico mostrar que também faltam contatos, você decide depois se quer incluir os anúncios.</p>`],
      ["Quem assume a conversa quando o cliente precisa de uma pessoa?", `<p>Uma pessoa da sua equipe, normalmente a recepção. A automação recebe o contato, faz as primeiras perguntas e encaminha a conversa com o histórico. Em que momento a passagem acontece e para quem ela vai são definidos com você no mapeamento do processo.</p>`],
      ["A Xtech atende minha cidade?", `<p>Sim. A Xtech fica em João Pessoa (PB) e atende remotamente empresas de todo o Brasil. As reuniões acontecem por videochamada, e a implantação é feita a distância, com acompanhamento de Jhonie.</p>`],
      ["O que acontece depois do diagnóstico?", `<p>Com as respostas do quiz, você pode continuar a conversa pelo WhatsApp. Se houver encaixe com o que a Xtech faz, você marca uma reunião remota com Jhonie e, depois dela, recebe uma proposta com escopo definido. Não há compromisso de contratação.</p>`],
    ])}
  </div>
</section>

${chamadaFinal(h, {
  titulo: "Comece pelo diagnóstico gratuito",
  texto: "Algumas perguntas sobre como sua clínica recebe e atende contatos. Se fizer sentido, você continua pelo WhatsApp e marca uma conversa com Jhonie.",
  posicao: "home-final",
})}
`,
  };
}

/* =================================================================== */
/* AUTOMAÇÃO DE ATENDIMENTO                                             */
/* =================================================================== */
export function automacao(h) {
  return {
    slug: "automacao-de-atendimento",
    titulo: "Automação de WhatsApp para clínicas de estética | Xtech",
    descricao: "Automação de atendimento no WhatsApp, Instagram e Facebook para clínicas de estética: Melina Chat, qualificação de contatos, encaminhamento à recepção e treinamento.",
    nav: "automacao",
    migalha: "Automação de atendimento",
    corpo: `
<section class="hero hero--servico" aria-labelledby="titulo-pagina">
  <div class="conteiner hero__grade">
    <div class="hero__texto">
      <p class="rotulo">Automação de atendimento</p>
      <h1 id="titulo-pagina">Automação de WhatsApp para clínicas de estética</h1>
      <p class="lead">Cada mensagem recebida na hora, organizada pelo interesse e entregue à sua recepção com o histórico completo. A Xtech mapeia seu atendimento, implanta a Melina Chat e treina a equipe.</p>
      <div class="acoes" data-esconde-barra>
        ${h.cta({ posicao: "automacao-topo" })}
        <a class="botao botao--linha" href="#exemplos">Ver exemplos</a>
      </div>
      <p class="hero__nota"><span>Até três canais por conta: WhatsApp, Instagram e Facebook</span></p>
    </div>
    <div class="hero__painel">
      ${demo()}
    </div>
  </div>
</section>

<section class="secao secao--papel" aria-labelledby="perdas-titulo">
  <div class="conteiner dupla">
    <div>
      <p class="rotulo">Onde o agendamento se perde</p>
      <h2 id="perdas-titulo">A mensagem chegou. O problema é o que acontece entre a pergunta e o horário marcado.</h2>
    </div>
    <div>
      <p><strong>Fora do horário.</strong> Boa parte das perguntas chega à noite e no fim de semana. Quando a recepção responde, o interesse já esfriou.</p>
      <p><strong>No pico da recepção.</strong> Quem atende o telefone, recebe pacientes e cuida da agenda não consegue responder o WhatsApp com a mesma atenção.</p>
      <p><strong>Entre canais.</strong> Parte das conversas está no WhatsApp, parte no direct do Instagram, parte no Facebook. Ninguém sabe com certeza quem ficou sem retorno.</p>
      <div class="destaque-borda"><p>A automação não substitui a sua recepção. Ela garante que cada contato seja recebido, entendido e entregue a uma pessoa da equipe.</p></div>
    </div>
  </div>
</section>

<section class="secao" id="exemplos" aria-labelledby="exemplos-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Exemplos</p>
      <h2 id="exemplos-titulo">Três situações comuns, com a automação funcionando</h2>
      <p class="lead">Conversas fictícias. As mensagens reais são escritas com você, na linguagem da clínica.</p>
    </div>
    <div class="exemplos">
      <article class="exemplo">
        <p class="exemplo__quando">Sábado, 21h40 · WhatsApp</p>
        <h3>Pergunta fora do horário</h3>
        <ul class="conversa">
          <li><b>Contato</b>Vocês fazem limpeza de pele? Queria um horário na semana que vem.</li>
          <li class="auto"><b>Automação</b>Fazemos, sim! Para adiantar seu atendimento: é sua primeira vez na clínica?</li>
          <li><b>Contato</b>É, sim.</li>
          <li class="auto"><b>Automação</b>Obrigada! Sua mensagem já está com a nossa recepção, que retorna na segunda para combinar o melhor horário.</li>
        </ul>
        <p class="exemplo__resultado"><strong>Resultado:</strong> contato marcado como “Interesse em limpeza de pele” e encaminhado à recepção para a segunda-feira.</p>
      </article>
      <article class="exemplo">
        <p class="exemplo__quando">Terça, 10h15 · Instagram</p>
        <h3>Pedido de preço no direct</h3>
        <ul class="conversa">
          <li><b>Contato</b>Quanto custa a harmonização facial?</li>
          <li class="auto"><b>Automação</b>O valor depende da avaliação, que é feita aqui na clínica. Posso pedir para a recepção ver um horário para você?</li>
          <li><b>Contato</b>Pode, de manhã é melhor.</li>
        </ul>
        <p class="exemplo__resultado"><strong>Resultado:</strong> a conversa do Instagram aparece na mesma caixa que o WhatsApp, com a preferência de horário anotada.</p>
      </article>
      <article class="exemplo">
        <p class="exemplo__quando">Quinta, 14h · WhatsApp</p>
        <h3>Quem precisa falar com uma pessoa</h3>
        <ul class="conversa">
          <li><b>Contato</b>Fiz um procedimento semana passada e queria tirar uma dúvida.</li>
          <li class="auto"><b>Automação</b>Claro. Já estou passando sua mensagem para a nossa equipe.</li>
        </ul>
        <p class="exemplo__resultado"><strong>Resultado:</strong> dúvida de pós-atendimento vai direto para uma pessoa, sem perguntas automáticas no meio.</p>
      </article>
    </div>
  </div>
</section>

<section class="secao secao--papel" id="entregas" aria-labelledby="entregas-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">O que está incluído</p>
      <h2 id="entregas-titulo">O que a implantação entrega</h2>
    </div>
    <ul class="entregas">
      <li><h3>Mapeamento do processo</h3><p>Quem responde, em quais horários, quais perguntas se repetem e em que momento uma pessoa precisa assumir a conversa.</p></li>
      <li><h3>Implantação da Melina Chat</h3><p>Configuração da plataforma de atendimento e conexão dos canais da clínica. Uma conta pode reunir até três canais entre WhatsApp, Instagram e Facebook.</p></li>
      <li><h3>Recepção e qualificação de contatos</h3><p>Respostas iniciais e perguntas combinadas com você para entender o que cada pessoa procura.</p></li>
      <li><h3>Encaminhamento à equipe</h3><p>Regras para passar a conversa à recepção ou à pessoa certa, sempre com o histórico visível.</p></li>
      <li><h3>Organização das conversas</h3><p>Conversas dos canais conectados reunidas em um só lugar, separadas por interesse e situação, para a equipe saber quem está aguardando retorno.</p></li>
      <li><h3>Treinamento da equipe</h3><p>Sua equipe aprende a atender pela nova caixa de mensagens antes de a automação entrar no ar.</p></li>
    </ul>
  </div>
</section>

<section class="secao" id="duvidas" aria-labelledby="duvidas-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Dúvidas sobre automação</p>
      <h2 id="duvidas-titulo">Perguntas de quem está avaliando</h2>
    </div>
    ${duvidas([
      ["A automação responde tudo sozinha?", `<p>Não. Ela faz o primeiro atendimento: recebe, responde o que foi combinado e faz as perguntas iniciais. Agendamento, negociação e dúvidas que exigem uma pessoa ficam com a sua equipe, que recebe a conversa já organizada.</p>`],
      ["Quem assume a conversa quando o cliente precisa de uma pessoa?", `<p>A pessoa definida no mapeamento, normalmente a recepção. A passagem acontece quando o contato pede para falar com alguém, quando o assunto sai do que foi combinado ou quando chega a hora de marcar o horário.</p>`],
      ["Quais canais posso conectar?", `<p>Uma conta pode reunir até três canais entre WhatsApp, Instagram e Facebook. No mapeamento, vemos quais deles concentram as conversas da clínica.</p>`],
      ["Quem escreve as mensagens da automação?", `<p>As mensagens são definidas com você, na linguagem da clínica e com as informações que podem ser passadas por mensagem. Você revisa tudo antes de a automação entrar no ar.</p>`],
      ["Minha equipe vai precisar aprender uma ferramenta nova?", `<p>Sim. A equipe passa a atender pela Melina Chat, e o treinamento faz parte da implantação.</p>`],
      ["Posso contratar só a automação, sem tráfego pago?", `<p>Sim. A automação organiza os contatos que já chegam hoje. Se depois você quiser trazer mais contatos com anúncios, as duas partes podem trabalhar juntas.</p>`],
    ])}
    <p style="margin-top:2rem">Também precisa de mais contatos? Veja a <a href="${h.url("trafego-pago")}">gestão de tráfego pago para clínicas de estética</a>.</p>
  </div>
</section>

${chamadaFinal(h, {
  titulo: "Descubra onde as conversas da sua clínica estão parando",
  texto: "O diagnóstico gratuito mostra se o ponto de atenção está no atendimento, na captação ou nos dois.",
  posicao: "automacao-final",
})}
`,
  };
}

/* =================================================================== */
/* TRÁFEGO PAGO                                                         */
/* =================================================================== */
export function trafego(h) {
  return {
    slug: "trafego-pago",
    titulo: "Gestão de tráfego pago para clínicas de estética | Xtech",
    descricao: "Gestão de tráfego pago para clínicas de estética: planejamento de campanhas, acompanhamento dos anúncios e análise do caminho entre investimento, contato e oportunidade.",
    nav: "trafego",
    migalha: "Gestão de tráfego pago",
    corpo: `
<section class="hero hero--servico" aria-labelledby="titulo-pagina">
  <div class="conteiner hero__grade">
    <div class="hero__texto">
      <p class="rotulo">Gestão de tráfego pago</p>
      <h1 id="titulo-pagina">Gestão de tráfego pago para clínicas de estética</h1>
      <p class="lead">Campanhas planejadas para os procedimentos que sua clínica quer preencher na agenda, acompanhadas enquanto estão no ar e analisadas até o ponto que importa: quantas conversas viraram oportunidade.</p>
      <div class="acoes" data-esconde-barra>
        ${h.cta({ posicao: "trafego-topo" })}
        <a class="botao botao--linha" href="#exemplos">Ver exemplos</a>
      </div>
    </div>
    <div class="hero__painel">
      <figure class="demo entrada" style="max-width:28rem">
        <figcaption class="demo__cabecalho">
          <span class="demo__titulo">O caminho que analisamos</span>
          <span class="demo__aviso">Cada etapa com os números da própria conta da clínica.</span>
        </figcaption>
        <ol class="funil">
          <li><span class="funil__nome">Investimento</span><span class="funil__desc">Quanto foi aplicado em cada campanha e procedimento</span></li>
          <li><span class="funil__nome">Contatos</span><span class="funil__desc">Quantas pessoas chamaram no WhatsApp ou no direct</span></li>
          <li><span class="funil__nome">Oportunidades</span><span class="funil__desc">Quantas conversas chegaram à recepção com interesse real</span></li>
        </ol>
      </figure>
    </div>
  </div>
</section>

<section class="secao secao--papel" id="exemplos" aria-labelledby="exemplos-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Exemplos</p>
      <h2 id="exemplos-titulo">Como uma campanha é pensada para a clínica</h2>
      <p class="lead">Situações ilustrativas. O plano real parte do diagnóstico e da conversa com você.</p>
    </div>
    <div class="exemplos exemplos--texto">
      <article class="exemplo">
        <p class="exemplo__quando">Agenda com horários vagos</p>
        <h3>Preencher um procedimento específico</h3>
        <p>A clínica tem horários livres para limpeza de pele às terças e quintas. A campanha é planejada para esse procedimento, voltada a pessoas da região, com convite direto para conversar no WhatsApp.</p>
      </article>
      <article class="exemplo">
        <p class="exemplo__quando">Novo procedimento</p>
        <h3>Apresentar algo que o público ainda não conhece</h3>
        <p>O anúncio explica o procedimento em linguagem simples e leva a uma conversa para tirar dúvidas e marcar a avaliação. O acompanhamento mostra quais mensagens trazem conversas com interesse real.</p>
      </article>
      <article class="exemplo">
        <p class="exemplo__quando">Muitos contatos, pouca agenda</p>
        <h3>Quando o problema não está no anúncio</h3>
        <p>A análise mostra que os contatos chegam, mas param na primeira resposta. Nesse caso, o ajuste está no atendimento, e a <a href="${h.url("automacao-de-atendimento")}">automação de atendimento</a> entra junto com o tráfego.</p>
      </article>
    </div>
  </div>
</section>

<section class="secao" id="entregas" aria-labelledby="entregas-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">O que está incluído</p>
      <h2 id="entregas-titulo">O que a gestão de tráfego entrega</h2>
    </div>
    <ul class="entregas">
      <li><h3>Planejamento de campanhas</h3><p>Procedimentos prioritários, região de atendimento, público e mensagem de cada anúncio, definidos a partir do diagnóstico.</p></li>
      <li><h3>Acompanhamento dos anúncios</h3><p>Verificação das campanhas enquanto estão no ar, com ajustes de público, mensagem e distribuição da verba.</p></li>
      <li><h3>Análise do caminho comercial</h3><p>Leitura do caminho entre investimento, contato e oportunidade comercial, para saber o que está trazendo conversas que interessam à clínica.</p></li>
      <li><h3>Ligação com o atendimento</h3><p>Quando contratado junto com a automação, o mesmo acompanhamento segue a conversa até a recepção.</p></li>
    </ul>
    <div class="destaque-borda" style="margin-top:2.5rem;max-width:44rem">
      <p><strong>O que não prometemos:</strong> número garantido de pacientes, custo fixo por contato ou posição no Google. Resultado de anúncio depende de região, procedimento, oferta e atendimento. O que garantimos é planejamento, acompanhamento e clareza sobre os números.</p>
    </div>
  </div>
</section>

<section class="secao secao--papel" id="duvidas" aria-labelledby="duvidas-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Dúvidas sobre tráfego pago</p>
      <h2 id="duvidas-titulo">Perguntas de quem está avaliando</h2>
    </div>
    ${duvidas([
      ["Quanto preciso investir em anúncios?", `<p>Depende da região, dos procedimentos e do que a clínica quer alcançar. Esse valor é conversado com Jhonie depois do diagnóstico, a partir da realidade da sua clínica.</p>`],
      ["Vocês garantem um número de pacientes?", `<p>Não. Nenhum gestor sério pode garantir quantos pacientes uma campanha vai trazer. O que a Xtech faz é planejar, acompanhar e mostrar com clareza o caminho entre o investimento, os contatos e as oportunidades.</p>`],
      ["Como vou saber se os anúncios estão funcionando?", `<p>A análise acompanha quanto foi investido, quantos contatos chegaram e quantos viraram oportunidade comercial. Assim você vê o que está trazendo conversas que interessam, e não apenas curtidas e visualizações.</p>`],
      ["Preciso contratar a automação junto?", `<p>Não é obrigatório. Mas, se a clínica já perde mensagens hoje, mais anúncios vão gerar mais conversas sem resposta. Nesse caso, o diagnóstico pode indicar a implantação conjunta de tráfego e atendimento.</p>`],
      ["O diagnóstico tem custo?", `<p>Não. O diagnóstico é gratuito e não obriga a nenhuma contratação.</p>`],
    ])}
    <p style="margin-top:2rem">As mensagens chegam, mas o agendamento não acontece? Veja a <a href="${h.url("automacao-de-atendimento")}">automação de WhatsApp para clínicas de estética</a>.</p>
  </div>
</section>

${chamadaFinal(h, {
  titulo: "Veja se o que falta à sua clínica são contatos",
  texto: "O diagnóstico gratuito mostra se o ponto de atenção está na captação, no atendimento ou nos dois.",
  posicao: "trafego-final",
})}
`,
  };
}

/* =================================================================== */
/* CAMPANHA: CLÍNICAS DE ESTÉTICA                                       */
/* =================================================================== */
export function campanha(h) {
  return {
    slug: "clinicas-de-estetica",
    titulo: "Diagnóstico gratuito para clínicas de estética | Xtech",
    descricao: "Descubra se o que trava a agenda da sua clínica de estética é a falta de contatos, o atendimento das mensagens ou os dois. Diagnóstico gratuito com a Xtech.",
    nav: "campanha",
    topoSimples: true,
    migalha: "Clínicas de estética",
    corpo: `
<section class="hero hero--servico" aria-labelledby="titulo-pagina">
  <div class="conteiner hero__grade">
    <div class="hero__texto">
      <p class="rotulo">Para donos e gestores de clínicas de estética</p>
      <h1 id="titulo-pagina">Diagnóstico gratuito de captação e atendimento para clínicas de estética</h1>
      <p class="lead">Responda a algumas perguntas e descubra se o que trava a sua agenda é a falta de contatos, a organização do atendimento ou os dois.</p>
      <div class="acoes" data-esconde-barra>
        ${h.cta({ posicao: "campanha-topo" })}
      </div>
      <p class="hero__nota"><span>Gratuito e sem compromisso</span><span>Conduzido por Jhonie Michael</span><span>Atendimento remoto em todo o Brasil</span></p>
    </div>
    <div class="hero__painel">
      ${demo()}
    </div>
  </div>
</section>

<section class="secao secao--papel" aria-labelledby="descobre-titulo">
  <div class="conteiner dupla">
    <div>
      <p class="rotulo">O que o diagnóstico olha</p>
      <h2 id="descobre-titulo">Duas perguntas que decidem a agenda da clínica</h2>
    </div>
    <div>
      <ul class="lista-check" style="margin-top:0">
        <li><strong>Chegam contatos suficientes?</strong> Se a agenda depende de indicação e de posts, o caminho pode começar pela <a href="${h.url("trafego-pago")}">gestão de tráfego pago</a>.</li>
        <li><strong>Os contatos que chegam viram horário marcado?</strong> Se as mensagens ficam sem resposta ou se perdem entre WhatsApp e Instagram, o caminho começa pela <a href="${h.url("automacao-de-atendimento")}">automação de atendimento</a>.</li>
      </ul>
      <div class="acoes">${h.cta({ posicao: "campanha-meio" })}</div>
    </div>
  </div>
</section>

<section class="secao escuro recorte-topo" aria-labelledby="depois-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <p class="rotulo">Como funciona</p>
      <h2 id="depois-titulo">O que acontece depois que você começa</h2>
    </div>
    <ol class="processo">
      <li class="passo"><h3>Você responde ao quiz</h3><p>Algumas perguntas no Responda.me sobre como os contatos chegam e como sua equipe atende.</p></li>
      <li class="passo"><h3>Continua pelo WhatsApp</h3><p>Se quiser, segue a conversa pelo WhatsApp com as suas respostas em mãos.</p></li>
      <li class="passo"><h3>Conversa com Jhonie</h3><p>Havendo encaixe, você marca uma reunião remota com Jhonie Michael.</p></li>
      <li class="passo"><h3>Proposta com escopo</h3><p>Você recebe por escrito o que será implantado e decide se quer seguir.</p></li>
    </ol>
    ${h.responsavel()}
  </div>
</section>

<section class="secao" id="duvidas" aria-labelledby="duvidas-titulo">
  <div class="conteiner">
    <div class="cabeca-secao">
      <h2 id="duvidas-titulo">Dúvidas rápidas</h2>
    </div>
    ${duvidas([
      ["O diagnóstico tem custo?", `<p>Não. É gratuito e não obriga a nenhuma contratação.</p>`],
      ["A Xtech atende minha cidade?", `<p>Sim. A Xtech fica em João Pessoa (PB) e atende clínicas de todo o Brasil de forma remota, com reuniões por videochamada.</p>`],
      ["Posso contratar só a automação?", `<p>Sim. A automação de atendimento pode ser contratada sem tráfego pago, e o tráfego pode ser contratado sem automação. O diagnóstico ajuda a ver por onde começar.</p>`],
      ["Quem assume a conversa quando o cliente precisa de uma pessoa?", `<p>Uma pessoa da sua equipe, normalmente a recepção, que recebe a conversa com o histórico completo.</p>`],
    ])}
  </div>
</section>

${chamadaFinal(h, {
  titulo: "Leva poucos minutos para começar",
  texto: "Responda ao diagnóstico gratuito e veja por onde a sua clínica deve começar.",
  posicao: "campanha-final",
})}
`,
  };
}

/* =================================================================== */
/* PRIVACIDADE                                                          */
/* =================================================================== */
export function privacidade(h) {
  const c = h.cfg;
  const pend = (v, rotulo) => (v ? h.esc(v) : `<span class="pendente">[${rotulo} a preencher]</span>`);
  const controlador = c.empresa.razaoSocial
    ? `${h.esc(c.empresa.razaoSocial)}${c.empresa.cnpj ? `, CNPJ ${h.esc(c.empresa.cnpj)}` : ""}`
    : `${h.esc(c.empresa.nome)}${c.ambiente !== "producao" ? ` <span class="pendente">[razão social e CNPJ a preencher]</span>` : ""}`;
  const contato = c.email
    ? `<a href="mailto:${h.esc(c.email)}">${h.esc(c.email)}</a>`
    : (h.linkWhats({ posicao: "privacidade", texto: "pelo WhatsApp comercial" }) || pend("", "e-mail de contato"));
  return {
    slug: "privacidade",
    titulo: "Política de privacidade | Xtech Soluções Digitais",
    descricao: "Como o site da Xtech Soluções Digitais trata dados pessoais, cookies e mensuração, e como pedir acesso, correção ou exclusão dos seus dados.",
    nav: "privacidade",
    migalha: "Privacidade",
    semBarra: true,
    corpo: `
<section class="secao" aria-labelledby="titulo-pagina" style="padding-top:2rem">
  <div class="conteiner texto-corrido">
    <p class="rotulo">Privacidade</p>
    <h1 id="titulo-pagina">Política de privacidade</h1>
    <p class="lead">Este texto explica, de forma direta, quais dados pessoais podem ser tratados quando você usa este site e os canais de contato da Xtech.</p>

    <h2>Quem é responsável</h2>
    <p>O responsável pelo tratamento dos dados é ${controlador}, com sede em ${h.esc(c.empresa.cidade)} (${h.esc(c.empresa.uf)}). Para qualquer assunto relacionado a dados pessoais, fale conosco ${contato}.</p>

    <h2>O que este site coleta</h2>
    <p>O site não tem formulários próprios e não pede seus dados diretamente. Ele pode registrar:</p>
    <ul>
      <li><strong>Origem da visita</strong>: parâmetros de campanha presentes no endereço (como utm_source e utm_campaign), guardados apenas durante a sessão do navegador e repassados ao diagnóstico para sabermos de qual anúncio ou página você veio.</li>
      <li><strong>Cliques nos botões</strong> de diagnóstico e de WhatsApp, para medir quais páginas ajudam as pessoas a encontrar o que procuram.</li>
      <li><strong>Cookies de mensuração</strong> (como Google Analytics e Pixel da Meta), somente se você aceitar no aviso exibido no site.</li>
    </ul>

    <h2>Diagnóstico, WhatsApp e redes sociais</h2>
    <p>O diagnóstico gratuito é respondido no Responda.me, e as conversas acontecem pelo WhatsApp, Instagram ou Facebook, com organização do atendimento pela Melina Chat. Os dados que você informa nesses canais (como nome, telefone e respostas do quiz) são usados para entender a necessidade da sua empresa, responder ao seu contato, marcar reuniões e preparar propostas. Cada uma dessas plataformas também tem a própria política de privacidade.</p>

    <h2>Base legal e finalidade</h2>
    <p>Tratamos dados para responder a pedidos feitos por você e preparar propostas (procedimentos preliminares a contrato), e para medir o desempenho do site e das campanhas com base no seu consentimento ou em legítimo interesse, sempre de acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>

    <h2>Compartilhamento</h2>
    <p>Não vendemos dados pessoais. Os dados podem ser processados pelas ferramentas citadas acima, que funcionam como operadoras do serviço, e por plataformas de anúncio e mensuração, apenas quando você aceitar os cookies.</p>

    <h2>Por quanto tempo</h2>
    <p>Os dados de contato são mantidos enquanto houver conversa comercial ativa ou relação de prestação de serviço, e depois pelo tempo exigido por obrigações legais. Você pode pedir a exclusão a qualquer momento.</p>

    <h2>Seus direitos</h2>
    <p>Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade ou exclusão dos seus dados, além de revogar o consentimento dado para cookies. Para isso, fale conosco ${contato}.</p>

    <h2>Cookies</h2>
    <p>Se você aceitou os cookies de mensuração e quiser mudar de ideia, limpe os dados deste site no seu navegador. O aviso aparecerá de novo na próxima visita.</p>

    <p style="margin-top:2.5rem;color:var(--texto-2);font-size:.95rem">Última atualização: ${h.dataHumana}.</p>
  </div>
</section>
`,
  };
}

export function erro404(h) {
  return {
    slug: "404",
    titulo: "Página não encontrada | Xtech Soluções Digitais",
    descricao: "A página procurada não existe ou mudou de endereço.",
    nav: "",
    semBarra: true,
    naoIndexar: true,
    corpo: `
<section class="secao erro" aria-labelledby="titulo-pagina">
  <div class="conteiner texto-curto">
    <p class="rotulo">Erro 404</p>
    <h1 id="titulo-pagina">Esta página não existe ou mudou de endereço</h1>
    <p class="lead">Confira o endereço digitado ou siga por um destes caminhos.</p>
    <div class="acoes">
      ${h.cta({ posicao: "404" })}
      <a class="botao botao--linha" href="${h.url("")}">Ir para a página inicial</a>
    </div>
  </div>
</section>
`,
  };
}
