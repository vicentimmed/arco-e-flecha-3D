/* ---------------------------------------------------------------------------
   A TELA DO FIM — a contagem, os metros que faltam e a seta do portal.

   *"Deve ter um indicativo no céu para o lugar que eles têm que voar para
   escapar do planeta e quantos metros faltam."*

   O indicativo NO CÉU é `world/fuga.js` (a coluna de luz e o anel). Isto aqui é
   a outra metade dele, a que o céu não consegue dizer:

     • QUANTO TEMPO falta — um número grande, no alto, impossível de não ver.
       É o único relógio do fim, e por isso ele é o maior objeto da tela.
     • QUANTOS METROS faltam — ao vivo, colado no marcador do portal.
     • PARA QUE LADO — uma seta na borda da tela quando ele está fora do quadro,
       porque uma coluna de luz atrás da nuca não indica coisa nenhuma.
     • A QUE ALTURA se está — a barra, do nível do mar à boca do portal. Desde
       que a fuga virou altitude pura, ela é a régua do desafio inteiro.

   Havia aqui uma barra de SUBIDA SUSTENTADA — "SUBINDO 27 / 30 s" —, e ela saiu
   com a regra que a alimentava. O pedido: *"a fuga é baseada somente em metros
   mesmo."* Uma barra que media esforço foi trocada por uma que mede progresso.

   -------------------------------------------------------------- por que aqui

   Ele é uma classe à parte e não mais um bloco de `ui/hud.js` por dois motivos,
   e o segundo é o que decide:

   1. O HUD tem 1 200 linhas e um caráter — placas inclinadas nos cantos, barras
      de BT3. Isto é uma tela de EMERGÊNCIA: ela toma o meio do quadro, muda de
      cor com o relógio e desaparece por inteiro no resto da partida.
   2. Ela vive e morre com uma fase que quase sempre não está acontecendo. Um
      bloco novo no HUD custaria trinta nós de DOM parados no documento durante
      99 % do tempo de jogo; aqui a raiz inteira sai da árvore quando a fase
      volta a `calmo`.

   O estilo é injetado por este arquivo, com prefixo `nkf-` — nem `nk-` (que é
   do HUD) nem nada do arqueiro. É a mesma disciplina de `ui/style.js` e pela
   mesma razão: um seletor daqui não pode pintar um pixel de outro jogo.

   ------------------------------------------------------------------- o custo
   Zero alocação em regime (§3): todo nó nasce no construtor, e todo valor
   escrito é comparado com o que já está na tela. Escrever `textContent` a 60 Hz
   num número que não mudou é pedir recálculo de layout por nada.
   --------------------------------------------------------------------------- */

import { NAMEK, clamp01 } from "../../shared/namek/config.js";

/** O id da tag de estilo. Único: duas instâncias não a injetam duas vezes. */
const ID_ESTILO = "nkf-estilo";
/** Quantas telas vivas dependem dela. Ver `aplicarEstiloFuga`. */
let vivos = 0;

/** s — abaixo disto a contagem fica vermelha e pulsa. Dez segundos são o que
 *  sobra para uma decisão: não dá para atravessar a arena, dá para subir. */
const AFLICAO = 10;

/* A elipse em que a seta da borda orbita, em `vw`/`vh`.
 *
 * A largura é a mesma dos pinos da bússola (`ui/hud.js`) e do marcador de rocha
 * do modo de meteoros — a mesma tela, a mesma margem para não ser cortado. A
 * ALTURA não é, e a diferença é medida: **o portal está quase sempre para
 * cima.** Ele fica a 2 400 m sobre o centro do mapa, e quem está voando a
 * quinhentos ou mil metros o vê a setenta e poucos graus de elevação — ou seja,
 * fora do quadro, pelo topo, durante quase todo o minuto final.
 *
 * Com os 38vh da bússola, a seta apontando para cima cai exatamente em cima da
 * contagem regressiva, que ocupa a faixa de 3 a 23vh. Vinte e quatro a põem logo
 * abaixo do painel — o número grande fica legível, e a seta continua na borda
 * para onde o jogador tem de virar. Uma seta que esconde o relógio é uma seta que
 * cobra o preço de ler a informação mais importante da tela. */
