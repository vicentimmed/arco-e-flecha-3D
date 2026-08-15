/* ---------------------------------------------------------------------------
   PowerSystem — o gerente de tudo o que sai da mão de um lutador.

   Cinco pools, um cartório de acontecimentos e UMA luz. Quem chama não conhece
   nenhum dos cinco: manda `spawnBlast`, `spawnSpecial` ou `spawnBurst`, chama
   `update` uma vez por quadro e recebe de volta a lista do que precisa ser
   reportado à sala. É o mesmo desenho de `systems/special.js` do lado do
   arqueiro — o sistema sabe o que aconteceu, e a sala sabe o que isso custa em
   vida.

   ============================================================================
   1. QUEM JULGA O QUÊ
   ============================================================================

   §8 do plano, e vale a pena repetir porque é a regra que atravessa os seis
   arquivos: **quem atira é a autoridade sobre o próprio acerto; a sala é a
   autoridade sobre a vida.**

   Na prática, aqui dentro:

   • Os projéteis dos OUTROS são desenhados, colididos e mortos normalmente —
     senão uma bola de ki alheia atravessaria um corpo na sua tela e continuaria
     voando, que é a leitura de um jogo quebrado.
   • Mas NADA que pertença a outro dono entra no relatório. Só o que tem
     `owner === localId` sai daqui, e é isso que impede duas telas de cobrarem o
     mesmo dano duas vezes.

   ============================================================================
   2. OS QUATRO CANAIS DE SAÍDA
   ============================================================================

   `update` devolve quatro listas e dois canais locais, e o mapeamento delas
   para o protocolo é direto — o que também explica por que são estes e não
   outros:

       acertos    → NC2S.BLAST_HIT     { id, victim, p }
       queimando  → NC2S.SPECIAL_HIT   { victim, kind, dt }
       chao       → NC2S.GROUND_HIT    { p, power }
       empurroes  → efeito local (a onda empurra quem está na própria tela)
       noAr       → efeito local (o estouro que NÃO tocou o chão, e por isso
                    não tem cratera para anunciá-lo — ver `filaNoAr`)
       abalo      → efeito local (o tremor da lente; não é lista, é o mais
                    forte do quadro, pela mesma razão da luz)

   Os dois últimos não sobem para a sala e nunca subiriam: eles descrevem o que
   a MINHA tela faz com um acontecimento que ela já conhece. Mandá-los seria
   pedir ao servidor que retransmitisse um som e um tranco de câmera.

   **`queimando` é o canal de TODO especial que cobra vida**, e não só do feixe.
   O feixe cobra por segundo (`dps` em `NAMEK.specials`) e manda o `dt` de
   exposição acumulada; o Kienzan e a Genki Dama cobram de uma vez (`damage`) e
   mandam `dt: 0`. A sala não precisa de um canal novo para saber a diferença
   porque a diferença já está escrita em `NAMEK.specials`: quem tem `dps` cobra
   por tempo, quem tem `damage` cobra por evento. Um quinto canal só para dizer
   isso seria uma mensagem nova para carregar uma informação que os dois lados
   já têm.

   ============================================================================
   3. OS REGISTROS SÃO REUSADOS
   ============================================================================

   Os objetos dentro das quatro listas saem de pools e **valem por um quadro
   só.** Quem os recebe deve serializá-los na mesma passada — que é exatamente o
   que o `reportar` do `game.js` faz — e nunca guardá-los.

   Isso não é economia de bytes, é economia de PAUSA. Um acerto por bola com
   duzentas em voo, mais um objeto `{x,y,z}` dentro de cada um, é lixo gerado no
   ritmo do combate; e coletor de lixo rodando no meio de uma troca de tiros é a
   engasgada que o jogador sente e não sabe explicar. O §3 do plano pede zero
   alocação por quadro em regime, e o relatório é a última porta por onde ela
   escaparia.

   ============================================================================
   4. O ORÇAMENTO
   ============================================================================

   **Luzes dinâmicas: 1.** Uma só, criada no construtor e mantida na cena a
   partida inteira com intensidade zero quando não há nada aceso. Ela não é
   criada sob demanda de propósito: o renderer decide a quantidade de luzes na
   COMPILAÇÃO do programa, e uma luz que aparece no meio da partida recompila
   todos os materiais da cena — o engasgo aconteceria no primeiro Kamehameha,
   que é o pior quadro possível para engasgar. O cenário usa duas (sol e
   hemisfério); com esta, o total do jogo é três, que é o teto do §3.

   Ela é do especial de quem está JOGANDO, nunca de outra pessoa e nunca de uma
   bola de ki. Quando dois efeitos locais pedem ao mesmo tempo, o mais forte
   ganha — na prática a Genki Dama ganha do feixe, que é a ordem certa.

   **Chamadas de desenho, no pior caso absoluto:**

       bolas de ki      3    (três InstancedMesh, de 1 a 256 bolas)
       feixes           24   (6 no pool × 4 malhas)
       discos           12   (6 × 2)
       esferas          15   (5 × 3 — o Galick Gun tem núcleo, coroa e fita; a
                              Genki Dama usa 2, e a fita dela fica invisível)
       ondas            8    (8 × 1)
       ------------------------------
       total            62

   Esse 62 é o pior caso ARITMÉTICO, não o realista: ele exige seis feixes, seis
   discos, cinco esferas e oito ondas vivos no mesmo quadro, o que pede vinte e
   cinco especiais simultâneos numa sala de quinze pessoas em que a barra leva
   5,3 s para encher. Um tiroteio quente de verdade fica em ~12: as três camadas
   das bolas, um feixe, uma esfera e uma onda. E o que está fora do pool está
   `visible = false`, que o renderer descarta antes de montar a lista de desenho
   — pool ocioso não custa chamada nenhuma.

   (O total subiu de 53 quando o Galick Gun deixou de ser um feixe e virou uma
   esfera. Na prática a conta MELHOROU: o pool de feixes passou a atender um
   golpe só, e as quatro malhas de um feixe custam o dobro das duas de uma
   esfera.)

   ============================================================================
   5. AS PARTÍCULAS
   ============================================================================

   Os poderes emitem pelo barramento (`EventType.PARTICLES`), como `impactFx.js`
   já faz no jogo do arqueiro, e pelo mesmo motivo que está escrito lá: uma bola
   de ki não deveria conhecer o pool de partículas da cena, do mesmo jeito que um
   zumbi não precisa do mixer para gemer. Quem quiser que a fagulha da pose de
   carga apareça só precisa ter alguém escutando esse evento — e se não houver
   ninguém, o `emit` não faz nada e o golpe continua inteiro, porque tudo o que é
   ESTRUTURAL aqui (feixe, disco, esfera, casca) é geometria, não partícula.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { damp } from "../../utils/math.js";
import {
  BlastPool,
  escolherAlvo,
  atingivel,
  distancia2AoAlvo,
  distanciaAoFeixe,
  acharChao,
} from "./blast.js";
import { BeamPool } from "./beam.js";
import { DiskPool } from "./disk.js";
import { OrbPool } from "./orb.js";
import { BurstPool } from "./burst.js";

/* --------------------------------------------------------------------- luz */
/** m — alcance da única luz do sistema. */
const LUZ_ALCANCE = 175;
/** Expoente de queda. 1,5 é o meio-termo entre o realismo de 2 e a leitura. */
const LUZ_QUEDA = 1.5;
/** Intensidade a `forca = 1`. Mesma ordem do `blastLight` do arqueiro. */
const LUZ_INTENSIDADE = 1250;
/** 1/s — quão rápido a intensidade persegue o pedido. Acender de uma vez
 *  aparece como um corte de energia ao contrário. */
