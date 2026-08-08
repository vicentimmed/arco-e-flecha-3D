/* ---------------------------------------------------------------------------
   Tempestade do chefão — nuvens, raios volumétricos e trovão (cosmético).

   Só no cliente. Custo baixo: 2 camadas de nuvem + fitas do raio (core+halo)
   + clarões emissivos (sem PointLight) + chuva de ~48 Points. Raios preferem cair perto
   do chefão para o clarão revelar a silhueta — todo mundo com o boss syncado
   vê o mesmo tipo de queda no mundo (posição do chefão é compartilhada).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { gameEvents, EventType } from "../core/events.js";

const SOUND_SPEED = 340; // m/s
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function cfg() {
  return CONFIG.modes.zombie.boss?.storm ?? {};
}

/**
 * @param {THREE.Scene} scene
 * @param {import("../core/renderer.js").Renderer} renderer
 * @param {{
 *   getListenerPos: () => THREE.Vector3,
 *   getBoss?: () => { position: THREE.Vector3, bodyHeight?: number } | null,
 *   heightAt?: (x: number, z: number) => number,
 * }} hooks
 */
export class StormSystem {
  constructor(scene, renderer, hooks) {
    this.scene = scene;
    this.renderer = renderer;
    this.getListenerPos = hooks.getListenerPos;
    this.getBoss = hooks.getBoss ?? (() => null);
    this.heightAt = hooks.heightAt ?? null;

    this.active = false;
    this.amount = 0;
    this._target = 0;
    this._timer = 0;
    this._flashes = [];
    this._bolts = [];
    this._rings = [];
    this._pending = [];

    this._coreMat = new THREE.MeshBasicMaterial({
      color: 0xf2f7ff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._glowMat = new THREE.MeshBasicMaterial({
      color: 0x7eb0ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._ringMat = new THREE.MeshBasicMaterial({
      color: 0xc8deff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.rain = null;
    this._rainVel = null;
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this._target = on ? 1 : 0;
    if (on) {
      this._timer = 1.2 + Math.random() * 2.2;
      this._ensureRain();
    } else {
      this._timer = 0;
    }
  }

  update(dt) {
    const S = cfg();
    const fadeIn = S.fadeIn ?? 2.2;
    const fadeOut = S.fadeOut ?? 1.6;

    if (this.amount !== this._target) {
      const rate = this._target > this.amount ? 1 / fadeIn : 1 / fadeOut;
      if (this._target > this.amount) {
        this.amount = Math.min(this._target, this.amount + dt * rate);
      } else {
        this.amount = Math.max(this._target, this.amount - dt * rate);
      }
      this.renderer.setStorm(this.amount);
    }

    if (this.amount < 0.05 && !this.active) {
      this._clearFx();
      this._hideRain();
      return;
    }

    if (this.active && this.amount > 0.35) {
      this._timer -= dt;
      if (this._timer <= 0) {
        this._strike();
        const lo = S.strikeMin ?? 3.2;
        const hi = S.strikeMax ?? 7.5;
        this._timer = lo + Math.random() * (hi - lo);
      }
    }

    this._updateFlashes(dt);
    this._updateBolts(dt);
    this._updateRings(dt);
    this._updatePending(dt);
    this._updateRain(dt);
  }

  /* ------------------------------------------------------------- raios ---- */

  _strike() {
    const S = cfg();
    const listener = this.getListenerPos();
    const bossEnt = this.getBoss();
    const boss = bossEnt?.position ?? null;
    const nearBoss =
      boss && Math.random() < (S.nearBossChance ?? 0.72);

    let x;
    let z;
    if (nearBoss) {
      const ang = Math.random() * Math.PI * 2;
      const rMin = S.nearBossRadiusMin ?? 5;
      const rMax = S.nearBossRadiusMax ?? 26;
      const r = rMin + Math.random() * (rMax - rMin);
      x = boss.x + Math.cos(ang) * r;
      z = boss.z + Math.sin(ang) * r;
    } else {
      const ang = Math.random() * Math.PI * 2;
      const dist = 28 + Math.random() * 60;
      const origin = boss ?? listener;
      x = origin.x + Math.cos(ang) * dist;
      z = origin.z + Math.sin(ang) * dist;
    }

    const groundY = this.heightAt
      ? this.heightAt(x, z)
      : (boss?.y ?? listener.y - 1.2);
    const cloudY = (S.cloudHeight ?? 128) + Math.random() * 18;

    const nearScale = nearBoss ? 1.25 : 1;

    /* Clarões: solo + meio do tronco (revela silhueta) + um no alto. */
    this._flashAt(x, groundY + 3.5, z, 1.15 * nearScale);
    this._flashAt(x, groundY + (nearBoss ? 12 : 18), z, 0.85 * nearScale);
    if (nearBoss && bossEnt) {
      const torsoY =
        boss.y + (bossEnt.bodyHeight ?? 15) * 0.52;
      this._flashAt(boss.x, torsoY, boss.z, 0.95);
    }

    if (Math.random() < (S.doubleChance ?? 0.45)) {
      this._pending.push({
        t: S.doubleDelay ?? 0.1,
        kind: "flash",
        x,
        y: groundY + 5,
        z,
        scale: 0.85 * nearScale,
      });
      if (nearBoss && boss) {
        this._pending.push({
          t: (S.doubleDelay ?? 0.1) + 0.04,
          kind: "flash",
          x: boss.x,
          y: boss.y + (bossEnt.bodyHeight ?? 15) * 0.52,
          z: boss.z,
          scale: 0.8,
        });
      }
    }

    this._spawnBolt(x, cloudY, z, groundY, nearScale);
    this._spawnShockRing(x, groundY + 0.15, z, nearScale);
    this._queueThunder(x, groundY + 2, z, listener, nearBoss);
  }

  _flashAt(x, y, z, scale = 1) {
    const S = cfg();
    const life = S.lightLife ?? 0.22;
    const color = S.lightColor ?? 0xc8e0ff;
    const geo = new THREE.SphereGeometry(2.2 * scale, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 58;
    this.scene.add(mesh);
    this._flashes.push({ mesh, mat, t: 0, life });
  }

  /**
   * Fita zigzag do céu ao chão: núcleo branco + halo azul (additive).
   * `LineBasic` some à distância; malha larga sobrevive ao bloom e à névoa.
   */
  _spawnBolt(x, topY, z, groundY, scale = 1) {
    const S = cfg();
    const segs = 14;
    const points = [];
    let px = x;
    let pz = z;
    for (let i = 0; i <= segs; i++) {
      const p = i / segs;
      points.push(new THREE.Vector3(px, topY + (groundY - topY) * p, pz));
      if (i < segs) {
        const jag = (1 - p * 0.35) * (2.8 + Math.random() * 3.4);
        px += (Math.random() - 0.5) * jag;
        pz += (Math.random() - 0.5) * jag;
      }
    }
    // Garante o pé no ponto de impacto.
    points[points.length - 1].set(x, groundY, z);

    const coreW = (S.boltCoreWidth ?? 0.55) * scale;
    const glowW = (S.boltGlowWidth ?? 2.4) * scale;
    const life = S.boltLife ?? 0.18;

    const core = this._ribbonMesh(points, coreW, this._coreMat.clone());
    const glow = this._ribbonMesh(points, glowW, this._glowMat.clone());
    this.scene.add(glow);
    this.scene.add(core);
    this._bolts.push({ meshes: [glow, core], t: 0, life });

    /* Galho lateral curto — volume e “choque” visual. */
    if (Math.random() < 0.65) {
      const mid = 4 + Math.floor(Math.random() * 5);
      const fork = this._forkPoints(points[mid], groundY + 2 + Math.random() * 8);
      const fCore = this._ribbonMesh(fork, coreW * 0.45, this._coreMat.clone());
      const fGlow = this._ribbonMesh(fork, glowW * 0.45, this._glowMat.clone());
      this.scene.add(fGlow);
      this.scene.add(fCore);
      this._bolts.push({ meshes: [fGlow, fCore], t: 0, life: life * 0.85 });
    }
  }

  _forkPoints(from, endY) {
    const pts = [from.clone()];
    let px = from.x + (Math.random() - 0.5) * 6;
    let pz = from.z + (Math.random() - 0.5) * 6;
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      pts.push(
        new THREE.Vector3(
          px,
          from.y + (endY - from.y) * p,
          pz,
        ),
      );
      px += (Math.random() - 0.5) * 2.5;
      pz += (Math.random() - 0.5) * 2.5;
    }
    return pts;
  }

  _ribbonMesh(points, halfWidth, material) {
    const n = points.length;
    const positions = new Float32Array(n * 2 * 3);
    const indices = [];

    for (let i = 0; i < n; i++) {
      if (i < n - 1) _dir.subVectors(points[i + 1], points[i]);
      else _dir.subVectors(points[i], points[i - 1]);
      _dir.normalize();
      _side.crossVectors(_dir, _up);
      if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
      else _side.normalize();

      _a.copy(points[i]).addScaledVector(_side, halfWidth);
      _b.copy(points[i]).addScaledVector(_side, -halfWidth);
      positions[i * 6] = _a.x;
      positions[i * 6 + 1] = _a.y;
      positions[i * 6 + 2] = _a.z;
      positions[i * 6 + 3] = _b.x;
      positions[i * 6 + 4] = _b.y;
      positions[i * 6 + 5] = _b.z;

      if (i < n - 1) {
        const i0 = i * 2;
        indices.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    return mesh;
  }

  /** Anel no solo no instante do impacto — lê como choque elétrico. */
  _spawnShockRing(x, y, z, scale = 1) {
    const S = cfg();
    const geo = new THREE.RingGeometry(0.4, 1.8 * scale, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = this._ringMat.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 55;
    this.scene.add(mesh);
    this._rings.push({
      mesh,
      t: 0,
      life: S.shockLife ?? 0.28,
      endScale: 7 * scale,
    });
  }

  _queueThunder(x, y, z, listener, nearBoss) {
    const S = cfg();
    const dx = x - listener.x;
    const dy = y - listener.y;
    const dz = z - listener.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const delay = Math.min(1.6, dist / SOUND_SPEED);
    const base = S.thunderVolume ?? 0.7;
    this._pending.push({
      t: delay,
      kind: "sound",
      x,
      y,
      z,
      volume: base * (nearBoss ? 1.05 : 0.85) * (0.85 + Math.random() * 0.25),
    });
  }

  _updateFlashes(dt) {
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i];
      f.t += dt;
      const p = f.t / f.life;
      const env = p < 0.1 ? 1 : (1 - (p - 0.1) / 0.9) ** 2;
      f.mat.opacity = 0.88 * Math.max(0, env);
      if (f.t >= f.life) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mat.dispose();
        this._flashes.splice(i, 1);
      }
    }
  }

  _updateBolts(dt) {
    for (let i = this._bolts.length - 1; i >= 0; i--) {
      const b = this._bolts[i];
      b.t += dt;
      const p = b.t / b.life;
      // Mantém o pico um instante (choque) e some rápido.
      const env = p < 0.18 ? 1 : Math.max(0, 1 - (p - 0.18) / 0.82);
      for (let m = 0; m < b.meshes.length; m++) {
        const mesh = b.meshes[m];
        const base = m === 0 ? 0.55 : 1;
        mesh.material.opacity = base * env;
      }
      if (b.t >= b.life) {
        for (const mesh of b.meshes) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        this._bolts.splice(i, 1);
      }
    }
  }

  _updateRings(dt) {
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const r = this._rings[i];
      r.t += dt;
      const p = Math.min(1, r.t / r.life);
      const s = 1 + (r.endScale - 1) * p;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.7 * (1 - p) * (1 - p);
      if (r.t >= r.life) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this._rings.splice(i, 1);
      }
    }
  }

  _updatePending(dt) {
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      if (p.kind === "flash") {
        this._flashAt(p.x, p.y, p.z, p.scale ?? 0.7);
      } else {
        gameEvents.emit(EventType.AUDIO_PLAY, {
          sound: "thunder",
          position: { x: p.x, y: p.y, z: p.z },
          volume: p.volume,
        });
      }
      this._pending.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------- chuva ---- */

  _ensureRain() {
    const S = cfg();
    if (S.rain === false || this.rain) return;
    const count = S.rainCount ?? 48;
    const pos = new Float32Array(count * 3);
    this._rainVel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
      this._rainVel[i] = 9 + Math.random() * 7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8a9bb0,
      size: 0.045,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      sizeAttenuation: true,
      fog: true,
    });
    this.rain = new THREE.Points(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  _updateRain(dt) {
    if (!this.rain) return;
    const show = this.active && this.amount > 0.4;
    this.rain.visible = show;
    if (!show) return;

    const cam = this.getListenerPos();
    this.rain.position.set(cam.x, cam.y, cam.z);

    const attr = this.rain.geometry.getAttribute("position");
    const arr = attr.array;
    const n = arr.length / 3;
    for (let i = 0; i < n; i++) {
      arr[i * 3 + 1] -= this._rainVel[i] * dt;
      if (arr[i * 3 + 1] < -2) {
        arr[i * 3] = (Math.random() - 0.5) * 14;
        arr[i * 3 + 1] = 8 + Math.random() * 4;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 14;
      }
    }
    attr.needsUpdate = true;
    this.rain.material.opacity = 0.18 + this.amount * 0.14;
  }

  _hideRain() {
    if (this.rain) this.rain.visible = false;
  }

  _clearFx() {
    for (const f of this._flashes) {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mat.dispose();
    }
    this._flashes.length = 0;
    for (const b of this._bolts) {
      for (const mesh of b.meshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    this._bolts.length = 0;
    for (const r of this._rings) {
      this.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
    this._rings.length = 0;
    this._pending.length = 0;
  }

  dispose() {
    this._clearFx();
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      this.rain.material.dispose();
      this.rain = null;
    }
    this._coreMat.dispose();
    this._glowMat.dispose();
    this._ringMat.dispose();
    this.renderer.setStorm(0);
  }
}
