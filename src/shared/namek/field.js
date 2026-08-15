/* ---------------------------------------------------------------------------
   O chão de Namekusei: relevo, montanhas, mar — e as crateras que o jogo abre.

   PURO. Nada de Three.js, nada de Rapier, nada de DOM. A sala roda em Node e
   precisa das mesmas alturas para nascer gente, pousar bot e decidir onde uma
   cratera cabe; a malha, as cores e a água moram em `src/namek/world/`, que só
   existe no navegador. É a mesma divisão que `shared/moonField.js` faz do lado
   do arqueiro, e o mesmo motivo.

   ------------------------------------------------------------------ o relevo

   Um planeta inteiro não cabe numa malha, então o que existe aqui é o recorte
   que o BT3 também usava: uma CLAREIRA no meio para a briga acontecer, um anel
   de montanhas para dar parede e escala, e o mar depois delas para fechar o
   horizonte sem uma borda reta.

       centro ─────────────────────────────────► borda
       clareira      colinas      montanhas       mar
       0–180 m       180–500 m    500–760 m       760 m+

   A clareira não é plana: ela ondula o suficiente para uma cratera ter onde
   aparecer. Terreno perfeitamente liso faz toda deformação parecer um erro de
   malha.

   ---------------------------------------------------------------- as crateras

   Cratera é ALTURA, não objeto — a mesma ideia da Lua. A diferença é que aqui
   elas nascem em jogo, e isso muda duas coisas:

   • **O índice espacial precisa aceitar inserção.** O da Lua é construído uma
     vez e nunca muda. Este é um `Map` de células com listas, e uma cratera
     entra em todas as células que o raio dela toca.

   • **Elas têm de acabar.** Uma partida de dez minutos com quatro jogadores
     soltando especiais chegaria a milhares, e `heightAt` é chamada por vértice
     de malha, por passo de bot e por bala em voo. O limite é
     `NAMEK.destruction.craterLimit`, em fila: a mais velha sai quando a 97ª
     entra. Ver `addCrater`.
   --------------------------------------------------------------------------- */

import { ValueNoise } from "../../utils/noise.js";
import { makeRandom, smoothstep } from "../../utils/math.js";
import { NAMEK, craterFor } from "./config.js";

/* Célula do índice de crateras. 24 m é da ordem da cratera comum (bola de ki
   abre 3 m, Kamehameha 13 m): células muito menores multiplicariam as inserções
   de uma cratera grande, e muito maiores devolveriam listas longas demais para
   `heightAt` varrer. */
const CELL = 24; // m

export class NamekField {
  constructor(seed = NAMEK.world.seed) {
    this.noise = new ValueNoise(seed);
    this.radius = NAMEK.world.radius;
    this.seaLevel = NAMEK.world.seaLevel;

    /* Onde a sala sorteia nascimentos. É a clareira e as colinas — nunca a
       montanha (nasceria dentro da rocha) nem o mar. */
    this.spawnCenter = { x: 0, z: 0, radius: 460, minRadius: 40 };

    /** @type {Map<number, object[]>} célula → crateras que a tocam */
    this.grid = new Map();
    /** @type {object[]} a fila, em ordem de chegada. Ver `addCrater`. */
    this.craters = [];
    /** @type {Map<number, object>} id da sala → cratera, contra duplicata */
    this.byId = new Map();

    /* As MONTANHAS não saem de ruído puro. Ruído dá relevo, não dá silhueta —
       e o que faz um cenário de Namekusei ser reconhecível são picos separados,
       com vale entre eles, não uma crista contínua. Sorteados uma vez, com
       semente fixa: o planeta é o mesmo em todas as máquinas. */
    this.peaks = this.buildPeaks(seed);
  }

  /* ---------------------------------------------------------------- picos -- */

