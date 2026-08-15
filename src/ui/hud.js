/* ---------------------------------------------------------------------------
   HUD: placar, vento, pino de mira, barra de força e mira.

   O retículo é fixo no centro da tela, e é fixo por construção: a linha de tiro
   sai do centro óptico da câmera (systems/aim.js), então o ponto de impacto está
   sempre sobre o eixo óptico. Ele não precisa ser reposicionado a cada frame —
   se precisasse, pularia junto com a distância do raycast.

   Não existe assistência nenhuma: ele não segue alvos, não indica o ponto de
   queda e não muda de cor ao passar sobre um alvo.
   --------------------------------------------------------------------------- */

import { radToDeg } from "../utils/math.js";

/**
 * Os níveis da chuva de meteoros, por extenso. Ver `difficulties` no config.
 *
 * A tabela é do HUD e não do config porque o config guarda NÚMEROS — quanto
 * cada nível multiplica —, e o que se escreve na tela é outra coisa: uma
 * palavra em português, que muda com o idioma e não com o balanceamento.
 */
const NIVEIS_DA_CHUVA = { easy: "FÁCIL", normal: "NORMAL", hard: "DIFÍCIL" };

/**
 * Os do cerco. Tabela à parte da chuva, e não uma constante compartilhada, pelo
 * mesmo motivo que a de cima é do HUD: são PALAVRAS, e duas telas que hoje
 * dizem o mesmo podem passar a dizer coisas diferentes sem que uma deva
 * arrastar a outra. Fundi-las custaria uma linha e cobraria essa liberdade.
 *
 * Estas vão para o rótulo do PORTÃO, e não para uma faixa: o cerco não tem
 * faixa de modo (ver `setMode`).
 */
const NIVEIS_DO_CERCO = { easy: "FÁCIL", normal: "NORMAL", hard: "DIFÍCIL" };

/** Um trecho de texto puro. Nunca `innerHTML`: nomes vêm da rede. */
function texto(conteudo, classe = "") {
  const span = document.createElement("span");
  span.textContent = conteudo;
  if (classe) span.className = classe;
  return span;
}

/* ---------------------------------------------------------------- atalhos ---
   As teclas, agrupadas POR FINALIDADE.

   Estavam numa lista corrida de cinco linhas, misturando mirar, andar, trocar
   de modo e ligar a música. Quem procurava a tecla do duelo tinha de ler tudo.
   Agrupadas, a busca vira "isto é sobre modo de jogo" e o olho pula direto para
   o bloco certo.

   É uma tabela de dados, e não marcação escrita à mão, porque assim acrescentar
   uma tecla é acrescentar uma linha — e o painel não sai de sincronia com o
   `input.js` por esquecimento de editar HTML. */
/* A TERCEIRA COLUNA de cada linha é o COMANDO, e ela é o que permite existir um
   menu clicável sem uma segunda tabela.

   O formato é `["campo", valor]`: o nome de um campo de `Input.actions` e o que
   escrever nele. O botão do menu não chama função de jogo nenhuma — ele escreve
   a MESMA intenção que a tecla escreveria, e o laço de `bindActions` consome no
   quadro seguinte sem saber de onde veio.

   É a única forma de os dois caminhos não divergirem: qualquer confirmação,
   aviso ou mensagem de rede que a tecla dispara, o botão dispara igual, porque
   é literalmente o mesmo código. Uma tabela de `onclick` chamando métodos seria
   um segundo jogo para manter em sincronia.

   Linhas SEM comando (mouse, W A S D, Shift) são só documentação: não há botão
   para "andar", e fingir que há seria pior que não ter. */
const ATALHOS = [
  {
    titulo: "Mirar e atirar",
    itens: [
      [["Mouse"], "mirar"],
      [["Clique"], "segurar e soltar"],
      [["Dir."], "1ª pessoa"],
      [["C"], "câmera da flecha liga/desliga", ["toggleArrowCam", true]],
      // No cerco o F é a MÃO — trabuco, manivela e reparo. Fora dele não faz
      // nada, e por isso a linha vive no bloco do modo, não aqui. Sem botão:
      // ela é uma tecla SEGURADA, e um clique não segura nada.
      [["F"], "no cerco: trabuco / manivela / reparo"],
      [["E"], "golpe de faca", ["knifeAttack", true]],
      // O especial vale em TODO modo desde que `CONFIG.special.modes` virou
      // `"*"`, e a linha continua aqui pelo mesmo motivo de sempre: uma tecla
      // que não aparece neste painel é uma tecla que ninguém descobre.
      [["Q"], "especial (com a barra cheia)", ["special", true]],
      [["Enter"], "recomeçar / fechar tela de fim", ["confirmOverlay", true]],
    ],
  },
  {
    titulo: "Mover",
    itens: [
      [["W", "A", "S", "D"], "andar"],
      [["Shift"], "correr"],
      [["Space"], "pular"],
      // Na Lua a mesma tecla tem um segundo significado no ar. Ver `jetpack.js`.
      [["Space", "Space"], "jetpack (só na Lua)"],
      [["K"], "renascer", ["askRespawn", true]],
    ],
  },
  {
    titulo: "Modos de jogo",
    itens: [
      [["1"], "livre", ["setMode", "free"]],
      [["2"], "duelo", ["setMode", "duel"]],
      [["G"], "duelo de times (humanos × CPU)", ["setMode", "teamDuel"]],
      [["3"], "caçada aos porcos", ["setMode", "boarHunt"]],
      [["4"], "alvos em série", ["setMode", "series"]],
      [["5"], "caçada ao alce", ["setMode", "elkHunt"]],
      [["6"], "noite dos zumbis", ["setMode", "zombie"]],
      [["7"], "zumbi (só chefão)", ["setMode", "zombieBoss"]],
      [["8"], "caça aos pássaros", ["setMode", "birdHunt"]],
      [["U"], "o último em pé (uma vida)", ["setMode", "lastStand"]],
      [["Shift", "G"], "rouba bandeira (azul × vermelho)", ["setMode", "captureFlag"]],
      /* O CERCO NÃO TEM TECLA — os dígitos acabaram e as letras com mnemônico
         também. Até aqui a única porta de entrada dele era a tela inicial, e
         quem trocasse de modo por engano no meio de uma partida não tinha como
         voltar sem recarregar a página. O menu resolve isso sem gastar tecla:
         `kbd: false` desenha a linha só com o botão.

         TRÊS LINHAS, pelo mesmo raciocínio da chuva logo abaixo: escolher o
         nível é a mesma decisão que entrar no modo, e duas decisões que se
         tomam juntas devem caber num gesto. A linha sem nível saiu — ela
         entraria no que a sala já tem, que é justamente a ambiguidade que estas
         três resolvem. */
      [[], "cerco ao castelo: fácil", ["setSiege", "easy"]],
      [[], "cerco ao castelo: normal", ["setSiege", "normal"]],
      [[], "cerco ao castelo: difícil", ["setSiege", "hard"]],
      /* A CHUVA APARECE COMO TRÊS LINHAS, e não como uma linha mais um ajuste
         em outro canto.
       *
       * Escolher o nível é a MESMA decisão que entrar no modo — ninguém quer
       * "a chuva" e descobre a dificuldade depois —, e duas decisões que se
       * tomam juntas devem caber num gesto. Cada botão entra e recomeça no
       * nível pedido; ver `C2S.METEOR_DIFFICULTY`.
       *
       * NENHUMA DAS TRÊS MOSTRA TECLA, e o Shift+9 que existe não vai em
       * nenhuma delas de propósito: ele entra na chuva no nível que a SALA já
       * tem, que não é o que qualquer uma destas linhas promete. Uma dica de
       * tecla ao lado de "fácil" ensinaria um atalho que faz outra coisa. */
      [[], "chuva de meteoros: fácil", ["setMeteorRain", "easy"]],
      [[], "chuva de meteoros: normal", ["setMeteorRain", "normal"]],
      [[], "chuva de meteoros: difícil", ["setMeteorRain", "hard"]],
    ],
  },
  {
    /* AS FASES, e não só a Lua.
     *
     * O teclado tem uma tecla só para fase (o 9), e ela é um interruptor entre
     * o vale e a Lua — os dígitos acabaram, e o castelo nunca ganhou nenhuma.
     * O menu não tem esse limite: as três aparecem por nome, e ir do castelo
     * para a Lua deixa de ser uma viagem de duas confirmações passando pelo
     * vale. As linhas sem tecla desenham só o botão. */
    titulo: "Fases",
    itens: [
      [[], "Vale", ["setLevel", "valley"]],
      // A mesma tecla leva e traz — ver `askLevelChange`.
      [["9"], "Lua (ir e voltar)", ["setLevel", "moon"]],
      [[], "Castelo", ["setLevel", "castle"]],
      // Cenário de TESTE — serra pequena para avaliar textura + cratera
      // dinâmica sem tocar nas fases de verdade. Ver `shared/sandboxField.js`.
      [[], "Sandbox (teste)", ["setLevel", "sandbox"]],
    ],
  },
  {
    titulo: "Bots",
    itens: [
      [["B"], "adicionar bot", ["toggleBot", "add"]],
      [["Shift", "B"], "remover bot", ["toggleBot", "remove"]],
      [["N"], "dificuldade do bot", ["cycleBotDifficulty", 1]],
      [["Shift", "N"], "dificuldade anterior", ["cycleBotDifficulty", -1]],
    ],
  },
  {
    titulo: "Soltar bichos",
    itens: [
      [["P"], "soltar porco", ["spawnBoar", true]],
      [["L"], "soltar alce", ["spawnElk", true]],
      [["O"], "lobos do alce", ["spawnElkWolves", true]],
    ],
  },
  {
    titulo: "Sala",
    itens: [
      // O Tab saiu: no navegador ele é a tecla de navegação e o foco escapava
      // para os controles do próprio navegador. Ver `systems/input.js`.
      // Sem botão: o placar é uma tecla SEGURADA, e o menu está por cima dele.
      [["0"], "placar"],
      [["Y"], "zerar placar", ["askResetScores", true]],
      [["J"], "cerco: próximo escalão", ["siegeSkip", "next"]],
      [["Shift", "J"], "cerco: escaladores", ["siegeSkip", "climber"]],
      [["Shift", "Q"], "encher o especial (teste)", ["fillSpecial", true]],
    ],
  },
  {
    titulo: "Ajustes",
    itens: [
      [["T"], "traçado", ["toggleTrace", true]],
      [["V"], "vento", ["toggleWindInfluence", true]],
      [["M"], "música", ["toggleMusic", true]],
      [["R"], "limpar flechas", ["clearArrows", true]],
      [["H"], "painel de atalhos", ["toggleHelp", true]],
      /* SEM TECLA. A telemetria era a crase, e a crase agora só abre este menu
         (ver `Input.crase`). Ela é o painel mais raramente usado do jogo — é o
         primeiro que deve sair da lista de coisas a decorar, e o menu é
         exatamente o lugar para onde ele vai. */
      [[], "telemetria (depuração)", ["toggleDebug", true]],
    ],
  },
];

