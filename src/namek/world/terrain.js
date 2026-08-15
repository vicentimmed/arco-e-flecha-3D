/* ---------------------------------------------------------------------------
   A malha do chão de Namekusei.

   A matemática — altura, cratera, inclinação, onde se pode pisar — mora em
   `shared/namek/field.js`, sem Three.js, porque a sala roda em Node e precisa
   das mesmas respostas. Aqui fica só o que é de cliente: vértice, normal e cor.
   É a mesma divisão que `entities/moonGround.js` faz com `shared/moonField.js`,
   e pelo mesmo motivo.

   E aqui NÃO HÁ COLISOR. Não é esquecimento: §4 do plano é explícito — a
   colisão deste modo é analítica contra `NamekField.heightAt()`, e um trimesh
   de Rapier neste chão seria exatamente a segunda instância de mundo de física
   que o §0 existe para impedir.

   ------------------------------------------------------------- por que POLAR

   A arena tem 1.800 m de lado. Uma grade uniforme de 2,8 m nela são 410 mil
   quadrados — 820 mil triângulos, quatro vezes e meia o teto do §3 inteiro. O
   detalhe precisa ser radial, porque a IMPORTÂNCIA é radial: a briga, as
   crateras e os olhos do jogador estão na clareira do meio; o anel de montanhas
   é silhueta a 600 m; e o mar é uma faixa no horizonte.

   O repositório já resolve isso duas vezes (`focusWarp` no vale e na Lua),
   sempre deformando uma grade CARTESIANA. Aqui a grade é POLAR, e a troca se
   paga em três lugares:

   • **A densidade é função pura do raio.** Numa grade cartesiana deformada, a
     célula depende de x e de z separadamente, e a diagonal fica mais grossa que
     os eixos — num mapa quadrado ninguém nota, num mapa CIRCULAR o adensamento
     vira uma cruz visível no chão.

   • **A borda é redonda.** A arena é um círculo de 900 m; uma grade quadrada
     gastaria 27 % dos vértices nos cantos, que aqui é mar fora de alcance.

   • **`applyCrater` fica O(vértices tocados).** Dado um ponto e um raio, os
     anéis afetados saem de uma busca binária no raio e os setores, de um
     arco-cosseno. Sem isso, cada cratera varreria os 35 mil vértices — e o §7
     do plano pede várias por segundo.

   O preço é a costura entre anéis de contagens diferentes, e ela está resolvida
   em `costurar`: a contagem de setores é sempre potência de dois e nunca muda
   mais que o dobro de um anel para o vizinho, então só existem três casos.

   ------------------------------------------------------ orientação das faces

   O README do projeto registra o bug: com os índices na ordem ingênua as faces
   nascem viradas para baixo e o chão SOME por backface culling. Numa grade
   polar o risco é maior, porque o sentido de θ inverte a regra em relação a uma
   grade cartesiana. Cada uma das cinco famílias de triângulo daqui foi
   verificada com o produto vetorial ((v1−v0)×(v2−v0)).y > 0, e o teste do §
   "verificação" mede isso na malha pronta.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { ValueNoise } from "../../utils/noise.js";
import { clamp, smoothstep } from "../../utils/math.js";
import { NAMEK } from "../../shared/namek/config.js";
import { NAMEK_SOL_DIR, NAMEK_BRUMA_SOL, NAMEK_BRUMA_BRASA } from "./sky.js";

const TAU = Math.PI * 2;

/* O PERFIL DE LOD, em pares (raio, aresta da célula).
 *
 * Entre dois pares a aresta cresce por `smoothstep`, nunca por degrau: uma
 * mudança seca de densidade aparece como um anel de sombreamento diferente no
 * chão, e o olho lê isso como um defeito de terreno, não como otimização.
 *
 * Os valores não são arbitrários — cada um responde a uma coisa que existe no
 * campo de altura:
 *
 *   2,8 m até 170 m  a clareira. É a única banda dimensionada por CRATERA e não
 *                    por relevo: o relevo ali é liso (o `field` achata contra a
 *                    cota 4), mas o que se cava nele não é. Nesta célula, a
 *                    menor cratera PERSISTENTE (potência 0,5, o corte de
 *                    `craterMinPower`) tem dois pontos de raio, o Kamehameha
 *                    cinco e a Genki Dama onze — abaixo de umas três, a cratera
 *                    deixa de ser uma bacia e vira um amassado triangular. Cada
 *                    0,2 m a menos aqui custa ~13 k triângulos, e foi assim que
 *                    este número foi escolhido: medindo.
 *   8 m até 420 m    as colinas. A oitava mais fina do FBM daqui tem ~34 m de
 *                    comprimento de onda; 8 m já a amostra quatro vezes.
 *   8 m até 790 m    AS MONTANHAS, e este é o número que mudou.
 *
 *                    Eram 14 m, dimensionados só pela crista `ridged2` (~18 m na
 *                    terceira oitava) — a régua certa enquanto a montanha era
 *                    silhueta e nada mais. Ela deixou de ser: o pedido é que um
 *                    Kamehameha arranque um pedaço dela, e `NamekField` agora
 *                    entrega esse pedaço (ver `esculpirNaco`). Um naco de 21 m de
 *                    raio numa malha de 14 m tem UM vértice e meio dentro dele —
 *                    a física perderia a montanha e a tela não mostraria nada.
 *                    Com 8 m são 2,7 pontos de raio para o Kamehameha e 5,9 para
 *                    a Genki Dama, que é o mínimo para o buraco ter forma.
 *
 *                    O preço, medido: +17,4 k triângulos. Pagos com os 0,2 m que
 *                    a clareira devolveu e com a praia, abaixo.
 *   36 m até 1.040 m a praia e o fundo raso. Eram 26 m, e os 10 m a mais valem
 *                    2,2 k triângulos que a montanha precisava mais do que este
 *                    anel: depois de 880 m o campo já é uma chapa a −22 m
 *                    debaixo d'água, e detalhe numa chapa submersa é detalhe
 *                    gasto duas vezes — a água o esconde e a distância também. */
