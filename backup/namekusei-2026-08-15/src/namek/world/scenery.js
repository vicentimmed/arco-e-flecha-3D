/* ---------------------------------------------------------------------------
   O que está de pé em Namekusei: rocha, ajisa e a vila namekuseijin.

   TUDO É `InstancedMesh`, uma chamada de desenho por espécie — é obrigação do
   §3 do plano e já é o padrão do repositório (`entities/environment.js`,
   `systems/spaceLife.js`). Somando rocha, tronco, copa, casa e detrito, o
   cenário inteiro sai em onze chamadas.

   ------------------------------------------------------------- o sorteio

   Nada aqui é aleatório de verdade: `makeRandom` com semente fixa, e as
   posições saem sempre na mesma ordem. Não é capricho — é o mesmo motivo do
   vale e da Lua: os índices de `props` viajam na rede (`NC2S.PROP_HIT` manda
   `{ kind, i }`), e um sorteio que dependesse da ordem de chegada de qualquer
   coisa faria a rocha 47 de uma tela ser a rocha 12 de outra. O jogador
   derrubaria uma pedra e outra cairia na tela do adversário.

   ------------------------------------------------------ o que NÃO está aqui

   **Ilhas flutuantes.** O diagrama do §2 do plano as menciona e elas são muito
   do visual do BT3, mas a colisão deste modo é analítica contra o campo de
   altura e SÓ contra ele (§4). Uma ilha no ar seria a única coisa do cenário
   que um lutador atravessa — e atravessar uma ilha a 96 m/s de arranque não lê
   como "não implementado", lê como bug. Elas voltam no dia em que houver um
   segundo volume de colisão; até lá, o céu é céu.

   ------------------------------------------------------------- o assentamento

   Toda peça é enterrada um pouco e apoiada no PONTO MAIS BAIXO da própria
   pegada, não no centro. Numa encosta, a altura de um ponto só põe metade do
   objeto no ar, com uma fresta de céu por baixo — é o defeito que
   `entities/environment.js` documenta para os matacões do vale, e ele reaparece
   igual aqui. Some com isso ainda o fato de a malha do terreno INTERPOLAR entre
   vértices: com célula de até 14 m nas montanhas, a superfície desenhada corre
   alguns centímetros abaixo do campo analítico, e enterrar resolve os dois
   problemas de uma vez.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom, clamp } from "../../utils/math.js";
import { NAMEK } from "../../shared/namek/config.js";
import {
  criarEstilhacos,
  passoEstilhaco,
  opacidadeEstilhaco,
} from "../../shared/fragments.js";

const TAU = Math.PI * 2;

/* Vida de cada espécie. A rocha aguenta mais que a árvore, e a casa mais que as
   duas — uma rajada básica dá 6 de dano, então a ajisa cai com cinco tiros, a
   rocha com dez e a casa só com um especial ou uma insistência que o jogador
   vai sentir como decisão. */
const VIDA = { rocha: 58, arvore: 30, casa: 96 };

/* Quantas peças de cada coisa. Os números saem do orçamento de triângulos do
   §3 e estão medidos no teste de verificação: com estas contagens o cenário
   inteiro (terreno, mar, céu e peças) fica abaixo do teto de 180 k. */
const QUANTIDADE = {
  rochas: 230,
  bosques: 30,
  arvoresPorBosque: [6, 13],
  vilas: 3,
  casasPorVila: [9, 14],
};

/** Configuração dos estilhaços, no formato que `shared/fragments.js` espera. */
const DETRITO = {
  fragCount: 8,
  fragSpeedMin: 5,
  fragSpeedMax: 17,
  fragRaioMin: 0.32,
  fragRaioMax: 1.05,
  fragRestitution: 0.26,
  fragKillSpeed: 3.2,
  fragSettleTime: 1.5,
  fragFadeTime: 1.7,
};
/** Capacidade do pool. Oito por objeto derrubado ⇒ oito quedas simultâneas. */
const DETRITO_POOL = 64;

const PALETA = {
  rocha: [
    new THREE.Color("#7b8477"),
    new THREE.Color("#6a7368"),
    new THREE.Color("#8a8f7c"),
    new THREE.Color("#5d6a63"),
  ],
  tronco: new THREE.Color("#c2d0b6"),
  copa: [
    new THREE.Color("#2f9a72"),
    new THREE.Color("#3fae7d"),
    new THREE.Color("#268a68"),
    new THREE.Color("#49b98a"),
  ],
  casa: new THREE.Color("#f1efe2"),
  casaSombra: new THREE.Color("#b9bda9"),
  janela: new THREE.Color("#1b4a55"),
  porta: new THREE.Color("#26403f"),
};

const _obj = new THREE.Object3D();
const _cor = new THREE.Color();

/* ------------------------------------------------------- utilidades de malha */

/**
 * Gradiente vertical em cor de vértice — o mesmo truque do `shadeCanopy` do
 * vale, e pelo mesmo motivo: sem ele uma primitiva é uma bolha de UMA cor, e a
 * três metros de distância ela não tem volume nenhum.
 *
 * A cor é um multiplicador CINZA; a tinta vem do `setColorAt` da instância, e
 * as duas se multiplicam no shader. É o que permite quatro tons de rocha com um
 * gradiente só.
 */
