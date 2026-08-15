/* ---------------------------------------------------------------------------
   PEDRAS PEQUENAS E ESTILHAÇO.

   O pedido do jogador tem duas metades — "sair poeira E pedras pequenas" — e
   elas resolvem problemas diferentes. A poeira diz que houve um impacto; a pedra
   diz de que TAMANHO ele foi. Uma nuvem grande e uma nuvem pequena são a mesma
   imagem em escalas diferentes, e o olho não estima escala em nuvem nenhuma. Já
   três seixos voando contra trinta pedregulhos é uma diferença que se conta.

   ------------------------------------------------------------------- balística

   Analítica, contra `field.heightAt`. Sem Rapier — §4 do plano, e aqui a razão é
   ainda mais direta que para o lutador: são duzentas e oitenta e oito lascas
   simultâneas, cada uma vivendo três segundos. Isso é broad-phase, colisor,
   evento e alocação para desenhar uma pedra de meio metro que o jogador vê por
   dois segundos e nunca mais. A integração explícita cabe em vinte linhas, é
   determinística e custa uma multiplicação por eixo.

   Gravidade é `NAMEK.fighter.gravity` — a MESMA do lutador, e isso não é
   economia de constante: se a pedra caísse com outra gravidade que o corpo que a
   arremessou, o planeta teria dois pesos, e essa é justamente a incoerência que
   o olho pega sem saber nomear.

   ------------------------------------------------------------------- um quique

   E só um. A segunda batida é o repouso. Foi tentado deixar quicar até parar
   sozinha e o resultado é conhecido: pedra em terreno inclinado nunca para, ela
   desce a encosta pelo resto da vida útil e vira uma bolinha de pinball no meio
   da luta. Um quique é o que o olho espera de uma pedra que caiu; o resto é
   ruído em movimento.

   ------------------------------------------------------ por que ela some assim

   Lasca pousada não pode ficar: em dez minutos de partida o chão da clareira
   teria três mil pedras e o pool inteiro estaria preso em entulho parado, sem
   vaga para o próximo impacto. Ela AFUNDA e encolhe ao mesmo tempo, e afundar é
   metade do truque — a malha do terreno a engole, então o que se vê é uma pedra
   assentando na poeira, e não um objeto sumindo no ar.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { decodeCor } from "./pool.js";

/** s — quanto a lasca fica parada no chão antes de começar a afundar. */
const DESCANSO = 1.1;
/** s — quanto dura o afundamento. */
const SUMICO = 0.65;
/** m — quanto a lasca anda na horizontal antes de a cota do chão ser reamostrada. */
const PASSO_CHAO = 1.2;
/** m/s — abaixo disto a lasca não quica, assenta. */
const QUIQUE_MINIMO = 1.6;

/* As paletas. Cada material tem TRÊS tons porque estilhaço de uma cor só lê como
   confete: o que faz um monte de cacos parecer pedra quebrada é uns serem mais
   claros que os outros, exatamente como as faces de uma rocha real pegam luz
   diferente. */
const PALETA = {
  /* O chão de Namekusei: verde acinzentado, escuro. */
  chao: [0x5f6d58, 0x76856c, 0x4a5545],
  /* Rocha do cenário — a mesma família, um degrau mais fria. */
  rocha: [0x6b7a63, 0x55634f, 0x808d76],
  /* Casa namekuseijin: reboco branco. Placas, não seixos. */
  casa: [0xe8e4d8, 0xd4d0c0, 0xf3f0e7],
  /* Ajisa: a árvore de Namekusei. Lascas claras, puxando para o verde-oliva. */
  arvore: [0xa9a067, 0x87874e, 0xc0b483],
};

/* A SILHUETA de cada material, como escala nos três eixos da lasca padrão.
   Uma geometria só, três leituras — ver o cabeçalho de `ChipPool`. */
const FORMA = {
  chao: [1.0, 0.85, 1.1],
  rocha: [1.0, 0.9, 1.05],
  /* Placa: fina em Y, larga em XZ. É reboco arrancado da parede. */
  casa: [1.15, 0.16, 0.95],
  /* Farpa: comprida em Z, magra no resto. */
  arvore: [0.22, 0.24, 1.75],
};