const LUZ_SUAVE = 16;

/* s — teto do passo.
 *
 * Um quadro de cinco segundos (aba que voltou do fundo, GPU que travou) sem
 * teto faria TODO projétil dar um pulo de trezentos metros atravessando quem
 * estivesse no caminho, e a subdivisão de colisão da bola de ki tentaria fechar
 * o buraco com duzentos subpassos vezes duzentas bolas. Estourado o teto, os
 * projéteis simplesmente ficam para trás do relógio — o que é invisível, porque
 * quem acabou de voltar de uma travada de cinco segundos não sabe onde nada
 * estava. */
const PASSO_MAX = 0.1;

/** A lista vazia, para quando `alvos` não vem. Congelada: ninguém escreve nela. */
const SEM_ALVOS = Object.freeze([]);

/* ============================================================================
   O cartório

   Quatro filas de registros pré-alocados. `limpar` zera os contadores sem soltar
   nada; `novo` empresta o próximo. Crescer é possível (uma partida absurda pode
   pedir mais do que a fila tem), custa uma alocação, e depois disso a fila fica
   grande para sempre — que é o comportamento certo de um pool: pagar uma vez.
   ========================================================================== */

class Fila {
  constructor(capacidade, molde) {
    this.molde = molde;
    this.pool = new Array(capacidade);
    for (let i = 0; i < capacidade; i++) this.pool[i] = molde();
    /** O array que sai no relatório. Reusado: `length = 0` não solta o buffer. */
    this.lista = [];
    this.usados = 0;
  }