const RAIO_SETA_X = 42;
const RAIO_SETA_Y = 24;

/**
 * Um número com separador de milhar.
 *
 * "2 400 m" é lido de relance; "2400 m" não. O separador é um espaço FINO
 * (U+2009) e não uma vírgula ou um ponto: os dois têm significado decimal em
 * alguma convenção, e o jogo é jogado em português — um "2.400" lido como dois
 * vírgula quatro é a leitura errada no pior momento possível.
 *
 * Uma função de módulo porque duas coisas da tela a usam (a barra de altitude e
 * o marcador do portal), e elas TÊM de formatar igual: são o mesmo número medido
 * de dois jeitos, e vê-los escritos diferente faria o jogador procurar uma
 * diferença que não existe.
 */
function mil(v) {
  const n = Math.max(0, Math.round(v));
  if (n < 1000) return String(n);
  return `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")}`;
}

/**
 * Põe o estilo no documento (uma vez) e devolve como tirá-lo.
 * Mesma mecânica de `aplicarEstiloNamek`, e pelo mesmo motivo — a bancada de
 * desenvolvimento monta duas telas, e sair do modo tem de devolver o documento.
 */
export function aplicarEstiloFuga() {
  if (!document.getElementById(ID_ESTILO)) {
    const tag = document.createElement("style");
    tag.id = ID_ESTILO;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
  vivos++;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    if (--vivos > 0) return;
    document.getElementById(ID_ESTILO)?.remove();
  };
}

export class FugaHud {
  /** @param {HTMLElement} uiRoot o mesmo contêiner do HUD */
  constructor(uiRoot) {
    this._soltarEstilo = aplicarEstiloFuga();

    this.el = document.createElement("div");
    this.el.className = "nkf";
    this.el.hidden = true;

    /* ------------------------------------------------------- a contagem --- */
    this.painel = document.createElement("div");
    this.painel.className = "nkf-painel";

    this.rotulo = document.createElement("div");
    this.rotulo.className = "nkf-rotulo";
    this.rotulo.textContent = "O PLANETA VAI EXPLODIR";

    this.contagem = document.createElement("div");
    this.contagem.className = "nkf-contagem";
    this.contagem.textContent = "60";

    this.sub = document.createElement("div");
    this.sub.className = "nkf-sub";
    this.sub.textContent = "SUBA ATÉ O RASGO DE LUZ";

    /* ---------------------------------------------- a barra da ALTITUDE --- */
    /* Ela mede o desafio inteiro, porque o desafio inteiro é altura: do nível do
       mar até a boca do portal. O texto ("ALTITUDE 1 240 / 2 400 m") existe
       porque uma barra sozinha não diz de que grandeza ela fala — e aqui a
       grandeza é a única coisa que o jogador precisa saber para decidir se sobe
       ou se briga mais um pouco.

       Ela SUBSTITUIU uma barra de subida sustentada, que enchia com o tempo em
       que se estava com `vy` acima de um limiar. Aquela media esforço; esta mede
       progresso, que é o que o pedido pede — "somente metros mesmo". */
    this.barraEl = document.createElement("div");
    this.barraEl.className = "nkf-barra";
    // Esqueleto FIXO, sem uma única interpolação — mesma regra do HUD.
    this.barraEl.innerHTML = `<div class="nkf-barra-fill"></div><span class="nkf-barra-txt"></span>`;
    this.barraFill = this.barraEl.firstElementChild;
    this.barraTxt = this.barraEl.lastElementChild;

    this.painel.append(this.rotulo, this.contagem, this.sub, this.barraEl);

    /* ---------------------------------------------------- o marcador ------ */
    /* Duas formas no mesmo nó, como os pinos da bússola do HUD: LOSANGO quando o
       portal está na tela (ele já está ali, o marcador só o circula) e SETA
       girada na borda quando está fora — que é a única maneira de apontar para o
       que não está no quadro. */
    this.marca = document.createElement("div");
    this.marca.className = "nkf-marca";
    this.marca.innerHTML = `<i class="nkf-marca-seta">▲</i><div class="nkf-marca-anel"></div><span class="nkf-marca-d"></span>`;
    this.marcaSeta = this.marca.firstElementChild;
    this.marcaD = this.marca.lastElementChild;
    this.marca.hidden = true;

    /* ------------------------------------------------------- o clarão ----- */
    /* "Um clarão que toma a tela." Ele é um `div` branco por cima de tudo, e não
       um efeito de pós-processamento, porque é exatamente isto que ele precisa
       ser: uma folha de luz na frente do olho, sem custo de GPU nenhum, no
       instante em que a GPU está desenhando a maior coisa do modo. */
    this.clarao = document.createElement("div");
    this.clarao.className = "nkf-clarao";
    this.clarao.style.opacity = "0";

    this.el.append(this.painel, this.marca, this.clarao);
    (uiRoot ?? document.body).appendChild(this.el);

    /* ------------------------------------------------------- o escrito ---- */
    /* O que já está na tela. Toda escrita passa por uma destas comparações. */
    this._num = null;
    this._aflito = null;
    this._metros = null;
    this._pct = -1;
    this._alt = -1;
    this._fora = null;
    this._visivel = false;
    this._rotuloTxt = "";
    this._subTxt = "";

    /** 0..1 — o clarão em curso, e o quanto falta dele. */
    this._clarao = 0;
    this._claraoOp = -1;
    /** s — quanto do tempo de subida do clarão já passou (ver `explodiu`). */
    this._claraoSobe = 0;
  }

