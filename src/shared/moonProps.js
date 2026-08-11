/* ---------------------------------------------------------------------------
   A base lunar vista pelo SERVIDOR — o que barra uma flecha.

   Mesmo papel de `shared/valleyProps.js` no vale: o cliente tem colisores de
   Rapier para cada peça da base, e o servidor não tem malha nenhuma. Enquanto
   isso valeu como "dívida menor" (`server/botSim.js` dizia literalmente que a
   Lua é esparsa e aberta), o defeito que apareceu foi o pior possível: as
   flechas dos bots ATRAVESSAVAM o cenário. Quem subia à plataforma do foguete
   — o ponto alto do mapa, o lugar que o jetpack existe para alcançar — morria
   de tiros vindos do chão, através do piso em que estava de pé; e quem se
   agachava atrás de um contêiner morria através do contêiner. Os contêineres
   existem para ser COBERTURA (é o que o comentário deles diz); contra bot, não
   eram nada.

   ------------------------------------------------------------- uma fonte só

   As medidas moram aqui e `entities/moonBase.js` as importa para desenhar E
   para criar os colisores. Não é organização: é a única forma de o disco da
   plataforma não mudar de raio num dos dois lados e a flecha do bot voltar,
   em silêncio, a passar pela borda.

   O que fica de fora, de propósito:

   • O ROVER, porque ele anda. Um bloqueador é estático por construção, e a
     posição dele vive em `server/spaceSim.js`. Uma flecha de bot atravessa o
     rover; é uma caixa de 2 m em movimento, e o preço de errar para o outro
     lado (o bot achando que não tem visada porque o rover passou) é maior.
   • Mastro da bandeira, antena fina, pernas do módulo, aletas do foguete —
     o cliente também não tem colisor para nenhum deles.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { makeRandom } from "../utils/math.js";

/** O foguete, em metros a partir do solo sob ele. */
export const ROCKET = {
  /** Altura até o piso da plataforma de cima. */
  height: 28,
  /** Raio do casco (o colisor é um cilindro só, sem aletas nem anéis). */
  radius: 2.6,
  /** Raio do piso do topo. */
  topRadius: 3.6,
  /** Raio do piso do meio. */
  midRadius: 3.4,
  /** Altura do piso do meio. */
  midHeight: 14,
  /** Espessura do colisor de cada piso (meia-altura 0,22 / 0,20 no Rapier). */
  topThickness: 0.44,
  midThickness: 0.4,
};

/** Os domos, em deslocamento a partir da base. `r` é o raio da bolha. */
export const HABITATS = [
  { dx: -46, dz: 14, r: 5.6 },
  { dx: -30, dz: 40, r: 4.6 },
  { dx: -58, dz: 44, r: 4.0 },
];

/** A fazenda solar: duas filas de seis chapas inclinadas para o Sol rasante. */
export const SOLAR = {
  filas: 2,
  porFila: 6,
  dx: 38, // deslocamento da primeira fila
  passoFila: 14,
  dz: -30, // deslocamento da primeira placa
  passoPlaca: 11,
  altura: 2.4, // m — a chapa fica no alto do mastro
  meiaLargura: 3.2,
  meiaEspessura: 0.06,
  meiaProfundidade: 1.8,
  inclinacao: -0.42, // rad, em torno de Z
};

/** A parabólica. O colisor é só o MASTRO — o prato é casca fina. */
export const DISH = { dx: 22, dz: 52, raio: 0.4, altura: 4.2 };

/** O módulo pousado. */
export const LANDER = { dx: 44, dz: 34, meiaLargura: 2.2, meiaAltura: 1.8 };

/** Os contêineres de carga. A semente é a mesma do desenho, e tem de ser. */
export const CARGO = { semente: 31415, quantidade: 14 };

/**
 * Onde cada contêiner caiu, e de que tamanho.
 *
 * PURA e determinística: chamada no cliente e no servidor, devolve a mesma
 * lista. É o sorteio que `MoonBase.buildCargo` fazia inline.
 *
 * @returns {Array<{dx:number,dz:number,w:number,h:number,giro:number,tinta:number}>}
 */
