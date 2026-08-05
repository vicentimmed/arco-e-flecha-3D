/* ---------------------------------------------------------------------------
   Vento: direção e intensidade variando continuamente, com rajadas.

   O vento NÃO é aplicado como força extra sobre a flecha. Ele entra na conta
   do arrasto através da velocidade relativa ao ar (v_rel = v_flecha − v_vento),
   que é como funciona de verdade — e é o que faz o efeito depender da
   velocidade da flecha e do tempo de voo.

   TUDO AQUI É FUNÇÃO PURA DE `time`. Não existe `Math.random()` neste módulo, e
   isso não é preciosismo: no multiplayer, um evento de disparo carrega origem,
   direção e velocidade — o vento é a única entrada do voo que fica de fora.
   Sendo função do relógio compartilhado, cada cliente recalcula a MESMA
   trajetória e o mesmo traçado sem que um único byte de posição trafegue.
   Basta o cliente chamar `setTime()` com o relógio do servidor.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { ValueNoise } from "../utils/noise.js";
import { clamp } from "../utils/math.js";

export class Wind {
  constructor(seed = 4242) {
    this.noise = new ValueNoise(seed);
    this.time = 0;
    this.vector = new THREE.Vector3();
    this.enabled = CONFIG.wind.enabled;
    this.speed = 0;
    this.direction = 0; // rad — para onde o vento sopra
    this.gust = 0;
    this.baseSpeed = CONFIG.wind.baseSpeed;
    this.update(0);
  }

  update(dt) {
    this.setTime(this.time + dt);
  }

  /**
   * Reposiciona o vento num instante absoluto do relógio compartilhado.
   *
   * É por aqui que o cliente se alinha ao servidor. Como `evaluate()` não guarda
   * estado entre chamadas, saltar no tempo é legítimo: o vento de t = 412,7 s é
   * o mesmo tendo chegado lá somando frames ou de um pulo só.
   */
  setTime(time) {
    this.time = time;
    this.evaluate();
  }

  evaluate() {
    const c = CONFIG.wind;
    const t = this.time;

    /* Direção: passeio LENTO — a volta completa leva dezenas de minutos.
       Antes ela girava rápido o bastante para que a correção de um tiro já não
       valesse no tiro seguinte, e a única leitura possível era "vento aleatório".
       Devagar, a bandeira vira informação: dá tempo de ver o rumo, compensar e
       repetir o acerto antes que ele mude. */
    const dirNoise = this.noise.noise1(t * c.directionDrift);
    this.direction = dirNoise * Math.PI + t * c.directionSpin;

    // Intensidade: ruído lento em torno da base — com `speedVariation` em zero
    // (o padrão), esta linha devolve a base e o vento fica constante.
    const spdNoise = this.noise.noise2(t * c.speedDrift, 17.3);
    const base = this.baseSpeed * (1 + c.speedVariation * spdNoise);

    /* Rajada: um canal de ruído SEPARADO decide quando venta forte. Enquanto ele
       fica acima do limiar existe rajada, e a intensidade acompanha o quanto ele
       passou — então ela sobe e desce sozinha, com a forma do próprio ruído, em
       vez de ligar e desligar num cronômetro. Subir `gustThreshold` deixa as
       rajadas mais raras; subir `gustRate`, mais curtas. */
    const g = this.noise.noise1(t * c.gustRate + 91.7);
    const over = clamp((g - c.gustThreshold) / (1 - c.gustThreshold), 0, 1);
    this.gust = over * over * (3 - 2 * over) * c.gustStrength;

    /* O teto acompanha a base quando ela sobe acima dele. Sem isso o controle
       de "vento base" do painel de depuração parava de responder em 12 m/s —
       um controle que ignora o que você faz é pior que um controle ausente. */
    const speed = clamp(base + this.gust, 0, Math.max(c.maxSpeed, this.baseSpeed));
    this.speed = this.enabled ? speed : 0;
    this.vector.set(
      Math.sin(this.direction) * this.speed,
      0,
      Math.cos(this.direction) * this.speed,
    );
  }

  /** Ângulo (rad) do vento relativo à direção para onde o jogador olha. */
  relativeAngle(playerYaw) {
    return this.direction - playerYaw;
  }

  setEnabled(on) {
    this.enabled = on;
    this.evaluate();
  }

  setBaseSpeed(v) {
    this.baseSpeed = v;
    this.evaluate();
  }
}
