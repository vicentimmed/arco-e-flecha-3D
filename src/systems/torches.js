/* ---------------------------------------------------------------------------
   As quatro tochas do modo zumbi.

   Elas não são cenário: são a REGRA do modo desenhada em luz. O quadrado que
   formam é a única área onde se enxerga, e `safeRadius` mata quem sai dele.
   Por isso cada decisão aqui é de jogo antes de ser de render:

   • QUEBRÁVEIS. Uma flecha apaga a chama e mata a luz dela. É o que dá peso a
     cada tiro no meio da horda — errar o zumbi e acertar a tocha escurece o
     próprio canto de quem errou. E o estado é do SERVIDOR (`room.torches`),
     porque uma tocha apagada numa tela e acesa na outra seriam dois jogos.

   • SEM LUZ POR CANTO. As quatro tochas são chama emissiva (`MeshBasicMaterial`)
     — não `PointLight`. Cinco luzes pontuais (quatro cantos + centro) viravam
     dezenas quando somadas às flechas incendiárias de todos os jogadores, e cada
     zumbi pagava iluminação PBR por luz. Ficou UMA luz central cujo brilho
     escala com quantas tochas ainda estão acesas: apagar um canto escurece o
     quadrado inteiro, mas sem multiplicar luzes dinâmicas.

   • ALCANCE FINITO. `distance` recortado faz a luz morrer numa borda definida em
     metros, e é essa borda que o jogador aprende a ler como "até aqui eu vejo".
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";

const MAT = {
  poste: new THREE.MeshStandardMaterial({ color: "#4a3524", roughness: 0.95 }),
  ferro: new THREE.MeshStandardMaterial({
    color: "#2e2a26",
    roughness: 0.55,
    metalness: 0.6,
  }),
  /* A chama é `MeshBasicMaterial`: ela EMITE, não recebe. Um material iluminado
     ficaria escuro à noite — a chama apareceria preta no meio da própria luz. */
  chama: new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    fog: false,
  }),
  brasa: new THREE.MeshBasicMaterial({ color: 0x3a1c0c, fog: false }),
  /* Halo barato no poste: dá calor visual no canto sem PointLight. */
  glow: new THREE.MeshBasicMaterial({
    color: 0xff9030,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  }),
};

class Torch {
  constructor(scene, physics, terrain, index, x, z) {
    const Z = CONFIG.modes.zombie;
    this.index = index;
    this.lit = true;
    this.phase = Math.random() * Math.PI * 2;

    const y = terrain.heightAt(x, z);
    this.group = new THREE.Group();
    this.group.name = `torch-${index}`;
    this.group.position.set(x, y, z);

    const alturaPoste = Z.torchHeight;

    const poste = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, alturaPoste, 7),
      MAT.poste,
    );
    poste.position.y = alturaPoste / 2;
    poste.castShadow = true;
    this.group.add(poste);

    const cesto = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.12, 0.26, 8, 1, true),
      MAT.ferro,
    );
    cesto.position.y = alturaPoste + 0.1;
    cesto.castShadow = true;
    this.group.add(cesto);

    this.brasa = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), MAT.brasa);
    this.brasa.position.y = alturaPoste + 0.1;
    this.group.add(this.brasa);

    // A chama é um clone do material para cada tocha poder apagar sozinha sem
    // apagar as outras (a opacidade é animada por instância).
    this.chamaMat = MAT.chama.clone();
    this.chama = new THREE.Mesh(
      new THREE.ConeGeometry(0.19, 0.62, 7, 1, true),
      this.chamaMat,
    );
    this.chama.position.y = alturaPoste + 0.36;
    this.chama.renderOrder = 6;
    this.group.add(this.chama);

    this.glowMat = MAT.glow.clone();
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), this.glowMat);
    this.glow.position.y = alturaPoste + 0.36;
    this.glow.renderOrder = 5;
    this.group.add(this.glow);

    scene.add(this.group);

    // Colisor do poste inteiro, para a flecha ter em que acertar.
    const body = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + alturaPoste / 2, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.cylinder(alturaPoste / 2, Z.torchRadius)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    physics.register(this.collider, { kind: "torch", index, name: "tocha" });
    this.body = body;
    this.physics = physics;
    this.scene = scene;
  }

  setLit(lit) {
    if (this.lit === lit) return;
    this.lit = lit;
    this.chama.visible = lit;
    this.glow.visible = lit;
    this.brasa.visible = lit;
  }

  setEnabled(enabled) {
    this.group.visible = enabled;
    this.collider?.setEnabled(enabled);
  }

  update(dt, time) {
    if (!this.lit) return;
    const Z = CONFIG.modes.zombie;
    /* O bruxuleio. Duas senoides incomensuráveis mais um termo rápido: é o que
       impede o olho de achar o período. Um `Math.random()` por quadro daria
       cintilação branca, que lê como problema de render, não como fogo. */
    const t = time + this.phase;
    const f =
      0.82 +
      0.11 * Math.sin(t * 8.3) +
      0.07 * Math.sin(t * 13.7) +
      0.05 * Math.sin(t * 27.1);
    this.chama.scale.set(0.9 + f * 0.2, 0.82 + f * 0.35, 0.9 + f * 0.2);
    this.chamaMat.opacity = 0.8 + f * 0.18;
    this.glowMat.opacity = 0.14 + f * 0.12;
    this.glow.scale.setScalar(0.85 + f * 0.35);
  }

  dispose() {
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.chamaMat.dispose();
    this.glowMat.dispose();
  }
}

