/* ---------------------------------------------------------------------------
   O gerente da chuva de meteoros, no cliente.

   Mesma divisão do `zombieManager` e do `boarManager`: as rochas são do
   SERVIDOR e aqui existe só a casca — criar, atualizar com a pose de 10 Hz e
   descartar. O que este arquivo tem de próprio são duas coisas:

   • **os ESTILHAÇOS, que não matam ninguém.** No meteorito da Lua livre eles
     são letais e o servidor os integra para decidir quem morre. Aqui a rocha
     estourada é uma VITÓRIA, e uma vitória que às vezes mata quem venceu é
     punição por jogar bem — então a sala nem os integra: manda a semente, e
     este lado desenha. Custa menos do que o modo antigo.

   • **o CASCALHO QUE FICA.** Os pedaços assentam e ficam vinte e cinco segundos
     no chão em vez de quatro. Ao longo de uma partida o terreno em volta da
     base vai ficando coberto — é o placar da noite, escrito no chão, e custa
     UMA chamada de desenho porque tudo é um lote instanciado.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { gameEvents, EventType } from "../core/events.js";
import { FallingMeteor } from "../entities/fallingMeteor.js";
import {
  criarEstilhacos,
  passoEstilhaco,
  opacidadeEstilhaco,
} from "../shared/fragments.js";

export class MeteorRainManager {
  constructor(scene, physics, terrain, arrows = null) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.arrows = arrows;
    /** @type {Map<number, FallingMeteor>} id da sala → casca local */
    this.byNetId = new Map();
    /** Pedaços em voo e no chão — a mesma conta do servidor, só que para ver. */
    this.estilhacos = [];
    this.fragMesh = null;
    this.vagasFrag = null;
    this._warmups = [];
    this._cam = new THREE.Vector3();
  }

  get rochas() {
    return [...this.byNetId.values()];
  }

  /**
   * A rocha mais perto do chão. É ela que o alerta da tela persegue — três
   * setas ao mesmo tempo seriam ruído, e a que importa é sempre esta.
   */
  maisPerigosa() {
    let melhor = null;
    let menor = Infinity;
    for (const m of this.byNetId.values()) {
      const alt = m.altitude;
      if (alt < menor) {
        menor = alt;
        melhor = m;
      }
    }
    return melhor;
  }

  /** A amostra de 10 Hz da sala: cria o que é novo, some com o que sumiu. */
  applyNetwork(lista) {
    if (!lista) return;
    const vistos = new Set();

    for (const it of lista) {
      vistos.add(it.i);
      let m = this.byNetId.get(it.i);
      if (!m) {
        m = new FallingMeteor(this.scene, this.physics, it.i, it.r, it.f, it.k);
        this.byNetId.set(it.i, m);
        if (it.a) m.setImpactPoint(it.a[0], it.a[1], it.a[2]);
      }
      if (it.hp != null) m.setHealth(it.hp);
      m.setNetworkTarget(it.p[0], it.p[1], it.p[2]);
    }

    for (const [id, m] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      /* Sumiu da lista sem um `METEOR_BURST`: ou o especial a vaporizou, ou a
         partida acabou. Some sem estouro — quem estoura é o evento. */
      this.byNetId.delete(id);
      this.arrows?.removeAttachedTo(m);
      m.dispose(this.scene);
    }
  }

  /** Alguém acertou esta rocha: ela pisca em todas as telas. */
  hit(id) {
    this.byNetId.get(id)?.piscar();
  }

  /**
   * A rocha se partiu.
   *
   * Explosão, cascalho e som. Os estilhaços saem da MESMA conta e da MESMA
   * semente que o servidor usaria — só que aqui ninguém morre por eles.
   */
  burst(msg) {
    const M = CONFIG.modes.meteorRain;
    const p = { x: msg.p[0], y: msg.p[1], z: msg.p[2] };
    const raio = msg.r ?? 3;
    const tank = msg.tank === true;

    const m = this.byNetId.get(msg.id);
    if (m) {
      this.byNetId.delete(msg.id);
      this.arrows?.removeAttachedTo(m);
      m.dispose(this.scene);
    }

    /* Fogo, fumaça e o baque. A escala sai do RAIO: uma pedra de 12 m que
       estoura com o mesmo punhado de partículas de uma de 5 lê como uma pedra
       pequena que explodiu perto. */
    const k = raio / 4;
    gameEvents.emit(EventType.PARTICLES, {
      position: p,
      count: Math.min(160, Math.round(70 * k)),
      color: 0xffb340,
      speed: 16 + raio * 2,
      spread: 1,
      size: raio * 0.32,
      grow: 2.6,
      life: 1.7,
      gravity: -1.62,
      drag: 0.5,
      alpha: 1,
    });
    gameEvents.emit(EventType.PARTICLES, {
      position: p,
      count: Math.min(110, Math.round(45 * k)),
      color: 0x5a5a5a,
      speed: 8 + raio,
      spread: 1,
      size: raio * 0.5,
      grow: 3.2,
      life: 2.8,
      gravity: -0.4,
      drag: 0.8,
      alpha: 0.55,
    });
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "explosion",
      position: p,
      volume: tank ? 0.95 : 0.55,
    });
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "rockBurst",
      position: p,
      volume: 0.6,
    });

    this.spawnEstilhacos(p, msg.seed, raio);
  }

  /** O perfil de estilhaço DESTA rocha — número e tamanho saem do raio dela. */
  fragCfg(raio) {
    const B = CONFIG.modes.meteorRain.burst;
    return {
      fragCount: Math.min(B.fragCountMax, Math.max(6, Math.round(raio * B.fragPerRadius))),
      fragRaioMin: raio * B.fragRaioMin,
      fragRaioMax: raio * B.fragRaioMax,
      fragSpeedMin: B.fragSpeedMin,
      fragSpeedMax: B.fragSpeedMax,
      fragKillSpeed: B.fragKillSpeed,
      fragRestitution: B.fragRestitution,
      fragSettleTime: B.fragSettleTime,
      fragFadeTime: B.fragFadeTime,
    };
  }

  spawnEstilhacos(origem, seed, raio) {
    const cfg = this.fragCfg(raio);
    this.prepararLote();
    const novos = criarEstilhacos(origem, seed >>> 0, cfg);
    for (const f of novos) {
      let vaga = this.vagasFrag.pop();
      if (vaga === undefined) {
        /* Sem vaga: recicla o pedaço mais VELHO em vez de perder o novo. O
           cascalho é acumulativo por desenho, e num modo em que ele fica 25 s
           no chão o lote enche — o certo é o mais antigo sumir, não o estouro
           de agora não aparecer. */
        const velho = this.estilhacos.shift();
        if (!velho) break;
        vaga = velho.vaga;
      }
      f.vaga = vaga;
      f.cfg = cfg;
      this.estilhacos.push(f);
    }
  }

  /** O lote instanciado, criado no primeiro estouro e reaproveitado depois. */
  prepararLote() {
    if (this.fragMesh) return;
    const B = CONFIG.modes.meteorRain.burst;
    this.fragGeo = new THREE.IcosahedronGeometry(1, 0);
    this.fragMat = new THREE.MeshStandardMaterial({
      color: "#7a7169",
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
      transparent: true,
    });
    this.fragMesh = new THREE.InstancedMesh(this.fragGeo, this.fragMat, B.debrisMax);
    this.fragMesh.castShadow = true;
    // Os pedaços se espalham por dezenas de metros; a caixa do lote não
    // acompanha isso, e o teto de custo já é a capacidade.
    this.fragMesh.frustumCulled = false;
    this.scene.add(this.fragMesh);

    this._m4 = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._esc = new THREE.Vector3();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);

    this.vagasFrag = [];
    for (let i = B.debrisMax - 1; i >= 0; i--) {
      this.fragMesh.setMatrixAt(i, this._zero);
      this.vagasFrag.push(i);
    }
    this.fragMesh.instanceMatrix.needsUpdate = true;
  }

  esconderEstilhaco(f) {
    if (f.vaga === undefined || !this.fragMesh) return;
    this.fragMesh.setMatrixAt(f.vaga, this._zero);
    this.vagasFrag.push(f.vaga);
    f.vaga = undefined;
  }

  update(dt, camera) {
    if (camera) camera.getWorldPosition(this._cam);
    for (const m of this.byNetId.values()) m.update(dt, camera);

    if (!this.estilhacos.length) return;

    const g = CONFIG.levels.moon.gravity;
    const heightAt = (x, z) => this.terrain.heightAt(x, z);
    let opacidade = 1;
    for (let i = this.estilhacos.length - 1; i >= 0; i--) {
      const f = this.estilhacos[i];
      if (passoEstilhaco(f, dt, g, heightAt, f.cfg)) {
        this.esconderEstilhaco(f);
        this.estilhacos.splice(i, 1);
        continue;
      }
      this._euler.set(f.rotX, 0, f.rotZ);
      this._quat.setFromEuler(this._euler);
      this._pos.set(f.x, f.y, f.z);
      this._esc.setScalar(f.raio);
      this._m4.compose(this._pos, this._quat, this._esc);
      this.fragMesh.setMatrixAt(f.vaga, this._m4);
      // O fade é do material compartilhado: o pedaço mais NOVO manda, senão o
      // cascalho velho apagaria o estouro de agora.
      opacidade = Math.min(opacidade, 1);
    }
    const maisNovo = this.estilhacos[this.estilhacos.length - 1];
    if (maisNovo && this.fragMat) {
      this.fragMat.opacity = opacidadeEstilhaco(maisNovo, maisNovo.cfg);
    }
    this.fragMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Constrói uma rocha de cada tamanho durante a tela de preparação.
   *
   * Mesmo motivo do `ZombieManager.prepare`: os meshes ficam vivos e ocultos em
   * vez de serem criados e destruídos, então a primeira rocha real reaproveita
   * os programas já compilados sem gerar um pico de shader no instante em que a
   * chuva começa — que num modo com prazo é o pior instante possível.
   */
  prepare() {
    if (this._warmups.length) return;
    const M = CONFIG.modes.meteorRain;
    const amostras = [...M.classes.map((c, i) => [c.raio, i, c.hits]), [M.tankRaio, 0, 10]];
    for (const [raio, formato, hits] of amostras) {
      const m = new FallingMeteor(this.scene, this.physics, -(this._warmups.length + 1), raio, formato, hits);
      m.collider?.setEnabled(false);
      m.group.visible = false;
      m.marca.visible = false;
      this._warmups.push(m);
    }
  }

  setWarmupVisible(visible) {
    for (const m of this._warmups) {
      m.group.visible = visible;
      m.marca.visible = false;
    }
  }

  clearWarmups() {
    for (const m of this._warmups) m.dispose(this.scene);
    this._warmups = [];
  }

  clear() {
    for (const m of this.byNetId.values()) {
      this.arrows?.removeAttachedTo(m);
      m.dispose(this.scene);
    }
    this.byNetId.clear();
    this.clearWarmups();
    for (const f of this.estilhacos) this.esconderEstilhaco(f);
    this.estilhacos = [];
  }

  dispose() {
    this.clear();
    if (this.fragMesh) {
      this.scene.remove(this.fragMesh);
      this.fragMesh.dispose();
      this.fragMesh = null;
    }
    this.fragGeo?.dispose();
    this.fragMat?.dispose();
    this.fragGeo = null;
    this.fragMat = null;
    this.vagasFrag = null;
  }
}