const LOD = [
  [0, 2.8],
  [170, 2.8],
  [420, 8],
  [790, 8],
  [1040, 36],
];

/* m — onde a malha termina. NÃO é o raio da arena (900 m): o terreno precisa
   passar da barreira macia e mergulhar, senão a última fileira de triângulos
   fica na linha do mar e aparece como um recorte serrilhado contra a água. O
   que está além disto é oceano aberto, e quem o desenha é `water.js`. */
const RAIO_MALHA = 1040;

/** Teto de setores por anel. 512 a 2,8 m de passo radial dá arco de 2,1 m no
 *  fim da clareira — abaixo disto o triângulo vira lasca e só custa vértice. */
const SETORES_MAX = 512;
/** Piso de setores. O primeiro anel tem 2,8 m de raio: um octógono ali é
 *  invisível, e exigir 16 dobraria o custo de todos os anéis seguintes pela
 *  regra do "no máximo o dobro do anterior". */
const SETORES_MIN = 8;
/* Viés no arredondamento da potência de dois, em oitavas.
 *
 * A contagem ideal de setores quase nunca é potência de dois, e a escolha entre
 * a de baixo e a de cima vale um terço dos triângulos da malha. Com 0 (arredondar
 * ao mais próximo) o arco fica entre 0,71 e 1,41 célula — bonito e caro. Com 0,5
 * (arredondar para baixo sempre) fica entre 1 e 2 células, e o triângulo do fim
 * da clareira vira uma fita duas vezes mais larga que alta, justamente onde as
 * crateras aparecem. 0,25 é o meio: arco entre 0,84 e 1,68 célula, por ~18 % de
 * triângulos a mais que o `floor`. */
const VIES_SETOR = 0.25;

/* Paleta de Namekusei. O verde-azulado é a marca do planeta tanto quanto o céu
   verde — no BT3 o chão da clareira puxa para o turquesa, não para o verde de
   grama terrestre, e é esse desvio para o ciano que separa "outro planeta" de
   "um campo qualquer". */
const PALETA = {
  /* O desvio para o CIANO é o que separa "outro planeta" de "um campo".
     Os tons de campo ficam entre 158° e 168° de matiz — verde puro (120°) daria
     grama terrestre, e foi exatamente esse o erro da primeira paleta: com a
     hemisférica esverdeada por cima, o chão saía com cara de vale alpino. */
  campo: new THREE.Color("#35997c"),
  campoClaro: new THREE.Color("#4fb897"),
  campoFundo: new THREE.Color("#1c6a5b"),
  /* A MANCHA DE SOL. Mais clara e mais amarela que `campoClaro`, e ela não é um
     quarto degradê: ela entra por LIMIAR, em ilhas de borda rasgada. A referência
     tem grama clara EM MANCHAS, e mancha é uma coisa que começa e acaba — um
     degradê contínuo entre dois verdes, por mais bem feito que seja, lê como
     iluminação irregular, nunca como vegetação diferente. */
  campoSol: new THREE.Color("#7fd39f"),
  /** O oposto: a moita rasteira encharcada das depressões. */
  musgo: new THREE.Color("#13564b"),
  rocha: new THREE.Color("#7c8477"),
  rochaEscura: new THREE.Color("#4a5350"),
  /** Rocha de topo, batida de sol e de vento. Ver `corDeSuperficie`. */
  rochaClara: new THREE.Color("#9aa08d"),
  /* A TERRA que aparece entre a grama e a rocha. É a faixa que faltava: sem
     ela, campo e rocha se encontravam num `lerp` direto e a encosta ficava com
     um contorno de duas cores, que é a cara de mapa de altura pintado. */
  terra: new THREE.Color("#8a7a5c"),
  praia: new THREE.Color("#d9dfba"),
  raso: new THREE.Color("#2c6f6c"),
  /** Cor das fissuras de magma na tempestade. Ver `aMagma`. */
  magma: new THREE.Color("#ff5a1e"),
};

const _cor = new THREE.Color();
const _mistura = new THREE.Color();

export class NamekTerrain {
  /** @param {import("../../shared/namek/field.js").NamekField} field */
  constructor(field) {
    this.field = field;
    /* Ruído PRÓPRIO, com semente derivada da do mundo. Poderia ler
       `field.noise`, mas as manchas de cor cairiam exatamente em cima das
       manchas de relevo — toda depressão ficaria escura e todo topo claro, que
       é a assinatura de um terreno gerado por uma função só. */
    this.noise = new ValueNoise((NAMEK.world.seed ^ 0x9e3779b9) >>> 0);
    /** Uniform compartilhado com o shader: 0 = dia, 1 = tempestade. */
    this.uStorm = { value: 0 };
    this.mesh = null;
  }

  /* ------------------------------------------------------------- perfil ---- */

  /** Aresta da célula neste raio, interpolada entre os pares do `LOD`. */
  celulaEm(r) {
    if (r <= LOD[0][0]) return LOD[0][1];
    for (let i = 1; i < LOD.length; i++) {
      const [r0, c0] = LOD[i - 1];
      const [r1, c1] = LOD[i];
      if (r <= r1) return c0 + (c1 - c0) * smoothstep(r0, r1, r);
    }
    return LOD[LOD.length - 1][1];
  }

