/* ---------------------------------------------------------------------------
   O HUD de Namekusei.

   DOM puro, sem framework e sem dependência nova — o padrão da casa, e o mesmo
   de `src/ui/hud.js`. O que muda é o jogo por baixo: lá se mira parado e o HUD
   informa; aqui se voa a 64 m/s no meio de uma explosão azul e o HUD tem de
   GRITAR. Daí o contorno preto em tudo, as barras grandes e inclinadas e o
   número da vida do tamanho que está.

   A referência é declarada e é literal: o *Budokai Tenkaichi 3*. Barra de vida
   grande e horizontal no canto de cima, barra de ki logo abaixo dividida em
   gomos, retrato do lutador na ponta, nome em caixa alta, e o oponente travado
   espelhado no canto oposto. Ver `./style.js`, que carrega o caráter visual.

   ------------------------------------------------------ o que este HUD ensina
   Um modo se explica pelo que a tela repete. Este repete uma coisa só, e ela é
   a regra do §5 do plano: **o especial só sai com o ki cheio.** Por isso a
   barra de ki não "chega a 100 %" — ela ESTOURA: clarão de meio segundo, pulso
   contínuo, selo escrito e os quatro especiais acendendo um palmo abaixo, tudo
   no mesmo quadro. É o detalhe mais caro deste arquivo e o único sem o qual o
   modo não é jogável por quem nunca o viu.

   ------------------------------------------------------------------- o custo
   Zero alocação em regime (§3 do plano). Todo nó é criado uma vez e guardado;
   todo valor escrito é comparado com o que já está na tela e só desce ao DOM
   quando MUDA. Escrever `textContent` a 60 Hz num número que não mudou é pedir
   ao navegador para recalcular layout por nada — sessenta vezes por segundo,
   pelo resto da partida.

   ------------------------------------------------------------------- defesa
   Nome de jogador vem da rede e entra SEMPRE por `textContent`, nunca por
   `innerHTML`. Os `innerHTML` deste arquivo são todos ESQUELETO: marcação fixa
   escrita à mão logo acima da linha que a usa, sem uma única interpolação e sem
   um único dado de fora — é a mesma divisão que `src/ui/hud.js` faz. A regra
   está escrita em `sanitizeName` (`shared/protocol.js`) e o motivo também: a
   limpeza não escapa HTML de propósito, porque a defesa mora no ponto de saída,
   que é aqui.
   --------------------------------------------------------------------------- */

import { NAMEK, clamp01 } from "../../shared/namek/config.js";
import { aplicarEstiloNamek } from "./style.js";
import { NamekScoreboard, NamekKillFeed, corHex } from "./scoreboard.js";

/* ------------------------------------------------------------------ atalhos --
   As teclas DESTE modo, agrupadas por finalidade — a mesma forma de tabela do
   HUD do arqueiro, e pelo mesmo motivo: acrescentar uma tecla é acrescentar uma
   linha, e o painel não sai de sincronia com o input por esquecimento de editar
   marcação.

   O pedido foi explícito: **só o menu geral (Esc) é atalho global**; todo o
   resto pertence a Namekusei e precisa estar listado aqui, porque não existe
   outro lugar em que se possa descobri-lo.

   A onda de choque está no `Q`, e não no espaço como a tabela do §6 do plano
   sugeria: o espaço aqui é a subida, e uma tecla que sobe quando se está no
   chão e detona quando se está no ar é a fonte de erro que este HUD não teria
   como explicar em uma linha.

   NÃO HÁ TECLA DE TRAVA nesta tabela, e a ausência é o pedido: *"pode remover o
   atalho que dá lock-in no teclado (R)."* Quem designa alvo hoje é o cursor —
   basta passar o retículo perto de alguém e o círculo dele acende. Isso não vira
   uma linha aqui porque não é atalho: é a mira funcionando. Quem quiser o "por
   quê" inteiro encontra a seção "a TRAVA DE ALVO, que saiu do mapa" no cabeçalho
   de `../input.js`.

   E a guarda está no `E`, escrita aqui com o "segure:" na frente igual ao `C`,
   porque o que ela tem de mais fácil de errar não é onde fica — é que ela vale
   enquanto o dedo estiver embaixo, e não por toque.

   EXPORTADA porque a porta de entrada (`ui/porta.js`) mostra o primeiro item de
   cada grupo na tela do primeiro clique. Ela LÊ esta tabela em vez de ter uma
   sua — e isso é o rodapé de `input.js` cobrado no primeiro lugar em que ele
   poderia ter sido esquecido. */
export const CONTROLES = [
  {
    titulo: "Voar",
    itens: [
      [["W", "A", "S", "D"], "ir na direção do olhar"],
      [["Shift"], "correr no chão"],
      [["Espaço"], "subir"],
      [["Ctrl"], "descer"],
      [["F"], "decolar do chão · no ar, mergulhar"],
      [["Botão dir."], "arrancada de ki"],
    ],
  },
  {
    titulo: "Lutar",
    itens: [
      [["Botão esq."], "rajada de ki — o tiro comum"],
      [["C"], "segure: carregar ki"],
      [["E"], "segure: defender — o dano quase todo aparado"],
      [["1", "2", "3", "4"], "armar o especial"],
      [["Q"], "onda de choque"],
      /* A tecla da transformação. A linha diz a CONDIÇÃO junto com a tecla, e
         não só o nome do golpe, porque ela é a única do painel que não funciona
         quando se aperta: quem tentar com a vida cheia ou sem o Freeza em campo
         precisa saber por que não aconteceu nada. O alerta na tela existe
         justamente para o momento em que ela passa a valer. */
      [["R"], "Super Saiyajin — vida baixa, e só contra o Freeza"],
    ],
  },
  {
    titulo: "Sala",
    itens: [
      [["Esc"], "menu geral"],
      /* A BANCADA, marcada como tal — o painel de atalhos é lido por quem está
         jogando, e uma linha que mata o boss precisa dizer em voz alta que não é
         jogo. O `(teste)` é a mesma convenção que o repositório já usa nos
         outros comandos de bancada. */
      [["Alt", "K"], "matar o Freeza (teste) — começa a fuga"],
    ],
  },
];

/** s — quanto o fantasma da vida espera antes de começar a descer. */
const FANTASMA_ESPERA = 0.36;
/** 1/s — piso da velocidade de descida do fantasma, em barras por segundo. */
const FANTASMA_PISO = 0.5;
/** 1/s — a parte proporcional: golpe grande, descida rápida. */
const FANTASMA_GANHO = 3.4;
/** s — vida de uma marca de dano na tela. */
const MARCA_VIDA = 1.4;
/** Quantas marcas de dano existem. Oito porque quinze lutadores não acertam
 *  todos ao mesmo tempo, e porque o nono aviso já não é lido. */
const MARCAS = 8;

/** A lista vazia da bússola. Congelada: ninguém escreve nela, e ter uma só
 *  evita alocar um array por quadro em que não há ninguém longe. */
const SEM_MARCAS = Object.freeze([]);
/** s — vida de um aviso de canto. */
const AVISO_VIDA = 2.4;
/** s — o esmaecimento da placa do alvo ao sair. Do config: quem decide quanto a
 *  placa dura é `LockOn`, e o tempo de sumir é do mesmo par de números. */
const FADE_ALVO = NAMEK.lock.painel.fade;
/** 1/s — velocidade com que o clarão vermelho apaga. */
const FLASH_DECAI = 2.4;

