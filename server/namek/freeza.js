/* ---------------------------------------------------------------------------
   FREEZA — o boss, e a SALA é dona dele.

   Este arquivo é a autoridade sobre três coisas que não podem divergir entre
   duas telas: **a vida dele, a posição dele e o dano que os golpes dele fazem.**
   O cliente (`src/namek/boss/`) desenha o corpo, desenha os poderes e reporta
   acerto (`NC2S.FREEZA_HIT`); nada mais.

   ============================================================================
   1. POR QUE ELE NÃO É UM LUTADOR
   ============================================================================

   A tentação é grande e ela está errada. Um `NamekBot` já tem corpo, pose,
   máquina de estados, projéteis, esquiva e integração contra o relevo — e um
   boss "é só um bot com muita vida". Só que ele não é:

   • **A vida é outra ordem de grandeza.** 3 500 a 34 720 contra 100. Todo lugar
     que divide por `maxHealth` (a barra do HUD, o desconto de alvo dos bots, a
     contagem de atordoamento) daria número sem sentido.
   • **Ele não renasce, não pontua, não ocupa vaga.** Entrar em `todos()` o
     poria no `VITALS`, no `SCORES`, no `STATES` e na conta de `lotacao` — e o
     cliente montaria para ele um `Fighter` de 1,78 m com gi e cabelo.
   • **Ele não é atordoável.** O golpe que derruba (`fighter.stagger`) existe
     para abrir a janela do especial contra alguém que voa a 64 m/s. Um boss que
     cai no chão a cada cinco bolinhas não é um boss, é um alvo.
   • **Os poderes dele são resolvidos AQUI.** Um bot declara acerto pelo mesmo
     caminho de um humano porque o modelo de confiança do modo é "quem atira
     julga o próprio acerto". O Freeza não tem cliente, então não há em quem
     confiar nem com quem dividir: o servidor simula os projéteis dele e cobra a
     vida direto, o que aliás é a única parte do jogo inteiro que é
     autoritativa de ponta a ponta.

   O que ele COMPARTILHA com o resto é o que faz sentido compartilhar: a lista
   uniforme de corpos da sala (`montarCorpos`), para os bots o enxergarem e os
   projéteis deles o alcançarem; `NamekRoom.aplicarDano`, para o dano que ele
   causa passar pelo mesmo funil de invulnerabilidade, guarda, placar e morte que
   todo o resto; e `NamekRoom.cratera`, para os buracos dele serem os mesmos
   buracos em todas as telas.

   ============================================================================
   2. O CONTRATO COM A SALA (a API pública)
   ============================================================================

       sala.freeza.entrar(dificuldade)   põe o boss em campo
       sala.freeza.sair()                tira
       sala.freeza.vivo                  booleano
       sala.freeza.aoMorrer = (agora) => {}   chamado quando ele cai

   Nada mais deste arquivo é público. `entrar` é idempotente (chamar duas vezes
   não põe dois bosses), `sair` também, e `aoMorrer` é uma PROPRIEDADE e não um
   evento porque só há um interessado por vez — quem quiser encadear guarda o
   anterior, que é o mesmo padrão de `NamekRoom.onEmpty` e de `NamekField.onLava`.

   ============================================================================
   3. A LUTA
   ============================================================================

   Uma máquina de estados de quatro casos (`caçar`, `atacar`, `recuar`,
   `especial`) sobre um alvo que ele TROCA a cada poucos segundos — ver a
   política inteira no comentário de `NAMEK.freeza.alvo`, que é onde ela está
   documentada porque é lá que ela é ajustada. O resumo:

   • Ele nunca fica no mesmo alvo duas reavaliações seguidas havendo outro vivo
     (é a `penaRepetir`);
   • quem mais o feriu ganha atenção (`pesoRaiva`), e essa raiva decai;
   • e os dois golpes de área — a Death Ball e a onda — não olham para o alvo:
     eles pegam quem estiver por perto. É por eles que ele "luta com todos ao
     mesmo tempo" de verdade, e não por revezamento.
   --------------------------------------------------------------------------- */

import {
  NAMEK,
  dificuldadeFreeza,
  vidaDoFreeza,
  danoNoFreeza,
} from "../../src/shared/namek/config.js";
import { NS2C } from "../../src/shared/namek/protocol.js";
/* O multiplicador do Super Saiyajin contra o boss — uma função e um gancho de
   uma linha em `levarDano`. Ver `server/namek/ssj.js`. */
import { ganhoContraFreeza, resistenciaAoFreeza } from "./ssj.js";

const F = () => NAMEK.freeza;

/** Índices da pose que viajam em `FREEZA_STATE.u`. Ver o protocolo. */
const POSE = {
  parado: 0,
  investida: 1,
  rajada: 2,
  raio: 3,
  esfera: 4,
  onda: 5,
  dor: 6,
};

/* s — de quanto em quanto tempo o acúmulo de dano vira um `FREEZA_HURT`.
 *
 * 8 Hz, e o número é o mesmo raciocínio do `HURT` contínuo da sala (6 Hz): a
 * barra do topo tem ~600 px e desce alguns pixels por bola de ki, então mandar
 * uma mensagem por acerto seria pagar rede para desenhar o mesmo pixel. Um
 * pouco mais rápido que o `HURT` porque esta barra é a única coisa na tela que
 * diz se a luta está indo bem — ela precisa responder ao gatilho. */
const HURT_PASSO = 125;

/** m — folga do acerto declarado, a mesma régua de `NAMEK.net.hitTolerance`. */
const TOLERANCIA = NAMEK.net.hitTolerance;

/** s — invulnerabilidade da ENTRADA. O tempo de o corpo aparecer e a barra
 *  subir na tela de todo mundo antes de alguém já estar cavando nela. */
const ENTRADA_INVULN = 2.2;

/** Teto de bolas da rajada vivas ao mesmo tempo. Cinco por surto e ~2,3 s de
 *  voo até 220 m: doze é folga de sobra e é o teto contra um caso patológico. */
const MAX_BOLAS = 24;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v) => Math.round(v * 1000) / 1000;
const round2 = (v) => Math.round(v * 100) / 100;

/** Amortecimento exponencial, independente do passo. Mesma função de `bots.js`. */
function damp(a, b, k, dt) {
  return b + (a - b) * Math.exp(-k * dt);
}

/** Distância de um ponto ao SEGMENTO (a→b). A conta do §4 do plano. */
function distSeg(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const u2 = ux * ux + uy * uy + uz * uz;
  let t = u2 > 1e-9 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / u2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + ux * t);
  const dy = py - (ay + uy * t);
  const dz = pz - (az + uz * t);
  return Math.hypot(dx, dy, dz);
}

/* ============================================================================
   A classe
   ========================================================================== */

export class NamekFreeza {
  /** @param {import("./room.js").NamekRoom} sala */
  constructor(sala) {
    this.sala = sala;

    /** Está em campo E vivo? É o `vivo` do contrato. */
    this.vivo = false;
    /**
     * **Ele foi DERRUBADO nesta partida?** Parte do contrato público, e a marca
     * que destrava o Super Saiyajin livre (ver `NAMEK.ssj.livreAposOFreeza` e
     * `server/namek/ssj.js: freezaDerrotado`).
     *
     * Ela é diferente de `!vivo` de propósito, e a diferença é a regra inteira:
     * fora de campo ele pode estar por nunca ter entrado, por ter CAÍDO ou por
     * ter sido RETIRADO — `sair()` é o caminho do clima voltando para `dia`, e
     * desistir da luta não pode pagar o mesmo prêmio de a ter vencido. Só
     * `morrer` acende esta marca; `entrar` e `sair` a apagam.
     */
    this.derrotado = false;
    /**
     * Chamado quando ele morre: `sala.freeza.aoMorrer = (agora) => {…}`.
     *
     * Propriedade e não lista de ouvintes: só há um interessado por vez (quem
     * orquestra a partida), e quem quiser encadear guarda o anterior. É o mesmo
     * padrão de `NamekRoom.onEmpty`.
     * @type {((agora:number)=>void)|null}
     */
    this.aoMorrer = null;

    this.dificuldadeId = NAMEK.freeza.dificuldadePadrao;
    this.dif = dificuldadeFreeza(this.dificuldadeId);

    this.vida = 0;
    this.vidaMax = 0;
    this.ki = NAMEK.freeza.kiMax;

    /* ------------------------------------------------------------- o corpo --
       Um objeto SÓ, criado uma vez e reciclado a cada entrada. Ele é o mesmo
       registro que entra na lista uniforme da sala (ver `corpoNaLista`), e é por
       isso que os nomes dos campos são os de lá: `id`, `x`, `y`, `z`, `alive`,
       `invuln`. Um objeto novo por quadro aqui seria alocação em regime, que é o
       que o §3 do plano proíbe. */
    this.corpo = {
      id: NAMEK.freeza.id,
      /* O `ref` é um ESPANTALHO, e não `this`.
       *
       * Ele existe porque a lista uniforme é varrida por três sistemas que não
       * conhecem o boss e que fazem `c.ref.<coisa>` sem perguntar: a onda de
       * empurrão (`NamekRoom.onda`), a chuva de meteoros (`planetas.js`) e a
       * fuga do fim (`fim.js`). Passar a instância do boss ali seria oferecer a
       * eles um objeto com outra forma — e o primeiro `vitima.score.deaths++`
       * de um meteoro derrubaria o passo da sala inteira com um TypeError.
       *
       * O espantalho tem a forma de um lutador e está **morto**: `alive: false`
       * faz `aplicarDano` sair na primeira linha, `score` faz `matar` não
       * estourar, e `isBot: false` mantém o boss fora do laço que reescreve as
       * posições dos bots. O boss continua sendo alcançável por quem PRECISA
       * alcançá-lo — os bots miram pelo corpo, não pelo `ref`, e o dano deles
       * chega por `NamekRoom.doBot` → `acertoDeBot` —, e imune ao resto.
       *
       * O `alive` do CORPO (logo abaixo) é outra coisa e é verdadeiro: é ele que
       * os bots leem para escolher alvo. Os dois campos têm o mesmo nome e
       * respondem a perguntas diferentes: "dá para mirar nisto?" e "isto é um
       * lutador vivo da sala?". */
      ref: {
        id: NAMEK.freeza.id,
        isBot: false,
        alive: false,
        health: 0,
        invulnUntil: 0,
        respawnAt: 0,
        score: { kills: 0, deaths: 0 },
        state: null,
      },
      isBot: false,
      /** A marca que os bots leem para o preferirem. Ver `escolherAlvo`. */
      boss: true,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      alive: false,
      invuln: false,
      health: 0,
    };

    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    /* ------------------------------------------------------------- a briga -- */
    this.alvoId = null;
    this.tTroca = 0;
    /** id → raiva acumulada (dano que aquela pessoa causou, decaindo). */
    this.raiva = new Map();
    /** +1 ou −1: de que lado ele circunda. */
    this.lado = 1;
    this.tLado = 0;

    /* --------------------------------------------------------- os relógios --
       Um por golpe, em segundos que faltam. Todos correm juntos em `passo` e é
       a `cadencia` da dificuldade que os divide — ver `NAMEK.freeza.dificuldades`. */
    this.tRajada = 0;
    this.tRaio = 0;
    this.tEsfera = 0;
    this.tOnda = 0;
    this.tTeleporte = 0;

    /** A pose em curso: `{ tipo, t, dur, dir, alvo }` ou null. */
    this.pose = null;
    /** Quantas bolas faltam do surto em curso, e o relógio entre elas. */
    this.surto = 0;
    this.tBola = 0;
    this.mao = 0;

    /** As bolas da rajada em voo. Ver `passoDasBolas`. */
    this.bolas = [];
    /** A Death Ball em voo, ou null. */
    this.esfera = null;
    /** Id incremental das bolas, só para o pool do cliente não confundir. */
    this.seqBola = 1;

    /* ----------------------------------------------------------- a barra ---- */
    this.danoAcum = 0;
    this.danoPor = null;
    this.danoKind = "blast";
    this.hurtAte = 0;
    this.invulnAte = 0;
    /** Dano recebido dentro da janela do teleporte. Ver `talvezTeleportar`. */
    this.danoJanela = 0;
    this.janelaAte = 0;

    /** ms — quando a pose sai. A mesma taxa das poses de lutador. */
    this.proximaPose = 0;
    this.tAura = 0;
    /** A lotação do quadro anterior. Ver o topo de `passo`. */
    this._nUltimo = 0;
    /** Aceso no quadro de um teleporte, lido e apagado por `transmitir`. */
    this._teleportou = false;

    /* ------------------------------------------------------- A CHEGADA -----
       Três relógios em ms para a cena de apresentação (`NAMEK.freeza.chegada`).
       `chegadaDe` é o instante em que ele apareceu no alto e `descidaAte` o
       instante em que os pés dele chegam à cota de briga; `cenaAte` é o fim da
       cena inteira (descida + os cinco segundos de órbita da câmera), e é ele
       que proíbe qualquer golpe.

       Dois relógios e não um porque as duas coisas terminam em momentos
       diferentes: **ele volta a voar sozinho antes de a câmera devolver o jogo
       ao jogador**, e é isso que faz a última meia volta da órbita mostrar o
       boss já manobrando em vez de um boneco parado no ar. */
    this.chegadaDe = 0;
    this.descidaAte = 0;
    this.cenaAte = 0;
    /** m — a cota em que a descida termina. Calculada na entrada, contra o
     *  relevo do ponto de queda: o meio da arena pode ser encosta. */
    this.chegadaY = 0;

    /* ----------------------------------------------- A LENTIDÃO DA GENKI ---
       ms — a janela em que ele voa a `NAMEK.freeza.lentidao.fator` da
       velocidade. Ver `avisarGenkiDama`. */
    this.lentoDe = 0;
    this.lentoAte = 0;

    /* ------------------------------------------------------- A QUEDA -------
       ms. `quedaAte` é o fim da tonteira NO CHÃO e só começa a correr quando o
       corpo toca o relevo — é o mesmo desenho de `FighterController.derrubar`,
       e pelo mesmo motivo: ele é derrubado a 78 m de altura e a punição é o
       tempo no chão, não o tempo caindo. `quedaLivreEm` é a carência contra
       dois jogadores revezando ondas. */
    this.caindo = false;
    this.quedaAte = 0;
    this.quedaLivreEm = 0;
    /** Já cavou a cratera desta queda? Uma por tombo. */
    this._cravou = false;
  }