/**
 * O quadrado de tochas.
 *
 * Nasce e morre com o modo: `build()` na entrada, `clear()` na saída. Não existe
 * fora do modo zumbi, então nenhum outro modo paga a luz central.
 */
export class TorchRing {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    /** @type {Torch[]} */
    this.torches = [];
    this.centerLight = null;
    this.time = 0;
    this.night = 0;
    this.dormant = false;
  }

  get active() {
    return this.torches.length > 0;
  }

  /** Quatro tochas nos cantos de um quadrado centrado na arena. */
  build({ dormant = false } = {}) {
    if (this.torches.length) {
      if (!dormant) this.activate();
      return;
    }
    this.dormant = dormant;
    const Z = CONFIG.modes.zombie;
    const h = Z.torchHalf;
    // A ordem dos cantos é FIXA e é ela que dá sentido ao índice que viaja na
    // rede: a tocha 0 é a mesma tocha em todas as telas.
    const cantos = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    cantos.forEach(([dx, dz], i) => {
      this.torches.push(
        new Torch(
          this.scene,
          this.physics,
          this.terrain,
          i,
          Z.centerX + dx,
          Z.centerZ + dz,
        ),
      );
      this.torches.at(-1).setEnabled(!dormant);
    });

    // Uma única luz no centro: alcance maior compensa a falta das quatro dos
    // cantos; o brilho escala com quantas tochas ainda estão acesas.
    const yCentro =
      this.terrain.heightAt(Z.centerX, Z.centerZ) + (Z.centerLightHeight ?? 3.2);
    const intensidade =
      (Z.centerLightIntensity ?? 32) * (CONFIG.render.torchIntensityScale ?? 1);
    this.centerLight = new THREE.PointLight(
      Z.torchColor,
      intensidade,
      Z.centerLightRange ?? 17,
      1.8,
    );
    this.centerLight.castShadow = false;
    this.centerLight.position.set(Z.centerX, yCentro, Z.centerZ);
    this.scene.add(this.centerLight);
    this._syncCenterLight();
  }

  /** Torna a preparação invisível jogável sem recriar geometrias ou luz. */
  activate() {
    if (!this.torches.length) return;
    this.dormant = false;
    for (const torch of this.torches) torch.setEnabled(true);
    this._syncCenterLight();
  }

  /**
   * Mostra os meshes durante a compilação dos shaders, mas mantém os colisores
   * desligados. O overlay cobre este único frame de aquecimento.
   */
  setWarmupVisible(visible) {
    if (!this.torches.length) return;
    for (const torch of this.torches) torch.group.visible = visible;
    if (this.centerLight) this.centerLight.visible = true;
  }

  setNight(value) {
    this.night = Math.max(0, Math.min(1, value));
    this._syncCenterLight();
  }

  clear() {
    for (const t of this.torches) t.dispose();
    this.torches.length = 0;
    if (this.centerLight) {
      this.scene.remove(this.centerLight);
      this.centerLight = null;
    }
    this.dormant = false;
    this.night = 0;
  }

  /** Aplica o estado que veio da sala. */
  setStates(estados) {
    if (!estados) return;
    estados.forEach((aceso, i) => this.torches[i]?.setLit(aceso));
    this._syncCenterLight();
  }

  /** Quantas ainda estão acesas — o HUD mostra isso. */
  get litCount() {
    return this.torches.reduce((n, t) => n + (t.lit ? 1 : 0), 0);
  }

  /** Brilho central proporcional às tochas vivas — apagar canto escurece tudo. */
  _syncCenterLight() {
    if (!this.centerLight) return;
    const Z = CONFIG.modes.zombie;
    const base =
      (Z.centerLightIntensity ?? 32) * (CONFIG.render.torchIntensityScale ?? 1);
    const lit = this.litCount;
    const frac = lit === 0 ? 0.1 : 0.42 + 0.58 * (lit / 4);
    this.centerLight.intensity = this.dormant ? 0 : base * frac * this.night;
  }

  update(dt) {
    if (!this.torches.length || this.dormant) return;
    this.time += dt;
    for (const t of this.torches) t.update(dt, this.time);
    this._syncCenterLight();
  }
}
