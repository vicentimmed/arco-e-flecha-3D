/* ---------------------------------------------------------------------------
   O especial.

   ISTO NÃO É "UM GOLPE", É UM SISTEMA — e a diferença aparece aqui: este
   arquivo não sabe o que é um meteoro. Ele sabe três coisas:

     • quanto falta para carregar (a sala é quem conta, ver `Room.addKameCharge`);
     • em que ponto da animação está (uma fração, que vai na pose);
     • para onde o feixe foi (uma direção, travada no disparo).

   Quem diz "isto encheu um ponto da barra" é o MODO, por `chargeSources` no
   config. Ligar na noite dos zumbis um dia é acrescentar um id em
   `CONFIG.special.modes` — nenhuma linha aqui muda.

   O que ele faz de próprio: a máquina de estados das cinco fases, o teste de
   acerto do feixe (só na tela de quem atirou, que é o contrato do jogo) e a
   trava de movimento. Ver `docs/plano-kamehameha.md`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { C2S } from "../shared/protocol.js";
import { KamehamehaBeam, distanciaAoFeixe } from "../entities/kamehameha.js";

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class SpecialSystem {
  /**
   * @param {object} deps o mínimo para o sistema existir sem conhecer o jogo
   */
  constructor({ scene, player, remotes, meteors, getTerrain, getAim, net, hud, audio }) {
    this.scene = scene;
    this.player = player;
    this.remotes = remotes;
    this.meteors = meteors;
    this.getTerrain = getTerrain;
    this.getAim = getAim;
    this.net = net;
    this.hud = hud;
    this.audio = audio;

    this.charge = 0;
    this.max = CONFIG.special.hitsToCharge;
    this.ativo = false;
    this.t = 0;
    /** @type {KamehamehaBeam[]} feixes em cena — o seu e os dos outros. */
    this.feixes = [];
    /** Alvos já vaporizados por ESTE feixe: nada morre duas vezes. */
    this.jaAtingiu = new Set();
    this.beamSound = null;
    this.habilitado = false;
  }

  get total() {
    const S = CONFIG.special;
    return S.charge + S.release + S.sustain + S.dissipate + S.recover;
  }

  get pronto() {
    return this.habilitado && this.charge >= this.max && !this.ativo;
  }

  /** O modo mudou: o especial existe aqui? */
  setMode(mode) {
    this.habilitado = CONFIG.special.modes.includes(mode);
    if (!this.habilitado) {
      this.cancel();
      this.hud?.setSpecial(null);
    } else {
      this.hud?.setSpecial({ charge: this.charge, max: this.max });
    }
  }

  setCharge(charge, max) {
    this.charge = charge ?? 0;
    if (max) this.max = max;
    if (this.habilitado) this.hud?.setSpecial({ charge: this.charge, max: this.max });
  }

  /**
   * O jogador apertou a tecla.
   *
   * A direção é lida AGORA e não muda mais: girar o mouse depois não entorta o
   * feixe. Não é limitação técnica — é o preço do golpe. Durante os sete
   * segundos você não atira flecha, não desvia de alien e não cobre o resto do
   * céu, e escolher a hora de gastar isso é a decisão mais interessante que o
   * modo oferece.
   */
  fire() {
    if (!this.pronto) return false;

    const aim = this.getAim();
    if (!aim) return false;
    this.dirTravada = new THREE.Vector3(aim.x, aim.y, aim.z).normalize();
    this.ativo = true;
    this.t = 0;
    this.disparou = false;
    this.jaAtingiu.clear();
    this.player.setKame(0.0001);

    this.audio?.play3D?.("kameCharge", this.player.position, 1.0);
    return true;
  }

  /** Alguém soltou o dele. O feixe é reconstruído a partir do evento. */
  onRemoteFire(msg) {
    if (msg.owner === this.net?.me?.id) return;
    const o = { x: msg.o[0], y: msg.o[1], z: msg.o[2] };
    const d = { x: msg.d[0], y: msg.d[1], z: msg.d[2] };
    this.spawnBeam(o, d, false);
  }

  spawnBeam(origem, direcao, local) {
    const feixe = new KamehamehaBeam(this.scene, origem, direcao, this.getTerrain(), local);
    this.feixes.push(feixe);
    this.audio?.play3D?.("kameFire", origem, 1.2);
    return feixe;
  }

  /** Interrompe tudo (troca de modo, de fase, morte). */
  cancel() {
    this.ativo = false;
    this.t = 0;
    this.player?.setKame(0);
    for (const f of this.feixes) f.dispose();
    this.feixes = [];
    this.jaAtingiu.clear();
  }

  /** O jogador está preso na pose? É o que trava o movimento em `main.js`. */
  get travado() {
    return this.ativo;
  }

  update(dt) {
    // Os feixes vivem por conta própria — inclusive depois de o dono terminar
    // a pose, porque a dissipação sobra dela.
    for (let i = this.feixes.length - 1; i >= 0; i--) {
      const f = this.feixes[i];
      if (f.update(dt)) {
        f.dispose();
        this.feixes.splice(i, 1);
      }
    }

    if (!this.ativo) return;

    const S = CONFIG.special;
    this.t += dt;
    this.player.setKame(Math.min(1, this.t / this.total));

    /* O DISPARO, no fim da carga. Sai das MÃOS, não do peito: é lá que a esfera
       estava, e a diferença de trinta centímetros é a diferença entre "ele
       soltou aquilo" e "aquilo saiu de dentro dele". */
    if (!this.disparou && this.t >= S.charge) {
      this.disparou = true;
      this.player.kameMuzzle(_v);
      _dir.copy(this.dirTravada);
      this.meuFeixe = this.spawnBeam(_v, _dir, true);
      this.net?.send?.(C2S.KAME, {
        o: [r(_v.x), r(_v.y), r(_v.z)],
        d: [r(_dir.x), r(_dir.y), r(_dir.z)],
        w: this.net.serverTime,
      });
      this.setCharge(0, this.max);
    }

    /* O TESTE DE ACERTO roda TODO QUADRO enquanto o feixe vive, e não uma vez
       no disparo. É isso que transforma o especial em algo mais interessante
       que "apagar o que está na tela": uma rocha que cai DENTRO do feixe
       durante os três segundos de sustentação morre ali, então mirar no
       corredor de queda e segurar vira uma jogada de leitura. */
    if (this.meuFeixe && !this.meuFeixe.morto) {
      this.testarAcertos(this.meuFeixe);
    }

    if (this.t >= this.total) {
      this.ativo = false;
      this.meuFeixe = null;
      this.player.setKame(0);
    }
  }

  testarAcertos(feixe) {
    const B = CONFIG.special.beam;
    const seg = feixe.segmento();

    // Rochas: o feixe destrói qualquer uma, seja qual for a vida que tinha.
    for (const m of this.meteors?.byNetId?.values() ?? []) {
      const chave = `m${m.netId}`;
      if (this.jaAtingiu.has(chave)) continue;
      const p = m.group.position;
      if (distanciaAoFeixe(seg, p.x, p.y, p.z) <= B.killRadius + m.raio) {
        this.jaAtingiu.add(chave);
        /* Uma mensagem por FLECHA que faltava. A sala tira a vida uma de cada
           vez (é o contrato do `METEOR_HIT`), então vaporizar é mandar todas
           de uma vez — sem inventar um canal novo só para o especial. */
        for (let i = 0; i < m.maxHits; i++) {
          this.net?.send?.(C2S.METEOR_HIT, { id: m.netId, d: 0, kame: true });
        }
      }
    }

    if (!CONFIG.special.friendlyFire) return;

    // Jogadores: quem atravessa o feixe morre. Quem atirou é a autoridade —
    // o mesmo contrato de uma flechada.
    for (const remoto of this.remotes?.byId?.values() ?? []) {
      const chave = `p${remoto.id}`;
      if (this.jaAtingiu.has(chave)) continue;
      if (remoto.dyingSince) continue;
      const p = remoto.player.position;
      // Do pé ao peito: um corpo tem 1,72 m e o feixe pode passar na altura da
      // cabeça sem tocar o chão sob ela.
      const alvoY = p.y + Math.min(1.4, Math.max(0, seg.origem.y - p.y));
      if (distanciaAoFeixe(seg, p.x, alvoY, p.z) <= B.killRadius) {
        this.jaAtingiu.add(chave);
        this.net?.send?.(C2S.KILL, {
          victim: remoto.id,
          p: [r(p.x), r(p.y), r(p.z)],
          c: [r(p.x), r(alvoY), r(p.z)],
          v: [feixe.dir.x * 40, feixe.dir.y * 40 + 6, feixe.dir.z * 40],
          cause: "kame",
        });
      }
    }
  }

  dispose() {
    this.cancel();
  }
}

const r = (v) => Math.round(v * 1000) / 1000;