  /**
   * Os picos do anel, sorteados uma vez.
   *
   * Eles ficam no anel de 500–760 m porque é onde a montanha cumpre o papel de
   * parede sem estreitar a arena de combate. Um pico no miolo seria um obstáculo
   * no meio da briga aérea — e brigar em volta de um obstáculo é o que torna um
   * jogo de voo irritante em vez de amplo.
   */
  buildPeaks(seed) {
    const rnd = makeRandom(seed ^ 0x5eed);
    const lista = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      /* Ângulos em setores, com sobra sorteada dentro de cada um: sorteio livre
         em 22 picos deixa buracos de 60° e aglomerados de três, e o anel de
         montanhas some de metade das direções. */
      const ang = ((i + rnd() * 0.8 - 0.4) / n) * Math.PI * 2;
      const d = 500 + rnd() * 260;
      lista.push({
        x: Math.cos(ang) * d,
        z: Math.sin(ang) * d,
        /* m — altura acrescentada no centro do pico. */
        h: 46 + rnd() * 96,
        /* m — quão largo ele é. Picos altos são largos: um cone de 140 m de
           altura e 40 m de base é uma agulha, e agulha não lê como montanha. */
        r: 78 + rnd() * 120,
        /* Achatamento em uma direção, para nenhum deles ser um cone perfeito. */
        squash: 0.62 + rnd() * 0.5,
        rot: rnd() * Math.PI,
      });
    }
    return lista;
  }

  /* --------------------------------------------------------------- índice -- */

  key(cx, cz) {
    /* Empacota duas coordenadas de célula num inteiro. A arena tem 1800 m de
       lado, ou 75 células — cabe folgado nos 16 bits de cada metade, e uma
       chave numérica é bem mais barata que a string `"12,7"` que o `Map`
       teria de hashear a cada consulta de altura. */
    return ((cx + 2048) << 16) | (cz + 2048);
  }

  /** Insere uma cratera em todas as células que o raio dela toca. */
  indexCrater(c) {
    const min = Math.floor((c.x - c.raio) / CELL);
    const max = Math.floor((c.x + c.raio) / CELL);
    const zmin = Math.floor((c.z - c.raio) / CELL);
    const zmax = Math.floor((c.z + c.raio) / CELL);
    for (let cx = min; cx <= max; cx++) {
      for (let cz = zmin; cz <= zmax; cz++) {
        const k = this.key(cx, cz);
        let lista = this.grid.get(k);
        if (!lista) this.grid.set(k, (lista = []));
        lista.push(c);
      }
    }
  }

  /** Tira uma cratera aposentada do índice. */
  unindexCrater(c) {
    const min = Math.floor((c.x - c.raio) / CELL);
    const max = Math.floor((c.x + c.raio) / CELL);
    const zmin = Math.floor((c.z - c.raio) / CELL);
    const zmax = Math.floor((c.z + c.raio) / CELL);
    for (let cx = min; cx <= max; cx++) {
      for (let cz = zmin; cz <= zmax; cz++) {
        const k = this.key(cx, cz);
        const lista = this.grid.get(k);
        if (!lista) continue;
        const i = lista.indexOf(c);
        if (i >= 0) lista.splice(i, 1);
        if (!lista.length) this.grid.delete(k);
      }
    }
  }

  /**
   * Abre uma cratera. **Determinística e idempotente.**
   *
   * Determinística porque raio e fundura saem de `craterFor(power)`, que é
   * compartilhada — os dois lados chegam ao mesmo buraco a partir dos mesmos
   * três números, e é isso que faz duas abas verem o mesmo chão (critério 5 do
   * §12 do plano).
   *
   * Idempotente pelo `id`: a mensagem da sala pode chegar duas vezes (o cliente
   * que atirou já a aplicou localmente para não esperar o retorno da rede) e a
   * segunda não pode aprofundar o buraco.
   *
   * @param {number} id       carimbo da sala; o mesmo em todas as telas
   * @param {number} x
   * @param {number} z
   * @param {number} power    potência do golpe
   * @returns {object|null} a cratera criada, ou null se o id já existia
   */
  addCrater(id, x, z, power) {
    if (this.byId.has(id)) return null;
    const { raio, fundura } = craterFor(power);
    const c = { id, x, z, raio, fundura };

    this.craters.push(c);
    this.byId.set(id, c);
    this.indexCrater(c);

    /* A FILA. Sem teto, `heightAt` degrada ao longo da partida — e ela é a
       função mais chamada do modo inteiro. A mais velha some primeiro porque é
       a que o jogador tem menos chance de estar olhando. */
    while (this.craters.length > NAMEK.destruction.craterLimit) {
      const velha = this.craters.shift();
      this.byId.delete(velha.id);
      this.unindexCrater(velha);
    }
    return c;
  }

  /** As crateras cujo raio pode alcançar (x, z). */
  cratersNear(x, z) {
    return this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /** Todas, para mandar a quem entra no meio da partida. */
  craterList() {
    return this.craters.map((c) => ({ i: c.id, p: [c.x, c.z], r: c.raio, f: c.fundura }));
  }

  /**
   * Rebate a lista recebida do `welcome` sem recalcular potência.
   *
   * Raio e fundura viajam prontos de propósito: quem entra no meio precisa do
   * MESMO buraco que os outros têm, e refazer a conta a partir da potência
   * daria o mesmo resultado só enquanto ninguém mexesse na fórmula. No dia em
   * que `craterFor` for ajustada, quem já está em campo continua com o chão
   * antigo e o retardatário chegaria com um chão novo — a única divergência
   * possível, fechada aqui.
   */
  loadCraters(lista) {
    for (const c of lista ?? []) {
      if (this.byId.has(c.i)) continue;
      const cratera = { id: c.i, x: c.p[0], z: c.p[1], raio: c.r, fundura: c.f };
      this.craters.push(cratera);
      this.byId.set(c.i, cratera);
      this.indexCrater(cratera);
    }
  }

  /* --------------------------------------------------------------- altura -- */

  /**
   * O relevo BASE, sem cratera nenhuma.
   *
   * Separado de `heightAt` porque a malha do terreno precisa dos dois: o base
   * para nascer, e o completo para ser re-esculpida quando um buraco abre perto
   * dela. Recalcular o ruído a cada re-esculpimento seria pagar FBM por vértice
   * a cada explosão — o cliente guarda o base e só soma a diferença.
   */
  baseHeight(x, z) {
    const d = Math.hypot(x, z);
    const W = NAMEK.world;

    /* ONDULAÇÃO GERAL. Duas oitavas largas dão as colinas; a terceira, o granulado
       que impede a superfície de parecer plástico à distância de voo. */
    let h = this.noise.fbm2(x * 0.0016, z * 0.0016, 3) * 26;
    h += this.noise.fbm2(x * 0.0071, z * 0.0071, 3) * 6.5;

    /* A CLAREIRA. Perto do centro o relevo é achatado contra a cota 4 — não
       zerado, ver o cabeçalho. `smoothstep` e não um corte: uma borda dura na
       clareira apareceria como um degrau circular de 180 m de raio. */
    const clareira = 1 - smoothstep(140, 320, d);
    h = h * (1 - clareira * 0.82) + 4 * clareira * 0.82;

    /* AS MONTANHAS. Cada pico é uma gaussiana achatada e girada. O `for` custa
       22 iterações por consulta, e é por isso que ele está atrás do teste de
       distância: no miolo da arena — onde estão os jogadores, os bots e a maior
       parte dos vértices — ele nem começa. */
    if (d > 300) {
      for (const p of this.peaks) {
        const dx = x - p.x;
        const dz = z - p.z;
        /* Gira no espaço do pico antes de achatar, senão todo o anel achataria
           na mesma direção do mundo e a montanha viraria um padrão. */
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const rx = dx * c - dz * s;
        const rz = (dx * s + dz * c) * p.squash;
        const dist2 = rx * rx + rz * rz;
        const r2 = p.r * p.r;
        if (dist2 > r2) continue;
        const t = 1 - dist2 / r2;
        /* t² dá uma saia larga e um topo redondo; t linear daria um cone. */
        h += p.h * t * t;
      }
      /* Cristas ridged POR CIMA das montanhas, e só nelas. É o que dá a rocha
         lascada de Namekusei sem custar oitava nenhuma na clareira. */
      const forca = smoothstep(420, 620, d);
      if (forca > 0) {
        h += this.noise.ridged2(x * 0.0135, z * 0.0135, 3) * 11 * forca;
      }
    }

    /* O MAR. Depois das montanhas o chão desce e afunda. A descida começa antes
       da borda da arena para que a barreira macia (§2 do plano) aconteça sobre
       água aberta — voar para fora e ser freado sobre o oceano lê como o mundo
       continuando; ser freado sobre um penhasco lê como uma parede invisível. */
    const praia = smoothstep(700, 880, d);
    h = h * (1 - praia) + (this.seaLevel - 14) * praia;

    return h;
  }

  /**
   * A altura de verdade: relevo base mais as crateras que alcançam este ponto.
   *
   * É a função mais chamada do modo — malha, bot, bala, pé de jogador — e por
   * isso ela é o lugar onde o índice espacial paga a si mesmo: sem ele seriam
   * 96 crateras testadas por consulta; com ele, tipicamente zero ou uma.
   */
  heightAt(x, z) {
    let h = this.baseHeight(x, z);
    const perto = this.cratersNear(x, z);
    if (!perto) return h;
    for (let i = 0; i < perto.length; i++) {
      h += this.craterDelta(perto[i], x, z);
    }
    return h;
  }

  /**
   * Quanto uma cratera baixa o terreno num ponto. Zero fora do raio.
   *
   * O perfil tem BORDA LEVANTADA, e ela é a diferença entre um buraco e uma
   * cratera: o material que saiu do meio tem de estar em algum lugar, e num
   * impacto ele está no anel em volta. Sem esse anel, o que se vê é uma
   * mordida — que é exatamente o que parecia na primeira versão.
   *
   *     borda            ⌒‾‾⌒
   *     ─────────────⌒‾‾      ‾‾⌒─────────────
   *     fundo              ⌄⌄⌄
   */
  craterDelta(c, x, z) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= c.raio) return 0;
    const u = d / c.raio;

    /* Bacia: cosseno elevado. Fundo redondo, paredes que suavizam na borda —
       um parabolóide puro encontra o terreno num ângulo vivo e o normal salta
       ali, o que aparece como um aro escuro na iluminação. */
    const bacia = -c.fundura * Math.pow(Math.cos((u * Math.PI) / 2), 1.6);

    /* Anel: a sobra, só no terço externo, com um quinto da fundura. */
    const anel = u > 0.66 ? Math.sin((u - 0.66) / 0.34 * Math.PI) * c.fundura * 0.2 : 0;

    return bacia + anel;
  }

  /* ------------------------------------------------------------ geometria -- */

  /** Normal do terreno por diferença central. */
  normalAt(x, z, eps = 0.8, out = { x: 0, y: 0, z: 0 }) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * eps;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out.x = nx * inv;
    out.y = ny * inv;
    out.z = nz * inv;
    return out;
  }

  /** Cosseno do ângulo com a vertical: 1 é plano, 0 é parede. */
  slopeAt(x, z, eps = 0.8) {
    return this.normalAt(x, z, eps).y;
  }

  /** Está dentro do círculo da arena? */
  isInsideWorld(x, z) {
    return x * x + z * z <= this.radius * this.radius;
  }

  /** Dá para ficar de pé aqui? Fora d'água, dentro da arena e sem ser parede. */
  isWalkable(x, z) {
    if (!this.isInsideWorld(x, z)) return false;
    if (this.heightAt(x, z) <= this.seaLevel + 0.5) return false;
    return this.slopeAt(x, z) > 0.72;
  }

  /**
   * Um ponto plano o bastante para pousar uma casa ou nascer alguém.
   *
   * Testa o entorno, não só o centro: um ponto plano no meio de uma encosta
   * existe (o relevo passa pela horizontal ao virar), e uma vila construída ali
   * fica com metade das casas no ar.
   */
  isFlatGround(x, z, margem = 8, minSlope = 0.93) {
    if (!this.isWalkable(x, z)) return false;
    const h = this.heightAt(x, z);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const px = x + Math.cos(a) * margem;
      const pz = z + Math.sin(a) * margem;
      if (Math.abs(this.heightAt(px, pz) - h) > margem * 0.34) return false;
    }
    return this.slopeAt(x, z) > minSlope;
  }

  /**
   * Um lugar para nascer, sorteado.
   *
   * `√` no raio pelo mesmo motivo de sempre: sem ele o sorteio se acumula no
   * centro, porque a área de um anel cresce com o raio — e todo mundo nasceria
   * em cima de todo mundo no meio da clareira.
   */
  pickSpawn(rnd = Math.random) {
    const S = this.spawnCenter;
    for (let tentativa = 0; tentativa < 40; tentativa++) {
      const ang = rnd() * Math.PI * 2;
      const t = Math.sqrt(rnd());
      const d = S.minRadius + (S.radius - S.minRadius) * t;
      const x = S.x + Math.cos(ang) * d;
      const z = S.z + Math.sin(ang) * d;
      if (this.isWalkable(x, z)) return { x, z, y: this.heightAt(x, z) };
    }
    /* Quarenta tentativas sem achar chão é impossível com este relevo, mas o
       nascimento não pode ser a coisa que falha: o centro da clareira é plano
       por construção. */
    return { x: 0, z: 0, y: this.heightAt(0, 0) };
  }
}