  /* ================================================================ escrita = */

  /**
   * O quadro inteiro da tela do fim, num objeto só.
   *
   * @param {object} e
   * @param {boolean} e.ativo mostra ou esconde tudo
   * @param {number} e.segundos o que falta para a explosão
   * @param {number} e.metros quanto falta até a boca do portal, em linha reta
   * @param {number} e.fracao 0..1 da altura já vencida
   * @param {number} e.altitude m — a que altura eu estou agora
   * @param {number} e.altitudeAlvo m — a altura da boca do portal
   * @param {boolean} e.escapou eu já estou no espaço
   * @param {string} [e.rotulo] a linha de cima
   * @param {string} [e.sub] a linha de baixo
   */
  set(e) {
    const ativo = e?.ativo === true;
    if (ativo !== this._visivel) {
      this._visivel = ativo;
      this.el.hidden = !ativo;
      this.painel.hidden = !ativo;
    }
    if (!ativo) {
      if (!this.marca.hidden) this.marca.hidden = true;
      /* O clarão SOBREVIVE ao painel: ele continua apagando depois de a fase
         acabar, e escondê-lo junto cortaria a explosão pela metade. */
      if (this._clarao > 0) this.el.hidden = false;
      return;
    }

    if (e.rotulo !== undefined && e.rotulo !== this._rotuloTxt) {
      this._rotuloTxt = e.rotulo;
      this.rotulo.textContent = e.rotulo;
    }
    if (e.sub !== undefined && e.sub !== this._subTxt) {
      this._subTxt = e.sub;
      this.sub.textContent = e.sub;
    }

    /* ARREDONDA PARA CIMA, como a contagem de renascimento do HUD e pelo mesmo
       motivo: enquanto sobrar meio segundo a tela diz "1", e uma contagem que
       passa por zero e fica lá esperando parece travada. */
    const n = Math.max(0, Math.ceil(e.segundos ?? 0));
    if (n !== this._num) {
      this._num = n;
      this.contagem.textContent = String(n);
    }
    const aflito = n <= AFLICAO;
    if (aflito !== this._aflito) {
      this._aflito = aflito;
      this.contagem.classList.toggle("nkf-aflito", aflito);
    }

    /* A BARRA DA ALTITUDE. Some depois de escapar: ela já cumpriu o que tinha a
       dizer, e uma barra cheia parada na tela é ruído. */
    const escapou = e.escapou === true;
    this.barraEl.hidden = escapou;
    if (!escapou) {
      const pct = Math.round(clamp01(e.fracao ?? 0) * 100);
      if (pct !== this._pct) {
        this._pct = pct;
        this.barraFill.style.width = `${pct}%`;
        this.barraEl.classList.toggle("nkf-barra--cheia", pct >= 100);
      }
      /* Em degraus de 10 m: a altitude muda sessenta vezes por segundo enquanto
         se sobe a 64 m/s, e escrever cada metro seria um recálculo de layout por
         quadro para mexer no dígito que ninguém lê. Dez metros são um décimo do
         que se sobe em dois segundos — o número continua vivo e o DOM descansa. */
      const alt = Math.round((e.altitude ?? 0) / 10) * 10;
      if (alt !== this._alt) {
        this._alt = alt;
        const alvo = Math.round(e.altitudeAlvo ?? NAMEK.fim.fuga.altitude);
        this.barraTxt.textContent = `ALTITUDE ${mil(alt)} / ${mil(alvo)} m`;
      }
    }
  }