  /**
   * A tabela de anéis: raio, contagem de setores e deslocamento no buffer.
   *
   * A contagem de setores é a MENOR potência de dois que cabe no arco desejado
   * (`floor` no log, não `round`), e essa escolha vale 30 % dos triângulos da
   * malha: arredondar para cima produz arcos de metade da célula radial — um
   * triângulo duas vezes mais fino do que largo, que não acrescenta detalhe
   * nenhum porque quem manda no detalhe é o passo radial.
   *
   * A trava de "no máximo o dobro do anel anterior" é o que garante que
   * `costurar` só precise dos três casos que ela trata.
   */
  montarAneis() {
    const raios = [];
    const setores = [];
    let r = 0;
    let anterior = 0;
    while (r < RAIO_MALHA) {
      const c = this.celulaEm(r);
      r += c;
      let s = Math.pow(2, Math.round(Math.log2(Math.max(1, (TAU * r) / c)) - VIES_SETOR));
      s = clamp(s, SETORES_MIN, SETORES_MAX);
      if (anterior) s = clamp(s, anterior / 2, anterior * 2);
      raios.push(r);
      setores.push(s);
      anterior = s;
    }

    this.ringR = new Float32Array(raios);
    this.ringS = new Int32Array(setores);
    this.ringOff = new Int32Array(raios.length);
    /* O vértice 0 é o CENTRO da clareira — o miolo do leque. Ele existe porque
       uma grade polar sem tampa deixa um buraco redondo de 2,8 m debaixo dos
       pés de quem nasce em (0,0), e cair por ele seria o primeiro bug relatado. */
    let off = 1;
    for (let k = 0; k < raios.length; k++) {
      this.ringOff[k] = off;
      off += setores[k];
    }
    this.nVerts = off;
  }

  /* -------------------------------------------------------------- índices -- */

  /** Vértice do anel `k` no setor `s` (com volta), ou o centro quando k < 0. */
  vert(k, s) {
    if (k < 0) return 0;
    const S = this.ringS[k];
    return this.ringOff[k] + (((s % S) + S) % S);
  }

  /** Altura guardada no vértice (anel `k`, setor `s`). */
  alturaDeIndice(k, s) {
    return this.positions[this.vert(k, s) * 3 + 1];
  }

  /**
   * Altura do anel `k` no ÂNGULO θ, interpolando entre os dois vértices que o
   * cercam.
   *
   * Existe por causa da costura: anéis vizinhos podem ter o dobro ou a metade
   * dos setores, e nesse caso o "mesmo ângulo" cai no meio de uma aresta. Sem
   * interpolar, a derivada radial usaria um vizinho deslocado meio setor e a
   * normal ficaria torta justamente nas linhas de troca de LOD — que é onde
   * qualquer erro de sombreamento aparece como um anel no chão.
   */
  alturaDeAnel(k, theta) {
    if (k < 0) return this.positions[1];
    const S = this.ringS[k];
    const f = (theta / TAU) * S;
    const i0 = Math.floor(f);
    const t = f - i0;
    const a = this.alturaDeIndice(k, i0);
    const b = this.alturaDeIndice(k, i0 + 1);
    return a + (b - a) * t;
  }

  /* -------------------------------------------------------------- altura --- */

  /**
   * A altura de um vértice: relevo base guardado + as crateras que o alcançam.
   *
   * **O base fica num `Float32Array` próprio**, e é o plano que pede isso
   * (`baseHeight`, em `field.js`): sem ele, cada explosão recalcularia FBM de
   * três oitavas mais 22 gaussianas de pico por vértice tocado. Com ele, uma
   * cratera custa uma soma de `craterDelta` sobre a lista curta que o índice
   * espacial do campo devolve — tipicamente uma ou duas.
   *
   * Somar SEMPRE todas as crateras próximas (em vez de acumular o delta da
   * cratera nova) é o que torna `applyCrater` idempotente: a mensagem da sala
   * chega depois de o cliente já ter cavado localmente, e reaplicar não pode
   * aprofundar o buraco.
   */
  alturaDeVertice(v) {
    const x = this.positions[v * 3];
    const z = this.positions[v * 3 + 2];
    let h = this.base[v];
    const perto = this.field.cratersNear(x, z);
    if (perto) {
      for (let i = 0; i < perto.length; i++) {
        h += this.field.craterDelta(perto[i], x, z);
      }
    }
    return h;
  }

  /* --------------------------------------------------------------- normal -- */

  /**
   * Normal por diferença central sobre a PRÓPRIA grade, em coordenadas polares.
   *
   * Amostrar o campo analiticamente (quatro `heightAt` em torno do ponto) daria
   * uma normal mais bonita e MENTIROSA: ela descreveria um relevo que a malha
   * rala das montanhas não tem, e o resultado é o sombreamento denunciando um
   * detalhe que a silhueta desmente. Mesma decisão do vale e da Lua.
   */
  escreverNormal(k, s) {
    const v = this.vert(k, s);

    if (k < 0) {
      /* O centro não tem direção radial. Ele pega as quatro alturas cardeais do
         primeiro anel, que é o mesmo cálculo em disfarce. */
      const r0 = this.ringR[0];
      const hL = this.alturaDeAnel(0, Math.PI);
      const hR = this.alturaDeAnel(0, 0);
      const hB = this.alturaDeAnel(0, Math.PI * 1.5);
      const hF = this.alturaDeAnel(0, Math.PI * 0.5);
      this._normalizarEm(v, -(hR - hL) / (2 * r0), 1, -(hF - hB) / (2 * r0));
      return;
    }

    const S = this.ringS[k];
    const r = this.ringR[k];
    const theta = (s / S) * TAU;

    // Derivada ao longo do arco (direção tangencial).
    const arco = (TAU * r) / S;
    const dht = (this.alturaDeIndice(k, s + 1) - this.alturaDeIndice(k, s - 1)) / (2 * arco);

    // Derivada radial, entre os anéis vizinhos, no mesmo ângulo.
    const kIn = k - 1;
    const kOut = Math.min(this.ringR.length - 1, k + 1);
    const rIn = kIn < 0 ? 0 : this.ringR[kIn];
    const dr = this.ringR[kOut] - rIn;
    const dhr =
      dr > 1e-5 ? (this.alturaDeAnel(kOut, theta) - this.alturaDeAnel(kIn, theta)) / dr : 0;

    /* Do referencial (radial, tangencial, vertical) para o mundo:
         er = ( cosθ, 0,  senθ)      et = (−senθ, 0, cosθ)
         N  ∝ −∂h/∂r · er − ∂h/∂t · et + ŷ                                     */
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    this._normalizarEm(v, -dhr * cos + dht * sin, 1, -dhr * sin - dht * cos);
  }

