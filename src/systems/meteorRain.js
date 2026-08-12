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

   • **as LASCAS EM ÓRBITA.** Cada flechada arranca brasas que não caem: elas
     acompanham a rocha, girando em volta dela até a explosão final. São a
     barra de vida do modo — contáveis a duzentos metros, ao contrário do
     escurecimento do material, que só se lê de perto. Outro lote instanciado,
     mais UMA chamada de desenho para todas as rochas somadas.
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
    /** Lascas em brasa girando em volta das rochas que já apanharam. */
    this.lascas = [];
    this.lascaMesh = null;
    this.vagasLasca = null;
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

  /** Alguém acertou esta rocha: ela pisca em todas as telas — e solta brasas. */
  hit(id) {
    const m = this.byNetId.get(id);
    if (!m) return;
    m.piscar();
    this.soltarLascas(m);
  }

  /**
   * A flechada arrancou pedaços, e eles ficam.
   *
   * Cada lasca guarda um ÂNGULO e um raio de órbita, não uma posição: quem tem
   * posição é a rocha, e a lasca é sempre "aquele ponto em volta dela". É por
   * isso que elas acompanham a queda de graça, sem integrar velocidade nenhuma
   * e sem nunca ficarem para trás de uma rocha que desce a 24 m/s.
   *
   * O plano de cada órbita é inclinado por conta própria (`tiltMax`): com todas
   * no mesmo plano a rocha ganharia um anel de Saturno, que lê como enfeite. O
   * que se quer é uma nuvem de escombro acompanhando o tombo.
   */
  soltarLascas(m) {
    const C = CONFIG.modes.meteorRain.chips;
    this.prepararLascas();

    const n = Math.max(
      C.perHitMin,
      Math.min(C.perHitMax, Math.round(m.raio * C.perRadius)),
    );
    const faixa = (a, b) => a + Math.random() * (b - a);

    for (let i = 0; i < n; i++) {
      let vaga = this.vagasLasca.pop();
      if (vaga === undefined) {
        /* Sem vaga: recicla a MAIS VELHA. O teto é do lote inteiro, então numa
           partida com o colosso em campo ele é atingido o tempo todo — e a
           coisa certa a perder é a brasa de trás, não a que acabou de sair. */
        const velha = this.lascas.shift();
        if (!velha) break;
        vaga = velha.vaga;
      }
      this.lascas.push({
        vaga,
        netId: m.netId,
        dono: m,
        /* PISO E TETO EM METROS por cima da fração.
           A fração sozinha dava lascas de meio pixel na pedra pequena (que é a
           mais comum) e de três metros no colosso — invisível de um lado,
           "segunda rocha" do outro. Ver o bloco `chips` no config. */
        raio: Math.min(
          C.raioMaxAbs,
          Math.max(C.raioMinAbs, m.raio * faixa(C.raioMin, C.raioMax)),
        ),
        // Em unidades de RAIO DA ROCHA: assim a mesma conta serve para a pedra
        // de 2,5 m e para o colosso de 14.
        orbita: faixa(C.orbitMin, C.orbitMax),
        ang: Math.random() * Math.PI * 2,
        vel: faixa(C.spinMin, C.spinMax) * (Math.random() < 0.5 ? -1 : 1),
        tilt: faixa(-C.tiltMax, C.tiltMax),
        fase: Math.random() * Math.PI * 2,
        rotX: Math.random() * Math.PI * 2,
        rotZ: Math.random() * Math.PI * 2,
        girX: faixa(-C.tumbleMax, C.tumbleMax),
        girZ: faixa(-C.tumbleMax, C.tumbleMax),
      });
    }
  }

  /** O lote das lascas. Mesma estratégia do cascalho: uma chamada para todas. */
  prepararLascas() {
    if (this.lascaMesh) return;
    const C = CONFIG.modes.meteorRain.chips;
    const M = CONFIG.modes.meteorRain;
    this.lascaGeo = new THREE.IcosahedronGeometry(1, 0);
    /* EM BRASA, e por isso emissiva: a lasca é pequena e o céu da Lua é preto —
       uma pedra apenas difusa a duzentos metros do único Sol é invisível, que é
       a mesma razão pela qual a rocha inteira emite (ver `fallingMeteor.js`).
       As chaves do material acompanham as do cascalho (`flatShading`,
       `transparent`) para as duas caírem no mesmo programa de shader. */
    this.lascaMat = new THREE.MeshStandardMaterial({
      color: 0x2e2119,
      emissive: new THREE.Color(M.fireColor),
      /* Mais quente que a própria rocha (que anda entre 1,5 e 3,7): a lasca é
         uma ordem de grandeza menor e precisa passar do `bloomThreshold` para
         que o passe de pós a espalhe em alguns pixels. É o mesmo truque que faz
         o halo segurar a leitura da rocha no preset sem bloom, e sem custar uma
         luz dinâmica. */
      emissiveIntensity: 3.6,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
      transparent: true,
    });
    this.lascaMesh = new THREE.InstancedMesh(this.lascaGeo, this.lascaMat, C.max);
    this.lascaMesh.castShadow = false;
    // Elas viajam de 200 m de altura até o chão; a caixa do lote não descreve
    // isso, e o teto de custo já é a capacidade.
    this.lascaMesh.frustumCulled = false;
    this.scene.add(this.lascaMesh);

    this._m4l = new THREE.Matrix4();
    this._posl = new THREE.Vector3();
    this._quatl = new THREE.Quaternion();
    this._eulerl = new THREE.Euler();
    this._escl = new THREE.Vector3();
    this._zerol = new THREE.Matrix4().makeScale(0, 0, 0);

    this.vagasLasca = [];
    for (let i = C.max - 1; i >= 0; i--) {
      this.lascaMesh.setMatrixAt(i, this._zerol);
      this.vagasLasca.push(i);
    }
    this.lascaMesh.instanceMatrix.needsUpdate = true;
  }

  esconderLasca(l) {
    if (l.vaga === undefined || !this.lascaMesh) return;
    this.lascaMesh.setMatrixAt(l.vaga, this._zerol);
    this.vagasLasca.push(l.vaga);
    l.vaga = undefined;
  }

  /**
   * Um passo das lascas.
   *
   * A dona é reconferida pelo MAPA, não por uma bandeira no objeto: a rocha sai
   * de `byNetId` por três caminhos diferentes (estourou, o especial vaporizou,
   * a partida acabou) e um deles esquecido seria uma brasa girando em volta de
   * nada até o fim da sessão. Uma consulta por lasca — no máximo noventa — é
   * mais barata que a chance de vazar.
   */
  passoLascas(dt) {
    if (!this.lascas.length) return;
    const C = CONFIG.modes.meteorRain.chips;

    for (let i = this.lascas.length - 1; i >= 0; i--) {
      const l = this.lascas[i];
      if (this.byNetId.get(l.netId) !== l.dono) {
        this.esconderLasca(l);
        this.lascas.splice(i, 1);
        continue;
      }

      l.ang += l.vel * dt;
      // A coroa ABRE devagar, com teto: sem o teto, uma rocha que apanha vinte
      // flechas terminaria com as brasas a cinquenta metros dela.
      l.orbita = Math.min(C.orbitMaxScale, l.orbita + C.orbitDrift * dt);
      l.rotX += l.girX * dt;
      l.rotZ += l.girZ * dt;

      const R = l.dono.raio * l.orbita;
      const cx = Math.cos(l.ang) * R;
      const cz = Math.sin(l.ang) * R;
      // O plano inclinado: o mesmo círculo, girado em torno do eixo X pelo
      // `tilt` da lasca. Duas linhas, e some o anel de Saturno.
      const p = l.dono.group.position;
      this._posl.set(
        p.x + cx,
        p.y + cz * Math.sin(l.tilt) + Math.sin(l.fase) * l.dono.raio * 0.15,
        p.z + cz * Math.cos(l.tilt),
      );
      this._eulerl.set(l.rotX, 0, l.rotZ);
      this._quatl.setFromEuler(this._eulerl);
      this._escl.setScalar(l.raio);
      this._m4l.compose(this._posl, this._quatl, this._escl);
      this.lascaMesh.setMatrixAt(l.vaga, this._m4l);
    }
    this.lascaMesh.instanceMatrix.needsUpdate = true;
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

    // DEPOIS das rochas: a lasca é uma posição relativa à dona, e usar a pose
    // do quadro anterior a deixaria um passo atrás numa rocha que desce a
    // 24 m/s — visível como a brasa "arrastando" atrás da pedra.
    this.passoLascas(dt);

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
    /* Os dois lotes instanciados nascem AQUI, e não na primeira flechada. Eles
       são criados uma vez e nunca destruídos, então o único custo que teriam
       durante a partida é o pior possível: compilar um shader no quadro em que
       alguém acertou a primeira rocha. É o mesmo motivo pelo qual as rochas de
       aquecimento existem. */
    this.prepararLote();
    this.prepararLascas();
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
    for (const l of this.lascas) this.esconderLasca(l);
    this.lascas = [];
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

    if (this.lascaMesh) {
      this.scene.remove(this.lascaMesh);
      this.lascaMesh.dispose();
      this.lascaMesh = null;
    }
    this.lascaGeo?.dispose();
    this.lascaMat?.dispose();
    this.lascaGeo = null;
    this.lascaMat = null;
    this.vagasLasca = null;
  }
}
