/* ---------------------------------------------------------------------------
   O que está de pé em Namekusei: rocha, ajisa, moita, capim e a vila
   namekuseijin.

   TUDO É `InstancedMesh`, uma chamada de desenho por VARIANTE de espécie — é
   obrigação do §3 do plano e já é o padrão do repositório
   (`entities/environment.js`, `systems/spaceLife.js`). Somando rocha (4), tronco
   e copa (2+2), casa (2), moita (3), capim (1) e detrito (1), o cenário inteiro
   sai em quinze chamadas, contra um teto de 90.

   ------------------------------------------------------------ o orçamento

   O teto do §3 é de 180 k triângulos e 90 chamadas de desenho para o cenário
   INTEIRO — terreno, mar, céu e peças. Medido, com estas contagens:

                      antes      agora
       terreno       82 400     97 632   (LOD mais fino nas montanhas — ver
                                          `terrain.js` e o porquê lá)
       peças         60 198     68 214   (as contagens deste arquivo)
       mar            5 472      5 472
       céu            2 216      2 216
       -------------------------------
       total        150 286    173 534   de um teto de 180 000
       chamadas          19         23   de um teto de 90

   As peças, uma a uma:

       casa       39      × 250 tri
       ajisa     397      ×  70 tri   (eram 279 × 108)
       rocha     230      ×  80 tri
       moita     397      ×  20 tri   (nova)
       capim     573      ×   6 tri   (nova)
       detrito   112      ×   8 tri   (o pool, sempre desenhado)

   A margem — 6,5 k triângulos — é fina de propósito: ela foi gasta em duas
   coisas que o usuário pediu por nome, vegetação ("está com muito pouca
   vegetação") e montanha que perde pedaço. Quem mexer nas contagens abaixo tem
   de refazer a soma, e o jeito de refazer é contar
   `geometry.index.count / 3 × instâncias` por malha.

   O RETOQUE VISUAL SEGUINTE (o sol grande, a bruma acesa, a contraluz da
   folhagem) não mexeu em nenhum dos dois números acima, e é por isso que a
   tabela continua valendo: ele não criou uma malha, uma instância nem um
   material — foi pago inteiro em ARITMÉTICA DE FRAGMENTO, que é o orçamento que
   ainda tinha folga. A conta desse outro orçamento está no cabeçalho de
   `sky.js`, junto do sol, porque é lá que ela é grande (tela cheia). Aqui ela é
   um `pow` por pixel de folha, e folha ocupa pouco da tela.

   E ele também não criou uma quarta LUZ. As três continuam sendo sol,
   hemisférica e a dos especiais — a contraluz da copa e o dourado do horizonte
   são termos de shader sobre uma direção constante, não fontes. Uma quarta luz
   recompilaria todos os materiais da cena, e o engasgo apareceria no primeiro
   Kamehameha.

   O que pagou a conta foi a GEOMETRIA POR PEÇA, não a contagem: o tronco da
   ajisa caiu de 72 para 40 triângulos e a copa de 36 para 30. São seis lados
   virando cinco numa vara de 34 cm de raio vista a vinte metros — invisível —, e
   com a economia cabem 47 % mais árvores mais duas espécies novas de vegetação
   rasteira, que é o que muda a leitura do chão.

   ------------------------------------------------------ tudo aqui se destrói

   Pedido literal: *"tudo no cenário deve ser destrutível: árvores, pedras,
   casas, montanhas, etc."*. As quatro primeiras são peças e estão todas em
   `props` com vida — inclusive as duas espécies novas de vegetação rasteira,
   que entraram no sistema de destruição junto com o resto e não como enfeite
   imune. A montanha não é peça: ela é o campo de altura, e quem a quebra é
   `NamekField.craterDelta` (ver o cabeçalho de `shared/namek/field.js`).

   E cada uma quebra com a LEITURA DELA, que é a outra metade do pedido. Um
   `scale = 0` serve para todas e não serve para nenhuma: o que o olho precisa
   ver é a árvore TOMBANDO, a casa DESABANDO e a pedra LASCANDO, porque é isso
   que diz de que material era a coisa que acabou de sumir. Ver `breakProp` e
   `animarQuedas`.

   -------------------------------------------------- o que `props` custa a quem lê

   A lista tem 1 636 peças, e ela não é uma lista qualquer: `NamekGame`
   (`derrubarPorPerto`) a varre INTEIRA a cada estouro no chão, e uma sala cheia
   produz até 90 estouros por segundo. Antes da vegetação rasteira eram 548
   peças. Medido, com a lista de hoje:

     • a varredura custa 6,8 µs por estouro — 0,6 ms por segundo no pior caso,
       que some no ruído de qualquer quadro;
     • ela manda um `NC2S.PROP_HIT` por peça atingida. Média de 0,1 peça para uma
       bola de ki e 2,5 para uma Genki Dama; o PIOR ponto do mapa inteiro, uma
       Genki Dama no meio de uma touceira densa, atinge 36.

   Trinta e seis mensagens num quadro é uma rajada, e é o número a vigiar se
   alguém quiser triplicar as touceiras: ele cresce LINEARMENTE com a densidade
   local, não com a contagem total, e é por isso que a densidade é local (ver
   `QUANTIDADE.touceiras`). Duas vezes mais peças no mesmo lugar são duas vezes
   mais mensagens no mesmo quadro; duas vezes mais touceiras, não.

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
   que um lutador atravessa — e atravessar uma ilha a 64 m/s de arranque não lê
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
import { NAMEK_SOL_DIR } from "./sky.js";
import { aplicarDetalhe } from "./detail.js";
import {
  criarEstilhacos,
  passoEstilhaco,
  opacidadeEstilhaco,
} from "../../shared/fragments.js";

const TAU = Math.PI * 2;

/* Vida de cada espécie. A rocha aguenta mais que a árvore, e a casa mais que as
   duas — uma rajada básica dá 6 de dano, então a ajisa cai com cinco tiros, a
   rocha com dez e a casa só com um especial ou uma insistência que o jogador
   vai sentir como decisão.
   A vegetação rasteira cai com UM tiro, e isso é a régua certa: moita e capim
   têm meio metro de altura, ninguém mira neles de propósito, e exigir insistência
   para arrancar um tufo de mato faria o cenário parecer blindado justamente na
   escala em que ele deveria parecer frágil. */
