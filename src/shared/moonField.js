/* ---------------------------------------------------------------------------
   O chão da Lua: altura, crateras, curvatura e barreira.

   PURO, como `terrainField.js` — nada de Three.js, nada de Rapier, nada de DOM.
   O servidor roda em Node e precisa das mesmas alturas para escolher onde os
   duelistas nascem; a malha, as cores e o colisor moram em
   `entities/moonGround.js`, que só existe no navegador.

   A ideia que organiza este arquivo: **quase todo o realismo da Lua cabe dentro
   da malha que já pagamos.** Cratera não é objeto, é altura. Um campo com 144
   crateras em três escalas custa exatamente o mesmo que um campo liso em tempo
   de execução — o que ele custa é aqui, em `heightAt`, e é por isso que a
   indexação espacial abaixo existe.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { ValueNoise } from "../utils/noise.js";
import { smoothstep, makeRandom } from "../utils/math.js";

/* Célula da grade de busca de crateras. Ver `cratersNear`.
   32 m dá 2 a 5 crateras por célula com as 256 do campo — o suficiente para
   `heightAt` continuar barata sem multiplicar o custo de memória do índice. */
const CELL = 32; // m

export class MoonField {
  constructor(seed = 19690720) {
    // 20/07/1969. É só uma semente — mas é determinística, e o mundo inteiro
    // do jogo já usa sementes fixas para que o cenário seja o mesmo em todas
    // as máquinas e entre sessões.
    this.noise = new ValueNoise(seed);
    this.M = CONFIG.levels.moon;

    const B = this.M.barrier;
    this.centerX = B.centerX;
    this.centerZ = B.centerZ;
    this.radius = B.radius;

    /* Onde a sala pode sortear um nascimento. `pickSpawnPoint` lê isto do
       terreno em vez de `CONFIG.spawn`, que é do vale. */
    this.spawnCenter = {
      x: B.centerX,
      z: B.centerZ,
      radius: B.radius * 0.72,
      minRadius: 18,
    };

    this.craters = this.buildCraters();
    this.grid = this.indexCraters(this.craters);
  }

  /* ---------------------------------------------------------- crateras ---- */

  /**
   * O campo de crateras, sorteado uma vez.
   *
   * Duas regras que separam "cratera de jogo" de cratera de verdade, e que
   * custam nada:
   *
   * • **Sobreposição com idade.** A lista sai em ordem, e `heightAt` soma nessa
   *   ordem: a mais nova corta a borda da mais velha. Um campo em que todas as
   *   bordas estão inteiras lê como bolhas de sabão.
   *
   * • **Tamanho cresce com a distância da base.** As pequenas ficam no miolo e
   *   as grandes vão para a borda e para o horizonte. É honesto visualmente e
   *   resolve o orçamento de malha sozinho — a grade é adensada no centro, e
   *   uma cratera de 3 m só existe onde há célula de 1 m para descrevê-la.
   */
  buildCraters() {
    const C = this.M.craters;
    const rnd = makeRandom(770419);
    const base = this.M.base;
    const lista = [];

    for (const tier of C.tiers) {
      for (let i = 0; i < tier.count; i++) {
        // Raiz quadrada no raio: sem ela o sorteio se acumula no centro, porque
        // a área de um anel cresce com o raio.
        const ang = rnd() * Math.PI * 2;
        const t = tier.dMin + (tier.dMax - tier.dMin) * Math.sqrt(rnd());
        const d = t * this.radius;
        const x = this.centerX + Math.cos(ang) * d;
        const z = this.centerZ + Math.sin(ang) * d;
        const r = tier.rMin + (tier.rMax - tier.rMin) * rnd();

        /* Nada de cratera sob os módulos e o foguete: a base foi construída num
           terreno escolhido, e um pé de foguete dentro de uma tigela seria a
           primeira coisa que alguém notaria como errada.

           A folga usa o raio DESTA cratera, não o maior do escalão. Somar o
           maior raio parece conservador e limpa um disco enorme: com o escalão
           grande chegando a 45 m, o miolo inteiro do mapa ficava liso. */
        if (Math.hypot(x - base.x, z - base.z) < C.clearAroundBase + r) {
          continue;
        }

        lista.push({
          x,
          z,
          r,
          depth: C.depthRatio * r,
          rim: C.rimRatio * r,
          reach: r * (1 + C.ejectaReach),
          /* Só uma parte tem raios de ejeção: são as crateras JOVENS, e uma Lua
             em que todas as crateras têm estrias brancas lê como zebra. */
          rays: rnd() < C.rayChance,
          rayPhase: rnd() * Math.PI * 2,
        });
      }
    }
    return lista;
  }

