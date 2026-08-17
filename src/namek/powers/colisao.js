/* ---------------------------------------------------------------------------
   O EMBATE — o que acontece quando dois poderes se encostam no ar.

   Até este arquivo existir, NADA acontecia. Dois Kamehamehas se atravessavam
   sem se ver, uma rajada de ki entrava por dentro de uma Genki Dama e saía do
   outro lado, o Galick Gun passava por um Kienzan como se os dois fossem
   hologramas. Cada poder sabia colidir com gente e com o chão, e o único lugar
   do modo em que um poder mexia noutro era a varredura da onda de empurrão —
   que o `spawnBurst`, em `index.js`, faz de fora justamente para não esconder
   isso dentro da bola de ki.

   Este módulo é a versão geral daquela exceção, e ele mora aqui pelo mesmo
   motivo: **o embate não é assunto de nenhum dos cinco poderes.** Se o teste
   de "o feixe encostou na esfera" morasse em `beam.js`, a mesma regra
   precisaria existir também em `orb.js` (para o caso simétrico) e as duas
   metades envelheceriam separadas — que é exatamente a armadilha que
   `blast.js` documenta ao guardar as contas analíticas num lugar só. Aqui há
   UM árbitro, os cinco arquivos ganham um gancho de três linhas cada, e a
   tabela de quem ganha de quem existe uma vez.

   ============================================================================
   1. AS QUATRO REGRAS
   ============================================================================

   Estão em `NAMEK.embate`, com o argumento de cada número. Em resumo:

       PEQUENO   a rajada de ki
       GRANDE    Kamehameha, Galick Gun, Kienzan, Genki Dama

       pequeno × grande     o pequeno morre com um clarão; o grande segue
                            intacto e SEM DESVIO
       grande  × grande     os dois detonam no ponto de contato, com o estouro
                            que CADA UM faz ao bater no chão
       genki   × qualquer   o outro é consumido (detona) e ela segue inteira
       genki   × genki      as duas morrem
       carga   × carga      a explosão própria da regra 4, e os dois golpes
                            são cancelados

   "O estouro que cada um faz ao bater no chão" é a leitura literal do pedido —
   *"explodem na colisão assim como se tivesse pegado no chão"* — e ela é
   melhor do que a alternativa (um estouro genérico igual para todos) porque
   cada golpe JÁ tem o seu, calibrado: o Kamehameha abre o poço fundo
   (`craterDeep: 3,5`), a esfera abre a bacia larga, o Kienzan deixa o talho de
   `power: 3,6` e nem explode — e é essa diferença que faz o jogador saber, de
   longe e sem legenda, o que acabou de ser interceptado. Reaproveitá-la sai de
   graça: `relato.chao` e `relato.noAr` já levam o `kind`, e é o `kind` que
   escolhe a receita de som em `NamekAudio._receitaDeImpacto` e o tamanho da
   nuvem em `NamekFx.groundImpact`.

   **O embate NÃO machuca ninguém.** É a decisão menos óbvia deste arquivo e
   vale o parágrafo: um poder interceptado no meio do céu não chegou a lugar
   nenhum, e dar a ele o dano de área do impacto no ponto da interceptação
   faria abater uma Genki Dama com um Kienzan ser PIOR do que deixá-la passar —
   quem interceptasse levaria os 100 de dano dela na cara, a cem metros do
   próprio corpo. Embate é cancelamento, e cancelamento que ainda mata não
   cancela nada. O que sai daqui é estouro, som, cratera e tremor; vida, não.

   ============================================================================
   2. O DETERMINISMO — por que existe uma mensagem de rede
   ============================================================================

   Cada cliente simula os PRÓPRIOS projéteis e reconstrói os alheios a partir
   do disparo que a sala retransmitiu (§8 do plano). As duas cópias do mesmo
   Galick Gun estão a alguns metros uma da outra — o disparo chegou com atraso,
   a perseguição mira uma posição interpolada —, e "alguns metros" é
   exatamente a margem que decide se ele encostou ou não no Kamehameha que vinha
   de frente. Deixado a cada tela, um jogador veria o golpe sumir e o outro o
   veria acertar.

   Daí o `POWER_CLASH`, e daí o critério:

   • **Qualquer cliente que enxergue o choque avisa a sala.** Não "o dono do
     projétil de menor id", que era o critério óbvio e que quebra por um motivo
     concreto: metade dos golpes deste modo é de BOT, e bot não tem cliente.
     Com o desempate pelo menor id, todo embate cujo número menor coubesse a um
     bot não aconteceria em tela nenhuma — numa sala de quinze bots, quase
     todos. Qualquer-um-avisa cobre humano×humano, humano×bot e bot×bot com um
     mecanismo só.
   • **A SALA desempata**, guardando o primeiro aviso de cada par e descartando
     os repetidos que chegarem dentro de `NAMEK.embate.janelaSala`. É ela que
     transforma quinze reconstruções ligeiramente diferentes do mesmo encontro
     num acontecimento só.
   • **Quem avisou já aplicou antes de mandar.** É predição, como tudo neste
     jogo, e a volta é inócua: os projéteis já morreram e a busca por
     dono+tipo não acha mais nada. A mensagem é idempotente por construção.
   • **O DESFECHO não viaja.** A mensagem leva dono, tipo e ponto; quem morre e
     que estouro sai é recalculado por cada cliente com `resolverEmbate`, que é
     função pura da tabela do config. Mandar o resultado pronto seria a mesma
     regra existindo em dois lugares.

   **A rajada de ki é a exceção declarada: ela não sobe.** Bola pequena morrendo
   contra poder grande é resolvido localmente em cada tela, sem mensagem. É a
   mesma tolerância que `PowerSystem.spawnBurst` já assume por escrito ao varrer
   bolas alheias — uma bola na borda pode morrer numa tela e sobreviver na
   outra, e se sobreviver na de quem atirou e acertar, o acerto vale, porque é
   ele quem julga. O preço de sincronizar isso seria uma mensagem por bola
   varrida, dezenas por segundo num tiroteio, para acertar dois pontos de dano.

   ============================================================================
   3. O CUSTO
   ============================================================================

   O laço é `grandes × grandes` mais `grandes × bolas`, e "grandes" tem teto de
   17 no pior caso aritmético (6 feixes + 5 esferas + 6 discos, os mesmos tetos
   dos pools). Num tiroteio de verdade são dois ou três.

       17 × 16 / 2 = 136 pares            (realista: 1 a 3)
       17 × 256    = 4 352 testes de bola (realista: ~220)

   O teste contra um feixe é o único caro (o caminho tem até 48 segmentos), e
   ele é cercado por duas defesas: uma esfera envolvente do caminho inteiro,
   que descarta a bola distante com uma raiz quadrada, e o corte antecipado que
   `distanciaAoCaminho` já fazia para o dano.

   **Zero alocação por quadro**, como manda o §3 do plano: o registro dos
   grandes é um array de objetos criados no construtor e reescritos no lugar, a
   fila de mensagens da rede é pré-alocada e copiada campo a campo (o objeto da
   mensagem nunca é guardado), e o efeito da regra 4 é um pool de dois com as
   malhas prontas desde o começo.

   ============================================================================
   4. O RAIO DE EMBATE CRESCE COM O PASSO
   ============================================================================

   Dois Kamehamehas de frente um para o outro se aproximam a 680 m/s. Num
   quadro de 60 Hz isso são 11,3 m, e a soma dos raios de morte são 7,2: eles
   se ATRAVESSARIAM entre dois quadros, sem nunca terem estado perto num quadro
   só. É o mesmo buraco que `blast.js` fecha subdividindo o avanço, resolvido
   aqui do jeito barato — o raio de cada golpe é somado a `speed · dt`, de modo
   que a esfera de teste cobre o caminho percorrido no quadro. Custa uma
   multiplicação por projétil e dispensa subpasso.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";

/* ============================================================================
   A TABELA — pura, e usada pelos dois caminhos

   Detecção e aplicação chamam a MESMA função. É isso que garante que o cliente
   que detectou e os catorze que receberam a confirmação cheguem ao mesmo
   desfecho: a mensagem carrega os tipos, e o desfecho é função deles.
   ========================================================================== */