function sombrearPorAltura(geo, baixo, alto, curva = 0.7) {
  const pos = geo.attributes.position;
  const cores = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const inv = 1 / Math.max(1e-4, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) * inv;
    const f = baixo + (alto - baixo) * Math.pow(t, curva);
    cores[i * 3] = f;
    cores[i * 3 + 1] = f;
    cores[i * 3 + 2] = f;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
  return geo;
}

/** Pinta a geometria inteira de uma cor fixa (para as partes das casas). */
function pintar(geo, cor, escurecerBase = 0) {
  const pos = geo.attributes.position;
  const cores = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const inv = 1 / Math.max(1e-4, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) * inv;
    _cor.copy(cor).lerp(PALETA.casaSombra, escurecerBase * (1 - t));
    cores[i * 3] = _cor.r;
    cores[i * 3 + 1] = _cor.g;
    cores[i * 3 + 2] = _cor.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
  return geo;
}

/* --------------------------------------------------------------- geometrias */

/**
 * Uma rocha: icosaedro amassado.
 *
 * O amassado é função da DIREÇÃO do vértice, não do índice, e isso importa:
 * `IcosahedronGeometry` não é indexada, então cada face traz cópias dos próprios
 * vértices. Deformar por índice abriria as faces umas das outras e a pedra
 * viraria um monte de triângulos soltos.
 *
 * Sem `computeVertexNormals` suavizando nada: a normal por face é o que dá a
 * leitura de pedra lascada, e uma rocha suave parece uma batata.
 */
function geoRocha(rnd) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  // Três eixos de amassamento sorteados: um só daria pedras todas parecidas.
  const fx = 0.6 + rnd() * 1.4;
  const fy = 0.6 + rnd() * 1.4;
  const fz = 0.6 + rnd() * 1.4;
  const fase = rnd() * TAU;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d =
      1 +
      0.22 * Math.sin(x * fx * 3.1 + fase) +
      0.18 * Math.sin(y * fy * 2.7 + fase * 1.7) +
      0.2 * Math.sin(z * fz * 3.4 - fase);
    pos.setXYZ(i, x * d, y * d * 0.82, z * d);
  }
  geo.computeVertexNormals();
  // Achata a base: pedra assentada tem lado plano no chão, não é uma bola.
  geo.translate(0, 0.1, 0);
  return sombrearPorAltura(geo, 0.55, 1.15);
}

/**
 * O tronco da ajisa: fino, alto e CURVO.
 *
 * A curva é a assinatura da árvore de Namekusei. Um tronco reto com um disco em
 * cima é um cogumelo; o que faz a silhueta ser reconhecível é a haste inclinando
 * de leve e a copa saindo torta em relação à base.
 *
 * Construído à mão em vez de com um `TubeGeometry` sobre uma curva porque o que
 * se quer são seis lados e seis anéis — 72 triângulos. Um tubo com resolução
 * padrão traz oito vezes isso para descrever a mesma vara.
 */
function geoTronco(altura, raioBase, raioTopo, curva, lados = 6, segs = 6) {
  const nVerts = (segs + 1) * lados;
  const pos = new Float32Array(nVerts * 3);
  const idx = new Uint32Array(segs * lados * 6);

  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    // Deslocamento quadrático: a base fica plantada e o topo é que viaja.
    const cx = curva * t * t;
    const y = altura * t;
    const r = raioBase + (raioTopo - raioBase) * t;
    for (let i = 0; i < lados; i++) {
      const a = (i / lados) * TAU;
      const v = (j * lados + i) * 3;
      pos[v] = cx + Math.cos(a) * r;
      pos[v + 1] = y;
      pos[v + 2] = Math.sin(a) * r;
    }
  }

  let w = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < lados; i++) {
      const i2 = (i + 1) % lados;
      const a0 = j * lados + i;
      const a1 = j * lados + i2;
      const b0 = (j + 1) * lados + i;
      const b1 = (j + 1) * lados + i2;
      idx[w++] = a0; idx[w++] = b0; idx[w++] = a1;
      idx[w++] = a1; idx[w++] = b0; idx[w++] = b1;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return sombrearPorAltura(geo, 0.62, 1.1);
}

/**
 * A copa da ajisa: dois guarda-sóis empilhados e algumas lâminas passando da
 * borda.
 *
 * Dois e não um porque uma pala só, vista de baixo, é um polígono chapado; com
 * a segunda um pouco menor e mais alta aparece a sombra de uma sobre a outra e a
 * copa ganha espessura por dois triângulos por lado.
 *
 * As lâminas que passam da borda existem só para a SILHUETA: contra o céu
 * verde, um disco perfeito lê como um objeto de engenharia. As pontas irregulares
 * são o que o olho aceita como folha.
 */