function montarAtalhos() {
  const painel = document.createDocumentFragment();

  for (const grupo of ATALHOS) {
    const bloco = document.createElement("div");
    bloco.className = "help-grupo";

    const titulo = document.createElement("h4");
    titulo.textContent = grupo.titulo;
    bloco.appendChild(titulo);

    /* Teclas e descrições entram como filhos DIRETOS da grade do grupo, sem
       uma div de linha no meio. É o que faz as duas colunas se alinharem
       sozinhas dentro do bloco: a coluna das teclas se ajusta à combinação mais
       larga (o `W A S D`) em vez de ter uma largura fixa que ela estoura. */
    for (const [teclas, acao] of grupo.itens) {
      const caixa = document.createElement("span");
      caixa.className = "help-teclas";
      for (const t of teclas) {
        const kbd = document.createElement("kbd");
        kbd.textContent = t;
        caixa.appendChild(kbd);
      }
      bloco.append(caixa, texto(acao, "help-acao"));
    }
    painel.appendChild(bloco);
  }

  const rodape = document.createElement("div");
  rodape.className = "help-rodape";
  const kbd = document.createElement("kbd");
  kbd.textContent = "F1";
  rodape.append(kbd, texto("ou "), (() => {
    const h = document.createElement("kbd");
    h.textContent = "H";
    return h;
  })(), texto("fecha este painel"));
  painel.appendChild(rodape);

  return painel;
}

/**
 * O menu de comandos, montado da MESMA tabela `ATALHOS`.
 *
 * Só entram as linhas que têm comando: não há botão para "andar" nem para
 * "mirar", e inventar um seria pior do que não ter. Os grupos que sobram vazios
 * (nenhum hoje, mas "Mover" chega perto) simplesmente não aparecem.
 *
 * Cada botão mostra a AÇÃO em cima e a TECLA embaixo, e não o contrário: quem
 * abriu o menu está procurando o que fazer, não que letra apertar. A tecla fica
 * como nota de rodapé — e é ela que, com o tempo, ensina o atalho e torna o
 * menu desnecessário, que é o melhor destino possível para um menu destes.
 *
 * @param {(cmd: [string, unknown]) => void} aoClicar
 */
