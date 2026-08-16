/* ---------------------------------------------------------------------------
   OS PODERES — a bola de ki e o feixe, do lado do cliente.

   Dois golpes, e eles existem para exercitar as duas maneiras de escavar que o
   pedido descreve:

     A BOLA   um tiro, uma bacia. É com ela que se ESCULPE: o túnel toma a forma
              que o jogador quiser, porque cada tiro cava onde ele apontou.
     O FEIXE  entra na rocha e continua, deixando uma fila de bacias. É com ele
              que se ATRAVESSA um morro de uma vez.

   O que os dois têm em comum é o que importa: **nenhum deles para em rocha
   solta**. Só o campo os detém — pedra de cenário é vítima do raio da cratera,
   não obstáculo (ver `rochas.js`). E os dois enxergam o terreno como ele estava
   quando saíram, e não os próprios buracos: sem isso a cabeça do feixe se
   encontraria dentro da bacia recém-aberta e concluiria que saiu da montanha,
   recomeçando a entrada a cada quadro.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { espacamentoApos } from "./escavar.js";
import { METADE, FUNDO, TETO_MUNDO } from "./campo.js";

const MAX_TIROS = 40;

export class Poderes {
  /**
   * @param {THREE.Object3D} raiz
   * @param {import("./campo.js").CampoCratera} campo
   * @param {(imp:object)=>void} aoAcertar chamado com o impacto a escavar
   */
  constructor(raiz, campo, aoAcertar) {
    this.campo = campo;
    this.aoAcertar = aoAcertar;

    const geo = new THREE.SphereGeometry(1, 12, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_TIROS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    raiz.add(this.mesh);

    this.luz = new THREE.PointLight(0x9fe8ff, 0, 60, 2);
    raiz.add(this.luz);

    this.tiros = [];
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  /**
   * Dispara.
   *
   * @param {"bola"|"feixe"} tipo
   */
  disparar(tipo, ox, oy, oz, dx, dy, dz) {
    if (this.tiros.length >= MAX_TIROS) return;
    const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const bola = tipo === "bola";
    this.tiros.push({
      x: ox,
      y: oy,
      z: oz,
      dx: dx / m,
      dy: dy / m,
      dz: dz / m,
      vel: bola ? 120 : 190,
      /* O CUSTO DE ESCAVAR CRESCE COM O CUBO DO RAIO, e é ele que decide se o
         quadro engasga: a caixa de voxels varrida é (2·alcance/voxel)³. Medido,
         com o caminho já otimizado: raio 6 custa 31 ms e raio 5 custa 18 —
         quase dois quadros de diferença por bacia, e o feixe abre uma por
         quadro. A perda de tamanho é pequena e o ganho é o tiro não travar. */
      raio: bola ? 4 : 5,
      visual: bola ? 1.5 : 2.4,
      vida: 3.4,
      /* O feixe PERFURA: continua dentro da rocha por um orçamento de metros,
         deixando bacias. A bola para na primeira. */
      perfura: bola ? 0 : 150,
      furando: false,
      andado: 0,
      proxFuro: 0,
      primeira: true,
    });
    this.mesh.count = this.tiros.length;
  }

  update(dt) {
    const campo = this.campo;
    const h = Math.min(0.05, dt);
    let brilho = 0;

    for (let i = this.tiros.length - 1; i >= 0; i--) {
      const t = this.tiros[i];
      t.vida -= h;

      /* Subpassos pelo mesmo motivo do lutador: a 190 m/s a cabeça anda três
         metros por quadro, e a bacia mais estreita tem uns seis. */
      const passos = Math.max(1, Math.ceil((t.vel * h) / 1.5));
      const ph = h / passos;
      let morreu = t.vida <= 0;

      for (let k = 0; k < passos && !morreu; k++) {
        const nx = t.x + t.dx * t.vel * ph;
        const ny = t.y + t.dy * t.vel * ph;
        const nz = t.z + t.dz * t.vel * ph;
        const avanco = t.vel * ph;
        t.andado += avanco;

        if (t.furando) {
          t.x = nx;
          t.y = ny;
          t.z = nz;
          if (this.foraDaArena(t)) {
          morreu = true;
          continue;
        }
        if (t.andado >= t.proxFuro) {
            const c = this.cavar(t, false);
            t.proxFuro = t.andado + espacamentoApos(c ? c.id : k, t.raio);
          }
          t.perfura -= avanco;
          /* Saiu da rocha? Volta a voar livre — e é assim que ele atravessa um
             morro e continua para o próximo. */
          if (!campo.solidoEm(t.x, t.y, t.z)) {
            this.cavar(t, false); // a bacia de SAÍDA, que rompe a casca fina
            t.furando = false;
          } else if (t.perfura <= 0) {
            morreu = true;
          }
          continue;
        }

        if (campo.solidoEm(nx, ny, nz)) {
          t.x = nx;
          t.y = ny;
          t.z = nz;
          this.cavar(t, t.primeira);
          t.primeira = false;
          if (t.perfura > 0) {
            t.furando = true;
            t.proxFuro = t.andado + espacamentoApos(1, t.raio);
          } else {
            morreu = true;
          }
          continue;
        }

        t.x = nx;
        t.y = ny;
        t.z = nz;
        /* Saiu da arena: morre. O campo recusa escavação lá fora (ver
           `campo.escavar`), então continuar voando seria só gastar quadro. */
        if (this.foraDaArena(t)) morreu = true;
      }

      if (morreu) {
        this.tiros.splice(i, 1);
        continue;
      }
      brilho = Math.max(brilho, t.visual);
      this._p.set(t.x, t.y, t.z);
      this._s.setScalar(t.visual);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      if (i === 0) this.luz.position.set(t.x, t.y, t.z);
    }

    this.mesh.count = this.tiros.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.luz.intensity = this.tiros.length > 0 ? 90 * brilho : 0;
  }

  /** m — folga além da borda, para o tiro não sumir exatamente na parede. */
  foraDaArena(t) {
    const F = 6;
    return (
      t.x < -METADE - F ||
      t.x > METADE + F ||
      t.z < -METADE - F ||
      t.z > METADE + F ||
      t.y < FUNDO - F ||
      t.y > TETO_MUNDO + F
    );
  }

  cavar(t, boca) {
    return this.aoAcertar({
      x: t.x,
      y: t.y,
      z: t.z,
      dx: t.dx,
      dy: t.dy,
      dz: t.dz,
      raio: t.raio,
      boca,
    });
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