const VIDA = { rocha: 58, arvore: 30, casa: 96, moita: 6, capim: 4 };

/* Quantas peças de cada coisa. Os números saem do orçamento de triângulos do
   §3 e estão medidos — ver a seção "o orçamento" no cabeçalho, que traz a soma
   e o que fazer se ela mudar. */
const QUANTIDADE = {
  rochas: 230,
  bosques: 36,
  arvoresPorBosque: [7, 15],
  vilas: 3,
  casasPorVila: [10, 15],
  /* A vegetação rasteira nasce EM TOUCEIRAS, nunca espalhada uniformemente.
     Mato de verdade cresce onde já há mato: uma distribuição uniforme com o
     dobro das peças pareceria menos densa que esta com metade, porque densidade
     é uma coisa LOCAL e o olho a mede olhando para um lugar, não para o mapa. */
  touceiras: 74,
  moitasPorTouceira: [3, 9],
  capimPorTouceira: [5, 13],
};

/* As RECEITAS de estilhaço, uma por espécie, no formato que
   `shared/fragments.js` espera mais um campo `forma`.

   Uma receita só para tudo era o que existia, e ela apagava exatamente a
   informação que o estilhaço serve para dar: DE QUE a coisa era feita. Rocha
   quebra em poucos blocos gordos; casa, em muitas placas finas de reboco; ajisa,
   em farpas compridas; moita e capim, em punhados de folha que mal viajam. As
   quatro leituras saem de uma geometria só, por escala não uniforme — o mesmo
   truque que `fx/pool.js` documenta para as lascas do impacto.

   Restituição, tempo de assentamento e fade são iguais em todas de propósito:
   eles descrevem a GRAVIDADE do planeta e o ritmo do efeito, não o material. */
const DETRITO_COMUM = {
  fragRestitution: 0.26,
  fragKillSpeed: 3.2,
  fragSettleTime: 1.5,
  fragFadeTime: 1.7,
};
const DETRITO = {
  rocha: { ...DETRITO_COMUM, fragCount: 9, fragSpeedMin: 5, fragSpeedMax: 17,
    fragRaioMin: 0.32, fragRaioMax: 1.05, forma: [1, 0.9, 1.08] },
  arvore: { ...DETRITO_COMUM, fragCount: 7, fragSpeedMin: 3, fragSpeedMax: 10,
    fragRaioMin: 0.2, fragRaioMax: 0.6, forma: [0.24, 0.27, 1.85] },
  casa: { ...DETRITO_COMUM, fragCount: 13, fragSpeedMin: 5, fragSpeedMax: 15,
    fragRaioMin: 0.28, fragRaioMax: 0.9, forma: [1.3, 0.16, 1.02] },
  moita: { ...DETRITO_COMUM, fragCount: 6, fragSpeedMin: 2.4, fragSpeedMax: 7,
    fragRaioMin: 0.16, fragRaioMax: 0.44, forma: [1.05, 0.55, 1.0] },
  capim: { ...DETRITO_COMUM, fragCount: 4, fragSpeedMin: 2, fragSpeedMax: 6,
    fragRaioMin: 0.12, fragRaioMax: 0.3, forma: [0.3, 0.2, 1.5] },
};
/* Capacidade do pool. Treze por casa derrubada, e uma Genki Dama numa vila
   derruba meia dúzia delas no mesmo quadro — 112 é o que cobre isso sem a leva
   nova apagar a metade da leva anterior que ainda está no ar. O custo é uma
   matriz composta por quadro por vaga VIVA (as mortas ficam em escala zero e
   morrem no clipping), mais 112 × 8 = 896 triângulos de orçamento. */
const DETRITO_POOL = 112;

const PALETA = {
  rocha: [
    new THREE.Color("#7b8477"),
    new THREE.Color("#6a7368"),
    new THREE.Color("#8a8f7c"),
    new THREE.Color("#5d6a63"),
  ],
  tronco: new THREE.Color("#c2d0b6"),
  /* AS QUATRO COPAS, com o intervalo de VALOR aberto mais do que estava.
     Os quatro tons cabiam em 18 % de luminosidade, e o resultado num bosque de
     quinze ajisas era uma mancha só: a variação existia no código e não existia
     na tela. Abertos para 30 %, a copa da frente e a do fundo se separam sem que
     nenhuma delas saia da família turquesa que é do planeta — e a contraluz que
     entrou (ver `aplicarBalanco`) tem onde acender, porque ela multiplica a cor
     de cada copa e não uma cor de folha genérica: quatro tons chapados dariam
     quatro brilhos chapados. */
  copa: [
    new THREE.Color("#2a9c74"),
    new THREE.Color("#46b884"),
    new THREE.Color("#1d7d5e"),
    new THREE.Color("#57c795"),
  ],
  /* A moita é a mesma família da copa, um degrau mais escura e mais dessaturada:
     ela vive no chão, à sombra de si mesma, e uma vegetação rasteira tão clara
     quanto a folhagem alta acha a mesma profundidade do céu — o bosque perde o
     andar de baixo. */
  moita: [
    new THREE.Color("#2c7f63"),
    new THREE.Color("#227257"),
    new THREE.Color("#36906f"),
    new THREE.Color("#1d6650"),
  ],
  /* O capim puxa para o amarelo-esverdeado. É a única peça do cenário que não é
     turquesa, e ela existe justamente por isso: com tudo na mesma faixa de
     matiz, o chão vira uma superfície só, por mais peças que se ponha nele. */
  capim: [
    new THREE.Color("#8fc073"),
    new THREE.Color("#a8cd7f"),
    new THREE.Color("#79ad68"),
  ],
  casa: new THREE.Color("#f1efe2"),
  /* A SOMBRA DA CASA puxa para o VERDE, e é a regra mais antiga de pintura de
     exterior: se a luz é quente, a sombra é fria, porque o que ilumina o que o
     sol não alcança é o CÉU. Aqui o céu é lima e o sol é âmbar — a divisão de
     matiz num domo branco de seis metros e meio é a coisa mais visível do
     cenário inteiro, e ela estava saindo cinza-oliva (`#b9bda9`), que é a cor
     de nada. Um branco com sombra da cor do céu é o que faz uma vila parecer
     estar DENTRO do planeta e não colada por cima dele. */
  casaSombra: new THREE.Color("#a3b8a2"),
  janela: new THREE.Color("#1b4a55"),
  porta: new THREE.Color("#26403f"),
};