  _normalizarEm(v, nx, ny, nz) {
    const inv = 1 / Math.hypot(nx, ny, nz);
    this.normals[v * 3] = nx * inv;
    this.normals[v * 3 + 1] = ny * inv;
    this.normals[v * 3 + 2] = nz * inv;
  }

  /* ------------------------------------------------------------------ cor -- */

  /**
   * Cor por vértice — e não textura, porque o repositório inteiro não carrega
   * um único arquivo de imagem (§3: zero texturas).
   *
   * Tudo aqui é resolvido UMA vez, na construção, e depois custa zero por
   * quadro. É onde mora metade da leitura do planeta, e é por isso que dá para
   * caprichar sem pesar. `applyCrater` não mexe em cor de propósito: o buraco é
   * lido pela normal e pela sombra própria, e repintar o anel a cada explosão
   * custaria um terceiro buffer subindo para a placa por golpe.
   */
  corDeSuperficie(x, z, h, ny, out, celula = 2.8) {
    const n = this.noise;
    const inclinacao = 1 - ny; // 0 = plano, 1 = parede
    const mancha = n.fbm2(x * 0.0042, z * 0.0042, 2);
    const grao = n.fbm2(x * 0.062, z * 0.062, 2);

    /* O MIÚDO, e ele é a resposta direta a "parece que não tem tanta textura".
     *
     * As duas escalas que existiam — 240 m e 16 m — dão as regiões e as
     * variações, e nenhuma delas é visível a dez metros de distância. O que
     * faltava era a escala do PASSO: manchas de sete metros, do tamanho de um
     * lutador em pé, que é a única faixa em que o olho ainda distingue detalhe
     * de cor no chão enquanto voa baixo.
     *
     * Ela é apagada onde a malha não a sustenta, e isso não é economia: 7 m de
     * comprimento de onda numa célula de 8 m é ruído abaixo de Nyquist, e o
     * resultado não é "menos detalhe", é CINTILAÇÃO — cada quadro em que a
     * câmera anda, o vértice pega outra fase e o chão da montanha ferve. O
     * `smoothstep` no lugar de um corte seco é pelo mesmo motivo do resto do
     * LOD: um anel onde a textura acaba lê como defeito de terreno. */
    const fino = 1 - smoothstep(3.0, 5.5, celula);
    const miudo = fino > 0.001 ? n.fbm2(x * 0.145, z * 0.145, 2) * fino : 0;

    /* O campo. Base em três escalas, e a mancha larga continua mandando. */
    out
      .copy(PALETA.campo)
      .lerp(PALETA.campoClaro, clamp(0.4 + 0.62 * mancha + 0.24 * grao + 0.16 * miudo, 0, 1))
      .lerp(PALETA.campoFundo, clamp(0.28 - 0.7 * mancha + 0.18 * grao, 0, 1) * 0.8);

    /* AS MANCHAS CLARAS, por LIMIAR e não por mistura.
     *
     * A soma das três escalas passa por um `smoothstep` estreito: onde ela
     * ultrapassa o limiar, a grama é outra. É a diferença entre uma pradaria
     * pintada com aerógrafo e uma com CLAREIRAS de vegetação diferente, e o
     * que rasga a borda dessas ilhas são justamente as escalas curtas dentro
     * do limiar — sem o grão e o miúdo somados aqui, o contorno seria uma
     * curva de nível suave e a mancha viraria uma poça. */
    const ilha = smoothstep(0.16, 0.46, mancha * 0.9 + grao * 0.5 + miudo * 0.45);
    if (ilha > 0.001) out.lerp(PALETA.campoSol, ilha * 0.62);

    /* O MUSGO das depressões. O oposto da ilha, e vem no mesmo pacote: um campo
       que só tem manchas claras parece descolorido em faixas. */
    const baixio = smoothstep(-0.18, -0.5, mancha + grao * 0.35) * smoothstep(0.72, 0.95, ny);
    if (baixio > 0.001) out.lerp(PALETA.musgo, baixio * 0.55);

    /* A ROCHA aflora pela inclinação E pela altitude. Só pela inclinação, um
       cume achatado de 120 m continuaria coberto de campo verde-azulado, o que
       lê como um morro de grama e apaga a leitura de montanha.
       O `veio` é o que faz a linha entre grama e pedra ser RASGADA: `ridged2`
       tem cristas finas e ramificadas, então ele empurra a rocha para baixo em
       línguas e a deixa recuar em bolsões. Com o `smoothstep` sozinho, a
       fronteira era uma curva de nível limpa — a assinatura de um chão pintado
       por fórmula. */
    const veio = n.ridged2(x * 0.021, z * 0.021, 2);
    const rochoso = clamp(
      Math.max(smoothstep(0.3, 0.6, inclinacao), smoothstep(52, 96, h)) +
        0.12 * grao +
        0.22 * veio +
        0.1 * miudo,
      0,
      1,
    );

    /* A TERRA vem ANTES da rocha e só na transição: é o pé da pedra, onde a
       grama já não pega e o mineral ainda não aflorou. Um pico de meia altura
       na mesma máscara — cheia embaixo, zerada em cima —, e é ela que dá os três
       degraus (grama · terra · rocha) que uma encosta de verdade tem. */
    const transicao = rochoso * (1 - rochoso) * 4;
    if (transicao > 0.001) out.lerp(PALETA.terra, transicao * 0.4);

    if (rochoso > 0.001) {
      _mistura
        .copy(PALETA.rocha)
        .lerp(PALETA.rochaEscura, smoothstep(0.42, 0.92, inclinacao) * 0.85)
        /* O topo bate sol e vento: a rocha alta esbranquiça. Sem isto, uma
           montanha de 140 m fica com a mesma pedra da saia de 50 m e a silhueta
           perde a leitura de altura. */
        .lerp(PALETA.rochaClara, smoothstep(78, 135, h) * 0.7);
      out.lerp(_mistura, rochoso);
    }

    /* A PRAIA. Faixa estreita em torno do nível do mar — larga demais e o
       planeta ganha um deserto costeiro que não é dele. */
    const mar = this.field.seaLevel;
    const praia = smoothstep(mar + 7, mar + 1.2, h) * smoothstep(0.55, 0.86, ny);
    if (praia > 0.001) out.lerp(PALETA.praia, praia * 0.9);

    // Abaixo da linha d'água o fundo escurece e satura: é o que dá profundidade
    // à água rasa, que é translúcida junto à costa.
    const fundo = smoothstep(mar, mar - 6, h);
    if (fundo > 0.001) out.lerp(PALETA.raso, fundo * 0.75);

    // Oclusão barata: face virada para baixo escurece. Não substitui sombra,
    // mas é o que impede uma encosta voltada para o lado oposto ao sol de ficar
    // com o mesmo brilho da que o encara.
    out.multiplyScalar(0.82 + 0.18 * clamp(ny, 0, 1));

    /* O GRANULADO POR VÉRTICE — a última escala, e a mais barata das cinco.
     *
     * Nenhum ruído contínuo cobre esta faixa: ela é a variação de UM vértice
     * para o vizinho, comprimento de onda de uma célula, e um `fbm2` na
     * frequência dela devolveria exatamente o que Nyquist promete devolver, que
     * é lixo. O que funciona é aceitar que aqui não há forma, só quebra:
     * um hash das coordenadas inteiras, ±3 % de brilho, sem correlação com nada.
     *
     * Três por cento parece pouco escrito e é o teto do que se pode gastar: é o
     * suficiente para o `dithering` do material não ter mais superfície chapada
     * para produzir faixas, e pouco o bastante para o chão não virar chuvisco
     * quando a câmera se afasta e os vértices caem sub-pixel. Some junto com o
     * miúdo, pelo mesmo motivo dele. */
    if (fino > 0.001) {
      let s = (Math.round(x * 4) * 374761393 + Math.round(z * 4) * 668265263) | 0;
      s = Math.imul(s ^ (s >>> 13), 1274126177);
      s = (s ^ (s >>> 16)) >>> 0;
      out.multiplyScalar(1 + (s / 0xffffffff - 0.5) * 0.06 * fino);
    }
    return out;
  }