  /**
   * O marcador do portal.
   *
   * **A convenção do ângulo é a da bússola do HUD**, e ser a mesma não é
   * arrumação: é `atan2(y, x)` no ESPAÇO DA CÂMERA — 0 à direita, crescendo no
   * sentido anti-horário —, e `NamekGame.bussola` documenta em vinte linhas por
   * que ele não pode sair do NDC (a projeção divide por −z, e um alvo perto do
   * plano da lente devolve rumos absurdos). O portal cai exatamente nesse caso
   * o tempo todo: ele está SEMPRE a noventa graus de quem está voando rente ao
   * chão do outro lado da arena.
   *
   * @param {number|null} angulo rad — `null` = está na tela, e aí valem `x`/`y`.
   *   `undefined` esconde o marcador.
   * @param {number} x −1..1 em NDC
   * @param {number} y −1..1 em NDC
   * @param {number} metros o que aparece embaixo do marcador
   */
  setMarca(angulo, x, y, metros) {
    if (angulo === undefined) {
      if (!this.marca.hidden) this.marca.hidden = true;
      return;
    }
    if (this.marca.hidden) this.marca.hidden = false;

    const fora = angulo !== null;
    if (fora !== this._fora) {
      this._fora = fora;
      this.marca.classList.toggle("fora", fora);
    }

    if (fora) {
      /* Elipse inscrita na tela, com os mesmos 42/38 dos pinos do HUD: a seta
         encosta na borda mais próxima daquele rumo em vez de andar num círculo
         que sobra nos cantos. Mesma tela, mesma margem. */
      const px = Math.cos(angulo) * RAIO_SETA_X;
      const py = -Math.sin(angulo) * RAIO_SETA_Y;
      this.marca.style.transform = `translate(-50%, -50%) translate(${px.toFixed(2)}vw, ${py.toFixed(2)}vh)`;
      /* A SETA gira; o número, não. Ninguém lê "1 480 m" de cabeça para baixo —
         é a mesma razão pela qual a rotação mora na seta na bússola também. */
      this.marcaSeta.style.transform = `rotate(${(90 - (angulo * 180) / Math.PI).toFixed(1)}deg)`;
    } else {
      this.marca.style.transform = `translate(-50%, -50%) translate(${(x * 50).toFixed(2)}vw, ${(-y * 50).toFixed(2)}vh)`;
      this.marcaSeta.style.transform = "rotate(0deg)";
    }

    const m = Math.max(0, Math.round(metros ?? 0));
    if (m !== this._metros) {
      this._metros = m;
      this.marcaD.textContent = `${mil(m)} m`;
    }
  }