  limpar() {
    this.lista.length = 0;
    this.usados = 0;
  }

  novo() {
    if (this.usados === this.pool.length) this.pool.push(this.molde());
    const r = this.pool[this.usados++];
    this.lista.push(r);
    return r;
  }
}

/* ============================================================================
   O sistema
   ========================================================================== */

export class PowerSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../../shared/namek/field.js").NamekField} field
   */
  constructor(scene, field) {
    this.scene = scene;
    this.field = field;

    this.blasts = new BlastPool(scene, field);
    this.beams = new BeamPool(scene, field);
    this.disks = new DiskPool(scene, field);
    this.orbes = new OrbPool(scene, field);
    this.bursts = new BurstPool(scene, field);

    /* As capacidades saem do pior caso de cada canal, não de um número redondo:
       64 acertos é mais bolas acertando num quadro só do que 15 pessoas
       conseguem ter em voo mirando na mesma direção; 32 queimaduras cobrem seis
       feixes despejando a exposição de todo mundo no mesmo quadro (o despejo é
       a 10 Hz e cai em quadros diferentes por feixe, mas o teto tem de valer
       para o quadro em que todos coincidem). */
    this.filaAcertos = new Fila(64, () => ({
      blastId: null,
      owner: null,
      victim: null,
      p: { x: 0, y: 0, z: 0 },
    }));
    this.filaQueima = new Fila(32, () => ({
      owner: null,
      victim: null,
      kind: null,
      dt: 0,
    }));
    this.filaChao = new Fila(24, () => ({
      owner: null,
      p: { x: 0, y: 0, z: 0 },
      power: 0,
    }));
    /* Os estouros NO AR — os que não abrem cratera e por isso não têm nenhum
       outro canal por onde avisar que aconteceram. Uma Genki Dama que detona a
       duzentos metros de altura é a maior coisa que este modo desenha, e sem
       esta fila ela acontecia em SILÊNCIO: `chao` só existe quando o golpe
       encosta no terreno. Oito por quadro é mais do que cinco esferas e seis
       discos conseguem produzir juntos. */
    this.filaNoAr = new Fila(8, () => ({
      owner: null,
      kind: null,
      p: { x: 0, y: 0, z: 0 },
      power: 0,
    }));
    this.filaEmpurroes = new Fila(32, () => ({
      owner: null,
      victim: null,
      push: { x: 0, y: 0, z: 0 },
      dano: 0,
    }));

    /** O objeto devolvido por `update`. Sempre o MESMO — as listas é que giram. */
    this.saida = {
      acertos: this.filaAcertos.lista,
      queimando: this.filaQueima.lista,
      chao: this.filaChao.lista,
      empurroes: this.filaEmpurroes.lista,
      noAr: this.filaNoAr.lista,
      /* O TREMOR DE CÂMERA do quadro, e não uma lista: sacudir a lente duas
         vezes no mesmo quadro não é o dobro do tremor, é o tremor mais forte
         dos dois. Mesma regra da luz, e pelo mesmo motivo — a tela é uma só.
         Zero quer dizer "nada a sacudir". */
      abalo: { forca: 0, dur: 0 },
    };

    /* O pedido de luz do quadro. Os efeitos locais escrevem aqui e o mais forte
       fica; nada é alocado porque o pedido é um objeto só, reescrito. */
    this._luzPedido = { forca: 0, x: 0, y: 0, z: 0, cor: 0xffffff };

    /** A interface que os cinco pools usam para relatar. Criada uma vez. */
    this.relato = {
      acerto: () => this.filaAcertos.novo(),
      queima: () => this.filaQueima.novo(),
      chao: () => this.filaChao.novo(),
      empurrao: () => this.filaEmpurroes.novo(),
      noAr: () => this.filaNoAr.novo(),
      /* O tremor da lente. Como a luz: o mais forte do quadro ganha, e somar
         dois seria sacudir o dobro por dois acontecimentos que o olho lê como
         um só. */
      abalo: (forca, dur) => {
        const a = this.saida.abalo;
        if (forca <= a.forca) return;
        a.forca = forca;
        a.dur = dur;
      },
      luz: (x, y, z, cor, forca) => {
        const p = this._luzPedido;
        if (forca <= p.forca) return;
        p.forca = forca;
        p.x = x;
        p.y = y;
        p.z = z;
        p.cor = cor;
      },
    };

    /* A ÚNICA LUZ. Ver o §4 do cabeçalho: ela nasce aqui e morre no `dispose`,
       e no meio disso só a intensidade muda. */
    this.luz = new THREE.PointLight(0xffffff, 0, LUZ_ALCANCE, LUZ_QUEDA);
    this.luz.castShadow = false;
    scene.add(this.luz);
  }

  /* --------------------------------------------------------------- disparos */

  /**
   * Uma bola de ki.
   *
   * O objeto recebido é REPASSADO ao pool, e não copiado num literal novo aqui.
   * Parece detalhe e não é: a rajada sai a 6/s por jogador e, com quinze em
   * campo, são noventa objetos por segundo criados só para atravessar uma
   * função. Foi medido — era o que sobrava de alocação depois de todo o resto.
   * Quem chama já paga um literal por disparo; pagar dois é gratuito para o
   * código e caro para o coletor.
   *
   * @param {object} disparo
   * @param {number|string} disparo.id     id do disparo, único por dono
   * @param {number|string} disparo.owner  quem atirou
   * @param {{x,y,z}} disparo.origem       a mão de onde ela sai
   * @param {{x,y,z}} disparo.dir          direção do tiro
   * @param {number} [disparo.hand]        0 esquerda, 1 direita
   * @param {number|string|null} [disparo.target] alvo travado NO DISPARO (§6.1)
   * @param {boolean} [disparo.local]      é o meu tiro
   */
  spawnBlast(disparo) {
    if (!disparo || !disparo.origem || !disparo.dir) return null;
    return this.blasts.spawn(disparo);
  }

  /**
   * Um especial. `kind` é uma chave de `NAMEK.specials`.
   *
   * O roteamento é EXPLÍCITO por id e não por dedução da forma do especial. Um
   * `if (S.dps) feixe else disco` funcionaria hoje e escolheria errado no dia em
   * que alguém acrescentasse um quinto golpe com dano por segundo que não fosse
   * um tubo. Quatro nomes, quatro destinos, e um `kind` desconhecido não faz
   * nada — o cliente não pode explodir porque a sala mandou uma palavra que ele
   * não conhece.
   *
   * @param {object} disparo
   * @param {number|string} disparo.owner
   * @param {string} disparo.kind     chave de `NAMEK.specials`
   * @param {{x,y,z}} disparo.origem  a mão (ou o peito) de onde ele sai
   * @param {{x,y,z}} disparo.dir     direção TRAVADA no disparo
   * @param {boolean} [disparo.local] é o meu golpe (ganha a luz)
   */
  spawnSpecial(disparo) {
    if (!disparo || !disparo.origem || !disparo.dir) return null;
    const kind = disparo.kind;
    if (!NAMEK.specials[kind]) return null;
    switch (kind) {
      case "kamehameha":
        return this.beams.disparar(disparo);
      /* O GALICK GUN MUDOU DE CASA. Ele era um feixe — o mesmo tubo do
         Kamehameha, com outra matiz — e virou uma esfera lançada, que é o que a
         referência mostra e o que o usuário pediu. O roteamento continua sendo
         por NOME e não por dedução da forma do golpe, e este é exatamente o dia
         que o comentário acima previa: a mudança foi uma linha, aqui, e nada
         mais no sistema precisou saber. */
      case "galick":
      case "genki":
        return this.orbes.disparar(disparo);
      case "disk":
        return this.disks.disparar(disparo);
      default:
        return null;
    }
  }

  /**
   * A onda de empurrão.
   *
   * Ela também VARRE as bolas alheias que estiverem dentro do raio — ver o
   * cabeçalho de `burst.js`. A varredura acontece aqui, e não lá dentro, porque
   * é a única coisa no modo em que um poder mexe noutro, e esconder isso dentro
   * da onda faria a bola de ki sumir sem que o arquivo dela tivesse uma linha
   * dizendo por quê.
   *
   * A RESSALVA de sincronismo, escrita porque ela é real: a onda é
   * retransmitida a todos e cada cliente varre a mesma esfera, mas as bolas em
   * perseguição podem estar a alguns centímetros de distância entre duas telas,
   * e uma bola exatamente na borda pode morrer numa e sobreviver na outra. Se
   * sobreviver na tela de quem a atirou e acertar, o acerto vale — porque é ele
   * quem julga. É a mesma classe de divergência que o modelo de confiança do
   * jogo já aceita em toda parte, e ela não decide partida nenhuma.
   */
  spawnBurst(disparo) {
    if (!disparo || !disparo.origem) return null;
    const o = disparo.origem;
    const onda = this.bursts.disparar(disparo);
    this.blasts.varrer(o.x, o.y, o.z, NAMEK.ki.burstRadius, disparo.owner);
    return onda;
  }

  /* ------------------------------------------------------------------ passo */

  /**
   * Um quadro.
   *
   * @param {number} dt
   * @param {Array<{id,x,y,z,raio,altura,vivo,invuln?}>} alvos quem pode ser
   *        atingido, em espaço de mundo e com os pés em `y`. `invuln` é
   *        opcional e, quando verdadeiro, torna o alvo INTANGÍVEL — ver
   *        `atingivel` em `blast.js`.
   * @param {number|string} localId quem é o dono desta tela
   * @returns {{acertos:Array, queimando:Array, chao:Array, empurroes:Array}}
   *          — REUSADO a cada quadro. Ver o §3 do cabeçalho.
   */
  update(dt, alvos, localId, cenario = null) {
    const passo = dt > PASSO_MAX ? PASSO_MAX : dt;
    const lista = alvos ?? SEM_ALVOS;

    this.filaAcertos.limpar();
    this.filaQueima.limpar();
    this.filaChao.limpar();
    this.filaEmpurroes.limpar();
    this.filaNoAr.limpar();
    this._luzPedido.forca = 0;
    this.saida.abalo.forca = 0;
    this.saida.abalo.dur = 0;

    this.blasts.update(passo, lista, localId, this.relato, cenario);
    this.beams.update(passo, lista, localId, this.relato);
    this.disks.update(passo, lista, localId, this.relato);
    this.orbes.update(passo, lista, localId, this.relato);
    this.bursts.update(passo, lista, localId, this.relato);

    this.acenderLuz(passo);
    return this.saida;
  }

  /** A luz segue o pedido mais forte do quadro, amortecida. */
  acenderLuz(dt) {
    const p = this._luzPedido;
    const alvo = p.forca * LUZ_INTENSIDADE;
    // Só reposiciona quando há pedido: sem isto, a luz apagada ficaria parada
    // no último ponto e voltaria a acender lá quando o próximo golpe saísse.
    if (p.forca > 0) {
      this.luz.position.set(p.x, p.y, p.z);
      this.luz.color.set(p.cor);
    }
    this.luz.intensity = damp(this.luz.intensity, alvo, LUZ_SUAVE, dt);
    if (this.luz.intensity < 0.5) this.luz.intensity = 0;
  }

  /* ------------------------------------------------------------------ resto */

  /** Quantos projéteis vivos — o HUD de depuração e o teste de orçamento leem
   *  isto. Conta bolas, feixes, discos, Genki Damas e ondas. */
  get count() {
    return (
      this.blasts.count +
      this.beams.count +
      this.disks.count +
      this.orbes.count +
      this.bursts.count
    );
  }

  /** Apaga tudo o que está em voo, sem soltar um pool. Troca de partida, morte
   *  do jogador, saída para o menu. */
  clear() {
    this.blasts.clear();
    this.beams.clear();
    this.disks.clear();
    this.orbes.clear();
    this.bursts.clear();
    this.filaAcertos.limpar();
    this.filaQueima.limpar();
    this.filaChao.limpar();
    this.filaEmpurroes.limpar();
    this.filaNoAr.limpar();
    this._luzPedido.forca = 0;
    this.saida.abalo.forca = 0;
    this.luz.intensity = 0;
  }

  dispose() {
    this.clear();
    this.blasts.dispose();
    this.beams.dispose();
    this.disks.dispose();
    this.orbes.dispose();
    this.bursts.dispose();
    this.scene.remove(this.luz);
    this.luz.dispose?.();
  }
}

/* ----------------------------------------------------------------- utilidades

   Reexportadas daqui para quem precisa das contas sem precisar dos pools: a
   escolha de alvo (que o sistema de entrada faz no instante do disparo, §6.1) e
   as três funções analíticas que substituem o Rapier neste modo (§4). Ver o fim
   de `blast.js`. */
export { escolherAlvo, atingivel, distancia2AoAlvo, distanciaAoFeixe, acharChao };
export { BlastPool } from "./blast.js";
export { BeamPool } from "./beam.js";
export { DiskPool } from "./disk.js";
export { OrbPool } from "./orb.js";
export { BurstPool } from "./burst.js";