/** Os quatro desfechos possíveis. */
export const EMBATE = {
  /** A bola de ki morre; o poder grande segue intacto e sem desvio. */
  PEQUENO: "pequeno",
  /** Os dois detonam, cada um com o estouro que faz no chão. */
  GRANDE: "grande",
  /** A Genki Dama engole o outro: ele detona, ela segue. */
  CONSUMIDO: "consumido",
  /** As duas bolas de carga do Kamehameha. Explosão própria, golpes anulados. */
  CARGA: "carga",
};

/** `"pequeno"`, `"grande"` ou `null` para o que não embate com nada. */
export function classeDe(kind) {
  return NAMEK.embate.classe[kind] ?? null;
}

/**
 * A MATRIZ.
 *
 * @param {string} ka tipo do golpe A (`"blast"` ou chave de `NAMEK.specials`)
 * @param {boolean} cargaA A ainda é a bola de carga nas mãos
 * @param {string} kb tipo do golpe B
 * @param {boolean} cargaB
 * @returns {{modo:string, aMorre:boolean, bMorre:boolean}|null} `null` quando
 *   os dois se ignoram — e ignorar é o padrão seguro para todo par que a tabela
 *   não conhece.
 */
export function resolverEmbate(ka, cargaA, kb, cargaB) {
  const ca = classeDe(ka);
  const cb = classeDe(kb);
  if (!ca || !cb) return null;

  /* A BOLA DE CARGA SÓ EMBATE COM OUTRA BOLA DE CARGA, e essa restrição É a
     regra 1 aplicada com honestidade. Se uma rajada de ki pudesse estourar a
     esfera que se forma nas mãos, o poder pequeno estaria derrubando o poder
     grande — pela porta dos fundos, e no instante em que ele é mais caro.
     O corpo de quem carrega já responde por aquele ponto do espaço: quem quiser
     interromper um Kamehameha continua tendo o caminho de sempre, que é acertar
     a PESSOA. */
  if (cargaA !== cargaB) return null;
  if (cargaA) {
    if (ka !== "kamehameha" || kb !== "kamehameha") return null;
    return { modo: EMBATE.CARGA, aMorre: true, bMorre: true };
  }

  /* A GENKI DAMA. "Nada destrói a Genki Dama a não ser outra." Ela vem antes de
     tudo porque é a única regra que ganha das outras duas: contra um pequeno
     ela se comporta como qualquer grande (o pequeno morre), e contra um grande
     ela troca "os dois detonam" por "só o outro detona". */
  const ga = ka === "genki";
  const gb = kb === "genki";
  if (ga && gb) return { modo: EMBATE.GRANDE, aMorre: true, bMorre: true };
  if (ga) {
    if (cb === "pequeno") return { modo: EMBATE.PEQUENO, aMorre: false, bMorre: true };
    return { modo: EMBATE.CONSUMIDO, aMorre: false, bMorre: true };
  }
  if (gb) {
    if (ca === "pequeno") return { modo: EMBATE.PEQUENO, aMorre: true, bMorre: false };
    return { modo: EMBATE.CONSUMIDO, aMorre: true, bMorre: false };
  }

  const pa = ca === "pequeno";
  const pb = cb === "pequeno";
  /* DUAS BOLAS DE KI SE IGNORAM. Não é omissão: elas saem a 6/s por jogador e
     com quinze em campo há mais de cem no ar ao mesmo tempo. Fazê-las se
     anularem transformaria o tiroteio numa cortina de fagulhas em que nenhuma
     bola chega a lugar nenhum, e custaria um laço de 256×256 por quadro para
     produzir isso. */
  if (pa && pb) return null;
  if (pa) return { modo: EMBATE.PEQUENO, aMorre: true, bMorre: false };
  if (pb) return { modo: EMBATE.PEQUENO, aMorre: false, bMorre: true };
  return { modo: EMBATE.GRANDE, aMorre: true, bMorre: true };
}

/* ============================================================================
   A EXPLOSÃO DA REGRA 4 — o clarão das duas bolas de carga

   Efeito PRÓPRIO, e o pedido é explícito sobre isso: nada de reaproveitar o
   estouro comum. Três peças, e cada uma responde por uma coisa que as outras
   não fazem:

       NÚCLEO   uma bola de fogo branca que salta ao tamanho cheio e apaga. É o
                clarão — o quadro em que a tela inteira clareia.
       CASCA    a onda de choque, uma esfera de arame abrindo muito além do
                núcleo. É ela que dá a ESCALA a quem está longe: uma bola
                brilhante a 500 m é um ponto, um contorno de 300 m de diâmetro
                abrindo é um acontecimento.
       ARCOS    os raios elétricos. Catorze fitas em cruz saindo do centro,
                crepitando. São a assinatura que separa este estouro de todos os
                outros do modo — nenhum outro poder tem geometria com FORMA DE
                RAIO, e é por isso que dá para saber o que aconteceu sem ver a
                carga.

   A fita em CRUZ (dois planos perpendiculares) é a mesma solução do traço do
   Galick Gun, pelo mesmo motivo: uma fita de plano único desaparece quando a
   câmera a olha de perfil, e com catorze arcos apontando para todo lado sempre
   haveria vários de perfil. Com dois planos, todos existem de qualquer ângulo.

   Custo: 3 chamadas de desenho por explosão, 2 no pool = 6 no pior caso, e
   duas explosões dessas simultâneas exigem quatro pessoas carregando
   Kamehameha encostadas duas a duas. Fora do pool, `visible = false` — o
   renderer descarta antes de montar a lista.
   ========================================================================== */