  /**
   * Quanto de FISSURA DE MAGMA passa por este ponto (0 a 1).
   *
   * Guardado como atributo de vértice e aceso por uniform na tempestade — ver o
   * enxerto de shader em `criarMaterial`. O planeta explodindo (§1 do plano) não
   * pode ser só o céu ficando vermelho: sem nada acontecendo no CHÃO, a
   * tempestade lê como um filtro de cor por cima do mesmo cenário.
   *
   * `ridged2` porque a fissura é uma CRISTA do ruído, não uma mancha: o
   * `smoothstep` alto e estreito em cima dela deixa só o topo da crista, e o
   * topo de um ruído ridged é uma linha fina e ramificada — exatamente a forma
   * de uma rachadura.
   */
  magmaEm(x, z, h) {
    /* Frequência e limiar calibrados por MEDIÇÃO, não por gosto: nesta
       combinação, ~6 % dos vértices acendem e ~1,5 % acendem forte. Abaixo
       disso as fendas somem no mapa e a tempestade volta a ser só um filtro de
       cor; acima, o chão inteiro vira lava e o planeta deixa de ser Namekusei
       para virar Vegeta. */
    const veia = this.noise.ridged2(x * 0.0046, z * 0.0046, 3);
    const fissura = smoothstep(0.6, 0.92, veia);
    if (fissura <= 0) return 0;
    /* Some debaixo d'água (não se vê) e nos cumes (a lava sobe pela fenda, não
       escorre pela crista — e uma montanha inteira acesa vira lampião). */
    const acima = smoothstep(this.field.seaLevel + 1, this.field.seaLevel + 9, h);
    const alto = 1 - smoothstep(60, 130, h);
    return fissura * acima * alto;
  }

  /* -------------------------------------------------------------- montagem - */