const _rgb = new Float32Array(3);
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

const entre = (a, b) => a + Math.random() * (b - a);

/**
 * Solta uma leva de lascas.
 *
 * @param {import("./pool.js").ChipPool} pool
 * @param {string} material chave de `PALETA`/`FORMA`
 * @param {number} n        quantas
 * @param {number} tam      lado típico (m)
 * @param {number} vel      velocidade de saída (m/s)
 * @param {number} espalha  m — raio em torno do ponto onde elas nascem
 * @param {number} vida     s
 * @param {number} chaoY    cota do chão sob o ponto
 */
function soltar(pool, material, x, y, z, n, tam, vel, espalha, vida, chaoY) {
  const cores = PALETA[material] ?? PALETA.chao;
  const forma = FORMA[material] ?? FORMA.chao;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    /* ELEVAÇÃO ENTRE 35° E 78°, e nunca rasante. Uma lasca lançada quase na
       horizontal viaja quarenta metros antes de encostar no chão e some do campo
       de visão sem nunca ter sido lida como pedra — o que aparece na tela é um
       risco passando. O que se quer é o arco: sobe, gira e cai perto. */
    const elev = entre(0.61, 1.36);
    const cosE = Math.cos(elev);
    const sinE = Math.sin(elev);
    const v = vel * entre(0.55, 1.25);
    const t = tam * entre(0.6, 1.45);
    const c = cores[(Math.random() * cores.length) | 0];
    decodeCor(c, _rgb);
    const brilho = entre(0.82, 1.14);
    const d = espalha * Math.sqrt(Math.random());
    if (
      !pool.spawn(
        x + Math.cos(a) * d,
        y + entre(0.15, 0.9) * tam + 0.1,
        z + Math.sin(a) * d,
        Math.cos(a) * cosE * v,
        sinE * v,
        Math.sin(a) * cosE * v,
        _rgb[0] * brilho,
        _rgb[1] * brilho,
        _rgb[2] * brilho,
        t * forma[0],
        t * forma[1],
        t * forma[2],
        vida * entre(0.85, 1.2),
        /* A farpa e a placa RODOPIAM mais que o seixo: coisa chata gira rápido
           porque tem pouca inércia num eixo, e é esse rodopio que faz uma placa
           branca ser reconhecida como placa em pleno voo. */
        material === "chao" || material === "rocha" ? 7 : 13,
        entre(0.24, 0.46),
        chaoY,
      )
    ) {
      return;
    }
  }
}

/**
 * As pedras de um impacto de golpe no chão.
 *
 * Contagem e tamanho saem do raio da cratera, pelo mesmo motivo da poeira: é a
 * grandeza que já passou pela raiz quadrada de `craterFor` e é a que mantém a
 * bola de ki num punhado de cascalho enquanto a Genki Dama arremessa
 * pedregulhos de metro e meio.
 */
export function pedrasDeImpacto(pool, x, y, z, raio, fator, tamFator) {
  /* Teto de 40, pelo mesmo motivo dos tetos de `poeiraDeImpacto`: o buraco de
     encosta é 60 % maior e a Genki Dama numa parede pedia 58 lascas de um pool
     de 288 — três delas tomariam dois terços dele. O maior golpe em terreno
     plano pede 37 e não encosta no teto, então nada do que já existia mudou. */
  const n = Math.min(40, Math.max(2, Math.round((3 + raio * 1.15) * fator)));
  const tam = (0.16 + raio * 0.055) * tamFator;
  const vel = 6 + raio * 0.95;
  soltar(pool, "chao", x, y, z, n, tam, vel, raio * 0.35, 2.4 + raio * 0.04, y);
}

