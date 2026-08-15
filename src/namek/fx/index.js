/* ---------------------------------------------------------------------------
   NamekFx — o gerente da destruição.

   Quatro chamadas de desenho para tudo o que quebra, levanta ou brilha no modo:

       poeira   billboards com alfa comum   — o que OCULTA
       brilho   billboards aditivos         — o que EMITE (clarão e fagulha)
       detrito  InstancedMesh de lascas     — o que tem VOLUME
       onda     InstancedMesh de anéis      — a onda de choque no chão

   Quem chama não conhece nenhuma delas. O contrato inteiro são seis verbos —
   `groundImpact`, `slam`, `propBreak`, `bodyHit`, `groundTrail`, `update` — e a
   razão é a mesma que `systems/impactFx.js` dá do lado do arqueiro: quem atira
   sabe ONDE bateu e COM QUANTA força, e não deveria saber a cor do pó de
   Namekusei nem quantas pedras uma Genki Dama arremessa. Traduzir potência em
   imagem é decisão de direção de arte, e decisão de direção de arte fica melhor
   num lugar só, onde dá para comparar lado a lado.

   ------------------------------------------------------------------ a escala

   Tudo é dimensionado pelo RAIO DA CRATERA, nunca pela potência crua. A potência
   vai de 0,12 (bola de ki) a 12 (Genki Dama) — cem vezes —, e cem vezes mais
   partículas não é uma escala, é um interruptor: ou a bola de ki não faz nada ou
   a Genki Dama consome o pool inteiro. O raio já passou pela raiz quadrada e
   pelo teto de `craterFor`, e vai de 4 m a 21 m: cinco vezes. Cinco vezes é uma
   escala que o olho lê como "isto foi maior que aquilo" em vez de "isto é outra
   coisa". Medido: a bola de ki solta 41 partículas ao todo (19 de poeira), o
   Kamehameha 93 e a Genki Dama 136 — com flocos três vezes maiores, que é o que
   faz ela encher a tela.

   ------------------------------------------------------------ nenhuma luz

   O clarão é GEOMETRIA ADITIVA — dois sprites e um anel —, e não uma
   `PointLight`. O teto de três luzes dinâmicas do §3 já está tomado pelo sol,
   pelo hemisfério e pelo especial de quem está jogando. Uma luz por impacto
   também não é "uma luz a mais": é uma recompilação de material por vez que o
   número de luzes muda, que é o defeito que `plano-lua-desempenho` documenta e
   que `fallingMeteor.js` evita pelo mesmo caminho — emissivo, halo aditivo e
   bloom. Aqui é a mesma receita.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";
import { SpritePool, ChipPool, RingPool, decodeCor } from "./pool.js";
import { poeiraDeImpacto, poeiraDeQueda, poeiraDeProp, poeiraDeRastro } from "./dust.js";
import { pedrasDeImpacto, pedrasDeQueda, estilhacarProp, atualizarDetritos } from "./debris.js";

/* ------------------------------------------------------------------ tetos --
   Os quatro pools somados são ~1 128 partículas, ou 118 KB de `Float32Array`.
   Os números não são redondos por acaso:

   • POEIRA 520 — a Genki Dama sozinha pede ~70, e o pior caso realista é três
     especiais simultâneos (210) com quinze lutadores rasantes (~65 de rastro) e
     um resto de sopros anteriores ainda no ar. Sobra folga, que é o ponto: o
     pool nunca pode estar cheio no instante em que o golpe GRANDE cai.
   • BRILHO 300 — fagulha é curta (meio segundo), então ela gira rápido; o teto
     só existe para o caso de quinze pessoas trocando tiro a queima-roupa.
   • DETRITO 288 — cada lasca custa uma matriz composta por quadro, e é a fatia
     mais cara do módulo: dos ~45 µs que o `update` custa com os quatro pools
     cheios (medido), a maior parte é dela. O dobro começaria a aparecer.
   • ONDA 20 — ela vive meio segundo. Vinte simultâneas são vinte impactos no
     mesmo meio segundo, que é mais do que quinze jogadores conseguem produzir. */
const POEIRA_MAX = 520;
const BRILHO_MAX = 300;
const DETRITO_MAX = 288;
const ONDA_MAX = 20;