  /**
   * Indexação espacial: cada cratera entra em todas as células que seu alcance
   * toca.
   *
   * Sem isto, `heightAt` testaria as 144 crateras a cada chamada — e ela é
   * chamada 29 mil vezes só para construir a malha, mais uma vez por passo de
   * física por criatura. Com a grade, são 2 a 4 testes por chamada.
   */
  indexCraters(craters) {
    const grid = new Map();
    for (const c of craters) {
      const i0 = Math.floor((c.x - c.reach) / CELL);
      const i1 = Math.floor((c.x + c.reach) / CELL);
      const j0 = Math.floor((c.z - c.reach) / CELL);
      const j1 = Math.floor((c.z + c.reach) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const chave = `${i},${j}`;
          let celula = grid.get(chave);
          if (!celula) grid.set(chave, (celula = []));
          celula.push(c);
        }
      }
    }
    return grid;
  }

  /** As crateras que podem influenciar este ponto. */
  cratersNear(x, z) {
    return this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  }

  /**
   * O perfil de uma cratera: tigela, borda elevada e manto de ejeção.
   *
   * A borda soma na MESMA conta da tigela em vez de ser um anel separado, e é
   * isso que dá a transição contínua entre o buraco e o material que saiu dele.
   */
  craterHeight(d, c) {
    if (d >= c.reach) return 0;
    const t = d / c.r;
    if (t < 1) {
      // Tigela parabólica + a borda subindo no último quarto do raio.
      return -c.depth * (1 - t * t) + c.rim * smoothstep(0.72, 1.0, t);
    }
    // Manto externo: o material ejetado decai da borda até sumir.
    const u = (t - 1) / this.M.craters.ejectaReach;
    return c.rim * (1 - smoothstep(0, 1, u));
  }

  /* ------------------------------------------------------------- altura ---- */

  /** Altura do terreno (m) em qualquer ponto do plano. */
  heightAt(x, z) {
    const M = this.M;
    const dx = x - this.centerX;
    const dz = z - this.centerZ;

    /* --- curvatura: o chão cai com o quadrado da distância --------------- */
    let h = -(dx * dx + dz * dz) / (2 * M.curvatureRadius);

    /* --- ondulação larga: os "mares", em escala de centenas de metros ---- */
    h += M.undulation * this.noise.fbm2(x * 0.004, z * 0.004, 2);

    /* --- regolito: grão de 25 cm, para o sombreamento não ficar plástico - */
    h += M.regolith * this.noise.fbm2(x * 0.09, z * 0.09, 3);

    /* --- crateras, na ordem em que foram sorteadas (nova corta velha) ---- */
    const perto = this.cratersNear(x, z);
    if (perto) {
      for (const c of perto) {
        h += this.craterHeight(Math.hypot(x - c.x, z - c.z), c);
      }
    }
    return h;
  }

  /**
   * Normal analítica por diferenças finitas.
   *
   * `out` é qualquer objeto com x/y/z — `THREE.Vector3` no cliente, literal no
   * servidor. A normalização é feita à mão para não depender de um método de
   * Vector3 que o servidor não tem.
   */
  normalAt(x, z, eps = 0.6, out = { x: 0, y: 0, z: 0 }) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    out.x = nx * inv;
    out.y = ny * inv;
    out.z = nz * inv;
    return out;
  }

  /** Inclinação: cosseno do ângulo com a vertical. 1 = plano. */
  slopeAt(x, z, eps = 0.6) {
    return this.normalAt(x, z, eps, _normal).y;
  }

  /* ----------------------------------------------------------- barreira ---- */

  /** Distância ao centro da arena. */
  distanceToCenter(x, z) {
    return Math.hypot(x - this.centerX, z - this.centerZ);
  }

  /**
   * Distância COM SINAL até a barreira (negativo = dentro).
   *
   * Tem o mesmo nome e o mesmo sinal de `TerrainField.arenaDistance` de
   * propósito: o servidor e os sistemas de bicho perguntam "quão dentro da área
   * jogável está este ponto?" sem precisar saber em que fase estão.
   */
  arenaDistance(x, z) {
    return this.distanceToCenter(x, z) - this.radius;
  }

  /**
   * A BARREIRA INVISÍVEL, e ela não precisou de código novo.
   *
   * `isWalkable` já é consultado a cada passo do controlador de personagem
   * (`systems/playerPhysics.js`) e a cada sorteio de nascimento. Devolver falso
   * fora do círculo é tudo o que a barreira é.
   */
  isWalkable(x, z) {
    return this.distanceToCenter(x, z) <= this.radius;
  }

  /**
   * O ponto ainda está dentro do MUNDO DESCRITO? (não da barreira)
   *
   * As duas perguntas coincidem no vale — lá `isWalkable` é literalmente a
   * borda da malha — e são opostas aqui: a barreira lunar é uma regra de
   * JOGADOR a 165 m, mas o chão continua existindo até o anel distante de
   * 1,6 km e `heightAt` é analítica em qualquer ponto.
   *
   * Confundir as duas custou o modo inteiro de chuva de meteoros. A flecha do
   * bot é integrada no servidor (`botArrow.js`) e o laço parava quando ela
   * saía do "andável": como a rocha nasce de 242 a 331 m do centro da base, a
   * flecha sumia ao cruzar os 165 m e NUNCA chegava no alvo. Na tela ela
   * atravessava a pedra em cheio e nada estourava — o bot só conseguia acertar
   * nos últimos ~79 m de queda, quando a rocha finalmente entrava no círculo.
   */
  isInsideWorld(x, z) {
    const limite = this.M.world?.skirtOuter ?? this.radius * 6;
    return this.distanceToCenter(x, z) <= limite;
  }

  /**
   * É lugar bom para nascer?
   *
   * Dentro da barreira com folga, em terreno plano e — o que importa na Lua —
   * FORA de uma tigela de cratera. Nascer no fundo de uma cratera de 40 m é
   * nascer sem linha de tiro para lugar nenhum.
   */
  isFlatGround(x, z, margin = 12, minSlope = 0.94) {
    if (this.distanceToCenter(x, z) > this.radius - margin) return false;
    const perto = this.cratersNear(x, z);
    if (perto) {
      for (const c of perto) {
        if (Math.hypot(x - c.x, z - c.z) < c.r * 0.9) return false;
      }
    }
    return this.slopeAt(x, z, 1.0) >= minSlope;
  }
}

const _normal = { x: 0, y: 0, z: 0 };