  /** @param {THREE.Object3D} parent a raiz do mundo, nunca a cena direto */
  build(parent) {
    this.montarAneis();

    const N = this.nVerts;
    this.positions = new Float32Array(N * 3);
    this.normals = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.magma = new Float32Array(N);
    /** O relevo SEM cratera nenhuma. Ver `alturaDeVertice`. */
    this.base = new Float32Array(N);

    // ---- posições. O centro primeiro; ele é o vértice 0 por construção.
    this.base[0] = this.field.baseHeight(0, 0);
    this.positions[0] = 0;
    this.positions[2] = 0;
    this.positions[1] = this.alturaDeVertice(0);

    for (let k = 0; k < this.ringR.length; k++) {
      const S = this.ringS[k];
      const r = this.ringR[k];
      const off = this.ringOff[k];
      for (let s = 0; s < S; s++) {
        const ang = (s / S) * TAU;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const v = off + s;
        this.positions[v * 3] = x;
        this.positions[v * 3 + 2] = z;
        this.base[v] = this.field.baseHeight(x, z);
        /* As crateras entram JÁ na construção. É isto que atende o critério 6
           do §12: quem chega no meio da partida recebe a lista inteira no
           `welcome`, o campo a carrega antes do `build`, e a malha nasce com os
           buracos que os outros já veem — em vez de nascer lisa e só se corrigir
           na próxima explosão. */
        this.positions[v * 3 + 1] = this.alturaDeVertice(v);
      }
    }

    // ---- normais e cores (a cor depende da normal, então vêm depois).
    this.escreverNormal(-1, 0);
    this.corDeVertice(0, LOD[0][1]);
    for (let k = 0; k < this.ringR.length; k++) {
      const S = this.ringS[k];
      /* A célula do anel, resolvida UMA vez para os até 512 vértices dele. Ela
         é o que diz a `corDeSuperficie` quais escalas de cor a malha aqui
         consegue sustentar — ver o `fino` de lá. Chamar `celulaEm` por vértice
         seria varrer a tabela de LOD 41 mil vezes para obter 165 respostas. */
      const cel = this.celulaEm(this.ringR[k]);
      for (let s = 0; s < S; s++) {
        this.escreverNormal(k, s);
        this.corDeVertice(this.ringOff[k] + s, cel);
      }
    }

    const indices = this.montarIndices();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(this.normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute("aMagma", new THREE.BufferAttribute(this.magma, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    this.geometry = geo;

    this.mesh = new THREE.Mesh(geo, this.criarMaterial());
    this.mesh.name = "namek-terreno";
    /* Sem sombra, nos dois sentidos, e é decisão de orçamento — ver o cabeçalho
       de `sky.js`: um shadow map sobre 1.800 m de arena tem textura de metro
       por texel e o passe custaria mais que o próprio terreno. */
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    parent.add(this.mesh);

    this.triangulos = indices.length / 3;
    return this;
  }

  corDeVertice(v, celula) {
    const x = this.positions[v * 3];
    const h = this.positions[v * 3 + 1];
    const z = this.positions[v * 3 + 2];
    this.corDeSuperficie(x, z, h, this.normals[v * 3 + 1], _cor, celula);
    this.colors[v * 3] = _cor.r;
    this.colors[v * 3 + 1] = _cor.g;
    this.colors[v * 3 + 2] = _cor.b;
    this.magma[v] = this.magmaEm(x, z, h);
  }

  /* ------------------------------------------------------------- costura --- */

  montarIndices() {
    const aneis = this.ringR.length;
    let total = this.ringS[0]; // o leque do centro
    for (let k = 0; k < aneis - 1; k++) {
      const a = this.ringS[k];
      const b = this.ringS[k + 1];
      total += a === b ? 2 * a : 3 * Math.min(a, b);
    }

    const idx = new Uint32Array(total * 3);
    this.escrita = 0;

    /* O leque do centro. A ordem é (centro, s+1, s) e NÃO (centro, s, s+1):
       com θ crescendo no sentido de x→z, a segunda produz a face para baixo —
       o bug do README, na única família de triângulos onde a intuição erra
       porque o vértice de referência é degenerado. */
    const S0 = this.ringS[0];
    for (let s = 0; s < S0; s++) {
      this.tri(idx, 0, this.vert(0, s + 1), this.vert(0, s));
    }

    for (let k = 0; k < aneis - 1; k++) this.costurar(idx, k, k + 1);

    this.indices = idx;
    return idx;
  }

  tri(idx, a, b, c) {
    idx[this.escrita++] = a;
    idx[this.escrita++] = b;
    idx[this.escrita++] = c;
  }

  /**
   * Liga o anel interno `ka` ao externo `kb`.
   *
   * Três casos, porque `montarAneis` garante que a razão entre as contagens é
   * 1, 2 ou ½. Quando ela é 2, cada célula do anel grosso vira TRÊS triângulos
   * em vez de dois — é o leque que fecha o T-junction. Sem ele, o vértice extra
   * do anel fino fica sobre a aresta do grosso e abre uma fresta de um pixel
   * por onde se vê o céu; numa malha de 176 anéis isso é uma coroa de frestas
   * concêntricas, e é o tipo de defeito que só aparece em movimento.
   */
  costurar(idx, ka, kb) {
    const Sa = this.ringS[ka];
    const Sb = this.ringS[kb];

    if (Sa === Sb) {
      for (let i = 0; i < Sa; i++) {
        const a0 = this.vert(ka, i);
        const a1 = this.vert(ka, i + 1);
        const b0 = this.vert(kb, i);
        const b1 = this.vert(kb, i + 1);
        this.tri(idx, a0, a1, b0);
        this.tri(idx, a1, b1, b0);
      }
      return;
    }

    if (Sb === Sa * 2) {
      // Externo mais fino: o leque abre para fora.
      for (let i = 0; i < Sa; i++) {
        const a0 = this.vert(ka, i);
        const a1 = this.vert(ka, i + 1);
        const b0 = this.vert(kb, 2 * i);
        const b1 = this.vert(kb, 2 * i + 1);
        const b2 = this.vert(kb, 2 * i + 2);
        this.tri(idx, a0, b1, b0);
        this.tri(idx, a0, a1, b1);
        this.tri(idx, a1, b2, b1);
      }
      return;
    }

    // Externo mais grosso: o mesmo leque, espelhado para dentro.
    for (let j = 0; j < Sb; j++) {
      const a0 = this.vert(ka, 2 * j);
      const a1 = this.vert(ka, 2 * j + 1);
      const a2 = this.vert(ka, 2 * j + 2);
      const b0 = this.vert(kb, j);
      const b1 = this.vert(kb, j + 1);
      this.tri(idx, a0, a1, b0);
      this.tri(idx, a1, b1, b0);
      this.tri(idx, a1, a2, b1);
    }
  }

  /* ------------------------------------------------------------ material --- */

  /**
   * `MeshStandardMaterial` com dois enxertos: as fissuras de magma e o dial da
   * tempestade.
   *
   * `onBeforeCompile` em vez de um `ShaderMaterial` inteiro porque a
   * iluminação, a névoa e o tonemap do repositório já estão resolvidos no
   * material padrão — reescrevê-los para ganhar uma linha de emissivo seria
   * assinar a manutenção deles.
   *
   * O ponto de injeção é `<emissivemap_fragment>`: é o chunk que existe em
   * todas as versões recentes do Three e o único ponto em que
   * `totalEmissiveRadiance` já foi declarado e ainda não foi usado.
   */
  criarMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      /* 0,9 e não 0,96, e a diferença inteira é o sol baixo.
       *
       * Com a direcional a 55° de altura, um brilho especular no chão caía onde
       * ninguém olha (embaixo do observador) e a rugosidade quase máxima era
       * grátis. Com ela a 32°, a encosta voltada para o sol reflete de raspão, e
       * uma faixa de brilho largo correndo pelo alto das colinas é metade do que
       * faz uma paisagem de fim de tarde parecer fim de tarde.
       * Não desce mais que isso: a partir de ~0,8 o `MeshStandardMaterial` já
       * concentra o lóbulo o bastante para aparecer uma mancha viajando com a
       * câmera, e mancha viajante em terreno lê como defeito, não como luz. */
      roughness: 0.9,
      metalness: 0,
      dithering: true, // o gradiente do campo é largo; sem isto ele fica em faixas
    });

    const uStorm = this.uStorm;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.storm = uStorm;
      shader.uniforms.magmaCor = { value: PALETA.magma.clone() };
      /* A direção do sol e as duas brumas vêm de `sky.js`, que é quem os possui
         — ver `NAMEK_SOL_DIR`. Repeti-los aqui daria um terreno que doura na
         direção de um sol que já se mudou. */
      shader.uniforms.solDirMundo = { value: NAMEK_SOL_DIR.clone() };
      shader.uniforms.brumaDia = { value: NAMEK_BRUMA_SOL.clone() };
      shader.uniforms.brumaBrasa = { value: NAMEK_BRUMA_BRASA.clone() };

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           attribute float aMagma;
           varying float vMagma;
           varying vec3 vMundoChao;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vMagma = aMagma;
           /* A posição de MUNDO, para a bruma saber para onde a linha de visada
              aponta. modelMatrix e não um atalho assumindo identidade: a malha
              hoje está na origem, mas quem a reposicionar um dia não vai
              procurar o defeito num degradê de horizonte. */
           vMundoChao = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float storm;
           uniform vec3 magmaCor;
           uniform vec3 solDirMundo;
           uniform vec3 brumaDia;
           uniform vec3 brumaBrasa;
           varying float vMagma;
           varying vec3 vMundoChao;`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           /* Elevado ao quadrado: a fenda acende DEPOIS que o céu já virou.
              Linear, o chão começava a brilhar no primeiro segundo da transição
              e a leitura era "alguém ligou uma luz", não "o planeta rachou". */
           totalEmissiveRadiance += magmaCor * (vMagma * storm * storm * 1.6);`,
        )
        .replace(
          "#include <fog_fragment>",
          `#include <fog_fragment>
           #ifdef USE_FOG
           {
             /* A BRUMA ACESA — a perspectiva aérea vista CONTRA o sol.
              *
              * A FogExp2 da cena tem uma cor só, igual em todas as direções, e
              * é ela que apagava o anel de montanhas: a 700 m de distância a
              * névoa já come metade da cor, e o que sobrava era o mesmo
              * verde-acinzentado do lado do sol e do lado oposto. Um relevo sem
              * lado iluminado é um relevo sem profundidade, por mais LOD que se
              * pague nele.
              *
              * O conserto é aditivo e reaproveita o fogFactor que a inclusão
              * acima acabou de calcular (ele fica em escopo — é declarado dentro
              * do mesmo bloco #ifdef): quanto mais longe a montanha e mais a
              * linha de visada aponta para o sol, mais luz espalhada volta.
              * pow(_, 3.0) mantém isso um FEIXE em vez de um verniz dourado na
              * tela inteira, e a mesma constante está em water.js — a
              * montanha e o mar se encontram numa linha, e dois expoentes
              * diferentes apareceriam exatamente ali.
              *
              * Aditivo também é o que garante que isto nunca escureça nada: no
              * pior caso ele não faz nada, e no pior caso do pior caso (bruma
              * forte demais) o defeito é visível na hora, não é uma montanha
              * preta que ninguém liga a este trecho. */
             float aoSol = max(dot(normalize(vMundoChao - cameraPosition), normalize(solDirMundo)), 0.0);
             vec3 bruma = mix(brumaDia, brumaBrasa, storm);
             gl_FragColor.rgb += bruma * (pow(aoSol, 3.0) * fogFactor * mix(0.62, 0.20, storm));
           }
           #endif`,
        );
    };

    /* SEM ISTO O CENÁRIO INTEIRO PODE QUEBRAR, e de um jeito que não parece ter
       nada a ver com aqui.
       O Three monta a chave do cache de programas com os parâmetros do material
       (tipo, defines, mapas) e **não** com o texto que o `onBeforeCompile`
       produziu — só com o que `customProgramCacheKey` devolve. Dois
       `MeshStandardMaterial` com os mesmos parâmetros e enxertos DIFERENTES
       ganham o mesmo programa, e o segundo passa a rodar o shader do primeiro:
       aqui isso seria o terreno desenhado sem `aMagma` (ou uma vegetação
       desenhada com ele, procurando um atributo que a malha dela não tem).
       É a convenção do repositório inteiro — ver `entities/environment.js` e
       `namek/character/rig.js`, que já pagam esta linha. */
    mat.customProgramCacheKey = () => "namek-terreno-magma-bruma";

    this.material = mat;
    return mat;
  }

  /* -------------------------------------------------------------- cratera -- */

  /**
   * Re-esculpe a malha SÓ nos vértices que a cratera alcança.
   *
   * Duas passadas com raios diferentes, e a diferença entre elas é o defeito
   * que aparece se ela não existir: a normal de um vértice depende dos
   * VIZINHOS, então o primeiro anel de vértices fora do buraco também mudou de
   * inclinação. Sem a margem, a borda da cratera fica com um aro de
   * sombreamento antigo — um contorno claro em volta do buraco.
   *
   * O envio para a placa é por FAIXA (`addUpdateRange`), não pelo buffer
   * inteiro: os anéis afetados são contíguos no buffer por construção da tabela,
   * então uma cratera de 13 m a 300 m do centro sobe ~30 KB em vez de 420 KB.
   * Com várias por segundo (§7), é a diferença entre 2,5 MB/s e 180 KB/s de
   * tráfego para a GPU.
   *
   * @param {{id:number, x:number, z:number, raio:number, fundura:number}} c
   */
  applyCrater(c) {
    if (!this.mesh) return;

    let vMin = Infinity;
    let vMax = -Infinity;
    const marcar = (v) => {
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    };

    this.percorrerDisco(c.x, c.z, c.raio, (k, s) => {
      const v = this.vert(k, s);
      this.positions[v * 3 + 1] = this.alturaDeVertice(v);
      marcar(v);
    });

    /* Margem de duas células no raio das normais. Duas e não uma porque a
       derivada radial de um vértice usa os anéis k−1 e k+1: quem está uma
       célula fora do buraco ainda enxerga o fundo dele. */
    const margem = c.raio + 2 * this.celulaEm(Math.hypot(c.x, c.z));
    this.percorrerDisco(c.x, c.z, margem, (k, s) => {
      this.escreverNormal(k, s);
      marcar(this.vert(k, s));
    });

    if (vMin > vMax) return; // cratera fora da malha (mar aberto): nada a fazer

    const pos = this.geometry.attributes.position;
    const nor = this.geometry.attributes.normal;
    const inicio = vMin * 3;
    const conta = (vMax - vMin + 1) * 3;
    pos.addUpdateRange(inicio, conta);
    nor.addUpdateRange(inicio, conta);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  /**
   * Chama `fn(anel, setor)` em cada vértice dentro do disco (cx, cz, raio).
   *
   * A conta que faz isto ser barato: um anel de raio r só cruza o disco no
   * intervalo angular ±acos((r² + d² − R²) / 2rd) em torno da direção do centro
   * do disco, com d a distância do centro do mundo ao centro do disco. Os dois
   * casos degenerados — disco englobando o anel inteiro, e disco sem contato —
   * caem fora de [−1, 1] e são tratados antes.
   */
  percorrerDisco(cx, cz, raio, fn) {
    const d = Math.hypot(cx, cz);
    const aneis = this.ringR.length;
    if (d - raio > this.ringR[aneis - 1]) return;

    // Anéis cujo raio cai na faixa [d − raio, d + raio]. Busca linear a partir
    // de uma estimativa binária: a tabela é monótona.
    const kMin = this.anelPara(d - raio);
    const kMax = Math.min(aneis - 1, this.anelPara(d + raio) + 1);
    const centroTheta = Math.atan2(cz, cx);
    const R2 = raio * raio;

    // O centro da malha entra quando o disco o cobre.
    if (d <= raio) fn(-1, 0);

    for (let k = kMin; k <= kMax; k++) {
      const r = this.ringR[k];
      const S = this.ringS[k];
      let meio; // meia-abertura angular do arco atingido

      if (d < 1e-4) {
        // Disco centrado na origem: ou o anel inteiro entra, ou nenhum vértice.
        if (r > raio) continue;
        meio = Math.PI;
      } else {
        const cosMeio = (r * r + d * d - R2) / (2 * r * d);
        if (cosMeio >= 1) continue; // anel longe demais do disco
        meio = cosMeio <= -1 ? Math.PI : Math.acos(cosMeio);
      }

      if (meio >= Math.PI - 1e-6) {
        for (let s = 0; s < S; s++) fn(k, s);
        continue;
      }

      /* Uma célula de folga em cada ponta: o vértice imediatamente fora do arco
         teórico ainda faz parte de um triângulo que entrou, e deixá-lo com a
         altura velha abriria um degrau vertical na borda do buraco. */
      const s0 = Math.floor(((centroTheta - meio) / TAU) * S - 1);
      const s1 = Math.ceil(((centroTheta + meio) / TAU) * S + 1);
      for (let s = s0; s <= s1; s++) fn(k, s);
    }
  }

  /** Índice do primeiro anel com raio ≥ r (0 quando r é menor que tudo). */
  anelPara(r) {
    if (r <= this.ringR[0]) return 0;
    let lo = 0;
    let hi = this.ringR.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ringR[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /* ----------------------------------------------------------------- clima - */

  /** 0 = dia, 1 = tempestade. Só acende as fissuras; o resto é luz e céu. */
  setStorm(t) {
    this.uStorm.value = clamp(t, 0, 1);
  }

  dispose() {
    this.geometry?.dispose();
    this.material?.dispose();
    this.mesh?.parent?.remove(this.mesh);
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    /* Os Float32Array ficam para o coletor. Soltá-los aqui é o que impede uma
       partida de dez minutos com várias trocas de sala de segurar 3 MB por
       mundo morto (critério 4 do §12). */
    this.positions = null;
    this.normals = null;
    this.colors = null;
    this.base = null;
    this.magma = null;
    this.indices = null;
  }
}
