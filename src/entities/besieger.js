/* ---------------------------------------------------------------------------
   Os sitiantes — soldado, pavês, esqueleto, escalador, mastim, xamã, ogro e
   catapulta.

   Como o zumbi e o porco, A INTELIGÊNCIA NÃO MORA AQUI: para onde andam, quem
   atacam e quando o escalão vira são decididos em `server/siegeSim.js`. Aqui
   chegam posição, ângulo e estado, e é montado o resto.

   ------------------------------------------------------- o orçamento manda

   O modo tem até 120 vivos ao mesmo tempo — duas vezes e meia o teto do modo
   zumbi. O corpo articulado de `entities/zombie.js` são 874 linhas e uma dúzia
   de `Mesh` por bicho; cento e vinte deles não desenham. Então:

   1. **Uma família só, parametrizada.** Todas as espécies saem do mesmo
      esqueleto de primitivas, com medidas, cores e adereços por espécie. Não
      são oito entidades — é uma, com oito fichas.

   2. **Duas malhas por corpo, fundidas por material.** O corpo inteiro cabe em
      "carne/pano" + "metal/osso", e os membros são grupos que giram sobre a
      geometria já fundida.

   3. **A terceira faixa de LOD não é este arquivo.** Acima de 60 m o bicho sai
      do render e passa a ser uma instância na `InstancedMesh` do
      `systems/siege.js`. Ver o comentário lá.

   E o cenário faz um presente que o orçamento aproveita: o jogador está 11 m
   acima e a horda está a 20–90 m, então a faixa de perto está quase sempre
   vazia por construção. O orçamento fecha por causa da geometria da fase, não
   apesar dela.

   ------------------------------------------------------------------- os olhos

   `MeshBasicMaterial`, como no zumbi, e pelo mesmo motivo: à noite, a 70 m, o
   corpo desaparece e sobram os pontos de luz. É por eles que se conta quantos
   vêm e a que distância — muito antes de dar para mirar em alguma coisa.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { NPC_COLLISION_GROUPS } from "../core/collisionGroups.js";
import { damp } from "../utils/math.js";

/**
 * A ficha de cada espécie.
 *
 * `h` é a altura em metros — é ela que dá a silhueta antes de qualquer detalhe.
 * `olho` é a cor do ponto luminoso, e é a LEITURA À DISTÂNCIA: a 80 m o corpo
 * some e sobram os pontos, então cada espécie tem a sua e o jogador aprende
 * "laranja é ogro" muito antes de conseguir distinguir a forma.
 *
 * `pele` e `metal` são as duas tintas do corpo. Duas, e não uma, porque é o
 * contraste entre elas que separa o que é carne do que é ferro — e é ele que
 * faz o pavês ser um escudo em vez de um bloco.
 */
export const FICHAS = {
  /* O SOLDADO é a régua: tudo o que as outras espécies são se lê em relação a
     ele. Elmo de aba, sobreveste, escudo redondo e lança. */
  soldier: { h: 1.82, pele: "#5b4b38", pano: "#6d3b32", metal: "#8a8d94", olho: 0xffd07a },
  /* O PAVÊS é o soldado ATRÁS de uma porta de madeira. A silhueta é um
     retângulo com pernas — e é para ser: é ela que diz "não adianta atirar de
     frente" sem uma linha de tutorial. */
  shielded: {
    h: 1.8,
    pele: "#4a4238",
    /* O PAVÊS É PINTADO, e a cor não é decoração: é a etiqueta da regra.
       Marrom, ele se confundia com a terra da rampa e com o couro do soldado —
       o jogador não distinguia quem era imune de frente. Azul-cobalto não
       existe em nenhum outro lugar desta fase. */
    pano: "#2b5f8f",
    metal: "#c2c8d0",
    olho: 0xffd07a,
    /** Meias-arestas do escudo, em metros. O colisor é ESTE retângulo. */
    escudo: { hx: 0.42, hy: 0.66, hz: 0.05, y: 0.5, z: 0.32, rx: -0.12 },
  },
  /* O ESQUELETO é vazado. Costelas com ar entre elas, crânio com maxilar, nada
     de pano — é a única espécie em que se enxerga o CÉU através do corpo, e é
     assim que se reconhece um a sessenta metros. */
  skeleton: { h: 1.7, pele: "#d6d0bb", pano: "#a89f88", metal: "#8a8474", olho: 0x8ef0ff },
  /* O ESCALADOR tem os braços mais longos que as pernas. A silhueta é um "A"
     invertido, sempre inclinada para a frente, e no muro ela fica VERTICAL —
     que é a leitura de "aquilo está subindo" contra o céu. */
  climber: { h: 1.62, pele: "#6a4a5c", pano: "#3e2f3c", metal: "#5a4a5a", olho: 0xff5ac0 },
  /* O MASTIM é horizontal. Nenhuma outra espécie é, e por isso ele é o único
     que se identifica pela ORIENTAÇÃO em vez de pela forma. */
  hound: { h: 1.05, pele: "#3a322a", pano: "#241f1a", metal: "#3a3430", olho: 0xff8c28 },
  /* O XAMÃ não tem pernas à vista: o manto vai até o chão e ele parece
     deslizar. Mais o cajado, que é a única linha VERTICAL alta da horda
     inteira — dá para achá-lo no meio de trinta soldados por causa dela. */
  shaman: { h: 1.8, pele: "#22304a", pano: "#2a3a52", metal: "#c8a44a", olho: 0x7affc8 },
  /* O OGRO é largo antes de ser alto: ombros que passam do dobro do quadril,
     cabeça afundada entre eles e uma clava. A 3,4× ele é a única coisa em
     campo que ocupa espaço. */
  ogre: {
    /* BARRA DE VIDA. Só as espécies que pedem mais de dez flechas a têm — ver
       `BesiegerMesh.setHealth` para o critério. */
    barra: true,
    h: 1.9,
    escala: 3.4,
    pele: "#6b6048",
    pano: "#4a3a28",
    metal: "#7a5a3a",
    olho: 0xffaa22,
    lodScale: 3.5,
  },
  /* A CATAPULTA não é gente. Quadro, viga, contrapeso e duas rodas — e ela não
     anda, o que a torna a única silhueta PARADA da rampa. */
  catapult: {
    // Catorze flechas, e ela fica parada a 110 m: a barra é o que diz, do
    // muro, se aquela série de tiros longos está adiantando alguma coisa.
    barra: true,
    h: 2.6,
    pele: "#4a3627",
    pano: "#3a2a1c",
    metal: "#3a3a3e",
    olho: 0xff6a3a,
  },
};