  /**
   * O PLANETA EXPLODIU: o clarão toma a tela.
   *
   * Duração dos dois lados em `NAMEK.fim.explosao.clarao` — entra num piscar e
   * sai devagar, porque o que ele imita é a retina e não uma transição.
   */
  explodiu() {
    this._clarao = 1;
    this._claraoSobe = 0;
    this.el.hidden = false;
  }

  /* --------------------------------------------------------------- quadro -- */

  update(dt) {
    if (this._clarao <= 0) return;
    const [sobe, desce] = NAMEK.fim.explosao.clarao;

    let op;
    if (this._claraoSobe < sobe) {
      this._claraoSobe += dt;
      op = clamp01(this._claraoSobe / Math.max(0.01, sobe));
    } else {
      this._clarao = Math.max(0, this._clarao - dt / Math.max(0.01, desce));
      /* Ao quadrado na saída: o branco cai rápido no começo e demora a soltar o
         último véu, que é como um olho ofuscado volta ao normal. */
      op = this._clarao * this._clarao;
    }

    const escrito = Math.round(op * 100) / 100;
    if (escrito !== this._claraoOp) {
      this._claraoOp = escrito;
      this.clarao.style.opacity = String(escrito);
    }
    if (this._clarao <= 0 && !this._visivel) this.el.hidden = true;
  }

  dispose() {
    this.el.remove();
    this._soltarEstilo?.();
    this._soltarEstilo = null;
  }
}

/* ------------------------------------------------------------------- o CSS --

   Tudo com prefixo `nkf-`, tudo desenhado por código, nenhuma fonte externa e
   nenhuma imagem (§3 do plano: zero texturas, e isso vale para a interface).

   A paleta é a do perigo — âmbar virando vermelho —, e ela é deliberadamente a
   ÚNICA coisa quente do HUD: as placas de vida e ki do `ui/style.js` vivem no
   ouro e no azul, então a tela do fim não disputa espaço com elas por cor. O
   marcador do portal é a exceção fria (ciano), e tem de ser: ele aponta para a
   saída, e a saída não é o perigo. */