  /* ================================================= a cena e os estados ==
   *
   * Três perguntas que o resto do arquivo faz o tempo todo, escritas uma vez
   * cada. Elas moram juntas porque as três respondem à mesma coisa vista de
   * ângulos diferentes: **ele está disponível para lutar agora?** */

  /** A cena de apresentação ainda está correndo? Nela ele não escolhe alvo, não
   *  atira e não pode ser ferido. */
  emCena(agora) {
    return agora < this.cenaAte;
  }

  /** Ele ainda está DESCENDO do céu? Só a descida move o corpo; a órbita da
   *  câmera continua depois dela, com ele já voando normalmente. */
  descendo(agora) {
    return agora < this.descidaAte;
  }

  /** Está caído no chão (ou a caminho dele)? */
  derrubado() {
    return this.caindo;
  }

  /**
   * O multiplicador de velocidade do quadro.
   *
   * Duas coisas o mexem e elas se MULTIPLICAM em vez de uma vencer a outra: a
   * dificuldade (o eixo permanente) e a lentidão da Genki Dama (a janela). Um
   * boss em `absoluto` sob uma Genki Dama voa a 1,05 × 0,5 = 52,5 % — ou seja, a
   * lentidão continua sendo lentidão no nível mais difícil, que é onde ela mais
   * precisa valer.
   */
  fatorDeVelocidade(agora) {
    const base = Math.max(0.2, this.dif.mover);
    if (agora < this.lentoDe || agora >= this.lentoAte) return base;
    return base * NAMEK.freeza.lentidao.fator;
  }

  /**
   * **"Uma Genki Dama foi atirada contra ele."** Chamada por
   * `NamekRoom.registrarEspecial` quando o golpe é `genki` e há boss em campo.
   *
   * A janela começa depois do `windup` porque o pedido fala da bola no AR
   * ("quando a Genki Dama é atirada"), e porque antes disso não há nada de que
   * ele precise fugir devagar — os 5,2 s de carga são justamente o tempo em que
   * ele deveria estar correndo para cima de quem carrega.
   *
   * Sobreposições ESTENDEM em vez de somar: duas Genki Damas no ar não o deixam
   * duas vezes mais lento (isso seria uma trava), mas a segunda empurra o fim da
   * janela para a frente, que é o que o jogador espera de duas bolas no céu.
   *
   * @param {number} agora ms da sala, no instante do disparo
   * @param {number} windup s de carga do golpe, lido do config pela sala
   */
  avisarGenkiDama(agora, windup = 0) {
    if (!this.vivo) return;
    const L = NAMEK.freeza.lentidao;
    if (!(L?.fator < 1)) return;
    const de = agora + Math.max(0, windup) * 1000;
    /* O começo é o MAIS CEDO dos dois: uma bola já solta não pode ter o efeito
       adiado pelo windup de outra que acabou de começar a carregar. */
    this.lentoDe = this.lentoAte > agora ? Math.min(this.lentoDe, de) : de;
    this.lentoAte = Math.max(this.lentoAte, de + L.duracao * 1000);
  }

  /**
   * **A ONDA DE CHOQUE O DERRUBOU.**
   *
   * *"Inclusive o Freeza pode ser derrubado se esse flash pegar. Derrubado é
   * igual acontece quando o player leva cinco ataques consecutivos: ele cai no
   * chão, abre a cratera e tudo mais."*
   *
   * Ela é a única coisa do modo que o põe no chão, e é por isso que o §1 do
   * cabeçalho — "ele não é atordoável" — continua verdadeiro no que ele queria
   * dizer: não há CONTAGEM de golpes contra o boss, um Kienzan não o derruba, e
   * cinco bolinhas menos ainda. O que derruba é um gesto único, caro e de
   * catorze metros de raio, que exige estar colado num corpo que empurra e
   * recua de propósito.
   *
   * O tombo em si é resolvido em `mover`: enquanto `caindo` for verdade ele
   * despenca a `queda.velocidade`, ignora o piso de voo, e ao tocar o relevo
   * abre a cratera e começa a contar `queda.tempo`.
   *
   * @param {number} agora ms
   * @returns {boolean} se ele foi de fato derrubado (falso na carência, na cena
   *   de chegada, e se ele já estava caído)
   */
  derrubar(agora) {
    if (!this.vivo || this.caindo) return false;
    if (this.emCena(agora)) return false;
    if (agora < this.quedaLivreEm) return false;
    const Q = NAMEK.freeza.queda;
    this.caindo = true;
    this._cravou = false;
    /* O relógio nasce ZERADO e só é armado quando os pés tocam o chão — ver o
       campo. Aqui ele guarda apenas o teto de segurança, para o caso de o corpo
       nunca chegar ao relevo (sobre o mar da borda, por exemplo): oito segundos
       são a queda de 520 m a 62 m/s com folga. */
    this.quedaAte = agora + 8000;
    this.quedaLivreEm = agora + (Q.tempo + Q.carencia) * 1000;
    /* O golpe em curso morre junto, pela mesma razão que o especial de um
       lutador morre em `NamekRoom.derrubar`: um Death Beam saindo de um corpo
       que está despencando é o golpe cobrando por alguém que já não está lá. */
    this.pose = null;
    this.surto = 0;
    this.vel.x = 0;
    this.vel.z = 0;
    this.vel.y = -Q.velocidade;
    return true;
  }

  /* ======================================================== a API pública == */

  /**
   * **Põe o boss em campo.**
   *
   * Idempotente: com ele já vivo, o único efeito é trocar a dificuldade (o que
   * o pedido exige que valha a quente — é a mesma regra dos bots). A vida é
   * recalculada a partir de quanta gente está em campo NESTE instante; ela
   * volta a ser recalculada quando alguém entra ou sai, em `recontar`.
   *
   * @param {string} [dificuldade] id de `NAMEK.freeza.dificuldadeOrdem`
   * @returns {boolean} false se a sala não tem ninguém para lutar contra ele
   */
  entrar(dificuldade) {
    const agora = this.sala.now();
    if (dificuldade) this.setDificuldade(dificuldade);
    if (this.vivo) return true;

    const n = this.lutadores();
    /* Sem ninguém em campo não há luta, e um boss sozinho numa sala vazia é
       CPU queimada para ninguém — o mesmo critério pelo qual a sala pula o
       passo inteiro quando não há jogador nem bot. */
    if (n <= 0) return false;

    this.vidaMax = vidaDoFreeza(n, this.dificuldadeId);
    this.vida = this.vidaMax;
    this.ki = NAMEK.freeza.kiMax;
    this.vivo = true;
    this._nUltimo = n;

    /* ======================================================= A CHEGADA =====
     *
     * *"Quando o Freeza chega, ele deve chegar voando lá do início do céu até a
     * terra."*
     *
     * A entrada sempre foi de cima e no meio da arena, e a razão continua: é o
     * único ponto do mapa à vista de todo mundo ao mesmo tempo, e um boss que
     * aparece atrás de uma montanha é um boss que metade da sala descobre
     * apanhando. O que mudou é que ela deixou de ser uma POSIÇÃO e virou um
     * PERCURSO — 900 m de altura até 70 m acima do relevo, em 2,2 s.
     *
     * Ele nasce ACIMA do teto de voo do jogador (520 m) de propósito: a descida
     * tem de começar num lugar aonde ninguém pode ir, senão ela seria "um boss
     * apareceu ali em cima" em vez de "uma coisa está entrando na atmosfera".
     *
     * A interpolação do corpo pelo cliente é cortada no primeiro `FREEZA_STATE`
     * (o `BossSystem` copia a posição da mensagem de entrada), então os 830 m de
     * queda são desenhados como queda e não como um tranco.
     */
    const C = NAMEK.freeza.chegada;
    this.pos.x = 0;
    this.pos.z = 0;
    this.chegadaY = Math.max(
      this.sala.field.heightAt(0, 0) + C.baixo,
      NAMEK.world.ceiling * 0.28,
    );
    this.pos.y = C.alto;
    this.vel.x = this.vel.z = 0;
    /* A velocidade vertical é escrita, e não deixada em zero, porque ela é o que
       a aura e o rastro do cliente leem para saber que ele está vindo depressa —
       `FREEZA_STATE` manda `v`, e `rapidez` alimenta a chama da aura. */
    this.vel.y = -(C.alto - this.chegadaY) / Math.max(0.05, C.descida);
    this.chegadaDe = agora;
    this.descidaAte = agora + C.descida * 1000;
    this.cenaAte = agora + (C.descida + C.orbita) * 1000;
    this.caindo = false;
    this.quedaAte = 0;
    this.quedaLivreEm = 0;
    this.lentoDe = 0;
    this.lentoAte = 0;
    /* UMA BATALHA NOVA ZERA A MARCA DA ANTERIOR. Sem isto, uma sala que virasse
       o clima para `dia` e de volta para `tempestade` começaria a segunda luta
       com todo mundo já podendo se transformar de graça — ver `derrotado`. */
    this.derrotado = false;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    this.alvoId = null;
    this.tTroca = 0;
    this.raiva.clear();
    this.pose = null;
    this.bolas.length = 0;
    this.esfera = null;
    this.surto = 0;
    this.danoAcum = 0;
    this.danoJanela = 0;
    this.tRajada = 1.2;
    this.tRaio = 1.6;
    this.tEsfera = 12;
    this.tOnda = 6;
    this.tTeleporte = NAMEK.freeza.teleporte.recarga;
    /* A INVULNERABILIDADE COBRE A CENA INTEIRA, e não mais dois segundos e
       pouco: enquanto a câmera de todo mundo está presa nele, ninguém pode nem
       machucá-lo nem ser machucado por ele. `ENTRADA_INVULN` continua sendo o
       piso — ele é o tempo de a barra subir na tela —, e a cena é o que manda
       quando ela é maior, que é sempre. */
    this.invulnAte = agora + Math.max(ENTRADA_INVULN * 1000, this.cenaAte - agora);

    this.sala.broadcastAll(this.mensagemEntrada(agora));
    this.sala.log?.(
      `namek — FREEZA em campo (${this.dificuldadeId}) — ${this.vidaMax} de vida contra ${n}`,
    );
    return true;
  }