/* --------------------------------------------------------- corte e detalhe --

   Uma partícula a 400 m tem meio pixel de tela. Ela não é discreta, ela é
   INEXISTENTE — e continua custando um quad, um `discard` e uma vaga no pool.
   A vaga é o que importa: o pool é o recurso escasso, e uma nuvem invisível no
   outro lado da arena não pode estar ocupando o lugar do impacto que aconteceu
   no colo da câmera.

   Entre 90 m e 400 m o corte é gradual, e ele tem uma segunda metade que quase
   todo mundo esquece: MENOS partículas, porém MAIORES. Cortar a contagem sem
   corrigir o tamanho encolhe a nuvem junto — e aí o mesmo Kamehameha parece
   fraco de longe e forte de perto, o que é exatamente a informação errada num
   modo em que se luta a duzentos metros. Trinta por cento das partículas com
   35 % a mais de lado cobrem quase a mesma área de tela. */
const CORTE = 400; // m
const EMISSAO2 = CORTE * CORTE;
/* O corte de quem JÁ está viva é 6 % mais largo que o de quem vai nascer. Sem
   essa folga, uma nuvem emitida a 399 m morreria no quadro seguinte por causa de
   um metro de movimento da câmera — e o efeito piscaria exatamente na faixa em
   que o jogador está longe e depende dele para saber que algo aconteceu. */
const CORTE2 = (CORTE * 1.06) * (CORTE * 1.06);
const MEIO2 = 200 * 200;
const PERTO2 = 90 * 90;

/** s — teto do passo. Aba escondida devolve `dt` de segundos, e sem isto a
 *  poeira daria um salto de trinta metros no primeiro quadro de volta. */
const DT_MAX = 0.1;

/* A fração do pool de poeira acima da qual o RASTRO é recusado.
 *
 * Rastro é tempero: ele diz que alguém está passando rápido. Impacto é
 * informação: ele diz onde o golpe caiu e de que tamanho ele foi. Quando os dois
 * disputam a última vaga, ganha a informação — sempre. Sem esta reserva, quinze
 * bots voando rasante encheriam o pool em segundos e o Kamehameha cairia num
 * chão que não levanta poeira nenhuma. */
const RESERVA_IMPACTO = 0.6;

/**
 * O raio da cratera de uma potência. **A mesma conta de `craterFor`.**
 *
 * Ela não é importada, e a razão é estreita: `craterFor` devolve
 * `{ raio, fundura }`, um objeto NOVO por chamada, e este é o caminho do
 * impacto — dezenas de vezes por segundo num tiroteio de quinze lutadores. O
 * §3 do plano cobra zero alocação por quadro em regime, e um objeto descartável
 * por tiro é a diferença entre passar e não passar nessa régua.
 *
 * O que é copiado é a FORMA da fórmula; os números continuam vindo de
 * `NAMEK.destruction`, então não há como as duas divergirem por alguém ajustar
 * uma constante. Uma mudança na forma da curva teria de ser feita nos dois
 * lugares, e é por isso que o banco de provas compara as duas funções em toda a
 * faixa de potência antes de qualquer outra medição.
 *
 * E vale lembrar o que ela é AQUI: uma régua de tamanho para poeira, pedra e
 * clarão. Nada nesta pasta escreve no campo de altura — a topografia continua
 * saindo de `NamekField.addCrater`, que chama `craterFor` de verdade.
 */
export function raioDeImpacto(power) {
  const D = NAMEK.destruction;
  const p = power < 0 ? 0 : power > 64 ? 64 : power;
  const r = D.craterBase + D.craterGain * Math.sqrt(p);
  return r > D.craterMax ? D.craterMax : r;
}

/* Escratchpads do módulo. Nenhum deles é criado depois da carga. */
const _rgb = new Float32Array(3);
const _norm = { x: 0, y: 1, z: 0 };

const entre = (a, b) => a + Math.random() * (b - a);

