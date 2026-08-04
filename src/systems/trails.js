/* ---------------------------------------------------------------------------
   Traçados de trajetória.

   Cada flecha desenha o caminho que ela REALMENTE percorreu — os pontos são
   amostrados da posição do corpo rígido durante o voo, não de uma curva
   prevista. Por isso o traçado mostra o efeito do arrasto e do vento em vez de
   uma parábola ideal.

   Os traçados de tiros anteriores ficam na cena: 15 s totalmente visíveis
   depois que a flecha para, e então 5 s desaparecendo gradualmente. Cada
   flecha tem o SEU traçado — atirar uma nova nunca apaga o das anteriores.

   E o limite é POR DONO. Um pool único faria o jogador que atira mais rápido
   apagar o traçado dos amigos, que é justamente o que se quer ver no
   multiplayer: a linha da flecha do outro cruzando o vale.

   O buffer é PRÉ-ALOCADO uma vez e escrito no lugar.

   Antes, cada atualização criava uma `BufferGeometry` nova com um
   `Float32Array` novo. Funcionava enquanto o voo era curto — mas um tiro alto
   voa 15 s, enche os 700 pontos e, a partir daí, fica sujo a CADA passo de
   física: 120 alocações de 2 100 floats por segundo, cada uma com reenvio para
   a GPU. Era isso que fazia o jogo engasgar quando a flecha ia longe demais.

   Cheio, o traçado é DECIMADO em vez de truncado: fica um ponto a cada dois e
   a amostragem passa a ser mais espaçada. O caminho continua inteiro, do
   disparo ao impacto — só com menos resolução — em vez de perder o começo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";

class Trail {
  constructor(ownerId = null, color = CONFIG.trail.color) {
    this.ownerId = ownerId;
    this.color = color;
    /** Buffer fixo, escrito no lugar. Nunca realocado. */
    this.positions = new Float32Array(CONFIG.trail.maxPoints * 3);
    this.count = 0; // pontos escritos
    this.minSegment = CONFIG.trail.minSegment;
    this.finished = false;
    this.age = 0; // s desde que ficou pronto
    this.line = null;
    this.dirty = false;
  }

  /** Registra um ponto, respeitando a distância mínima entre amostras. */
  push(x, y, z) {
    if (this.finished) return;
    const p = this.positions;
    const n = this.count;
    if (n > 0) {
      const i = (n - 1) * 3;
      const dx = x - p[i];
      const dy = y - p[i + 1];
      const dz = z - p[i + 2];
      const min = this.minSegment;
      if (dx * dx + dy * dy + dz * dz < min * min) return;
    }
    if (n >= CONFIG.trail.maxPoints) this.decimate();
    const w = this.count * 3;
    p[w] = x;
    p[w + 1] = y;
    p[w + 2] = z;
    this.count++;
    this.dirty = true;
  }

  /**
   * Encheu: fica um ponto a cada dois e a amostragem dobra de passo.
   *
   * Descartar os mais antigos apagaria o começo do voo — justamente a parte
   * mais informativa do traçado, que é de onde a flecha saiu. Decimar preserva
   * o caminho inteiro com metade da resolução, e o custo é pago uma única vez
   * a cada duplicação do alcance.
   */
  decimate() {
    const p = this.positions;
    let w = 0;
    for (let r = 0; r < this.count; r += 2, w++) {
      p[w * 3] = p[r * 3];
      p[w * 3 + 1] = p[r * 3 + 1];
      p[w * 3 + 2] = p[r * 3 + 2];
    }
    this.count = w;
    this.minSegment *= 2;
  }

  /** Fecha o traçado no ponto de impacto e começa a contar o tempo de vida. */
  finish(x, y, z) {
    if (this.finished) return;
    if (x !== undefined && this.count < CONFIG.trail.maxPoints) {
      const w = this.count * 3;
      this.positions[w] = x;
      this.positions[w + 1] = y;
      this.positions[w + 2] = z;
      this.count++;
      this.dirty = true;
    }
    this.finished = true;
    this.age = 0;
  }

  get opacity() {
    if (!this.finished) return 1;
    const { holdTime, fadeTime } = CONFIG.trail;
    if (this.age <= holdTime) return 1;
    return Math.max(0, 1 - (this.age - holdTime) / fadeTime);
  }

  get expired() {
    return this.finished && this.age > CONFIG.trail.holdTime + CONFIG.trail.fadeTime;
  }

  dispose(scene) {
    if (!this.line) return;
    scene.remove(this.line);
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.line = null;
  }
}