/* Materiais de MÓDULO: nenhum sitiante é tingido individualmente, então
   compartilhar é economia pura — e é o que permite fundir por material. */
const MATS = new Map();
function matDe(cor, opts = {}) {
  const chave = `${cor}|${opts.metalness ?? 0}`;
  let m = MATS.get(chave);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: cor,
      roughness: opts.roughness ?? 0.92,
      metalness: opts.metalness ?? 0.05,
    });
    MATS.set(chave, m);
  }
  return m;
}

const OLHOS = new Map();
function matOlho(cor) {
  let m = OLHOS.get(cor);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: cor });
    OLHOS.set(cor, m);
  }
  return m;
}

/* Geometrias fundidas, uma vez por espécie. É o que separa "cento e vinte
   bichos" de "cento e vinte × uma dúzia de meshes". */
const CACHE = new Map();

/**
 * A marcha de cada espécie.
 *
 * `ritmo` é a frequência do ciclo; `perna` e `braco` a amplitude; `salto` o
 * quanto o corpo sobe no apoio; `balanco` o quanto ele pende para o lado;
 * `inclina` o quanto ele mergulha para a frente. Cinco números por espécie, e é
 * com eles que um esqueleto anda solto e um pavês anda arrastado.
 */
const PASSADA = {
  soldier: { ritmo: 6.2, ritmoAtaque: 4.6, perna: 0.5, braco: 0.34, salto: 0.035, balanco: 0.045, inclina: 0.02, golpe: 1.5 },
  shielded: { ritmo: 4.6, ritmoAtaque: 4.0, perna: 0.32, braco: 0.12, salto: 0.015, balanco: 0.02, inclina: 0.01, golpe: 1.2 },
  skeleton: { ritmo: 8.4, ritmoAtaque: 6.0, perna: 0.78, braco: 0.62, salto: 0.06, balanco: 0.11, inclina: 0.05, golpe: 1.8 },
  climber: { ritmo: 7.4, ritmoAtaque: 5.5, perna: 0.62, braco: 0.7, salto: 0.05, balanco: 0.07, inclina: 0.09, golpe: 1.6 },
  hound: { ritmo: 13.5, ritmoAtaque: 8, perna: 0.85, braco: 0, salto: 0.09, balanco: 0.03, inclina: 0.06, golpe: 1.0 },
  shaman: { ritmo: 3.2, ritmoAtaque: 3.0, perna: 0, braco: 0, salto: 0.02, balanco: 0.05, inclina: 0.0, golpe: 0 },
  ogre: { ritmo: 3.1, ritmoAtaque: 2.4, perna: 0.46, braco: 0.3, salto: 0.075, balanco: 0.13, inclina: 0.04, golpe: 2.1 },
  catapult: { ritmo: 0, ritmoAtaque: 1.2, perna: 0, braco: 0, salto: 0, balanco: 0, inclina: 0, golpe: 0 },
};

/* ------------------------------------------------------------- construção ---

   UM CORPO POR ESPÉCIE, e não um genérico repintado.

   A primeira versão montava o mesmo boneco oito vezes e trocava a cor mais um
   ou dois adereços. Na tela isso lê exatamente como é: oito soldados de cores
   diferentes. O que distingue um esqueleto de um soldado a sessenta metros não
   é a tinta — é a SILHUETA: o esqueleto é vazado, o pavês é um retângulo, o
   xamã é uma coluna com um bastão, o mastim é horizontal, o ogro é largo.

   Cada construtor abaixo devolve as mesmas quatro coisas, e por isso o resto
   do arquivo não sabe qual espécie está montando:

     corpo   geometria fundida na tinta `pele`
     metal   geometria fundida na tinta `metal` (ou null)
     olhos   os pontos emissivos
     perna / braco  as geometrias dos membros ARTICULADOS (ou null)

   O orçamento não mudou: continua sendo uma fusão por material por espécie,
   feita uma vez, compartilhada por todos os indivíduos daquela espécie. */

/** Caixa posicionada e girada, empilhada numa lista para fusão. */
function cx(arr, w, hh, d, x, y, z, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, hh, d);
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  arr.push(g);
}

/** Cilindro em pé (ou deitado, com `rx`). Para hastes, cajados e rodas. */
function cy(arr, rTopo, rBase, alt, x, y, z, rx = 0, rz = 0, lados = 6) {
  const g = new THREE.CylinderGeometry(rTopo, rBase, alt, lados);
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  arr.push(g);
}