const _obj = new THREE.Object3D();
const _cor = new THREE.Color();
/** Origem reaproveitada de `soltarDetritos`. Ver o comentário lá. */
const _origem = { x: 0, y: 0, z: 0 };

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
 * se quer são cinco lados e quatro anéis — 40 triângulos. Um tubo com resolução
 * padrão traz quinze vezes isso para descrever a mesma vara.
 *
 * Eram seis lados e seis anéis, 72 triângulos, e a conta de trocá-los é a do
 * cabeçalho: 32 triângulos × 400 árvores são 13 k, que é metade de uma espécie
 * nova de vegetação. O que se perde são as facetas de um cilindro de 34 cm de
 * raio a vinte metros de distância — nada — e um anel da curva, que continua
 * lendo como curva porque o deslocamento é quadrático e a base fica plantada.
 */
function geoTronco(altura, raioBase, raioTopo, curva, lados = 5, segs = 4) {
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
function geoCopa(raio, altura, desvioX, lados = 10, laminas = 5) {
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
function geoCasa(escala, lados = 12) {
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

/**
 * Uma MOITA: a vegetação rasteira de Namekusei, entre o capim e a ajisa.
 *
 * É um icosaedro de detalhe 0 — vinte triângulos, o mínimo que ainda é um
 * volume — achatado e amassado por direção, exatamente como a rocha. A diferença
 * está em duas linhas e nas duas está a leitura:
 *
 * • ela é ACHATADA (0,58 em y). Uma bola verde no chão é um arbusto de maquete;
 *   moita de verdade é mais larga que alta porque cresce para a luz e para os
 *   lados ao mesmo tempo.
 * • ela é AMASSADA COM AMPLITUDE ALTA (0,3 contra os 0,22 da rocha) e mantém a
 *   normal SUAVE. Pedra tem faceta, folhagem não: `computeVertexNormals` num
 *   sólido de vinte faces com deformação forte dá aquela superfície mole e
 *   irregular que o olho aceita como massa de folha.
 *
 * Vinte triângulos por peça é o que permite que existam quatrocentas delas. Uma
 * moita "bem feita" de cem triângulos custaria o mesmo que noventa árvores.
 */
function geoMoita(rnd) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.attributes.position;
  const fx = 0.7 + rnd() * 1.6;
  const fy = 0.7 + rnd() * 1.6;
  const fz = 0.7 + rnd() * 1.6;
  const fase = rnd() * TAU;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d =
      1 +
      0.3 * Math.sin(x * fx * 2.6 + fase) +
      0.24 * Math.sin(y * fy * 3.3 + fase * 1.7) +
      0.28 * Math.sin(z * fz * 2.9 - fase);
    pos.setXYZ(i, x * d, y * d * 0.58, z * d);
  }
  geo.computeVertexNormals();
  /* Sobe meio raio: a origem do icosaedro é o centro, e a peça é assentada pelo
     PÉ como todas as outras (ver `criarEspecie`). Sem isto a moita nasceria com
     metade do corpo dentro do chão — que é quase o que se quer, mas "quase" aqui
     significa a metade das moitas em encosta ficando invisíveis. */
  geo.translate(0, 0.5, 0);
  return sombrearPorAltura(geo, 0.5, 1.2, 0.8);
}

/**
 * Um TUFO DE CAPIM: três lâminas cruzadas, seis triângulos.
 *
 * Esta é a peça mais barata do cenário e a que mais muda o chão, e as duas
 * coisas têm a mesma causa: ela não tem volume nenhum. São três quadriláteros
 * verticais girados 60° entre si — de qualquer ângulo em que o jogador esteja,
 * pelo menos um deles está quase de frente, e o conjunto lê como um tufo. É o
 * truque de vegetação mais antigo que existe e ele continua sendo o certo quando
 * o orçamento é de seis triângulos.
 *
 * As lâminas afinam e INCLINAM no topo (`caida`). Um retângulo vertical é uma
 * placa; o que faz o olho ver capim é a ponta pendendo, e ela custa mover dois
 * vértices. O material é `DoubleSide` — pelo mesmo motivo da copa, este é um
 * jogo de voo e se passa por cima e por baixo de tudo.
 */
function geoCapim(alturaRef = 1) {
  const laminas = 3;
  const pos = new Float32Array(laminas * 4 * 3);
  const idx = new Uint32Array(laminas * 6);
  for (let i = 0; i < laminas; i++) {
    const a = (i / laminas) * Math.PI; // meia volta basta: a lâmina é dupla face
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const largura = 0.34;
    const alto = alturaRef * (0.78 + 0.22 * ((i * 7) % 3) / 2);
    const caida = 0.3 * alturaRef;
    const b = i * 4 * 3;
    // base larga
    pos[b] = -ca * largura; pos[b + 1] = 0; pos[b + 2] = -sa * largura;
    pos[b + 3] = ca * largura; pos[b + 4] = 0; pos[b + 5] = sa * largura;
    // topo estreito e caído para o lado
    pos[b + 6] = ca * largura * 0.18 + sa * caida;
    pos[b + 7] = alto;
    pos[b + 8] = sa * largura * 0.18 - ca * caida;
    pos[b + 9] = -ca * largura * 0.18 + sa * caida;
    pos[b + 10] = alto;
    pos[b + 11] = -sa * largura * 0.18 - ca * caida;
    const o = i * 4;
    const k = i * 6;
    idx[k] = o; idx[k + 1] = o + 1; idx[k + 2] = o + 2;
    idx[k + 3] = o; idx[k + 4] = o + 2; idx[k + 5] = o + 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  /* Gradiente forte: a base do tufo é quase preta e a ponta é clara. Num objeto
     de seis triângulos sem volume, esse degradê é a ÚNICA fonte de profundidade
     que existe — sem ele o capim é um adesivo verde chapado espetado no chão. */
  return sombrearPorAltura(geo, 0.42, 1.25, 0.85);
}

/* -------------------------------------------------- balanço e contraluz --- */

/**
 * Enxerta o balanço das copas no material — e, quando `folha` é maior que zero,
 * a CONTRALUZ da folhagem junto.
 *
 * As duas coisas moram na mesma função por obrigação, não por conveniência:
 * `onBeforeCompile` é um campo, não uma lista, e uma segunda função que também
 * o atribuísse apagaria a primeira em silêncio. O sintoma seria o vento parando
 * ou a folha apagando dependendo da ordem das chamadas, sem erro nenhum no
 * console — o pior tipo de defeito que um enxerto de shader pode ter.
 *
 * ------------------------------------------------------------------ o balanço
 *
 * A copa inteira INCLINA como um bloco (a amplitude cresce com a altura local),
 * então o mesmo trecho serve para o tronco e para a folhagem — e é por isso que
 * as duas geometrias são construídas no mesmo referencial, com y = 0 no chão.
 * Se cada uma tivesse a própria origem, a copa descolaria do tronco no primeiro
 * sopro, que é exatamente o que aconteceu na primeira montagem.
 *
 * A fase sai da POSIÇÃO DA INSTÂNCIA: sem ela o bosque inteiro balança em
 * uníssono, e um bosque em uníssono lê como um erro de animação, não como vento.
 *
 * ---------------------------------------------------------------- a contraluz
 *
 * Folha é FINA e a luz atravessa. Com o sol a 32° de altura (ver `sky.js`), a
 * metade das copas que fica entre o jogador e o sol devia estar acesa por dentro
 * — verde-limão brilhante contra o céu — e estava saindo do mesmo verde escuro
 * da metade de trás, porque o `MeshStandardMaterial` só sabe refletir. Uma
 * ajisa, que é uma pala de um triângulo de espessura, é o pior caso possível
 * disso: pela frente ela é folhagem, por trás é uma silhueta chapada.
 *
 * O termo é o clássico e cabe numa linha: quanto mais a linha de visada aponta
 * para o sol, mais luz atravessa. Ele entra como EMISSIVO (o mesmo ponto de
 * injeção que as fissuras do terreno usam, e pelo mesmo motivo: é o único lugar
 * em que `totalEmissiveRadiance` já existe e ainda não foi somado) e é
 * multiplicado por `diffuseColor`, que naquele ponto já traz a cor de vértice E
 * a tinta da instância — ou seja, cada copa acende na PRÓPRIA cor, e não numa
 * cor de folha genérica que apagaria as quatro variantes de uma vez.
 *
 * Não é uma quarta luz, e isso é o que o §3 cobra: é aritmética de fragmento
 * sobre uma direção constante. O orçamento de três luzes continua com sol,
 * hemisférica e a dos especiais, e nada aqui recompila nada.
 *
 * @param {number} folha 0 = madeira (nada atravessa) · ~0,5 = folhagem
 */
function aplicarBalanco(material, uniforms, alturaRef, folha = 0) {
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

    if (folha > 0) {
      shader.uniforms.solLuz = uniforms.solLuz;
      shader.uniforms.solDirFolha = { value: NAMEK_SOL_DIR.clone() };
      shader.uniforms.folhaForca = { value: folha };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec3 vMundoFolha;`,
        )
        .replace(
          "#include <project_vertex>",
          `{
             /* Depois do balanço (transformed já está torto pelo vento) e
                ANTES da projeção, que é o último ponto em que a posição local
                ainda existe. A matriz da instância entra à mão porque
                transformed é local à GEOMETRIA, e sem ela as quatrocentas
                ajisas do mapa compartilhariam a mesma linha de visada — todas
                acenderiam ou nenhuma. */
             vec4 pFolha = vec4(transformed, 1.0);
             #ifdef USE_INSTANCING
               pFolha = instanceMatrix * pFolha;
             #endif
             vMundoFolha = (modelMatrix * pFolha).xyz;
           }
           #include <project_vertex>`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform vec3 solDirFolha;
           uniform float folhaForca;
           uniform float solLuz;
           varying vec3 vMundoFolha;`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           {
             /* olhoParaFolha aponta da câmera para o pixel; se ele estiver
                alinhado com a direção do sol, o sol está ATRÁS da folha e é isso
                que se quer acender. Expoente 4 para o efeito ser um feixe: com 1
                ou 2 a mata inteira brilha e o resultado não é contraluz, é uma
                folhagem fluorescente. */
             vec3 olhoParaFolha = normalize(vMundoFolha - cameraPosition);
             float atravessa = pow(max(dot(olhoParaFolha, normalize(solDirFolha)), 0.0), 4.0);
             totalEmissiveRadiance += diffuseColor.rgb * (atravessa * folhaForca * solLuz);
           }`,
        );
    }
  };

  /* A CHAVE DO CACHE DE PROGRAMA, e sem ela este arquivo quebraria sozinho.
     O Three monta a chave com os parâmetros do material e **não** com o texto
     que o `onBeforeCompile` produziu — só com o que esta função devolve. Antes
     da contraluz os quatro materiais daqui geravam o MESMO texto e o
     compartilhamento era inofensivo; agora tronco (sem contraluz) e copa (com)
     geram textos diferentes com parâmetros idênticos, e sem esta linha o
     segundo a compilar receberia o programa do primeiro. O sintoma seria o
     tronco procurando um `varying` que o vertex dele não escreve — ou, pior,
     nada de errado na tela e a folhagem simplesmente sem contraluz.
     Convenção do repositório inteiro: ver `entities/environment.js`. */
  material.customProgramCacheKey = () => `namek-balanco-${folha}`;
}