export class NamekFx {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../../shared/namek/field.js").NamekField} field
   */
  constructor(scene, field) {
    this.scene = scene;
    this.field = field ?? null;

    /* `entrada` (a fração da vida em que a opacidade sobe do zero) é diferente
       nos dois lotes, e é uma diferença de caráter: a poeira ACORDA — ela leva
       um décimo da vida para ficar densa, que é o tempo do material sendo
       arrancado do chão. A fagulha já nasce acesa; ela é luz, e luz não tem
       tempo de subida. */
    this.poeira = new SpritePool(scene, POEIRA_MAX, "poeira", 6, 0.1);
    this.brilho = new SpritePool(scene, BRILHO_MAX, "brilho", 7, 0.02);
    this.detrito = new ChipPool(scene, DETRITO_MAX);
    this.onda = new RingPool(scene, ONDA_MAX);

    this._camX = 0;
    this._camY = 0;
    this._camZ = 0;
    /** Enquanto a câmera não se apresentou, não há LOD e não há corte. */
    this._temCam = false;
    /** O `dt` do último quadro — o rastro precisa dele. Ver `groundTrail`. */
    this._dt = 1 / 60;

    /* Resultado do último `detalhar()`. Dois números em campos em vez de um
       objeto devolvido: `detalhar` roda uma vez por impacto e devolver
       `{ fator, tamFator }` seria o mesmo lixo por quadro que `raioDeImpacto`
       existe para evitar. */
    this._fator = 1;
    this._tamFator = 1;
  }

  /** Quantas partículas vivas — a soma dos quatro pools. Para o orçamento. */
  get count() {
    return this.poeira.live + this.brilho.live + this.detrito.live + this.onda.live;
  }