const CONSTRUTORES = {
  /* ------------------------------------------------------------ soldado --
     A régua da horda: tronco com sobreveste, elmo de aba, escudo redondo na
     esquerda e lança na direita. */
  soldier(f, pele, pano, metal) {
    const h = f.h;
    cx(pele, 0.4, h * 0.3, 0.24, 0, h * 0.66, 0); // peito
    cx(pano, 0.42, h * 0.22, 0.26, 0, h * 0.54, 0); // sobreveste
    cx(pele, 0.34, h * 0.1, 0.22, 0, h * 0.44, 0); // quadril
    cx(pele, 0.19, 0.2, 0.2, 0, h * 0.87, 0); // cabeça
    // Elmo: calota mais aba. A aba é o que o distingue do esqueleto de longe.
    cy(metal, 0.13, 0.16, 0.16, 0, h * 0.94, 0, 0, 0, 7);
    cx(metal, 0.32, 0.035, 0.32, 0, h * 0.9, 0);
    // Escudo redondo, na esquerda, virado para a frente.
    cy(metal, 0.3, 0.3, 0.07, -0.3, h * 0.62, 0.17, Math.PI / 2, 0, 10);
    // Lança apoiada no ombro direito, inclinada para trás.
    cy(metal, 0.035, 0.035, 2.3, 0.3, h * 0.86, -0.25, 0.34, 0, 5);
    cx(metal, 0.07, 0.26, 0.03, 0.3, h * 0.86 + 1.08, 0.13, 0.34);
  },

  /* -------------------------------------------------------------- pavês --
     O soldado atrás de uma porta de madeira. A silhueta é um retângulo com
     pernas, e é ela que diz "de frente não adianta" sem uma linha de texto. */
  shielded(f, pele, pano, metal) {
    const h = f.h;
    cx(pele, 0.36, h * 0.3, 0.22, 0, h * 0.63, -0.06);
    cx(pano, 0.38, h * 0.2, 0.24, 0, h * 0.5, -0.06);
    cx(pele, 0.18, 0.19, 0.19, 0, h * 0.85, -0.08);
    cy(metal, 0.13, 0.15, 0.15, 0, h * 0.92, -0.08, 0, 0, 7);
    /* O PAVÊS. As medidas saem da FICHA, e não de números soltos aqui: o
       colisor que protege é construído a partir das mesmas (ver
       `BesiegerMesh`). Desenhar por um número e colidir por outro é como o
       escudo passa a proteger o ar ao lado dele. */
    const E = f.escudo;
    cx(pano, E.hx, E.hy, E.hz, 0, h * E.y, E.z, E.rx);
    for (const ty of [-0.42, 0, 0.42]) {
      cx(metal, E.hx * 1.02, 0.045, 0.03, 0, h * E.y + ty, E.z + 0.05, E.rx);
    }
    cx(metal, 0.06, 0.06, 0.06, 0, h * E.y, E.z + 0.08, E.rx); // umbo
  },

  /* --------------------------------------------------------- esqueleto --
     VAZADO. Costelas com ar entre elas, coluna, bacia e crânio com maxilar. É
     a única espécie através da qual se enxerga o céu, e é assim que se
     reconhece um no meio de trinta a sessenta metros. */
  skeleton(f, pele) {
    const h = f.h;
    cy(pele, 0.045, 0.045, h * 0.36, 0, h * 0.66, 0, 0, 0, 5); // coluna
    for (let i = 0; i < 5; i++) {
      const y = h * 0.55 + i * (h * 0.055);
      const w = 0.3 - Math.abs(i - 2) * 0.035;
      cx(pele, w, 0.028, 0.02, 0, y, 0.085);
      cx(pele, w, 0.028, 0.02, 0, y, -0.085);
      cx(pele, 0.022, 0.028, 0.18, w * 0.98, y, 0);
      cx(pele, 0.022, 0.028, 0.18, -w * 0.98, y, 0);
    }
    cx(pele, 0.26, 0.055, 0.13, 0, h * 0.78, 0); // clavícula
    cx(pele, 0.24, 0.1, 0.15, 0, h * 0.46, 0); // bacia
    cx(pele, 0.16, 0.15, 0.17, 0, h * 0.88, 0); // crânio
    cx(pele, 0.13, 0.05, 0.14, 0, h * 0.83, 0.02); // maxilar
  },

  /* --------------------------------------------------------- escalador --
     Braços mais longos que as pernas, tronco inclinado para a frente, garras.
     A silhueta é um "A" invertido e nunca fica ereta. */
  climber(f, pele, pano, metal) {
    const h = f.h;
    cx(pele, 0.34, h * 0.3, 0.26, 0, h * 0.6, 0.06, 0.38); // tronco caído à frente
    cx(pano, 0.3, h * 0.13, 0.22, 0, h * 0.44, 0.02);
    cx(pele, 0.22, 0.16, 0.2, 0, h * 0.79, 0.16); // cabeça baixa, à frente
    // Corcova: o que faz o perfil dele ser reconhecível de lado.
    cx(pele, 0.3, 0.16, 0.24, 0, h * 0.74, -0.11);
    for (const s of [-1, 1]) {
      cx(metal, 0.05, 0.05, 0.19, s * 0.3, h * 0.72, 0.3); // garras
    }
  },

  /* ------------------------------------------------------------ mastim --
     Horizontal. É a única espécie que se identifica pela ORIENTAÇÃO, e por
     isso ela não precisa de detalhe nenhum para funcionar. */
  hound(f, pele, pano) {
    const h = f.h;
    cx(pele, 0.34, 0.36, 1.0, 0, h * 0.6, 0); // tronco comprido
    cx(pele, 0.3, 0.34, 0.34, 0, h * 0.66, -0.6); // garupa
    cx(pele, 0.24, 0.24, 0.4, 0, h * 0.62, 0.62); // pescoço/cabeça
    cx(pele, 0.16, 0.14, 0.22, 0, h * 0.56, 0.86); // focinho
    for (const s of [-1, 1]) cx(pano, 0.05, 0.14, 0.06, s * 0.12, h * 0.76, 0.6); // orelhas
    cy(pele, 0.03, 0.06, 0.6, 0, h * 0.7, -0.85, 1.15, 0, 5); // cauda
    // Espinhaço serrilhado: dá "isto é hostil" à silhueta lisa.
    for (let i = 0; i < 5; i++) {
      cx(pano, 0.04, 0.1, 0.06, 0, h * 0.79, 0.3 - i * 0.22);
    }
  },

  /* -------------------------------------------------------------- xamã --
     Manto até o chão (nenhuma perna à vista — ele DESLIZA) e um cajado que é a
     única linha vertical alta da horda. Dá para achá-lo no meio de trinta
     soldados por causa dela. */
  shaman(f, pele, pano, metal) {
    const h = f.h;
    cy(pano, 0.19, 0.44, h * 0.66, 0, h * 0.33, 0, 0, 0, 8); // manto cônico
    cx(pano, 0.34, h * 0.16, 0.26, 0, h * 0.72, 0); // ombros
    cy(pano, 0.02, 0.17, 0.28, 0, h * 0.9, -0.02, 0, 0, 7); // capuz em bico
    cx(pele, 0.15, 0.13, 0.14, 0, h * 0.82, 0.06); // rosto na sombra do capuz
    // Cajado, na mão direita, mais alto que ele.
    cy(metal, 0.028, 0.028, h * 1.25, 0.34, h * 0.62, 0.05, 0, 0, 5);
    for (const s of [-1, 1]) {
      cx(metal, 0.03, 0.1, 0.03, 0.34 + s * 0.07, h * 1.2, 0.05, 0, s * 0.5);
    }
  },

  /* -------------------------------------------------------------- ogro --
     Largo antes de alto: ombros com o dobro da largura do quadril, cabeça
     afundada entre eles, clava no ombro. A 3,4× ele é a única coisa em campo
     que ocupa espaço. */
  ogre(f, pele, pano, metal) {
    const h = f.h;
    cx(pele, 0.62, h * 0.26, 0.42, 0, h * 0.68, 0); // peitoral
    cx(pele, 0.72, h * 0.12, 0.44, 0, h * 0.78, -0.02); // ombros
    cx(pano, 0.44, h * 0.2, 0.34, 0, h * 0.48, 0); // tanga
    cx(pele, 0.22, 0.2, 0.22, 0, h * 0.88, 0.06); // cabeça, afundada
    cx(pano, 0.24, 0.06, 0.24, 0, h * 0.96, 0.04); // faixa na testa
    for (const s of [-1, 1]) {
      cx(metal, 0.07, 0.16, 0.07, s * 0.16, h * 0.93, 0.16, 0, s * 0.4); // presas
    }
    // A clava, atravessada no ombro direito.
    cy(pano, 0.09, 0.13, 1.5, 0.55, h * 0.86, -0.15, 0, -0.5, 6);
    cx(pano, 0.24, 0.3, 0.24, 0.94, h * 1.2, -0.15);
    for (const s of [-1, 1]) {
      cx(metal, 0.07, 0.09, 0.07, 0.94 + s * 0.2, h * 1.22, -0.15);
    }
  },

  /* --------------------------------------------------------- catapulta --
     Não é gente. Quadro, viga, contrapeso e duas rodas — e ela não anda, o que
     a torna a única silhueta parada da rampa. */
  catapult(f, pele, pano, metal) {
    cx(pele, 1.5, 0.16, 1.9, 0, 0.55, 0); // estrado
    for (const s of [-1, 1]) {
      cx(pele, 0.12, 0.9, 0.12, s * 0.8, 1.3, -0.3, 0, s * 0.22); // cavalete em A
      cy(metal, 0.62, 0.62, 0.17, s * 1.5, 0.62, 0, 0, Math.PI / 2, 9); // rodas
    }
    cx(pele, 0.13, 0.13, 2.6, 0, 2.1, 0.5, 0.42); // viga de arremesso
    cx(metal, 0.3, 0.34, 0.3, 0, 1.5, -0.75); // contrapeso
    cx(pano, 0.9, 0.1, 0.5, 0, 0.72, 0.7); // munição amontoada
  },
};