/**
 * O NACO DE MONTANHA: os blocos grandes que saem de uma encosta atingida.
 *
 * É a metade visível do pedido *"as montanhas... devem explodir parte dela"*. A
 * outra metade é o campo de altura, e ela já está feita (`esculpirNaco`, em
 * `shared/namek/field.js`) — só que o buraco no terreno é uma coisa que o
 * jogador descobre DEPOIS, quando a poeira baixa. O que ele vê ACONTECER é isto.
 *
 * Três coisas separam esta leva da de `pedrasDeImpacto`, e as três são a mesma
 * decisão vista de ângulos diferentes: o que voa aqui é MATÉRIA DA MONTANHA, não
 * cascalho levantado.
 *
 * • **São poucas e enormes.** Nove blocos de dois metros e meio, contra vinte e
 *   sete pedras de trinta centímetros. Trinta pedrinhas a mais não somam escala
 *   nenhuma — o olho não conta partícula —, mas um bloco do tamanho de um
 *   lutador passando pela tela é uma medida que ele lê na hora.
 * • **Elas saem MORRO ABAIXO.** O naco não sobe: ele se solta e desce. A direção
 *   é o versor horizontal da normal do terreno, que aponta para o vale por
 *   construção, e a elevação é baixa — entre 12° e 50°, contra os 35° a 78° de
 *   uma explosão comum. O que se vê é material despencando pela encosta.
 * • **Elas vivem mais.** Um bloco lançado ladeira abaixo tem uma ladeira inteira
 *   para descer, e cortá-lo em dois segundos e meio seria apagá-lo no meio da
 *   queda, que é a parte que interessa.
 *
 * A cor vem da paleta da ROCHA, e não do chão: o que a montanha mostra quando
 * perde um pedaço é a pedra de dentro, não a grama de fora.
 *
 * @param {number} dx,dz versor horizontal morro abaixo
 */
export function nacoDeEncosta(pool, x, y, z, raio, dx, dz, fator, tamFator, chaoY) {
  const n = Math.max(3, Math.round((3 + raio * 0.28) * fator));
  const tam = (0.35 + raio * 0.1) * tamFator;
  const vel = 7 + raio * 0.6;
  const cores = PALETA.rocha;
  const forma = FORMA.rocha;

  for (let i = 0; i < n; i++) {
    /* O leque em torno da descida: ±50°, e não os 360° de uma explosão. Um naco
       que saísse para o lado do morro entraria na montanha no primeiro quadro. */
    const a = Math.atan2(dz, dx) + entre(-0.88, 0.88);
    const elev = entre(0.21, 0.88);
    const cosE = Math.cos(elev);
    const sinE = Math.sin(elev);
    const v = vel * entre(0.6, 1.3);
    /* Bloco grande e IRREGULAR no tamanho: a leva tem de ter um pedaço grande
       demais e dois pequenos, senão os nove viram nove cópias da mesma pedra e a
       repetição denuncia o pool. */
    const t = tam * entre(0.45, 1.7);
    const c = cores[(Math.random() * cores.length) | 0];
    decodeCor(c, _rgb);
    const brilho = entre(0.78, 1.16);
    if (
      !pool.spawn(
        x + Math.cos(a) * raio * 0.3 * Math.random(),
        y + entre(0.2, 1.1) * tam,
        z + Math.sin(a) * raio * 0.3 * Math.random(),
        Math.cos(a) * cosE * v,
        sinE * v,
        Math.sin(a) * cosE * v,
        _rgb[0] * brilho,
        _rgb[1] * brilho,
        _rgb[2] * brilho,
        t * forma[0],
        t * forma[1],
        t * forma[2],
        3.2 + raio * 0.06,
        /* Rodopio LENTO. Um bloco de dois metros girando como um seixo perde o
           peso na hora: massa grande, inércia grande, e o olho sabe disso sem
           precisar que ninguém lhe explique. */
        3.4,
        entre(0.18, 0.34),
        chaoY,
      )
    ) {
      return;
    }
  }
}

/**
 * As pedras de uma QUEDA. Menos e mais rasteiras que as de um golpe.
 *
 * Um corpo caindo desloca material; não o vaporiza. A diferença entre esta leva
 * e a de cima é a que separa "alguém pousou pesado" de "explodiu aqui" — e essa
 * distinção precisa sobreviver ao fato de as duas usarem o mesmo pool.
 */