export class TrailManager {
  constructor(scene) {
    this.scene = scene;
    this.trails = [];
    this.enabled = CONFIG.trail.enabled;
  }

  setEnabled(on) {
    this.enabled = on;
    for (const t of this.trails) {
      if (t.line) t.line.visible = on;
    }
  }

  /**
   * Um traçado novo por flecha — nunca substitui nem esconde os anteriores.
   *
   * @param {number|string|null} ownerId quem atirou; decide de quem é a cota
   * @param {number} color cor da linha (a do dono, no multiplayer)
   */
  create(ownerId = null, color = CONFIG.trail.color) {
    const trail = new Trail(ownerId, color);
    this.trails.push(trail);
    this.evict(ownerId);
    return trail;
  }

  /**
   * Aposenta os mais antigos DO MESMO DONO ao estourar a cota, e só então
   * recorre ao teto global — que existe apenas para a memória não crescer sem
   * limite, e não deveria ser o que decide o que some.
   */
  evict(ownerId) {
    const { maxTrailsPerPlayer, maxTrailsTotal } = CONFIG.trail;

    let mine = 0;
    for (const t of this.trails) if (t.ownerId === ownerId) mine++;
    for (let i = 0; i < this.trails.length && mine > maxTrailsPerPlayer; i++) {
      if (this.trails[i].ownerId !== ownerId) continue;
      this.trails.splice(i, 1)[0].dispose(this.scene);
      i--;
      mine--;
    }

    while (this.trails.length > maxTrailsTotal) {
      this.trails.shift().dispose(this.scene);
    }
  }

  update(dt) {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i];
      if (trail.finished) trail.age += dt;

      if (trail.expired) {
        trail.dispose(this.scene);
        this.trails.splice(i, 1);
        continue;
      }
      this.refresh(trail);
    }
  }

  refresh(trail) {
    if (trail.count < 2) return; // menos de dois pontos: nada a traçar

    if (!trail.line) {
      const material = new THREE.LineBasicMaterial({
        color: trail.color,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const geometry = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(trail.positions, 3);
      // O buffer é escrito muitas vezes e nunca lido de volta pela CPU.
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", attr);
      trail.line = new THREE.Line(geometry, material);
      trail.line.frustumCulled = false;
      trail.line.renderOrder = 3;
      trail.line.visible = this.enabled;
      this.scene.add(trail.line);
    }

    if (trail.dirty) {
      /* Nada é realocado: só marcamos o buffer como sujo e dizemos quantos
         pontos valem. `setDrawRange` é o que permite um buffer de tamanho fixo
         desenhar um traçado que ainda está crescendo. */
      const attr = trail.line.geometry.getAttribute("position");
      attr.needsUpdate = true;
      attr.updateRanges = [{ start: 0, count: trail.count * 3 }];
      trail.line.geometry.setDrawRange(0, trail.count);
      trail.dirty = false;
    }

    const opacity = trail.opacity;
    trail.line.material.opacity = opacity;
    trail.line.visible = this.enabled && opacity > 0.001;
  }

  /**
   * Apaga traçados. Sem argumento apaga tudo; com um dono, só os dele — que é
   * o que a tecla de limpar precisa fazer no multiplayer, para não varrer da
   * tela o tiro que o amigo acabou de dar.
   */
  clear(ownerId = undefined) {
    if (ownerId === undefined) {
      for (const t of this.trails) t.dispose(this.scene);
      this.trails.length = 0;
      return;
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      if (this.trails[i].ownerId !== ownerId) continue;
      this.trails.splice(i, 1)[0].dispose(this.scene);
    }
  }
}