export function construirGeometrias(kind) {
  if (CACHE.has(kind)) return CACHE.get(kind);
  const f = FICHAS[kind];
  const pele = [];
  const pano = [];
  const metal = [];

  (CONSTRUTORES[kind] ?? CONSTRUTORES.soldier)(f, pele, pano, metal);

  /* `pano` entra na mesma malha de `pele` porque as duas usam materiais
     diferentes e fundir por material é o ponto — mas manter as duas listas
     separadas na construção é o que deixa cada construtor legível. */
  const geo = {
    corpo: pele.length ? mergeGeometries(pele, false) : null,
    pano: pano.length ? mergeGeometries(pano, false) : null,
    metal: metal.length ? mergeGeometries(metal, false) : null,
    perna: membrosDe(kind, f).perna,
    braco: membrosDe(kind, f).braco,
    olhos: olhosGeo(kind, f),
  };
  CACHE.set(kind, geo);
  return geo;
}

/**
 * Os membros ARTICULADOS de cada espécie.
 *
 * Quem não tem devolve null nos dois, e o construtor do corpo já desenhou o
 * que faz as vezes deles: o xamã tem manto, a catapulta tem rodas.
 */
function membrosDe(kind, f) {
  const h = f.h;
  switch (kind) {
    case "shaman":
    case "catapult":
      return { perna: null, braco: null };
    case "hound":
      // Quatro patas, e é o `membros` do `BesiegerMesh` que as distribui.
      return { perna: new THREE.BoxGeometry(0.1, h * 0.5, 0.11), braco: null };
    case "skeleton":
      return {
        perna: new THREE.BoxGeometry(0.075, h * 0.44, 0.08),
        braco: new THREE.BoxGeometry(0.065, h * 0.38, 0.07),
      };
    case "ogre":
      return {
        perna: new THREE.BoxGeometry(0.26, h * 0.46, 0.26),
        braco: new THREE.BoxGeometry(0.22, h * 0.48, 0.22),
      };
    case "climber":
      // Braço mais LONGO que a perna: é a assinatura da espécie.
      return {
        perna: new THREE.BoxGeometry(0.13, h * 0.36, 0.14),
        braco: new THREE.BoxGeometry(0.12, h * 0.5, 0.13),
      };
    default:
      return {
        perna: new THREE.BoxGeometry(0.15, h * 0.42, 0.16),
        braco: new THREE.BoxGeometry(0.13, h * 0.36, 0.14),
      };
  }
}

/**
 * Os pontos luminosos.
 *
 * A 80 m o corpo some na névoa e sobram eles — é por eles que se conta quantos
 * vêm e de que espécie. Por isso a POSIÇÃO deles acompanha a anatomia de cada
 * um: os do mastim ficam à frente e baixos, os da catapulta são um braseiro
 * único e grande, os do esqueleto ficam fundos nas órbitas.
 */
