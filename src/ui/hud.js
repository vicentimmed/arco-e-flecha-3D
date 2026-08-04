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
      [["Q"], "trocar de alvo"],
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
    ],
  },
  {
    titulo: "Sala",
    itens: [
      [["Tab"], "placar"],
      [["Y"], "zerar placar"],
      [["P"], "soltar porco"],
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
      <div class="chip" id="target-chip">
        <span class="label">Alvo</span><span class="value" id="target-dist">—</span>
      </div>
      <div class="chip" id="boar-chip">
        <span class="label">Porcos</span>
        <span class="value" id="boar-count">0 vivos / 0 mortos</span>
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

      <div id="toasts"></div>

      <!-- Preenchido por montarAtalhos(), a partir da tabela ATALHOS. -->
      <div id="help"></div>

      <!-- Com o painel fechado, esta é a única pista de como reabri-lo. -->
      <div id="help-hint" hidden><kbd>F1</kbd><span>atalhos</span></div>

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
      targetDist: root.querySelector("#target-dist"),
      boarCount: root.querySelector("#boar-count"),
      netChip: root.querySelector("#net-chip"),
      modeBanner: root.querySelector("#mode-banner"),
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

  setTarget(index, distance) {
    this.el.targetDist.textContent =
      index === null ? "—" : `#${index + 1} · ${distance.toFixed(0)} m`;
  }

  setBoarCounts(alive, dead) {
    this.el.boarCount.textContent = `${alive} vivos / ${dead} mortos`;
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
        { duel: "DUELO", boarHunt: "CAÇADA AOS PORCOS", series: "ALVOS EM SÉRIE" }[mode] ??
          mode.toUpperCase(),
        "forte",
      ),
      texto("   1 para sair"),
    );
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
    } else if (e.label) {
      parts.push({ text: `errou · ${e.label}`, className: "dim" });
    }
    parts.push({
      text: `${parts.length ? " · " : ""}${e.distance.toFixed(1)} m`,
      className: "distance",
    });
    this.toast(parts, e.score > 0 ? "" : "miss");
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
      node.appendChild(span);
    }
    this.el.toasts.appendChild(node);
    setTimeout(() => node.remove(), 1650);
  }

  /** Abre e fecha o painel de atalhos; a pista de reabertura troca junto. */
  toggleHelp() {
    const fechado = this.el.help.classList.toggle("hidden");
    this.el.helpHint.hidden = !fechado;
  }
}