/** Clareia uma cor 0xRRGGBB em direção ao branco. Para o cabelo do retrato. */
function clarear(cor, k = 0.42) {
  const n = typeof cor === "number" && Number.isFinite(cor) ? cor >>> 0 : 0x6fd8ff;
  const r = Math.round((n >> 16 & 255) + (255 - (n >> 16 & 255)) * k);
  const g = Math.round((n >> 8 & 255) + (255 - (n >> 8 & 255)) * k);
  const b = Math.round((n & 255) + (255 - (n & 255)) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* ------------------------------------------------------------------ retrato --
   Um busto desenhado em SVG por código: ombros, pescoço, cabeça e SETE ESPETOS
   de cabelo. Não há um único arquivo de imagem no repositório e não vai haver
   agora (§3 do plano: zero texturas).

   Ele não tenta parecer com o boneco em campo — tenta ser RECONHECÍVEL a 62 px
   no canto do olho, e é por isso que é silhueta de duas cores em vez de retrato:
   cabelo e quimono na cor do jogador, cabeça em tinta escura. A cor é a MESMA
   que o corpo dele tem voando na sua frente, e é ela que liga o nome da placa
   ao alvo que você está perseguindo. */
const RETRATO_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="35" r="27" style="fill: var(--nk-cor)" opacity="0.2"/>
  <path d="M3 64 C5 50 17 43 32 43 C47 43 59 50 61 64 Z" style="fill: var(--nk-cor)"/>
  <path d="M25 43 L32 55 L39 43 Z" fill="#081220" opacity="0.5"/>
  <rect x="27" y="34" width="10" height="12" rx="3" fill="#0b1724"/>
  <ellipse cx="32" cy="28" rx="13.5" ry="15" fill="#0b1724"/>
  <path d="M18 30 L12.5 13 L19.5 19 L19 4 L26 16 L29.5 1.5 L34 14 L39 3 L41.5 17 L47.5 7 L46.5 21 L52.5 16.5 L46 30 Z"
        style="fill: var(--nk-cabelo)"/>
  <path d="M24.5 26.5 L30.5 29 L30 31.2 L24 29.2 Z" fill="#e8f5ff"/>
  <path d="M39.5 26.5 L33.5 29 L34 31.2 L40 29.2 Z" fill="#e8f5ff"/>
</svg>`;

function montarRetrato(pequeno = false) {
  const el = document.createElement("div");
  el.className = pequeno ? "nk-retrato nk-retrato--pequeno" : "nk-retrato";
  el.innerHTML = RETRATO_SVG; // marcação fixa, escrita aqui: nada vem da rede
  return el;
}

/* ------------------------------------------------------------ barra de vida --
   Uma classe, duas barras: a sua e a do alvo travado. São o mesmo widget com
   tamanhos diferentes, e duas implementações seriam duas para sair de
   sincronia — o fantasma é a peça mais delicada do HUD e não merece uma cópia
   que envelhece sozinha. */
class BarraDeVida {
  /** @param {boolean} doAlvo muda só o tamanho e a classe. */
  constructor(doAlvo = false) {
    this.el = document.createElement("div");
    this.el.className = doAlvo ? "nk-vida nk-vida--alvo" : "nk-vida";
    this.el.innerHTML = `
      <div class="nk-vida-fantasma"></div>
      <div class="nk-vida-fill"></div>
      <div class="nk-vida-verniz"></div>
      <div class="nk-vida-regua"></div>`;
    this.fantasmaEl = this.el.firstElementChild;
    this.fillEl = this.fantasmaEl.nextElementSibling;

    this.numEl = document.createElement("div");
    this.numEl.className = doAlvo
      ? "nk-vida-num nk-vida-num--alvo nk-contorno"
      : "nk-vida-num nk-contorno";

    /** A fração de verdade, 0..1. */
    this.frac = 1;
    /** Onde o fantasma está — sempre ≥ `frac`. */
    this.fantasma = 1;
    this._espera = 0;
    /* A PRIMEIRA leitura não é uma pancada. Sem esta trava, aparecer na tela
       com 60 de vida (renasceu no meio de uma sala, trocou de alvo, abriu o
       jogo) desenharia um fantasma descendo de 100 % — o HUD anunciaria um
       golpe que nunca existiu, e logo no instante em que ele é mais crível. */
    this._iniciada = false;

    /* O que está ESCRITO na tela. Tudo que desce ao DOM passa por uma destas
       comparações; sem elas seriam seis escritas de estilo por quadro por
       barra, todas com o mesmo valor. */
    this._pctEscrito = -1;
    this._pctFantasmaEscrito = -1;
    this._hueEscrito = -1;
    this._numEscrito = -1;
    this._criticoEscrito = null;
    /** **A barra de vida fica AMARELA** — o pedido literal. Ver `setOuro`. */
    this._ouro = false;
  }

  /**
   * Pinta a barra de OURO (Super Saiyajin) ou devolve o giro de matiz normal.
   *
   * A barra já é pintada por MATIZ (`--nk-hue`, ver `ui/style.js`), então o
   * amarelo dela não é uma cor nova nem uma classe nova: é um número travado no
   * lugar do que a vida calcularia. Isso preserva de graça tudo o que a barra
   * já sabe fazer — o fantasma, o verniz, a régua, a inclinação —, e o dia em
   * que alguém mexer no visual dela o Super Saiyajin acompanha sem saber.
   *
   * `_hueEscrito` é invalidado na virada porque a comparação de "já está na
   * tela" é sobre o NÚMERO, e o número pode coincidir: um lutador com 44 % de
   * vida já está em 48° de matiz por acidente, e sem esta linha ele viraria
   * Super Saiyajin sem a barra mudar de cor — e, pior, VOLTARIA ao normal sem
   * ela mudar de volta.
   */
  setOuro(v) {
    const ouro = v === true;
    if (ouro === this._ouro) return;
    this._ouro = ouro;
    this._hueEscrito = -1;
  }

  /**
   * @param {number} vida
   * @param {number} vidaMax
   */
  set(vida, vidaMax) {
    const max = vidaMax > 0 ? vidaMax : NAMEK.fighter.maxHealth;
    const f = clamp01(vida / max);

    /* Vida SUBINDO gruda o fantasma nela. Renascer com a barra cheia e ver uma
       faixa quente descendo por dois segundos contaria uma mentira: ninguém
       levou dano nenhum ali. Vida DESCENDO reinicia a espera — e reiniciar a
       cada golpe é o certo: numa rajada de seis bolas por segundo, o fantasma
       tem de mostrar o estrago da rajada inteira, não o da primeira bola. */
    if (!this._iniciada || f > this.frac) {
      this._iniciada = true;
      this.fantasma = f;
    } else if (f < this.frac) {
      this._espera = FANTASMA_ESPERA;
    }
    this.frac = f;

    const pct = Math.round(f * 1000) / 10;
    if (pct !== this._pctEscrito) {
      this._pctEscrito = pct;
      this.fillEl.style.width = `${pct}%`;
    }

    /* Verde (112°) → âmbar → vermelho (0°) por giro de matiz, arredondado ao
       grau: o olho não distingue meio grau e o DOM não precisa saber dele.
     *
     * O EXPOENTE 1,5 é o que torna a cor honesta. Com o giro linear, 30 de vida
     * pintavam um laranja tranquilo — e 30 de vida neste modo é uma bola de ki
     * e meia de distância da morte. A curva puxa o vermelho para cima: metade
     * da barra já é âmbar, um terço já é vermelho, e a cor passa a dizer o que
     * o número diz. */
    /* Em Super Saiyajin o giro para de girar: a barra fica no OURO de
       `NAMEK.ssj.hue`, cheia ou quase vazia. É de propósito que ela deixe de
       avisar da vida por cor — o que ela passa a anunciar é o PATAMAR, e o
       número ao lado continua dizendo quanto falta. Ver `setOuro`. */
    const hue = this._ouro ? NAMEK.ssj.hue : Math.round(112 * Math.pow(f, 1.5));
    if (hue !== this._hueEscrito) {
      this._hueEscrito = hue;
      this.fillEl.style.setProperty("--nk-hue", String(hue));
    }

    /* ARREDONDA PARA CIMA. Um lutador com 0,4 de vida ainda está vivo, e uma
       barra escrevendo "0" em quem ainda respira faria o jogador desistir de
       um golpe que ganharia a briga. Zero aparece quando é zero. */
    const num = vida <= 0 ? 0 : Math.max(1, Math.ceil(vida));
    if (num !== this._numEscrito) {
      this._numEscrito = num;
      this.numEl.textContent = String(num);
    }

    const critico = f > 0 && f < 0.25;
    if (critico !== this._criticoEscrito) {
      this._criticoEscrito = critico;
      this.numEl.classList.toggle("nk-critico", critico);
    }

    this._escreverFantasma();
  }

  /** Esquece o que estava na barra: a próxima leitura vira o novo ponto zero. */
  reiniciar() {
    this._iniciada = false;
    this._espera = 0;
  }

  /** O fantasma desce sozinho; é a única parte da barra que tem relógio. */
  update(dt) {
    if (this.fantasma <= this.frac + 0.0005) return;
    if (this._espera > 0) {
      this._espera -= dt;
      return;
    }
    const passo = Math.max(FANTASMA_PISO, (this.fantasma - this.frac) * FANTASMA_GANHO) * dt;
    this.fantasma = Math.max(this.frac, this.fantasma - passo);
    this._escreverFantasma();
  }

  _escreverFantasma() {
    const pct = Math.round(this.fantasma * 1000) / 10;
    if (pct === this._pctFantasmaEscrito) return;
    this._pctFantasmaEscrito = pct;
    this.fantasmaEl.style.width = `${pct}%`;
  }
}

/* ============================================================================
   O HUD
   ========================================================================== */

export class NamekHud {
  /** @param {HTMLElement} root o container (`#ui`) */
  constructor(root) {
    this.root = root;
    this._soltarEstilo = aplicarEstiloNamek();

    this.el = document.createElement("div");
    this.el.className = "nk-hud";

    /* ---------------------------------------------------------- a sua placa */
    this.placaEu = document.createElement("div");
    this.placaEu.className = "nk-placa nk-placa--eu";

    const corpoEu = document.createElement("div");
    corpoEu.className = "nk-placa-corpo";
    this.retratoEu = montarRetrato();

    const medidoresEu = document.createElement("div");
    medidoresEu.className = "nk-medidores";
    this.medidoresEu = medidoresEu;

    this.nomeEu = document.createElement("div");
    this.nomeEu.className = "nk-nome nk-contorno";
    this.nomeEu.textContent = "Você";

    this.vida = new BarraDeVida(false);
    const linhaVida = document.createElement("div");
    linhaVida.className = "nk-linha";
    linhaVida.append(this.vida.el, this.vida.numEl);

    this.kiEl = document.createElement("div");
    this.kiEl.className = "nk-ki";
    this.kiEl.innerHTML = `
      <div class="nk-ki-fill"></div>
      <div class="nk-ki-grade"></div>
      <div class="nk-ki-brilho"></div>`;
    this.kiFill = this.kiEl.firstElementChild;

    this.kiSelo = document.createElement("span");
    this.kiSelo.className = "nk-ki-selo nk-contorno";
    this.kiSelo.textContent = "KI CHEIO";
    const linhaKi = document.createElement("div");
    linhaKi.className = "nk-linha";
    linhaKi.append(this.kiEl, this.kiSelo);

    medidoresEu.append(this.nomeEu, linhaVida, linhaKi);
    corpoEu.append(this.retratoEu, medidoresEu);

    this.especiaisEl = this._montarEspeciais();
    this.placaEu.append(corpoEu, this.especiaisEl);

    /* ----------------------------------------------------- a placa do alvo
     *
     * UM WIDGET, DUAS RAZÕES DE APARECER — e as duas são pedidos literais:
     *
     *   *"Quando o player acerta o outro deve aparecer a vida do player que ele
     *   acertou na tela dele diminuindo, independente se tiver lock-in ou não."*
     *   *"No lock-in que acontece quando o mouse fica perto, a vida do player
     *   inimigo deve aparecer… vida dinâmica, e diminui conforme o player perde
     *   vida seja para ele ou outros players."*
     *
     * Esta placa já existia para o alvo TRAVADO (a tecla `R`, que saiu). Ela não
     * foi duplicada para atender aos dois pedidos porque eles mostram exatamente
     * a mesma coisa — retrato, nome e barra de vida do mesmo adversário, na mesma
     * quina da tela — e porque na briga são a MESMA pessoa quase sempre: duas
     * placas iguais uma sobre a outra.
     *
     * Quem escolhe QUEM aparece e por quanto tempo é `LockOn` (ver `_painel` lá,
     * e `NAMEK.lock.painel` para a precedência entre as duas razões); aqui só se
     * desenha o que o laço entregou em `setTarget`.
     *
     * A BARRA JÁ SABIA FAZER O RESTO: o fantasma de `BarraDeVida` é o que faz a
     * vida "diminuir animando" em vez de saltar, e ele é o mesmo da sua própria
     * barra. O único acréscimo é o número do dano — quanto você tirou —, que é a
     * pergunta que o primeiro pedido faz e que uma barra sozinha não responde. */
    this.placaAlvo = document.createElement("div");
    this.placaAlvo.className = "nk-placa nk-placa--alvo";
    this.placaAlvo.hidden = true;

    const corpoAlvo = document.createElement("div");
    corpoAlvo.className = "nk-placa-corpo";
    this.retratoAlvo = montarRetrato(true);

    const medidoresAlvo = document.createElement("div");
    medidoresAlvo.className = "nk-medidores";
    this.nomeAlvo = document.createElement("div");
    this.nomeAlvo.className = "nk-nome nk-contorno";
    this.vidaAlvo = new BarraDeVida(true);
    /* O NÚMERO DO DANO fica na MESMA linha da barra, do lado de fora dela — ao
       lado do número da vida, e não por cima da barra. Por cima ele disputaria
       espaço com o fantasma, que é justamente a outra metade da mesma notícia:
       um diz "tirei 34", o outro mostra os 34 escoando. */
    this.danoAlvo = document.createElement("div");
    this.danoAlvo.className = "nk-dano nk-contorno";
    this.danoAlvo.hidden = true;
    const linhaVidaAlvo = document.createElement("div");
    linhaVidaAlvo.className = "nk-linha";
    linhaVidaAlvo.append(this.vidaAlvo.el, this.vidaAlvo.numEl, this.danoAlvo);
    medidoresAlvo.append(this.nomeAlvo, linhaVidaAlvo);

    corpoAlvo.append(this.retratoAlvo, medidoresAlvo);
    this.placaAlvo.append(corpoAlvo);

    /* -------------------------------------------------------------- o resto */
    this.flashEl = document.createElement("div");
    this.flashEl.className = "nk-flash";

    this.marcasEl = document.createElement("div");
    this.marcasEl.className = "nk-marcas";
    /** Pool fixo: as marcas de dano são recicladas, nunca criadas em jogo. */
    this._marcas = [];
    for (let i = 0; i < MARCAS; i++) {
      const el = document.createElement("div");
      el.className = "nk-marca";
      this.marcasEl.appendChild(el);
      this._marcas.push({ el, t: 0, op: -1 });
    }
    this._marcaProxima = 0;

    /* ------------------------------------------------------------ a bússola
     *
     * Os PINOS que dizem onde estão os outros lutadores. É a mesma peça dos
     * marcadores de rocha da chuva de meteoros (`Hud.setMeteorMarks`, no HUD do
     * arqueiro), trazida para cá pelo mesmo motivo que ela existe lá: **um alvo
     * pequeno num céu grande é invisível**, e girar a câmera à toa procurando
     * gente não é jogar.
     *
     * Duas formas no mesmo nó, como lá: ANEL quando o lutador está dentro da
     * tela (ele já está ali, o anel só o circula), SETA girada na borda quando
     * está fora (a única maneira de apontar para o que não está no quadro).
     *
     * A diferença para o modo de meteoros está em duas escolhas:
     *
     * • **O pino some de perto.** É o pedido literal — "quando o jogador está
     *   perto a setinha some; ela só aparece quando está longe e difícil de
     *   enxergar". E é a decisão certa: numa briga colada, catorze pinos em
     *   volta da mira seriam a própria briga escondida atrás da bússola. Quem
     *   decide o limiar é quem sabe a distância — ver `NamekGame.bussola`.
     * • **A cor é a do LUTADOR**, e não o laranja fixo da rocha. Aqui os alvos
     *   têm identidade: o gi de cada um tem uma cor, o placar usa a mesma, e o
     *   pino que combina com o corpo é o que deixa saber QUEM está vindo antes
     *   de conseguir enxergar o corpo. */
    this.bussolaEl = document.createElement("div");
    this.bussolaEl.className = "nk-bussola";
    /** Pool fixo: um por adversário possível (o teto da sala menos você) MAIS
     *  um para o CHEFE, que também entra na bússola e não pode ser o pino que
     *  sobra quando a arena está cheia. */
    this._pinos = [];
    for (let i = 0; i < NAMEK.net.maxPlayers; i++) {
      const el = document.createElement("div");
      el.className = "nk-pino";
      // Esqueleto FIXO, sem uma única interpolação — ver o cabeçalho.
      el.innerHTML = `<i class="nk-pino-seta">▲</i><div class="nk-pino-anel"></div><span class="nk-pino-d"></span>`;
      el.hidden = true;
      this.bussolaEl.appendChild(el);
      this._pinos.push({
        el,
        dEl: el.querySelector(".nk-pino-d"),
        /* O que já está NA TELA. Escrever `textContent` e `style` a 60 Hz num
           valor que não mudou é pedir recálculo de layout por nada, catorze
           vezes por quadro. Ver o §custo do cabeçalho. */
        dist: -1,
        cor: null,
        fora: null,
        travado: null,
        op: -1,
      });
    }

    this.miraEl = document.createElement("div");
    this.miraEl.className = "nk-mira";
    this.miraEl.innerHTML = `
      <div class="nk-mira-anel"></div>
      <i class="nk-t nk-t1"></i><i class="nk-t nk-t2"></i>
      <i class="nk-h nk-h1"></i><i class="nk-h nk-h2"></i>
      <i class="nk-ponto"></i>`;

    /* O ANEL VERMELHO DA TRAVA saiu daqui, e não sobrou nada dele.
     *
     * Ele era o círculo com cantoneiras em volta do adversário TRAVADO — o
     * retículo que o pedido de então descrevia ("deve ser um círculo vermelho em
     * volta do player"). Com a remoção da tecla `R` não existe mais adversário
     * travado: nada no jogo pode acendê-lo, e um marcador que não pode acender é
     * um nó a mais no documento e um `setLockRing(null)` por quadro.
     *
     * O que ficou no lugar não é menos: os círculos de TODO MUNDO, logo abaixo,
     * com o de quem está sob o cursor aceso. Eles marcam a mesma coisa que
     * importava (para onde o tiro vai) sem pedir compromisso nenhum ao jogador —
     * e o pedido da mira assistida é literal em não querer "a parte vermelha nem
     * nada". Ver `NAMEK.lock` para a decisão inteira. */

    /* OS CÍRCULOS DE TODO MUNDO — e o aceso é para onde o tiro vai.
     *
     * É a metade visível da mira assistida (ver `NAMEK.lock.mira`). O pedido
     * descreve a peça e o motivo dela numa frase só: *"todos os players já têm
     * um círculo, correto? Quando está perto, talvez é mudar aquele círculo de
     * cor quando o mouse estiver perto dele, só pra ele identificar que os tiros
     * vão nele."*
     *
     * Sem isso a assistência seria invisível, e uma assistência invisível é
     * pior que nenhuma: o jogador não teria como saber por que um tiro curvou
     * nem como escolher para quem atirar. Com ela, o gesto que o pedido descreve
     * — varrer o mouse por três adversários e atirar em cada um — vira legível.
     *
     * O anel APAGADO é fino e discreto de propósito: com quinze em campo, quinze
     * círculos berrantes seriam a briga escondida atrás da interface. Ele existe
     * para marcar onde as pessoas estão; quem informa é o aceso.
     *
     * Pool fixo, como os pinos da bússola e pelo mesmo motivo: um nó por
     * lutador possível, criado uma vez, escondido quando sobra.
     *
     * ------------------------------------------------------------ e o CHEFE
     *
     * O Freeza usa um destes anéis, e não um marcador à parte — mas ele **não
     * pode ser mais um círculo igual**: *"deve ficar claro quem é o Freeza dos
     * outros jogadores à distância."* A separação é feita por três coisas ao
     * mesmo tempo, e são três porque nenhuma sozinha sobrevive ao céu de
     * Namekusei:
     *
     * • **cor** — o magenta dele (`NAMEK.freeza.cor`), que não existe na roda de
     *   cores dos jogadores. É o que se lê primeiro, antes de qualquer forma;
     * • **peso e tamanho** — traço grosso, com um segundo anel por fora. Um
     *   corpo a 400 m tem seis pixels, e a diferença de cor sozinha some nesse
     *   tamanho; o piso do raio dele é maior pelo mesmo motivo;
     * • **o NOME escrito** — "FREEZA" por cima do anel. É a única das três que
     *   não depende de o jogador ter aprendido convenção nenhuma, e é ela que
     *   responde à segunda metade do pedido ("saber QUEM é o Freeza").
     *
     * Cada anel ganha por isso um rótulo próprio, escondido em quem não é o
     * chefe. Um nó a mais por lutador é o preço de não ter um segundo pool. */
    this.aneisEl = document.createElement("div");
    this.aneisEl.className = "nk-aneis";
    this._aneis = [];
    for (let i = 0; i < NAMEK.net.maxPlayers; i++) {
      const el = document.createElement("div");
      el.className = "nk-lutador-anel";
      el.hidden = true;
      // Esqueleto FIXO: o texto entra por `textContent`, nunca por `innerHTML`.
      el.innerHTML = `<span class="nk-anel-nome nk-contorno"></span>`;
      this.aneisEl.appendChild(el);
      this._aneis.push({
        el,
        nomeEl: el.firstElementChild,
        x: null, y: null, r: null, sob: null, visivel: false,
        chefe: null, nome: null,
      });
    }

    this.faixaEl = document.createElement("div");
    this.faixaEl.className = "nk-faixa nk-contorno";
    this.faixaEl.hidden = true;

    this.avisosEl = document.createElement("div");
    this.avisosEl.className = "nk-avisos";

    this.ssjAvisoEl = this._montarAvisoSSJ();

    this.morteEl = this._montarMorte();
    this.ajudaEl = this._montarAjuda();

    this.el.append(
      this.flashEl,
      this.marcasEl,
      /* A bússola entra ANTES da mira e das placas: ela é o fundo da leitura,
         e um pino passando por cima do retrato do adversário travado esconderia
         a informação mais importante da tela atrás da menos importante. */
      this.bussolaEl,
      /* Os círculos de todo mundo vêm ANTES da mira e do anel da trava: eles são
         o fundo da leitura (onde as pessoas estão), e os outros dois são o
         primeiro plano (para onde o tiro vai). */
      this.aneisEl,
      this.miraEl,
      this.placaEu,
      this.placaAlvo,
      this.faixaEl,
      this.avisosEl,
      /* O alerta do Super Saiyajin entra DEPOIS da faixa e dos avisos, e antes
         da tela de morte: ele é a coisa mais urgente que a tela pode dizer
         enquanto o jogador está vivo, e a única que ele NÃO pode perder atrás de
         um aviso de canto. A tela de morte ganha dele porque quem morreu já não
         tem o que transformar. */
      this.ssjAvisoEl,
      this.morteEl,
      this.ajudaEl,
    );

    /* O placar e o feed montam a si mesmos dentro do HUD. */
    this.placar = new NamekScoreboard(this.el);
    this.feed = new NamekKillFeed(this.el);

    root.appendChild(this.el);

    /* -------------------------------------------------- o que está na tela */
    this._corEu = null;
    this._nomeEuEscrito = null;
    /* QUEM VOCÊ É, num objeto reaproveitado. O feed precisa disso a cada morte
       para saber que linha destacar, e um `{id, nome}` novo por morte seria
       lixo criado no instante mais movimentado da partida. */
    this._eu = { id: null, nome: null };
    this._kiPct = -1;
    this._kiCheio = false;
    this._alvoId = null;
    this._alvoNomeEscrito = null;
    this._alvoCor = null;
    /** O número do dano que está escrito na placa do alvo. */
    this._danoEscrito = -1;
    /** s restantes do esmaecimento da placa do alvo; 0 = ela não está saindo. */
    this._alvoSaindo = 0;
    /** A opacidade que está escrita na placa do alvo. */
    this._alvoOp = 1;
    this._armado = -1;
    /** O que o laço declarou em `setSpecials`; `null` = ainda não se pronunciou. */
    this._prontoDeclarado = null;
    this._prontoEscrito = false;
    this._mira = null;
    this._flash = 0;
    this._flashEscrito = -1;
    this._faixaT = 0;
    this._avisos = [];
    /** O alerta do Super Saiyajin está na tela? E ele já está transformado? */
    this._ssjAviso = false;
    this._ssjAceso = false;
    this._morteNum = null;
    this._ajudaVisivel = false;

    this.setCrosshair("livre");
    this._pintarCor(this.retratoEu, 0x9ff0ff);
  }

  /* ------------------------------------------------------------- construção */

  /** A fileira 1–4, montada da ordem oficial do config. */
  _montarEspeciais() {
    const fileira = document.createElement("div");
    fileira.className = "nk-especiais";
    this._espTiles = [];

    NAMEK.specialOrder.forEach((kind, i) => {
      const def = NAMEK.specials[kind];
      const tile = document.createElement("div");
      tile.className = "nk-esp";
      /* A cor do tijolo é a COR DO GOLPE, tirada do config — a mesma que o
         feixe vai ter no céu. Uma paleta inventada aqui seria uma segunda
         verdade sobre o que é roxo e o que é azul neste jogo. */
      tile.style.setProperty("--nk-esp-cor", corHex(def?.cor, "#6fd8ff"));

      const tecla = document.createElement("span");
      tecla.className = "nk-esp-tecla";
      tecla.textContent = String(i + 1);

      const nome = document.createElement("span");
      nome.className = "nk-esp-nome";
      nome.textContent = def?.nome ?? kind;

      tile.append(tecla, nome);
      fileira.appendChild(tile);
      this._espTiles.push(tile);
    });

    return fileira;
  }

  /* ------------------------------------------------- o alerta do SUPER SAIYAJIN
   *
   * *"Se o player estiver com vida de 30 % ou menos aparece um alerta que ele
   * pode se transformar."*
   *
   * Ele fica logo ACIMA do meio da tela e não num canto, e essa é a decisão
   * inteira: é a única coisa que este HUD diz que muda o que a pessoa vai fazer
   * no segundo seguinte, e ela aparece exatamente quando o jogador está com a
   * tela cheia de vermelho e olhando para o adversário, não para o canto. Um
   * `toast` teria sido três linhas em vez de trinta e teria sido a resposta
   * errada: os avisos de canto são para o que se lê quando sobra tempo.
   *
   * ---------------------------------------------------- por que estilo em linha
   *
   * O resto do HUD tem folha própria (`ui/style.js`), e este bloco não entra
   * nela de propósito: são nove propriedades que só este nó usa, e a folha é
   * lida e editada por gente que não trabalha nesta feature. O que ele NÃO faz é
   * inventar cor: o ouro sai de `NAMEK.ssj.cor`, o mesmo do cabelo, da aura e
   * dos poderes. Um amarelo escrito à mão aqui seria a segunda verdade sobre o
   * que é ouro neste jogo — e o §"as cores" do config existe para não haver uma.
   *
   * A animação de pulso mora numa `@keyframes` própria, injetada uma vez: um
   * alerta parado no meio da tela é um adesivo, e o que se quer é uma coisa que
   * PEDE para ser apertada. */
  _montarAvisoSSJ() {
    const ouro = corHex(NAMEK.ssj.cor, "#ffd23a");
    if (!document.getElementById("nk-ssj-anim")) {
      const folha = document.createElement("style");
      folha.id = "nk-ssj-anim";
      folha.textContent =
        "@keyframes nk-ssj-pulso{0%,100%{opacity:.82;transform:translate(-50%,0) scale(1)}" +
        "50%{opacity:1;transform:translate(-50%,0) scale(1.045)}}";
      document.head.appendChild(folha);
    }

    const el = document.createElement("div");
    el.hidden = true;
    /* `pointer-events: none` como todo o resto do HUD: nada aqui pode roubar o
       clique que engata a mira. */
    el.style.cssText = [
      "position:absolute",
      "left:50%",
      "top:26%",
      "transform:translate(-50%,0)",
      "padding:9px 20px",
      "border-radius:6px",
      "pointer-events:none",
      "white-space:nowrap",
      "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
      "font-size:clamp(14px,1.9vw,22px)",
      "font-weight:800",
      "letter-spacing:1.2px",
      "text-transform:uppercase",
      `color:${ouro}`,
      "background:rgba(6,10,4,0.62)",
      `border:2px solid ${ouro}`,
      `box-shadow:0 0 26px -4px ${ouro}, inset 0 0 18px -8px ${ouro}`,
      "text-shadow:0 2px 0 rgba(0,0,0,0.85), 0 0 14px rgba(255,210,58,0.6)",
      "animation:nk-ssj-pulso 1.05s ease-in-out infinite",
    ].join(";");
    /* A TECLA vem por `textContent` e não por interpolação de marcação, como
       todo texto deste arquivo — e aqui ela é constante, mas a regra vale igual:
       o dia em que a tecla for configurável, o caminho já é o seguro. */
    el.textContent = "";
    return el;
  }

  /**
   * O ALERTA: "você pode virar Super Saiyajin".
   *
   * Ele aparece com vida ≤ `NAMEK.ssj.gatilho` durante a batalha contra o
   * Freeza e some por qualquer um dos três caminhos do pedido: o jogador se
   * transformou, a vida subiu acima do gatilho, ou a batalha acabou. Quem
   * decide os três é o laço (`NamekGame.step`), que é quem sabe da vida, do
   * chefe e do estado — este método só desenha.
   *
   * @param {boolean} visivel
   * @param {string} [tecla] o rótulo da tecla, para o texto não repetir o mapa
   */
  setAvisoSSJ(visivel, tecla = "R") {
    const v = visivel === true;
    if (v === this._ssjAviso) return;
    this._ssjAviso = v;
    if (v) this.ssjAvisoEl.textContent = `${tecla} — virar Super Saiyajin`;
    this.ssjAvisoEl.hidden = !v;
  }

  /**
   * O ESTADO: transformado ou não. **É o "fica amarelo" do pedido.**
   *
   * Três peças, e cada uma é um pedaço da mesma frase ("sua aura, seu ki, sua
   * barra de vida fica amarelo"):
   *
   * • a barra de VIDA trava o giro de matiz no ouro (`BarraDeVida.setOuro`);
   * • a barra de KI troca o degradê azul pelo dourado. Estilo em linha, e é o
   *   caminho certo aqui: a regra da folha que pinta a barra cheia
   *   (`.nk-ki.nk-cheio .nk-ki-fill`) tem dois seletores de classe, e vencê-la
   *   pela folha exigiria um terceiro seletor mais específico para um estado
   *   que dura uma briga. Estilo em linha ganha das duas sem `!important` e
   *   volta atrás com uma string vazia;
   * • os TIJOLOS dos especiais 1–4 ganham a cor do golpe que vai sair — que é o
   *   ouro, porque "todos os seus poderes ficam amarelos". Sem isto, o HUD
   *   continuaria prometendo um Kamehameha azul e sairia um dourado.
   */
  setSSJ(aceso) {
    const v = aceso === true;
    if (v === this._ssjAceso) return;
    this._ssjAceso = v;

    this.vida.setOuro(v);
    this.kiFill.style.background = v
      ? "linear-gradient(180deg,#fffbe0,#ffd23a 46%,#e09a06 78%,#8a5a00)"
      : "";
    const ouro = corHex(NAMEK.ssj.cor, "#ffd23a");
    for (let i = 0; i < this._espTiles.length; i++) {
      const kind = NAMEK.specialOrder[i];
      const cor = v ? ouro : corHex(NAMEK.specials[kind]?.cor, "#6fd8ff");
      this._espTiles[i].style.setProperty("--nk-esp-cor", cor);
    }
    /* E o alerta sai de cena junto: quem já se transformou não tem o que
       transformar. Vale como rede de segurança — o laço também o esconde —,
       porque um alerta preso na tela pedindo uma tecla que não faz mais nada é a
       pior coisa que este HUD poderia mostrar. */
    if (v) this.setAvisoSSJ(false);
  }

  _montarMorte() {
    const el = document.createElement("div");
    el.className = "nk-morte";
    el.hidden = true;
    el.innerHTML = `
      <div class="nk-morte-titulo nk-contorno">VOCÊ CAIU</div>
      <div class="nk-morte-num nk-contorno">0</div>
      <div class="nk-morte-sub nk-contorno"></div>`;
    this.morteNumEl = el.children[1];
    this.morteSubEl = el.children[2];
    return el;
  }

  _montarAjuda() {
    const el = document.createElement("div");
    el.className = "nk-ajuda";
    el.hidden = true;

    const titulo = document.createElement("div");
    titulo.className = "nk-ajuda-titulo";
    titulo.textContent = "Namekusei — controles";

    const grades = document.createElement("div");
    grades.className = "nk-ajuda-grades";

    for (const grupo of CONTROLES) {
      const bloco = document.createElement("div");
      bloco.className = "nk-ajuda-grupo";
      const h = document.createElement("h4");
      h.textContent = grupo.titulo;
      bloco.appendChild(h);

      /* Teclas e ações entram como filhos DIRETOS da grade do grupo, sem uma
         div de linha no meio: é o que faz a coluna das teclas se ajustar
         sozinha à combinação mais larga (o `W A S D`) em vez de ter uma largura
         fixa que ela estoura. Mesmo arranjo do painel do arqueiro. */
      for (const [teclas, acao] of grupo.itens) {
        const caixa = document.createElement("span");
        caixa.className = "nk-teclas";
        for (const t of teclas) {
          const kbd = document.createElement("kbd");
          kbd.textContent = t;
          caixa.appendChild(kbd);
        }
        const desc = document.createElement("span");
        desc.className = "nk-ajuda-acao";
        desc.textContent = acao;
        bloco.append(caixa, desc);
      }
      grades.appendChild(bloco);
    }

    const rodape = document.createElement("div");
    rodape.className = "nk-ajuda-rodape";
    /* A porcentagem sai do config e não é escrita à mão, pelo mesmo motivo do
       limiar do especial em `setVitals`: no dia em que a guarda aparar mais (ou
       menos), esta frase acompanha sozinha em vez de virar a única mentira do
       painel que ensina o modo. */
    const passa = Math.round((NAMEK.guard?.damage ?? 0.22) * 100);
    rodape.textContent =
      "Só o Esc é atalho geral — todas as outras teclas valem dentro de Namekusei. " +
      "O especial só sai com a barra de ki cheia: segure C para carregar. " +
      `Segure E para defender: passa só ${passa} % do dano, e a barra de ki ` +
      "escoa enquanto os braços estiverem cruzados. " +
      /* A MIRA NÃO É UMA TECLA, e é por isso que ela é explicada aqui embaixo em
         vez de virar uma linha da tabela. Sem esta frase o jogador não tem onde
         descobrir que passar o retículo perto de alguém é o que manda os poderes
         nele — antes existia um `R` para travar, e a tabela o listava. */
      "Não há tecla de mira: leve o retículo para perto de um adversário e o " +
      "círculo dele acende — é nele que os poderes vão, e é a vida dele que " +
      "aparece no canto direito da tela.";

    el.append(titulo, grades, rodape);
    return el;
  }

  /* ------------------------------------------------------------- o contrato */

  /**
   * Vida e ki do jogador local.
   *
   * @param {number} vida
   * @param {number} vidaMax
   * @param {number} ki 0..`NAMEK.ki.max`
   * @param {number} kiMax
   */
  setVitals(vida, vidaMax, ki, kiMax) {
    this.vida.set(vida, vidaMax);

    const max = kiMax > 0 ? kiMax : NAMEK.ki.max;
    const f = clamp01(ki / max);

    const pct = Math.round(f * 1000) / 10;
    if (pct !== this._kiPct) {
      this._kiPct = pct;
      this.kiFill.style.width = `${pct}%`;
    }

    /* CHEIA É UM ESTADO, E ENCHER É UM EVENTO — e os dois precisam existir.
     *
     * O estado (pulso, brilho, selo, especiais acesos) responde "posso soltar?"
     * a qualquer momento. O evento responde "posso soltar AGORA?", que é outra
     * pergunta: quem está carregando ki está com a tela cheia de aura e não vai
     * notar uma barra que preencheu o último gomo em silêncio. O clarão de meio
     * segundo é o que transforma encher numa notícia.
     *
     * O limiar sai do config (`ki.specialThreshold`) e não é 1 escrito à mão —
     * o dia em que o especial custar 80 % da barra, o HUD acompanha sozinho. */
    /* O limiar CAI em Super Saiyajin (um terço da barra, `NAMEK.ssj.limiar`), e
       o selo tem de cair com ele: a barra "estoura" quando o especial destrava,
       não quando ela chega a 100 %. Sem esta linha, quem se transforma passaria
       a partida com a barra apagada entre um golpe e outro enquanto os
       especiais, logo abaixo, estariam acesos — a tela discordando de si mesma
       sobre a única regra que ela existe para ensinar. */
    const limiar = this._ssjAceso ? NAMEK.ssj.limiar : NAMEK.ki.specialThreshold;
    const cheio = f >= limiar - 0.0005;
    if (cheio !== this._kiCheio) {
      this._kiCheio = cheio;
      this.kiEl.classList.toggle("nk-cheio", cheio);
      // O SELO segue a barra, não o `podeSoltar`: ele diz "o ki está cheio",
      // que é um fato sobre a barra e continua verdade durante a pose do golpe.
      this.medidoresEu.classList.toggle("nk-pronto", cheio);
      if (cheio) this._acenderKi();
      this._atualizarPronto();
    }
  }

  /**
   * Acende (ou apaga) a fileira de especiais.
   *
   * Duas fontes dizem a mesma coisa e elas podem discordar: a barra de ki, que
   * sabe se está cheia, e o `podeSoltar` do laço principal, que sabe também se
   * o lutador está caído, atordoado ou no meio de outro golpe. Quando o laço se
   * pronuncia, ele manda; enquanto não se pronunciou, a barra manda — e é isso
   * que faz o HUD estar certo mesmo montado sozinho, numa bancada.
   */
  _atualizarPronto() {
    const pronto = this._prontoDeclarado ?? this._kiCheio;
    if (pronto === this._prontoEscrito) return;
    this._prontoEscrito = pronto;
    this.especiaisEl.classList.toggle("nk-pronto", pronto);
  }

  /**
   * O clarão de subida de borda.
   *
   * Tirar e repor a classe com um `offsetWidth` no meio é o que reinicia a
   * animação: o navegador ignora um `animation` que o elemento já tem, e sem
   * isso o segundo carregamento da partida encheria sem aviso nenhum. Mesmo
   * truque do `announceWave` do HUD do arqueiro, pelo mesmo motivo.
   *
   * A classe FICA depois que o clarão termina, e isso é de propósito: tirá-la
   * exigiria um ouvinte de `animationend`, e um ouvinte de `animationend` não
   * dispara enquanto a aba está em segundo plano — a barra voltaria do
   * alt-tab presa no estado de acendendo. Ela é inofensiva parada (o quadro 0
   * da animação é o repouso) e o pulso toca junto; ver a folha de estilo.
   */
  _acenderKi() {
    this.kiEl.classList.remove("nk-acendeu");
    void this.kiEl.offsetWidth;
    this.kiEl.classList.add("nk-acendeu");
  }

  /**
   * O ADVERSÁRIO DO MOMENTO — quem você acertou, ou quem está sob a mira.
   *
   * Chamado UMA VEZ POR QUADRO com o que `LockOn.noPainel` escolheu (ver o
   * comentário longo na construção da placa e `NAMEK.lock.painel`): este método
   * não decide nada, só desenha. `null` esconde — mas desbotando, não de estalo.
   *
   * @param {{id, nome, cor, vida, vidaMax, dano}|null} alvo
   *   `dano` é o total que VOCÊ tirou dele na sequência corrente; 0 ou ausente
   *   quando a placa está no ar por causa da mira e não de um golpe seu.
   */
  setTarget(alvo) {
    if (!alvo) {
      /* SAI DESBOTANDO. A placa aparece e some várias vezes por minuto (é o
         ritmo da briga), e um `hidden` seco no meio de uma troca de alvo pisca.
         O relógio corre em `update`; aqui só se arma. Quem já está saindo não
         reinicia o esmaecimento — senão a placa nunca terminaria de sair. */
      if (!this.placaAlvo.hidden && this._alvoSaindo <= 0) {
        this._alvoSaindo = FADE_ALVO;
      }
      return;
    }
    /* Voltou (ou nunca saiu): cancela o esmaecimento e devolve a opacidade. */
    if (this._alvoSaindo > 0 || this._alvoOp !== 1) {
      this._alvoSaindo = 0;
      this._alvoOp = 1;
      this.placaAlvo.style.opacity = "";
    }
    this.placaAlvo.hidden = false;

    const nome = alvo.nome ?? alvo.name ?? "—";
    if (nome !== this._alvoNomeEscrito) {
      this._alvoNomeEscrito = nome;
      this.nomeAlvo.textContent = nome; // nunca innerHTML: vem da rede
    }

    const cor = alvo.cor ?? alvo.color ?? 0xff6b4a;
    if (cor !== this._alvoCor) {
      this._alvoCor = cor;
      this._pintarCor(this.retratoAlvo, cor);
    }

    /* TROCAR DE ALVO ZERA O FANTASMA. Sem isto, a placa passar de alguém com 100
       de vida para alguém com 30 desenharia uma faixa quente de 70 % que ninguém
       causou — o HUD anunciaria uma pancada que não houve. E com a mira assistida
       isso deixou de ser raro: basta varrer o cursor por dois adversários. */
    if (alvo.id != null && alvo.id !== this._alvoId) {
      this._alvoId = alvo.id;
      this.vidaAlvo.reiniciar();
    }

    /* A VIDA. Vem de `RemoteFighters`, que o `NS2C.VITALS` (10 Hz) e todo
       `NS2C.HURT` mantêm em dia — é por isso que a barra desce também quando
       quem acerta o seu alvo é um TERCEIRO, que é metade do segundo pedido. O
       fantasma da `BarraDeVida` faz o resto: ela anima de onde estava para onde
       ficou, em vez de saltar. */
    this.vidaAlvo.set(alvo.vida ?? 0, alvo.vidaMax ?? NAMEK.fighter.maxHealth);

    /* QUANTO VOCÊ TIROU. Só aparece quando o golpe foi SEU — a placa da mira não
       inventa número nenhum. O `-` é o menos tipográfico (U+2212) e não o hífen:
       ao lado de um número de 30 px o hífen lê como travessão fino. */
    const dano = Math.max(0, Math.round(alvo.dano ?? 0));
    if (dano !== this._danoEscrito) {
      this._danoEscrito = dano;
      this.danoAlvo.hidden = dano <= 0;
      if (dano > 0) {
        this.danoAlvo.textContent = `−${dano}`;
        /* Repõe a animação de pulo a cada golpe novo — sem isto o número cresce
           calado e a segunda bola de uma rajada não se anuncia. Mesmo truque do
           `_acenderKi`, e pelo mesmo motivo. */
        this.danoAlvo.classList.remove("nk-bateu");
        void this.danoAlvo.offsetWidth;
        this.danoAlvo.classList.add("nk-bateu");
      }
    }
  }

  /**
   * Qual especial está armado e se dá para soltar.
   *
   * @param {number} indiceArmado índice em `NAMEK.specialOrder`; -1 = nenhum
   * @param {boolean} podeSoltar a barra está cheia
   */
  setSpecials(indiceArmado, podeSoltar) {
    const i = Number.isInteger(indiceArmado) ? indiceArmado : -1;
    if (i !== this._armado) {
      if (this._espTiles[this._armado]) {
        this._espTiles[this._armado].classList.remove("nk-armado");
      }
      this._armado = i;
      if (this._espTiles[i]) this._espTiles[i].classList.add("nk-armado");
    }
    this._prontoDeclarado = podeSoltar === true;
    this._atualizarPronto();
  }

  /**
   * O placar.
   *
   * É também de onde saem o SEU nome e a SUA cor: a linha marcada com `eu` já
   * carrega os dois, e pedi-los num método à parte seria pedir duas vezes a
   * mesma coisa ao laço principal.
   *
   * @param {Array<{id, nome, cor, kills, deaths, eu}>} lista
   */
  setScores(lista) {
    this.placar.set(lista);

    const dados = Array.isArray(lista) ? lista : [];
    for (let i = 0; i < dados.length; i++) {
      const p = dados[i];
      if (p.eu !== true) continue;
      this._eu.id = p.id ?? null;
      const nome = p.nome ?? p.name ?? "Você";
      this._eu.nome = nome;
      if (nome !== this._nomeEuEscrito) {
        this._nomeEuEscrito = nome;
        this.nomeEu.textContent = nome; // nunca innerHTML: vem da rede
      }
      const cor = p.cor ?? p.color;
      if (cor != null && cor !== this._corEu) {
        this._corEu = cor;
        this._pintarCor(this.retratoEu, cor);
      }
      break;
    }
  }

  /**
   * Uma morte no feed.
   *
   * @param {string|object} matador
   * @param {string|object} vitima
   * @param {string} kind `"blast"`, `"burst"`, `"queda"` ou um id de especial
   */
  killFeed(matador, vitima, kind) {
    this.feed.push(matador, vitima, kind, this._eu);
  }

  /**
   * Estado de morto.
   *
   * @param {number|null} segundosRestantes `null` sai do estado
   */
  setDead(segundosRestantes) {
    if (segundosRestantes == null) {
      if (!this.morteEl.hidden) {
        this.morteEl.hidden = true;
        this.el.classList.remove("nk-morto");
        this._morteNum = null;
      }
      return;
    }
    if (this.morteEl.hidden) this.el.classList.add("nk-morto");
    this.morteEl.hidden = false;

    /* Arredonda para CIMA: enquanto sobrar meio segundo, a tela diz "1". Uma
       contagem que passa por zero e fica lá esperando parece travada. */
    const n = Math.max(0, Math.ceil(segundosRestantes));
    if (n === this._morteNum) return;
    this._morteNum = n;
    this.morteNumEl.textContent = String(n);
    this.morteSubEl.textContent =
      n > 0 ? "você volta voando" : "renascendo…";
  }

  /**
   * A faixa grande do meio da tela.
   *
   * @param {string} texto
   * @param {number} segundos
   */
  banner(texto, segundos = 2.5) {
    this.faixaEl.textContent = String(texto); // pode conter nome: textContent
    this.faixaEl.hidden = false;
    // Reinicia a animação de entrada — ver `_acenderKi`, mesmo motivo.
    this.faixaEl.style.animation = "none";
    void this.faixaEl.offsetWidth;
    this.faixaEl.style.animation = "";
    this._faixaT = segundos;
  }

  /** Um aviso curto no canto. */
  toast(texto) {
    const el = document.createElement("div");
    el.className = "nk-aviso";
    el.textContent = String(texto); // idem: pode carregar nome de jogador
    this.avisosEl.appendChild(el);
    this._avisos.push({ el, t: AVISO_VIDA });
    while (this._avisos.length > 4) this._avisos.shift().el.remove();
  }

  /**
   * Marca de dano na direção de quem bateu.
   *
   * @param {number} anguloTela rad. **0 é a frente** (topo da tela) e o ângulo
   *   cresce no sentido horário — π/2 é a direita, π são as costas. É a mesma
   *   convenção da rotação do CSS, que é o que torna esta função uma linha em
   *   vez de uma conversão de sinal a mais para alguém errar.
   */
  damageFrom(anguloTela) {
    const m = this._marcas[this._marcaProxima];
    this._marcaProxima = (this._marcaProxima + 1) % MARCAS;
    const graus = (anguloTela * 180) / Math.PI;
    m.el.style.transform = `rotate(${graus.toFixed(1)}deg)`;
    m.t = MARCA_VIDA;
    m.op = -1; // força a primeira escrita de opacidade no `update`
  }

  /**
   * O clarão vermelho de quando VOCÊ leva dano.
   *
   * Pega o MAIOR entre o que já estava aceso e o que chegou, em vez de somar:
   * seis bolas de ki em meio segundo não podem produzir uma tela opaca que
   * esconde justamente quem está atirando.
   *
   * @param {number} intensidade 0..1
   */
  hurtFlash(intensidade) {
    const v = clamp01(intensidade);
    if (v > this._flash) this._flash = v;
  }

  /**
   * Os PINOS dos outros lutadores — a bússola. Ver o comentário do construtor.
   *
   * A lista chega ORDENADA e o pool é reaproveitado por índice, e as duas
   * coisas juntas são o que impede o pino de piscar: se a ordem mudasse de um
   * quadro para o outro, o mesmo nó do DOM passaria a descrever outra pessoa e
   * a transição de opacidade recomeçaria do zero em toda troca. Quem ordena é
   * quem monta a lista (`NamekGame.bussola`), por distância.
   *
   * @param {{angulo:number|null, x:number, y:number, dist:number, cor:number,
   *          travado:boolean, forca:number, boss:boolean, nome:string}[]} lista
   *   `angulo` não-nulo = está FORA da tela, e o valor é o rumo em radianos;
   *   nulo = está na tela, e `x`/`y` são as coordenadas normalizadas (−1..1).
   *   `forca` é 0..1 e é a opacidade — é ela que faz o pino nascer e morrer
   *   desbotando em vez de aparecer de um estalo.
   *   `boss` marca o pino do CHEFE: ele fica maior, na cor dele, e o rótulo
   *   passa a dizer o NOME junto da distância — ver `setAneis` para o argumento
   *   dos três sinais somados.
   */
  setMarcas(lista) {
    const marcas = lista ?? SEM_MARCAS;
    for (let i = 0; i < this._pinos.length; i++) {
      const p = this._pinos[i];
      const d = marcas[i];
      /* MOSTRAR E ESCONDER OLHAM PARA O ELEMENTO, e não para a opacidade — e
       * isto é um bug pago, encontrado na bancada com o pino do chefe.
       *
       * A regra era `if (p.op !== 0) esconder` / `if (p.op === 0) mostrar`, ou
       * seja, a opacidade fazia as vezes de "está na tela". Só que o pool nasce
       * com `op: -1` e o nó nasce `hidden`: um pino que recebesse uma marca na
       * PRIMEIRA vez em que fosse usado nunca entrava em `op === 0` e ficava
       * escondido para sempre, com a opacidade certa escrita e ninguém vendo
       * nada. No jogo isso se consertava por acidente — os primeiros quadros de
       * uma partida não têm ninguém a mais de 90 m, então todo slot passava pelo
       * ramo vazio antes do primeiro uso —, e "funciona por acidente" é
       * exatamente o que se paga caro no dia em que o acidente não acontece: o
       * pino do chefe é o slot 0 e pode ser o primeiro a ser usado.
       *
       * Perguntar ao próprio nó não tem esse buraco, e `hidden` é uma
       * propriedade booleana: escrevê-la com o mesmo valor não custa layout. */
      if (!d) {
        if (!p.el.hidden) {
          p.el.hidden = true;
          /* Força a reescrita da opacidade na próxima aparição. */
          p.op = -1;
        }
        continue;
      }
      if (p.el.hidden) p.el.hidden = false;

      const fora = d.angulo != null;
      if (fora !== p.fora) {
        p.fora = fora;
        p.el.classList.toggle("fora", fora);
      }
      if (d.travado !== p.travado) {
        p.travado = d.travado;
        p.el.classList.toggle("travado", d.travado === true);
      }
      /* O PINO DO CHEFE. A classe faz o resto (tamanho, traço, halo) na folha de
         estilo; aqui só se diz que ele é o chefe, e só quando muda. */
      const chefe = d.boss === true;
      if (chefe !== p.chefe) {
        p.chefe = chefe;
        p.el.classList.toggle("chefe", chefe);
        /* Força a reescrita do rótulo: ele muda de formato ("240 m" ↔ "FREEZA
           240 m") e a comparação abaixo é só sobre o número. */
        p.dist = -1;
      }
      if (d.cor !== p.cor) {
        p.cor = d.cor;
        p.el.style.setProperty("--nk-pino-cor", corHex(d.cor));
      }

      if (fora) {
        /* Elipse inscrita na tela, como no marcador de rocha: a seta encosta na
           borda mais próxima daquele rumo em vez de andar num círculo que sobra
           nos cantos. Os 42/38 são os mesmos de lá — a mesma tela, a mesma
           margem para o pino não ser cortado. */
        const x = Math.cos(d.angulo) * 42;
        const y = -Math.sin(d.angulo) * 38;
        p.el.style.transform = `translate(-50%, -50%) translate(${x}vw, ${y}vh)`;
        /* A SETA gira; o resto do pino, não. Ninguém lê "180 m" de cabeça para
           baixo — é a mesma razão pela qual a rotação mora na seta lá também. */
        p.el.style.setProperty("--nk-pino-giro", `${90 - (d.angulo * 180) / Math.PI}deg`);
      } else {
        p.el.style.transform = `translate(-50%, -50%) translate(${d.x * 50}vw, ${-d.y * 50}vh)`;
        p.el.style.setProperty("--nk-pino-giro", "0deg");
      }

      /* Opacidade em degraus de 5 %: o valor é contínuo (é uma rampa de
         distância) e escrevê-lo cru mandaria um estilo novo ao DOM em todo
         quadro em que o lutador se mexesse um centímetro. Vinte degraus são
         mais do que o olho separa numa transparência. */
      const op = Math.round(clamp01(d.forca) * 20) / 20;
      if (op !== p.op) {
        p.op = op;
        p.el.style.opacity = op;
      }

      const dist = d.dist;
      if (dist !== p.dist) {
        p.dist = dist;
        /* O NOME vai junto da distância no pino do chefe, e é a peça que faz o
           marcador dele funcionar quando ele está FORA da tela — ali não há
           corpo para o anel circular nem cor de gi para reconhecer, e uma seta
           roxa a mais no meio de catorze setas não diz quem é. `textContent`
           como sempre: o nome sai do config, mas a regra do arquivo é que texto
           não passa por `innerHTML`. */
        p.dEl.textContent = chefe
          ? `${(d.nome || "chefe").toUpperCase()} · ${dist} m`
          : `${dist} m`;
      }
    }
  }

  /**
   * O retículo do centro da tela.
   *
   * O `"travado"` sobrevive na assinatura e na folha de estilo, mas o JOGO não o
   * pede mais: ele era o retículo do alvo preso pela tecla `R`, que saiu. Ficou
   * porque a bancada (`dev/namek-hud.html`) exercita os três estados e porque um
   * `if` a menos aqui não paga arrancar uma classe de CSS que já está escrita —
   * mas quem procurar por onde ele acende em jogo não vai achar, e não é bug.
   *
   * `"oculto"` é o quarto e ele não é um estado de mira: é a mira SAINDO da
   * tela, e existe para as cenas cinemáticas do boss (a chegada e a morte). Ali
   * a câmera está a dezessete metros dele, do outro lado da arena, e um retículo
   * no meio do quadro apontaria para um lugar que não quer dizer nada — além de
   * ser exatamente o que uma apresentação de jogo não tem. Ver `NamekGame.step`.
   *
   * @param {"livre"|"travado"|"carregando"|"oculto"} estado
   */
  setCrosshair(estado) {
    if (estado === this._mira) return;
    this._mira = estado;
    this.miraEl.classList.toggle("nk-travado", estado === "travado");
    this.miraEl.classList.toggle("nk-carregando", estado === "carregando");
    /* `visibility` e não `display`: o retículo é posicionado por CSS no centro
       da tela e tirá-lo do fluxo faria os irmãos dele se moverem por um quadro
       ao voltar. */
    this.miraEl.style.visibility = estado === "oculto" ? "hidden" : "";
  }

  /**
   * OS CÍRCULOS DE TODO MUNDO — e o aceso é para onde o tiro vai.
   *
   * Ver o comentário longo na construção de `aneisEl`. Aqui só a escrita, e ela
   * é toda por comparação: quinze anéis reposicionados a 60 Hz são novecentas
   * escritas de estilo por segundo se ninguém verificar antes se o valor mudou.
   *
   * @param {Array<{id,x,y,dist,raio,visivel,sob,cor,boss,nome}>} lista o que
   *   `LockOn.naTelaTodos` publica — a MESMA projeção que escolheu o alvo da
   *   assistência, e é isso que garante que o anel aceso e o alvo do tiro nunca
   *   discordem. O CHEFE vem nela como mais um registro, com `boss: true`.
   */
  setAneis(lista) {
    const marcas = lista ?? SEM_MARCAS;
    const h = this.el.clientHeight;
    const w = this.el.clientWidth;

    for (let i = 0; i < this._aneis.length; i++) {
      const a = this._aneis[i];
      const d = marcas[i];

      /* Todo lutador visível ganha o seu, sem exceção — o segundo marcador que
         existia (o anel vermelho da trava) saiu junto com a tecla `R`, e com ele
         saiu a única razão de pular alguém desta lista. */
      const mostrar = !!d && d.visivel;
      if (!mostrar) {
        if (a.visivel) {
          a.visivel = false;
          a.el.hidden = true;
        }
        continue;
      }
      if (!a.visivel) {
        a.visivel = true;
        a.el.hidden = false;
      }

      /* O CHEFE, antes da geometria: é ele que muda o piso do raio. */
      const chefe = d.boss === true;
      if (chefe !== a.chefe) {
        a.chefe = chefe;
        a.el.classList.toggle("nk-chefe", chefe);
      }
      if (chefe) {
        const nome = (d.nome || "").toUpperCase();
        if (nome !== a.nome) {
          a.nome = nome;
          a.nomeEl.textContent = nome; // sempre textContent, nunca innerHTML
        }
        a.el.style.setProperty("--nk-anel-cor", corHex(d.cor, "#c21ad8"));
      }

      const px = Math.round(((d.x + 1) / 2) * w);
      const py = Math.round(((1 - d.y) / 2) * h);
      /* `d.raio` já vem em frações da MEIA-ALTURA da tela, resolvido pela ótica
         viva da câmera em `LockOn._marcar` — inclusive o campo de visão, que
         abre com a arrancada. Aqui só se converte para pixels. O piso de 10 px é
         o que mantém o marcador visível quando o adversário é um ponto: um
         círculo de três pixels não marca nada.
         O piso do CHEFE é maior (22 px) e não é enfeite: a 500 m o corpo dele
         tem quatro pixels, e um marcador do tamanho do de um lutador o poria
         exatamente na categoria de que ele precisa se distinguir. Ele é o
         objetivo da partida — à distância, tem de ser o maior sinal da tela. */
      const r = Math.max(chefe ? 22 : 10, Math.round(d.raio * h * 0.5));

      if (px !== a.x || py !== a.y || r !== a.r) {
        a.x = px;
        a.y = py;
        a.r = r;
        a.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
        a.el.style.width = `${r * 2}px`;
        a.el.style.height = `${r * 2}px`;
      }

      const sob = d.sob === true;
      if (sob !== a.sob) {
        a.sob = sob;
        a.el.classList.toggle("nk-sob", sob);
      }
    }
  }

  /**
   * A ajuda de controles.
   *
   * Quem a abre e a fecha é o laço do jogo — o HUD não escuta teclado, e não
   * vai começar a escutar por causa de um painel. Ver a tabela `CONTROLES`.
   */
  showHelp(visivel) {
    const v = visivel === true;
    if (v === this._ajudaVisivel) return;
    this._ajudaVisivel = v;
    this.ajudaEl.hidden = !v;
  }

  /* ---------------------------------------------------------------- relógio */

  /**
   * Tudo que tem tempo próprio: o fantasma das barras, o clarão, as marcas de
   * dano, a faixa, os avisos e o feed.
   *
   * Nenhum deles usa `setTimeout`, e isso é decisão de projeto: um `dispose()`
   * no meio de uma troca de modo não pode deixar temporizadores pendurados
   * mexendo em nós que já saíram do documento — e o que o jogo pausa deve
   * pausar junto, senão a faixa "VOCÊ ENTROU NA TEMPESTADE" some enquanto
   * ninguém está olhando.
   */
  update(dt) {
    /* Uma aba que volta do segundo plano devolve um `dt` de vários segundos, e
       ele apagaria tudo de uma vez. O teto é o mesmo remédio de sempre. */
    const d = Math.min(Math.max(dt || 0, 0), 0.1);

    this.vida.update(d);
    if (!this.placaAlvo.hidden) {
      this.vidaAlvo.update(d);
      /* O ESMAECIMENTO DA PLACA DO ALVO. Ele corre aqui, e não numa transição de
         CSS, pelo mesmo motivo que tudo neste arquivo tem relógio próprio: um
         `transition` não pausa quando o jogo pausa, e `[hidden]` é `display:
         none` — que cancela transição em vez de animá-la.

         Em degraus de 5 %, como os pinos da bússola: o valor é contínuo e
         escrevê-lo cru mandaria um estilo novo ao DOM em cada um dos vinte
         quadros da saída. */
      if (this._alvoSaindo > 0) {
        this._alvoSaindo -= d;
        if (this._alvoSaindo <= 0) {
          this._alvoSaindo = 0;
          this._alvoOp = 1;
          this.placaAlvo.hidden = true;
          this.placaAlvo.style.opacity = "";
          /* A placa volta do zero na próxima vez: sem isto, reaparecer com o
             mesmo adversário pularia o `reiniciar()` do fantasma e a barra
             desenharia como pancada a vida que ele perdeu enquanto ela estava
             fora da tela. */
          this._alvoId = null;
          this._danoEscrito = -1;
          this.danoAlvo.hidden = true;
        } else {
          const op = Math.round((this._alvoSaindo / FADE_ALVO) * 20) / 20;
          if (op !== this._alvoOp) {
            this._alvoOp = op;
            this.placaAlvo.style.opacity = String(op);
          }
        }
      }
    }
    this.feed.update(d);

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - FLASH_DECAI * d);
      const op = Math.round(this._flash * 100) / 100;
      if (op !== this._flashEscrito) {
        this._flashEscrito = op;
        this.flashEl.style.opacity = String(op);
      }
    }

    for (let i = 0; i < this._marcas.length; i++) {
      const m = this._marcas[i];
      if (m.t <= 0) continue;
      m.t -= d;
      /* Segura opaca na primeira metade e apaga na segunda: uma marca que
         começa a sumir no quadro em que nasce é uma marca que não se lê. */
      const f = Math.max(0, m.t / MARCA_VIDA);
      const op = Math.round(Math.min(1, f * 2) * 100) / 100;
      if (op !== m.op) {
        m.op = op;
        m.el.style.opacity = String(op);
      }
    }

    if (this._faixaT > 0) {
      this._faixaT -= d;
      if (this._faixaT <= 0) this.faixaEl.hidden = true;
    }

    for (let i = this._avisos.length - 1; i >= 0; i--) {
      const a = this._avisos[i];
      a.t -= d;
      if (a.t > 0) continue;
      a.el.remove();
      this._avisos.splice(i, 1);
    }
  }

  /* ----------------------------------------------------------------- limpeza */

  /** Tira o HUD do documento e devolve o estilo. Não sobra nó nem temporizador. */
  dispose() {
    this.feed.dispose();
    this.placar.dispose();
    this.el.remove();
    this._marcas.length = 0;
    this._avisos.length = 0;
    this._espTiles.length = 0;
    this._soltarEstilo();
  }

  /* ---------------------------------------------------------------- interno */

  /** Pinta um retrato na cor do lutador — e o cabelo numa versão clareada. */
  _pintarCor(retrato, cor) {
    const base = corHex(cor, "#9ff0ff");
    retrato.style.setProperty("--nk-cor", base);
    retrato.style.setProperty(
      "--nk-cabelo",
      typeof cor === "number" ? clarear(cor) : base,
    );
  }
}