const CSS = `
.nkf {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 30;
  font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  --nkf-brasa: #ff8a2b;
  --nkf-sangue: #ff3b2f;
  --nkf-gelo: #9ff6ff;
}
.nkf[hidden] { display: none; }

/* ------------------------------------------------------------ o painel --- */
.nkf-painel {
  position: absolute;
  /* 3,4vh e não 4,2: o painel inteiro (rótulo + número + linha + barra) mede
     ~20vh, e a seta do portal orbita a 24vh do centro — ver \`RAIO_SETA_Y\`. Os
     três quartos de ponto que se ganha aqui são a folga entre a barra da subida
     e a seta apontando para cima, que é a posição mais comum dela. */
  top: 3.4vh;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15em;
  text-align: center;
}
.nkf-painel[hidden] { display: none; }

.nkf-rotulo {
  font-size: clamp(11px, 1.5vh, 18px);
  letter-spacing: 0.26em;
  font-weight: 700;
  color: var(--nkf-brasa);
  text-shadow: 0 2px 0 #000, 0 0 14px rgba(255, 138, 43, 0.55);
}

/* O NÚMERO. Ele é grande porque o pedido pede que seja — "contagem GRANDE e
   visível na tela de todos" — e porque ele é a única informação da tela que vale
   mais que a briga em curso. Tabular para os dígitos não dançarem de largura a
   cada segundo, que é o defeito clássico de um cronômetro em fonte proporcional. */
.nkf-contagem {
  font-size: clamp(56px, 13vh, 150px);
  line-height: 0.92;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #fff3e0;
  text-shadow:
    0 0 2px #000, 0 4px 0 #000, 0 0 26px rgba(255, 138, 43, 0.75),
    0 0 60px rgba(255, 60, 30, 0.4);
}
/* Os dez segundos finais: vermelho e pulsando. A troca de cor é o aviso; o
   pulso é o que faz o olho voltar para cá sem que ninguém peça. */
.nkf-contagem.nkf-aflito {
  color: #fff;
  text-shadow:
    0 0 2px #000, 0 4px 0 #000, 0 0 30px rgba(255, 59, 47, 0.95),
    0 0 80px rgba(255, 59, 47, 0.6);
  animation: nkf-bater 1s ease-in-out infinite;
}
@keyframes nkf-bater {
  0%, 100% { transform: scale(1); }
  12% { transform: scale(1.13); }
  30% { transform: scale(1); }
}

.nkf-sub {
  font-size: clamp(10px, 1.3vh, 15px);
  letter-spacing: 0.2em;
  color: #ffe9cc;
  opacity: 0.85;
  text-shadow: 0 2px 0 #000;
}

/* ------------------------------------------------------------- a barra --- */
.nkf-barra {
  position: relative;
  margin-top: 0.5em;
  width: min(42vw, 380px);
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.85);
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(10, 16, 26, 0.9), rgba(4, 8, 14, 0.9));
  box-shadow: 0 0 0 1px rgba(159, 246, 255, 0.25), 0 2px 8px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.nkf-barra[hidden] { display: none; }
.nkf-barra-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #2b6f8a, var(--nkf-gelo));
  box-shadow: 0 0 12px rgba(159, 246, 255, 0.7);
  /* Curta de propósito: a barra tem de responder ao dedo do jogador. Uma
     transição longa aqui mentiria sobre quando ele parou de subir. */
  transition: width 0.12s linear;
}
.nkf-barra--cheia .nkf-barra-fill {
  background: linear-gradient(90deg, #6fe8b0, #d8fff0);
  animation: nkf-cheia 0.7s ease-in-out infinite;
}
@keyframes nkf-cheia {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.5); }
}
.nkf-barra-txt {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #eaf9ff;
  text-shadow: 0 1px 2px #000, 0 0 6px #000;
}

/* ----------------------------------------------------------- o marcador -- */
/* Ancorado no CENTRO da tela: os \`translate\` de \`setMarca\` são deslocamentos a
   partir dele, na tela e na borda — a mesma montagem dos pinos da bússola. */
.nkf-marca {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  color: var(--nkf-gelo);
}
.nkf-marca[hidden] { display: none; }

/* Na tela: um LOSANGO vazado em volta da boca do portal. Vazado porque o que
   importa é o que está dentro dele. */
.nkf-marca-anel {
  width: 46px;
  height: 46px;
  border: 3px solid currentColor;
  border-radius: 4px;
  transform: rotate(45deg);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.8), 0 0 18px rgba(159, 246, 255, 0.8);
  animation: nkf-respira 1.8s ease-in-out infinite;
}
@keyframes nkf-respira {
  0%, 100% { transform: rotate(45deg) scale(1); opacity: 0.95; }
  50% { transform: rotate(45deg) scale(1.14); opacity: 0.6; }
}
.nkf-marca-seta {
  display: none;
  font-style: normal;
  font-size: 30px;
  line-height: 1;
  text-shadow: 0 0 3px #000, 0 0 16px rgba(159, 246, 255, 0.9);
}
.nkf-marca.fora .nkf-marca-anel { display: none; }
.nkf-marca.fora .nkf-marca-seta { display: block; }

.nkf-marca-d {
  position: absolute;
  top: 100%;
  margin-top: 4px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: #eaf9ff;
  text-shadow: 0 2px 0 #000, 0 0 10px rgba(0, 0, 0, 0.9);
}

/* ------------------------------------------------------------- o clarão -- */
.nkf-clarao {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 55%, #fff 0%, #fff6e2 45%, #ffd9a0 100%);
  opacity: 0;
  /* Sem transição de CSS: quem controla a curva é o \`update\`, porque a subida e
     a descida têm tempos diferentes e vêm do config. */
}
`;
