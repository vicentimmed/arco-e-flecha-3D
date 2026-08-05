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
const ATALHOS = [
  {
    titulo: "Mirar e atirar",
    itens: [
      [["Mouse"], "mirar"],
      [["Clique"], "segurar e soltar"],
      [["Dir.", "C"], "1ª pessoa"],
      [["F"], "câmera da flecha liga/desliga"],
    ],
  },
  {
    titulo: "Mover",
    itens: [
      [["W", "A", "S", "D"], "andar"],
      [["Shift"], "correr"],
      [["Space"], "pular"],
      [["K"], "renascer"],
    ],
  },
  {
    titulo: "Modos de jogo",
    itens: [
      [["1"], "livre"],
      [["2"], "duelo"],
      [["3"], "caçada aos porcos"],
      [["4"], "alvos em série"],
      [["5"], "caçada ao alce"],
      [["6"], "noite dos zumbis"],
    ],
  },
  {
    titulo: "Sala",
    itens: [
      // O Tab saiu: no navegador ele é a tecla de navegação e o foco escapava
      // para os controles do próprio navegador. Ver `systems/input.js`.
      [["0"], "placar"],
      [["Y"], "zerar placar"],
      [["P"], "soltar porco"],
      [["L"], "soltar alce"],
      [["O"], "lobos do alce (teste)"],
    ],
  },
  {
    titulo: "Ajustes",
    itens: [
      [["T"], "traçado"],
      [["V"], "vento"],
      [["M"], "música"],
      [["R"], "limpar flechas"],
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

      <!-- Onda nova da caçada. Some sozinha; ver announceWave(). Sem crases
           neste bloco: ele é um template literal, e uma crase o encerraria. -->
      <div id="wave-banner" hidden>
        <span id="wave-n"></span>
        <span id="wave-size"></span>
      </div>

      <!-- Modo zumbi: horda, zumbis restantes e vidas. Fica junto dos outros
           chips de situação, e não no meio da tela, porque é informação que se
           consulta de relance entre um tiro e outro. -->
      <div class="chip" id="zombie-chip" hidden>
        <span class="label">Horda</span><span class="value" id="zombie-horde">1</span>
        <span class="label">Zumbis</span><span class="value" id="zombie-left">0</span>
        <span class="label">Vidas</span><span class="value" id="zombie-lives">♥♥♥</span>
      </div>

      <!-- Renascimento e game over. Este SIM no meio da tela: o jogador está
           morto, não tem o que mirar, e a única coisa que importa é o número. -->
      <div id="zombie-center" hidden>
        <div id="zombie-center-title"></div>
        <div id="zombie-center-sub"></div>
      </div>

      <!-- Vitória da caçada: entra ao fechar a quinta onda (ver S2C.HUNT_OVER).
           Fica na tela até o Enter, por isso a dica mora dentro do próprio
           card — é a única tecla que a fecha, e ninguém adivinha sozinho. -->
      <div id="hunt-victory" hidden>
        <div class="hv-card">
          <div class="hv-title" id="hunt-victory-title">CAÇADA CONCLUÍDA</div>
          <div class="hv-winner">
            <span class="hv-winner-label">Vencedor</span>
            <span class="hv-winner-name"></span>
            <span class="hv-winner-count"></span>
          </div>
          <div class="hv-others"></div>
          <div class="hv-hint"><kbd>Enter</kbd><span>fecha esta tela</span></div>
        </div>
      </div>

      <div id="toasts"></div>

      <!-- Preenchido por montarAtalhos(), a partir da tabela ATALHOS. -->
      <div id="help" class="hidden"></div>

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
      zombieChip: root.querySelector("#zombie-chip"),
      zombieHorde: root.querySelector("#zombie-horde"),
      zombieLeft: root.querySelector("#zombie-left"),
      zombieLives: root.querySelector("#zombie-lives"),
      zombieCenter: root.querySelector("#zombie-center"),
      zombieCenterTitle: root.querySelector("#zombie-center-title"),
      zombieCenterSub: root.querySelector("#zombie-center-sub"),
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
    };

    this.el.help.appendChild(montarAtalhos());

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
  setWind(speed, relativeAngle) {
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
      return;
    }
    this.el.elkChip.hidden = false;
    this.el.elkBarFill.style.width = `${Math.max(0, Math.min(1, health)) * 100}%`;
    // Verde → âmbar → vermelho, igual à barra do bicho.
    this.el.elkBarFill.style.background = `hsl(${health * 118}deg 65% 50%)`;
    // Investindo: o aviso muda de texto e a peça pisca. É meio segundo de
    // antecedência, e é o que separa sair da frente de levar a cabeçada.
    const investindo = state === "charge";
    this.el.elkLabel.textContent = investindo ? "ALCE INVESTINDO" : "Alce";
    this.el.elkChip.classList.toggle("perigo", investindo);
  }

  /** Avisa quando a conexão cai — some sozinho quando ela volta. */
  setConnection(online) {
    this.el.netChip.hidden = online;
  }

  /**
   * Faixa do modo em curso e dos convites de duelo pendentes.
   *
   * O convite precisa ser visível e dizer o que fazer: uma tecla que só
   * funciona quando outra pessoa também aperta é invisível sem isto, e ninguém
   * descobriria o duelo sozinho.
   */
  setMode(mode, invites = [], needed = 2, selfId = null) {
    const banner = this.el.modeBanner;
    banner.replaceChildren();

    const pendente = mode !== "duel" && invites.length > 0;
    if (mode === "free" && !pendente) {
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

    banner.className = mode;
    banner.append(
      texto(
        {
          duel: "DUELO",
          boarHunt: "CAÇADA AOS PORCOS",
          series: "ALVOS EM SÉRIE",
          elkHunt: "CAÇADA AO ALCE",
          zombie: "NOITE DOS ZUMBIS",
        }[mode] ?? mode.toUpperCase(),
        "forte",
      ),
      texto("   1 para sair"),
    );
  }

  /* --------------------------------------------------------------- zumbis -- */

  /**
   * O painel do modo: horda, quantos zumbis faltam e as vidas.
   *
   * Os corações são desenhados como texto e não como imagem por um motivo
   * prático — eles precisam ser lidos de relance no meio de um cerco, e um
   * glifo grande e cheio contrasta melhor com o fundo escuro do chip do que
   * qualquer ícone pequeno.
   */
  setZombie(estado) {
    const chip = this.el.zombieChip;
    if (!estado) {
      chip.hidden = true;
      this.hideZombieCenter();
      return;
    }
    chip.hidden = false;
    this.el.zombieHorde.textContent = `${estado.horde} / ${estado.hordes}`;
    this.el.zombieLeft.textContent = String(estado.remaining);

    const vidas = Math.max(0, estado.lives ?? 0);
    const total = estado.maxLives ?? 3;
    this.el.zombieLives.textContent = "♥".repeat(vidas) + "♡".repeat(Math.max(0, total - vidas));
    this.el.zombieLives.classList.toggle("perigo", vidas <= 1);
  }

  /** Faixa central: contagem de renascimento ou fim de jogo. */
  showZombieCenter(titulo, sub = "", classe = "") {
    const el = this.el.zombieCenter;
    el.hidden = false;
    el.className = classe;
    this.el.zombieCenterTitle.textContent = titulo;
    this.el.zombieCenterSub.textContent = sub;
  }

  hideZombieCenter() {
    this.el.zombieCenter.hidden = true;
  }

  /** Faixa de horda nova — mesma mecânica da onda da caçada. */
  announceHorde(n, size) {
    const faixa = this.el.waveBanner;
    this.el.waveN.textContent = `HORDA ${n}`;
    this.el.waveSize.textContent = `${size} ${size === 1 ? "zumbi" : "zumbis"}`;
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
}