function geoCopa(raio, altura, desvioX, lados = 12, laminas = 6) {
  const partes = [];

  for (let camada = 0; camada < 2; camada++) {
    const r = raio * (camada === 0 ? 1 : 0.66);
    const y = altura + camada * raio * 0.16;
    const queda = raio * (camada === 0 ? 0.2 : 0.13);

    const pos = new Float32Array((lados + 1) * 3);
    const idx = new Uint32Array(lados * 3);
    pos[0] = 0;
    pos[1] = y + queda * 0.55; // o miolo é mais alto: a pala é abaulada
    pos[2] = 0;
    for (let i = 0; i < lados; i++) {
      const a = (i / lados) * TAU;
      // Raio irregular: uma borda perfeitamente circular denuncia a primitiva.
      const rr = r * (0.86 + 0.14 * Math.abs(Math.sin(a * 2.3 + camada)));
      const v = (i + 1) * 3;
      pos[v] = Math.cos(a) * rr;
      pos[v + 1] = y - queda;
      pos[v + 2] = Math.sin(a) * rr;
    }
    for (let i = 0; i < lados; i++) {
      idx[i * 3] = 0;
      idx[i * 3 + 1] = 1 + ((i + 1) % lados);
      idx[i * 3 + 2] = 1 + i;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    partes.push(g);
  }

  // Lâminas: quadriláteros estreitos indo além da borda e caindo.
  const lp = new Float32Array(laminas * 4 * 3);
  const li = new Uint32Array(laminas * 6);
  for (let i = 0; i < laminas; i++) {
    const a = (i / laminas) * TAU + 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const la = a + 0.14;
    const b = i * 4 * 3;
    const r0 = raio * 0.72;
    const r1 = raio * 1.38;
    lp[b] = ca * r0; lp[b + 1] = altura; lp[b + 2] = sa * r0;
    lp[b + 3] = Math.cos(la) * r0; lp[b + 4] = altura; lp[b + 5] = Math.sin(la) * r0;
    lp[b + 6] = Math.cos(la) * r1; lp[b + 7] = altura - raio * 0.34; lp[b + 8] = Math.sin(la) * r1;
    lp[b + 9] = ca * r1; lp[b + 10] = altura - raio * 0.34; lp[b + 11] = sa * r1;
    const o = i * 4;
    const k = i * 6;
    li[k] = o; li[k + 1] = o + 1; li[k + 2] = o + 2;
    li[k + 3] = o; li[k + 4] = o + 2; li[k + 5] = o + 3;
  }
  const gl = new THREE.BufferGeometry();
  gl.setAttribute("position", new THREE.BufferAttribute(lp, 3));
  gl.setIndex(new THREE.BufferAttribute(li, 1));
  gl.computeVertexNormals();
  partes.push(gl);

  const copa = mergeGeometries(partes);
  for (const p of partes) p.dispose();
  /* A copa vai para o TOPO DO TRONCO, que não está sobre o eixo: o tronco curva
     e termina deslocado de `curva` em x. Sem este empurrão a folhagem fica
     pairando ao lado da árvore — e a curva do tronco, que é a assinatura da
     ajisa, seria justamente o que denunciaria o erro. */
  copa.translate(desvioX, 0, 0);
  return sombrearPorAltura(copa, 0.72, 1.2, 1.4);
}

/**
 * Uma casa namekuseijin: o domo em cebola, branco, com janela redonda.
 *
 * O perfil vem de `LatheGeometry` porque a casa é uma revolução — bojo largo
 * embaixo, pescoço e uma pontinha em cima. Desenhar isso com esferas empilhadas
 * (que foi a primeira tentativa óbvia) custa o triplo dos triângulos e nunca
 * fecha o pescoço direito.
 *
 * Janela e porta ficam no MESMO buffer, por `mergeGeometries`: seriam duas
 * chamadas de desenho a mais por variante, e principalmente duas listas de
 * matrizes a manter sincronizadas com a das casas. Uma casa é um objeto só.
 */
function geoCasa(escala, lados = 14) {
  const perfil = [
    [3.15, 0.0],
    [3.52, 0.85],
    [3.58, 1.95],
    [3.3, 3.05],
    [2.62, 4.1],
    [1.72, 4.95],
    [0.92, 5.5],
    [0.5, 5.9],
    [0.3, 6.3],
    [0.0, 6.5],
  ].map(([x, y]) => new THREE.Vector2(x * escala, y * escala));

  const corpo = pintar(new THREE.LatheGeometry(perfil, lados), PALETA.casa, 0.55);

  /* A JANELA é o traço que identifica a casa. Redonda, grande e alta — no BT3
     ela ocupa quase um terço da altura do domo, e encolhê-la para uma escotilha
     "realista" tira o desenho animado do desenho animado.

     O `z` de cada peça é medido para ficar entre 20 e 30 cm À FRENTE da casca
     no ponto mais apertado. Discos planos colados na superfície de revolução de
     um domo de 14 lados encostam nas facetas na borda de baixo, e o sintoma é o
     serrilhado de z-fighting piscando na janela conforme a câmera anda — o
     defeito mais visível que uma casa branca pode ter. Alguns centímetros de
     relevo somem no desenho e resolvem por construção. */
  const janela = new THREE.CircleGeometry(1.0 * escala, 12);
  janela.translate(0, 2.6 * escala, 3.72 * escala);
  pintar(janela, PALETA.janela, 0);

  const janelinha = new THREE.CircleGeometry(0.52 * escala, 10);
  janelinha.translate(0, 4.35 * escala, 2.78 * escala);
  pintar(janelinha, PALETA.janela, 0);

  // Porta: retângulo com o topo em arco.
  const vao = new THREE.PlaneGeometry(1.5 * escala, 1.5 * escala);
  vao.translate(0, 0.75 * escala, 3.78 * escala);
  pintar(vao, PALETA.porta, 0);
  const arco = new THREE.CircleGeometry(0.75 * escala, 10);
  arco.translate(0, 1.5 * escala, 3.78 * escala);
  pintar(arco, PALETA.porta, 0);

  const partes = [corpo, janela, janelinha, vao, arco];
  const casa = mergeGeometries(partes);
  for (const p of partes) p.dispose();
  return casa;
}

/* ----------------------------------------------------------------- balanço */

/**
 * Enxerta o balanço das copas no material.
 *
 * A copa inteira INCLINA como um bloco (a amplitude cresce com a altura local),
 * então o mesmo trecho serve para o tronco e para a folhagem — e é por isso que
 * as duas geometrias são construídas no mesmo referencial, com y = 0 no chão.
 * Se cada uma tivesse a própria origem, a copa descolaria do tronco no primeiro
 * sopro, que é exatamente o que aconteceu na primeira montagem.
 *
 * A fase sai da POSIÇÃO DA INSTÂNCIA: sem ela o bosque inteiro balança em
 * uníssono, e um bosque em uníssono lê como um erro de animação, não como vento.
 */
function aplicarBalanco(material, uniforms, alturaRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tempo = uniforms.tempo;
    shader.uniforms.vento = uniforms.vento;
    shader.uniforms.alturaRef = { value: alturaRef };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float tempo;
         uniform float vento;
         uniform float alturaRef;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           vec3 iPos = instanceMatrix[3].xyz;
           float fase = iPos.x * 0.21 + iPos.z * 0.17 + tempo * 1.35;
           float alto = clamp(transformed.y / alturaRef, 0.0, 1.0);
           float bal = (sin(fase) + 0.35 * sin(fase * 2.7 + 1.1)) * vento * alto * alto;
           transformed.x += bal;
           transformed.z += bal * 0.62;
         }`,
      );
  };
}

/* ------------------------------------------------------------------ cenário */

export class NamekScenery {
  /** @param {import("../../shared/namek/field.js").NamekField} field */
  constructor(field) {
    this.field = field;
    this.rnd = makeRandom(NAMEK.world.seed ^ 0x5ce4a11e);
    /** Uniforms do balanço, compartilhados por tronco e copa. */
    this.uniforms = { tempo: { value: 0 }, vento: { value: 0.09 } };
    this.relogio = 0;
    this.storm = 0;

    /* A função de altura que `passoEstilhaco` recebe, criada UMA vez. Uma
       arrow function montada dentro do `update` seria uma alocação por quadro
       — pequena, mas o §3 pede zero, e "pequena o bastante" é como um orçamento
       de alocação sempre começa a vazar. */
    this._chao = (x, z) => this.field.heightAt(x, z);

    /** @type {Array<object>} a lista que outros sistemas leem. Ver `props`. */
    this._props = [];
    /** Por tipo, para `breakProp(kind, i)` achar em O(1). */
    this._porTipo = { rocha: [], arvore: [], casa: [] };
    this.malhas = [];
  }

  /* ------------------------------------------------------------- montagem -- */

  build(parent) {
    this.root = new THREE.Group();
    this.root.name = "namek-cenario";
    parent.add(this.root);

    /* ORDEM IMPORTA: as vilas primeiro, porque árvore e rocha precisam saber
       onde NÃO nascer. Uma ajisa no meio da praça e um matacão dentro de uma
       casa são os dois defeitos que aparecem quando o sorteio de vegetação roda
       antes de a vila existir. */
    const vilas = this.escolherVilas();
    this.montarCasas(vilas);
    this.montarArvores(vilas);
    this.montarRochas(vilas);
    this.montarDetritos();

    return this;
  }

  /**
   * Onde as vilas cabem.
   *
   * Varredura determinística em espiral, e não sorteio com repetição: o campo
   * exige `isFlatGround` num raio de 20 m, e num relevo com colinas isso recusa
   * a maior parte dos pontos. Um sorteio puro precisaria de centenas de
   * tentativas e daria posições diferentes ao menor ajuste do gerador de ruído;
   * a espiral acha os mesmos lugares sempre e termina em passos contados.
   */
  escolherVilas() {
    const achadas = [];
    const passos = 900;
    for (let i = 0; i < passos && achadas.length < QUANTIDADE.vilas; i++) {
      /* Ângulo áureo entre amostras consecutivas, raio crescendo com √t.
         O ângulo áureo é o único passo angular que nunca fecha um ciclo — com
         qualquer fração racional de volta, as amostras se alinham em raios e a
         varredura passa a percorrer os mesmos poucos azimutes. Como as três
         vilas são as três PRIMEIRAS aprovações, esse alinhamento as jogaria
         todas para o mesmo lado do mapa. */
      const t = i / passos;
      const ang = i * 2.399963;
      const d = 250 + Math.sqrt(t) * 380;
      const x = Math.cos(ang) * d;
      const z = Math.sin(ang) * d;
      if (!this.field.isFlatGround(x, z, 20, 0.955)) continue;
      let longe = true;
      for (const v of achadas) {
        if (Math.hypot(v.x - x, v.z - z) < 260) longe = false;
      }
      if (!longe) continue;
      achadas.push({ x, z });
    }
    return achadas;
  }

  montarCasas(vilas) {
    const rnd = this.rnd;
    /* Duas variantes de tamanho. Casas todas iguais em três vilas fazem
       trinta e seis cópias do mesmo objeto no mesmo quadro, e o olho pega a
       repetição bem mais rápido do que pegaria trinta e seis formas distintas. */
    const geos = [geoCasa(1.0), geoCasa(0.72)];
    const baldes = [[], []];
    // Lista única das casas já postas, para o teste de distância mínima. Um
    // `concat` dos dois baldes dentro do laço alocaria um array por tentativa.
    const postas = [];

    for (const vila of vilas) {
      const quantas =
        QUANTIDADE.casasPorVila[0] +
        Math.floor(rnd() * (QUANTIDADE.casasPorVila[1] - QUANTIDADE.casasPorVila[0] + 1));
      for (let c = 0; c < quantas; c++) {
        let posto = null;
        for (let tentativa = 0; tentativa < 26 && !posto; tentativa++) {
          /* Anel, não disco: as casas cercam uma praça. A raiz no sorteio do
             raio é o de sempre — sem ela tudo se acumula no miolo, e aqui o
             miolo é justamente o vazio que faz a vila parecer uma vila. */
          const a = rnd() * TAU;
          const r = 14 + Math.sqrt(rnd()) * 44;
          const x = vila.x + Math.cos(a) * r;
          const z = vila.z + Math.sin(a) * r;
          if (!this.field.isFlatGround(x, z, 7, 0.945)) continue;
          if (this.perto(postas, x, z, 13)) continue;
          posto = { x, z };
        }
        if (!posto) continue;

        const variante = rnd() < 0.55 ? 0 : 1;
        const escala = 0.85 + rnd() * 0.3;
        // A frente (o +z da geometria, onde estão porta e janela) olha para a
        // praça: é o que transforma um aglomerado de domos numa vila.
        const yaw = Math.atan2(vila.x - posto.x, vila.z - posto.z);
        /* `raio` é sempre a medida da peça com escala de instância 1 — a escala
           entra uma vez só, em `criarEspecie`. A variante pequena já tem o 0,72
           assado na geometria, e é por isso que ele aparece aqui e não lá. */
        const raio = 3.6 * (variante ? 0.72 : 1);
        baldes[variante].push({ ...posto, escala, yaw, raio });
        postas.push(posto);
      }
    }

    this.criarEspecie("casa", geos, baldes, {
      material: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
      }),
      // Casa não afunda muito: o bojo é largo e enterrá-lo comeria a porta.
      enterrar: (p) => p.raio * p.escala * 0.06,
      pegada: (p) => p.raio * p.escala * 0.9,
      escalaDe: (p) => p.escala,
      // O centro do domo fica a meia altura; o bojo tem 6,5 m para 3,6 de raio.
      centro: (p) => p.raio * p.escala * 0.9,
      acerto: (p) => p.raio * p.escala * 1.25,
      vida: VIDA.casa,
    });
  }

  montarArvores(vilas) {
    const rnd = this.rnd;
    const troncos = [geoTronco(11.5, 0.34, 0.17, 1.5), geoTronco(6.8, 0.28, 0.15, 0.9)];
    const copas = [geoCopa(3.4, 11.5, 1.5), geoCopa(2.3, 6.8, 0.9)];
    const baldes = [[], []];

    for (let b = 0; b < QUANTIDADE.bosques; b++) {
      // Centro do bosque: qualquer chão pisável fora das vilas.
      let centro = null;
      for (let t = 0; t < 24 && !centro; t++) {
        const a = rnd() * TAU;
        const d = 70 + Math.sqrt(rnd()) * 690;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (!this.field.isWalkable(x, z)) continue;
        if (this.field.slopeAt(x, z) < 0.86) continue;
        if (this.perto(vilas, x, z, 85)) continue;
        centro = { x, z };
      }
      if (!centro) continue;

      const quantas =
        QUANTIDADE.arvoresPorBosque[0] +
        Math.floor(
          rnd() * (QUANTIDADE.arvoresPorBosque[1] - QUANTIDADE.arvoresPorBosque[0] + 1),
        );
      for (let i = 0; i < quantas; i++) {
        let posto = null;
        for (let t = 0; t < 12 && !posto; t++) {
          const a = rnd() * TAU;
          const r = Math.sqrt(rnd()) * 34;
          const x = centro.x + Math.cos(a) * r;
          const z = centro.z + Math.sin(a) * r;
          if (!this.field.isWalkable(x, z)) continue;
          if (this.field.slopeAt(x, z) < 0.84) continue;
          posto = { x, z };
        }
        if (!posto) continue;
        const variante = rnd() < 0.6 ? 0 : 1;
        baldes[variante].push({
          ...posto,
          escala: 0.78 + rnd() * 0.5,
          yaw: rnd() * TAU,
          tinta: Math.floor(rnd() * PALETA.copa.length),
          // Meia-altura da variante: 11,5 m a alta, 6,8 m a baixa.
          raio: variante ? 3.4 : 5.75,
        });
      }
    }

    const matTronco = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    });
    const matCopa = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0,
      /* Dos dois lados: a copa é uma casca de um triângulo de espessura e ela é
         vista POR BAIXO na maior parte do tempo — este é um jogo de voo, e voar
         por baixo de um bosque é rotina. Com face única, o bosque some quando
         se passa por baixo dele. */
      side: THREE.DoubleSide,
    });
    // As duas variantes de tronco têm alturas diferentes; o balanço usa a mais
    // alta como referência para as duas, e a baixa simplesmente balança menos.
    aplicarBalanco(matTronco, this.uniforms, 11.5);
    aplicarBalanco(matCopa, this.uniforms, 11.5);

    this.criarEspecie("arvore", troncos, baldes, {
      material: matTronco,
      enterrar: () => 0.25,
      pegada: (p) => 0.5 * p.escala,
      escalaDe: (p) => p.escala,
      /* A ESFERA DE ACERTO cobre a árvore INTEIRA, e é gorda de propósito: a
         copa é o que se vê e o que se mira, mas o tronco é o que sustenta o
         objeto. Uma esfera pequena na base faria a copa de 3,4 m ficar imune a
         qualquer tiro que não raspasse o chão. */
      centro: (p) => p.raio * p.escala,
      acerto: (p) => p.raio * p.escala * 1.15,
      vida: VIDA.arvore,
      // O tronco não recebe tinta de instância: ele é o mesmo pau em todas.
      tintas: null,
      /* A COPA ANDA JUNTO: mesma lista, mesmas matrizes, mesma ordem. Isso não é
         economia — é a única forma de garantir que derrubar a árvore 12 tire do
         quadro o tronco 12 E a copa 12. Duas listas independentes seriam duas
         chances de dessincronizar. */
      companheira: { geos: copas, material: matCopa, tintas: PALETA.copa },
    });
  }

  montarRochas(vilas) {
    const rnd = this.rnd;
    const geos = [geoRocha(rnd), geoRocha(rnd), geoRocha(rnd), geoRocha(rnd)];
    const baldes = [[], [], [], []];

    for (let i = 0; i < QUANTIDADE.rochas; i++) {
      let posto = null;
      for (let t = 0; t < 14 && !posto; t++) {
        const a = rnd() * TAU;
        /* Expoente abaixo de 1 no sorteio do raio: as pedras se acumulam PARA
           FORA, no sopé das montanhas, que é onde elas existiriam. Uma
           distribuição uniforme em área entulharia a clareira, que é justamente
           o lugar que precisa ficar aberto para a briga aérea. */
        const d = 90 + Math.pow(rnd(), 0.62) * 690;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (!this.field.isInsideWorld(x, z)) continue;
        /* Folga de 3,5 m acima da linha d'água, e não meio metro: o matacão é
           assentado pelo ponto MAIS BAIXO da pegada e ainda enterra um terço do
           raio, então o pé de uma pedra grande fica metros abaixo da altura do
           centro dela. Com folga curta, uma em cada duzentas afundava até o topo
           na arrebentação. */
        if (this.field.heightAt(x, z) <= this.field.seaLevel + 3.5) continue;
        // Aceita encosta: matacão em ladeira é o que dá relevo ao sopé. Só não
        // aceita parede, onde ele ficaria colado como um adesivo.
        if (this.field.slopeAt(x, z) < 0.58) continue;
        if (this.perto(vilas, x, z, 40)) continue;
        posto = { x, z };
      }
      if (!posto) continue;
      const variante = Math.floor(rnd() * geos.length);
      baldes[variante].push({
        ...posto,
        escala: 1.1 + Math.pow(rnd(), 1.8) * 5.4,
        yaw: rnd() * TAU,
        tombo: (rnd() - 0.5) * 0.5,
        tinta: Math.floor(rnd() * PALETA.rocha.length),
        raio: 1,
      });
    }

    this.criarEspecie("rocha", geos, baldes, {
      material: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0,
      }),
      // Um terço do raio enterrado: pedra assentada tem parte no chão.
      enterrar: (p) => p.raio * p.escala * 0.34,
      pegada: (p) => p.raio * p.escala * 0.85,
      escalaDe: (p) => p.escala,
      centro: (p) => p.raio * p.escala * 0.5,
      acerto: (p) => p.raio * p.escala * 1.25,
      vida: VIDA.rocha,
      tintas: PALETA.rocha,
    });
  }

  perto(lista, x, z, dist) {
    for (const v of lista) {
      if (Math.hypot(v.x - x, v.z - z) < dist) return true;
    }
    return false;
  }

  /**
   * Constrói as `InstancedMesh` de uma espécie e registra as peças em `props`.
   *
   * Uma malha por VARIANTE de geometria; o índice `i` que viaja na rede é
   * global à espécie, e o par (malha, vaga) fica guardado na própria peça. É a
   * indireção que permite quatro formas de rocha continuarem sendo "as rochas"
   * para quem manda `{ kind: "rocha", i: 47 }`.
   */
  criarEspecie(kind, geos, baldes, opts) {
    const lista = this._porTipo[kind];

    for (let g = 0; g < geos.length; g++) {
      const itens = baldes[g];
      if (!itens.length) continue;

      const mesh = new THREE.InstancedMesh(geos[g], opts.material, itens.length);
      mesh.name = `namek-${kind}-${g}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      /* As matrizes são escritas uma vez na construção e depois só quando algo
         cai ou é reassentado — `DynamicDrawUsage` diria à placa para esperar
         uma reescrita por quadro que nunca vem. */
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      this.root.add(mesh);
      this.malhas.push(mesh);

      let comp = null;
      if (opts.companheira) {
        comp = new THREE.InstancedMesh(
          opts.companheira.geos[g],
          opts.companheira.material,
          itens.length,
        );
        comp.name = `namek-${kind}-copa-${g}`;
        comp.castShadow = false;
        comp.receiveShadow = false;
        comp.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        this.root.add(comp);
        this.malhas.push(comp);
      }

      for (let s = 0; s < itens.length; s++) {
        const p = itens[s];
        const escala = opts.escalaDe(p);
        const pegada = opts.pegada(p);
        const enterro = opts.enterrar(p);
        const centro = opts.centro(p);
        const base = this.assentar(p.x, p.z, pegada) - enterro;

        _obj.position.set(p.x, base, p.z);
        _obj.rotation.set(p.tombo ?? 0, p.yaw ?? 0, (p.tombo ?? 0) * 0.7);
        _obj.scale.setScalar(escala);
        _obj.updateMatrix();
        mesh.setMatrixAt(s, _obj.matrix);
        if (comp) comp.setMatrixAt(s, _obj.matrix);

        if (opts.tintas) mesh.setColorAt(s, opts.tintas[p.tinta % opts.tintas.length]);
        if (comp && opts.companheira.tintas) {
          comp.setColorAt(s, opts.companheira.tintas[p.tinta % opts.companheira.tintas.length]);
        }

        const prop = {
          kind,
          i: lista.length,
          x: p.x,
          /* `y` é o CENTRO DA ESFERA DE ACERTO, não o pé da peça. Quem lê esta
             lista está fazendo teste de esfera contra bola de ki ou contra
             feixe (§4 do plano), e para isso o par (y, raio) tem de descrever a
             peça inteira. O pé fica em `_base`, que é assunto interno. */
          y: base + centro,
          z: p.z,
          /* Raio generoso de propósito, pelo mesmo motivo que
             `NAMEK.blast.hitRadius` é maior que o raio visual da bola: acertar
             uma coisa PARADA tem de ser fácil, e errar por vinte centímetros de
             silhueta é frustração pura. */
          raio: opts.acerto(p),
          vida: opts.vida,
          _mesh: mesh,
          _comp: comp,
          _vaga: s,
          _base: base,
          _centro: centro,
          _escala: escala,
          _yaw: p.yaw ?? 0,
          _tombo: p.tombo ?? 0,
          _enterrar: enterro,
          _pegada: pegada,
        };
        lista.push(prop);
        this._props.push(prop);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (comp) {
        comp.instanceMatrix.needsUpdate = true;
        if (comp.instanceColor) comp.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * O ponto mais baixo da pegada. Ver a nota do cabeçalho sobre assentamento —
   * quatro amostras na borda mais o centro bastam porque a maior peça deste
   * cenário (uma casa grande) tem 3,2 m de raio e a célula do terreno na
   * clareira tem 2,6 m: entre as cinco amostras não cabe uma ondulação inteira
   * da malha que elas não vejam.
   */
  assentar(x, z, raio) {
    let base = this.field.heightAt(x, z);
    base = Math.min(base, this.field.heightAt(x + raio, z));
    base = Math.min(base, this.field.heightAt(x - raio, z));
    base = Math.min(base, this.field.heightAt(x, z + raio));
    base = Math.min(base, this.field.heightAt(x, z - raio));
    return base;
  }

  /* -------------------------------------------------------------- detritos - */

  montarDetritos() {
    /* Um octaedro achatado: oito triângulos e uma silhueta angulosa. Nada de
       cubo — pedaço de rocha quebrada não tem ângulo reto, e um cubo girando é
       a coisa mais fácil de reconhecer como "primitiva de motor". */
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(1, 0.7, 1.15);
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.detritos = new THREE.InstancedMesh(geo, mat, DETRITO_POOL);
    this.detritos.name = "namek-detritos";
    this.detritos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.detritos.frustumCulled = false;
    this.detritos.count = DETRITO_POOL;
    this.root.add(this.detritos);
    this.malhas.push(this.detritos);

    /* Todas as vagas nascem com escala zero. `count = 0` desligaria o desenho
       inteiro, mas obrigaria a compactar o pool a cada morte para manter as
       vivas no começo do buffer — e compactar é justamente o tipo de trabalho
       por quadro que o §3 proíbe. Escala zero é descartada no clipping sem
       chegar ao fragmento. */
    _obj.position.set(0, -9999, 0);
    _obj.rotation.set(0, 0, 0);
    _obj.scale.setScalar(0);
    _obj.updateMatrix();
    for (let i = 0; i < DETRITO_POOL; i++) {
      this.detritos.setMatrixAt(i, _obj.matrix);
      this.detritos.setColorAt(i, PALETA.rocha[0]);
    }
    this.detritos.instanceMatrix.needsUpdate = true;

    /** Vagas do pool: cada uma é um estilhaço de `shared/fragments.js`. */
    this.pedacos = new Array(DETRITO_POOL).fill(null);
    this.proximoPedaco = 0;
  }

  soltarDetritos(prop) {
    const tinta =
      prop.kind === "casa"
        ? PALETA.casa
        : prop.kind === "arvore"
          ? PALETA.copa[0]
          : PALETA.rocha[1];
    /* Semente derivada de QUEM caiu, não de um contador: assim as lascas da
       rocha 47 voam para os mesmos lados em todas as telas, e a queda que dois
       jogadores viram é a mesma queda. Custa zero de rede. */
    const semente = (prop.kind.charCodeAt(0) * 7919 + prop.i * 104729) >>> 0;
    const origem = { x: prop.x, y: prop.y, z: prop.z };
    const lista = criarEstilhacos(origem, semente, DETRITO);

    for (const f of lista) {
      // Escala pela peça: uma casa espalha lascas maiores que uma ajisa.
      f.raio *= clamp(prop.raio * 0.5, 0.5, 2.4);
      const vaga = this.proximoPedaco;
      this.proximoPedaco = (this.proximoPedaco + 1) % DETRITO_POOL;
      this.pedacos[vaga] = f;
      this.detritos.setColorAt(vaga, tinta);
    }
    if (this.detritos.instanceColor) this.detritos.instanceColor.needsUpdate = true;
  }

  /* ------------------------------------------------------------- interface - */

  /**
   * A lista dos quebráveis. **Leia-a, não a recrie a cada quadro** — ela é
   * construída uma vez e os objetos dentro dela são os mesmos para sempre.
   *
   * As peças derrubadas CONTINUAM na lista, com `vida` em zero. Tirá-las
   * renumeraria as seguintes, e o índice `i` é o que a rede usa para dizer qual
   * caiu (`NC2S.PROP_HIT`): um índice que muda de dono no meio da partida é a
   * receita para o jogador derrubar uma pedra e outra sumir na tela do vizinho.
   */
  get props() {
    return this._props;
  }

  /**
   * Derruba uma peça. Idempotente: a sala retransmite (`NS2C.PROP_DOWN`) o que
   * o cliente que acertou já aplicou localmente para não esperar a rede, e a
   * segunda passagem não pode soltar uma segunda leva de detritos.
   */
  breakProp(kind, index) {
    const lista = this._porTipo[kind];
    if (!lista) return false;
    const p = lista[index];
    if (!p || p.vida <= 0) return false;

    p.vida = 0;
    /* Escala zero em vez de remover a instância: `InstancedMesh` não tem
       remoção, e compactar o buffer mudaria as vagas de todas as peças
       seguintes — ou seja, mudaria a correspondência entre `i` e o que se vê. */
    _obj.position.set(p.x, p._base, p.z);
    _obj.rotation.set(0, 0, 0);
    _obj.scale.setScalar(0);
    _obj.updateMatrix();
    p._mesh.setMatrixAt(p._vaga, _obj.matrix);
    p._mesh.instanceMatrix.needsUpdate = true;
    if (p._comp) {
      p._comp.setMatrixAt(p._vaga, _obj.matrix);
      p._comp.instanceMatrix.needsUpdate = true;
    }

    this.soltarDetritos(p);
    return true;
  }

  /**
   * Reassenta as peças que uma cratera deixou no ar.
   *
   * Sem isto, um Kamehameha no meio de um bosque abre treze metros de buraco e
   * deixa as ajisas pairando sobre ele, com raiz no vazio. Reassentar é visual e
   * determinístico (mesma cratera, mesma lista, mesmo resultado em todas as
   * telas), então não precisa passar pela rede.
   *
   * O que NÃO se faz aqui é destruir: quem decide o que cai é a sala
   * (`NS2C.PROP_DOWN`). Derrubar por conta própria criaria uma segunda
   * autoridade sobre o mesmo estado, que é exatamente o que o §8 do plano evita.
   */
  reassentar(cx, cz, raio) {
    const alcance = raio + 6;
    for (const p of this._props) {
      if (p.vida <= 0) continue;
      if (Math.abs(p.x - cx) > alcance || Math.abs(p.z - cz) > alcance) continue;
      if (Math.hypot(p.x - cx, p.z - cz) > alcance) continue;
      const base = this.assentar(p.x, p.z, p._pegada) - p._enterrar;
      if (Math.abs(base - p._base) < 0.05) continue;
      p._base = base;
      p.y = base + p._centro;
      _obj.position.set(p.x, base, p.z);
      _obj.rotation.set(p._tombo, p._yaw, p._tombo * 0.7);
      _obj.scale.setScalar(p._escala);
      _obj.updateMatrix();
      p._mesh.setMatrixAt(p._vaga, _obj.matrix);
      p._mesh.instanceMatrix.needsUpdate = true;
      if (p._comp) {
        p._comp.setMatrixAt(p._vaga, _obj.matrix);
        p._comp.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** 0 = brisa, 1 = vendaval. */
  setStorm(t) {
    this.storm = clamp(t, 0, 1);
    this.uniforms.vento.value = 0.09 + this.storm * 0.5;
  }

  update(dt, cameraPos, tempoSala = 0) {
    this.relogio = tempoSala > 0 ? (tempoSala / 1000) % 3600 : this.relogio + dt;
    this.uniforms.tempo.value = this.relogio;

    if (!this.pedacos) return;
    let mexeu = false;
    for (let i = 0; i < DETRITO_POOL; i++) {
      const f = this.pedacos[i];
      if (!f) continue;
      const acabou = passoEstilhaco(f, dt, NAMEK.fighter.gravity, this._chao, DETRITO);
      /* O sumiço é por ESCALA, não por opacidade: o material é opaco (é pedaço
         de pedra), e torná-lo transparente para o fim da vida de um estilhaço
         mudaria a fila de desenho da malha inteira do pool. */
      const escala = acabou ? 0 : opacidadeEstilhaco(f, DETRITO) * f.raio;
      _obj.position.set(f.x, f.y, f.z);
      _obj.rotation.set(f.rotX, 0, f.rotZ);
      _obj.scale.setScalar(escala);
      _obj.updateMatrix();
      this.detritos.setMatrixAt(i, _obj.matrix);
      mexeu = true;
      if (acabou) this.pedacos[i] = null;
    }
    if (mexeu) this.detritos.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    /* Geometrias e materiais saem com a raiz do mundo (`disposeSubtree`), que é
       quem tem a lista de exceções dos recursos de módulo. O que se faz aqui é
       soltar as referências, para uma troca de sala não segurar as trezentas
       peças e o pool de estilhaços vivos. */
    this._props = [];
    this._porTipo = { rocha: [], arvore: [], casa: [] };
    this.pedacos = null;
    this.detritos = null;
    this.malhas = [];
    this.root = null;
  }
}