/* ------------------------------------------------------------------ cenário */

export class NamekScenery {
  /** @param {import("../../shared/namek/field.js").NamekField} field */
  constructor(field) {
    this.field = field;
    this.rnd = makeRandom(NAMEK.world.seed ^ 0x5ce4a11e);
    /* Uniforms compartilhados por tronco, copa e vegetação rasteira. Um objeto
       só para todos porque o vento e a luz do dia são propriedades do MUNDO, não
       de cada material: quatro cópias seriam quatro lugares para esquecer de
       atualizar quando a tempestade virasse.
       `solLuz` é quanto sol ainda existe (1 de dia, ~0 na tempestade) e é o que
       apaga a contraluz da folhagem quando não há mais fonte atrás dela — folha
       acesa contra um céu de fumaça é a leitura de uma luz que ninguém desligou. */
    this.uniforms = {
      tempo: { value: 0 },
      vento: { value: 0.09 },
      solLuz: { value: 1 },
    };
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
    this._porTipo = { rocha: [], arvore: [], casa: [], moita: [], capim: [] };
    this.malhas = [];

    /* AS QUEDAS EM CURSO. Anel de tamanho fixo, preenchido no lugar: uma peça
       derrubada não aloca nada, ela só toma a próxima vaga.
       Vinte e quatro é generoso — são vinte e quatro objetos caindo ao mesmo
       tempo, e mesmo uma Genki Dama numa vila não chega perto disso. Estourar o
       anel não quebra nada: a vaga mais velha é finalizada na hora (a peça vai
       direto para escala zero), o que é exatamente o que se quer quando há tanta
       coisa caindo que ninguém acompanha uma delas. */
    this.quedas = new Array(24);
    for (let i = 0; i < this.quedas.length; i++) {
      this.quedas[i] = { prop: null, t: 0, dur: 1, modo: 0, dirX: 0, dirZ: 0 };
    }
    this.proximaQueda = 0;
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
    /* As árvores DEVOLVEM os centros dos bosques, e a vegetação rasteira os
       reaproveita. Não é economia de sorteio: mato e árvore crescem no mesmo
       lugar porque é o mesmo solo que os sustenta, e uma clareira coberta de
       moitas com os bosques em outro canto do mapa é a leitura de dois sistemas
       que não se conhecem — que é exatamente o que eles seriam. */
    const bosques = this.montarArvores(vilas);
    this.montarRochas(vilas);
    this.montarRasteira(vilas, bosques);
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

  /** @returns {Array<{x:number,z:number}>} os centros dos bosques. Ver `build`. */
  montarArvores(vilas) {
    const rnd = this.rnd;
    const troncos = [geoTronco(11.5, 0.34, 0.17, 1.5), geoTronco(6.8, 0.28, 0.15, 0.9)];
    const copas = [geoCopa(3.4, 11.5, 1.5), geoCopa(2.3, 6.8, 0.9)];
    const baldes = [[], []];
    const centros = [];

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
      centros.push(centro);

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
    /* As duas variantes de tronco têm alturas diferentes; o balanço usa a mais
       alta como referência para as duas, e a baixa simplesmente balança menos.
       A CONTRALUZ é só da copa — ver `aplicarBalanco`. O tronco fica em zero
       porque madeira não é traslúcida, e um pau de 34 cm de raio aceso por
       dentro leria como um erro de material, não como fim de tarde. 0,55 na copa
       é o teto do que dá para gastar antes de a folhagem contra o sol perder o
       degradê interno e virar um recorte de papel iluminado. */
    aplicarBalanco(matTronco, this.uniforms, 11.5, 0);
    aplicarBalanco(matCopa, this.uniforms, 11.5, 0.55);

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

    return centros;
  }

  /**
   * A VEGETAÇÃO RASTEIRA: moitas e capim, em touceiras.
   *
   * É a resposta direta a "está com muito pouca vegetação". O que faltava não
   * eram árvores — eram os DOIS ANDARES ABAIXO delas. Um bosque de ajisas em cima
   * de um chão liso é uma maquete de arquitetura: as copas flutuam, porque não há
   * nada entre o tronco e a superfície pintada que dê escala ao espaço.
   *
   * As touceiras nascem em três lugares, e a proporção é deliberada:
   *
   * • no PÉ DOS BOSQUES (as primeiras, uma por bosque enquanto houver): é onde
   *   mato existe, e é onde o jogador voa baixo perseguindo alguém;
   * • em torno das VILAS, num anel afastado da praça — mato cresce onde ninguém
   *   pisa, e a praça é justamente onde todo mundo pisa;
   * • espalhadas pelo resto do chão pisável, para o mapa não ter regiões pelado.
   *
   * Cada touceira mistura as duas espécies. Moita sem capim vira um monte de
   * bolinhas; capim sem moita, um tapete sem relevo.
   */
  montarRasteira(vilas, bosques) {
    const rnd = this.rnd;
    const geosMoita = [geoMoita(rnd), geoMoita(rnd), geoMoita(rnd)];
    const geosCapim = [geoCapim(1)];
    const baldesMoita = [[], [], []];
    const baldesCapim = [[]];

    /* Os centros, em ordem de prioridade. A lista é montada inteira antes de
       plantar porque as touceiras de bosque têm de vir primeiro: se o orçamento
       de `QUANTIDADE.touceiras` acabar, ele acaba no chão vazio do meio do mapa e
       não debaixo das árvores. */
    const centros = [];
    for (const b of bosques) {
      if (centros.length >= QUANTIDADE.touceiras) break;
      centros.push({ x: b.x, z: b.z, raio: 30, densidade: 1 });
    }
    for (const v of vilas) {
      for (let i = 0; i < 3 && centros.length < QUANTIDADE.touceiras; i++) {
        const a = rnd() * TAU;
        const d = 66 + rnd() * 40; // fora do anel de casas, que vai a 58 m
        centros.push({ x: v.x + Math.cos(a) * d, z: v.z + Math.sin(a) * d, raio: 20, densidade: 0.8 });
      }
    }
    let tentativas = 0;
    while (centros.length < QUANTIDADE.touceiras && tentativas < 400) {
      tentativas++;
      const a = rnd() * TAU;
      const d = 40 + Math.sqrt(rnd()) * 700;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!this.field.isWalkable(x, z)) continue;
      /* Aceita ladeira suave (0,8 é uns 36°): mato sobe encosta, e recusar
         inclinação deixaria a saia das montanhas — que é metade do que se vê da
         clareira — com a mesma cara pelada de antes. */
      if (this.field.slopeAt(x, z) < 0.8) continue;
      centros.push({ x, z, raio: 16 + rnd() * 14, densidade: 0.75 });
    }

    for (const c of centros) {
      const nM = Math.round(
        (QUANTIDADE.moitasPorTouceira[0] +
          rnd() * (QUANTIDADE.moitasPorTouceira[1] - QUANTIDADE.moitasPorTouceira[0])) *
          c.densidade,
      );
      const nC = Math.round(
        (QUANTIDADE.capimPorTouceira[0] +
          rnd() * (QUANTIDADE.capimPorTouceira[1] - QUANTIDADE.capimPorTouceira[0])) *
          c.densidade,
      );
      for (let i = 0; i < nM + nC; i++) {
        const capim = i >= nM;
        let posto = null;
        for (let t = 0; t < 6 && !posto; t++) {
          const a = rnd() * TAU;
          /* Sem raiz no raio, ao contrário de quase todo sorteio deste arquivo:
             aqui o acúmulo no miolo é o que se QUER. Touceira é densa no centro e
             rala na borda; distribuída por área ela vira um disco uniforme de
             mato, que é o que menos parece mato. */
          const r = rnd() * c.raio;
          const x = c.x + Math.cos(a) * r;
          const z = c.z + Math.sin(a) * r;
          if (!this.field.isWalkable(x, z)) continue;
          if (this.field.slopeAt(x, z) < 0.74) continue;
          posto = { x, z };
        }
        if (!posto) continue;

        if (capim) {
          baldesCapim[0].push({
            ...posto,
            escala: 1.1 + rnd() * 1.5,
            yaw: rnd() * TAU,
            tinta: Math.floor(rnd() * PALETA.capim.length),
            raio: 0.55,
          });
        } else {
          const variante = Math.floor(rnd() * geosMoita.length);
          baldesMoita[variante].push({
            ...posto,
            escala: 0.7 + Math.pow(rnd(), 1.5) * 1.5,
            yaw: rnd() * TAU,
            tombo: (rnd() - 0.5) * 0.24,
            tinta: Math.floor(rnd() * PALETA.moita.length),
            raio: 1,
          });
        }
      }
    }

    const matMoita = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    const matCapim = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    /* As duas balançam, e com referência PRÓPRIA: `aplicarBalanco` divide a
       altura do vértice por `alturaRef` para saber quanto aquele ponto oscila.
       Passando os 11,5 m da ajisa, um tufo de 2 m ficaria com `alto` valendo
       0,17 — quadrado, 3 % — e o mato não mexeria uma folha no meio de um
       vendaval que dobra as árvores. */
    /* A contraluz da rasteira é menor que a da copa (0,3 e 0,42 contra 0,55) e a
       do capim é a maior das duas — três lâminas de uma folha de espessura
       contra a luz são o caso mais extremo de folha fina que existe no cenário,
       e é o tufo aceso rente ao chão que dá ao campo a mesma hora do dia que o
       resto da cena. A moita é volume, atravessa menos. */
    aplicarBalanco(matMoita, this.uniforms, 1.6, 0.3);
    aplicarBalanco(matCapim, this.uniforms, 1.4, 0.42);

    this.criarEspecie("moita", geosMoita, baldesMoita, {
      material: matMoita,
      // Enterra bastante: moita nasce do chão, não pousa nele.
      enterrar: (p) => p.raio * p.escala * 0.3,
      pegada: (p) => p.raio * p.escala * 0.8,
      escalaDe: (p) => p.escala,
      centro: (p) => p.raio * p.escala * 0.5,
      acerto: (p) => p.raio * p.escala * 1.3,
      vida: VIDA.moita,
      tintas: PALETA.moita,
    });

    this.criarEspecie("capim", geosCapim, baldesCapim, {
      material: matCapim,
      enterrar: () => 0.12,
      pegada: (p) => 0.4 * p.escala,
      escalaDe: (p) => p.escala,
      centro: (p) => p.raio * p.escala,
      acerto: (p) => p.raio * p.escala * 1.5,
      vida: VIDA.capim,
      tintas: PALETA.capim,
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
      // O mesmo grão do chão (ver `world/detail.js`): pedra lisa ao lado de um
      // terreno com grão denuncia as duas coisas de uma vez.
      material: aplicarDetalhe(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          metalness: 0,
        }),
        "namek-rocha-detalhe",
      ),
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
    /** A receita de cada vaga viva — é ela que dá forma e ritmo à lasca. */
    this.receitas = new Array(DETRITO_POOL).fill(null);
    this.proximoPedaco = 0;
  }

