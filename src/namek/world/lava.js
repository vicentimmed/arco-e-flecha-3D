/* ---------------------------------------------------------------------------
   A lava que sobe pelo buraco.

   Cavar fundo o bastante fura a crosta, e o que estava embaixo aparece. Quem
   decide ONDE é o campo compartilhado (`NamekField.avaliarLava`); este arquivo
   só desenha, e o servidor só cobra vida. Os três chegam à mesma lista sem
   trocar mensagem nenhuma, porque a lista é derivada do relevo e o relevo já é
   sincronizado.

   ------------------------------------------------------------------ o desenho

   Um disco por poça, num `InstancedMesh` — uma chamada de desenho para todas,
   pelo mesmo motivo que o resto do modo instancia tudo (§3 do plano).

   O disco fica numa cota FIXA (`lava.nivel`) e não acompanha o fundo do
   buraco: lava é líquida, e líquido é plano. É a mesma decisão do mar em
   `water.js`, e é ela que faz a poça ler como poça em vez de como uma tinta
   laranja pintada na bacia.

   ------------------------------------------------------------------- a luz

   Nenhuma luz dinâmica, e é o §3 de novo: o jogo tem três, e o cenário e o
   especial do jogador já as gastam. O brilho aqui é EMISSIVO — o material se
   acende sozinho, sem iluminar o que está em volta. A perda é real (uma
   cratera de lava não pinta de laranja a parede do próprio buraco) e o preço
   de consertá-la seria uma quarta luz por poça.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";

/** Teto de poças desenhadas ao mesmo tempo. */
const CAPACIDADE = 48;

/* Duas cores: a lava e a crosta que se forma por cima dela. O contraste entre
   as duas é o que dá movimento — ver `update`. */
const COR_QUENTE = new THREE.Color("#ff7a1e");
const COR_FRIA = new THREE.Color("#8f2408");

const _obj = new THREE.Object3D();
const _cor = new THREE.Color();

export class NamekLava {
  /** @param {import("../../shared/namek/field.js").NamekField} field */
  constructor(field) {
    this.field = field;
    this.mesh = null;
    this.relogio = 0;
    /** As poças que já ganharam instância, na ordem em que nasceram. */
    this.desenhadas = [];
  }

  build(parent) {
    /* Disco de 24 lados. A poça é orgânica, mas o contorno dela é escondido
       pela borda da própria cratera — gastar mais lados aqui compraria uma
       silhueta que ninguém vê. */
    const geo = new THREE.CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a0a03,
      emissive: COR_QUENTE.clone(),
      emissiveIntensity: 1.6,
      roughness: 0.62,
      metalness: 0,
      /* A poça fica no fundo de um buraco e o terreno passa rente a ela; sem
         o deslocamento de profundidade, as duas superfícies brigam pelo mesmo
         pixel e a lava pisca em faixas conforme a câmera anda. */
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACIDADE);
    this.mesh.name = "namek-lava";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    /* Sem culling: a caixa da instância zero não descreve onde as poças estão,
       e o lote inteiro sumiria conforme a câmera gira. */
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    /* As que já existiam quando o mundo foi montado — o caso de quem entra no
       meio da partida, com o chão já cheio de buracos. */
    for (const p of this.field.lavaPools) this.acender(p);
    return this;
  }

  /** Uma poça nasceu (ou cresceu). Ligado em `NamekField.onLava`. */
  acender(poça) {
    if (!this.mesh) return;
    const i = this.desenhadas.indexOf(poça);
    if (i >= 0) {
      this.escrever(i, poça);
      return;
    }
    if (this.desenhadas.length >= CAPACIDADE) return;
    this.desenhadas.push(poça);
    this.escrever(this.desenhadas.length - 1, poça);
    this.mesh.count = this.desenhadas.length;
  }

  escrever(i, poça) {
    const L = NAMEK.destruction.lava;
    _obj.position.set(poça.x, L.nivel, poça.z);
    _obj.rotation.set(0, 0, 0);
    _obj.scale.setScalar(poça.raio);
    _obj.updateMatrix();
    this.mesh.setMatrixAt(i, _obj.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * O pulsar. Não é enfeite: uma poça de cor fixa lê como um decalque laranja
   * colado no chão, e o que a torna líquida é a cor respirando entre a lava e
   * a crosta.
   *
   * Cada poça pulsa com a própria fase (derivada da posição), senão todas
   * acendem juntas e o campo inteiro pisca como um pisca-pisca.
   */
  update(dt) {
    if (!this.mesh || !this.desenhadas.length) return;
    this.relogio += dt;
    for (let i = 0; i < this.desenhadas.length; i++) {
      const p = this.desenhadas[i];
      const fase = p.x * 0.21 + p.z * 0.17;
      const t = 0.5 + 0.5 * Math.sin(this.relogio * 0.9 + fase);
      _cor.copy(COR_FRIA).lerp(COR_QUENTE, 0.45 + 0.55 * t);
      this.mesh.setColorAt(i, _cor);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh = null;
    this.desenhadas = [];
  }
}