/** Quantas explosões de carga cabem ao mesmo tempo. Ver acima. */
const CLARAO_MAX = 2;
/** Quantos arcos elétricos. Par, para os dois braços opostos ficarem simétricos
 *  sem que ninguém consiga contá-los. */
const ARCOS = 14;
/** Nós por arco. Oito segmentos dão a quebra em zigue-zague sem virar serrilha. */
const ARCO_NOS = 9;
/** Largura da fita de um arco, em frações do raio da explosão. A 78 m de raio
 *  são 94 cm — visíveis a meio quilômetro, que é o requisito. */
const ARCO_LARGURA = 0.012;

/* Rascunhos do módulo. Um de cada, criados na carga. */
const _cor = new THREE.Color();
const _corB = new THREE.Color();

const rnd = (a, b) => a + Math.random() * (b - a);

class ClaraoDeCarga {
  constructor(scene, geos) {
    this.scene = scene;
    this.viva = false;
    this.t = 0;
    this.local = false;

    this.grupo = new THREE.Group();
    this.grupo.visible = false;

    this.nucleo = new THREE.Mesh(
      geos.bola,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
        fog: false,
      }),
    );
    this.nucleo.renderOrder = 7;
    this.nucleo.frustumCulled = false;
    this.grupo.add(this.nucleo);

    this.casca = new THREE.Mesh(
      geos.casca,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.3,
        wireframe: true,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.casca.renderOrder = 6;
    this.casca.frustumCulled = false;
    this.grupo.add(this.casca);
    scene.add(this.grupo);

    /* OS ARCOS NÃO ENTRAM NO GRUPO, pela mesma razão que a fita do Galick Gun
       não entra no dela: os vértices são posições de MUNDO, e um pai que se
       move levaria a geometria junto. Aqui o grupo nem se move depois de aceso,
       mas manter a malha solta é o que permite escrever os nós direto, sem
       inversa de matriz nenhuma. */
    this.arcos = new THREE.Mesh(
      fitaDosArcos(),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
        vertexColors: true,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.arcos.renderOrder = 8;
    this.arcos.frustumCulled = false;
    this.arcos.visible = false;
    scene.add(this.arcos);

    /* A geometria de cada raio, sorteada no acendimento e mantida até apagar:
       a direção do braço, as duas perpendiculares dele e o desvio lateral de
       cada nó. Sortear por quadro daria um chiado branco em vez de um raio —
       um raio treme, ele não se reinventa sessenta vezes por segundo. */
    this.dir = new Float32Array(ARCOS * 3);
    this.eixoU = new Float32Array(ARCOS * 3);
    this.eixoV = new Float32Array(ARCOS * 3);
    this.lateral = new Float32Array(ARCOS * ARCO_NOS * 2);
    this.comp = new Float32Array(ARCOS);
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this._onda = 0;
  }

  /**
   * Acende no ponto de contato.
   *
   * @param {number} corGolpe a cor do Kamehameha — é ela que fica nos arcos, e é
   *   o que amarra a explosão ao golpe que a produziu. O núcleo é quase branco
   *   (`NAMEK.embate.carga.cor`): o que está no centro está quente demais para
   *   ter matiz.
   */
  acender(x, y, z, corGolpe, local) {
    const C = NAMEK.embate.carga;
    this.viva = true;
    this.t = 0;
    this.local = !!local;
    this.x = x;
    this.y = y;
    this.z = z;
    this._onda = 0;

    _cor.set(C.cor);
    _corB.set(corGolpe);
    this.nucleo.material.color.copy(_cor);
    this.nucleo.material.opacity = 0.95;
    /* A casca puxa para a cor do golpe: ela é a onda de choque, e a onda de
       choque é feita da energia que estava nas mãos. */
    this.casca.material.color.copy(_corB).lerp(_cor, 0.35);
    this.casca.material.opacity = 0.3;
    this.arcos.material.color.copy(_corB).lerp(_cor, 0.5);
    this.arcos.material.opacity = 0.9;

    this.grupo.position.set(x, y, z);
    this.grupo.visible = true;
    this.arcos.visible = true;

    for (let b = 0; b < ARCOS; b++) {
      const b3 = b * 3;
      /* Direção sorteada numa esfera uniforme. Sem puxão para cima nenhum: uma
         descarga elétrica não tem preferência de lado, e o puxão que a fagulha
         de impacto usa existe só para ela não entrar no chão. */
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const dx = Math.cos(a) * r;
      const dy = u;
      const dz = Math.sin(a) * r;
      this.dir[b3] = dx;
      this.dir[b3 + 1] = dy;
      this.dir[b3 + 2] = dz;

      /* As duas perpendiculares — a mesma recusa de `baseDoVoo`, em `orb.js`:
         o vertical do mundo cruzado com o eixo, com a troca de referência
         quando o braço sai exatamente na vertical e o produto devolve zero. */
      let ux = dz;
      let uy = 0;
      let uz = -dx;
      let L = Math.sqrt(ux * ux + uz * uz);
      if (L < 1e-4) {
        ux = 1;
        uy = 0;
        uz = 0;
        L = 1;
      }
      ux /= L;
      uz /= L;
      this.eixoU[b3] = ux;
      this.eixoU[b3 + 1] = uy;
      this.eixoU[b3 + 2] = uz;
      this.eixoV[b3] = dy * uz - dz * uy;
      this.eixoV[b3 + 1] = dz * ux - dx * uz;
      this.eixoV[b3 + 2] = dx * uy - dy * ux;

      /* Comprimento desigual por braço: raios iguais leriam como um ouriço de
         plástico. Entre 55 % e 100 % do alcance. */
      this.comp[b] = rnd(0.55, 1);

      for (let k = 0; k < ARCO_NOS; k++) {
        const f = k / (ARCO_NOS - 1);
        /* O desvio lateral é máximo no meio e nulo nas duas pontas: o raio sai
           do centro e chega à ponta, e o zigue-zague acontece no caminho.
           `f · (1 − f) · 4` é a parábola normalizada para valer 1 no meio. */
        const forma = f * (1 - f) * 4;
        const i2 = (b * ARCO_NOS + k) * 2;
        this.lateral[i2] = rnd(-0.22, 0.22) * forma;
        this.lateral[i2 + 1] = rnd(-0.22, 0.22) * forma;
      }
    }

    this.escrever(0);
    this.soprar(corGolpe, 0);
  }

  /** @returns {boolean} true quando acabou. */
  update(dt, relato) {
    if (!this.viva) return true;
    const C = NAMEK.embate.carga;
    this.t += dt;
    const u = this.t / C.duracao;
    if (u >= 1) {
      this.apagar();
      return true;
    }

    /* O NÚCLEO SALTA E APAGA. `1 − (1−u)²·⁶` chega a 80 % do tamanho no primeiro
       quinto do tempo: a explosão não incha, ela ACONTECE. O que dura é o
       rescaldo, e quem o carrega é a casca. */
    const abre = 1 - Math.pow(1 - u, 2.6);
    const some = (1 - u) * (1 - u);
    const R = C.raio;
    this.nucleo.scale.setScalar(Math.max(0.001, R * (0.18 + 0.42 * abre)));
    this.nucleo.material.opacity = 0.95 * Math.pow(some, 0.7);
    /* A casca abre até quase o dobro do núcleo cheio e some mais devagar — é
       ela que continua dizendo "aconteceu aqui" depois que o clarão passou. */
    this.casca.scale.setScalar(Math.max(0.001, R * (0.3 + 1.7 * abre)));
    this.casca.material.opacity = 0.3 * some;

    /* OS ARCOS CREPITAM. O piscar é rápido (37 Hz) e nunca chega a zero: uma
       descarga que apaga por inteiro entre dois quadros vira estroboscópio, e o
       olho lê defeito de renderização em vez de eletricidade. */
    const cintila = 0.55 + 0.45 * Math.sin(this.t * 37);
    this.arcos.material.opacity = 0.9 * Math.pow(some, 1.4) * cintila;
    this.escrever(abre);

    /* AS ONDAS DE PARTÍCULA. Três, escalonadas: a primeira sai no acendimento,
       as outras em 22 % e 48 % do tempo. Uma emissão só, por maior que fosse,
       teria a silhueta de um sopro; três leem como matéria continuando a ser
       cuspida para fora. */
    if (this._onda < 1 && u > 0.22) {
      this._onda = 1;
      this.soprar(this.arcos.material.color.getHex(), 1);
    } else if (this._onda < 2 && u > 0.48) {
      this._onda = 2;
      this.soprar(this.arcos.material.color.getHex(), 2);
    }

    /* A LUZ E O TREMOR SÃO DE QUEM ESTAVA CARREGANDO, e só. É a regra do §4 do
       cabeçalho de `index.js` — a tela é uma só e a luz do modo é uma só —, e
       aqui ela vale ainda mais do que de costume: a luz tem 175 m de alcance, e
       roubá-la para um clarão a oitocentos metros apagaria o Kamehameha que
       está saindo da MINHA mão para iluminar coisa nenhuma. Quem vê o embate de
       longe vê a geometria, que é o que atravessa distância. */
    if (this.local) {
      relato.luz(this.x, this.y, this.z, C.cor, C.luz * some);
      if (this.t <= dt) relato.abalo(C.tremor, C.tremorT);
    }
    return false;
  }

  /** Escreve os nós dos arcos. `abre` é a fração do alcance já atingida. */
  escrever(abre) {
    const C = NAMEK.embate.carga;
    const alcance = C.raio * C.arco * (0.25 + 0.75 * abre);
    const larg = C.raio * ARCO_LARGURA;
    const pos = this.arcos.geometry.getAttribute("position");
    const p = pos.array;
    /* O tremor do zigue-zague: dois senos incomensuráveis para o padrão não
       repetir dentro da vida do efeito. É o mesmo truque das frequências primas
       da pose de carga. */
    const t1 = Math.sin(this.t * 61);
    const t2 = Math.sin(this.t * 43.3);

    for (let b = 0; b < ARCOS; b++) {
      const b3 = b * 3;
      const dx = this.dir[b3];
      const dy = this.dir[b3 + 1];
      const dz = this.dir[b3 + 2];
      const ux = this.eixoU[b3];
      const uy = this.eixoU[b3 + 1];
      const uz = this.eixoU[b3 + 2];
      const vx = this.eixoV[b3];
      const vy = this.eixoV[b3 + 1];
      const vz = this.eixoV[b3 + 2];
      const L = alcance * this.comp[b];

      for (let k = 0; k < ARCO_NOS; k++) {
        const f = k / (ARCO_NOS - 1);
        const i2 = (b * ARCO_NOS + k) * 2;
        const au = this.lateral[i2] * L * (1 + t1 * 0.45);
        const av = this.lateral[i2 + 1] * L * (1 + t2 * 0.45);
        const d = L * f;
        const x = this.x + dx * d + ux * au + vx * av;
        const y = this.y + dy * d + uy * au + vy * av;
        const z = this.z + dz * d + uz * au + vz * av;
        // Afina até zero na ponta: o raio termina em fio, não em bisel.
        const w = larg * (1 - f * 0.92);
        const o = (b * ARCO_NOS + k) * 12;
        p[o] = x + ux * w;
        p[o + 1] = y + uy * w;
        p[o + 2] = z + uz * w;
        p[o + 3] = x - ux * w;
        p[o + 4] = y - uy * w;
        p[o + 5] = z - uz * w;
        p[o + 6] = x + vx * w;
        p[o + 7] = y + vy * w;
        p[o + 8] = z + vz * w;
        p[o + 9] = x - vx * w;
        p[o + 10] = y - vy * w;
        p[o + 11] = z - vz * w;
      }
    }
    pos.needsUpdate = true;
  }

  /** Uma onda de fagulhas. Ver o comentário da cadência, em `update`. */
  soprar(cor, onda) {
    const C = NAMEK.embate.carga;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 40,
      color: onda === 0 ? C.cor : cor,
      speed: 90 - onda * 22,
      spread: 1,
      size: C.raio * (0.05 + onda * 0.02),
      grow: 2.2,
      life: 1 + onda * 0.4,
      gravity: 0,
      drag: 0.7,
      alpha: 1,
      additive: true,
    });
  }

  apagar() {
    this.viva = false;
    this.grupo.visible = false;
    this.arcos.visible = false;
  }

  dispose() {
    this.scene.remove(this.grupo);
    this.scene.remove(this.arcos);
    this.nucleo.material.dispose();
    this.casca.material.dispose();
    /* Só a fita é PRÓPRIA de cada clarão (os vértices são posições de mundo);
       a bola e a casca vêm do pool e são soltas por ele. */
    this.arcos.geometry.dispose();
    this.arcos.material.dispose();
  }
}