  /**
   * O estilhaço de uma peça que caiu.
   *
   * A receita vem da ESPÉCIE (ver `DETRITO`), e é ela que faz uma casa soltar
   * treze placas brancas enquanto uma rocha solta nove blocos. Guardá-la por
   * vaga, e não usar uma global, é o que permite duas espécies diferentes
   * estarem no ar ao mesmo tempo — que é o caso normal quando um especial cai no
   * meio de um bosque ao lado de uma vila.
   *
   * O ponto de saída é PARÂMETRO, e não `prop.x/y/z`, por causa da ajisa: ela
   * tomba antes de se desfazer, e quando se desfaz já não está onde estava. Um
   * objeto temporário `{...prop, x, z}` resolveria igual e alocaria — pequeno,
   * mas o §3 do plano cobra zero, e "pequeno o bastante" é como um orçamento de
   * alocação sempre começa a vazar.
   *
   * @param {object} prop
   * @param {number} x,y,z de onde as lascas saem
   */
  soltarDetritos(prop, x, y, z) {
    const receita = DETRITO[prop.kind] ?? DETRITO.rocha;
    const cores =
      prop.kind === "casa"
        ? null
        : prop.kind === "arvore"
          ? PALETA.copa
          : prop.kind === "moita"
            ? PALETA.moita
            : prop.kind === "capim"
              ? PALETA.capim
              : PALETA.rocha;
    /* Semente derivada de QUEM caiu, não de um contador: assim as lascas da
       rocha 47 voam para os mesmos lados em todas as telas, e a queda que dois
       jogadores viram é a mesma queda. Custa zero de rede. */
    const semente = (prop.kind.charCodeAt(0) * 7919 + prop.i * 104729) >>> 0;
    _origem.x = x;
    _origem.y = y;
    _origem.z = z;
    const lista = criarEstilhacos(_origem, semente, receita);

    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      // Escala pela peça: uma casa espalha lascas maiores que uma ajisa.
      f.raio *= clamp(prop.raio * 0.5, 0.4, 2.4);
      const vaga = this.proximoPedaco;
      this.proximoPedaco = (this.proximoPedaco + 1) % DETRITO_POOL;
      this.pedacos[vaga] = f;
      this.receitas[vaga] = receita;
      /* Tinta sorteada dentro da paleta do material, e não uma cor fixa: um
         monte de cacos de UMA cor lê como confete. Determinística pelo índice do
         estilhaço, para as duas telas verem o mesmo monte. */
      this.detritos.setColorAt(vaga, cores ? cores[(prop.i + i) % cores.length] : PALETA.casa);
    }
    if (this.detritos.instanceColor) this.detritos.instanceColor.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- quedas - */

