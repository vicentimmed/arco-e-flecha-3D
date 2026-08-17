/* ---------------------------------------------------------------------------
   A BARRA DO BOSS — a vida do Freeza, no topo da tela, para todo mundo.

   "É possível ver a vida do boss Freeza." O pedido é uma frase e o que ela
   exige é o contrário de um detalhe: numa luta em que a barra desce 0,08 % por
   bola de ki, a barra É a partida. Ela responde às três perguntas que o jogador
   faz o tempo todo — *estamos ganhando?*, *o meu golpe fez alguma coisa?*,
   *falta muito?* — e nenhuma delas tem outra fonte na tela.

   ------------------------------------------------------------------ o desenho

   Ela é a barra de vida do HUD (`ui/style.js`) crescida e mudada de lugar:
   inclinada pelo mesmo `--nk-skew`, com o mesmo contorno preto grosso, o mesmo
   verniz e a mesma régua de gomos. Isso não é economia — é o que faz o jogador
   ler as duas como a mesma linguagem. O que muda é o que TEM de mudar:

   • **Fica no topo e no meio**, e não num canto. É o lugar que o gênero
     inteiro reservou para "a coisa contra a qual todos estão lutando", e um
     canto a poria em competição com a placa do próprio jogador.
   • **É larga** (até 62 % da tela). Uma barra de 300 px com onze mil pontos de
     vida move um pixel a cada trinta e sete pontos; a mesma barra com 900 px
     move um a cada doze. A largura aqui não é ênfase, é RESOLUÇÃO.
   • **Tem barra FANTASMA.** O vermelho claro atrás do verde é onde a vida
     estava um instante atrás, e ele desce devagar. É como uma Genki Dama que
     tira 1 200 de uma vez consegue ser VISTA: sem o fantasma, o corte
     acontece entre dois quadros e a única diferença é a barra estar mais curta
     depois — o jogador não vê o golpe, vê o resultado dele.
   • **Tem a barra de KI dele**, fina, por baixo. Ela existe porque o pedido é
     explícito sobre o ki do boss demorar a gastar, e uma economia que não
     aparece é uma economia que ninguém acredita que exista.

   ------------------------------------------------------------------ o estilo

   Injetado por este arquivo, num `<style>` PRÓPRIO, e não acrescentado ao
   `style.js`: aquele arquivo é do HUD e tem dono, e a regra do §0 do plano vale
   dentro do modo também — o boss é uma peça opcional que entra e sai, e o
   estilo dela tem de entrar e sair junto. O prefixo continua sendo `nk-`
   (`nk-boss-*`), que é o que garante que nada daqui pinta um pixel do vale.

   Os TOKENS (`--nk-tinta`, `--nk-traco`, `--nk-skew`…) são herdados: a barra é
   montada dentro do elemento `.nk-hud`, que é onde eles vivem. Redeclará-los
   aqui seria a paleta do modo em duas versões que envelhecem separadas.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";

/** Id da tag de estilo. Único: duas instâncias não a injetam duas vezes. */
const ID = "nk-boss-estilo";

/* ----------------------------------------------------------------- a paleta

   TODA a família de roxos desta barra sai de `NAMEK.freeza.cor`, e nenhuma é
   escrita à mão. O motivo é o mesmo que levou a cor para o config: desde que o
   HUD passou a marcar o boss na tela, o roxo dele virou a identidade do chefe em
   quatro lugares que não se conhecem — o corpo, a aura, os poderes e esta barra.
   Escrito à mão em cada um, ele envelheceria em quatro metades.

   As três variações abaixo são as que uma barra precisa e que a cor pura não
   entrega: o NOME tem de ser claro para sobreviver ao contorno preto, o
   preenchimento do ki quer um degradê (escuro → cor → claro) para ter volume, e
   o cartaz quer o tom mais claro de todos porque é texto grande sobre céu. */