  /**
   * **Tira o boss de campo.** Sem morte, sem aviso de queda, sem `aoMorrer`.
   *
   * É o caminho de desligamento — sala esvaziando, `destroy`, ou quem quer
   * cancelar a luta. Quem quer a MORTE dele chama dano até o fim; são coisas
   * diferentes de propósito, e confundi-las faria uma sala fechando disparar o
   * `aoMorrer` de quem estava contando abates.
   */
  sair() {
    if (!this.vivo && !this.corpo.alive) return;
    this.vivo = false;
    this.corpo.alive = false;
    this.bolas.length = 0;
    this.esfera = null;
    this.pose = null;
    this.caindo = false;
    this.cenaAte = 0;
    this.descidaAte = 0;
    /* **SAIR NÃO É MORRER**, e é esta linha que impede o menu de virar um atalho
       para o prêmio da batalha: `derrotado` destrava o Super Saiyajin livre (ver
       o campo, e `NAMEK.ssj.livreAposOFreeza`), e desistir da luta virando o
       clima para `dia` não pode pagá-lo. */
    this.derrotado = false;
    /* E o `FREEZA_DOWN` daqui sai SEM a marca `derrotado`, que é como o cliente
       distingue os dois caminhos com uma mensagem só — ver `morrer`. */
    this.sala.broadcastAll({ t: NS2C.FREEZA_DOWN, by: null, p: this.pontoRede(), w: this.sala.now() });
  }

  /* ===================================================== ajustes e consultas */

  /**
   * A dificuldade, a quente. Mesma regra dos bots: são MULTIPLICADORES lidos no
   * quadro em que são usados, então trocar não pede nascer de novo.
   *
   * A VIDA MÁXIMA acompanha, e ela precisa acompanhar de um jeito específico:
   * a FRAÇÃO é preservada. Um boss com 40 % da vida que muda de `imperador`
   * para `absoluto` fica com 40 % de uma barra maior — e não com a mesma
   * quantidade de pontos numa barra que dobrou, que apareceria na tela como a
   * barra despencando sozinha.
   */
  setDificuldade(id) {
    const nova = dificuldadeFreeza(id);
    const idOk = NAMEK.freeza.dificuldades[id] ? id : NAMEK.freeza.dificuldadePadrao;
    if (idOk === this.dificuldadeId) return false;
    const fracao = this.vidaMax > 0 ? this.vida / this.vidaMax : 1;
    this.dificuldadeId = idOk;
    this.dif = nova;
    if (this.vivo) {
      this.vidaMax = vidaDoFreeza(this.lutadores(), idOk);
      this.vida = Math.max(1, Math.round(this.vidaMax * fracao));
      this.sala.broadcastAll(this.mensagemEntrada(this.sala.now()));
    }
    return true;
  }

  /**
   * Alguém entrou ou saiu: a vida máxima muda com a lotação.
   *
   * A fração é preservada pelo mesmo motivo de `setDificuldade` — e aqui isso
   * tem uma consequência de jogo que vale escrever: **quem entra no meio de uma
   * luta não a encurta nem a alonga.** O boss ganha vida proporcional e a barra
   * na tela não se mexe; o que muda é quanto tempo ele ainda aguenta, que agora
   * é dividido por mais gente atirando. É a leitura certa dos dois lados.
   */
  recontar() {
    if (!this.vivo) return;
    const novo = vidaDoFreeza(this.lutadores(), this.dificuldadeId);
    if (novo === this.vidaMax) return;
    const fracao = this.vidaMax > 0 ? this.vida / this.vidaMax : 1;
    this.vidaMax = novo;
    this.vida = Math.max(1, Math.round(novo * fracao));
    this.sala.broadcastAll(this.mensagemEntrada(this.sala.now()));
  }

  /**
   * **BANCADA: mata o boss na hora.** Atalho de teste, não de jogo.
   *
   * Ele existe para se poder testar o que vem DEPOIS da luta — a fuga de
   * Namekusei começa quando o Freeza cai — sem ter de vencer os cem segundos de
   * briga a cada tentativa.
   *
   * **Pelo caminho de morte de VERDADE**, e isso é o contrato inteiro deste
   * método: ele chama `levarDano` com a vida que resta, exatamente como uma
   * Genki Dama chamaria. Daí sai tudo o que uma morte legítima produz — o
   * `FREEZA_HURT` final com a barra em zero, o `FREEZA_DOWN` para todo mundo, e
   * o `aoMorrer`, que é o gancho de que a fuga depende para começar a contagem.
   *
   * Uma porta lateral que apagasse o boss direto (`this.vivo = false`) seria
   * mais curta e inútil para o que foi pedido: o boss sumiria e a fuga não
   * começaria, que é justamente a parte que o atalho existe para testar.
   *
   * A invulnerabilidade de entrada é derrubada antes, senão o atalho não
   * funcionaria nos dois primeiros segundos — e é exatamente aí que quem está
   * testando aperta a tecla.
   *
   * @returns {boolean} false quando não há boss em campo (e aí não faz nada,
   *   sem erro: apertar a tecla numa partida sem Freeza é inócuo)
   */
  matarPorTeste() {
    if (!this.vivo) return false;
    this.invulnAte = 0;
    this.levarDano(this.vida, null, "teste");
    return true;
  }

  /** Este id é o do boss? Uma linha, mas ela é chamada de fora e merece nome. */
  ehAlvo(id) {
    return this.vivo && id === NAMEK.freeza.id;
  }

  /** Manda a mensagem de entrada para UMA conexão — quem chegou no meio. */
  apresentar(conn) {
    if (!this.vivo || !conn) return;
    try {
      conn.send(JSON.stringify(this.mensagemEntrada(this.sala.now())));
    } catch {
      /* socket fechando: o `handleClose` cuida */
    }
  }

  mensagemEntrada(agora) {
    return {
      t: NS2C.FREEZA_IN,
      id: NAMEK.freeza.id,
      nome: NAMEK.freeza.nome,
      dificuldade: this.dificuldadeId,
      vida: Math.round(this.vida),
      vidaMax: this.vidaMax,
      p: this.pontoRede(),
      /* ------------------------------------------------ A CENA, em dois campos
       *
       * `cena` são os MILISSEGUNDOS QUE FALTAM dela, e não a duração total — a
       * distinção existe porque esta mesma mensagem é reenviada a quem chega no
       * meio (`apresentar`) e a cada troca de dificuldade. Mandar a duração faria
       * quem entrasse no quarto segundo da apresentação assistir a ela inteira
       * de novo, sozinho, com o boss já lutando.
       *
       * Zero (ou ausente) quer dizer "não há cena": é o caso da reapresentação
       * normal, e o cliente simplesmente não prende a câmera de ninguém.
       *
       * `desce` são os milissegundos que faltam só da DESCIDA, e ele existe
       * porque a lente enquadra as duas metades de jeitos diferentes — acompanha
       * a queda na primeira e orbita na segunda. Ver `src/namek/boss/cine.js`. */
      cena: Math.max(0, Math.round(this.cenaAte - agora)),
      desce: Math.max(0, Math.round(this.descidaAte - agora)),
      w: agora,
    };
  }

  /** Humanos + bots em campo. É o `n` da fórmula da vida. */
  lutadores() {
    return this.sala.players.size + this.sala.bots.count;
  }

  pontoRede() {
    return [round(this.pos.x), round(this.pos.y), round(this.pos.z)];
  }

  /**
   * Põe o corpo dele na lista uniforme da sala.
   *
   * **É esta linha que faz os bots o enxergarem** — `NamekBotSquad` varre
   * `ctx.corpos` para escolher alvo, para mirar e para colidir as bolas dele.
   * Sem ela o boss seria invisível para a IA e a metade "inclusive os bots" do
   * pedido não existiria.
   *
   * O que ele NÃO ganha por estar na lista: dano da onda de empurrão de um
   * jogador. `NamekRoom.onda` chama `aplicarDano(c.ref, …)`, e `c.ref` é ESTE
   * objeto, que não tem `alive` — o funil de dano sai na primeira linha. É
   * deliberado e é a leitura certa: a onda é uma defesa de pressão de catorze
   * metros, e ela não move nem arranha uma coisa deste tamanho.
   */
  corpoNaLista(corpos) {
    if (!this.vivo) return;
    const c = this.corpo;
    c.x = this.pos.x;
    c.y = this.pos.y;
    c.z = this.pos.z;
    c.vx = this.vel.x;
    c.vy = this.vel.y;
    c.vz = this.vel.z;
    c.alive = true;
    c.invuln = this.sala.now() < this.invulnAte;
    c.health = this.vida;
    corpos.push(c);
    this.sala.corpoPorId?.set(c.id, c);
  }

  /* ================================================================ o dano ==

     Tudo o que tira vida do boss passa por `levarDano`, exatamente como tudo o
     que tira vida de um lutador passa por `NamekRoom.aplicarDano`. É a mesma
     lição, pela mesma razão: a invulnerabilidade de entrada, o acúmulo da barra
     e a morte precisam de UMA implementação. */