  /**
   * Enfileira a ANIMAÇÃO de queda de uma peça. Ver `animarQuedas`.
   *
   * @param {object} p     a peça
   * @param {number} modo  0 = encolher · 1 = tombar · 2 = desabar
   * @param {number} dur   s
   * @param {boolean} solta soltar estilhaço QUANDO ELA TERMINAR de cair
   */
  enfileirarQueda(p, modo, dur, solta) {
    const q = this.quedas[this.proximaQueda];
    this.proximaQueda = (this.proximaQueda + 1) % this.quedas.length;
    /* A vaga estava ocupada: a peça anterior é finalizada AGORA, sem animação. É
       o comportamento certo para o caso que produz isto — vinte e quatro objetos
       caindo ao mesmo tempo —, porque nesse quadro ninguém está acompanhando
       nenhum deles em particular. */
    if (q.prop) this.finalizarQueda(q);

    /* A direção do tombo sai do índice da peça, não de um sorteio: a árvore 12
       cai para o mesmo lado em todas as telas. É a mesma regra da semente do
       estilhaço, e pelo mesmo motivo. */
    const ang = ((p.i * 2.399963) % TAU) + p.kind.charCodeAt(0);
    q.prop = p;
    q.t = 0;
    q.dur = dur;
    q.modo = modo;
    q.solta = solta;
    q.dirX = Math.cos(ang);
    q.dirZ = Math.sin(ang);
  }

