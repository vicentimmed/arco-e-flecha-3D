/* ---------------------------------------------------------------------------
   As flechas dos outros.

   Uma flecha em voo não gasta UM BYTE por frame. O que trafega é o evento de
   disparo — origem, direção, velocidade — e, no fim, o evento de impacto.
   Entre os dois, cada cliente recalcula o voo com a mesma aerodinâmica e o
   mesmo vento (que é função do relógio compartilhado, ver `systems/wind.js`),
   e por isso desenha a mesma curva e o mesmo traçado.

   É o que torna o traçado alheio possível sem lag: transmitir 700 pontos de
   trajetória a 120 Hz seria absurdo, e transmitir a posição a 20 Hz daria uma
   linha quebrada. Recalcular localmente dá a curva inteira, lisa, de graça.

   Quem atirou é a AUTORIDADE do próprio acerto. A cópia local voa sem colidir
   com nada e, quando o `impact` do dono chega, encaixa na pose reportada e
   crava. O salto é de centímetros e chega meio ping depois — invisível.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { vecFrom } from "../shared/protocol.js";

const _origem = new THREE.Vector3();
const _direcao = new THREE.Vector3();
const _impulso = { x: 0, y: 0, z: 0 };

export class RemoteArrows {
  /**
   * @param {import("../entities/arrow.js").ArrowManager} arrows
   * @param {() => Array} getTargets alvos da cena (para o impacto replicar o tombo)
   */
  constructor(arrows, getTargets) {
    this.arrows = arrows;
    this.getTargets = getTargets;
    /** @type {Map<string, import("../entities/arrow.js").Arrow>} */
    this.emVoo = new Map();
  }

  /** Chave global: o id da flecha só é único DENTRO de cada cliente. */
  static chave(owner, id) {
    return `${owner}:${id}`;
  }

  /** Alguém atirou. */
  onShot(msg, corDoDono) {
    _origem.set(msg.o[0], msg.o[1], msg.o[2]);
    _direcao.set(msg.d[0], msg.d[1], msg.d[2]).normalize();

    const flecha = this.arrows.spawn(_origem, _direcao, msg.v, {
      ownerEntityId: msg.ownerEntity,
      trailColor: corDoDono ?? CONFIG.trail.color,
      visualOnly: true,
    });
    this.emVoo.set(RemoteArrows.chave(msg.owner, msg.id), flecha);
  }

  /**
   * A flecha de alguém cravou. Encaixa na pose do dono e replica o efeito.
   *
   * O impulso no alvo é reaplicado aqui, e não deduzido: assim o alvo tomba do
   * mesmo jeito em todas as telas, em vez de cada máquina inventar um tombo.
   */
  onImpact(msg) {
    const chave = RemoteArrows.chave(msg.owner, msg.id);
    const flecha = this.emVoo.get(chave);
    this.emVoo.delete(chave);

    const pose = vecFrom(msg.p);
    const contato = msg.c ? vecFrom(msg.c) : pose;
    const alvo = msg.k === "target" ? this.getTargets()?.[msg.ti] : null;

    if (alvo && msg.v) {
      const corpo = alvo.body;
      _impulso.x = msg.v[0] * CONFIG.arrow.mass;
      _impulso.y = msg.v[1] * CONFIG.arrow.mass;
      _impulso.z = msg.v[2] * CONFIG.arrow.mass;
      if (corpo.bodyType() === 0 /* Dynamic */) {
        corpo.applyImpulseAtPoint(_impulso, contato, true);
      }
      alvo.registerHit?.(contato);
    }

    if (!flecha) return; // chegamos tarde: a flecha já expirou por tempo de vida

    /* Alvo da série: o alvo explode e some, então a flecha some com ele.
       Congelá-la deixaria a cópia pendurada no ar a duzentos metros — o mesmo
       defeito que a flecha do dono tinha (ver `hitResolver.resolveSeriesHit`),
       e ele precisa ser corrigido nos dois lados, senão quem atirou vê o campo
       limpo e todo mundo continua vendo flechas flutuando. */
    if (msg.k === "seriesTarget") {
      this.arrows.remove(flecha);
      return;
    }

    const corpoAlvo = alvo?.body ?? null;
    const dinamico = corpoAlvo ? corpoAlvo.bodyType() === 0 : false;
    flecha.snapTo(
      pose,
      msg.q ? { x: msg.q[0], y: msg.q[1], z: msg.q[2], w: msg.q[3] } : null,
      corpoAlvo,
      dinamico,
    );
    this.arrows.retire(flecha);
  }

  /**
   * Recria as flechas que já estavam cravadas quando você entrou.
   *
   * Sem isto, quem chega atrasado vê um campo de tiro limpo enquanto todo mundo
   * está olhando para alvos cheios de flecha.
   */
  restore(cravadas, corPorDono) {
    for (const c of cravadas) {
      _origem.set(c.p[0], c.p[1], c.p[2]);
      _direcao.set(0, 1, 0);
      const flecha = this.arrows.spawn(_origem, _direcao, 0, {
        ownerEntityId: c.ownerEntity,
        trailColor: corPorDono?.(c.owner) ?? CONFIG.trail.color,
        visualOnly: true,
      });
      // Sem traçado: a linha do voo é de quem viu o tiro acontecer, e desenhar
      // um rastro parado para quem acabou de chegar seria mentira.
      flecha.trail?.finish();
      flecha.snapTo(
        vecFrom(c.p),
        c.q ? { x: c.q[0], y: c.q[1], z: c.q[2], w: c.q[3] } : null,
      );
      this.arrows.retire(flecha);
    }
  }

  /** Some com a flecha de quem saiu antes de o impacto chegar. */
  forget(ownerId) {
    for (const [chave, flecha] of [...this.emVoo]) {
      if (!chave.startsWith(`${ownerId}:`)) continue;
      this.emVoo.delete(chave);
      flecha.trail?.finish();
    }
  }

  clear() {
    this.emVoo.clear();
  }
}