  /**
   * @param {number} dano já convertido pela tabela `NAMEK.freeza.dano`
   * @param {object|null} por o lutador que bateu (para o `by` da mensagem)
   * @param {string} kind o golpe
   */
  levarDano(dano, por = null, kind = "blast") {
    if (!this.vivo || !(dano > 0)) return 0;
    const agora = this.sala.now();
    if (agora < this.invulnAte) return 0;

    /* **"TIRAM MAIS LIFE DO FREEZA."** O multiplicador do Super Saiyajin
     * (`NAMEK.ssj.danoNoFreeza`, 1,75×), e ele mora AQUI — no funil — pelo mesmo
     * motivo que a raiva e a janela do teleporte moram: é o único ponto por onde
     * todo o dano ao boss passa, então uma linha cobre a rajada declarada, o
     * feixe por segundo, o acerto de bot e o que alguém acrescentar amanhã.
     *
     * Contra JOGADORES o multiplicador não existe, e a assimetria é deliberada:
     * ver o parágrafo final de `NAMEK.ssj.danoNoFreeza`. A transformação é uma
     * resposta ao CHEFE, e é contra ele que ela morde. */
    dano *= ganhoContraFreeza(por);

    this.vida -= dano;
    this.danoAcum += dano;
    this.danoPor = por?.id ?? null;
    this.danoKind = kind;

    /* A RAIVA — quem está causando dano vira alvo preferencial. Ver a política
       inteira em `NAMEK.freeza.alvo`. Ela é acumulada aqui, no funil, para valer
       para qualquer origem de dano sem uma linha em cada uma. */
    if (por?.id != null) {
      this.raiva.set(por.id, (this.raiva.get(por.id) ?? 0) + dano);
    }

    /* A janela do teleporte de emergência. Ver `talvezTeleportar`. */
    if (agora > this.janelaAte) {
      this.danoJanela = 0;
      this.janelaAte = agora + NAMEK.freeza.teleporte.janela * 1000;
    }
    this.danoJanela += dano;

    if (this.vida <= 0) {
      this.vida = 0;
      this.despejarDano(agora, true);
      this.morrer(por, agora);
      return dano;
    }
    this.despejarDano(agora, false);
    return dano;
  }

  /** O `FREEZA_HURT`, acumulado e despejado a 8 Hz. Ver `HURT_PASSO`. */
  despejarDano(agora, forcado) {
    if (this.danoAcum <= 0) return;
    if (!forcado && agora < this.hurtAte) return;
    this.hurtAte = agora + HURT_PASSO;
    this.sala.broadcastAll({
      t: NS2C.FREEZA_HURT,
      vida: Math.round(this.vida),
      vidaMax: this.vidaMax,
      dano: Math.round(this.danoAcum),
      by: this.danoPor,
      kind: this.danoKind,
    });
    this.danoAcum = 0;
  }

  morrer(por, agora) {
    this.vivo = false;
    this.corpo.alive = false;
    this.bolas.length = 0;
    this.esfera = null;
    this.pose = null;
    this.caindo = false;
    this.cenaAte = 0;
    this.descidaAte = 0;
    /* **A MARCA DA VITÓRIA.** Ela sobrevive à saída dele de campo e é o que
       destrava o Super Saiyajin livre para a sala inteira, inclusive para quem
       entrar depois (ver `derrotado`, `server/namek/ssj.js: freezaDerrotado` e o
       campo `freezaMorto` do `welcome`). */
    this.derrotado = true;
    this.sala.broadcastAll({
      t: NS2C.FREEZA_DOWN,
      by: por?.id ?? null,
      p: this.pontoRede(),
      /* **DERRUBADO, e não retirado.** O mesmo `FREEZA_DOWN` sai pelos dois
         caminhos (aqui e em `sair`), e este bit é a única coisa que os separa
         do lado do cliente: ele decide se a cena de morte acontece, se o Super
         Saiyajin fica aceso e se a tecla `R` passa a ser de graça. Sem ele,
         cancelar a luta pelo menu daria o mesmo prêmio de a ter vencido. */
      derrotado: 1,
      w: agora,
    });
    this.sala.log?.(`namek — FREEZA caiu (${this.dificuldadeId})`);
    /* O gancho de fora, por último e protegido: quem se pendurou aqui é código
       de outra pessoa, e uma exceção lá dentro não pode derrubar o passo da
       sala inteira no meio de um quadro. */
    try {
      this.aoMorrer?.(agora);
    } catch (e) {
      this.sala.log?.(`namek — aoMorrer do Freeza estourou: ${e?.message ?? e}`);
    }
  }