/**
 * Uma variação da cor dele, **em HSL** — luminosidade nova, matiz intacta.
 *
 * Misturar com branco seria mais curto e daria tons LAVADOS: clarear
 * `#c21ad8` por interpolação linear até 60 % devolve `#e7a3ef`, um lilás
 * acinzentado. Este HUD é escrito contra o céu de Namekusei e contra explosões
 * brancas, e a metade da legibilidade dele vem de a cor ser saturada — um
 * magenta pastel some no primeiro Kamehameha. Mexendo só no `L` (e podendo
 * forçar o `S`), o roxo continua sendo o mesmo roxo em qualquer claridade.
 *
 * @param {number} luz luminosidade final, 0…1
 * @param {number} [sat] saturação final, 0…1; omitida, mantém a original
 */
function tom(cor, luz, sat) {
  const n = cor >>> 0;
  const r = (n >> 16 & 255) / 255;
  const g = (n >> 8 & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let sAtual = 0;
  if (max !== min) {
    const d = max - min;
    sAtual = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const S = sat === undefined ? sAtual : sat;
  const q = luz < 0.5 ? luz * (1 + S) : luz + S - luz * S;
  const pp = 2 * luz - q;
  const canal = (t) => {
    let v = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (v < 1 / 6) v = pp + (q - pp) * 6 * v;
    else if (v < 1 / 2) v = q;
    else if (v < 2 / 3) v = pp + (q - pp) * (2 / 3 - v) * 6;
    else v = pp;
    return Math.round(v * 255);
  };
  const hex = (canal(h + 1 / 3) << 16) | (canal(h) << 8) | canal(h - 1 / 3);
  return `#${(hex >>> 0).toString(16).padStart(6, "0")}`;
}

/* A cor PURA, sem passar por `tom`: a ida e volta por HSL erra dois de 255 em
   dois canais (devolvia `#c01ad6` no lugar de `#c21ad8`), e este é o único tom
   da família que precisa ser exatamente o mesmo número que o corpo, a aura e o
   marcador usam. Os outros são variações e podem arredondar. */
const ROXO = `#${(NAMEK.freeza.cor >>> 0).toString(16).padStart(6, "0")}`;
/** O nome no topo: claro o bastante para o contorno preto não o engolir. */
const ROXO_NOME = tom(NAMEK.freeza.cor, 0.78, 0.82);
/** O cartaz "FREEZA CHEGOU": o mais claro da família, e o mais saturado —
 *  é texto grande sobre céu aberto. */
const ROXO_CARTAZ = tom(NAMEK.freeza.cor, 0.86, 0.95);
/** As duas pontas do degradê do ki: o fundo escuro e o brilho de neon. */
const ROXO_FUNDO = tom(NAMEK.freeza.cor, 0.26);
const ROXO_BRILHO = tom(NAMEK.freeza.cor, 0.74, 1);

/* Quantas barras vivas dependem da tag. Mesma contagem de `aplicarEstiloNamek`,
   e pelo mesmo motivo: `dispose()` não pode arrancar o estilo enquanto outra
   instância ainda estiver na tela, e não pode deixá-lo para sempre. */
let vivos = 0;

function aplicarEstilo() {
  if (!document.getElementById(ID)) {
    const tag = document.createElement("style");
    tag.id = ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
  vivos++;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    if (--vivos > 0) return;
    document.getElementById(ID)?.remove();
  };
}

/* s — quanto a barra FANTASMA leva para alcançar a de verdade, e o atraso antes
 * de ela começar a andar.
 *
 * 0,45 s de espera é o tempo de o olho ir do impacto até o topo da tela; 1,6 de
 * constante de perseguição faz o trecho vermelho encolher em pouco mais de meio
 * segundo. Mais lento que isso e dois golpes seguidos empilham fantasmas que
 * nunca alcançam; mais rápido e ele deixa de contar a história. */
const FANTASMA_ESPERA = 0.45;
const FANTASMA_VEL = 1.6;

/** 1/s — perseguição da barra VERDE. Ela também não salta: uma barra que anda
 *  em degraus de 10 % a cada `FREEZA_HURT` pisca. */
const VIDA_VEL = 9;
/** 1/s — a mesma coisa para o ki, mais mansa: ele muda devagar por natureza. */
const KI_VEL = 5;

/** s — quanto o cartão de entrada ("FREEZA CHEGOU") fica na tela. */
const ENTRADA = 3.4;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A barra do boss.
 *
 * Ela é MUDA por padrão: nasce escondida e só aparece quando `entrar()` é
 * chamada. Uma partida sem boss não paga um único nó de DOM a mais — a árvore
 * inteira é montada no construtor (não há criação em jogo, §3 do plano) e fica
 * com `hidden`, que o navegador não desenha nem mede.
 */
export class BossBar {
  /**
   * @param {HTMLElement} raiz o elemento do HUD (`.nk-hud`). É de lá que vêm os
   *   tokens de cor e a fonte — ver "o estilo" no cabeçalho.
   */
  constructor(raiz) {
    this.raiz = raiz;
    this._soltarEstilo = aplicarEstilo();

    this.el = document.createElement("div");
    this.el.className = "nk-boss";
    this.el.hidden = true;

    /* O ESQUELETO INTEIRO de uma vez, e sem uma interpolação sequer: o que muda
       em jogo é `style.width`, `textContent` e uma classe. Montar por
       `innerHTML` a cada atualização recriaria seis nós por quadro. */
    this.el.innerHTML = `
      <div class="nk-boss-titulo">
        <span class="nk-boss-nome nk-contorno"></span>
        <span class="nk-boss-nivel nk-contorno"></span>
      </div>
      <div class="nk-boss-barra">
        <div class="nk-boss-fantasma"></div>
        <div class="nk-boss-fill"></div>
        <div class="nk-boss-verniz"></div>
        <div class="nk-boss-regua"></div>
      </div>
      <div class="nk-boss-rodape">
        <div class="nk-boss-ki"><div class="nk-boss-ki-fill"></div></div>
        <span class="nk-boss-num nk-contorno"></span>
        <span class="nk-boss-pct nk-contorno"></span>
      </div>
      <div class="nk-boss-cartaz nk-contorno"></div>`;

    this.nomeEl = this.el.querySelector(".nk-boss-nome");
    this.nivelEl = this.el.querySelector(".nk-boss-nivel");
    this.barraEl = this.el.querySelector(".nk-boss-barra");
    this.fantasmaEl = this.el.querySelector(".nk-boss-fantasma");
    this.fillEl = this.el.querySelector(".nk-boss-fill");
    this.kiEl = this.el.querySelector(".nk-boss-ki-fill");
    this.numEl = this.el.querySelector(".nk-boss-num");
    this.pctEl = this.el.querySelector(".nk-boss-pct");
    this.cartazEl = this.el.querySelector(".nk-boss-cartaz");

    raiz.appendChild(this.el);

    /* --------------------------------------------------------- o estado ---
       Três pares (alvo, mostrado) porque tudo aqui PERSEGUE em vez de saltar.
       Ver as constantes lá em cima para a razão de cada velocidade. */
    this.vida = 1;
    this.vidaMostrada = 1;
    this.fantasma = 1;
    this.fantasmaEm = 0;
    this.ki = 1;
    this.kiMostrado = 1;
    this.vidaMax = 1;
    this.aberto = false;
    this._cartaz = 0;
    /** Fração da última leitura escrita no DOM. Evita escrever a mesma largura
     *  sessenta vezes por segundo — cada escrita de `style.width` é um
     *  recálculo de layout, e são quatro elementos. */
    this._escrito = { vida: -1, fantasma: -1, ki: -1, num: -1, pct: -1 };
  }

  /* ------------------------------------------------------------- a entrada */

  /**
   * O boss entrou. `vida`/`vidaMax` chegam prontos do servidor — ver
   * `NS2C.FREEZA_IN` para por que `vidaMax` viaja em vez de ser derivado.
   *
   * @param {{nome:string, dificuldade:string, vida:number, vidaMax:number}} info
   * @param {string} [nivelNome] o rótulo legível da dificuldade
   */
  entrar(info, nivelNome = "") {
    this.vidaMax = Math.max(1, info?.vidaMax ?? 1);
    const f = clamp01((info?.vida ?? this.vidaMax) / this.vidaMax);
    this.vida = f;
    this.ki = 1;
    /* A barra ENCHE na entrada em vez de aparecer cheia: os dois primeiros
       segundos são de invulnerabilidade (ver `ENTRADA_INVULN` na sala), e a
       barra subindo é o que diz que a luta ainda não começou. */
    this.vidaMostrada = 0;
    this.fantasma = 0;
    this.kiMostrado = 0;
    this.fantasmaEm = 0;
    this.nomeEl.textContent = (info?.nome ?? "Freeza").toUpperCase();
    this.nivelEl.textContent = nivelNome;
    this.cartazEl.textContent = `${(info?.nome ?? "Freeza").toUpperCase()} CHEGOU`;
    this._cartaz = ENTRADA;
    this.cartazEl.style.opacity = "1";
    this.aberto = true;
    this.el.hidden = false;
    this.el.classList.remove("nk-boss-caiu");
    this._escrito.vida = -1;
  }

  /** A vida mudou. Vem do `NS2C.FREEZA_HURT`, a 8 Hz. */
  setVida(vida, vidaMax) {
    if (Number.isFinite(vidaMax) && vidaMax > 0) this.vidaMax = vidaMax;
    this.vida = clamp01(vida / this.vidaMax);
    /* O FANTASMA só espera quando a vida DESCE. Subindo (o boss mudou de
       dificuldade, alguém entrou na sala e a vida máxima cresceu), ele
       acompanha na hora — um rastro vermelho para uma barra que aumentou não
       descreve nada. */
    if (this.vida < this.fantasma) this.fantasmaEm = FANTASMA_ESPERA;
    else this.fantasma = this.vida;
  }

  /** O ki dele, em fração. Vem na pose (`FREEZA_STATE.k`), 20 Hz. */
  setKi(fracao) {
    this.ki = clamp01(fracao);
  }

  /** Ele caiu. A barra fica um instante zerada e some — ver `update`. */
  cair() {
    if (!this.aberto) return;
    this.vida = 0;
    this.fantasma = 0;
    this.fantasmaEm = 0;
    this.cartazEl.textContent = `${this.nomeEl.textContent} CAIU`;
    this._cartaz = ENTRADA;
    this.el.classList.add("nk-boss-caiu");
    this.aberto = false;
  }

  /** Sumiu sem morrer (a sala esvaziou, a luta foi cancelada). */
  sair() {
    this.aberto = false;
    this._cartaz = 0;
    this.el.hidden = true;
    this.el.classList.remove("nk-boss-caiu");
  }

  /* ---------------------------------------------------------------- quadro */

  update(dt) {
    if (this.el.hidden) return;

    /* As três perseguições. `1 − exp(−k·dt)` e não `k·dt` porque o passo varia:
       um quadro de 50 ms e três de 16 ms têm de chegar ao mesmo lugar, senão a
       barra desce mais depressa em quem tem a máquina pior. */
    this.vidaMostrada += (this.vida - this.vidaMostrada) * (1 - Math.exp(-VIDA_VEL * dt));
    this.kiMostrado += (this.ki - this.kiMostrado) * (1 - Math.exp(-KI_VEL * dt));
    if (this.fantasmaEm > 0) this.fantasmaEm -= dt;
    else if (this.fantasma > this.vidaMostrada) {
      this.fantasma += (this.vidaMostrada - this.fantasma) * (1 - Math.exp(-FANTASMA_VEL * dt));
    } else {
      this.fantasma = this.vidaMostrada;
    }

    this.escrever();

    if (this._cartaz > 0) {
      this._cartaz -= dt;
      /* O cartaz some no último segundo. Uma transição CSS não serviria: ele é
         reaproveitado (entrada e queda usam o mesmo nó) e uma transição
         pendente do uso anterior faria o segundo aparecer já apagando. */
      this.cartazEl.style.opacity = String(clamp01(this._cartaz));
      if (this._cartaz <= 0) this.cartazEl.style.opacity = "0";
    }

    /* Morto e com a barra já vazia na tela: a peça sai. O atraso é de
       propósito — ver a barra chegar a zero é metade da recompensa. */
    if (!this.aberto && this.vidaMostrada < 0.004 && this._cartaz <= 0) {
      this.el.hidden = true;
    }
  }

  /** Escreve no DOM só o que mudou o bastante para valer um pixel. */
  escrever() {
    const e = this._escrito;
    const v = Math.round(this.vidaMostrada * 1000) / 1000;
    if (v !== e.vida) {
      e.vida = v;
      this.fillEl.style.width = `${v * 100}%`;
      /* A cor VIRA com a vida: verde → âmbar → vermelho, pela matiz. O mesmo
         truque de `--nk-hue` da barra do jogador, e ele existe para a barra
         dizer "está acabando" sem um número que ninguém lê no meio da briga. */
      this.barraEl.style.setProperty("--nk-hue", String(Math.round(112 * v * v)));
      this.barraEl.classList.toggle("nk-boss-critico", v > 0 && v < 0.2);
    }
    const g = Math.round(this.fantasma * 1000) / 1000;
    if (g !== e.fantasma) {
      e.fantasma = g;
      this.fantasmaEl.style.width = `${g * 100}%`;
    }
    const k = Math.round(this.kiMostrado * 100) / 100;
    if (k !== e.ki) {
      e.ki = k;
      this.kiEl.style.width = `${k * 100}%`;
    }
    /* ================================================ O NÚMERO E A PORCENTAGEM
     *
     * **Os DOIS**, lado a lado: `10.903 · 43 %`. Não é indecisão — cada um
     * responde a uma pergunta que o outro não responde, e a barra é o único
     * lugar da tela onde as duas são feitas.
     *
     * • O NÚMERO diz a ESCALA. Dez mil de vida ao lado de uma placa de jogador
     *   que vai até 100 é a frase "isto não é um jogador" dita sem palavras, e
     *   ela é metade do que faz um chefe parecer um chefe. Ele também é o único
     *   que gradua o golpe: uma Genki Dama tira 2 800 e isso se LÊ; em
     *   porcentagem seriam "27 %", que é um número que não quer dizer nada
     *   sobre o golpe, só sobre o que sobrou.
     *
     * • A PORCENTAGEM diz QUANTO FALTA, e ela é obrigatória por uma razão que
     *   não tem a ver com gosto: **o máximo dele MUDA durante a luta.** A vida
     *   é função de quanta gente está em campo (`vidaDoFreeza`), então alguém
     *   entrando na sala aumenta o total e o número cru SOBE no meio de uma
     *   briga que estava sendo vencida. Sozinho, ele é ilegível como progresso —
     *   `10.903` pode ser 90 % ou 30 % dependendo de quantos entraram desde que
     *   o jogador olhou pela última vez. A fração é a única leitura estável, e é
     *   por construção a que não se mexe quando o total muda (ver `recontar`:
     *   ela é preservada de propósito).
     *
     * A ordem é escala → progresso, que é a ordem em que o olho os quer: o
     * número grande estabelece contra o que se está lutando, a porcentagem
     * responde se está indo bem. A porcentagem é a peça DESTACADA das duas,
     * porque é a que se consulta no meio de um tiroteio.
     *
     * Cabe porque a faixa do topo é inteira da barra: o resto do HUD desce 96 px
     * enquanto ela está na tela.
     */
    const n = Math.max(0, Math.round(this.vidaMostrada * this.vidaMax));
    if (n !== e.num) {
      e.num = n;
      this.numEl.textContent = n.toLocaleString("pt-BR");
    }
    /* Arredondada PARA CIMA acima de zero: com onze mil de vida, os últimos
       cinquenta pontos são 0,4 %, e mostrar "0 %" para um boss que ainda está
       vivo e ainda mata é a única mentira que esta barra poderia contar. Ela só
       chega a zero quando ele chega. */
    const pct = this.vidaMostrada <= 0 ? 0 : Math.max(1, Math.round(this.vidaMostrada * 100));
    if (pct !== e.pct) {
      e.pct = pct;
      this.pctEl.textContent = `${pct} %`;
      this.pctEl.classList.toggle("nk-boss-critico-num", pct < 20);
    }
  }

  dispose() {
    this.el.remove();
    this._soltarEstilo?.();
    this._soltarEstilo = null;
  }
}

/* -------------------------------------------------------------------- o CSS */

const CSS = `
.nk-boss {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: clamp(320px, 62vw, 940px);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  pointer-events: none;
  /* Acima da bússola e das marcas de dano, abaixo do menu. O HUD inteiro é
     uma pilha sem z-index declarado; um número aqui é o mínimo para a barra
     não ficar por baixo de um pino que passe atrás dela. */
  z-index: 3;
}

.nk-boss-titulo {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
}

.nk-boss-nome {
  font-size: clamp(17px, 2.1vw, 26px);
  font-weight: 900;
  letter-spacing: 0.16em;
  /* O roxo do boss, CLAREADO — derivado de 'NAMEK.freeza.cor' e não escrito
     aqui. O nome no topo e o raio que vem na sua cara têm de ser obviamente a
     mesma coisa, e agora são pela mesma constante. */
  color: ${ROXO_NOME};
}

.nk-boss-nivel {
  font-size: clamp(9px, 1vw, 12px);
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--nk-fraca, rgba(226, 240, 255, 0.62));
}

/* ------------------------------------------------------------------- a barra
   Mesma anatomia da barra do jogador ('.nk-vida' em 'ui/style.js'): a inclinação
   pelo token, o contorno preto grosso, o fantasma atrás, o verniz por cima e a
   régua de gomos. Ela é só MAIOR. */
.nk-boss-barra {
  position: relative;
  height: clamp(16px, 1.9vw, 24px);
  transform: skewX(var(--nk-skew, -14deg));
  background: rgba(4, 8, 14, 0.72);
  border: 3px solid var(--nk-traco, #04080e);
  border-radius: 3px;
  overflow: hidden;
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.6), inset 0 0 18px rgba(0, 0, 0, 0.55);
}

.nk-boss-fantasma,
.nk-boss-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 100%;
}

/* O rastro do golpe. Vermelho-escuro e não branco: branco leria como brilho, e
   isto é uma FERIDA. */
.nk-boss-fantasma {
  background: linear-gradient(180deg, #ff6a5a 0%, #a81208 100%);
  opacity: 0.85;
}

.nk-boss-fill {
  background: linear-gradient(
    180deg,
    hsl(var(--nk-hue, 112) 92% 68%) 0%,
    hsl(var(--nk-hue, 112) 96% 50%) 44%,
    hsl(var(--nk-hue, 112) 88% 33%) 100%
  );
  box-shadow: 0 0 14px hsl(var(--nk-hue, 112) 96% 50% / 0.55);
}

/* O verniz: a faixa clara no terço de cima, que dá volume ao cilindro. */
.nk-boss-verniz {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.34) 0%,
    rgba(255, 255, 255, 0.08) 38%,
    rgba(0, 0, 0, 0.22) 100%
  );
}

/* A RÉGUA. Vinte gomos, e o número importa: com onze mil pontos de vida, cada
   gomo vale ~565 — é a única coisa na barra que permite estimar "faltam três
   Genki Damas" de relance. */
.nk-boss-regua {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.55) 0 2px,
    rgba(0, 0, 0, 0) 2px 5%
  );
}

.nk-boss-barra.nk-boss-critico {
  animation: nk-boss-pulso 0.7s ease-in-out infinite;
}

@keyframes nk-boss-pulso {
  0%, 100% { filter: brightness(1); box-shadow: 0 3px 14px rgba(0, 0, 0, 0.6); }
  50% { filter: brightness(1.55); box-shadow: 0 3px 22px rgba(255, 60, 40, 0.7); }
}

/* ------------------------------------------------------------------- rodapé */
.nk-boss-rodape {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* O ki dele. Fino: é informação de segunda ordem, e uma barra grossa competiria
   com a vida — que é a que decide a partida. */
.nk-boss-ki {
  position: relative;
  flex: 1;
  height: 6px;
  transform: skewX(var(--nk-skew, -14deg));
  background: rgba(4, 8, 14, 0.72);
  border: 2px solid var(--nk-traco, #04080e);
  border-radius: 2px;
  overflow: hidden;
}

.nk-boss-ki-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 100%;
  /* Roxo, e não o ciano do ki humano: o ki dele é outra coisa. Os três tons
     saem de 'NAMEK.freeza.cor' — escuro, cor pura, claro —, então o degradê
     acompanha sozinho o dia em que a paleta dele mudar. */
  background: linear-gradient(90deg, ${ROXO_FUNDO} 0%, ${ROXO} 60%, ${ROXO_BRILHO} 100%);
  box-shadow: 0 0 10px ${ROXO}b3;
}

.nk-boss-num {
  text-align: right;
  font-size: clamp(12px, 1.2vw, 16px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  /* SECUNDÁRIO. Ele diz a escala do chefe, não o progresso da luta — ver o
     comentário em 'escrever()'. Meio tom abaixo do branco para a porcentagem
     ganhar a hierarquia sem precisar ser enorme. */
  color: var(--nk-fraca, rgba(226, 240, 255, 0.62));
}

/* O separador entre os dois. Um ponto médio desenhado em CSS, e não um
   caractere no 'textContent': assim as duas metades continuam sendo dois nós
   independentes, e escrever uma não reescreve a outra (a vida muda a 8 Hz, a
   porcentagem quase nunca). */
.nk-boss-num::after {
  content: " · ";
  color: var(--nk-fraca, rgba(226, 240, 255, 0.62));
}

.nk-boss-pct {
  min-width: 4.5ch;
  text-align: right;
  font-size: clamp(15px, 1.7vw, 22px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  /* PRIMÁRIO: é a resposta a "quanto falta", que é a pergunta que se faz no
     meio de um tiroteio. Maior e mais claro que o número absoluto. */
  color: var(--nk-tinta, #f2f8ff);
}

/* Abaixo de 20 % ela pulsa em vermelho, como o número da vida do jogador faz.
   A barra já pulsa junto ('.nk-boss-critico'); o número acompanha porque é ele
   que se olha quando a briga está no fim. */
.nk-boss-pct.nk-boss-critico-num {
  color: var(--nk-perigo, #ff3a2a);
  animation: nk-boss-bater 0.62s ease-in-out infinite;
}

@keyframes nk-boss-bater {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.14); }
}

/* ------------------------------------------------------------------ o cartaz
   "FREEZA CHEGOU" / "FREEZA CAIU". Grande, por baixo da barra, e some sozinho.
   Ele não é decoração: a entrada do boss é o único momento do modo em que TODA
   a sala precisa mudar de objetivo ao mesmo tempo. */
.nk-boss-cartaz {
  margin-top: 6px;
  text-align: center;
  font-size: clamp(20px, 3.4vw, 44px);
  font-weight: 900;
  letter-spacing: 0.1em;
  color: ${ROXO_CARTAZ};
  opacity: 0;
  transform: skewX(calc(var(--nk-skew, -14deg) * 0.5));
}
`;