function olhosGeo(kind, f) {
  const h = f.h;
  const g = [];
  const por = {
    hound: { r: 0.04, y: h * 0.64, z: 0.86, sep: 0.07 },
    catapult: { r: 0.13, y: 1.05, z: 0.7, sep: 0 },
    shaman: { r: 0.045, y: h * 0.83, z: 0.12, sep: 0.06 },
    ogre: { r: 0.055, y: h * 0.89, z: 0.16, sep: 0.09 },
    climber: { r: 0.038, y: h * 0.8, z: 0.25, sep: 0.075 },
    skeleton: { r: 0.032, y: h * 0.89, z: 0.07, sep: 0.055 },
  }[kind] ?? { r: 0.035, y: h * 0.88, z: 0.1, sep: 0.07 };

  if (por.sep === 0) {
    // A catapulta tem UM braseiro, não dois olhos: ela não é bicho.
    const e = new THREE.SphereGeometry(por.r, 6, 5);
    e.translate(0, por.y, por.z);
    g.push(e);
  } else {
    for (const s of [-1, 1]) {
      const e = new THREE.SphereGeometry(por.r, 5, 4);
      e.translate(s * por.sep, por.y, por.z);
      g.push(e);
    }
  }
  return mergeGeometries(g, false);
}

/**
 * Onde ficam os membros articulados de cada espécie.
 *
 * `fase` desloca o ciclo da passada: num quadrúpede as quatro patas não batem
 * juntas, e é esse deslocamento que faz um mastim CORRER em vez de saltitar.
 */
function layoutDeMembros(kind, f) {
  const h = f.h;
  if (kind === "hound") {
    const out = [];
    for (const [z, fase] of [[0.42, 0], [-0.42, Math.PI]]) {
      for (const lado of [-1, 1]) {
        out.push({
          x: lado * 0.16,
          y: h * 0.55,
          z,
          lado,
          perna: true,
          fase: fase + (lado > 0 ? Math.PI : 0),
        });
      }
    }
    return out;
  }
  if (kind === "shaman" || kind === "catapult") return [];

  const larguraQuadril = kind === "ogre" ? 0.26 : kind === "skeleton" ? 0.085 : 0.12;
  const larguraOmbro = kind === "ogre" ? 0.62 : kind === "climber" ? 0.3 : 0.26;
  const alturaOmbro = kind === "climber" ? h * 0.72 : h * 0.78;
  const out = [];
  for (const lado of [-1, 1]) {
    out.push({ x: lado * larguraQuadril, y: h * 0.46, z: 0, lado, perna: true });
    out.push({
      x: lado * larguraOmbro,
      y: alturaOmbro,
      z: kind === "climber" ? 0.08 : 0,
      lado,
      perna: false,
      /* O escalador vem com os braços à frente e para baixo, prontos para
         agarrar; o ogro com eles pendendo largos. É a pose de repouso que
         identifica a espécie antes de qualquer animação. */
      rx: kind === "climber" ? -0.9 : kind === "ogre" ? 0.2 : 0,
    });
  }
  return out;
}

export class BesiegerMesh {
  /**
   * @param {THREE.Object3D} parent raiz onde pendurar
   * @param {object} physics mundo de física (a hitbox da flecha)
   * @param {string} entityId id no `entityRegistry`
   * @param {string} kind chave de `FICHAS`
   */
  constructor(parent, physics, entityId, kind, x, y, z) {
    const f = FICHAS[kind] ?? FICHAS.soldier;
    this.kind = kind;
    this.ficha = f;
    this.escala = f.escala ?? 1;
    this.altura = f.h * this.escala;
    this.lodScale = f.lodScale ?? 1;
    this.entityId = entityId;
    this.physics = physics;

    this.dead = false;
    this.burning = false;
    this.state = "walk";
    this.climb = 0;
    this.animPhase = Math.random() * Math.PI * 2;
    this.deathRoll = 0;
    /** 0 = inteiro, 1 = monte de ossos. Só o esqueleto usa. Ver `update`. */
    this.desmonte = 0;

    this.position = new THREE.Vector3(x, y, z);
    this.alvo = new THREE.Vector3(x, y, z);
    this.yaw = Math.PI;
    this.yawAlvo = Math.PI;

    this.group = new THREE.Group();
    this.group.name = `sitiante-${entityId}`;
    this.group.position.copy(this.position);
    parent.add(this.group);
    this.buildMesh();

    /* A hitbox. É o ÚNICO corpo de física de um sitiante: nada de cápsula
       dinâmica, nada de contato entre eles — a separação é resolvida no
       servidor, como no modo zumbi, e por 120 bichos o motivo é ainda mais
       forte. */
    const raio = 0.3 * this.escala;
    const meia = Math.max(0.1, this.altura / 2 - raio);
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.altura / 2, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(meia, raio)
        .setCollisionGroups(NPC_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "besieger", entityId, besieger: this });
    entityRegistry.register(entityId, this);