  /**
   * "O meu golpe acertou o Freeza" — o `NC2S.FREEZA_HIT` de um humano.
   *
   * As conferências são as mesmas do `registrarAcerto`, e pelo mesmo motivo:
   * elas custam quase nada e pegam quase toda INCOERÊNCIA. O boss existe, o
   * jogador está vivo, o ponto declarado é perto do corpo dele, e o golpe cabe
   * na tabela. O que não há aqui é escolha de vítima — só existe uma —, e é essa
   * ausência que torna a mensagem barata.
   */
  acertoDeclarado(player, msg) {
    if (!this.vivo || !player?.alive) return;
    const kind = typeof msg?.kind === "string" ? msg.kind : "blast";
    const tabela = NAMEK.freeza.dano;
    /* Golpe que não está na tabela não tira nada. É o mesmo cuidado de
       `danoNoFreeza`, com uma diferença: lá o padrão é a rajada (para um id
       estranho nunca valer MAIS do que se conhece); aqui a mensagem é recusada
       inteira, porque um cliente que declara um golpe inexistente não está
       atrasado, está inventando. */
    if (!Object.prototype.hasOwnProperty.call(tabela, kind)) return;

    const p = Array.isArray(msg.p) && msg.p.length >= 3 ? msg.p : null;
    if (p && (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2]))) return;
    if (p) {
      const alvoY = this.pos.y + NAMEK.freeza.peito;
      const d = Math.hypot(p[0] - this.pos.x, p[1] - alvoY, p[2] - this.pos.z);
      /* A folga é o corpo dele + o raio de morte do maior golpe + a tolerância
         de rede. Generosa de propósito: quem atira vê o boss `interpDelay` no
         passado e ele voa a 118 m/s. Apertar aqui não pegaria trapaceiro —
         pegaria o jogo. */
      if (d > NAMEK.freeza.raio + 20 + TOLERANCIA) return;
    }

    let dano = danoNoFreeza(kind);
    /* O Kamehameha é o único que cobra por TEMPO: `dt` são os segundos de
       exposição desde o último aviso, aparados em meio segundo como no
       `SPECIAL_HIT`. Os outros mandam 0 e cobram de uma vez. */
    if (kind === "kamehameha") {
      const dt = clamp(Number(msg.dt) || 0, 0, 0.5);
      if (dt <= 0) return;
      dano *= dt;
    }
    this.levarDano(dano, player, kind);
  }

  /** O mesmo, vindo de um BOT (que fala com a sala por dentro, sem protocolo). */
  acertoDeBot(ev, dono) {
    if (!this.vivo) return;
    const kind = typeof ev?.kind === "string" ? ev.kind : "blast";
    let dano = danoNoFreeza(kind);
    /* O feixe do bot já chega com o dano do quadro embutido em `ev.dano`, que é
       uma fração do `dps` contra um lutador. Converter para a régua do boss é
       uma regra de três: quanto o golpe vale AQUI dividido por quanto ele vale
       LÁ, vezes o que o bot cobrou. Sem isto o Kamehameha de um bot tiraria 21
       por segundo de uma barra de onze mil. */
    if (kind === "kamehameha") {
      const dps = NAMEK.specials.kamehameha?.dps || 1;
      dano = (Number(ev.dano) || 0) * (danoNoFreeza(kind) / dps);
    }
    this.levarDano(dano, dono, kind);
  }

  /* ================================================================= o passo */

  /**
   * Um quadro do boss inteiro. Roda no passo da SALA, depois de `montarCorpos`
   * e antes de `bots.tick` — nessa ordem porque os bots precisam vê-lo onde ele
   * ESTÁ neste quadro, e não onde estava no anterior (a 118 m/s um quadro são
   * quase seis metros).
   */
  passo(dt, agora) {
    if (!this.vivo) return;

    /* A LOTAÇÃO MUDOU? A vida dele é função dela, e um bot posto ou tirado no
       meio da luta muda o número tanto quanto uma pessoa entrando. A sala avisa
       nos dois caminhos humanos (`join` e `handleClose`); os bots entram e saem
       por outros três (`addBot`, `removeBot`, `clearBots`), e pendurar um gancho
       em cada um deles seria quatro lugares para esquecer de um. Uma comparação
       de inteiro por quadro responde a todos de uma vez. */
    const n = this.lutadores();
    if (n !== this._nUltimo) {
      this._nUltimo = n;
      this.recontar();
    }

    this.decairRaiva(dt);
    /* ------------------------------------------------- OS DOIS ESTADOS MUDOS
     *
     * A cena de chegada e a queda pela onda têm a mesma forma — o corpo é
     * conduzido por uma linha de código só e a máquina de estados fica calada —,
     * e por isso as duas saem por aqui em vez de espalharem `if`s pelos cinco
     * métodos abaixo. Sem alvo, `mover` e `decidirGolpe` já sabem não fazer
     * nada; o que estes dois métodos acrescentam é o percurso.
     *
     * A ORDEM importa: os dois ainda passam por `passoDasBolas`, `passoDaEsfera`
     * e `transmitir`. Uma bola que ele soltou antes de ser derrubado continua
     * voando e continua machucando, que é a leitura certa — ela já saiu da mão.
     */
    const conduzido = this.passoDaChegada(dt, agora) || this.passoDaQueda(dt, agora);
    const alvo = conduzido ? null : this.escolherAlvo(dt, agora);
    if (!conduzido) this.mover(dt, alvo, agora);
    this.relogios(dt);
    if (!conduzido) this.decidirGolpe(dt, agora, alvo);
    this.passoDaPose(dt, agora);
    this.passoDasBolas(dt, agora);
    this.passoDaEsfera(dt, agora);
    this.despejarDano(agora, false);
    this.corpoNaLista(this.sala.corpos);
    this.transmitir(agora);
  }

  /**
   * A DESCIDA DO CÉU. Devolve `true` enquanto ela estiver conduzindo o corpo.
   *
   * *"Ele deve chegar voando lá do início do céu até a terra."*
   *
   * Uma interpolação e não uma integração: `u` vai de 0 a 1 ao longo de
   * `chegada.descida` e a altura é lida DELE. É a mesma escolha do salto do
   * peixe (`NamekPeixeSim.posicao`) e pelo mesmo motivo — uma trajetória fechada
   * chega exatamente onde prometeu, e a cena que vem depois dela depende de o
   * corpo estar na cota certa no instante certo.
   *
   * A curva é `u²`: ele ACELERA descendo. Linear leria como um elevador; com o
   * quadrado, os primeiros 400 m passam devagar (a coisa ainda é um ponto no
   * céu) e os últimos 200 chegam de uma vez, que é a leitura de queda.
   *
   * O corpo GIRA durante a queda — meia volta em dois segundos — para a órbita
   * da câmera não começar com ele parado de frente para a arena. E o `yaw`
   * continua sendo escrito depois, por `mirarEm`, assim que houver alvo.
   *
   * Ele NÃO devolve `true` durante a órbita da câmera: passada a descida, o boss
   * volta a manobrar sozinho e é o `invulnAte` (que cobre a cena inteira) que
   * continua proibindo os golpes. É isso que faz a última meia volta da
   * apresentação mostrar uma criatura viva em vez de um boneco pendurado.
   */
  passoDaChegada(dt, agora) {
    if (!this.descendo(agora)) return false;
    const C = NAMEK.freeza.chegada;
    const dur = Math.max(0.05, C.descida) * 1000;
    const u = clamp(1 - (this.descidaAte - agora) / dur, 0, 1);
    const antes = this.pos.y;
    this.pos.y = C.alto + (this.chegadaY - C.alto) * (u * u);
    /* A velocidade É a derivada medida, e não a nominal: ela alimenta a aura e o
       rastro do cliente (`FREEZA_STATE.v`), e uma velocidade escrita à mão
       discordaria da posição justamente no trecho em que ele mais acelera. */
    this.vel.y = dt > 1e-4 ? (this.pos.y - antes) / dt : this.vel.y;
    this.vel.x = this.vel.z = 0;
    this.yaw = u * Math.PI;
    /* Nariz para baixo enquanto cai, endireitando no fim. `pitch` viaja para o
       cliente e é ele que inclina o tronco (ver `FreezaBody.aplicar`). */
    this.pitch = -0.9 * (1 - u);
    this.roll = 0;
    return true;
  }

  /**
   * O TOMBO, quando a onda de choque de alguém o pegou. Ver `derrubar`.
   *
   * Devolve `true` enquanto ele estiver caindo ou no chão — e enquanto isso ele
   * não escolhe alvo, não mira, não atira e não desvia. É a janela inteira, e
   * ela é o que o gesto compra.
   *
   * O relógio da tonteira **só começa a correr quando os pés tocam o relevo**,
   * exatamente como o de um lutador (ver `FighterController.derrubar`, que
   * explica por quê): ele é derrubado a 78 m de altura, e a punição é o tempo no
   * chão — não o tempo caindo. Sem isso, um tombo de cima do teto de voo
   * terminaria ainda no ar e não haveria queda nenhuma.
   */
  passoDaQueda(dt, agora) {
    if (!this.caindo) return false;
    const Q = NAMEK.freeza.queda;
    const chao = this.sala.field.heightAt(this.pos.x, this.pos.z);

    if (this.pos.y > chao) {
      this.vel.x = damp(this.vel.x, 0, 3, dt);
      this.vel.z = damp(this.vel.z, 0, 3, dt);
      this.vel.y = -Q.velocidade;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vel.y * dt;
      /* O corpo TOMBA enquanto desce. `roll` é o que o cliente lê para deitar a
         raiz do boneco — é o mesmo canal do tombo de morte, e é ele que
         diferencia "está caindo" de "está mergulhando". */
      this.roll = clamp(this.roll + dt * 2.2, 0, 1.45);
      this.pitch = damp(this.pitch, 0.5, 3, dt);
      if (this.pos.y > chao) return true;
    }

    /* ------------------------------------------------------------- o baque */
    this.pos.y = chao;
    this.vel.x = this.vel.y = this.vel.z = 0;
    if (!this._cravou) {
      this._cravou = true;
      /* A CRATERA, pelo `NamekRoom.cratera` de sempre — é o que faz o buraco
         dele ser o mesmo buraco em todas as telas e entrar na lista de quem
         chegar depois. `null` de dono pela mesma razão de todos os buracos do
         boss: a cota por lutador de `podeCravar` não se aplica a quem não é
         lutador. */
      this.sala.cratera(this.pos.x, this.pos.z, Q.cratera, null);
      /* O relógio da tonteira começa AQUI. */
      this.quedaAte = agora + Q.tempo * 1000;
    }

    if (agora >= this.quedaAte) {
      this.caindo = false;
      this._cravou = false;
      this.roll = 0;
      /* Ele levanta VOANDO, com um empurrão para cima: o piso de `voo.alturaMin`
         o tiraria do chão sozinho no quadro seguinte, mas em um solavanco. */
      this.vel.y = 26;
      return false;
    }
    return true;
  }

  relogios(dt) {
    /* A CADÊNCIA DIVIDE OS RELÓGIOS, e não multiplica os danos: um boss mais
       difícil solta mais golpes, não golpes mais fortes (para isso existe o eixo
       `dano`). Separar os dois é o que permite ajustar "ele é agressivo demais"
       sem tornar cada golpe uma sentença. */
    const c = Math.max(0.2, this.dif.cadencia);
    const d = dt * c;
    this.tRajada -= d;
    this.tRaio -= d;
    this.tEsfera -= d;
    this.tOnda -= d;
    this.tTeleporte -= dt;
    this.tBola -= dt;
    this.tLado -= dt;
    this.tTroca -= dt;

    /* O ki sobe sempre — ele nunca para para carregar. Ver "o ki" no cabeçalho
       de `NAMEK.freeza`. */
    this.ki = Math.min(NAMEK.freeza.kiMax, this.ki + NAMEK.freeza.kiRegen * dt);

    if (this.tLado <= 0) {
      this.lado = -this.lado;
      this.tLado = 2.2 + Math.random() * 2.4;
    }
  }

  /** A raiva esfria. Ver `NAMEK.freeza.alvo.raivaMeiaVida`. */
  decairRaiva(dt) {
    if (!this.raiva.size) return;
    const k = Math.pow(0.5, dt / NAMEK.freeza.alvo.raivaMeiaVida);
    for (const [id, v] of this.raiva) {
      const novo = v * k;
      if (novo < 1) this.raiva.delete(id);
      else this.raiva.set(id, novo);
    }
  }

  /* ---------------------------------------------------------------- o alvo */

  /**
   * Contra quem ele está brigando AGORA.
   *
   * A política inteira — e a razão de cada peso — está no comentário de
   * `NAMEK.freeza.alvo`, que é onde ela é ajustada. Aqui está só a mecânica:
   * mantém o alvo por `trocaEm` segundos, reavalia, e na reavaliação o alvo
   * atual paga `penaRepetir` metros de penalidade. Havendo dois vivos, ele
   * troca; havendo um, ele fica (a penalidade não elimina candidato, só o
   * coloca por último).
   */
  escolherAlvo(dt, agora) {
    const A = NAMEK.freeza.alvo;
    let atual = this.alvoId === null ? null : this.corpoDe(this.alvoId);
    if (atual && (!atual.alive || atual.invuln)) atual = null;

    /* Alvo caiu ou sumiu: reavalia AGORA. Esperar o relógio faria o boss passar
       segundos atirando num lugar vazio, que é a coisa que mais denuncia uma IA. */
    if (!atual) this.tTroca = 0;
    if (this.tTroca > 0) return atual;
    this.tTroca = A.trocaEm * (0.75 + Math.random() * 0.5);

    let melhor = null;
    let melhorNota = Infinity;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive || c.invuln) continue;
      const d = Math.hypot(c.x - this.pos.x, c.y - this.pos.y, c.z - this.pos.z);
      if (d > A.alcance) continue;
      let nota = d;
      nota -= (this.raiva.get(c.id) ?? 0) * A.pesoRaiva;
      nota -= (1 - clamp(c.health / NAMEK.fighter.maxHealth, 0, 1)) * A.pesoVida;
      if (c.id === this.alvoId) nota += A.penaRepetir;
      if (nota < melhorNota) {
        melhorNota = nota;
        melhor = c;
      }
    }
    this.alvoId = melhor?.id ?? null;
    return melhor;
  }

  corpoDe(id) {
    for (const c of this.sala.corpos) if (c.id === id) return c;
    return null;
  }

  /* ------------------------------------------------------------- o movimento */

  /**
   * Ele voa, e só voa. Não há pouso, não há caminhada, não há gravidade: o §1 do
   * pedido é explícito, e um boss que às vezes anda seria um boss que às vezes
   * está no alcance de um soco que este modo não tem.
   *
   * A conduta é a de um caçador que briga DE CIMA: fica a `distanciaIdeal` do
   * alvo, `degrau` metros acima dele, circundando pelo lado que `this.lado`
   * diz. Perto demais, recua; longe demais, investe com `arranque`.
   */
  mover(dt, alvo, agora = this.sala.now()) {
    const V = NAMEK.freeza.voo;
    /* O FATOR DE VELOCIDADE, e não `dif.mover` cru: é por ele que a lentidão da
       Genki Dama entra (`NAMEK.freeza.lentidao`), multiplicando a dificuldade em
       vez de a substituir. Ver `fatorDeVelocidade`. */
    const mover = this.fatorDeVelocidade(agora);
    const dv = { x: 0, y: 0, z: 0 };
    let rapido = false;

    if (this.pose && this.pose.tipo === POSE.esfera) {
      /* CARREGANDO A DEATH BALL ele fica PARADO — é a mesma troca que o modo
         cobra de um humano na Genki Dama: o golpe que apaga um grupo custa três
         segundos de alvo imóvel à vista de todos. Sem isto, o único golpe dele
         que dá para punir deixaria de ter punição. */
      this.vel.x = damp(this.vel.x, 0, 4, dt);
      this.vel.y = damp(this.vel.y, 0, 4, dt);
      this.vel.z = damp(this.vel.z, 0, 4, dt);
    } else if (alvo) {
      const dx = alvo.x - this.pos.x;
      const dy = alvo.y + V.degrau - this.pos.y;
      const dz = alvo.z - this.pos.z;
      const dh = Math.hypot(dx, dz) || 1e-3;
      const d = Math.hypot(dx, dy, dz);

      /* O rumo: a soma de um vetor RADIAL (aproximar ou afastar até a distância
         ideal) com um TANGENTE (circundar). O peso do tangente cresce quando ele
         já está na distância certa — é o que faz a órbita em vez do vaivém. */
      const erro = d - V.distanciaIdeal;
      const radial = clamp(erro / 40, -1, 1);
      const tangente = 1 - Math.abs(radial) * 0.7;
      const tx = (-dz / dh) * this.lado;
      const tz = (dx / dh) * this.lado;

      dv.x = (dx / dh) * radial + tx * tangente;
      dv.z = (dz / dh) * radial + tz * tangente;
      dv.y = clamp(dy / 30, -1, 1);

      if (d < V.perto) {
        // Colado demais: sobe e sai. Ele não briga de perto.
        dv.x = -dx / dh;
        dv.z = -dz / dh;
        dv.y = 0.8;
      }
      /* A INVESTIDA. `agressividade` decide a que distância ele deixa de
         circundar e vem para cima — é o eixo do COMPORTAMENTO, e é ele que
         separa "boss que fica longe metralhando" de "boss que chega". Ver
         `NAMEK.freeza.voo.investirEm` para por que a constante é pequena: com
         uma grande, o alvo em fuga estabiliza logo abaixo do gatilho e ele nunca
         acelera. */
      rapido = erro > V.investirEm * (2 - this.dif.agressividade);

      this.mirarEm(alvo.x, alvo.y + NAMEK.fighter.chest, alvo.z, dt);
    } else {
      /* SEM ALVO ELE PAIRA, e não volta ao meio da arena.
       *
       * A versão anterior corria para o centro e subia até meia altura, e a
       * medida mostrou o estrago: num duelo de um contra um, cada morte do
       * adversário deixava o boss cinco segundos sem alvo, e nesses cinco
       * segundos ele atravessava duzentos metros até o meio do mapa e subia
       * cento e cinquenta. Quando o outro renascia, o boss estava do outro lado
       * do planeta e gastava mais dez segundos voltando — a distância média
       * entre os dois ficou em 112 m numa luta desenhada para acontecer a 62, e
       * metade do combate era um voo de ida e volta que ninguém via.
       *
       * Pairar resolve os dois lados: ele fica onde a briga estava (que é onde a
       * briga vai recomeçar) e não vira um ponto no céu no meio do mapa. A
       * altitude mínima já é garantida pela barreira do relevo, logo abaixo. */
      this.vel.x = damp(this.vel.x, 0, 2.5, dt);
      this.vel.z = damp(this.vel.z, 0, 2.5, dt);
      /* Uma subida de sobrevivência só quando ele está raspando o chão: sem
         entrada nenhuma, um boss que acabou de mergulhar atrás de alguém ficaria
         parado dentro da encosta até o próximo alvo aparecer. */
      const piso = this.sala.field.heightAt(this.pos.x, this.pos.z) + V.alturaMin * 2;
      this.vel.y = damp(this.vel.y, this.pos.y < piso ? 12 : 0, 2.5, dt);
    }

    const n = Math.hypot(dv.x, dv.y, dv.z);
    const vmax = (rapido ? V.arranque : V.velocidade) * mover;
    if (n > 1e-4) {
      const k = vmax / n;
      this.vel.x = damp(this.vel.x, dv.x * k, V.aceleracao, dt);
      this.vel.y = damp(this.vel.y, dv.y * k, V.aceleracao, dt);
      this.vel.z = damp(this.vel.z, dv.z * k, V.aceleracao, dt);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    /* --------------------------------------------------------- as barreiras
       O chão e o teto são DUROS para ele, ao contrário do freio macio que os
       lutadores têm: um boss que atravessa o relevo é um boss que some, e a
       barreira macia existe para não interromper uma perseguição — que é
       exatamente o que ele está fazendo o tempo todo. */
    const chao = this.sala.field.heightAt(this.pos.x, this.pos.z) + NAMEK.freeza.voo.alturaMin;
    if (this.pos.y < chao) {
      this.pos.y = chao;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    if (this.pos.y > NAMEK.world.ceiling) {
      this.pos.y = NAMEK.world.ceiling;
      if (this.vel.y > 0) this.vel.y = 0;
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    const lim = NAMEK.world.radius;
    if (r > lim) {
      this.pos.x = (this.pos.x / r) * lim;
      this.pos.z = (this.pos.z / r) * lim;
    }

    /* A ROLAGEM sai da curva, como a de um lutador: quem vira para a esquerda
       inclina para a esquerda. Sem ela o corpo desliza de lado como um trilho. */
    const lateral = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.roll = damp(this.roll, clamp(-lateral / 90, -0.5, 0.5), 4, dt);
  }

  /** Gira o corpo em direção a um ponto, com teto de velocidade angular. */
  mirarEm(x, y, z, dt) {
    const dx = x - this.pos.x;
    const dy = y - (this.pos.y + NAMEK.freeza.peito);
    const dz = z - this.pos.z;
    const dh = Math.hypot(dx, dz);
    const alvoYaw = Math.atan2(dx, dz);
    const alvoPitch = Math.atan2(dy, dh || 1e-3);

    const maxGiro = NAMEK.freeza.voo.giro * dt;
    let d = alvoYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += clamp(d, -maxGiro, maxGiro);
    this.pitch = damp(this.pitch, clamp(alvoPitch, -1.1, 1.1), 8, dt);
  }

  /* ------------------------------------------------------------- os golpes */

  /**
   * Qual golpe sai agora.
   *
   * A ordem das perguntas É a prioridade, e ela vai do mais caro ao mais
   * barato: primeiro o que salva (teleporte, onda), depois o que decide a luta
   * (Death Ball), depois o que pressiona (Death Beam), e por último o que
   * mantém o jogador ocupado (a rajada). Perguntar na ordem inversa faria o
   * boss gastar o quadro na bolinha e nunca chegar ao golpe grande.
   */
  decidirGolpe(dt, agora, alvo) {
    if (this.pose) return; // já está comprometido
    if (agora < this.invulnAte) return; // ainda entrando

    if (this.talvezTeleportar(agora)) return;
    if (this.talvezOnda(agora)) return;
    if (!alvo) return;

    const d = Math.hypot(alvo.x - this.pos.x, alvo.y - this.pos.y, alvo.z - this.pos.z);

    /* A DEATH BALL. Ela quer gente AGRUPADA — 19 m de raio de morte contra um
       alvo solitário é desperdício de dezesseis segundos de recarga —, então o
       gatilho conta quantos corpos cabem na explosão em volta do alvo. Com um
       só, ela ainda sai, mas com metade da chance: `agressividade` decide. */
    if (this.tEsfera <= 0 && this.ki >= NAMEK.freeza.poderes.esferaDaMorte.ki && d < 420) {
      const juntos = this.quantosPerto(alvo, NAMEK.freeza.poderes.esferaDaMorte.hitRadius * 1.3);
      const chance = juntos >= 2 ? 1 : 0.45 * this.dif.agressividade;
      if (Math.random() < chance) {
        this.iniciarPose(POSE.esfera, NAMEK.freeza.poderes.esferaDaMorte.windup, alvo);
        return;
      }
      /* RECUSADA, ELA PAGA A RECARGA INTEIRA — e essa linha é o sorteio virando
       * verdade.
       *
       * Ela esperava 2,5 s antes de perguntar de novo, e o efeito medido foi o
       * oposto do pretendido: dentro de uma recarga de dezoito segundos cabiam
       * sete sorteios, e sete sorteios de 45 % são 98 % de chance. A "chance"
       * não existia — contra um alvo sozinho ela saía praticamente todas as
       * vezes, e como ela mata de uma vez (100 de dano, 19 m de raio), era ela
       * quem decidia a luta de um contra um: três ou quatro mortes a cada três
       * minutos, só dela.
       *
       * Com a recarga cheia o sorteio acontece UMA vez por ciclo, e o número
       * volta a querer dizer o que ele diz: contra alguém sozinho, uma Death
       * Ball a cada quarenta segundos. Contra um GRUPO (`juntos >= 2`) a chance
       * é 1 e nada disto se aplica — que é exatamente o desenho do golpe, e o
       * que faz dele a resposta dele a um cerco em vez de um martelo. */
      this.tEsfera = NAMEK.freeza.poderes.esferaDaMorte.recarga;
    }

    if (this.tRaio <= 0 && this.ki >= NAMEK.freeza.poderes.raioDaMorte.ki && d < 500) {
      this.iniciarPose(POSE.raio, NAMEK.freeza.poderes.raioDaMorte.windup, alvo);
      return;
    }

    if (this.tRajada <= 0 && this.ki >= NAMEK.freeza.rajada.ki * 2 && d < NAMEK.freeza.rajada.alcance) {
      this.surto = NAMEK.freeza.rajada.porSurto;
      this.tBola = 0;
      this.iniciarPose(POSE.rajada, NAMEK.freeza.rajada.porSurto / NAMEK.freeza.rajada.cadencia, alvo);
    }
  }

  quantosPerto(alvo, raio) {
    let n = 0;
    const r2 = raio * raio;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive) continue;
      const dx = c.x - alvo.x;
      const dy = c.y - alvo.y;
      const dz = c.z - alvo.z;
      if (dx * dx + dy * dy + dz * dz <= r2) n++;
    }
    return n;
  }

  iniciarPose(tipo, dur, alvo) {
    this.pose = { tipo, t: 0, dur: Math.max(0.05, dur), alvo: alvo?.id ?? null, saiu: false };
  }

  /** A pose em curso: ela é o relógio do golpe, e é o que o cliente desenha. */
  passoDaPose(dt, agora) {
    const p = this.pose;
    if (!p) return;
    p.t += dt;

    if (p.tipo === POSE.rajada) {
      this.passoDaRajada(dt, agora);
    } else if (!p.saiu && p.t >= p.dur) {
      p.saiu = true;
      if (p.tipo === POSE.raio) this.soltarRaio(agora);
      else if (p.tipo === POSE.esfera) this.soltarEsfera(agora);
    }

    /* A soltura: um instante a mais depois de o golpe sair, para o corpo se
       recompor. É o mesmo `SOLTURA` que `duracaoDaPose` cobra de um humano, e
       pela mesma razão — sem ele, a pose termina no quadro do disparo e o boss
       já está manobrando quando o projétil ainda está na mão dele. */
    if (p.t >= p.dur + 0.28) this.pose = null;
  }

  /* -------------------------------------------------------------- a rajada
   *
   * O tiro básico: um SURTO de bolas escuras, alternando as mãos, muito mais
   * rápido que a rajada humana. Ver `NAMEK.freeza.rajada` para os números e
   * para por que ele respira entre os surtos.
   *
   * As bolas são simuladas AQUI — não há cliente para julgar o acerto delas —
   * e o cliente recebe só o disparo, exatamente como recebe o de um bot. As
   * duas simulações são a mesma conta (`distSeg` contra a lista de corpos), e é
   * por isso que a bola que a tela mostra passando raspando é a mesma que não
   * tirou vida. */
  passoDaRajada(dt, agora) {
    if (this.surto <= 0 || this.tBola > 0) return;
    const R = NAMEK.freeza.rajada;
    const alvo = this.pose.alvo === null ? null : this.corpoDe(this.pose.alvo);
    if (!alvo || !alvo.alive) {
      this.surto = 0;
      return;
    }
    if (this.ki < R.ki) {
      this.surto = 0;
      return;
    }
    this.ki -= R.ki;
    this.surto--;
    this.tBola = 1 / R.cadencia;

    const o = this.maoEm(this.mao);
    this.mao = this.mao ? 0 : 1;

    /* A MIRA COM ANTECIPAÇÃO. Ele lidera o alvo — a bola vai para onde a pessoa
       VAI ESTAR, e não para onde ela está. É a diferença entre um adversário que
       acerta quem voa em linha reta e um que só acerta quem está parado; e é
       também o que dá sentido ao passo lateral, que continua funcionando porque
       a antecipação supõe velocidade constante. */
    const tv = Math.hypot(alvo.x - o.x, alvo.y - o.y, alvo.z - o.z) / R.velocidade;
    let dx = alvo.x + alvo.vx * tv - o.x;
    let dy = alvo.y + NAMEK.fighter.chest + alvo.vy * tv - o.y;
    let dz = alvo.z + alvo.vz * tv - o.z;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;

    /* O ERRO de mira, em graus, multiplicado pela dificuldade. Como nos bots: o
       nível manso erra a MIRA, não a decisão — bot que decide mal parece burro,
       bot que mira mal parece humano. */
    const err = ((NAMEK.freeza.rajada.erro * this.dif.erro) * Math.PI) / 180;
    if (err > 0) {
      dx += (Math.random() - 0.5) * err * 2;
      dy += (Math.random() - 0.5) * err * 2;
      dz += (Math.random() - 0.5) * err * 2;
      const m = Math.hypot(dx, dy, dz) || 1;
      dx /= m; dy /= m; dz /= m;
    }

    if (this.bolas.length < MAX_BOLAS) {
      this.bolas.push({
        x: o.x, y: o.y, z: o.z,
        dx, dy, dz,
        t: 0,
        alvo: alvo.id,
      });
    }

    const id = this.seqBola++;
    this.sala.broadcastAll({
      t: NS2C.FREEZA_POWER,
      kind: "rajada",
      id,
      o: [round(o.x), round(o.y), round(o.z)],
      d: [round(dx), round(dy), round(dz)],
      hand: this.mao ? 0 : 1,
      target: alvo.id,
      w: agora,
    });

    /* OS BOTS PRECISAM VER A BOLA PARA DESVIAR DELA.
     *
     * É a mesma porta pela qual a sala já avisa a rajada de um humano
     * (`NamekRoom.registrarRajada` → `avisarRajada`), e ela entra na simulação
     * deles como FANTASMA: `dano: 0`, `poder: 0`, ninguém é machucado por ela
     * ali — quem cobra o dano desta bola é o `passoDasBolas` deste arquivo, três
     * métodos abaixo. O que o aviso produz é medo, e só.
     *
     * Sem esta chamada os bots eram os únicos corpos em campo que não desviavam
     * de nada que o boss atirasse, e a medida foi feia: um bot sozinho contra o
     * `imperador` morria **quatro vezes por minuto**. Não é o boss estar forte
     * demais — é o adversário dele estar cego, e um número de balanço ajustado
     * contra um alvo cego mentiria sobre a luta de um humano, que enxerga. */
    this.sala.bots.avisarRajada({
      owner: NAMEK.freeza.id,
      o: [o.x, o.y, o.z],
      d: [dx, dy, dz],
      target: alvo.id,
    });

    if (this.surto <= 0) this.tRajada = NAMEK.freeza.rajada.pausa;
  }

  /** Onde nasce um golpe: a mão, deslocada do peito pelo lado que atira. */
  maoEm(mao) {
    const lado = mao ? 1 : -1;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    /* O eixo lateral do corpo é (cos yaw, 0, −sin yaw): a mesma convenção do
       `handOffset` do lutador, com a largura de ombro do boss.
       Os DOIS deslocamentos são multiplicados pela escala do corpo, e essa
       multiplicação não é enfeite: com o boss no triplo do tamanho
       (`NAMEK.freeza.altura / alturaBase`), 78 cm de ombro deixariam os dois
       golpes saindo de dentro do esterno de uma criatura de 6,7 m — o clarão do
       cliente sai da mão desenhada e o projétil da sala sairia do meio do peito,
       e o jogador veria os dois em lugares diferentes. `peito` já vem escalado
       do config; o que falta escalar é o que está escrito aqui. */
    const k = NAMEK.freeza.altura / NAMEK.freeza.alturaBase;
    return {
      x: this.pos.x + c * 0.78 * k * lado,
      y: this.pos.y + NAMEK.freeza.peito + 0.16 * k,
      z: this.pos.z - s * 0.78 * k * lado,
    };
  }

  /** O passo das bolas dele. A mesma varredura de `NamekBotSquad.passoDasBolas`. */
  passoDasBolas(dt, agora) {
    if (!this.bolas.length) return;
    const R = NAMEK.freeza.rajada;
    const vivas = [];
    for (const b of this.bolas) {
      b.t += dt;
      if (b.t > R.vida) continue;

      /* A PERSEGUIÇÃO FRACA, na régua da rajada humana: gira até `turnRate` em
         direção ao alvo enquanto ele estiver no cone e o prazo não vencer. Ver
         §6.1 do plano — "levemente" é o requisito. */
      const H = R.homing;
      if (b.t < H.duration && b.alvo != null) {
        const a = this.corpoDe(b.alvo);
        if (a && a.alive) {
          let tx = a.x - b.x;
          let ty = a.y + NAMEK.fighter.chest - b.y;
          let tz = a.z - b.z;
          const tn = Math.hypot(tx, ty, tz) || 1;
          tx /= tn; ty /= tn; tz /= tn;
          const cos = tx * b.dx + ty * b.dy + tz * b.dz;
          if (cos > Math.cos((H.cone * Math.PI) / 180)) {
            const maxRad = (H.turnRate * Math.PI * dt) / 180;
            const ang = Math.acos(clamp(cos, -1, 1));
            const k = ang > 1e-5 ? Math.min(1, maxRad / ang) : 0;
            b.dx += (tx - b.dx) * k;
            b.dy += (ty - b.dy) * k;
            b.dz += (tz - b.dz) * k;
            const m = Math.hypot(b.dx, b.dy, b.dz) || 1;
            b.dx /= m; b.dy /= m; b.dz /= m;
          }
        }
      }

      const passo = R.velocidade * dt;
      const nx = b.x + b.dx * passo;
      const ny = b.y + b.dy * passo;
      const nz = b.z + b.dz * passo;

      const vitima = this.varrer(b, nx, ny, nz, R.raio);
      if (vitima) {
        this.bater(vitima, R.dano, "freeza", [b.dx, b.dy, b.dz], { x: nx, y: ny, z: nz });
        continue;
      }
      /* O chão. A cratera passa pelo mesmo `NamekRoom.cratera` de todo mundo —
         é o que faz o buraco dele ser o mesmo buraco em todas as telas e entrar
         na lista do `welcome` de quem chegar depois. */
      if (ny <= this.sala.field.heightAt(nx, nz)) {
        this.sala.cratera(nx, nz, R.power * this.dif.dano, null);
        continue;
      }
      if (Math.hypot(nx, nz) > NAMEK.world.flyRadius) continue;

      b.x = nx;
      b.y = ny;
      b.z = nz;
      vivas.push(b);
    }
    this.bolas = vivas;
  }

  /** Quem esta bola atravessou neste passo. */
  varrer(b, nx, ny, nz, raio) {
    const alcance = raio + NAMEK.fighter.radius;
    let melhor = null;
    let melhorD = Infinity;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive || c.invuln) continue;
      const d = distSeg(
        c.x, c.y + NAMEK.fighter.chest, c.z,
        b.x, b.y, b.z,
        nx, ny, nz,
      );
      if (d <= alcance && d < melhorD) {
        melhorD = d;
        melhor = c;
      }
    }
    return melhor;
  }

  /* ------------------------------------------------------------- DEATH BEAM
   *
   * O poder RÁPIDO. Ele é resolvido por VARREDURA INSTANTÂNEA no quadro em que
   * sai, e não por projétil, e isso é uma decisão consciente: a 620 m/s ele
   * cruza a arena inteira em um segundo e meio, o que dá trinta quadros de
   * simulação para descrever uma coisa que o olho lê como um traço que já está
   * lá. Simular o voo custaria trinta varreduras para produzir exatamente o
   * mesmo resultado que uma — e, pior, produziria um resultado DIFERENTE do que
   * a tela mostra, porque o cliente desenha o feixe do disparo até o alcance na
   * mesma fração de segundo.
   *
   * O que ele perde com isso: a curva. O `homing` dele existe no config e vale
   * para o DESENHO (o `BeamPool` do cliente o usa); o dano é pela reta. Com
   * `arcMax` de 14° e 0,35 s de prazo, a diferença entre as duas é menor que o
   * raio de acerto — e é por isso que este é o único golpe do repertório dele
   * que pode se dar ao luxo de ser hitscan.
   */
  soltarRaio(agora) {
    const P = NAMEK.freeza.poderes.raioDaMorte;
    if (this.ki < P.ki) return;
    this.ki -= P.ki;
    this.tRaio = P.recarga;

    const alvo = this.pose?.alvo == null ? null : this.corpoDe(this.pose.alvo);
    const o = this.maoEm(1);
    let dx;
    let dy;
    let dz;
    if (alvo && alvo.alive) {
      dx = alvo.x - o.x;
      dy = alvo.y + NAMEK.fighter.chest - o.y;
      dz = alvo.z - o.z;
    } else {
      dx = Math.sin(this.yaw);
      dy = Math.sin(this.pitch);
      dz = Math.cos(this.yaw);
    }
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;

    this.sala.broadcastAll({
      t: NS2C.FREEZA_POWER,
      kind: "raioDaMorte",
      o: [round(o.x), round(o.y), round(o.z)],
      d: [round(dx), round(dy), round(dz)],
      target: alvo?.id ?? null,
      w: agora,
    });

    /* ELE PERFURA: todo mundo no eixo leva, e não só o primeiro. É a metade
       "perfurante" do pedido, e ela é o que torna o golpe perigoso contra um
       grupo alinhado sem precisar de raio de área. */
    const ate = Math.min(P.range, this.distanciaAoRelevo(o, dx, dy, dz, P.range));
    const ex = o.x + dx * ate;
    const ey = o.y + dy * ate;
    const ez = o.z + dz * ate;
    const dano = P.dps * P.sustain * this.dif.dano;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive || c.invuln) continue;
      const d = distSeg(c.x, c.y + NAMEK.fighter.chest, c.z, o.x, o.y, o.z, ex, ey, ez);
      if (d > P.hitRadius + NAMEK.fighter.radius) continue;
      this.bater(c, dano, "raioDaMorte", [dx, dy, dz], { x: c.x, y: c.y + NAMEK.fighter.chest, z: c.z });
    }
    /* E ele fura o chão onde termina — estreito e fundo, como o Kamehameha. */
    if (ate < P.range) {
      this.sala.cratera(ex, ez, P.power, null, P.craterDeep);
    }
  }

  /** Até onde este raio anda antes de encontrar relevo. Marcha grossa: o passo
   *  é o raio do golpe, que é a resolução em que errar não muda nada. */
  distanciaAoRelevo(o, dx, dy, dz, alcance) {
    const passo = 6;
    for (let d = passo; d <= alcance; d += passo) {
      const x = o.x + dx * d;
      const y = o.y + dy * d;
      const z = o.z + dz * d;
      if (y <= this.sala.field.heightAt(x, z)) return d;
    }
    return alcance;
  }

  /* ---------------------------------------------------------- DEATH BALL --
   *
   * O poder GRANDE. Uma esfera só, lenta, que persegue de leve e detona no
   * primeiro corpo, no chão ou no fim do prazo — e a detonação varre TODO MUNDO
   * dentro dos 19 m. É o golpe que cumpre "ele luta com todos ao mesmo tempo"
   * sem depender de escolha de alvo nenhuma.
   *
   * Uma só por vez, e o motivo é de jogo e não de custo: duas Death Balls no ar
   * ao mesmo tempo são duas coisas de trinta e oito metros de diâmetro na tela,
   * e a segunda não acrescenta ameaça — ela só esconde a primeira.
   */
  soltarEsfera(agora) {
    const P = NAMEK.freeza.poderes.esferaDaMorte;
    if (this.ki < P.ki || this.esfera) return;
    this.ki -= P.ki;
    this.tEsfera = P.recarga;

    const alvo = this.pose?.alvo == null ? null : this.corpoDe(this.pose.alvo);
    /* Ela sai de ACIMA da cabeça — é onde ele a segura na referência, e é
       também o único lugar de onde uma esfera de 19 m de raio pode sair sem
       engolir o próprio corpo dele. */
    const o = {
      x: this.pos.x,
      y: this.pos.y + NAMEK.freeza.altura + P.hitRadius * 0.5,
      z: this.pos.z,
    };
    let dx;
    let dy;
    let dz;
    if (alvo && alvo.alive) {
      dx = alvo.x - o.x;
      dy = alvo.y - o.y;
      dz = alvo.z - o.z;
    } else {
      dx = Math.sin(this.yaw);
      dy = -0.4;
      dz = Math.cos(this.yaw);
    }
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;

    this.esfera = { x: o.x, y: o.y, z: o.z, dx, dy, dz, t: 0, arco: 0, alvo: alvo?.id ?? null };

    this.sala.broadcastAll({
      t: NS2C.FREEZA_POWER,
      kind: "esferaDaMorte",
      o: [round(o.x), round(o.y), round(o.z)],
      d: [round(dx), round(dy), round(dz)],
      target: alvo?.id ?? null,
      w: agora,
    });
  }

  passoDaEsfera(dt, agora) {
    const e = this.esfera;
    if (!e) return;
    const P = NAMEK.freeza.poderes.esferaDaMorte;
    e.t += dt;
    if (e.t > P.sustain) {
      this.detonarEsfera(agora);
      return;
    }

    /* A perseguição, com teto TOTAL (`arcMax`) — a mesma trava da Genki Dama, e
       pelo mesmo motivo: um golpe que apaga um grupo e que persegue sem limite
       não é um golpe, é uma sentença. */
    const H = P.homing;
    if (e.t < H.duration && e.alvo != null && e.arco < (H.arcMax * Math.PI) / 180) {
      const a = this.corpoDe(e.alvo);
      if (a && a.alive) {
        let tx = a.x - e.x;
        let ty = a.y + NAMEK.fighter.chest - e.y;
        let tz = a.z - e.z;
        const tn = Math.hypot(tx, ty, tz) || 1;
        tx /= tn; ty /= tn; tz /= tn;
        const cos = tx * e.dx + ty * e.dy + tz * e.dz;
        if (cos > Math.cos((H.cone * Math.PI) / 180)) {
          const maxRad = (H.turnRate * Math.PI * dt) / 180;
          const ang = Math.acos(clamp(cos, -1, 1));
          const gasto = Math.min(maxRad, ang);
          const k = ang > 1e-5 ? gasto / ang : 0;
          e.arco += gasto;
          e.dx += (tx - e.dx) * k;
          e.dy += (ty - e.dy) * k;
          e.dz += (tz - e.dz) * k;
          const m = Math.hypot(e.dx, e.dy, e.dz) || 1;
          e.dx /= m; e.dy /= m; e.dz /= m;
        }
      }
    }

    const passo = P.speed * dt;
    e.x += e.dx * passo;
    e.y += e.dy * passo;
    e.z += e.dz * passo;

    if (e.y <= this.sala.field.heightAt(e.x, e.z) + P.hitRadius * 0.35) {
      this.detonarEsfera(agora);
      return;
    }
    if (Math.hypot(e.x, e.z) > NAMEK.world.flyRadius) {
      this.esfera = null;
      return;
    }
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive || c.invuln) continue;
      const dx = c.x - e.x;
      const dy = c.y + NAMEK.fighter.chest - e.y;
      const dz = c.z - e.z;
      if (dx * dx + dy * dy + dz * dz <= P.hitRadius * P.hitRadius) {
        this.detonarEsfera(agora);
        return;
      }
    }
  }

  detonarEsfera(agora) {
    const e = this.esfera;
    if (!e) return;
    this.esfera = null;
    const P = NAMEK.freeza.poderes.esferaDaMorte;
    const dano = P.damage * this.dif.dano;
    const r2 = P.hitRadius * P.hitRadius;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive || c.invuln) continue;
      const dx = c.x - e.x;
      const dy = c.y + NAMEK.fighter.chest - e.y;
      const dz = c.z - e.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      const n = Math.hypot(dx, dy, dz) || 1;
      this.bater(c, dano, "esferaDaMorte", [dx / n, dy / n, dz / n], { x: c.x, y: c.y, z: c.z });
    }
    /* A cratera máxima do jogo. `null` de dono: a cota por lutador de
       `podeCravar` não se aplica a quem não é lutador, e o boss abre um buraco
       a cada dezesseis segundos — não há spray a conter. */
    this.sala.cratera(e.x, e.z, P.power, null);
  }

  /* ------------------------------------------------------- a onda de repulsa
   *
   * Ela REAPROVEITA a onda de ki que o modo já tem: a sala retransmite um
   * `NS2C.BURST` com `owner` igual ao id do boss, e todo cliente já sabe
   * desenhá-la, varrer as bolas de ki que estiverem dentro dela e empurrar o
   * próprio corpo (`NamekGame.empurraoDaOnda`). Zero linha de cliente nova para
   * o efeito inteiro, incluindo o empurrão no humano — que é a única parte que o
   * servidor não consegue fazer sozinho, porque a posição de um humano é dele.
   *
   * O que a sala faz deste lado é o resto: o dano em todo mundo e o empurrão nos
   * bots, que são corpos dela.
   */
  talvezOnda(agora) {
    const O = NAMEK.freeza.onda;
    if (this.tOnda > 0 || this.ki < O.ki) return false;
    let perto = 0;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive) continue;
      const dx = c.x - this.pos.x;
      const dy = c.y - this.pos.y;
      const dz = c.z - this.pos.z;
      if (dx * dx + dy * dy + dz * dz <= O.raio * O.raio) perto++;
    }
    if (perto < O.gatilho) return false;

    this.ki -= O.ki;
    this.tOnda = O.recarga;
    this.iniciarPose(POSE.onda, 0.35, null);
    this.repelir(agora);
    return true;
  }

  repelir(agora) {
    const O = NAMEK.freeza.onda;
    const p = { x: this.pos.x, y: this.pos.y + NAMEK.freeza.peito, z: this.pos.z };
    this.sala.broadcastAll({
      t: NS2C.BURST,
      owner: NAMEK.freeza.id,
      p: [round(p.x), round(p.y), round(p.z)],
      w: agora,
    });
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive) continue;
      const dx = c.x - p.x;
      const dy = c.y + NAMEK.fighter.chest - p.y;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > O.raio) continue;
      const f = 1 - d / O.raio;
      const inv = d > 1e-3 ? 1 / d : 0;
      if (c.ref?.isBot) {
        const v = O.empurrao * f;
        c.ref.velocity.x += dx * inv * v;
        c.ref.velocity.y += dy * inv * v + v * 0.3;
        c.ref.velocity.z += dz * inv * v;
      }
      this.bater(c, O.dano * f, "freezaOnda", [dx * inv, dy * inv, dz * inv], { x: c.x, y: c.y, z: c.z });
    }
  }

  /* ------------------------------------------------------------- o teleporte
   *
   * A saída de emergência. Ver `NAMEK.freeza.teleporte` para por que ela existe
   * (sem ela, oito jogadores prendem um boss a 118 m/s num fogo cruzado do qual
   * não há como sair) e por que ela é curta.
   *
   * O salto reaparece ATRÁS do alvo, e não em direção contrária: fugir para
   * longe deixaria o boss inofensivo por três segundos, o que é uma recompensa
   * pelo cerco. Reaparecer nas costas de quem estava atirando inverte a briga
   * de lado sem lhe dar folga, que é o que o gesto quer dizer na referência.
   */
  talvezTeleportar(agora) {
    const T = NAMEK.freeza.teleporte;
    if (this.tTeleporte > 0) return false;
    if (agora > this.janelaAte) this.danoJanela = 0;
    if (this.danoJanela < this.vidaMax * T.gatilho) return false;

    /* SÓ CONTRA CERCO. Ver `NAMEK.freeza.teleporte.atacantes`: num duelo, um
       boss que salta 46 m instantaneamente é inatingível por qualquer coisa que
       esteja no ar — o golpe não erra a mira, ele erra porque o alvo deixou de
       estar onde estava. Com três ou mais em volta, o mesmo salto deixa de ser
       uma esquiva e passa a ser a única saída de um cerco. */
    let perto = 0;
    const r2 = T.raioCerco * T.raioCerco;
    for (const c of this.sala.corpos) {
      if (c.boss || !c.alive) continue;
      const dx = c.x - this.pos.x;
      const dy = c.y - this.pos.y;
      const dz = c.z - this.pos.z;
      if (dx * dx + dy * dy + dz * dz <= r2) perto++;
    }
    if (perto < T.atacantes) return false;

    const alvo = this.alvoId === null ? null : this.corpoDe(this.alvoId);
    this.tTeleporte = T.recarga;
    this.danoJanela = 0;

    let ang;
    if (alvo) {
      /* Atrás do alvo, do ponto de vista da linha que o liga ao boss. */
      ang = Math.atan2(this.pos.x - alvo.x, this.pos.z - alvo.z) + Math.PI * (0.7 + Math.random() * 0.6);
      this.pos.x = alvo.x + Math.sin(ang) * T.distancia;
      this.pos.z = alvo.z + Math.cos(ang) * T.distancia;
      this.pos.y = alvo.y + NAMEK.freeza.voo.degrau;
    } else {
      ang = Math.random() * Math.PI * 2;
      this.pos.x += Math.sin(ang) * T.distancia;
      this.pos.z += Math.cos(ang) * T.distancia;
    }
    const chao = this.sala.field.heightAt(this.pos.x, this.pos.z) + NAMEK.freeza.voo.alturaMin;
    if (this.pos.y < chao) this.pos.y = chao;
    this.vel.x = this.vel.y = this.vel.z = 0;
    /* O sinal para o cliente CORTAR a interpolação. Sem ele o corpo dele
       atravessaria os 46 m em linha reta na tela, o que não é um teleporte —
       é um tranco. */
    this._teleportou = true;
    return true;
  }

  /* ------------------------------------------------------------------ dano */

  /**
   * O dano dele num lutador. **Passa pelo funil da sala**, sempre.
   *
   * `por: null` de propósito, e vale escrever por quê: `aplicarDano` dá o abate
   * a quem passa em `por`, e um abate do boss não é de ninguém — não há placar
   * onde marcá-lo, e premiar alguém seria premiar o acaso. É a mesma decisão que
   * a lava e o mar já tomam.
   */
  bater(corpo, dano, kind, d, p) {
    if (!(dano > 0)) return;
    /* **"OS ATAQUES DO FREEZA TIRAM BEM MENOS LIFE DO PLAYER"** — quando o
     * player está em Super Saiyajin. `NAMEK.ssj.danoDoFreeza` (45 %), e ele mora
     * AQUI pelo mesmo motivo que o multiplicador da direção contrária mora em
     * `levarDano`: esta é a porta ÚNICA dos golpes do boss contra gente — a
     * rajada, o raio da morte, a esfera e a onda passam todos por ela —, então
     * uma linha cobre os quatro e cobre o quinto que aparecer.
     *
     * E não no funil da sala (`NamekRoom.aplicarDano`), de propósito: por lá
     * passa também o fogo amigo entre jogadores, a lava, a queda e o mar, e um
     * redutor genérico ali daria ao Super Saiyajin uma resistência a tudo que
     * ninguém pediu. A assimetria é o ponto — ele é forte contra o CHEFE.
     *
     * A guarda continua sendo cobrada depois, dentro de `aplicarDano`, e as duas
     * se compõem: ver a composição escrita em `NAMEK.ssj.danoDoFreeza`. */
    const passa = dano * resistenciaAoFreeza(corpo.ref);
    if (!(passa > 0)) return;
    this.sala.aplicarDano(corpo.ref, passa, { por: null, kind, p, d });
  }

  /* --------------------------------------------------------------- a pose -- */

  /** A pose do boss, 20 Hz — a mesma taxa das poses de lutador. */
  transmitir(agora) {
    if (!this.sala.players.size) return;
    if (agora < this.proximaPose) return;
    this.proximaPose = agora + 1000 / NAMEK.net.stateRate;

    /* A AURA acende com o que ele está fazendo: forte na pose de um golpe,
       média na investida, fraca parado. É o mesmo canal contínuo que o lutador
       tem, e é o que faz o corpo dele dizer de longe se algo está vindo. */
    const rapidez = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    let aura = 0.28 + clamp(rapidez / NAMEK.freeza.voo.arranque, 0, 1) * 0.34;
    if (this.pose) {
      aura = this.pose.tipo === POSE.esfera ? 1 : 0.78;
    }
    this.tAura = damp(this.tAura, aura, 9, 1 / NAMEK.net.stateRate);

    const msg = {
      t: NS2C.FREEZA_STATE,
      p: this.pontoRede(),
      v: [round2(this.vel.x), round2(this.vel.y), round2(this.vel.z)],
      y: round(this.yaw),
      i: round(this.pitch),
      r: round(this.roll),
      a: round(this.tAura),
      k: round(this.ki / NAMEK.freeza.kiMax),
      s: this.pose ? round(clamp(this.pose.t / this.pose.dur, 0, 1)) : 0,
      u: this.pose ? this.pose.tipo : POSE.parado,
      w: agora,
    };
    if (this._teleportou) {
      msg.tp = 1;
      this._teleportou = false;
    }
    this.sala.broadcastAll(msg);
  }
}

export { POSE as POSE_FREEZA };
