/* ---------------------------------------------------------------------------
   Os pássaros, no servidor.

   Em quase todo modo eles são cenário vivo: um vale sem nada se mexendo no céu
   parece um cenário de teste. No modo `birdHunt` o bando fica mais denso e
   nasce um pássaro raro — maior, mais alto, que nunca pousa — cuja queda fecha
   a partida na hora.

   O ciclo do bando comum: voar em círculo lá em cima, descer numa copa, ficar
   ali um tempo e levantar voo de novo. Uma flecha que caia perto levanta quem
   estiver pousado, mesmo sem acertar — é o que impede o tiro fácil no bicho
   parado e o que faz o segundo tiro ser mais difícil que o primeiro.

   O POLEIRO É UM (x, z), NÃO UM PONTO NO ESPAÇO.

   O servidor não tem árvore nenhuma: ele conhece o relevo (`TerrainField`), não
   a vegetação, que é malha e vive só no cliente. Então ele não diz "pouse nesta
   copa, a 6,4 m de altura" — ele diz "pouse por aqui", e cada cliente resolve
   para a copa mais próxima que ele conhece. Como o cenário é determinístico
   (mesma seed, mesmo sorteio), todos resolvem para a MESMA árvore. O alternativo
   seria fazer o servidor recalcular a vegetação inteira só para saber onde ficam
   os galhos — muito trabalho para uma informação que já está nas duas pontas.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

let proximoId = 1;

const faixa = (min, max) => min + Math.random() * (max - min);

export class Bird {
  /**
   * @param {import("../src/shared/terrainField.js").TerrainField} terrain
   * @param {{ special?: boolean }} [opts]
   */
  constructor(terrain, opts = {}) {
    this.id = proximoId++;
    this.terrain = terrain;
    this.special = !!opts.special;
    const B = CONFIG.birds;
    const S = CONFIG.spawn;
    const Sp = CONFIG.modes.birdHunt.special;

    // Cada pássaro tem o SEU círculo e a SUA fase: um bando em que todos giram
    // juntos no mesmo raio lê como uma engrenagem, não como bichos.
    this.phase = Math.random() * Math.PI * 2;
    if (this.special) {
      this.radius = Sp.circleRadius * faixa(0.85, 1);
      this.height = Sp.cruiseHeight + faixa(-0.5, 0.5) * Sp.heightSpread;
      this.flySpeed = Sp.flySpeed;
    } else {
      this.radius = B.circleRadius * faixa(0.45, 1);
      this.height = B.cruiseHeight + faixa(-0.5, 0.5) * B.heightSpread;
      this.flySpeed = B.flySpeed;
    }
    this.dir = Math.random() < 0.5 ? 1 : -1;

    this.x = S.centerX + Math.cos(this.phase) * this.radius;
    this.z = S.centerZ + Math.sin(this.phase) * this.radius;
    this.y = terrain.heightAt(this.x, this.z) + this.height;
    this.yaw = 0;
    this.state = "fly";
    this.timer = faixa(0, B.flyMaxTime);
    this.stateTime = faixa(B.flyMinTime, B.flyMaxTime);
    this.dead = false;
    this.deadSince = 0;
    this.fallSpeed = 0;
    this.landed = false;
    this.justLanded = false;
    /** Poleiro pedido: só (x, z). O cliente acha a copa (ver o cabeçalho). */
    this.perch = null;
  }

  /**
   * Escolhe um lugar para pousar: a faixa onde as folhosas nascem.
   *
   * O intervalo de `arenaDistance` é o mesmo que `scatterTrees` usa para
   * espalhar o anel de árvores. Não é coincidência nem número mágico — é a
   * garantia de que o cliente vai encontrar uma copa perto do ponto pedido.
   */
  pickPerch() {
    for (let i = 0; i < 30; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 55;
      const x = CONFIG.spawn.centerX + Math.cos(ang) * r;
      const z = CONFIG.spawn.centerZ + Math.sin(ang) * r;
      const ad = this.terrain.arenaDistance(x, z);
      if (ad < -11 || ad > 15) continue;
      return { x, z };
    }
    return null;
  }

  /** Levantar voo — por susto ou por vontade. */
  takeOff() {
    if (this.dead || this.state === "fly") return;
    this.state = "fly";
    this.perch = null;
    this.timer = 0;
    this.stateTime = faixa(CONFIG.birds.flyMinTime, CONFIG.birds.flyMaxTime);
    // Volta ao circuito pelo ponto do círculo mais próximo de onde ele está.
    this.phase = Math.atan2(this.z - CONFIG.spawn.centerZ, this.x - CONFIG.spawn.centerX);
  }

  hit(agora) {
    if (this.dead) return false;
    this.dead = true;
    this.deadSince = agora;
    this.state = "dead";
    this.fallSpeed = 0;
    this.landed = false;
    /** True no frame em que o corpo toca o chão (consumido pelo bando). */
    this.justLanded = false;
    return true;
  }

  update(dt) {
    if (this.dead) {
      // Queda com a mesma aceleração do cliente: a vitória da rara só anuncia
      // quando o corpo chega ao chão, e os dois lados precisam bater no tempo.
      this.justLanded = false;
      if (this.landed) return;
      const chao = this.terrain.heightAt(this.x, this.z);
      this.fallSpeed = Math.min(
        CONFIG.birds.fallSpeed,
        this.fallSpeed - CONFIG.physics.gravity * dt,
      );
      this.y -= this.fallSpeed * dt;
      if (this.y <= chao) {
        this.y = chao;
        this.landed = true;
        this.justLanded = true;
      }
      return;
    }

    const B = CONFIG.birds;
    this.timer += dt;

    switch (this.state) {
      case "fly": {
        // Circuito: um ponto girando em torno do centro da arena.
        this.phase += ((this.dir * this.flySpeed) / this.radius) * dt;
        const S = CONFIG.spawn;
        const nx = S.centerX + Math.cos(this.phase) * this.radius;
        const nz = S.centerZ + Math.sin(this.phase) * this.radius;
        this.yaw = Math.atan2(nx - this.x, nz - this.z);
        this.x = nx;
        this.z = nz;
        const alvoY = this.terrain.heightAt(nx, nz) + this.height;
        this.y += (alvoY - this.y) * Math.min(1, dt * 1.2);

        // O raro nunca desce: fica no circuito alto até alguém o derrubar.
        if (this.special) break;

        if (this.timer > this.stateTime) {
          const p = this.pickPerch();
          if (p) {
            this.perch = p;
            this.state = "glide";
            this.timer = 0;
          } else {
            this.timer = 0; // sem poleiro à vista: continua voando
          }
        }
        break;
      }

      case "glide": {
        const p = this.perch;
        if (!p) {
          this.takeOff();
          break;
        }
        const dx = p.x - this.x;
        const dz = p.z - this.z;
        const dist = Math.hypot(dx, dz);
        // A altura de pouso é uma ESTIMATIVA — a copa de verdade é o cliente
        // que sabe onde está (ver o cabeçalho). Aqui basta descer.
        const alvoY = this.terrain.heightAt(p.x, p.z) + 5.2;
        if (dist < 0.6) {
          this.x = p.x;
          this.z = p.z;
          this.y = alvoY;
          this.state = "perch";
          this.timer = 0;
          this.stateTime = faixa(B.perchMinTime, B.perchMaxTime);
          break;
        }
        const passo = Math.min(dist, B.diveSpeed * dt);
        this.yaw = Math.atan2(dx, dz);
        this.x += (dx / dist) * passo;
        this.z += (dz / dist) * passo;
        this.y += (alvoY - this.y) * Math.min(1, dt * 2.2);
        // Desistiu de achar: se ficou tempo demais planando, volta a voar.
        if (this.timer > 20) this.takeOff();
        break;
      }

      case "perch": {
        if (this.timer > this.stateTime) this.takeOff();
        break;
      }
    }
  }

  view() {
    const v = {
      id: this.id,
      p: [r3(this.x), r3(this.y), r3(this.z)],
      y: r3(this.yaw),
      s: this.state,
      // O poleiro pedido viaja junto: é com ele que o cliente escolhe a copa.
      k: this.perch ? [r3(this.perch.x), r3(this.perch.z)] : null,
    };
    if (this.special) v.m = 1;
    return v;
  }
}