    /* O ESCUDO É UM COLISOR, não uma conta de ângulo.
     *
     * A primeira versão decidia no servidor: "veio de frente e com pouca
     * elevação ⇒ aparou". Funciona na média e mente no caso: aparava tiros que
     * passavam pela cabeça e deixava passar tiros que batiam na madeira. Num
     * jogo cujo cabeçalho diz que nada da trajetória é simulado "de mentira",
     * a proteção também não pode ser.
     *
     * Agora quem decide é o mesmo solver que decide todo o resto: uma caixa do
     * tamanho exato do escudo, na frente do corpo. A flecha que a atinge crava
     * nela e para; a que passa por cima, por baixo ou pelo lado encontra a
     * cápsula do corpo e machuca. E o jogador aprende a regra vendo, não
     * lendo. */
    if (f.escudo) {
      const E = f.escudo;
      this.shieldBody = physics.createBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + f.h * E.y, z),
      );
      this.shieldCollider = physics.createCollider(
        RAPIER.ColliderDesc.cuboid(E.hx, E.hy, E.hz + 0.03)
          .setCollisionGroups(NPC_COLLISION_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        this.shieldBody,
      );
      physics.register(this.shieldCollider, {
        kind: "besiegerShield",
        entityId,
        besieger: this,
      });
      this.escudo = E;
    }
  }

  buildMesh() {
    const g = construirGeometrias(this.kind);
    const f = this.ficha;
    const raiz = new THREE.Group();

    /** Some no nível 1: detalhe fino. */
    this.lodDetail = [];
    /** Some no nível 2: tudo o que não é silhueta. */
    this.lodBulk = [];

    this.corpo = new THREE.Mesh(g.corpo, matDe(f.pele));
    this.corpo.castShadow = true;
    raiz.add(this.corpo);

    if (g.pano) {
      // Pano e couro: o que separa carne de tecido na silhueta.
      this.pano = new THREE.Mesh(g.pano, matDe(f.pano));
      this.pano.castShadow = true;
      raiz.add(this.pano);
      this.lodBulk.push(this.pano);
    }

    if (g.metal) {
      this.metal = new THREE.Mesh(g.metal, matDe(f.metal, { metalness: 0.55, roughness: 0.5 }));
      this.metal.castShadow = true;
      raiz.add(this.metal);
      this.lodBulk.push(this.metal);
    }

    this.olhos = new THREE.Mesh(g.olhos, matOlho(f.olho));
    // Nunca descartado pelo frustum: são pontos de 3 cm a 70 m, e o teste por
    // caixa envolvente os elimina em ângulos rasantes justamente quando eles
    // são a única coisa visível do bicho. Mesma decisão do zumbi.
    this.olhos.frustumCulled = false;
    this.olhos.renderOrder = 4;
    raiz.add(this.olhos);

    this.membros = [];
    /* A DISTRIBUIÇÃO dos membros é por espécie, e é ela que faz o mastim andar
       como um quadrúpede em vez de como uma pessoa deitada. */
    for (const spec of layoutDeMembros(this.kind, f)) {
      const grupo = new THREE.Group();
      grupo.position.set(spec.x, spec.y, spec.z);
      const geo = spec.perna ? g.perna : g.braco;
      if (!geo) continue;
      const m = new THREE.Mesh(geo, matDe(spec.perna ? f.pano : f.pele));
      m.position.y = -geo.parameters.height / 2;
      m.castShadow = true;
      grupo.add(m);
      grupo.rotation.x = spec.rx ?? 0;
      raiz.add(grupo);
      this.membros.push({ g: grupo, lado: spec.lado, perna: spec.perna, base: spec.rx ?? 0, fase: spec.fase ?? 0 });
      this.lodBulk.push(grupo);
    }

    if (this.escala !== 1) raiz.scale.setScalar(this.escala);
    /* O tronco de quem se curva fica curvado no REPOUSO, não só na animação:
       é a pose que identifica a espécie parada. */
    if (this.kind === "climber") raiz.rotation.x = 0.16;
    this.group.add(raiz);
    this.visualRoot = raiz;
  }

  /** A pose que chegou do servidor. */
  setNetworkTarget(x, y, z, yaw, state, burning) {
    this.alvo.set(x, y, z);
    this.yawAlvo = yaw;
    this.state = state;
    this.burning = burning;
  }

  killLocal(fogo = false) {
    if (this.dead) return;
    this.dead = true;
    this.burning = fogo;
    if (this.collider) this.collider.setEnabled(false);
    if (this.shieldCollider) this.shieldCollider.setEnabled(false);
  }

  reviveLocal() {
    if (!this.dead) return;
    this.dead = false;
    this.deathRoll = 0;
    /* `desmonte` NÃO é zerado aqui: é ele que anima a remontagem. Zerado, o
       monte de ossos viraria um esqueleto de pé num quadro só — que é
       exatamente o salto que a pilha existe para evitar. `update` o traz de
       volta a zero em meio segundo. */
    this.group.rotation.set(0, 0, 0);
    if (this.collider) this.collider.setEnabled(true);
    if (this.shieldCollider) this.shieldCollider.setEnabled(true);
  }

  setVisible(v) {
    if (this.group.visible === v) return;
    this.group.visible = v;
  }

  /**
   * A VIDA, e quem ganha barra por causa dela.
   *
   * Só as espécies GRANDES — o ogro e a catapulta —, e o critério é o número de
   * flechas: elas pedem catorze e dezesseis, contra uma a três de todo o resto.
   * Abaixo disso a barra não responde pergunta nenhuma, porque não há pergunta:
   * o soldado morre no segundo tiro e ninguém precisa de um medidor para saber
   * disso. No ogro a pergunta existe o tempo todo — "dá tempo de derrubar antes
   * que ele chegue?" — e é ela que decide se vale continuar gastando flecha
   * nele ou voltar para a fila do portão.
   *
   * A barra nasce SOB DEMANDA, no primeiro dano. Um ogro intacto não tem barra:
   * cheia, ela só ocuparia o quadro dizendo o que já se sabe.
   */
  setHealth(hp) {
    this.hp = hp;
    if (!this.ficha.barra) return;
    if (hp >= 0.999) {
      if (this.barra) this.barra.visible = false;
      return;
    }
    if (!this.barra) this.buildBarra();
    this.barra.visible = !this.dead;
    this.barraFill.scale.x = Math.max(0.001, hp);
    // Verde → âmbar → vermelho. A cor é a leitura periférica: quem está mirando
    // outra coisa vê a barra ficar vermelha sem precisar medir o comprimento.
    this.barraFill.material.color.setHSL(0.33 * hp, 0.82, 0.46);
  }

  buildBarra() {
    const larg = 1.5 * this.escala * 0.55;
    const alt = 0.13 * this.escala * 0.55;
    const G = new THREE.Group();
    G.position.set(0, this.altura + 0.55 * this.escala * 0.55, 0);

    const fundo = new THREE.Mesh(
      new THREE.PlaneGeometry(larg, alt),
      new THREE.MeshBasicMaterial({
        color: 0x0a0c12,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    fundo.renderOrder = 8;

    // Cresce da esquerda: o plano é deslocado meia unidade para a escala em x
    // não abrir para os dois lados a partir do centro.
    const geo = new THREE.PlaneGeometry(larg * 0.96, alt * 0.7);
    geo.translate((larg * 0.96) / 2, 0, 0);
    this.barraFill = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x66cc44, transparent: true, depthWrite: false }),
    );
    this.barraFill.position.set(-(larg * 0.96) / 2, 0, 0.01);
    this.barraFill.renderOrder = 9;

    G.add(fundo, this.barraFill);
    this.barra = G;
    this.group.add(G);
  }

  /**
   * ESTE xamã está num mirante — e por isso precisa ser VISTO de noventa metros.
   *
   * O mago das torres é o único sitiante do modo que nasce fora do alcance em
   * que o jogo desenha um corpo inteiro, e é também o único que o jogador
   * precisa achar SEM que nada o obrigue a olhar para lá: a bola dele sai a cada
   * dezoito segundos, e entre uma e outra o mirante é só uma silhueta de madeira
   * no fundo da rampa. Ele estava perdendo as duas coisas que o denunciam — o
   * cajado dourado (some no LOD 2) e o contraste (azul-marinho contra bosque
   * noturno) —, e o resultado era uma ameaça que só se localizava pela bola já
   * no ar, quando o que se pode fazer é desviar e não revidar.
   *
   * Duas mudanças, e nenhuma delas toca no resto da horda:
   *
   * • as FAIXAS DE LOD dele são multiplicadas (`mageLod`), então o corpo
   *   articulado — cajado incluído — continua desenhado a essa distância. São
   *   dois corpos a mais no quadro, porque são dois mirantes;
   * • um FACHO no alto do cajado, na cor da bola que ele atira. É o que o torna
   *   achável num relance, e é o que ensina, sem uma linha de texto, de onde a
   *   próxima bola vem.
   */
  virarMagoDeTorre() {
    if (this._facho) return;
    const B = CONFIG.modes.siege.mageBeacon;
    this.lodScale = CONFIG.modes.siege.mageLod;

    const F = new THREE.Group();
    /* O TOPO DO CAJADO. A haste é um cilindro de `h × 1,25` centrado em
       `h × 0,62` (ver `CONSTRUTORES.shaman`), então a ponta está em
       `0,62 h + 0,625 h`; o `x` é o da mão direita. */
    const h = this.ficha.h;
    F.position.set(0.34, h * 1.245 + B.raio * 0.6, 0.05);

    /* Núcleo BASIC, e não emissivo: `MeshBasicMaterial` não é tocado pela luz
       da cena, então o facho tem o mesmo brilho na noite fechada e sob o clarão
       do incêndio do portão. É o mesmo material da própria bola em
       `SiegeSystem.onShot`, pelo mesmo motivo. */
    this.fachoNucleo = new THREE.Mesh(
      new THREE.SphereGeometry(B.raio, 10, 8),
      new THREE.MeshBasicMaterial({ color: B.nucleoCor }),
    );
    this.fachoNucleo.renderOrder = 5;
    F.add(this.fachoNucleo);

    this.fachoHalo = new THREE.Mesh(
      new THREE.SphereGeometry(B.raio * B.halo, 10, 8),
      new THREE.MeshBasicMaterial({
        color: B.cor,
        transparent: true,
        opacity: B.opacidade,
        /* `depthWrite: false` com o teste de profundidade LIGADO: o facho é
           aditivo e não pode tapar o que está atrás dele, mas TEM de ser tapado
           pelo merlão e pela própria torre. Um ponto verde atravessando a
           alvenaria seria pior que nenhum — diria que o mago está onde não
           está. */
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.fachoHalo.renderOrder = 5;
    F.add(this.fachoHalo);

    /* Nunca descartado pelo frustum, pela mesma razão dos olhos: a caixa
       envolvente do grupo o elimina em ângulos rasantes justamente quando ele é
       a única coisa que se vê do bicho. */
    F.frustumCulled = false;
    this.fachoNucleo.frustumCulled = false;
    this.fachoHalo.frustumCulled = false;

    this._facho = F;
    this._fachoFase = Math.random() * Math.PI * 2;
    /* Entra na RAIZ VISUAL e não em `group`: assim ele acompanha o balanço e a
       escala do corpo, e desmonta junto quando o mago cai. */
    (this.visualRoot ?? this.group).add(F);
  }

  update(dt, camera = null) {
    /* A barra encara a câmera. Ela é um billboard de duas malhas planas — o
       billboard mais barato que existe, sem textura e sem elemento de DOM. */
    if (this.barra?.visible && camera) this.barra.quaternion.copy(camera.quaternion);

    /* O facho RESPIRA. Um ponto parado a noventa metros lê como pixel queimado
       do monitor; um que muda de tamanho lê como coisa acesa. E ele se apaga
       com o dono: um mago morto não continua marcando o mirante — é justamente
       a ausência dele que diz que a torre está calada. */
    if (this._facho) {
      const B = CONFIG.modes.siege.mageBeacon;
      this._facho.visible = !this.dead;
      if (!this.dead) {
        this._fachoFase += dt * B.pulso * Math.PI * 2;
        const p = 1 + Math.sin(this._fachoFase) * B.pulsoAmp;
        this.fachoHalo.scale.setScalar(p);
        this.fachoHalo.material.opacity = B.opacidade * (0.8 + (p - 1));
      }
    }

    /* Interpolação para a pose de 10 Hz. `damp` e não `lerp` porque o passo do
       quadro varia: com `lerp` o bicho anda mais rápido em quem tem 144 Hz. */
    this.position.x = damp(this.position.x, this.alvo.x, 14, dt);
    this.position.y = damp(this.position.y, this.alvo.y, 14, dt);
    this.position.z = damp(this.position.z, this.alvo.z, 14, dt);
    this.group.position.copy(this.position);

    let d = this.yawAlvo - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw = damp(this.yaw, this.yaw + d, 12, dt);
    this.group.rotation.y = this.yaw;

    /* O ESQUELETO DESMONTA em vez de tombar.
     *
     * `bones` é o estado em que ele está caído mas ainda vai voltar (ver
     * `Siege.atualizarCaido`). O corpo é uma malha fundida só, então não há
     * osso individual para espalhar — mas não é preciso: achatar a escala em Y
     * e alargar em XZ produz exatamente a leitura de "aquilo desabou num
     * monte", e o caminho de volta é a mesma interpolação ao contrário.
     *
     * A diferença entre desmontar e tombar é a informação que o jogador
     * precisa: um corpo tombado acabou; uma pilha de ossos é um relógio. */
    const montinho = this.state === "bones";
    if (montinho || (this.dead && this.kind === "skeleton")) {
      this.desmonte = Math.min(1, (this.desmonte ?? 0) + dt * 4);
    } else if (this.desmonte > 0) {
      this.desmonte = Math.max(0, this.desmonte - dt * 2.2);
    }

    if (this.desmonte > 0 && this.visualRoot) {
      const d = this.desmonte;
      this.visualRoot.scale.set(
        this.escala * (1 + d * 0.55),
        this.escala * (1 - d * 0.86),
        this.escala * (1 + d * 0.55),
      );
      // Um giro fixo por indivíduo: dois montes idênticos lado a lado leem
      // como cópia, e a horda tem muitos.
      this.visualRoot.rotation.z = d * (this._giroOsso ??= (Math.random() * 2 - 1) * 0.5);
      this.group.position.y = this.position.y;
      if (montinho) return;
    }

    if (this.dead) {
      // Tomba para a frente e fica. Sete segundos de corpo no chão é o que
      // separa "aquilo morreu" de "aquilo sumiu" numa horda desta densidade.
      this.deathRoll = Math.min(1, this.deathRoll + dt * 2.6);
      this.group.rotation.x = this.deathRoll * (Math.PI / 2 - 0.15);
      this.group.position.y = this.position.y + this.deathRoll * 0.1;
      return;
    }
    this.group.rotation.x = 0;

    if (this.body) {
      this.body.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y + this.altura / 2,
        z: this.position.z,
      });
    }
    if (this.shieldBody) {
      /* O escudo anda À FRENTE do corpo, no rumo em que ele olha. Sem girar
         junto, o pavês protegeria o norte enquanto o dono anda para o sul. */
      const E = this.escudo;
      const sy = Math.sin(this.yaw);
      const cyaw = Math.cos(this.yaw);
      this.shieldBody.setNextKinematicTranslation({
        x: this.position.x + sy * E.z,
        y: this.position.y + this.ficha.h * E.y,
        z: this.position.z + cyaw * E.z,
      });
      this.shieldBody.setNextKinematicRotation({
        x: 0,
        y: Math.sin(this.yaw / 2),
        z: 0,
        w: Math.cos(this.yaw / 2),
      });
    }

    this.animar(dt);
  }

  /**
   * A ANDADURA é por espécie, e é metade do que distingue um do outro.
   *
   * Duas silhuetas iguais com marchas diferentes se distinguem; duas silhuetas
   * diferentes com a mesma marcha, não — o olho lê movimento antes de forma.
   * Então:
   *
   *   soldado    passada firme e regular, braço contrário à perna
   *   pavês      passo curto, arrastado, o corpo quase não oscila
   *   esqueleto  passada larga e SOLTA, com o tronco jogando junto
   *   escalador  quatro apoios: os braços entram no ciclo como pernas
   *   mastim     galope — as patas em dois pares, e o lombo subindo junto
   *   ogro       lento, pesado, com o corpo pendendo de um lado ao outro
   */
  animar(dt) {
    const andando = this.state === "walk" || this.state === "rise";
    const atacando = this.state === "attack";
    const subindo = this.state === "climb";
    const P = PASSADA[this.kind] ?? PASSADA.soldier;

    if (andando) this.animPhase += dt * P.ritmo;
    else if (atacando || subindo) this.animPhase += dt * P.ritmoAtaque;

    const s = Math.sin(this.animPhase);
    const raiz = this.visualRoot;

    /* O BALANÇO DO CORPO. É o que separa "as pernas se mexem" de "aquilo
       anda": o tronco sobe no apoio e pende para o lado do pé que sustenta. */
    if (raiz && andando) {
      raiz.position.y = Math.abs(s) * P.salto;
      raiz.rotation.z = s * P.balanco;
      raiz.rotation.x = (this.kind === "climber" ? 0.16 : 0) + Math.abs(s) * P.inclina;
    } else if (raiz) {
      raiz.position.y = 0;
      raiz.rotation.z = 0;
      raiz.rotation.x = this.kind === "climber" ? 0.16 : 0;
    }

    for (const m of this.membros) {
      const fase = Math.sin(this.animPhase + (m.fase ?? 0));
      if (m.perna) {
        m.g.rotation.x = andando ? fase * m.lado * P.perna : 0;
      } else if (subindo) {
        // Braçadas alternadas: a leitura de que ele está SUBINDO, e não parado
        // pendurado, tem de existir de longe.
        m.g.rotation.x = -1.5 + fase * m.lado * 0.85;
      } else if (atacando) {
        /* O GOLPE não é um balanço: sobe devagar e desce de uma vez. Uma
           senoide simples lia como aceno. `pow` na subida faz a diferença. */
        const t = (Math.sin(this.animPhase) + 1) / 2;
        m.g.rotation.x = m.base - 0.5 - Math.pow(t, 3) * P.golpe;
      } else {
        m.g.rotation.x = m.base + (andando ? -fase * m.lado * P.braco : 0);
      }
    }
  }

  dispose() {
    /* O facho tem geometria e material PRÓPRIOS — não vêm do cache de espécie
       (`CACHE`), que é liberado uma vez só no fim da fase. Sem isto, cada mago
       que morre e volta deixa duas esferas na GPU, e o mirante repõe um a cada
       três minutos por dez minutos de partida. */
    for (const m of [this.fachoNucleo, this.fachoHalo]) {
      m?.geometry?.dispose();
      m?.material?.dispose();
    }
    this.fachoNucleo = null;
    this.fachoHalo = null;
    this._facho = null;

    entityRegistry.unregister?.(this.entityId);
    this.physics?.removeBody(this.shieldBody);
    this.shieldBody = null;
    this.shieldCollider = null;
    this.physics?.removeBody(this.body);
    this.group?.parent?.remove(this.group);
    this.body = null;
    this.collider = null;
    this.group = null;
    this.membros = [];
  }
}

/** Libera as geometrias de módulo. Chamado só no descarte da fase. */
export function disposeBesiegerCache() {
  for (const g of CACHE.values()) {
    g.corpo?.dispose();
    g.metal?.dispose();
    g.perna?.dispose();
    g.braco?.dispose();
    g.olhos?.dispose();
  }
  CACHE.clear();
}
