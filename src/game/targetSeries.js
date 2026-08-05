/* ---------------------------------------------------------------------------
   Alvos em série — a parte visível.

   O servidor diz onde está o alvo da vez; aqui ele é montado, apontado e
   explodido.

   Três decisões:

   1. A SETA É SÓ VISUAL. Ela não tem colisor e não conta como acerto. Existe
      porque um alvo de 1 m a 250 m ocupa quatro pixels: sem uma marca no céu
      apontando para baixo, encontrar o alvo viraria a dificuldade do modo — e
      a dificuldade tem de estar no TIRO, não em achar onde atirar.

   2. A seta cresce com a distância, como as etiquetas de nome, para continuar
      legível no fim da série. Acima dela, o número de metros até a linha de
      tiro — o mesmo número que a mensagem de acerto usa.

   3. A explosão é de partículas simples e some sozinha. Ela não é enfeite: com
      um alvo a 250 m, sem um estouro visível você não sabe se acertou ou se a
      flecha passou de raspão.

   4. A LINHA NO CHÃO. Uma faixa bem visível à frente dos arqueiros: é o limite
      do campo de tiro. Andar além dela anularia o modo (chegar perto e atirar).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { pathCenterX } from "../shared/terrainField.js";

const _cam = new THREE.Vector3();

export class TargetSeriesView {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.target = null; // { seq, group, body, collider, ... }
    this.explosions = [];
    this.marker = null;
    this.fence = null;
  }

  get active() {
    return this.target !== null;
  }

  /** O alvo da vez, como o servidor o descreve. */
  setTarget(info) {
    if (!info) {
      this.removeTarget();
      // Sem alvo mas ainda no modo: a cerca permanece até clear().
      return;
    }
    if (this.target?.seq === info.seq) return;
    this.removeTarget();
    this.target = this.build(info);
    this.ensureFence();
    this.updateDistanceLabel(info.distance);
  }

  /** Mostra a linha no chão (entrada no modo série). */
  showFence() {
    this.ensureFence();
  }

  build(info) {
    const R = CONFIG.target.faceRadius;
    const grupo = new THREE.Group();
    grupo.position.set(info.x, info.y, info.z);

    // Face do alvo, virada para a linha de tiro (+Z).
    const face = new THREE.Group();
    face.position.y = R + 0.35;
    grupo.add(face);

    const anelCores = ["#f4f1ea", "#111318", "#3d8ce2", "#d94b3d", "#f5c451"];
    for (let i = 0; i < 5; i++) {
      const raio = R * (1 - i * 0.2);
      const disco = new THREE.Mesh(
        new THREE.CylinderGeometry(raio, raio, 0.1 + i * 0.004, 26),
        new THREE.MeshStandardMaterial({ color: anelCores[i], roughness: 0.85 }),
      );
      disco.rotation.x = Math.PI / 2;
      disco.position.z = i * 0.004;
      disco.castShadow = i === 0;
      face.add(disco);
    }

    // Tripé simples.
    for (const lado of [-1, 1]) {
      const perna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.045, R + 0.4, 6),
        new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.9 }),
      );
      perna.position.set(lado * R * 0.55, (R + 0.4) / 2, 0);
      perna.rotation.z = lado * 0.18;
      perna.castShadow = true;
      grupo.add(perna);
    }

    this.scene.add(grupo);

    // Colisor: um disco fino no lugar da face. Fixo — este alvo não tomba,
    // ele explode.
    const body = this.physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(info.x, info.y + R + 0.35, info.z),
    );
    const collider = this.physics.createCollider(
      RAPIER.ColliderDesc.cylinder(0.09, R)
        .setRotation(quatFromAxisAngle(1, 0, 0, Math.PI / 2))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.physics.register(collider, {
      kind: "seriesTarget",
      seq: info.seq,
      name: "alvo da série",
      series: info,
    });

    return { seq: info.seq, info, group: grupo, body, collider };
  }

  removeTarget() {
    if (!this.target) return;
    this.physics.unregister(this.target.collider);
    this.physics.removeBody(this.target.body);
    this.scene.remove(this.target.group);
    this.target.group.traverse((o) => o.geometry?.dispose());
    this.target = null;
  }

  clear() {
    this.removeTarget();
    this.hideMarker();
    this.hideFence();
  }

  /* ---------------------------------------------------------------- cerca --- */

  ensureFence() {
    if (this.fence) {
      this.fence.group.visible = true;
      return this.fence;
    }
    const S = CONFIG.modes.series;
    const z = S.startZ;
    const largura = S.fenceWidth ?? 48;
    const cx = pathCenterX(z);
    const y = this.terrain.heightAt(cx, z);

    const grupo = new THREE.Group();
    grupo.name = "series-fence";

    // Faixa no chão: larga, amarela, bem visível de qualquer ângulo.
    const faixa = new THREE.Mesh(
      new THREE.PlaneGeometry(largura, 0.55),
      new THREE.MeshBasicMaterial({
        color: 0xf5c451,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    faixa.rotation.x = -Math.PI / 2;
    faixa.position.set(cx, y + 0.06, z);
    faixa.renderOrder = 4;
    grupo.add(faixa);

    // Contorno escuro para contrastar com grama clara e pedra.
    const borda = new THREE.Mesh(
      new THREE.PlaneGeometry(largura + 0.3, 0.85),
      new THREE.MeshBasicMaterial({
        color: 0x1a1208,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    borda.rotation.x = -Math.PI / 2;
    borda.position.set(cx, y + 0.04, z);
    borda.renderOrder = 3;
    grupo.add(borda);

    // Postes baixos nas pontas — reforçam a leitura de "linha de tiro".
    for (const lado of [-1, 1]) {
      const poste = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 0.9, 6),
        new THREE.MeshStandardMaterial({ color: "#c9a227", roughness: 0.7 }),
      );
      poste.position.set(cx + lado * (largura * 0.48), y + 0.45, z);
      poste.castShadow = true;
      grupo.add(poste);
    }

    this.scene.add(grupo);
    this.fence = { group: grupo, z };
    return this.fence;
  }

  hideFence() {
    if (!this.fence) return;
    this.scene.remove(this.fence.group);
    this.fence.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.fence = null;
  }

  /* ---------------------------------------------------------------- seta --- */

  ensureMarker() {
    if (this.marker) return this.marker;
    const grupo = new THREE.Group();

    const material = new THREE.MeshBasicMaterial({
      color: 0xf5c451,
      transparent: true,
      opacity: 0.92,
      // Sem teste de profundidade: a seta atravessa árvore e encosta. Ela é o
      // indicador de "o alvo é ali", e um indicador que some atrás do cenário
      // não indica nada.
      depthTest: false,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 5), material);
    cone.rotation.x = Math.PI; // ponta para baixo
    grupo.add(cone);
    const haste = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 1.1, 5),
      material,
    );
    haste.position.y = 1.1;
    grupo.add(haste);

    // Distância em metros, acima da seta — mesmo número medido da linha no chão.
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.center.set(0.5, 0);
    sprite.position.y = 2.4;
    sprite.renderOrder = 10;
    grupo.add(sprite);

    grupo.renderOrder = 9;
    this.scene.add(grupo);
    this.marker = {
      group: grupo,
      material,
      labelCanvas: canvas,
      labelTexture: texture,
      labelSprite: sprite,
      labelMat: spriteMat,
      lastDistance: null,
    };
    return this.marker;
  }

  updateDistanceLabel(distance) {
    const marca = this.ensureMarker();
    const metros = Math.round(distance);
    if (marca.lastDistance === metros) return;
    marca.lastDistance = metros;

    const ctx = marca.labelCanvas.getContext("2d");
    const W = marca.labelCanvas.width;
    const H = marca.labelCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const texto = `${metros} m`;
    ctx.font = "700 52px Nunito, 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(8, 10, 14, 0.92)";
    ctx.strokeText(texto, W / 2, H / 2);
    ctx.fillStyle = "#f5c451";
    ctx.fillText(texto, W / 2, H / 2);
    marca.labelTexture.needsUpdate = true;
  }

  hideMarker() {
    if (this.marker) this.marker.group.visible = false;
  }

  /* -------------------------------------------------------------- explosão -- */

  /** Estouro no ponto do acerto — a confirmação visual a 250 m de distância. */
  explode(x, y, z, color = 0xf5c451) {
    const geo = new THREE.SphereGeometry(0.32, 7, 6);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const grupo = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(geo, mat);
      const ang = Math.random() * Math.PI * 2;
      const alt = Math.random() * Math.PI - Math.PI / 2;
      const v = 5 + Math.random() * 9;
      m.userData.vel = new THREE.Vector3(
        Math.cos(ang) * Math.cos(alt) * v,
        Math.sin(alt) * v + 3,
        Math.sin(ang) * Math.cos(alt) * v,
      );
      grupo.add(m);
    }
    grupo.position.set(x, y, z);
    grupo.userData = { life: 0, material: mat, geometry: geo };
    this.scene.add(grupo);
    this.explosions.push(grupo);
  }

  update(dt, camera) {
    // Seta pairando sobre o alvo, escalada para continuar visível de longe.
    if (this.target) {
      const marca = this.ensureMarker();
      const info = this.target.info;
      marca.group.visible = true;
      camera.getWorldPosition(_cam);
      const dist = Math.hypot(_cam.x - info.x, _cam.y - info.y, _cam.z - info.z);
      // Mesma ideia da etiqueta de nome: crescer com a distância anula a
      // perspectiva e o tamanho na tela fica constante.
      const escala = THREE.MathUtils.clamp(dist * 0.028, 1, 9);
      marca.group.scale.setScalar(escala);
      // Sobe junto com a escala para a ponta não entrar no alvo.
      const altura = CONFIG.modes.series.markerHeight + escala * 0.5;
      marca.group.position.set(info.x, info.y + altura, info.z);
      // Balanço lento: movimento é o que o olho encontra num horizonte parado.
      marca.group.position.y += Math.sin(performance.now() * 0.0022) * escala * 0.18;

      // O sprite da distância já escala com o grupo; ajusta a proporção do
      // retângulo do canvas para a letra não ficar esmagada.
      const spr = marca.labelSprite;
      spr.scale.set(2.4 * (256 / 96), 2.4, 1);
    } else {
      this.hideMarker();
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.userData.life += dt;
      const k = e.userData.life / CONFIG.modes.series.explosionTime;
      for (const m of e.children) {
        m.position.addScaledVector(m.userData.vel, dt);
        m.userData.vel.y -= 11 * dt;
        m.scale.setScalar(Math.max(0.05, 1 - k));
      }
      e.userData.material.opacity = Math.max(0, 1 - k);
      if (k < 1) continue;
      this.scene.remove(e);
      e.userData.material.dispose();
      e.userData.geometry.dispose();
      this.explosions.splice(i, 1);
    }
  }
}

function quatFromAxisAngle(x, y, z, angle) {
  const s = Math.sin(angle / 2);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(angle / 2) };
}