export class BirdFlock {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Bird[]} */
    this.birds = [];
    /** Densidade e pássaro raro do modo caça. */
    this.hunt = false;
    this._specialLanded = false;
    for (let i = 0; i < CONFIG.birds.count; i++) this.birds.push(new Bird(terrain));
  }

  byId(id) {
    return this.birds.find((b) => b.id === id) ?? null;
  }

  /** Uma flecha caiu por perto: quem estiver pousado ali levanta voo. */
  scareNear(x, z) {
    const r = CONFIG.birds.scareRadius;
    for (const b of this.birds) {
      if (b.dead || b.state === "fly" || b.special) continue;
      if (Math.hypot(b.x - x, b.z - z) < r) b.takeOff();
    }
  }

  kill(id, agora) {
    const b = this.byId(id);
    if (!b || !b.hit(agora)) return null;
    return b;
  }

  update(dt, agora) {
    for (const b of this.birds) b.update(dt);

    // A rara tocou o chão neste tick — a sala usa isto para abrir a vitória.
    this._specialLanded = false;
    for (const b of this.birds) {
      if (b.special && b.justLanded) this._specialLanded = true;
    }

    /* O bando comum tem tamanho fixo: quem morre é substituído. Sem isso o céu
       esvaziaria em dez minutos de partida e o cenário morreria junto.
       O pássaro raro NÃO respawna — um só por partida de caça. */
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      if (!b.dead) continue;
      if (agora - b.deadSince < CONFIG.birds.corpseLifetime * 1000) continue;
      if (b.special) {
        this.birds.splice(i, 1);
        continue;
      }
      this.birds.splice(i, 1, new Bird(this.terrain));
    }
  }

  /** Consome o aviso de que a ave rara acabou de pousar. */
  takeSpecialLanded() {
    if (!this._specialLanded) return false;
    this._specialLanded = false;
    return true;
  }

  /**
   * Reinício de mundo.
   *
   * `vazio` é a fase SEM FAUNA (a Lua). Ele não é o mesmo que "não atualizar":
   * um bando que existe sem ser atualizado ainda vai embora no `snapshot` de
   * quem entra — foi assim que sete pássaros foram parar voando no vácuo, a
   * vinte metros do chão, numa fase que se declara `fauna: false`. Sem bicho na
   * lista, não há de onde vazar.
   *
   * @param {{ hunt?: boolean, vazio?: boolean }} [opts]
   */
  reset(opts = {}) {
    this.hunt = !!opts.hunt;
    this._specialLanded = false;
    this.birds = [];
    if (opts.vazio) return;
    const n = this.hunt ? CONFIG.modes.birdHunt.birdCount : CONFIG.birds.count;
    for (let i = 0; i < n; i++) {
      this.birds.push(new Bird(this.terrain));
    }
    if (this.hunt) this.birds.push(new Bird(this.terrain, { special: true }));
  }

  view() {
    return this.birds.map((b) => b.view());
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