  /**
   * O LOD de um ponto. Devolve `false` quando o ponto está longe demais para
   * existir; caso contrário deixa `_fator` e `_tamFator` prontos.
   */
  detalhar(x, y, z) {
    if (!this._temCam) {
      this._fator = 1;
      this._tamFator = 1;
      return true;
    }
    const dx = x - this._camX;
    const dy = y - this._camY;
    const dz = z - this._camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > EMISSAO2) return false;
    if (d2 > MEIO2) {
      this._fator = 0.3;
      this._tamFator = 1.35;
    } else if (d2 > PERTO2) {
      this._fator = 0.62;
      this._tamFator = 1.12;
    } else {
      this._fator = 1;
      this._tamFator = 1;
    }
    return true;
  }

  /* ------------------------------------------------------------- clarão -- */

  /**
   * O clarão: dois sprites aditivos e um anel de choque no chão.
   *
   * São TRÊS peças e cada uma responde por uma coisa que as outras não fazem.
   * O núcleo é branco, minúsculo e dura dois décimos — é ele que dá o "estalo",
   * o quadro em que a tela clareia. O halo é largo, colorido e dura meio segundo
   * — é ele que diz de quem foi o golpe, porque carrega a cor do especial. E o
   * anel é o único que fica no CHÃO: ele é a leitura de escala, o círculo que
   * mostra até onde a coisa chegou. Sem o anel, um impacto grande e um pequeno
   * são o mesmo flash com tamanhos diferentes, e tamanho de flash o olho não
   * mede — distância percorrida no chão, ele mede.
   */
  clarao(x, y, z, raio, cor, forca) {
    decodeCor(cor, _rgb);
    const tf = this._tamFator;

    /* Núcleo. Sem gravidade e sem arrasto: ele não é matéria, é um instante. */
    this.brilho.spawn(
      x,
      y + raio * 0.16,
      z,
      0,
      0,
      0,
      _rgb[0],
      _rgb[1],
      _rgb[2],
      raio * 0.85 * tf,
      1.5,
      0.2 * forca,
      0,
      0,
      1,
      0.9,
      0,
      -Infinity,
    );

    /* Halo. Metade da opacidade, o triplo do tempo — o rescaldo do clarão. */
    this.brilho.spawn(
      x,
      y + raio * 0.2,
      z,
      0,
      0,
      0,
      _rgb[0] * 0.85,
      _rgb[1] * 0.85,
      _rgb[2] * 0.85,
      raio * 1.7 * tf,
      1.0,
      0.45 * forca,
      0,
      0,
      0.5 * forca,
      0.6,
      0,
      -Infinity,
    );

    /* O ANEL DEITA NA ENCOSTA. `normalAt` custa quatro `heightAt` e acontece uma
       vez por impacto — barato o bastante para não valer a pena aproximar, e a
       diferença é grande: um anel horizontal sobre uma ladeira de vinte metros
       entra pela terra de um lado e paira do outro. */
    if (this.field) this.field.normalAt(x, z, 0.8, _norm);
    else {
      _norm.x = 0;
      _norm.y = 1;
      _norm.z = 0;
    }
    this.onda.spawn(
      x,
      y + 0.25,
      z,
      _norm.x,
      _norm.y,
      _norm.z,
      _rgb[0],
      _rgb[1],
      _rgb[2],
      raio * 0.35,
      raio * 3.2,
      0.45,
      0.9 * forca,
    );

    /* Um SEGUNDO anel, só para golpe grande: mais lento, mais fraco e mais
       longo. É o que faz a Genki Dama continuar acontecendo depois que o estalo
       passou, em vez de terminar em meio segundo como uma bola de ki. */
    if (raio > 10) {
      this.onda.spawn(
        x,
        y + 0.2,
        z,
        _norm.x,
        _norm.y,
        _norm.z,
        _rgb[0],
        _rgb[1],
        _rgb[2],
        raio * 0.15,
        raio * 1.6,
        0.75,
        0.45 * forca,
      );
    }
  }

  /**
   * Fagulhas: riscos aditivos curtos.
   *
   * Elas são o que sobrou do erro do Kamehameha (ver o cabeçalho de `dust.js`):
   * lá, a fagulha em regime permanente virou cortina do mesmo jeito que a
   * poeira. O que ficou de pé foi o REGIME DE FAGULHA — um terço da conta, um
   * quinto do tamanho, quase sem crescer e com meio segundo de vida. É essa
   * proporção que está aqui, escalada pelo raio.
   */
  fagulhas(x, y, z, raio, cor, n, alcance) {
    decodeCor(cor, _rgb);
    const tam = (0.1 + raio * 0.045) * this._tamFator;
    for (let i = 0; i < n; i++) {
      /* Direção sorteada numa esfera, puxada para cima: fagulha que sai para
         baixo entra no chão no primeiro quadro e o sopro perde metade da
         contagem sem que nada apareça na tela. */
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const v = alcance * entre(0.45, 1.3);
      const brilho = entre(0.85, 1.15);
      if (
        !this.brilho.spawn(
          x,
          y + 0.2,
          z,
          Math.cos(a) * r * v,
          (u * 0.55 + 0.55) * v,
          Math.sin(a) * r * v,
          _rgb[0] * brilho,
          _rgb[1] * brilho,
          _rgb[2] * brilho,
          tam * entre(0.6, 1.4),
          0.35,
          entre(0.3, 0.55),
          -4,
          1.5,
          1,
          /* Curva 0,85: ela ESTALA e some. O oposto da poeira, de propósito. */
          0.85,
          0,
          -Infinity,
        )
      ) {
        return;
      }
    }
  }

  /* ------------------------------------------------------------ o contrato -- */

  /**
   * O impacto de um golpe no chão. `power` é a mesma potência de `craterFor`.
   *
   * A ORDEM importa: clarão, fagulha, pedra, poeira. Não pela mistura (o
   * `renderOrder` de cada pool resolve isso), mas pelo pool cheio — se a poeira
   * fosse emitida primeiro num quadro em que já há três especiais no ar, ela
   * consumiria as últimas vagas e o clarão, que é a peça que diz ONDE o golpe
   * caiu, não sairia. A informação sai primeiro; o volume sai com o que sobrar.
   */
  groundImpact(x, y, z, power, cor = 0xbfe8ff) {
    if (!this.detalhar(x, y, z)) return;
    const raio = raioDeImpacto(power);
    const f = this._fator;

    this.clarao(x, y, z, raio, cor, 1);
    this.fagulhas(
      x,
      y,
      z,
      raio,
      cor,
      Math.min(40, Math.max(4, Math.round((4 + raio * 1.6) * f))),
      10 + raio * 2.2,
    );
    pedrasDeImpacto(this.detrito, x, y, z, raio, f, this._tamFator);
    poeiraDeImpacto(this.poeira, x, y, z, raio, this.field, f, this._tamFator, 1);
  }

  /**
   * Um lutador batendo no chão vindo de cima. `speed` em m/s.
   *
   * O pedido é literal: *"se o player cair do alto e cair no chão deve deformar
   * e fazer nuvem de poeira"*. A conta da deformação é a que a sala já usa —
   * `slamPower` por metro por segundo acima de `slamSpeed` —, então o efeito
   * daqui tem exatamente o tamanho do buraco que o terreno vai ganhar. Ver §7 do
   * plano: "queda de altura usa a mesma emissão".
   *
   * ABAIXO DO LIMITE AINDA SAI POEIRA, e essa é a decisão que faz o pouso ter
   * peso. Um lutador que desce dos 30 m e para no chão sem levantar um floco
   * parece ter aterrissado num tapete. O que ele não ganha é cratera, clarão nem
   * pedra: é uma baforada nos pés, e só.
   */
  slam(x, y, z, speed) {
    if (!this.detalhar(x, y, z)) return;
    const D = NAMEK.destruction;
    const excesso = speed - D.slamSpeed;
    const f = this._fator;

    if (excesso <= 0) {
      /* O pouso leve. A "potência" é a própria velocidade normalizada — quem
         encosta a 5 m/s levanta quase nada, quem encosta a 25 levanta uma
         baforada de verdade. */
      const forca = Math.max(0, speed) / D.slamSpeed;
      if (forca < 0.12) return;
      poeiraDeQueda(this.poeira, x, y, z, 1.2 + forca * 1.8, this.field, f * forca, this._tamFator);
      return;
    }

    const raio = raioDeImpacto(D.slamPower * excesso);

    /* SEM CLARÃO COLORIDO. Um corpo não é energia — o que ele levanta é chão. O
       que fica do "clarão" é o anel de choque, pálido e fraco: a onda de ar
       existe, a explosão não. Dar a este pouso o mesmo flash de um Kamehameha
       faria toda queda parecer um especial, e o jogador deixaria de distinguir
       de longe quem levou um golpe de quem só desceu depressa. */
    if (this.field) this.field.normalAt(x, z, 0.8, _norm);
    else {
      _norm.x = 0;
      _norm.y = 1;
      _norm.z = 0;
    }
    decodeCor(0xdfe8d8, _rgb);
    this.onda.spawn(
      x,
      y + 0.22,
      z,
      _norm.x,
      _norm.y,
      _norm.z,
      _rgb[0],
      _rgb[1],
      _rgb[2],
      raio * 0.3,
      raio * 2.9,
      0.4,
      0.42,
    );

    pedrasDeQueda(this.detrito, x, y, z, raio, f, this._tamFator);
    poeiraDeQueda(this.poeira, x, y, z, raio, this.field, f, this._tamFator);
  }

  /**
   * Um objeto do cenário quebrando: vira estilhaço.
   *
   * `kind` = "rocha" | "arvore" | "casa". A poeira e o estilhaço saem os dois do
   * material do objeto — ver a regra herdada em `debris.js`. Não há clarão: nada
   * explodiu, uma coisa quebrou, e um flash aqui daria a leitura de que o objeto
   * detonou em vez de ter sido partido.
   */
  propBreak(kind, x, y, z, raio) {
    if (!this.detalhar(x, y, z)) return;
    const f = this._fator;
    /* O `y` de um prop é onde ele QUEBROU, não onde ele pisa — o meio de uma
       casa, o tronco de uma ajisa a três metros do solo. O chão de verdade sai
       do campo de altura, e é ele que diz onde o caco assenta e onde a poeira
       para de descer. Uma consulta por objeto destruído: nada. */
    const chao = this.field ? this.field.heightAt(x, z) : y;
    estilhacarProp(this.detrito, kind, x, y, z, raio, f, this._tamFator, chao);
    poeiraDeProp(this.poeira, kind, x, y, z, raio, f, this._tamFator, chao);
  }

  /**
   * Acerto em corpo: fagulha curta, sem poeira.
   *
   * SEM POEIRA, e isso é a regra do arquivo inteiro em miniatura. Uma rajada
   * básica sai a seis por segundo; se cada acerto levantasse um sopro, dois
   * segundos de tiroteio esconderiam o alvo atrás do próprio dano — e o alvo é
   * a única coisa que quem está atirando precisa ver. Fagulha é aditiva e curta:
   * ela CLAREIA por um instante e devolve a tela.
   */
  bodyHit(x, y, z, cor, forte = false) {
    if (!this.detalhar(x, y, z)) return;
    const n = Math.max(3, Math.round((forte ? 16 : 8) * this._fator));
    decodeCor(cor, _rgb);
    const tam = (forte ? 0.2 : 0.13) * this._tamFator;
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const v = (forte ? 13 : 8) * entre(0.5, 1.35);
      const brilho = entre(0.85, 1.2);
      if (
        !this.brilho.spawn(
          x,
          y,
          z,
          Math.cos(a) * r * v,
          u * v * 0.8 + 1.5,
          Math.sin(a) * r * v,
          _rgb[0] * brilho,
          _rgb[1] * brilho,
          _rgb[2] * brilho,
          tam * entre(0.6, 1.4),
          0.3,
          entre(0.18, 0.34) * (forte ? 1.4 : 1),
          -5,
          2.2,
          1,
          0.9,
          0,
          -Infinity,
        )
      ) {
        break;
      }
    }
    /* O acerto FORTE ganha um estalo, e é ele que separa "levou dano" de "levou
       o golpe". Um sprite; nem meio quinto de segundo. */
    if (forte) {
      this.brilho.spawn(
        x,
        y,
        z,
        0,
        0,
        0,
        _rgb[0],
        _rgb[1],
        _rgb[2],
        1.5 * this._tamFator,
        1.4,
        0.16,
        0,
        0,
        1,
        0.9,
        0,
        -Infinity,
      );
    }
  }

  /**
   * Rastro de poeira sob quem corre ou voa rasante. Chamado POR QUADRO.
   *
   * "Por quadro" é o detalhe perigoso do contrato: uma emissão por chamada
   * significaria 60 partículas por segundo por lutador — 900 com a sala cheia —
   * e um jogo a 144 Hz teria o dobro da poeira de um a 72. Por isso a cadência é
   * resolvida AQUI, em partículas por segundo, sorteando contra o `dt` do último
   * quadro. O rastro fica igual em qualquer máquina, que é o mínimo que se pede
   * de um efeito contínuo.
   *
   * E ele cede a vez: acima de `RESERVA_IMPACTO` do pool, o rastro simplesmente
   * não sai. Ver a constante.
   */
  groundTrail(x, y, z, intensidade) {
    if (intensidade <= 0) return;
    if (this.poeira.live > POEIRA_MAX * RESERVA_IMPACTO) return;
    if (!this.detalhar(x, y, z)) return;
    /* 6/s no talo, e o `_fator` do LOD corta isso de longe — quinze bots
       rasantes do outro lado da arena não têm por que gastar pool. */
    const taxa = 6 * intensidade * this._fator;
    if (Math.random() < taxa * this._dt) {
      poeiraDeRastro(this.poeira, x, y, z, intensidade);
    }
  }

  /* --------------------------------------------------------------- quadro -- */

  update(dt, cameraPos) {
    const passo = dt > DT_MAX ? DT_MAX : dt > 0 ? dt : 0;
    this._dt = passo > 0 ? passo : this._dt;

    if (cameraPos) {
      this._camX = cameraPos.x;
      this._camY = cameraPos.y;
      this._camZ = cameraPos.z;
      this._temCam = true;
    }
    const corte2 = this._temCam ? CORTE2 : Infinity;

    this.poeira.update(passo, this._camX, this._camY, this._camZ, corte2);
    this.brilho.update(passo, this._camX, this._camY, this._camZ, corte2);
    atualizarDetritos(
      this.detrito,
      passo,
      this.field,
      this._camX,
      this._camY,
      this._camZ,
      corte2,
    );
    this.onda.update(passo);
  }

  /** Esvazia tudo — troca de clima, renascimento, saída da sala. */
  clear() {
    this.poeira.clear();
    this.brilho.clear();
    this.detrito.clear();
    this.onda.clear();
  }

  dispose() {
    this.poeira.dispose();
    this.brilho.dispose();
    this.detrito.dispose();
    this.onda.dispose();
  }
}
