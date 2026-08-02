/* ---------------------------------------------------------------------------
   Traçados de trajetória.

   Cada flecha desenha o caminho que ela REALMENTE percorreu — os pontos são
   amostrados da posição do corpo rígido durante o voo, não de uma curva
   prevista. Por isso o traçado mostra o efeito do arrasto e do vento em vez de
   uma parábola ideal.

   Os traçados de tiros anteriores ficam na cena: 15 s totalmente visíveis
   depois que a flecha para, e então 5 s desaparecendo gradualmente. Cada
   flecha tem o SEU traçado — atirar uma nova nunca apaga o das anteriores.

   A geometria é reconstruída INTEIRA a cada atualização (não só os pontos
   novos anexados a um buffer que cresce aos poucos). É mais simples e garante
   que a linha sempre cubra do início ao fim do percurso: um buffer que cresce
   incrementalmente é mais fácil de deixar segmentos "cortados" quando o
   objeto é reaproveitado entre frames.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";

class Trail {
  constructor() {
    this.points = []; // [x,y,z, x,y,z, ...]
    this.finished = false;
    this.age = 0; // s desde que ficou pronto
    this.line = null;
    this.dirty = false;
  }

  /** Registra um ponto, respeitando a distância mínima entre amostras. */
  push(x, y, z) {
    if (this.finished) return;
    const p = this.points;
    const n = p.length;
    if (n >= 3) {
      const dx = x - p[n - 3];
      const dy = y - p[n - 2];
      const dz = z - p[n - 1];
      const min = CONFIG.trail.minSegment;
      if (dx * dx + dy * dy + dz * dz < min * min) return;
    }
    p.push(x, y, z);
    if (p.length > CONFIG.trail.maxPoints * 3) p.splice(0, 3);
    this.dirty = true;
  }

  /** Fecha o traçado no ponto de impacto e começa a contar o tempo de vida. */
  finish(x, y, z) {
    if (this.finished) return;
    if (x !== undefined) {
      this.points.push(x, y, z);
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

  /** Um traçado novo por flecha — nunca substitui nem esconde os anteriores. */
  create() {
    const trail = new Trail();
    this.trails.push(trail);
    // Aposenta os mais antigos para não crescer sem limite.
    while (this.trails.length > CONFIG.trail.maxTrails) {
      this.trails.shift().dispose(this.scene);
    }
    return trail;
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
    if (trail.points.length < 6) return; // menos de dois pontos: nada a traçar

    if (!trail.line) {
      const material = new THREE.LineBasicMaterial({
        color: CONFIG.trail.color,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const geometry = new THREE.BufferGeometry();
      trail.line = new THREE.Line(geometry, material);
      trail.line.frustumCulled = false;
      trail.line.renderOrder = 3;
      trail.line.visible = this.enabled;
      this.scene.add(trail.line);
    }

    if (trail.dirty) {
      // Substitui a geometria inteira em vez de tentar atualizar o buffer
      // antigo no lugar — é o que garante a linha completa, do primeiro ao
      // último ponto, em qualquer situação.
      const old = trail.line.geometry;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(trail.points), 3),
      );
      trail.line.geometry = geometry;
      old.dispose();
      trail.dirty = false;
    }

    const opacity = trail.opacity;
    trail.line.material.opacity = opacity;
    trail.line.visible = this.enabled && opacity > 0.001;
  }

  clear() {
    for (const t of this.trails) t.dispose(this.scene);
    this.trails.length = 0;
  }
}