function montarMenuComandos(aoClicar) {
  const frag = document.createDocumentFragment();

  for (const grupo of ATALHOS) {
    const comandos = grupo.itens.filter((it) => it[2]);
    if (!comandos.length) continue;

    const bloco = document.createElement("div");
    bloco.className = "cmd-grupo";

    const titulo = document.createElement("h4");
    titulo.textContent = grupo.titulo;
    bloco.appendChild(titulo);

    const grade = document.createElement("div");
    grade.className = "cmd-grade";
    for (const [teclas, rotulo, cmd] of comandos) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "cmd-botao";
      botao.append(texto(rotulo, "cmd-rotulo"));

      if (teclas.length) {
        const dica = document.createElement("span");
        dica.className = "cmd-tecla";
        for (const t of teclas) {
          const kbd = document.createElement("kbd");
          kbd.textContent = t;
          dica.appendChild(kbd);
        }
        botao.appendChild(dica);
      }

      botao.addEventListener("click", () => aoClicar(cmd));
      grade.appendChild(botao);
    }
    bloco.appendChild(grade);
    frag.appendChild(bloco);
  }

  return frag;
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.score = 0;
    this.shots = 0;
    this.hits = 0;

    root.innerHTML = `
      <div class="chip" id="score-chip">
        <span class="label">Pontos</span><span class="value" id="score">0</span>
      </div>
      <div class="chip" id="stats-chip">
        <span id="stats">0 acertos / 0 tiros · média 0.0</span>
      </div>

      <div class="chip" id="wind-chip">
        <div id="wind-dial"><div id="wind-arrow"></div></div>
        <div>
          <div class="label">Vento</div>
          <div class="value" id="wind-speed">0.0 m/s</div>
        </div>
      </div>
      <div class="chip" id="pin-chip">
        <span class="label">Mira</span>
        <span class="value" id="focus">—</span>
      </div>
      <!-- Contagem de bichos em campo. Fixa, em TODOS os modos: é informação
           de situação, não de modo. -->
      <div class="chip" id="boar-chip">
        <span class="label">Porcos</span>
        <span class="value" id="boar-count">0 vivos / 0 mortos</span>
      </div>
      <div class="chip" id="fauna-chip">
        <span class="label">Fauna</span>
        <span class="value" id="fauna-count">0 alces · 0 aves</span>
      </div>

      <!-- Vida do alce mais próximo. Só aparece quando existe um. -->
      <div class="chip" id="elk-chip" hidden>
        <span class="label" id="elk-label">Alce</span>
        <div id="elk-bar"><div id="elk-bar-fill"></div></div>
      </div>

      <!-- Só aparece quando a conexão cai. Uma sala silenciosa e um servidor
           fora do ar são indistinguíveis sem isso. -->
      <div class="chip" id="net-chip" hidden>
        <span class="value">reconectando…</span>
      </div>

      <!-- FPS, sempre visível, em qualquer modo e fase.
           Fica fora do painel de depuração de propósito: o painel é para quem
           está investigando, e a taxa de quadros é para quem está JOGANDO —
           quando o jogo engasga, a primeira pergunta é essa, e ela não pode
           depender de lembrar um atalho. Muda de cor em 50 e em 30. -->
      <div id="fps-meter"><b id="fps-value">60</b><span>FPS</span></div>

      <!-- Faixa do modo de jogo e dos convites de duelo. -->
      <div id="mode-banner" hidden></div>

      <div id="reticle">
        <i class="h1"></i><i class="h2"></i><i class="v1"></i><i class="v2"></i>
        <i class="dot"></i>
      </div>

      <div id="power">
        <div id="power-track">
          <div id="power-fill"></div>
          <div id="power-mark"></div>
        </div>
        <div id="power-label">0 m/s</div>
      </div>

      <!-- Combustível do jetpack. Some quando está cheio e no chão: a mira já
           tem informação demais em volta para carregar um medidor que não muda.
           Pulsa vermelho abaixo de 25 %, e esse é o aviso que precisa chegar
           ANTES de o tanque acabar, não junto. -->
      <div id="fuel" hidden>
        <div id="fuel-track"><div id="fuel-fill"></div></div>
        <span id="fuel-label">JETPACK</span>
      </div>

      <!-- Onda nova da caçada. Some sozinha; ver announceWave(). Sem crases
           neste bloco: ele é um template literal, e uma crase o encerraria. -->
      <div id="wave-banner" hidden>
        <span id="wave-n"></span>
        <span id="wave-size"></span>
      </div>

      <!-- Modo zumbi: horda, zumbis restantes e vidas. Fica junto dos outros
           chips de situação, e não no meio da tela, porque é informação que se
           consulta de relance entre um tiro e outro. -->
      <!-- Placar do duelo de times. O time à frente fica destacado: é a única
           informação que importa num relance, e ler dois números para descobrir
           quem ganha é trabalho demais no meio de um tiroteio. -->
      <div class="chip" id="team-chip" hidden>
        <span class="team-lado" id="team-humans">
          <span class="label">Humanos</span><span class="value" id="team-humans-v">0</span>
        </span>
        <span class="team-x">×</span>
        <span class="team-lado" id="team-bots">
          <span class="value" id="team-bots-v">0</span><span class="label">CPU</span>
        </span>
      </div>

      <!-- ÚLTIMO EM PÉ: quantos ainda estão de pé. É o único número do modo, e
           ver esse número cair de oito para três é a partida inteira contada. -->
      <div class="chip" id="stand-chip" hidden>
        <span class="label">De pé</span><span class="value" id="stand-alive">0</span>
        <span class="stand-total" id="stand-total"></span>
      </div>

      <!-- ROUBA BANDEIRA: o placar, e QUEM ESTÁ COM ELA.
           O nome do portador tem chip próprio, grande e colorido pelo time,
           porque é a única informação que o modo exige a todo instante — e uma
           informação que se procura num canto é uma informação que chega tarde
           demais para mudar o que se faz com ela. -->
      <div class="chip" id="flag-chip" hidden>
        <span class="team-lado"><span class="label">Azul</span><span class="value" id="flag-humans">0</span></span>
        <span class="team-x">×</span>
        <span class="team-lado"><span class="value" id="flag-bots">0</span><span class="label">Vermelho</span></span>
      </div>

      <div id="flag-carrier" hidden>
        <span id="flag-carrier-icon">⚑</span>
        <span id="flag-carrier-name"></span>
        <span id="flag-carrier-tail"></span>
      </div>

      <!-- Espectador: a faixa que explica por que o corpo não responde mais. -->
      <div id="spectating" hidden>
        <strong>VOCÊ CAIU</strong>
        <span>câmera livre · WASD para voar · Espaço sobe · C desce · Shift acelera</span>
      </div>

      <div class="chip" id="zombie-chip" hidden>
        <span class="label" id="zombie-horde-label">Horda</span><span class="value" id="zombie-horde">1</span>
        <!-- O substantivo muda com o modo: o chip é o mesmo, o que ele conta
             não é. Ver setZombie e setMeteor. (Sem crases aqui: isto está
             dentro de um template literal, e uma crase fecharia a string.) -->
        <span class="label" id="zombie-left-label">Zumbis</span><span class="value" id="zombie-left">0</span>
      </div>

      <!-- ----------------------------------------------------------- cerco --
           A INTEGRIDADE DO PORTÃO fica embaixo, no centro, e é a peça mais
           pesada da tela inteira. Não é hierarquia visual arbitrária: é a
           única coisa capaz de fazer a partida ser perdida, e o modo se perde
           por uma TAXA — que é justamente o tipo de informação que HUD costuma
           esconder num canto.

           A FILA fica ao lado dela porque é a única variável que o jogador
           controla diretamente. Sem mostrá-la, o jogo pede que ele adivinhe o
           que otimizar — e ele otimiza abates, que não é o que decide nada.

           Nenhum contador de abates aqui. Ele vai para a tela de fim, junto do
           número que importa de verdade: quanto tempo o portão passou em
           risco. -->
      <div id="siege-panel" hidden>
        <div id="siege-gate-wrap">
          <div id="siege-gate-bar"><div id="siege-gate-fill"></div></div>
          <div id="siege-gate-label">PORTÃO</div>
        </div>
        <div id="siege-side">
          <div class="siege-stat"><span id="siege-queue">0</span><small>no portão</small></div>
          <div class="siege-stat"><span id="siege-clock">20:00</span><small>até o pôr do sol</small></div>
        </div>
        <div id="siege-trebs"></div>
      </div>

      <!-- A dica da tecla F. Aparece só quando há o que fazer, e diz O QUE —
           uma tecla com três significados precisa dizer qual está valendo. -->
      <div id="siege-hint" hidden></div>

      <!-- Renascimento e game over. Este SIM no meio da tela: o jogador está
           morto, não tem o que mirar, e a única coisa que importa é o número.
           A terceira linha é a SAÍDA: uma tela de fim sem dizer como recomeçar
           deixa a pessoa olhando o texto sem saber que o jogo ainda responde. -->
      <div id="zombie-center" hidden>
        <div id="zombie-center-title"></div>
        <div id="zombie-center-sub"></div>
        <div id="zombie-center-hint" hidden><kbd>Enter</kbd><span></span></div>
      </div>

      <!-- Preparação coordenada da noite. O jogo fica coberto enquanto os
           clientes aquecem iluminação, shaders e a primeira silhueta da horda. -->
      <div id="mode-loading" hidden>
        <div class="mode-loading-card">
          <div class="mode-loading-title" id="mode-loading-title">preparando…</div>
          <div class="mode-loading-track">
            <div id="mode-loading-fill"></div>
          </div>
          <div class="mode-loading-status" id="mode-loading-status"></div>
        </div>
      </div>

      <!-- Vitória da caçada: entra ao fechar a quinta onda (ver S2C.HUNT_OVER).
           Fica na tela até o Enter, por isso a dica mora dentro do próprio
           card — é a única tecla que a fecha E recomeça a partida, e ninguém
           adivinha sozinho. Mesmo card para todo modo com ranking no fim
           (série, alce, pássaros, zumbis, último em pé, bandeira, cerco). -->
      <div id="hunt-victory" hidden>
        <div class="hv-card">
          <div class="hv-title" id="hunt-victory-title">CAÇADA CONCLUÍDA</div>
          <div class="hv-winner">
            <span class="hv-winner-label">Vencedor</span>
            <span class="hv-winner-name"></span>
            <span class="hv-winner-count"></span>
          </div>
          <div class="hv-others"></div>
          <div class="hv-hint"><kbd>Enter</kbd><span>para jogar de novo</span></div>
        </div>
      </div>

      <!-- ALERTA DA CHUVA DE METEOROS.
           Sem isto o modo é injusto: a rocha que mata é sempre a que estava
           fora da tela. São duas peças — a moldura que pulsa vermelho, e UM
           MARCADOR POR ROCHA, criado sob demanda em #meteor-marks. -->
      <div id="danger-edge" hidden></div>
      <div id="meteor-marks"></div>

      <!-- Barra do ESPECIAL. Cheia, ela pulsa e anuncia a tecla: ninguém
           adivinha sozinho que tem uma arma na mão. -->
      <div id="special-chip" hidden>
        <span class="sp-label">ESPECIAL</span>
        <div class="sp-bar"><div class="sp-fill" id="special-fill"></div></div>
        <span class="sp-ready" id="special-ready">PRONTO · Q</span>
      </div>

      <div id="toasts"></div>

      <!-- Preenchido por montarAtalhos(), a partir da tabela ATALHOS. -->
      <div id="help" class="hidden"></div>

      <!-- O MENU DE COMANDOS. Três toques na crase (ver Input.crase), e abre.
           (Sem crases neste comentário: ele está dentro de um template
           literal, e uma crase fecharia a string.)

           Ele existe porque o jogo tem trinta e poucos atalhos e nenhum deles é
           descobrível com o mouse: quem quer trocar de modo, pôr um bot ou
           adiantar um escalão precisa lembrar a letra. O painel de atalhos
           mostra as letras; este aqui as EXECUTA — e é montado da mesma tabela,
           então nunca oferece um botão para uma tecla que não existe mais.

           Preenchido por montarMenuComandos(). -->
      <div id="cmd-menu" hidden>
        <div class="cmd-card">
          <div class="cmd-topo">
            <span class="cmd-titulo">Comandos</span>
            <button type="button" id="cmd-fechar" title="fechar (Esc)">✕</button>
          </div>
          <div class="cmd-corpo"></div>
          <div class="cmd-rodape">
            <kbd>\`</kbd><span>três toques abrem este menu</span>
            <kbd>Esc</kbd><span>fecha</span>
          </div>
        </div>
      </div>

      <!-- Com o painel fechado, esta é a única pista de como reabri-lo. -->
      <div id="help-hint"><kbd>F1</kbd><span>atalhos</span></div>

      <div id="lock-hint">
        <div class="card">
          <h2>Clique para mirar</h2>
          <p>O ponteiro será capturado. <kbd>Esc</kbd> libera.</p>
        </div>
      </div>
    `;

    this.el = {
      score: root.querySelector("#score"),
      stats: root.querySelector("#stats"),
      windArrow: root.querySelector("#wind-arrow"),
      windSpeed: root.querySelector("#wind-speed"),
      focus: root.querySelector("#focus"),
      boarChip: root.querySelector("#boar-chip"),
      faunaChip: root.querySelector("#fauna-chip"),
      boarCount: root.querySelector("#boar-count"),
      faunaCount: root.querySelector("#fauna-count"),
      elkChip: root.querySelector("#elk-chip"),
      elkLabel: root.querySelector("#elk-label"),
      elkBarFill: root.querySelector("#elk-bar-fill"),
      netChip: root.querySelector("#net-chip"),
      modeBanner: root.querySelector("#mode-banner"),
      waveBanner: root.querySelector("#wave-banner"),
      waveN: root.querySelector("#wave-n"),
      waveSize: root.querySelector("#wave-size"),
      teamChip: root.querySelector("#team-chip"),
      teamHumans: root.querySelector("#team-humans"),
      teamBots: root.querySelector("#team-bots"),
      teamHumansV: root.querySelector("#team-humans-v"),
      teamBotsV: root.querySelector("#team-bots-v"),
      standChip: root.querySelector("#stand-chip"),
      standAlive: root.querySelector("#stand-alive"),
      standTotal: root.querySelector("#stand-total"),
      flagChip: root.querySelector("#flag-chip"),
      flagHumans: root.querySelector("#flag-humans"),
      flagBots: root.querySelector("#flag-bots"),
      flagCarrier: root.querySelector("#flag-carrier"),
      flagCarrierName: root.querySelector("#flag-carrier-name"),
      flagCarrierTail: root.querySelector("#flag-carrier-tail"),
      spectating: root.querySelector("#spectating"),
      zombieChip: root.querySelector("#zombie-chip"),
      siegePanel: root.querySelector("#siege-panel"),
      siegeGateFill: root.querySelector("#siege-gate-fill"),
      siegeGateLabel: root.querySelector("#siege-gate-label"),
      siegeQueue: root.querySelector("#siege-queue"),
      siegeClock: root.querySelector("#siege-clock"),
      siegeTrebs: root.querySelector("#siege-trebs"),
      siegeHint: root.querySelector("#siege-hint"),
      zombieHorde: root.querySelector("#zombie-horde"),
      zombieLeft: root.querySelector("#zombie-left"),
      zombieHordeLabel: root.querySelector("#zombie-horde-label"),
      zombieLeftLabel: root.querySelector("#zombie-left-label"),
      zombieCenter: root.querySelector("#zombie-center"),
      zombieCenterTitle: root.querySelector("#zombie-center-title"),
      zombieCenterSub: root.querySelector("#zombie-center-sub"),
      zombieCenterHint: root.querySelector("#zombie-center-hint"),
      zombieCenterHintText: root.querySelector("#zombie-center-hint span"),
      fpsMeter: root.querySelector("#fps-meter"),
      fpsValue: root.querySelector("#fps-value"),
      fuel: root.querySelector("#fuel"),
      fuelFill: root.querySelector("#fuel-fill"),
      modeLoading: root.querySelector("#mode-loading"),
      modeLoadingTitle: root.querySelector("#mode-loading-title"),
      modeLoadingFill: root.querySelector("#mode-loading-fill"),
      modeLoadingStatus: root.querySelector("#mode-loading-status"),
      huntVictory: root.querySelector("#hunt-victory"),
      huntVictoryTitle: root.querySelector("#hunt-victory-title"),
      huntVictoryWinnerName: root.querySelector(".hv-winner-name"),
      huntVictoryWinnerCount: root.querySelector(".hv-winner-count"),
      huntVictoryOthers: root.querySelector(".hv-others"),
      power: root.querySelector("#power"),
      powerFill: root.querySelector("#power-fill"),
      powerMark: root.querySelector("#power-mark"),
      powerLabel: root.querySelector("#power-label"),
      reticle: root.querySelector("#reticle"),
      toasts: root.querySelector("#toasts"),
      help: root.querySelector("#help"),
      helpHint: root.querySelector("#help-hint"),
      lockHint: root.querySelector("#lock-hint"),
      dangerEdge: root.querySelector("#danger-edge"),
      meteorMarks: root.querySelector("#meteor-marks"),
      specialChip: root.querySelector("#special-chip"),
      specialFill: root.querySelector("#special-fill"),
      specialReady: root.querySelector("#special-ready"),
      cmdMenu: root.querySelector("#cmd-menu"),
      cmdCorpo: root.querySelector("#cmd-menu .cmd-corpo"),
      cmdFechar: root.querySelector("#cmd-fechar"),
    };

    this.el.help.appendChild(montarAtalhos());

    /* O MENU DE COMANDOS, montado uma vez.
     *
     * `onCommand` é preenchido por `main.js` e escreve a intenção em
     * `Input.actions` — ver o cabeçalho da tabela `ATALHOS`. O HUD não conhece
     * modo, rede nem física, e continua não conhecendo: ele só diz qual botão
     * foi apertado. */
    this.onCommand = null;
    /* O menu FECHA ao trocar de modo ou de fase, e fica aberto no resto.
     *
     * As duas trocas devolvem o jogador ao jogo — uma tela de carregamento, uma
     * arena nova — e deixar o menu por cima disso o obrigaria a fechá-lo às
     * cegas. Todo o resto (bot, porco, música, traçado) é justamente o que se
     * quer encadear sem fechar nada. */
    this.comandosQueFecham = new Set(["setMode", "setLevel", "setMeteorRain", "setSiege"]);
    /** Chamado ao abrir e ao fechar, para o input soltar/retomar o ponteiro. */
    this.onCommandMenuToggle = null;
    this.el.cmdCorpo.appendChild(
      montarMenuComandos((cmd) => this.onCommand?.(cmd)),
    );
    this.el.cmdFechar.addEventListener("click", () => this.closeCommandMenu());
    /* Clicar no VÉU (fora do card) fecha, como em qualquer diálogo. O teste de
       `target` é o que impede um clique dentro do card de fechar junto —
       o evento borbulha até aqui de qualquer forma. */
    this.el.cmdMenu.addEventListener("click", (e) => {
      if (e.target === this.el.cmdMenu) this.closeCommandMenu();
    });

    /* Marcadores da chuva: um por rocha, criados sob demanda e REAPROVEITADOS.
       O pool existe porque o número de rochas oscila a cada segundo, e recriar
       nós a cada quadro faria o navegador recalcular estilo o tempo todo por
       algo que só mudou de posição. */
    this._marks = [];

    // Marca da velocidade máxima útil na barra (tensão total).
    this.el.powerMark.style.left = "100%";
  }

  setDraw(fraction, speed) {
    const on = fraction > 0.001;
    this.drawing = on;
    this.el.power.classList.toggle("on", on);
    this.el.powerFill.style.width = `${fraction * 100}%`;
    this.el.powerLabel.textContent = `${speed.toFixed(0)} m/s`;
  }

  /** O retículo é fixo no centro; só escondemos na câmera da flecha. */
  setReticleVisible(visible) {
    this.el.reticle.classList.toggle("off", !visible);
    this.el.reticle.style.transform = this.drawing ? "scale(0.8)" : "scale(1)";
  }

  /** Distância até o ponto do cenário sob a mira. */
  setFocus(distance, hasFocus) {
    this.el.focus.textContent = hasFocus ? `${distance.toFixed(0)} m` : "—";
  }

  /**
   * A seta mostra PARA ONDE o vento empurra a flecha.
   *
   * A conversão é `180 − ângulo`, não `ângulo + 180`. Os dois acertam o caso de
   * frente e erram os laterais, porque entre o mundo e a tela há um espelho: no
   * mundo, girar de "para longe" (−Z) até "para a direita" (+X) DIMINUI o
   * ângulo; na tela, ir de cima para a direita AUMENTA a rotação CSS. Sem
   * inverter o sinal, seta para a direita significava flecha para a esquerda —
   * o oposto exato do que serve para mirar.
   *
   * @param {number} speed m/s
   * @param {number} relativeAngle rad — 0 = vento soprando na direção do olhar
   */
  setWind(speed, relativeAngle, vacuo = false) {
    /* No vácuo o widget não some: ele DIZ que não há ar.
     *
     * Sumir seria ambíguo — o jogador não saberia se o vento é zero, se o
     * medidor quebrou, ou se ele simplesmente não está olhando. E a ausência de
     * ar é a informação mais importante do cenário: é ela que explica por que a
     * flecha não deriva e por que não cai como no vale. */
    if (vacuo) {
      this.el.windSpeed.textContent = "vácuo";
      this.el.windArrow.style.transform = "rotate(0deg)";
      this.el.windArrow.style.opacity = "0.2";
      return;
    }
    this.el.windArrow.style.opacity = "";
    this.el.windSpeed.textContent = `${speed.toFixed(1)} m/s`;
    this.el.windArrow.style.transform = `rotate(${180 - radToDeg(relativeAngle)}deg)`;
  }

  /**
   * Quantos bichos existem em campo agora. Sempre visível, em qualquer modo.
   *
   * @param {number} alive porcos vivos
   * @param {number} dead corpos de porco ainda em cena
   * @param {number} elks alces vivos
   * @param {number} birds pássaros vivos
   */
  setCreatureCounts(alive, dead, elks, birds) {
    this.el.boarCount.textContent = `${alive} vivos / ${dead} mortos`;
    this.el.faunaCount.textContent = `${elks} alces · ${birds} aves`;
  }

  /**
   * Fases sem bicho escondem os contadores de bicho.
   *
   * "0 vivos / 0 mortos" numa Lua onde porco é impossível não é informação
   * neutra: é uma promessa de que existe caça em algum lugar, e o jogador perde
   * tempo procurando. Quando a resposta é sempre zero, a pergunta não deve
   * estar na tela.
   */
  setFauna(visivel) {
    this.el.boarChip.hidden = !visivel;
    this.el.faunaChip.hidden = !visivel;
  }

  /**
   * Vida do alce mais próximo.
   *
   * A barra sobre a cabeça do bicho some quando ele está atrás de você — e é
   * exatamente aí que saber se ele está quase caindo decide entre atirar mais
   * uma vez ou correr. Por isso ela também vive aqui, fixa.
   *
   * @param {number|null} health 0..1, ou null quando não há alce em campo
   */
  setElk(health, state) {
    if (health == null) {
      this.el.elkChip.hidden = true;
      this.el.elkChip.classList.remove("boss-hp");
      return;
    }
    this.el.elkChip.hidden = false;
    // Mesmo layout do chefão: topo central, fora dos chips laterais.
    this.el.elkChip.classList.add("boss-hp");
    this.el.elkBarFill.style.width = `${Math.max(0, Math.min(1, health)) * 100}%`;
    // Verde → âmbar → vermelho, igual à barra do bicho.
    this.el.elkBarFill.style.background = `hsl(${health * 118}deg 65% 50%)`;
    // Investindo: o aviso muda de texto e a peça pisca. É meio segundo de
    // antecedência, e é o que separa sair da frente de levar a cabeçada.
    const investindo = state === "charge";
    this.el.elkLabel.textContent = investindo ? "ALCE INVESTINDO" : "ALCE";
    this.el.elkChip.classList.toggle("perigo", investindo);
  }

  /** Avisa quando a conexão cai — some sozinho quando ela volta. */
  setConnection(online) {
    this.el.netChip.hidden = online;
  }

  /**
   * A taxa de quadros.
   *
   * Escreve no DOM só quando o número INTEIRO muda. Sem essa guarda seriam
   * sessenta escritas por segundo num elemento de texto, cada uma sujeitando o
   * navegador a recalcular layout — um medidor de desempenho que custa
   * desempenho é uma piada de mau gosto.
   */
  setFps(fps) {
    const n = Math.round(fps);
    if (n === this._fpsShown) return;
    this._fpsShown = n;
    this.el.fpsValue.textContent = String(n);
    this.el.fpsMeter.classList.toggle("medio", n < 50 && n >= 30);
    this.el.fpsMeter.classList.toggle("baixo", n < 30);
  }

  /**
   * O medidor de combustível do jetpack.
   *
   * @param {import("../systems/jetpack.js").Jetpack|null} jetpack
   *   `null` nas fases sem jetpack — e aí o medidor simplesmente não existe.
   */
  setFuel(jetpack) {
    const el = this.el.fuel;
    if (!jetpack) {
      el.hidden = true;
      return;
    }
    /* Cheio E parado no chão não precisa ocupar a tela: é justamente quando a
       informação não muda. Some, e volta assim que a pessoa decola. */
    const ocioso = jetpack.isFull && !jetpack.active;
    el.hidden = ocioso;
    if (ocioso) return;

    this.el.fuelFill.style.width = `${(jetpack.fuelFraction * 100).toFixed(1)}%`;
    el.classList.toggle("queimando", jetpack.active);
    el.classList.toggle("baixo", jetpack.isLow);
    el.classList.toggle("enchendo", !jetpack.active && !jetpack.isFull);
  }

  /**
   * Faixa do modo em curso e dos convites de duelo pendentes.
   *
   * O convite precisa ser visível e dizer o que fazer: uma tecla que só
   * funciona quando outra pessoa também aperta é invisível sem isto, e ninguém
   * descobriria o duelo sozinho.
   *
   * @param {string|null} [difficulty] o nível da chuva, quando o modo é ela.
   *   Aparece na faixa porque a faixa é o que se lê ao ENTRAR, que é o instante
   *   em que a pergunta "em qual nível?" tem resposta útil — depois de a
   *   primeira rocha cair já é tarde para descobrir. O chip carrega o mesmo
   *   dado pelo resto da partida.
   */
  setMode(mode, invites = [], needed = 2, selfId = null, level = "valley", difficulty = null) {
    const banner = this.el.modeBanner;
    banner.replaceChildren();

    const pendente = mode !== "duel" && invites.length > 0;
    /* Fora do vale a faixa aparece SEMPRE, mesmo no modo livre. Estar na Lua é
       informação de estado: sem a faixa, quem entra na sala com a partida já em
       curso não teria nada na tela dizendo por que pula seis metros. */
    const foraDoVale = level !== "valley";
    if (mode === "free" && !pendente && !foraDoVale) {
      banner.hidden = true;
      return;
    }
    /* O CERCO NÃO TEM FAIXA, e é o único modo assim.
     *
     * A regra geral — faixa sempre, fora do vale — existe para quem entra numa
     * sala já em curso não ficar sem nada na tela explicando o estado. No cerco
     * essa função já é cumprida, e melhor, pelo painel do próprio modo: a barra
     * do portão, a fila e o relógio até o pôr do sol dizem em que modo se está
     * e como ele vai. A faixa vira repetição — e repetição atravessada no alto
     * da tela, que é exatamente onde a rampa aparece quando se olha do adarve. */
    if (mode === "siege" && !pendente) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;

    if (pendente) {
      const euJaAceitei = invites.some((i) => i.id === selfId);
      const nomes = invites.map((i) => i.name).join(", ");
      banner.className = "convite";
      banner.append(
        texto(`${nomes} ${invites.length > 1 ? "querem" : "quer"} duelar`, "forte"),
        texto(
          euJaAceitei
            ? `   aguardando mais ${needed - invites.length}…`
            : "   aperte 2 para aceitar",
        ),
      );
      return;
    }

    /* O LUGAR VEM DA FASE, e não de um `if` que só conhecia duas.
       Enquanto a Lua era a única fase fora do vale, escrever "LUA" à mão dava
       certo por acidente; com o castelo, quem entrava no cerco lia
       "LUA · SIEGE" na faixa. */
    const lugar = { moon: "LUA", castle: "CASTELO" }[level] ?? null;
    banner.className = foraDoVale ? `${mode} lua` : mode;
    if (lugar) banner.append(texto(lugar, "forte"), texto("   ·   "));
    banner.append(
      texto(
        {
          free: "MODO LIVRE",
          duel: "DUELO",
          teamDuel: "DUELO DE TIMES",
          boarHunt: "CAÇADA AOS PORCOS",
          birdHunt: "CAÇA AOS PÁSSAROS",
          series: "ALVOS EM SÉRIE",
          elkHunt: "CAÇADA AO ALCE",
          zombie: "NOITE DOS ZUMBIS",
          zombieBoss: "CHEFÃO ZUMBI",
          meteorRain: "CHUVA DE METEOROS",
          siege: "CERCO AO CASTELO",
          lastStand: "O ÚLTIMO EM PÉ",
          captureFlag: "ROUBA BANDEIRA",
        }[mode] ?? mode.toUpperCase(),
        "forte",
      ),
    );
    /* O NÍVEL COMO TERCEIRO PEDAÇO DA FAIXA, com o mesmo peso do lugar e do
       modo: "LUA · CHUVA DE METEOROS · DIFÍCIL". Não é adorno — numa sala, quem
       não clicou no botão precisa saber em que nível o outro acabou de pôr
       todo mundo, e a faixa é a única coisa que ele lê ao entrar. */
    /* SÓ A CHUVA, e não o cerco: o cerco não tem faixa. Ele sai lá em cima por
       `banner.hidden = true` — o painel do portão é o cabeçalho dele —, então
       uma linha aqui para `siege` seria código morto. O nível do cerco mora no
       rótulo do portão (ver `setSiege`), que é melhor do que a faixa para
       o que ele precisa: fica a partida inteira em vez de sumir em segundos. */
    if (mode === "meteorRain" && NIVEIS_DA_CHUVA[difficulty]) {
      banner.append(texto("   ·   "), texto(NIVEIS_DA_CHUVA[difficulty], "forte"));
    }
    banner.append(
      texto(
        mode === "lastStand"
          ? "   uma vida só · quem sobrar ganha · 1 para sair"
          : mode === "captureFlag"
          ? "   roube a bandeira deles e traga para a SUA base · 5 vencem · 1 para sair"
          : mode === "meteorRain"
          ? "   nenhuma pode encostar no chão · 1 para sair"
          : foraDoVale
            ? "   9 para voltar"
            : mode === "birdHunt"
              ? "   5 aves ou a rara · 1 para sair"
              : "   1 para sair",
      ),
    );
  }

  /**
   * Placar dos dois times, no alto da tela.
   *
   * @param {{humans:number, bots:number}|null} placar null esconde o painel
   */
  setTeamScores(placar) {
    const chip = this.el.teamChip;
    if (!placar) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    this.el.teamHumansV.textContent = String(placar.humans ?? 0);
    this.el.teamBotsV.textContent = String(placar.bots ?? 0);
    const h = (placar.humans ?? 0) > (placar.bots ?? 0);
    const b = (placar.bots ?? 0) > (placar.humans ?? 0);
    this.el.teamHumans.classList.toggle("liderando", h);
    this.el.teamBots.classList.toggle("liderando", b);
  }

  /* --------------------------------------------------- o último em pé ------ */

  /**
   * Quantos ainda estão de pé.
   *
   * Um número, e não a lista de nomes. A lista foi a primeira ideia e é pior:
   * com oito arqueiros ela ocupa um bloco de tela inteiro, e a pergunta que se
   * faz no meio de uma rodada nunca é "quem exatamente ainda vive?" — é
   * "quantos faltam para eu ganhar?". O nome de quem sobrou só importa quando
   * sobram dois, e aí ele cabe no lugar do total.
   *
   * @param {object|null} estado `S2C.STAND_STATUS`; null esconde o chip
   */
  setStand(estado, selfId = null) {
    const chip = this.el.standChip;
    if (!estado) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;

    const vivos = estado.alive ?? [];
    this.el.standAlive.textContent = String(vivos.length);

    /* Sobraram dois: o total dá lugar ao NOME do outro. É a informação que
       passa a valer — a partir daqui a rodada é um duelo, e saber contra quem
       muda o que se faz. */
    if (vivos.length === 2 && selfId != null && vivos.some((p) => p.id === selfId)) {
      const outro = vivos.find((p) => p.id !== selfId);
      this.el.standTotal.textContent = outro ? `vs ${outro.name}` : "";
    } else {
      this.el.standTotal.textContent = estado.total ? `de ${estado.total}` : "";
    }

    // Vermelho quando é a reta final: a cor faz o trabalho que o número sozinho
    // não faz, que é chamar o olho sem ser procurada.
    chip.classList.toggle("critico", vivos.length > 0 && vivos.length <= 2);
  }

  /** A faixa de quem virou espectador. */
  setSpectating(on) {
    this.el.spectating.hidden = !on;
  }

  /**
   * O fim da rodada.
   *
   * Duas informações separadas, e é de propósito: o VENCEDOR é quem sobrou, e o
   * ranking é por abates. São coisas diferentes — dá para vencer sem ter
   * atirado, escondido atrás de uma pedra enquanto os outros se acabavam, e
   * essa é uma vitória legítima do modo. Mostrar só o ranking de abates
   * esconderia o vencedor; mostrar só o vencedor esconderia o que aconteceu.
   */
  showStandVictory(msg, selfId = null) {
    const ranking = msg.ranking ?? [];
    if (!ranking.length) return;
    const rotulo = (p) => {
      const k = p.kills ?? 0;
      const abates = `${k} ${k === 1 ? "abate" : "abates"}`;
      return p.survived ? `sobreviveu · ${abates}` : abates;
    };
    this.showHuntVictory(ranking, selfId, {
      title: msg.winner == null ? "NINGUÉM SOBROU" : "O ÚLTIMO EM PÉ",
      winnerLabel: "Sobreviveu",
      statLabel: rotulo,
    });
  }

  /* --------------------------------------------------- rouba bandeira ------ */

  /**
   * O placar e — a parte que importa — QUEM ESTÁ COM A BANDEIRA.
   *
   * O nome do portador fica no MEIO da tela, alto e colorido pelo time, e não
   * num chip de canto junto dos outros. É a informação que decide o que cada
   * pessoa faz no segundo seguinte: quem está com ela corre, quem não está
   * persegue ou defende. Uma informação que precisa ser procurada chega tarde
   * demais para servir a essa decisão — e "tarde demais" aqui são os dois
   * segundos entre alguém pegar a bandeira e já estar longe.
   *
   * @param {object|null} estado `S2C.FLAG`; null esconde tudo
   * @param {string|null} nome quem carrega, resolvido pelo `main`
   */
  /**
   * A faixa e o chip do rouba bandeira.
   *
   * @param {object|null} estado `S2C.FLAG` — ver `FlagField.view()`
   * @param {Array<string|null>} nomes o portador de cada bandeira, na ordem da
   *   lista que veio na amostra
   * @param {number|null} selfId
   * @param {"humans"|"bots"|null} meuTime de que lado quem está lendo está. Sem
   *   ele a faixa não tem como saber se a notícia é boa: os times são mistos.
   */
  setFlag(estado, nomes = [], selfId = null, meuTime = null) {
    const chip = this.el.flagChip;
    const faixa = this.el.flagCarrier;
    if (!estado) {
      chip.hidden = true;
      faixa.hidden = true;
      return;
    }

    chip.hidden = false;
    this.el.flagHumans.textContent = String(estado.scores?.humans ?? 0);
    this.el.flagBots.textContent = String(estado.scores?.bots ?? 0);

    const flags = estado.flags ?? [];
    /* A FAIXA MOSTRA UMA COISA SÓ, e a escolha de qual é a decisão deste
     * método. São duas bandeiras e cinco estados possíveis entre elas; escrever
     * tudo daria um parágrafo no meio da tela, e um parágrafo no meio da tela
     * durante uma corrida não é lido por ninguém.
     *
     * A ordem de urgência é a do jogo:
     *   1. EU estou com uma → é o que eu tenho de fazer agora;
     *   2. a MINHA está com alguém → é o que meu time tem de resolver agora;
     *   3. um companheiro está com a do outro → cubra;
     *   4. a minha está caída → resgate, com cronômetro;
     *   5. nada acontecendo → a faixa some. */
    const minha = flags.find((f) => f.team === meuTime) ?? null;
    const deles = flags.find((f) => f.team !== meuTime) ?? null;
    const nomeDe = (f) => nomes[flags.indexOf(f)] ?? "alguém";

    const euCarrego = flags.find((f) => selfId != null && f.carrier === selfId);
    if (euCarrego) {
      faixa.hidden = false;
      faixa.className = "humans";
      this.el.flagCarrierName.textContent = "VOCÊ ESTÁ COM A BANDEIRA";
      this.el.flagCarrierTail.textContent = "corra para a SUA base";
      return;
    }

    if (minha?.state === "carried") {
      faixa.hidden = false;
      faixa.className = "bots";
      this.el.flagCarrierName.textContent = `${nomeDe(minha)} ROUBOU A SUA BANDEIRA`;
      this.el.flagCarrierTail.textContent = "derrube!";
      return;
    }

    if (deles?.state === "carried") {
      faixa.hidden = false;
      faixa.className = "humans";
      this.el.flagCarrierName.textContent = `${nomeDe(deles)} está com a bandeira inimiga`;
      this.el.flagCarrierTail.textContent = "cubra!";
      return;
    }

    if (minha?.state === "dropped") {
      faixa.hidden = false;
      faixa.className = "livre";
      this.el.flagCarrierName.textContent = "A SUA BANDEIRA CAIU";
      this.el.flagCarrierTail.textContent =
        minha.returnIn != null
          ? `encoste para resgatar · volta sozinha em ${Math.ceil(minha.returnIn)}s`
          : "encoste para resgatar";
      return;
    }

    if (deles?.state === "dropped") {
      faixa.hidden = false;
      faixa.className = "livre";
      this.el.flagCarrierName.textContent = "BANDEIRA INIMIGA CAÍDA";
      this.el.flagCarrierTail.textContent =
        deles.returnIn != null ? `some em ${Math.ceil(deles.returnIn)}s` : "corra até ela";
      return;
    }

    faixa.hidden = true;
  }

  /**
   * O fim da partida de bandeira: qual time levou, e quem entregou mais.
   *
   * Os lados deixaram de se chamar "humanos" e "CPU" porque deixaram de ser
   * isso: no rouba bandeira eles são MISTOS — cada corpo que entra vai para o
   * lado com menos gente, humano ou não (ver `Room.escalarNoTime`). Azul e
   * vermelho são as cores que a bandeira, o halo e o placar já usam, então o
   * nome do time é a única coisa que faltava dizer a mesma língua.
   *
   * E o placar ordena por ENTREGAS, com abates de desempate. Num modo de
   * bandeira, quem correu com ela é quem ganhou a partida — ordenar por abates
   * premiaria quem passou a partida inteira no próprio quintal.
   */
  showFlagVictory(msg, selfId = null) {
    const ranking = msg.ranking ?? [];
    if (!ranking.length) return;
    const time = msg.winner === "humans" ? "AZUL" : "VERMELHO";
    const p = msg.scores ?? {};
    const rotulo = (r) => {
      const c = r.captures ?? 0;
      const k = r.kills ?? 0;
      const lado = r.team === "humans" ? "azul" : "vermelho";
      return `${lado} · ${c} ${c === 1 ? "entrega" : "entregas"} · ${k} ${k === 1 ? "abate" : "abates"}`;
    };
    this.showHuntVictory(ranking, selfId, {
      title: `TIME ${time} VENCEU  ${p.humans ?? 0} × ${p.bots ?? 0}`,
      winnerLabel: "Mais entregas",
      statLabel: rotulo,
    });
  }

  /* --------------------------------------------------------------- zumbis -- */

  /**
   * Painel do modo zumbi: horda e quantos zumbis faltam.
   */
  setZombie(estado) {
    const chip = this.el.zombieChip;
    if (!estado) {
      chip.hidden = true;
      this.hideZombieCenter();
      return;
    }
    chip.hidden = false;
    this.el.zombieHordeLabel.textContent = "Horda";
    this.el.zombieLeftLabel.textContent = "Zumbis";
    this.el.zombieHorde.textContent = `${estado.horde} / ${estado.hordes}`;
    this.el.zombieLeft.textContent = String(estado.remaining);
  }

  /**
   * Barra de vida do chefão (reusa o chip do alce, centralizado no topo).
   *
   * @param {number|null} health fração de 0 a 1; `null` esconde
   * @param {string} [rotulo] quem está apanhando. O colosso da chuva usa a
   *   MESMA barra pela mesma razão que o chip do modo reusa o do zumbi: é a
   *   mesma informação, no mesmo lugar, com outro substantivo — e dois
   *   conjuntos de elementos seriam dois para sair de sincronia.
   */
  setBossHp(health, rotulo = "CHEFÃO") {
    if (health == null) {
      this.el.elkChip.hidden = true;
      this.el.elkChip.classList.remove("boss-hp");
      return;
    }
    this.el.elkChip.hidden = false;
    this.el.elkChip.classList.add("boss-hp");
    this.el.elkBarFill.style.width = `${Math.max(0, Math.min(1, health)) * 100}%`;
    this.el.elkBarFill.style.background = `hsl(${health * 118}deg 70% 48%)`;
    this.el.elkLabel.textContent = rotulo;
    this.el.elkChip.classList.toggle("perigo", health < 0.25);
  }

  /** Faixa central: contagem de renascimento ou fim de jogo. */
  /**
   * @param {string} titulo
   * @param {string} sub
   * @param {string} classe
   * @param {string|null} dica texto da linha do `Enter`; `null` esconde a linha
   */
  showZombieCenter(titulo, sub = "", classe = "", dica = null) {
    const el = this.el.zombieCenter;
    el.hidden = false;
    el.className = classe;
    this.el.zombieCenterTitle.textContent = titulo;
    this.el.zombieCenterSub.textContent = sub;
    this.el.zombieCenterHint.hidden = !dica;
    if (dica) this.el.zombieCenterHintText.textContent = dica;
  }

  hideZombieCenter() {
    this.el.zombieCenter.hidden = true;
  }

  showModeLoading(title) {
    this.el.modeLoadingTitle.textContent = title;
    this.el.modeLoading.hidden = false;
    this.el.modeLoadingFill.style.width = "0%";
    this.el.modeLoadingStatus.textContent = "preparando a arena…";
  }

  updateModeLoading(ready, total, status) {
    const fraction =
      total > 0 ? Math.max(0, Math.min(1, Number(ready) / Number(total))) : 0;
    this.el.modeLoadingFill.style.width = `${fraction * 100}%`;
    if (status) this.el.modeLoadingStatus.textContent = status;
  }

  hideModeLoading() {
    this.el.modeLoading.hidden = true;
  }

  /* ------------------------------------------------------ chuva de meteoros --
   *
   * O chip e a faixa REAPROVEITAM os elementos do modo zumbi: é a mesma
   * informação na mesma posição, com outro substantivo. Dois conjuntos de
   * elementos para isso seriam duas coisas para manter em sincronia — e a
   * segunda sairia da sincronia na primeira mudança de estilo.
   */

  /** Painel da chuva: horda e quantas rochas faltam. */
  setMeteor(estado) {
    const chip = this.el.zombieChip;
    if (!estado) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    /* O NÍVEL VIVE NO RÓTULO do chip, e não num chip novo. A faixa que o
       anuncia ao entrar some em segundos; o que sobra pelo resto da partida é
       isto, e "Chuva" sozinho não responde a pergunta que aparece na horda 7
       quando o céu está pesado — se aquilo é o difícil ou se a pessoa está
       jogando mal o normal. Minúscula porque é rótulo, e rótulo não grita. */
    const nivel = NIVEIS_DA_CHUVA[estado.difficulty]?.toLowerCase() ?? null;
    this.el.zombieHordeLabel.textContent = nivel ? `Chuva · ${nivel}` : "Chuva";
    this.el.zombieLeftLabel.textContent = estado.tank ? "Alvo" : "Rochas";
    this.el.zombieHorde.textContent = `${estado.horde} / ${estado.hordes}`;
    this.el.zombieLeft.textContent = estado.tank ? "COLOSSO" : String(estado.rocks ?? 0);
  }

  /* ------------------------------------------------------------------ cerco -- */

  /**
   * O painel do cerco: integridade do portão, fila e relógio.
   *
   * @param {object|null} estado o `Siege.status()` da sala, ou null ao sair
   */
  setSiege(estado) {
    const p = this.el.siegePanel;
    if (!estado) {
      p.hidden = true;
      this.el.siegeHint.hidden = true;
      return;
    }
    p.hidden = false;

    const f = Math.max(0, Math.min(1, estado.gate ?? 1));
    this.el.siegeGateFill.style.width = `${(f * 100).toFixed(1)}%`;
    /* Três faixas de cor, e a última PULSA. A barra é a última linha de
       defesa da leitura: quem está mirando não olha para ela, e quando olha
       precisa saber em que estado está sem ler número nenhum. */
    const critico = f < 0.3;
    p.classList.toggle("critico", critico);
    p.classList.toggle("ferido", !critico && f < 0.62);
    /* O NÍVEL VIVE NO RÓTULO DO PORTÃO, e não num canto novo — mesma escolha do
       chip da chuva. A faixa que o anuncia ao entrar some em segundos; o que
       sobra pelo resto da partida é isto, e "PORTÃO 40 %" sozinho não responde
       a pergunta que aparece no minuto 8: se a madeira está cedendo porque o
       nível é o difícil ou porque a pessoa está jogando mal o normal.

       O NORMAL NÃO ESCREVE NADA. Ele é o cerco de sempre, e um rótulo em toda
       partida gastaria a atenção que os outros dois precisam ter. */
    const nivel = NIVEIS_DO_CERCO[estado.difficulty];
    const sufixo = nivel && estado.difficulty !== "normal" ? ` · ${nivel}` : "";
    this.el.siegeGateLabel.textContent = estado.gateAlive
      ? `PORTÃO ${Math.round(f * 100)}%${sufixo}`
      : `PORTÃO CAÍDO${sufixo}`;

    const fila = estado.fila ?? 0;
    this.el.siegeQueue.textContent = String(fila);
    this.el.siegeQueue.classList.toggle("alto", fila >= 4);

    const s = Math.max(0, estado.restante ?? 0);
    this.el.siegeClock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

    // A contagem de entrada ocupa o mesmo lugar do relógio: antes da primeira
    // chegada não existe "quanto falta para o pôr do sol", existe "prepare-se".
    if (estado.espera > 0) {
      this.el.siegeClock.textContent = String(estado.espera);
      this.el.siegeClock.nextElementSibling.textContent = "eles vêm aí";
    } else {
      this.el.siegeClock.nextElementSibling.textContent = "até o pôr do sol";
    }
  }

  /** Os três engenhos: carregado, içando ou pronto. */
  setTrebuchets(lista) {
    const el = this.el.siegeTrebs;
    if (!Array.isArray(lista)) {
      el.textContent = "";
      return;
    }
    // Reconstruído por mensagem (2 a 3 por partida por engenho), não por
    // quadro: não vale um diff.
    el.innerHTML = lista
      .map(
        (t) =>
          `<span class="treb ${t.ready ? "pronto" : "icando"}">${
            t.ready ? "◆" : "◇"
          }</span>`,
      )
      .join("");
  }

  /** A dica da tecla `F` — só aparece quando há o que fazer, e diz o quê. */
  setSiegeHint(acao) {
    const el = this.el.siegeHint;
    if (!acao) {
      el.hidden = true;
      return;
    }
    const texto = {
      atirar: "<b>F</b> para mirar o trabuco",
      içar: "<b>F</b> segure para içar o contrapeso",
      reparar: "<b>F</b> segure para reforçar o portão",
      mirando: "<b>mouse</b> move a marca · <b>clique</b> solta a pedra · <b>F</b> desiste",
    };
    el.innerHTML = texto[acao] ?? "";
    el.hidden = false;
  }

  /** A faixa do escalão novo. Reaproveita a faixa de onda — mesmo desenho. */
  announceTier(nome) {
    const faixa = this.el.waveBanner;
    this.el.waveN.textContent = String(nome).toUpperCase();
    this.el.waveSize.textContent = "estão chegando";
    faixa.hidden = false;
    faixa.classList.remove("entra");
    void faixa.offsetWidth;
    faixa.classList.add("entra");
    clearTimeout(this._waveTimer);
    this._waveTimer = setTimeout(() => {
      faixa.hidden = true;
      faixa.classList.remove("entra");
    }, 2600);
  }

  /**
   * O fim do cerco.
   *
   * O ranking é por PONTOS, e o rótulo de cada linha traz os abates — mas o
   * número que o título mostra é outro: quanto tempo o portão passou em risco.
   * É a medida do que o modo realmente pediu.
   */
  showSiegeOver(msg) {
    const rotulo = (p) => {
      const k = p.kills ?? 0;
      return `${k} ${k === 1 ? "abate" : "abates"} · ${p.points ?? 0} pts`;
    };
    const risco = msg.critical ?? 0;
    this.showHuntVictory(msg.ranking ?? [], null, {
      title: msg.reason === "dusk" ? "O SOL SE PÔS" : "O PORTÃO CAIU",
      /* O rótulo do primeiro colocado carrega o número que MEDE a partida:
         quanto tempo o portão passou abaixo de 30 %. Abates estão nas linhas,
         onde são contabilidade; aqui em cima fica o que o modo pediu. */
      winnerLabel:
        msg.reason === "dusk"
          ? `eles recuaram ao anoitecer · portão em risco por ${risco} s`
          : `a muralha foi tomada · ${risco} s de portão em risco`,
      statLabel: rotulo,
      hint: "para defender de novo",
    });
  }

  /** Fecha a tela de fim do cerco. É a mesma da caçada — ver `showSiegeOver`. */
  hideSiegeOver() {
    this.hideHuntVictory();
  }

  /**
   * A moldura de perigo.
   *
   * @param {number} força 0 a 1
   * @param {boolean} continuo abaixo do limiar crítico ela para de piscar e FICA
   */
  setDanger(forca, continuo = false) {
    const el = this.el.dangerEdge;
    el.hidden = false;
    el.style.opacity = String(Math.max(0, Math.min(1, forca)));
    el.classList.toggle("critico", continuo);
  }

  /**
   * Apaga só a MOLDURA.
   *
   * Ela não leva mais os marcadores junto, e a separação é o ponto: a moldura é
   * o alarme da rocha mais baixa e some assim que ninguém está perto do chão;
   * os marcadores são o inventário do céu e valem enquanto houver rocha. Quem
   * os apaga é `clearMeteorMarks`, e só no fim da partida.
   */
  clearDanger() {
    this.el.dangerEdge.hidden = true;
    this.el.dangerEdge.classList.remove("critico");
  }

  /** Clarão vermelho de tela cheia — o impacto que encerra a partida. */
  flashDanger(forca = 1) {
    this.setDanger(forca, true);
    clearTimeout(this._dangerTimer);
    this._dangerTimer = setTimeout(() => this.clearDanger(), 1600);
  }

  /**
   * UM MARCADOR POR ROCHA — todas elas, o tempo todo.
   *
   * A versão anterior mostrava uma seta só, a da rocha mais baixa, e escondia
   * até ela enquanto a altitude estivesse acima do limiar de aviso. O
   * raciocínio era "três setas seriam ruído", e ele estava errado pelo motivo
   * mais simples possível: **a informação que o modo pede não é "qual é a mais
   * urgente", é "quantas e onde"**. Com uma seta só, duas rochas atrás do
   * jogador viravam uma; e quem estava girando a câmera não tinha como saber se
   * já tinha visto todas.
   *
   * Cada marcador tem duas formas, e a troca é o que o torna legível:
   *
   * • rocha NA TELA — um anel sobre ela, com a altitude embaixo. Não aponta
   *   para nada: a rocha está ali, o anel só a circula no meio das estrelas.
   * • rocha FORA DA TELA — a seta na borda, girada para o rumo dela, como
   *   antes. É a única forma de apontar para algo que não está no quadro.
   *
   * @param {{angulo:number|null, x:number, y:number, alt:number,
   *          perigo:boolean, aviso:boolean}[]} marcas
   */
  setMeteorMarks(marcas) {
    const lista = marcas ?? [];
    // Cresce o pool até caber a chuva; ele nunca encolhe, e o teto é o
    // `maxAlive` da sala (16) — dezesseis nós é nada.
    while (this._marks.length < lista.length) {
      const el = document.createElement("div");
      el.className = "mm";
      el.innerHTML = `<div class="mm-anel"></div><div class="mm-seta">▲</div><div class="mm-alt"></div>`;
      this.el.meteorMarks.appendChild(el);
      this._marks.push({
        el,
        alt: el.querySelector(".mm-alt"),
      });
    }

    for (let i = 0; i < this._marks.length; i++) {
      const m = this._marks[i];
      const d = lista[i];
      if (!d) {
        m.el.hidden = true;
        continue;
      }
      m.el.hidden = false;
      const fora = d.angulo != null;
      m.el.classList.toggle("fora", fora);
      m.el.classList.toggle("perigo", d.perigo === true);
      m.el.classList.toggle("aviso", d.aviso === true && d.perigo !== true);

      if (fora) {
        /* Elipse inscrita na tela: a seta encosta na borda mais próxima daquele
           rumo em vez de andar num círculo que sobra nos cantos. */
        const x = Math.cos(d.angulo) * 42;
        const y = -Math.sin(d.angulo) * 38;
        const grausSeta = 90 - (d.angulo * 180) / Math.PI;
        m.el.style.transform = `translate(-50%, -50%) translate(${x}vw, ${y}vh)`;
        /* A SETA gira, o resto do marcador não: ninguém lê "40 m" de cabeça
           para baixo. Por isso a rotação vai na seta e não no bloco. */
        m.el.style.setProperty("--mm-giro", `${grausSeta}deg`);
      } else {
        // Na tela: direto na posição projetada da rocha. ±1 em NDC é a borda,
        // logo meia tela em cada eixo.
        m.el.style.transform = `translate(-50%, -50%) translate(${d.x * 50}vw, ${-d.y * 50}vh)`;
        m.el.style.setProperty("--mm-giro", "0deg");
      }
      m.alt.textContent = `${d.alt} m`;
    }
  }

  /** Apaga todos os marcadores (fim de horda, game over, troca de modo). */
  clearMeteorMarks() {
    for (const m of this._marks) m.el.hidden = true;
  }

  /** Barra do especial. `null` esconde. */
  setSpecial(estado) {
    const chip = this.el.specialChip;
    if (!estado) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    const f = estado.max > 0 ? Math.min(1, estado.charge / estado.max) : 0;
    this.el.specialFill.style.width = `${f * 100}%`;
    const pronto = f >= 1;
    chip.classList.toggle("pronto", pronto);
    this.el.specialReady.hidden = !pronto;
  }

  /**
   * A tela final da chuva.
   *
   * Ranking por ROCHA DESTRUÍDA, com a precisão ao lado. Num modo cooperativo
   * em que a métrica é economia de flecha, a precisão é o placar honesto: quem
   * destruiu oito rochas com nove flechas fez mais pelo grupo do que quem
   * destruiu dez com vinte e cinco.
   */
  showMeteorVictory(ranking, selfId = null) {
    const rotulo = (p) => {
      const r = p.rocks ?? 0;
      const s = p.shots ?? 0;
      const pct = s > 0 ? Math.round((r / s) * 100) : 0;
      return `${r} ${r === 1 ? "rocha" : "rochas"} · ${pct}% de aproveitamento`;
    };
    this.showHuntVictory(ranking, selfId, {
      title: "O CÉU AGUENTOU",
      statLabel: rotulo,
      winnerLabel: "Melhor artilheiro",
    });
  }

  /** Faixa de horda nova — mesma mecânica da onda da caçada. */
  announceHorde(n, size, boss = false, kind = "zombie") {
    const faixa = this.el.waveBanner;
    const rocha = kind === "meteor";
    this.el.waveN.textContent = boss
      ? "CHEFÃO"
      : rocha
        ? `CHUVA ${n}`
        : `HORDA ${n}`;
    this.el.waveSize.textContent = boss
      ? "horda final"
      : rocha
        ? `${size} ${size === 1 ? "rocha" : "rochas"}`
        : `${size} ${size === 1 ? "zumbi" : "zumbis"}`;
    faixa.hidden = false;
    faixa.classList.remove("entra");
    void faixa.offsetWidth;
    faixa.classList.add("entra");

    clearTimeout(this._waveTimer);
    this._waveTimer = setTimeout(() => {
      faixa.hidden = true;
      faixa.classList.remove("entra");
    }, 2400);
  }

  addShot() {
    this.shots++;
    this.refreshStats();
  }

  /* Placar e estatísticas são só contabilidade: quem anuncia o acerto na tela é
     `impact()`, chamado uma única vez por flecha. Ter as duas coisas juntas
     empilhava dois avisos por tiro assim que a distância entrou na conta. */
  addScore(points) {
    this.score += points;
    this.hits++;
    this.el.score.textContent = String(this.score);
    this.refreshStats();
  }

  miss() {
    this.refreshStats();
  }

  /**
   * Anuncia uma onda nova da caçada.
   *
   * A faixa é grande e no meio da tela porque o aviso compete com o que está
   * acontecendo: a pessoa está mirando, e um toast no canto passaria batido
   * justamente quando seis javalis entraram em campo. Ela some sozinha em
   * 2,4 s — tempo de ler, não de atrapalhar a mira.
   *
   * Reanunciar antes de a anterior sumir REINICIA a animação: sem tirar e
   * repor a classe, o navegador ignora o `animation` de um elemento que já a
   * tem, e a segunda onda entraria sem aviso nenhum.
   */
  announceWave(n, size) {
    const faixa = this.el.waveBanner;
    this.el.waveN.textContent = `ONDA ${n}`;
    this.el.waveSize.textContent = `${size} ${size === 1 ? "porco" : "porcos"}`;
    faixa.hidden = false;
    faixa.classList.remove("entra");
    void faixa.offsetWidth; // força o reinício da animação
    faixa.classList.add("entra");

    clearTimeout(this._waveTimer);
    this._waveTimer = setTimeout(() => {
      faixa.hidden = true;
      faixa.classList.remove("entra");
    }, 2400);
  }

  /**
   * A tela de vitória da caçada: o vencedor em destaque, os demais por baixo
   * e sem realce — visíveis, mas claramente secundários.
   *
   * `ranking` já chega ORDENADO (a sala ordena antes de mandar, ver
   * S2C.HUNT_OVER e S2C.ZOMBIE_OVER) — aqui só se desenha o primeiro como
   * vencedor e o resto como lista.
   *
   * `opts.title` e `opts.statLabel` deixam a mesma tela servir a horda de
   * zumbis (ver `showZombieVictory`), que pontua e mostra outra coisa.
   */
  showHuntVictory(ranking, selfId = null, opts = {}) {
    if (!ranking.length) return;
    const {
      title = "CAÇADA CONCLUÍDA",
      winnerLabel = "Vencedor",
      statLabel = (p) => `${p.boars ?? 0} ${p.boars === 1 ? "porco abatido" : "porcos abatidos"}`,
      /* O que o Enter FAZ, escrito no card: fecha a tela e recomeça a
         partida do mesmo modo, do zero — em todo modo que usa este card. */
      hint = "para jogar de novo",
    } = opts;
    const [vencedor, ...resto] = ranking;
    const cor = (c) => `#${(c ?? 0xffffff).toString(16).padStart(6, "0")}`;

    this.el.huntVictoryTitle.textContent = title;
    const labelEl = this.el.huntVictory.querySelector(".hv-winner-label");
    if (labelEl) labelEl.textContent = winnerLabel;
    this.el.huntVictoryWinnerName.textContent = vencedor.name;
    this.el.huntVictoryWinnerName.style.color = cor(vencedor.color);
    this.el.huntVictoryWinnerCount.textContent = statLabel(vencedor);

    this.el.huntVictoryOthers.replaceChildren(
      ...resto.map((p) => {
        const linha = document.createElement("div");
        linha.className = "hv-other";
        if (p.id === selfId) linha.classList.add("eu");
        const nome = texto(p.name);
        nome.style.color = cor(p.color);
        linha.append(nome, texto(statLabel(p), "hv-other-count"));
        return linha;
      }),
    );

    const dicaEl = this.el.huntVictory.querySelector(".hv-hint span");
    if (dicaEl) dicaEl.textContent = hint;

    this.el.huntVictory.hidden = false;
  }

  /**
   * A mesma tela de vitória, para quando a horda 10 cai inteira.
   *
   * O que muda é só o que se conta: não porco abatido, mas zumbi — e, junto,
   * quantas vezes cada um caiu, porque numa horda essa dupla conta a história
   * inteira da noite (quem carregou o grupo e quem passou renascendo).
   */
  showZombieVictory(ranking, selfId = null) {
    const rotulo = (p) => {
      const k = p.kills ?? 0;
      const d = p.deaths ?? 0;
      return `${k} ${k === 1 ? "zumbi abatido" : "zumbis abatidos"} · ${d} ${d === 1 ? "morte" : "mortes"}`;
    };
    this.showHuntVictory(ranking, selfId, { title: "HORDAS SOBREVIVIDAS", statLabel: rotulo });
  }

  /**
   * Placar de vitória da série: alvos acertados e pontos (alvos longe valem mais).
   */
  showSeriesVictory(ranking, selfId = null) {
    const rotulo = (p) => {
      const a = p.targets ?? 0;
      const pts = p.points ?? 0;
      return `${a} ${a === 1 ? "alvo" : "alvos"} · ${pts} pts`;
    };
    this.showHuntVictory(ranking, selfId, {
      title: "SÉRIE CONCLUÍDA",
      statLabel: rotulo,
    });
  }

  /**
   * Placar da caça aos pássaros: quantas aves cada um abateu.
   * `reason === "special"` quando o vencedor derrubou a ave rara — a tela
   * deixa isso explícito no rótulo e na linha do vencedor.
   */
  showBirdVictory(ranking, selfId = null, reason = "count") {
    if (reason === "special") {
      const vencedorId = ranking[0]?.id;
      const rotulo = (p) => {
        const n = p.birds ?? 0;
        const aves = `${n} ${n === 1 ? "ave" : "aves"}`;
        if (p.id === vencedorId) return `matou a ave rara · ${aves}`;
        return aves;
      };
      this.showHuntVictory(ranking, selfId, {
        title: "AVE RARA ABATIDA",
        winnerLabel: "Matou a ave rara",
        statLabel: rotulo,
      });
      return;
    }
    const rotulo = (p) => {
      const n = p.birds ?? 0;
      return `${n} ${n === 1 ? "ave" : "aves"}`;
    };
    this.showHuntVictory(ranking, selfId, {
      title: "CAÇA CONCLUÍDA",
      winnerLabel: "Vencedor",
      statLabel: rotulo,
    });
  }

  /**
   * Vitória da caçada ao alce: flechas cravadas por jogador e quem deu o
   * golpe final. O vencedor em destaque é quem derrubou o bicho; o placar
   * lista as flechas de todos.
   */
  showElkVictory(ranking, selfId = null, finisherId = null) {
    const rotulo = (p) => {
      const h = p.elkHits ?? 0;
      const flechas = `${h} ${h === 1 ? "flecha" : "flechas"}`;
      if (p.id === finisherId || p.finisher) return `${flechas} · golpe final`;
      return flechas;
    };
    this.showHuntVictory(ranking, selfId, {
      title: "ALCE DERROTADO",
      winnerLabel: "Golpe final",
      statLabel: rotulo,
    });
  }

  /** Fecha a tela de vitória — pelo Enter (ver `confirmOverlay`) ou por um mundo novo. */
  hideHuntVictory() {
    this.el.huntVictory.hidden = true;
  }

  /** Zera a contabilidade local. Chamado quando a sala recomeça o mundo. */
  resetStats() {
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.el.score.textContent = "0";
    this.refreshStats();
  }

  refreshStats() {
    const avg = this.hits > 0 ? this.score / this.hits : 0;
    this.el.stats.textContent =
      `${this.hits} acertos / ${this.shots} tiros · média ${avg.toFixed(1)}`;
  }

  /**
   * O aviso de impacto: o que a flecha acertou e QUANTOS METROS ela percorreu.
   *
   * Vale igual em primeira e em terceira pessoa porque nasce do evento de
   * impacto, não da câmera — e é um por flecha, sempre.
   *
   * @param {{score?: number, label?: string|null, distance: number}} e
   */
  impact(e) {
    const parts = [];
    if (e.score > 0) {
      parts.push({ text: `+${e.score}`, className: "score" });
    } else if (e.hit) {
      // Acertou de verdade (porco, alce, pássaro, zumbi, personagem, alvo da
      // série), só sem pontuação decidida aqui — o placar chega depois, pelo
      // servidor. Sem este ramo, "errou" aparecia em cima de um acerto certeiro
      // só porque o `score` ainda não tinha número.
      parts.push({ text: `acertou · ${e.label}`, className: "score" });
    } else if (e.label) {
      parts.push({ text: `errou · ${e.label}`, className: "dim" });
    }
    parts.push({
      text: `${parts.length ? " · " : ""}${e.distance.toFixed(1)} m`,
      className: "distance",
    });
    this.toast(parts, e.score > 0 || e.hit ? "" : "miss");
  }

  /**
   * Uma notificação flutuante.
   *
   * Aceita texto puro ou uma lista de trechos `{text, className}`. Nenhum dos
   * dois caminhos usa `innerHTML`: os nós são montados e o conteúdo entra por
   * `textContent`. Não é zelo excessivo — nomes de jogadores vêm da rede e
   * passam por aqui, e com `innerHTML` um apelido viraria HTML executando na
   * tela de todo mundo.
   *
   * @param {string|Array<{text: string, className?: string}>} content
   */
  toast(content, extraClass = "") {
    const node = document.createElement("div");
    node.className = `toast ${extraClass}`.trim();
    const parts = Array.isArray(content) ? content : [{ text: content }];
    for (const part of parts) {
      const span = document.createElement("span");
      span.textContent = String(part.text ?? "");
      if (part.className) span.className = part.className;
      if (part.color != null) {
        span.style.color = `#${Number(part.color).toString(16).padStart(6, "0")}`;
      }
      node.appendChild(span);
    }
    this.el.toasts.appendChild(node);
    const life = extraClass.includes("series-hit") ? 2800 : 1650;
    setTimeout(() => node.remove(), life);
  }

  /** Abre e fecha o painel de atalhos; a pista de reabertura troca junto. */
  toggleHelp() {
    const fechado = this.el.help.classList.toggle("hidden");
    this.el.helpHint.hidden = !fechado;
  }

  /* ------------------------------------------------- menu de comandos ------ */

  get commandMenuOpen() {
    return !this.el.cmdMenu.hidden;
  }

  toggleCommandMenu() {
    if (this.commandMenuOpen) this.closeCommandMenu();
    else this.openCommandMenu();
  }

  openCommandMenu() {
    if (this.commandMenuOpen) return;
    this.el.cmdMenu.hidden = false;
    /* O aviso sai ANTES do primeiro quadro com o menu aberto: quem escuta é o
       `Input`, que solta o ponteiro do mouse. Sem isso o cursor continua
       capturado e nenhum botão pode ser clicado — o menu apareceria e seria
       impossível de usar. */
    this.onCommandMenuToggle?.(true);
  }

  closeCommandMenu() {
    if (!this.commandMenuOpen) return;
    this.el.cmdMenu.hidden = true;
    this.onCommandMenuToggle?.(false);
  }
}