  /** Tira a peça do quadro e solta o estilhaço que faltava. */
  finalizarQueda(q) {
    const p = q.prop;
    const solta = q.solta;
    q.prop = null;
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
    if (!solta) return;
    /* A ÁRVORE SE DESFAZ DEITADA. As farpas saem de onde a copa foi parar — o
       chão, a um raio de distância do toco —, e não do meio do tronco em pé, que
       é onde ela estava quando o tiro chegou. Uma árvore que tomba e depois
       explode no ar, no lugar onde estava antes de tombar, é a leitura de duas
       animações que não se falam. */
    if (q.modo === 1) {
      const alc = p._centro * 1.2;
      const x = p.x + q.dirX * alc;
      const z = p.z + q.dirZ * alc;
      this.soltarDetritos(p, x, this.field.heightAt(x, z) + 0.6, z);
    } else {
      this.soltarDetritos(p, p.x, p.y, p.z);
    }
  }

  /**
   * As quedas em curso, um passo.
   *
   * Custa uma matriz composta por peça caindo por quadro — no máximo 24, e na
   * prática uma ou duas. Nada é alocado: o anel de `quedas` nasce cheio de
   * objetos que só têm os campos reescritos.
   */
  animarQuedas(dt) {
    for (let i = 0; i < this.quedas.length; i++) {
      const q = this.quedas[i];
      const p = q.prop;
      if (!p) continue;
      q.t += dt;
      const u = q.t / q.dur;
      if (u >= 1) {
        this.finalizarQueda(q);
        continue;
      }

      let escala = p._escala;
      let base = p._base;
      let rx = p._tombo;
      let rz = p._tombo * 0.7;

      if (q.modo === 1) {
        /* TOMBAR. O ângulo cresce com o QUADRADO do tempo, e é o quadrado que
           faz a coisa parecer pesada: um tronco de onze metros e meio girando em
           velocidade constante lê como uma porta abrindo. O que se quer é a
           demora inicial e a chegada rápida de um corpo rígido caindo por
           gravidade em torno da base — e essa é literalmente uma parábola. */
        const ang = 1.62 * u * u;
        rx += q.dirZ * ang;
        rz += -q.dirX * ang;
      } else if (q.modo === 2) {
        /* DESABAR. A casa não tomba: o domo perde a casca e o que sobra afunda
           sobre si mesmo. Encolher e descer ao mesmo tempo — o mesmo truque que
           `fx/debris.js` usa para a lasca assentar — porque encolher sozinho
           deixaria a casa virando um ponto no ar no meio da praça. */
        escala = p._escala * (1 - 0.75 * u * u);
        base = p._base - p._centro * 0.55 * u * u;
        /* Um tombo de leve, para o desabamento não ser perfeitamente vertical: a
           casa cede mais de um lado, como cede uma parede que estourou. */
        rx += q.dirZ * 0.22 * u;
        rz += -q.dirX * 0.22 * u;
      } else {
        /* ENCOLHER. Rocha, moita e capim. É o mais curto dos três e ele não
           tenta contar história nenhuma: o que conta a história é o estilhaço,
           que já saiu no instante do impacto. O que este passo faz é só evitar
           que a peça SUMA num quadro, que é o defeito que salta aos olhos. */
        escala = p._escala * (1 - u * u);
      }

      _obj.position.set(p.x, base, p.z);
      _obj.rotation.set(rx, p._yaw, rz);
      _obj.scale.setScalar(escala);
      _obj.updateMatrix();
      p._mesh.setMatrixAt(p._vaga, _obj.matrix);
      p._mesh.instanceMatrix.needsUpdate = true;
      if (p._comp) {
        p._comp.setMatrixAt(p._vaga, _obj.matrix);
        p._comp.instanceMatrix.needsUpdate = true;
      }
    }
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
   *
   * O `vida = 0` é o que fecha a idempotência, e ele vem ANTES de qualquer
   * outra coisa: entre marcar e animar não pode haver nada que possa falhar e
   * deixar a peça viva com estilhaço já solto.
   *
   * CADA ESPÉCIE CAI DO SEU JEITO, e essa é a segunda metade do pedido:
   *
   *   árvore  tomba em torno da base, 0,9 s, e só então se desfaz em farpas
   *   casa    desaba sobre si mesma, 0,55 s, cuspindo placas de reboco desde já
   *   rocha   lasca no instante do tiro e o toco encolhe em 0,22 s
   *   moita   e capim: um sopro de folha e sumiram, 0,16 s
   *
   * O `scale = 0` seco que existia aqui servia para as três primeiras e não
   * servia para nenhuma: o objeto some entre dois quadros, e o que fica é a
   * impressão de que ele foi APAGADO, não destruído. É a mesma peça de leitura
   * que o estilhaço dá — de que material era a coisa — só que no tempo.
   *
   * Escala zero em vez de remover a instância continua sendo a regra:
   * `InstancedMesh` não tem remoção, e compactar o buffer mudaria as vagas de
   * todas as peças seguintes — ou seja, mudaria a correspondência entre `i` e o
   * que se vê. Quem chega a ela é `finalizarQueda`.
   */
  breakProp(kind, index) {
    const lista = this._porTipo[kind];
    if (!lista) return false;
    const p = lista[index];
    if (!p || p.vida <= 0) return false;

    p.vida = 0;

    if (kind === "arvore") {
      this.enfileirarQueda(p, 1, 0.9, true);
    } else if (kind === "casa") {
      this.enfileirarQueda(p, 2, 0.55, true);
      /* A casa cospe DUAS vezes: a casca no instante do estouro e o resto quando
         o que sobrou assenta. Uma leva só, no fim, faz o desabamento acontecer
         em silêncio e a explosão chegar meio segundo atrasada. */
      this.soltarDetritos(p, p.x, p.y, p.z);
    } else if (kind === "moita" || kind === "capim") {
      this.enfileirarQueda(p, 0, 0.16, true);
    } else {
      /* Rocha estilhaça NA HORA. Ela não cai, ela racha: o estilhaço é o evento,
         e o toco encolhendo atrás dele é só o rescaldo — daí `solta` falso, para
         `finalizarQueda` não soltar uma segunda leva no vazio. */
      this.enfileirarQueda(p, 0, 0.22, false);
      this.soltarDetritos(p, p.x, p.y, p.z);
    }
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

  /** 0 = brisa e sol, 1 = vendaval e fumaça. */
  setStorm(t) {
    this.storm = clamp(t, 0, 1);
    this.uniforms.vento.value = 0.09 + this.storm * 0.5;
    /* A contraluz apaga ANTES do vento chegar ao máximo, e antes do próprio
       disco do sol fechar (`solDisco`, em `sky.js`): o que atravessa uma folha é
       luz DIRETA, e ela é a primeira coisa que uma atmosfera carregada corta —
       o disco ainda se vê muito depois de já não haver mais feixe. O quadrado é
       o que dá essa dianteira sem inventar uma segunda curva para manter em
       sincronia com a de lá. */
    const claro = 1 - this.storm;
    this.uniforms.solLuz.value = claro * claro;
  }

  update(dt, cameraPos, tempoSala = 0) {
    this.relogio = tempoSala > 0 ? (tempoSala / 1000) % 3600 : this.relogio + dt;
    this.uniforms.tempo.value = this.relogio;

    if (!this.pedacos) return;
    this.animarQuedas(dt);

    let mexeu = false;
    for (let i = 0; i < DETRITO_POOL; i++) {
      const f = this.pedacos[i];
      if (!f) continue;
      const receita = this.receitas[i];
      const acabou = passoEstilhaco(f, dt, NAMEK.fighter.gravity, this._chao, receita);
      /* O sumiço é por ESCALA, não por opacidade: o material é opaco (é pedaço
         de pedra), e torná-lo transparente para o fim da vida de um estilhaço
         mudaria a fila de desenho da malha inteira do pool. */
      const k = acabou ? 0 : opacidadeEstilhaco(f, receita) * f.raio;
      _obj.position.set(f.x, f.y, f.z);
      _obj.rotation.set(f.rotX, 0, f.rotZ);
      /* ESCALA NÃO UNIFORME — é ela que dá a silhueta do material, e é por causa
         dela que uma geometria só serve para bloco de pedra, placa de reboco e
         farpa de ajisa. Ver `DETRITO` e o mesmo truque em `fx/pool.js`. */
      const forma = receita.forma;
      _obj.scale.set(k * forma[0], k * forma[1], k * forma[2]);
      _obj.updateMatrix();
      this.detritos.setMatrixAt(i, _obj.matrix);
      mexeu = true;
      if (acabou) {
        this.pedacos[i] = null;
        this.receitas[i] = null;
      }
    }
    if (mexeu) this.detritos.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    /* Geometrias e materiais saem com a raiz do mundo (`disposeSubtree`), que é
       quem tem a lista de exceções dos recursos de módulo. O que se faz aqui é
       soltar as referências, para uma troca de sala não segurar as mil e seiscentas
       peças e o pool de estilhaços vivos. */
    this._props = [];
    this._porTipo = { rocha: [], arvore: [], casa: [], moita: [], capim: [] };
    this.pedacos = null;
    this.receitas = null;
    /* As quedas em curso soltam a peça, e não o contrário: uma troca de sala no
       meio de uma árvore tombando não pode deixar o anel segurando a `prop`, que
       segura a `InstancedMesh`, que segura a geometria do mundo morto. */
    for (const q of this.quedas) q.prop = null;
    this.detritos = null;
    this.malhas = [];
    this.root = null;
  }
}