export function pedrasDeQueda(pool, x, y, z, raio, fator, tamFator) {
  const n = Math.max(2, Math.round((2 + raio * 0.7) * fator));
  const tam = (0.13 + raio * 0.038) * tamFator;
  const vel = 4.5 + raio * 0.65;
  soltar(pool, "chao", x, y, z, n, tam, vel, raio * 0.45, 2.0 + raio * 0.03, y);
}

/**
 * Um objeto do cenário que morreu: ele vira estilhaço.
 *
 * O ESTILHAÇO HERDA O OBJETO — cor e tamanho —, e essa regra é a mesma que
 * `systems/impactFx.js` já defende do lado do arqueiro: o material que voa é o
 * material do ALVO. É isso que faz o jogador saber que derrubou uma casa mesmo
 * quando a casa estava longe demais para ser identificada. Rocha estilhaça em
 * pedras angulosas escuras, casa em placas brancas de reboco, ajisa em lascas
 * claras e compridas.
 */
export function estilhacarProp(pool, kind, x, y, z, raio, fator, tamFator, chaoY) {
  const material = kind === "casa" || kind === "arvore" ? kind : "rocha";
  /* A CASA DÁ MAIS CACOS. Uma parede é uma superfície: ela se despedaça em muitas
     peças finas. Uma rocha é um volume: quebra em poucos blocos grandes. Igualar
     as contagens faria os dois materiais soarem iguais. */
  const densidade = material === "casa" ? 3.4 : material === "arvore" ? 2.2 : 1.9;
  const n = Math.max(3, Math.round((3 + raio * densidade) * fator));
  const tam = raio * (material === "casa" ? 0.3 : material === "arvore" ? 0.36 : 0.26) * tamFator;
  const vel = 4 + raio * 2.4;
  /* `chaoY` vem do campo de altura, e não do `y` do objeto, porque `y` aqui é o
     ponto em que a coisa QUEBROU — o meio de uma casa, o tronco de uma ajisa a
     três metros do solo. Um caco que assentasse nessa cota ficaria pousado no
     ar, no lugar onde a parede estava. */
  soltar(pool, material, x, y, z, n, tam, vel, raio * 0.5, 2.2 + raio * 0.1, chaoY);
}

/**
 * A integração de todas as lascas vivas.
 *
 * @param {import("./pool.js").ChipPool} pool
 * @param {object|null} field campo de altura
 * @param {number} corte2 distância² da câmera acima da qual a lasca é apagada
 */