/**
 * A malha dos arcos, VAZIA — posições zeradas, rampa de cor e índices prontos.
 *
 * A rampa é gravada em cinza e o material multiplica pela cor do golpe
 * (`vertexColors`), exatamente como a fita do Galick Gun: uma rampa só serve
 * qualquer cor. Ela some para a ponta com potência 1,3, um pouco mais devagar
 * que a largura — o raio termina como um fio aceso, não como um traço apagado.
 */
function fitaDosArcos() {
  const geo = new THREE.BufferGeometry();
  const nn = ARCOS * ARCO_NOS;
  const nv = nn * 4;

  const pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pos);

  const cor = new Float32Array(nv * 3);
  for (let b = 0; b < ARCOS; b++) {
    for (let k = 0; k < ARCO_NOS; k++) {
      const f = Math.pow(1 - k / (ARCO_NOS - 1), 1.3);
      const base = (b * ARCO_NOS + k) * 12;
      for (let v = 0; v < 4; v++) {
        cor[base + v * 3] = f;
        cor[base + v * 3 + 1] = f;
        cor[base + v * 3 + 2] = f;
      }
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));

  /* Os índices dos dois planos da cruz, por segmento de cada arco. Os arcos são
     independentes, então NÃO se costura o último nó de um ao primeiro do
     seguinte — seria um triângulo esticado atravessando a explosão inteira. */
  const idx = new Uint16Array(ARCOS * (ARCO_NOS - 1) * 12);
  let i = 0;
  for (let b = 0; b < ARCOS; b++) {
    for (let k = 0; k < ARCO_NOS - 1; k++) {
      const a = (b * ARCO_NOS + k) * 4;
      const c = (b * ARCO_NOS + k + 1) * 4;
      for (let plano = 0; plano < 2; plano++) {
        const a0 = a + plano * 2;
        const a1 = a0 + 1;
        const c0 = c + plano * 2;
        const c1 = c0 + 1;
        idx[i++] = a0;
        idx[i++] = a1;
        idx[i++] = c1;
        idx[i++] = a0;
        idx[i++] = c1;
        idx[i++] = c0;
      }
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/* ============================================================================
   O ÁRBITRO
   ========================================================================== */

/** Os três tipos de poder grande, para o despacho sem `instanceof`. */
const T_FEIXE = 0;
const T_ESFERA = 1;
const T_DISCO = 2;

/** Teto do registro de grandes: 6 feixes + 5 esferas + 6 discos, com folga. */
const MAX_GRANDES = 24;
/** Quantas confirmações da rede cabem entre dois quadros. Oito embates em 16 ms
 *  é mais do que a sala consegue produzir. */
const MAX_MSGS = 8;

export class ColisorDePoderes {
  constructor(scene) {
    this.scene = scene;

    /* As geometrias COMPARTILHADAS pelos dois clarões. A bola é a mesma esfera
       de sempre; a casca é o icosaedro subdividido, que em `wireframe` desenha
       a onda de choque sem custar uma malha própria. */
    this.geos = {
      bola: new THREE.SphereGeometry(1, 24, 18),
      casca: new THREE.IcosahedronGeometry(1, 3),
    };
    this.claroes = new Array(CLARAO_MAX);
    for (let i = 0; i < CLARAO_MAX; i++) {
      this.claroes[i] = new ClaraoDeCarga(scene, this.geos);
    }

    /* O REGISTRO DOS GRANDES, reescrito a cada quadro. Objetos criados uma vez:
       o §3 do plano pede zero alocação em regime, e um literal por projétil por
       quadro seria lixo no ritmo do combate. */
    this.reg = new Array(MAX_GRANDES);
    for (let i = 0; i < MAX_GRANDES; i++) this.reg[i] = this.molde();
    this.n = 0;

    /* A fila de confirmações. Os campos são COPIADOS da mensagem; o objeto que
       veio da rede nunca é guardado — ele é lixo do parser de JSON e segurá-lo
       manteria vivo o buffer inteiro do pacote. */
    this.msgs = new Array(MAX_MSGS);
    for (let i = 0; i < MAX_MSGS; i++) {
      this.msgs[i] = { a: null, ka: null, b: null, kb: null, x: 0, y: 0, z: 0, c: false };
    }
    this.nMsgs = 0;

    /* Os dois registros da APLICAÇÃO — os lados de um embate que veio da rede.
       Separados dos do quadro (`reg`) de propósito: aqueles descrevem o que
       está vivo AGORA e são reescritos por `juntar`, estes descrevem um
       projétil que a sala nomeou e vivem uma passada só. Misturá-los faria a
       aplicação sobrescrever a varredura do mesmo quadro. */
    this.ladoA = this.molde();
    this.ladoB = this.molde();
  }

  /** Um registro vazio. Ver o construtor. */
  molde() {
    return {
      ref: null,
      tipo: 0,
      owner: null,
      kind: null,
      x: 0,
      y: 0,
      z: 0,
      raio: 0,
      carga: false,
      local: false,
    };
  }

  /* ------------------------------------------------------------------- rede */

  /**
   * Um `NS2C.POWER_CLASH` chegou. Ele é ENFILEIRADO, não aplicado.
   *
   * Aplicar dentro do tratador da mensagem mataria um projétil no meio de um
   * quadro que já começou — o pool poderia estar sendo percorrido, e um feixe
   * que morre entre o `queimar` e o `bater` dele deixa metade do quadro
   * inconsistente. Enfileirado, tudo acontece no mesmo ponto do passo, que é
   * onde todo o resto deste módulo acontece.
   */
  daRede(msg) {
    if (!msg || !Array.isArray(msg.p) || this.nMsgs >= MAX_MSGS) return;
    const m = this.msgs[this.nMsgs++];
    m.a = msg.a ?? null;
    m.ka = msg.ka ?? null;
    m.b = msg.b ?? null;
    m.kb = msg.kb ?? null;
    m.x = msg.p[0] ?? 0;
    m.y = msg.p[1] ?? 0;
    m.z = msg.p[2] ?? 0;
    m.c = msg.c === 1 || msg.c === true;
  }

  /* ------------------------------------------------------------------ passo */

  /**
   * Um quadro inteiro de embate. Chamado por `PowerSystem.update` DEPOIS de os
   * cinco pools andarem — só assim as posições testadas são as deste quadro, e
   * não as do anterior.
   *
   * @param {number} dt
   * @param {import("./index.js").PowerSystem} sistema quem tem os cinco pools
   * @param {number|string} localId
   * @param {object} relato o cartório de `index.js`
   * @param {import("../../shared/namek/field.js").NamekField} field
   */
  varrer(dt, sistema, localId, relato, field) {
    this.aplicarDaRede(sistema, localId, relato, field);
    this.juntar(dt, sistema, localId);
    this.grandeContraGrande(localId, relato, field);
    this.grandeContraPequeno(sistema);
    for (let i = 0; i < CLARAO_MAX; i++) {
      const c = this.claroes[i];
      if (c.viva) c.update(dt, relato);
    }
  }

  /** Recolhe os poderes grandes vivos no registro. */
  juntar(dt, sistema, localId) {
    this.n = 0;
    const F = sistema.beams.feixes;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      /* `abatido` é o feixe que já foi interceptado. Ele continua VIVO por mais
         meio segundo — a cauda ainda está correndo atrás da cabeça, ver
         `abortarPorEmbate` —, mas o que resta dele é rescaldo: um traço se
         apagando não pode interceptar um segundo golpe, nem devorar as bolas de
         ki que passarem por dentro. */
      if (!f.viva || f.abatido) continue;
      this.anotar(f, T_FEIXE, dt, localId);
    }
    const E = sistema.orbes.esferas;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      /* Já detonando não embate: ela é uma casca abrindo, não um projétil. E
         durante a carga também não — pelo mesmo argumento da bola do
         Kamehameha, o corpo de quem carrega responde por aquele ponto. */
      if (!e.viva || e.estourando || e.t < e.info.windup) continue;
      this.anotar(e, T_ESFERA, dt, localId);
    }
    const D = sistema.disks.discos;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (!d.viva || d.t < d.info.windup) continue;
      this.anotar(d, T_DISCO, dt, localId);
    }
  }

  anotar(ref, tipo, dt, localId) {
    if (this.n >= MAX_GRANDES) return;
    const r = this.reg[this.n++];
    const S = ref.info;
    r.ref = ref;
    r.tipo = tipo;
    r.owner = ref.owner;
    r.kind = ref.kind;
    r.local = ref.owner === localId;
    r.carga = tipo === T_FEIXE && ref.carregando;
    if (r.carga) {
      /* A bola de carga está nas mãos, e as mãos não se mexem durante a pose
         (`controller.travado`). O ponto é o do disparo. */
      r.x = ref.ox;
      r.y = ref.oy;
      r.z = ref.oz;
      r.raio = S.hitRadius * NAMEK.embate.raioCarga;
      return;
    }
    if (tipo === T_FEIXE) {
      r.x = ref.hx;
      r.y = ref.hy;
      r.z = ref.hz;
    } else {
      r.x = ref.x;
      r.y = ref.y;
      r.z = ref.z;
    }
    /* O raio cresce com o passo. Ver o §4 do cabeçalho: sem isso dois feixes de
       frente se atravessariam entre dois quadros. */
    r.raio = S.hitRadius + S.speed * dt;
  }

  /**
   * A distância de um ponto a um poder grande.
   *
   * O feixe é o único que não é uma esfera: ele é uma cobra de até 620 m, e
   * medir do ponto até a CABEÇA dele diria que um Galick Gun atravessando o
   * meio do tubo não encostou em nada. Contra o caminho, segmento por segmento
   * — a mesma conta que o dano do feixe já faz, e pelo mesmo motivo.
   */
  distanciaAoPoder(reg, x, y, z, corte) {
    if (reg.tipo === T_FEIXE && !reg.carga) {
      return reg.ref.distanciaDoEmbate(x, y, z, corte);
    }
    const dx = reg.x - x;
    const dy = reg.y - y;
    const dz = reg.z - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* --------------------------------------------------------- grande × grande */

  /**
   * Este registro ainda descreve um projétil que pode embater?
   *
   * `viva` sozinho não basta, e o motivo é que os três ganchos de embate matam
   * de jeitos diferentes — de propósito, para cada golpe morrer como ele já
   * sabia morrer. O feixe continua `viva` enquanto a cauda dissipa; a esfera
   * continua `viva` enquanto a casca abre. Os dois já foram abatidos e nenhum
   * dos dois pode abater mais nada: rescaldo não intercepta.
   *
   * É também o que torna o quadro reentrante — o mesmo registro é testado
   * contra vários vizinhos no mesmo laço, e o primeiro embate tem de encerrar
   * a participação dele nos seguintes.
   */
  vivo(reg) {
    const ref = reg.ref;
    if (!ref || !ref.viva) return false;
    if (reg.tipo === T_FEIXE) return !ref.abatido;
    if (reg.tipo === T_ESFERA) return !ref.estourando;
    return true;
  }

  grandeContraGrande(localId, relato, field) {
    const folga = NAMEK.embate.folga;
    for (let i = 0; i < this.n; i++) {
      const a = this.reg[i];
      if (!this.vivo(a)) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = this.reg[j];
        if (!this.vivo(a)) break;
        if (!this.vivo(b)) continue;
        /* O MESMO DONO NÃO EMBATE CONSIGO MESMO. Não é cortesia: quem solta um
           Kamehameha depois de uma rajada atira na MESMA direção, e sem esta
           linha o feixe passaria a vida engolindo as próprias bolas — e, pior,
           um Galick Gun disparado logo atrás de um Kienzan anularia os dois de
           quem os pagou. */
        if (a.owner === b.owner) continue;

        const r = resolverEmbate(a.kind, a.carga, b.kind, b.carga);
        if (!r) continue;

        const alcance = (a.raio + b.raio) * folga;
        const d = Math.min(
          this.distanciaAoPoder(a, b.x, b.y, b.z, alcance),
          this.distanciaAoPoder(b, a.x, a.y, a.z, alcance),
        );
        if (d > alcance) continue;

        /* O PONTO DE CONTATO. Quando um dos dois é feixe, o ponto do OUTRO é a
           melhor aproximação que existe sem projetar no caminho — o tubo passa
           por ele, não o contrário. Com dois feixes (ou nenhum), o meio. */
        let cx;
        let cy;
        let cz;
        const fa = a.tipo === T_FEIXE && !a.carga;
        const fb = b.tipo === T_FEIXE && !b.carga;
        if (fa && !fb) {
          cx = b.x;
          cy = b.y;
          cz = b.z;
        } else if (fb && !fa) {
          cx = a.x;
          cy = a.y;
          cz = a.z;
        } else {
          cx = (a.x + b.x) * 0.5;
          cy = (a.y + b.y) * 0.5;
          cz = (a.z + b.z) * 0.5;
        }

        this.executar(r, a, b, cx, cy, cz, localId, relato, field, true);
      }
    }
  }

  /* -------------------------------------------------------- grande × pequeno */

  /**
   * O poder grande varrendo as bolas de ki ALHEIAS que encostam nele.
   *
   * Resolvido em cada tela, sem rede — ver o §2 do cabeçalho. O grande não é
   * tocado: nem morre, nem desvia, nem perde velocidade. "Um Galick Gun não
   * pode ser explodido por um poder rápido" é o pedido inteiro, e desviá-lo um
   * grau seria a mesma coisa dita mais baixo.
   */
  grandeContraPequeno(sistema) {
    const bolas = sistema.blasts;
    if (bolas.live === 0) return;
    const rb = NAMEK.blast.hitRadius;
    const folga = NAMEK.embate.folga;
    for (let i = 0; i < this.n; i++) {
      const a = this.reg[i];
      /* A bola de carga é transparente para a rajada — ver `resolverEmbate`,
         que é onde a regra está escrita e argumentada. */
      if (a.carga || !this.vivo(a)) continue;
      if (classeDe(a.kind) !== "grande") continue;
      bolas.varrerEmbate(a, (a.raio + rb) * folga, this);
    }
  }

  /* ------------------------------------------------------------- a execução */

  /**
   * Mata quem tem de morrer, desenha o estouro de cada um e enfileira o aviso.
   *
   * @param {boolean} avisar true quando este cliente DETECTOU o embate (e
   *   portanto tem de contar à sala); false quando ele está apenas aplicando a
   *   confirmação que veio de lá.
   */
  executar(r, a, b, cx, cy, cz, localId, relato, field, avisar) {
    if (r.modo === EMBATE.CARGA) {
      const meu = !!((a && a.local) || (b && b.local));
      /* O clarão SÓ acende se pelo menos um dos dois ainda existia nesta tela.
         O caso em que nenhum existe é normal e frequente — é a confirmação
         voltando para quem a mandou —, e desenhar a explosão de novo ali seria
         dois clarões no mesmo ponto com meio RTT de diferença. */
      const matouA = a ? a.ref.abortarPorEmbate(relato) : false;
      const matouB = b ? b.ref.abortarPorEmbate(relato) : false;
      if (!matouA && !matouB) return;
      this.acenderClarao(cx, cy, cz, (a ?? b).ref.info.cor, meu);
      this.anunciar(relato, r, a, b, cx, cy, cz, avisar, meu);
      return;
    }

    /* `|` e não `||`: os dois lados têm de ser tentados, e o curto-circuito do
       `||` faria a esfera escapar sempre que o feixe já estivesse morto. */
    let houve = false;
    if (r.aMorre && a) houve = this.detonar(a, cx, cy, cz, localId, relato, field) || houve;
    if (r.bMorre && b) houve = this.detonar(b, cx, cy, cz, localId, relato, field) || houve;
    /* Nada morreu = nada aconteceu. É o caso normal da confirmação voltando
       para quem a mandou, e anunciá-lo faria o embate ricochetear pela sala. */
    if (houve) this.anunciar(relato, r, a, b, cx, cy, cz, avisar, false);
  }

  /**
   * Um poder grande morrendo no ponto de contato — "como se tivesse pegado no
   * chão", e o que isso quer dizer está no §1 do cabeçalho.
   *
   * Três coisas acontecem, e as três importam:
   *
   * • **O projétil morre** pelo gancho dele. Cada arquivo sabe morrer do jeito
   *   dele: o feixe entra em dissipação (a energia parou de sair da mão, e a
   *   cauda corre atrás), a esfera abre a casca, o disco simplesmente some.
   * • **O ESTOURO sai daqui**, com a cor e a escala do golpe, porque ele
   *   acontece no AR e o caminho normal do estouro (o `groundImpact` do `fx`)
   *   depende de haver chão embaixo.
   * • **O canal de relatório** escolhe entre `chao` e `noAr`, e a escolha tem
   *   uma sutileza de rede. `chao` abre cratera E manda um `GROUND_HIT` para a
   *   sala; se todo cliente enfileirasse um, a sala carimbaria quinze crateras
   *   no mesmo ponto e o buraco sairia quinze vezes mais fundo. Por isso a
   *   cratera é só de quem é DONO do golpe — a mesma regra que os cinco pools
   *   já seguem. Quem não é dono ganha o buraco pelo `NS2C.CRATER` de volta, e
   *   é ele que também toca o som ali; enfileirar `noAr` nesse caso tocaria o
   *   estouro duas vezes na mesma tela.
   */
  detonar(reg, cx, cy, cz, localId, relato, field) {
    const S = reg.ref.info;
    const E = NAMEK.embate;
    /* A MORTE VEM PRIMEIRO, e o retorno dela é a guarda de idempotência de tudo
       o que vem depois: um projétil que já tinha sido abatido (pela confirmação
       da sala que chegou no mesmo quadro, ou por um vizinho no laço acima) não
       estoura duas vezes, não abre duas crateras e não toca dois sons. */
    if (!reg.ref.abortarPorEmbate(relato)) return false;

    const solo = field ? field.heightAt(cx, cz) : -1e9;
    const acima = cy - solo;
    const margem = S.hitRadius * E.craterAr;
    const perto = acima <= margem;
    const meu = reg.owner === localId;

    if (perto && meu) {
      const e = relato.chao();
      e.owner = reg.owner;
      e.p.x = cx;
      e.p.y = solo;
      e.p.z = cz;
      /* A potência cai com a altura, como na esfera: encostado no solo é o
         buraco inteiro, na borda da margem é um arranhão. Nunca abaixo de um
         terço — um Kamehameha interceptado a vinte metros do chão continua
         sendo um Kamehameha. */
      const proximo = Math.max(0, Math.min(1, 1 - Math.max(0, acima) / margem));
      e.power = S.power * (0.34 + 0.66 * proximo);
      e.fundo = S.craterDeep ?? 1;
      e.kind = reg.kind;
    } else if (!perto) {
      const e = relato.noAr();
      e.owner = reg.owner;
      e.kind = reg.kind;
      e.p.x = cx;
      e.p.y = cy;
      e.p.z = cz;
      e.power = S.power;
    }

    /* O CLARÃO NO AR. Duas emissões: o miolo quente (rápido, pequeno, quase
       branco) e a coroa colorida (lenta, grande, na cor do golpe). Uma só daria
       ou um pontinho ou uma mancha — são as duas escalas juntas que leem como
       explosão. O tamanho sai do `hitRadius`, então o Kienzan estoura discreto
       e a Genki Dama enche a tela, sem nenhuma tabela a mais. */
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: cx, y: cy, z: cz },
      count: 26,
      color: 0xffffff,
      speed: 46,
      spread: 1,
      size: S.hitRadius * 0.14,
      grow: 2.2,
      life: 0.42,
      gravity: 0,
      drag: 1.6,
      alpha: 1,
      additive: true,
    });
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: cx, y: cy, z: cz },
      count: 34,
      color: S.cor,
      speed: 34,
      spread: 1,
      size: S.hitRadius * 0.26,
      grow: 2.8,
      life: 0.9,
      gravity: 0,
      drag: 1,
      alpha: 1,
      additive: true,
    });

    /* O TREMOR é de quem soltou, como a luz e pelo mesmo motivo. A escala é a
       do golpe: um Kienzan interceptado dá um estalo, uma Genki Dama sacode. */
    if (meu) relato.abalo(Math.min(1, 0.25 + S.power * 0.02), 0.35);
    return true;
  }

  /** Empresta um clarão do pool — o mais adiantado, se os dois estiverem acesos. */
  acenderClarao(x, y, z, cor, local) {
    let escolhido = null;
    let maior = -1;
    for (let i = 0; i < CLARAO_MAX; i++) {
      const c = this.claroes[i];
      if (!c.viva) {
        escolhido = c;
        break;
      }
      if (c.t > maior) {
        maior = c.t;
        escolhido = c;
      }
    }
    escolhido.acender(x, y, z, cor, local);
  }

  /**
   * O registro para o mundo de fora: o aviso à sala e o cancelamento da pose.
   *
   * `cancelar` só é ligado no modo carga, e ele existe porque a pose do
   * especial é um relógio do `game.js` (`this.casting`), não do feixe: sem o
   * aviso, o lutador ficaria parado no ar terminando a animação de um
   * Kamehameha que já não existe.
   */
  anunciar(relato, r, a, b, cx, cy, cz, avisar, cancelar) {
    if (!avisar && !cancelar) return;
    const e = relato.embate();
    e.enviar = avisar;
    e.modo = r.modo;
    e.carga = r.modo === EMBATE.CARGA;
    e.cancelar = !!cancelar;
    e.aOwner = a ? a.owner : null;
    e.aKind = a ? a.kind : null;
    e.bOwner = b ? b.owner : null;
    e.bKind = b ? b.kind : null;
    e.p.x = cx;
    e.p.y = cy;
    e.p.z = cz;
  }

  /* ------------------------------------------------------ a volta da confirmação */

  /**
   * Aplica os embates confirmados pela sala.
   *
   * O casamento é por DONO + TIPO + PROXIMIDADE, porque a mensagem não carrega
   * id (não existe um: o `NC2S.SPECIAL` nunca teve). Ver o comentário de
   * `NS2C.POWER_CLASH` no protocolo, que tem o argumento inteiro — e a
   * consequência prática: **não achar nada é o caso NORMAL**, não um erro. Ou
   * já matei aquele projétil (fui eu quem avisou), ou ele nunca existiu nesta
   * tela. Nos dois casos, não há o que fazer, e é essa tolerância que torna a
   * mensagem idempotente.
   */
  aplicarDaRede(sistema, localId, relato, field) {
    if (this.nMsgs === 0) return;
    const busca = NAMEK.embate.busca;
    for (let i = 0; i < this.nMsgs; i++) {
      const m = this.msgs[i];
      const r = resolverEmbate(m.ka, m.c, m.kb, m.c);
      if (!r) continue;
      /* A rajada de ki não sobe pela rede, e portanto não desce: um `POWER_CLASH`
         com `blast` num dos lados é lixo (ou um cliente adulterado), e a recusa
         é a mesma linha que a valida. */
      if (r.modo === EMBATE.PEQUENO) continue;
      const a = this.procurar(this.ladoA, sistema, m.a, m.ka, m.c, m.x, m.y, m.z, busca);
      const b = this.procurar(this.ladoB, sistema, m.b, m.kb, m.c, m.x, m.y, m.z, busca);
      if (!a && !b) continue;
      this.executar(r, a, b, m.x, m.y, m.z, localId, relato, field, false);
    }
    this.nMsgs = 0;
  }

  /**
   * O projétil daquele dono, daquele tipo, mais perto do ponto.
   *
   * Devolve um registro EMPRESTADO do fim do array (fora dos `n` do quadro):
   * ele vive só até o fim desta aplicação e não custa alocação nenhuma. Os dois
   * lados de um embate precisam de um cada, e por isso o empréstimo anda.
   */
  procurar(alvo, sistema, owner, kind, carga, x, y, z, busca) {
    if (owner === null || owner === undefined || !kind) return null;
    alvo.ref = null;
    let menor = busca;

    const F = sistema.beams.feixes;
    for (let i = 0; i < F.length; i++) {
      menor = this.medir(alvo, F[i], T_FEIXE, owner, kind, carga, x, y, z, menor);
    }
    const E = sistema.orbes.esferas;
    for (let i = 0; i < E.length; i++) {
      if (E[i].estourando) continue;
      menor = this.medir(alvo, E[i], T_ESFERA, owner, kind, carga, x, y, z, menor);
    }
    const D = sistema.disks.discos;
    for (let i = 0; i < D.length; i++) {
      menor = this.medir(alvo, D[i], T_DISCO, owner, kind, carga, x, y, z, menor);
    }
    return alvo.ref ? alvo : null;
  }

  /**
   * Um candidato do `procurar`: mede, e escreve no registro se for o melhor até
   * agora. Devolve a nova distância mínima.
   *
   * Existe como método e não como fecho dentro do laço porque um fecho ali seria
   * uma função nova por mensagem recebida — pouco, mas gratuito, e este é o
   * arquivo em que o §3 do plano é levado a sério.
   */
  medir(alvo, ref, tipo, owner, kind, carga, x, y, z, menor) {
    if (!ref.viva || ref.owner !== owner || ref.kind !== kind) return menor;
    const ehCarga = tipo === T_FEIXE && ref.carregando;
    if (ehCarga !== !!carga) return menor;
    const px = ehCarga ? ref.ox : tipo === T_FEIXE ? ref.hx : ref.x;
    const py = ehCarga ? ref.oy : tipo === T_FEIXE ? ref.hy : ref.y;
    const pz = ehCarga ? ref.oz : tipo === T_FEIXE ? ref.hz : ref.z;
    let d;
    if (tipo === T_FEIXE && !ehCarga) {
      d = ref.distanciaDoEmbate(x, y, z, menor);
    } else {
      const dx = px - x;
      const dy = py - y;
      const dz = pz - z;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    if (d >= menor) return menor;
    alvo.ref = ref;
    alvo.tipo = tipo;
    alvo.owner = ref.owner;
    alvo.kind = ref.kind;
    alvo.local = ref.local === true;
    alvo.carga = ehCarga;
    alvo.x = px;
    alvo.y = py;
    alvo.z = pz;
    alvo.raio = ref.info.hitRadius;
    return d;
  }

  /* ------------------------------------------------------------------ resto */

  clear() {
    for (let i = 0; i < CLARAO_MAX; i++) this.claroes[i].apagar();
    this.n = 0;
    this.nMsgs = 0;
  }

  dispose() {
    for (let i = 0; i < CLARAO_MAX; i++) this.claroes[i].dispose();
    this.geos.bola.dispose();
    this.geos.casca.dispose();
  }
}
