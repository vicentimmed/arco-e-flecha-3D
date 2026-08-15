/* ---------------------------------------------------------------------------
   O HUD de Namekusei.

   DOM puro, sem framework e sem dependência nova — o padrão da casa, e o mesmo
   de `src/ui/hud.js`. O que muda é o jogo por baixo: lá se mira parado e o HUD
   informa; aqui se voa a 96 m/s no meio de uma explosão azul e o HUD tem de
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
   como explicar em uma linha. */
const CONTROLES = [
  {
    titulo: "Voar",
    itens: [
      [["W", "A", "S", "D"], "ir na direção do olhar"],
      [["Shift"], "correr no chão"],
      [["Espaço"], "subir"],
      [["Ctrl"], "descer"],
      [["F"], "decolar e pousar"],
      [["Botão dir."], "arrancada de ki"],
    ],
  },
  {
    titulo: "Lutar",
    itens: [
      [["Botão esq."], "rajada de ki — o tiro comum"],
      [["C"], "segure: carregar ki"],
      [["1", "2", "3", "4"], "armar o especial"],
      [["Q"], "onda de choque"],
      [["Tab"], "travar o alvo"],
    ],
  },
  {
    titulo: "Sala",
    itens: [[["Esc"], "menu geral"]],
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
/** s — vida de um aviso de canto. */
const AVISO_VIDA = 2.4;
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
    const hue = Math.round(112 * Math.pow(f, 1.5));
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

    /* ----------------------------------------------------- a placa do alvo */
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
    const linhaVidaAlvo = document.createElement("div");
    linhaVidaAlvo.className = "nk-linha";
    linhaVidaAlvo.append(this.vidaAlvo.el, this.vidaAlvo.numEl);
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

    this.miraEl = document.createElement("div");
    this.miraEl.className = "nk-mira";
    this.miraEl.innerHTML = `
      <div class="nk-mira-anel"></div>
      <i class="nk-t nk-t1"></i><i class="nk-t nk-t2"></i>
      <i class="nk-h nk-h1"></i><i class="nk-h nk-h2"></i>
      <i class="nk-ponto"></i>`;

    this.faixaEl = document.createElement("div");
    this.faixaEl.className = "nk-faixa nk-contorno";
    this.faixaEl.hidden = true;

    this.avisosEl = document.createElement("div");
    this.avisosEl.className = "nk-avisos";

    this.morteEl = this._montarMorte();
    this.ajudaEl = this._montarAjuda();

    this.el.append(
      this.flashEl,
      this.marcasEl,
      this.miraEl,
      this.placaEu,
      this.placaAlvo,
      this.faixaEl,
      this.avisosEl,
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
    this._armado = -1;
    /** O que o laço declarou em `setSpecials`; `null` = ainda não se pronunciou. */
    this._prontoDeclarado = null;
    this._prontoEscrito = false;
    this._mira = null;
    this._flash = 0;
    this._flashEscrito = -1;
    this._faixaT = 0;
    this._avisos = [];
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
    rodape.textContent =
      "Só o Esc é atalho geral — todas as outras teclas valem dentro de Namekusei. " +
      "O especial só sai com a barra de ki cheia: segure C para carregar.";

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
    const cheio = f >= NAMEK.ki.specialThreshold - 0.0005;
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
   * O alvo travado (lock-on), ou `null`.
   *
   * @param {{id, nome, cor, vida, vidaMax}|null} alvo
   */
  setTarget(alvo) {
    if (!alvo) {
      if (!this.placaAlvo.hidden) {
        this.placaAlvo.hidden = true;
        this._alvoId = null;
      }
      return;
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

    /* TROCAR DE ALVO ZERA O FANTASMA. Sem isto, travar em alguém com 30 de vida
       logo depois de ter travado em alguém com 100 desenharia uma faixa quente
       de 70 % que ninguém causou — o HUD anunciaria uma pancada que não houve. */
    if (alvo.id != null && alvo.id !== this._alvoId) {
      this._alvoId = alvo.id;
      this.vidaAlvo.reiniciar();
    }

    this.vidaAlvo.set(alvo.vida ?? 0, alvo.vidaMax ?? NAMEK.fighter.maxHealth);
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

  /** @param {"livre"|"travado"|"carregando"} estado */
  setCrosshair(estado) {
    if (estado === this._mira) return;
    this._mira = estado;
    this.miraEl.classList.toggle("nk-travado", estado === "travado");
    this.miraEl.classList.toggle("nk-carregando", estado === "carregando");
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
    if (!this.placaAlvo.hidden) this.vidaAlvo.update(d);
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