export function atualizarDetritos(pool, dt, field, camX, camY, camZ, corte2) {
  const g = NAMEK.fighter.gravity;

  for (let i = pool.live - 1; i >= 0; i--) {
    pool.age[i] += dt;
    if (pool.age[i] >= pool.life[i]) {
      pool.swapRemove(i);
      continue;
    }
    const i3 = i * 3;
    const estado = pool.estado[i];

    if (estado < 2) {
      pool.vel[i3 + 1] += g * dt;
      pool.pos[i3] += pool.vel[i3] * dt;
      pool.pos[i3 + 1] += pool.vel[i3 + 1] * dt;
      pool.pos[i3 + 2] += pool.vel[i3 + 2] * dt;
      pool.rot[i3] += pool.rotVel[i3] * dt;
      pool.rot[i3 + 1] += pool.rotVel[i3 + 1] * dt;
      pool.rot[i3 + 2] += pool.rotVel[i3 + 2] * dt;

      /* A COTA SÓ É REAMOSTRADA QUANDO VALE A PENA — e "quando vale a pena" tem
         três condições, porque `heightAt` é a função mais chamada do modo e uma
         lasca a pediria sessenta vezes por segundo pelos três segundos de voo.
         Com 288 lascas isso seriam 17 mil FBM por segundo só para desenhar
         cascalho.

         • SUBINDO NÃO INTERESSA. Enquanto a lasca sobe ela não pode encostar no
           chão, e a cota que ela vai precisar é a de onde ela vai CAIR, não a de
           onde ela está passando. É a metade do voo, cortada de graça.
         • LONGE DO CHÃO TAMBÉM NÃO. Acima de oito metros da última cota
           conhecida não há colisão possível no próximo quadro, seja qual for o
           relevo por baixo.
         • E, dentro disso, só quando a lasca andou mais de `PASSO_CHAO` na
           horizontal: o terreno é liso na escala de um metro. */
      if (
        field &&
        pool.vel[i3 + 1] <= 0 &&
        pool.pos[i3 + 1] - pool.chao[i] < 8
      ) {
        const dx = pool.pos[i3] - pool.chaoX[i];
        const dz = pool.pos[i3 + 2] - pool.chaoZ[i];
        if (dx * dx + dz * dz > PASSO_CHAO * PASSO_CHAO) {
          pool.chaoX[i] = pool.pos[i3];
          pool.chaoZ[i] = pool.pos[i3 + 2];
          pool.chao[i] = field.heightAt(pool.pos[i3], pool.pos[i3 + 2]);
        }
      }

      const solo = pool.chao[i];
      if (pool.pos[i3 + 1] <= solo && pool.vel[i3 + 1] <= 0) {
        pool.pos[i3 + 1] = solo;
        const vy = -pool.vel[i3 + 1];
        if (estado === 0 && vy > QUIQUE_MINIMO) {
          pool.estado[i] = 1;
          pool.vel[i3 + 1] = vy * pool.quique[i];
          /* Atrito do toque: ela perde quase metade do avanço horizontal.
             Manter a velocidade lateral faria a pedra RASGAR o chão em vez de
             bater nele. */
          pool.vel[i3] *= 0.52;
          pool.vel[i3 + 2] *= 0.52;
          pool.rotVel[i3] *= 0.55;
          pool.rotVel[i3 + 1] *= 0.55;
          pool.rotVel[i3 + 2] *= 0.55;
        } else {
          /* Repouso. A vida é reescrita para o descanso mais o afundamento — a
             lasca que ia viver mais três segundos no ar não fica três segundos
             parada no chão, e a que ia morrer já ganha o tempo de assentar. */
          pool.estado[i] = 2;
          pool.vel[i3] = 0;
          pool.vel[i3 + 1] = 0;
          pool.vel[i3 + 2] = 0;
          pool.age[i] = 0;
          pool.life[i] = DESCANSO + SUMICO;
          /* Deita: uma lasca em repouso não fica de pé no ângulo em que caiu.
             Só o giro em Y sobrevive, que é a direção em que ela realmente
             assentaria. */
          pool.rot[i3] = 0;
          pool.rot[i3 + 2] = 0;
        }
      }
    }

    const dx = pool.pos[i3] - camX;
    const dy = pool.pos[i3 + 1] - camY;
    const dz = pool.pos[i3 + 2] - camZ;
    if (dx * dx + dy * dy + dz * dz > corte2) {
      pool.swapRemove(i);
      continue;
    }

    /* O AFUNDAMENTO. Encolhe e desce ao mesmo tempo, e é a descida que faz a
       coisa funcionar: o terreno cobre a lasca, então ela não "some", ela
       assenta. Encolher sozinho deixaria uma pedra virando um ponto no ar. */
    let k = 1;
    let afunda = 0;
    if (pool.estado[i] === 2) {
      const sobra = pool.life[i] - pool.age[i];
      if (sobra < SUMICO) {
        const u = sobra / SUMICO;
        k = 0.35 + 0.65 * u;
        afunda = (1 - u) * pool.escala[i3 + 1] * 1.6;
      }
    }

    _p.set(pool.pos[i3], pool.pos[i3 + 1] - afunda, pool.pos[i3 + 2]);
    _e.set(pool.rot[i3], pool.rot[i3 + 1], pool.rot[i3 + 2]);
    _q.setFromEuler(_e);
    _s.set(pool.escala[i3] * k, pool.escala[i3 + 1] * k, pool.escala[i3 + 2] * k);
    _m.compose(_p, _q, _s);
    pool.mesh.setMatrixAt(i, _m);
  }

  const havia = pool.mesh.count;
  pool.mesh.count = pool.live;
  if (pool.live === 0 && havia === 0) return;
  pool.mesh.instanceMatrix.needsUpdate = true;
  pool.mesh.instanceColor.needsUpdate = true;
}