export function cargoLayout() {
  const rnd = makeRandom(CARGO.semente);
  const lista = [];
  for (let i = 0; i < CARGO.quantidade; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 18 + rnd() * 58;
    const w = 1.6 + rnd() * 1.4;
    const h = 1.2 + rnd() * 1.0;
    const giro = rnd() * Math.PI;
    /* Os dois sorteios da tinta ficam AQUI mesmo sem servirem ao servidor: eles
       consomem números do gerador, e tirá-los daqui deslocaria toda a sequência
       seguinte — os contêineres mudariam de lugar. */
    const tinta = rnd() < 0.3 ? 0 : rnd() < 0.5 ? 1 : 2;
    lista.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, w, h, giro, tinta });
  }
  return lista;
}

/**
 * Tudo o que para uma flecha na Lua.
 *
 * @param {{heightAt:(x:number,z:number)=>number}} terrain campo de altura
 * @returns {Array<object>} sólidos no formato de `shared/blockers.js`
 */
export function moonBlockers(terrain) {
  const B = CONFIG.levels.moon.base;
  const solo = terrain.heightAt(B.x, B.z);
  const saida = [];

  /* ------------------------------------------------------------ foguete -- */
  const yTopo = solo + ROCKET.height;
  const yMeio = solo + ROCKET.midHeight;
  saida.push({ x: B.x, z: B.z, r: ROCKET.radius, h: ROCKET.height, base: solo });
  /* Os dois discos. O `+0,05 − metade da espessura` reproduz onde o colisor do
     cliente começa: ele fica cinco centímetros acima do piso desenhado, para o
     controlador de personagem encontrar chão sob os pés. */
  saida.push({
    x: B.x,
    z: B.z,
    r: ROCKET.topRadius,
    h: ROCKET.topThickness,
    base: yTopo + 0.05 - ROCKET.topThickness / 2,
  });
  saida.push({
    x: B.x,
    z: B.z,
    r: ROCKET.midRadius,
    h: ROCKET.midThickness,
    base: yMeio + 0.05 - ROCKET.midThickness / 2,
  });

  /* ----------------------------------------------------------- hábitats -- */
  for (const p of HABITATS) {
    const x = B.x + p.dx;
    const z = B.z + p.dz;
    const y = terrain.heightAt(x, z);
    saida.push({
      box: true,
      x,
      y: y + p.r * 0.5,
      z,
      hx: p.r * 0.78,
      hy: p.r * 0.6,
      hz: p.r * 0.78,
    });
  }

  /* ------------------------------------------------------------ painéis -- */
  for (let fila = 0; fila < SOLAR.filas; fila++) {
    for (let i = 0; i < SOLAR.porFila; i++) {
      const x = B.x + SOLAR.dx + fila * SOLAR.passoFila;
      const z = B.z + SOLAR.dz + i * SOLAR.passoPlaca;
      const y = terrain.heightAt(x, z);
      saida.push({
        box: true,
        x,
        y: y + SOLAR.altura,
        z,
        hx: SOLAR.meiaLargura,
        hy: SOLAR.meiaEspessura,
        hz: SOLAR.meiaProfundidade,
        rz: SOLAR.inclinacao,
      });
    }
  }

  /* ------------------------------------------------------------- antena -- */
  {
    const x = B.x + DISH.dx;
    const z = B.z + DISH.dz;
    saida.push({ x, z, r: DISH.raio, h: DISH.altura, base: terrain.heightAt(x, z) });
  }

  /* ------------------------------------------------------------- módulo -- */
  {
    const x = B.x + LANDER.dx;
    const z = B.z + LANDER.dz;
    const y = terrain.heightAt(x, z);
    saida.push({
      box: true,
      x,
      y: y + 2.2,
      z,
      hx: LANDER.meiaLargura,
      hy: LANDER.meiaAltura,
      hz: LANDER.meiaLargura,
    });
  }

  /* -------------------------------------------------------------- carga -- */
  for (const c of cargoLayout()) {
    const x = B.x + c.dx;
    const z = B.z + c.dz;
    const y = terrain.heightAt(x, z);
    saida.push({
      box: true,
      x,
      y: y + c.h,
      z,
      hx: c.w,
      hy: c.h,
      hz: c.w * 0.75,
      ry: c.giro,
    });
  }

  return saida;
}
