/* ---------------------------------------------------------------------------
   Painel de depuração (tecla ~): telemetria, vetores no mundo, sliders para os
   parâmetros físicos e o auto-teste dos critérios de aceite.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG, applyQuality } from "../config.js";
import { runSelfTest } from "../systems/selftest.js";
import { C2S } from "../shared/protocol.js";

/* Alvos do orçamento de desenho, da Fase 0 do plano. Verde dentro do alvo,
   âmbar até o crítico, vermelho acima — o número sozinho não diz se está bom. */
const CALLS_TARGET = 500;
const CALLS_CRITICAL = 600;

export class DebugPanel {
  constructor(root, ctx) {
    this.ctx = ctx; // { physics, arrows, wind, rig, scene, getStats }
    this.visible = false;
    this.showVectors = false;

    this.el = document.createElement("div");
    this.el.id = "debug";
    this.el.innerHTML = `
      <h3>Telemetria</h3>
      <div class="row"><span>fps</span><b id="d-fps">—</b></div>
      <!-- O orçamento do frame. Os alvos vêm da Fase 0 do plano: horda 1
           abaixo de 350 chamadas, horda 10 abaixo de 500 (crítico: 600).
           O número fica VERDE dentro do alvo, âmbar no crítico e vermelho
           acima — sem isso ele é só mais um número na tela. -->
      <div class="row"><span>draw calls</span><b id="d-calls">—</b></div>
      <div class="row"><span>triângulos</span><b id="d-tris">—</b></div>
      <div class="row"><span>texturas / programas</span><b id="d-mem">—</b></div>
      <div class="row"><span>partículas</span><b id="d-parts">—</b></div>
      <div class="row"><span>qualidade</span><b id="d-quality">—</b></div>
      <div class="row"><span>passos de física / frame</span><b id="d-steps">—</b></div>
      <div class="row"><span>flechas em voo / cravadas</span><b id="d-arrows">—</b></div>
      <div class="row"><span>velocidade</span><b id="d-speed">—</b></div>
      <div class="row"><span>força de arrasto</span><b id="d-drag">—</b></div>
      <div class="row"><span>vento</span><b id="d-wind">—</b></div>
      <div class="row"><span>tempo de voo</span><b id="d-time">—</b></div>
      <div class="row"><span>apogeu</span><b id="d-apex">—</b></div>
      <div class="row"><span>alcance</span><b id="d-range">—</b></div>

      <!-- FASE E TROCA. Sem crases neste bloco: ele é um template literal, e
           uma crase o encerraria.
           A linha geo/tex é o critério de aceite do sistema de fases: ir e
           voltar entre duas fases tem de devolver os MESMOS números. Se eles
           subirem a cada viagem, algo do cenário antigo ficou na memória de
           vídeo — e é o tipo de vazamento que não dá erro, só engasga vinte
           minutos depois. Ver docs/plano-fases.md. -->
      <div class="row"><span>fase</span><b id="d-level">—</b></div>
      <div class="row"><span>última troca</span><b id="d-swap">—</b></div>
      <div class="row"><span>geo / tex (deve repetir)</span><b id="d-leak">—</b></div>
      <div class="row"><span>corpos de física</span><b id="d-bodies">—</b></div>

      <h3>Parâmetros</h3>
      <div class="slider" data-key="mass">
        <label>massa da flecha <b>25 g</b></label>
        <input type="range" min="5" max="80" step="1" value="25">
      </div>
      <div class="slider" data-key="cd">
        <label>coeficiente de arrasto <b>2.00</b></label>
        <input type="range" min="0" max="4" step="0.05" value="2">
      </div>
      <div class="slider" data-key="speed">
        <label>velocidade máxima <b>120 m/s</b></label>
        <input type="range" min="30" max="130" step="1" value="120">
      </div>
      <div class="slider" data-key="gravity">
        <label>gravidade <b>9.81 m/s²</b></label>
        <input type="range" min="0" max="20" step="0.01" value="9.81">
      </div>
      <!-- O valor inicial acompanha o CONFIG: o painel mostrava 3,5 m/s
           enquanto o vento soprava a 12, e um controle que mente sobre o estado
           atual é pior que nenhum controle. -->
      <div class="slider" data-key="wind">
        <label>vento base <b>${CONFIG.wind.baseSpeed.toFixed(1)} m/s</b></label>
        <input type="range" min="0" max="20" step="0.1"
               value="${CONFIG.wind.baseSpeed}">
      </div>
      <div class="slider" data-key="cop">
        <label>centro de pressão <b>13 cm</b></label>
        <input type="range" min="0" max="30" step="1" value="13">
      </div>

      <h3>Chaves</h3>
      <div class="toggles">
        <button data-toggle="drag" class="on">arrasto</button>
        <button data-toggle="wind" class="on">vento na flecha</button>
        <button data-toggle="aero" class="on">estabilização</button>
        <button data-toggle="reload" class="on">anim. reload</button>
        <button data-toggle="vectors">vetores</button>
        <button data-toggle="trace">traçado</button>
        <button data-toggle="post" class="on">pós-processamento</button>
        <!-- Ligada, a câmera do especial vai para a FRENTE do feixe e viaja com
             a ponta; desligada, fica no enquadramento lateral de trás do ombro,
             que é como o golpe funcionava antes. Está aqui, e não só no config,
             porque a escolha entre as duas se faz OLHANDO — e para isso é
             preciso trocar entre elas sem recarregar a página. -->
        <button data-toggle="kamecam"
                class="${CONFIG.camera.kameCam.enabled ? "on" : ""}">câmera do feixe</button>
      </div>

      <!-- A qualidade recarrega a página: shadow map, densidade da grama e o
           tamanho do alvo de render são decididos no build da cena, e trocá-los
           a quente exigiria reconstruir o mundo inteiro. Recarregar é honesto e
           leva o mesmo tempo. -->
      <h3>Qualidade</h3>
      <div class="toggles">
        <button data-quality="low">baixa</button>
        <button data-quality="medium">média</button>
        <button data-quality="high">alta</button>
      </div>

      <h3>Critérios de aceite</h3>
      <div class="toggles"><button id="d-run">rodar auto-teste</button></div>
      <pre id="d-report">pressione para validar a balística contra a fórmula analítica.</pre>
    `;
    root.appendChild(this.el);

    this.fields = {
      fps: this.el.querySelector("#d-fps"),
      calls: this.el.querySelector("#d-calls"),
      tris: this.el.querySelector("#d-tris"),
      mem: this.el.querySelector("#d-mem"),
      parts: this.el.querySelector("#d-parts"),
      quality: this.el.querySelector("#d-quality"),
      steps: this.el.querySelector("#d-steps"),
      arrows: this.el.querySelector("#d-arrows"),
      speed: this.el.querySelector("#d-speed"),
      drag: this.el.querySelector("#d-drag"),
      wind: this.el.querySelector("#d-wind"),
      time: this.el.querySelector("#d-time"),
      apex: this.el.querySelector("#d-apex"),
      range: this.el.querySelector("#d-range"),
      level: this.el.querySelector("#d-level"),
      swap: this.el.querySelector("#d-swap"),
      leak: this.el.querySelector("#d-leak"),
      bodies: this.el.querySelector("#d-bodies"),
      report: this.el.querySelector("#d-report"),
    };

    this.windInfluenceBtn = this.el.querySelector('[data-toggle="wind"]');

    this.bindSliders();
    this.bindToggles();
    this.buildVectors();
  }

  syncWindInfluenceToggle(on) {
    this.windInfluenceBtn?.classList.toggle("on", on);
  }

  bindSliders() {
    for (const slider of this.el.querySelectorAll(".slider")) {
      const key = slider.dataset.key;
      const input = slider.querySelector("input");
      const label = slider.querySelector("label b");
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        switch (key) {
          case "mass":
            CONFIG.arrow.mass = v / 1000;
            label.textContent = `${v} g`;
            break;
          case "cd":
            CONFIG.arrow.dragCoefficient = v;
            label.textContent = v.toFixed(2);
            break;
          case "speed":
            CONFIG.bow.maxSpeed = v;
            label.textContent = `${v} m/s`;
            break;
          case "gravity":
            this.ctx.physics.gravity = -v;
            label.textContent = `${v.toFixed(2)} m/s²`;
            break;
          case "wind":
            this.ctx.wind.setBaseSpeed(v);
            label.textContent = `${v.toFixed(1)} m/s`;
            break;
          case "cop":
            CONFIG.arrow.centerOfPressureOffset = v / 100;
            label.textContent = `${v} cm`;
            break;
        }
      });
    }
  }

  bindToggles() {
    for (const btn of this.el.querySelectorAll("[data-toggle]")) {
      btn.addEventListener("click", () => {
        const on = !btn.classList.contains("on");
        btn.classList.toggle("on", on);
        switch (btn.dataset.toggle) {
          case "drag":
            this.ctx.arrows.options.dragEnabled = on;
            break;
          case "wind":
            // Mesmo caminho da tecla V: a sala decide e avisa todo mundo.
            this.ctx.net?.send?.(C2S.WIND, { on });
            // Reverte o botão até a confirmação da sala — senão o painel mente
            // por um frame se a rede estiver lenta.
            btn.classList.toggle("on", !on);
            break;
          case "aero":
            this.ctx.arrows.options.aeroStabilization = on;
            break;
          case "reload":
            CONFIG.bow.reloadAnimation = on;
            break;
          case "vectors":
            this.showVectors = on;
            this.vectorGroup.visible = on;
            break;
          case "trace":
            this.ctx.arrows.setTraceVisible(on);
            break;
          case "post":
            this.ctx.renderer.setPostEnabled(on);
            break;
          case "kamecam":
            CONFIG.camera.kameCam.enabled = on;
            // Desligar no meio de um feixe devolve a terceira pessoa na hora:
            // esperar o impacto para ver o efeito da chave é esperar demais.
            if (!on) this.ctx.rig?.leaveKame?.();
            break;
        }
      });
    }

    for (const btn of this.el.querySelectorAll("[data-quality]")) {
      const nome = btn.dataset.quality;
      btn.classList.toggle("on", nome === CONFIG.render.quality);
      btn.addEventListener("click", () => {
        if (nome === CONFIG.render.quality) return;
        applyQuality(nome);
        location.reload();
      });
    }

    this.el.querySelector("#d-run").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      btn.textContent = "rodando…";
      this.fields.report.textContent = "";
      // Deixa o navegador pintar o "rodando…" antes de travar no teste.
      setTimeout(() => {
        const results = runSelfTest();
        this.fields.report.innerHTML = results
          .map(
            (r) =>
              `<span class="${r.pass ? "ok" : "bad"}">${r.pass ? "✓" : "✗"}</span> ${r.name}\n   ${r.detail}`,
          )
          .join("\n\n");
        btn.textContent = "rodar auto-teste";
      }, 30);
    });
  }

  buildVectors() {
    this.vectorGroup = new THREE.Group();
    this.vectorGroup.visible = false;
    const mk = (color) => {
      const a = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(),
        1,
        color,
        0.35,
        0.18,
      );
      this.vectorGroup.add(a);
      return a;
    };
    this.arrowVelocity = mk(0x6fd36f);
    this.arrowDrag = mk(0xff7d6e);
    this.arrowWind = mk(0x8ac6ff);
    this.ctx.scene.add(this.vectorGroup);
  }

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle("on", this.visible);
  }

  update(stats) {
    if (this.showVectors) this.updateVectors();
    if (!this.visible) return;

    const f = this.fields;
    f.fps.textContent = stats.fps.toFixed(0);

    /* Fase e diagnóstico da troca. Os dois primeiros são informativos; o
       terceiro é o CRITÉRIO: ir e voltar entre fases tem de repetir os mesmos
       geo/tex. Vazamento aqui não dá erro — só engasga meia hora depois. */
    const gerente = this.ctx.levels;
    if (gerente) {
      f.level.textContent = gerente.id ?? "—";
      const s = gerente.lastSwap;
      f.swap.textContent = s
        ? `${s.ms} ms · devolveu ${s.freed?.geometries ?? 0} geo / ${s.freed?.textures ?? 0} tex`
        : "—";
      const mem = this.ctx.renderer?.renderer?.info?.memory;
      if (mem) f.leak.textContent = `${mem.geometries} / ${mem.textures}`;
      f.bodies.textContent = this.ctx.physics?.bodyCount ?? "—";
    }

    /* O contador de desenho.
     *
     * `renderer.info` é zerado a cada `render()`, então o que se lê aqui é o
     * frame ANTERIOR — um quadro de atraso, invisível para quem está medindo
     * uma horda que dura minutos. `programs` e `textures` entram junto porque
     * são o outro lado da conta: dá para baixar as chamadas empilhando
     * variantes de material e trocar um gargalo por outro. */
    const info = this.ctx.renderer?.renderer?.info;
    if (info) {
      const calls = info.render.calls;
      f.calls.textContent = String(calls);
      f.calls.className =
        calls <= CALLS_TARGET ? "ok" : calls <= CALLS_CRITICAL ? "warn" : "bad";
      f.tris.textContent = `${(info.render.triangles / 1000).toFixed(0)} k`;
      f.mem.textContent = `${info.memory.textures} / ${info.programs?.length ?? 0}`;
    }
    f.parts.textContent = String(this.ctx.particles?.count ?? 0);
    f.quality.textContent = CONFIG.render.quality;

    f.steps.textContent = String(stats.steps);
    f.arrows.textContent = `${stats.live} / ${stats.stuck}`;
    f.wind.textContent = `${this.ctx.wind.speed.toFixed(1)} m/s @ ${((this.ctx.wind.direction * 180) / Math.PI).toFixed(0)}°`;

    const arrow = this.ctx.arrows.lastArrow;
    if (arrow) {
      f.speed.textContent = `${arrow.lastSpeed.toFixed(1)} m/s`;
      f.drag.textContent = `${arrow.lastDragForce.toFixed(3)} N (${(arrow.lastDragForce / CONFIG.arrow.mass).toFixed(1)} m/s²)`;
      f.time.textContent = `${arrow.flightTime.toFixed(2)} s`;
      f.apex.textContent = `${arrow.apex.toFixed(1)} m`;
      const t = arrow.body.translation();
      const d = Math.hypot(
        t.x - arrow.launchPosition.x,
        t.z - arrow.launchPosition.z,
      );
      f.range.textContent = `${d.toFixed(1)} m`;
    }
  }

  updateVectors() {
    const arrow = this.ctx.arrows.lastArrow;
    if (!arrow || arrow.stuck || arrow.dead) {
      this.vectorGroup.visible = false;
      return;
    }
    this.vectorGroup.visible = true;
    const t = arrow.body.translation();
    const origin = new THREE.Vector3(t.x, t.y, t.z);

    const v = arrow.lastVelocity;
    const speed = v.length() || 1;
    this.arrowVelocity.position.copy(origin);
    this.arrowVelocity.setDirection(v.clone().divideScalar(speed));
    this.arrowVelocity.setLength(Math.min(6, speed * 0.06), 0.3, 0.16);

    const drag = arrow.lastDragForce;
    this.arrowDrag.position.copy(origin);
    this.arrowDrag.setDirection(v.clone().divideScalar(-speed));
    this.arrowDrag.setLength(Math.max(0.2, drag * 6), 0.3, 0.16);

    const w = this.ctx.wind.vector;
    const ws = w.length();
    this.arrowWind.position.copy(origin);
    if (ws > 0.01) {
      this.arrowWind.setDirection(w.clone().divideScalar(ws));
      this.arrowWind.setLength(ws * 0.22, 0.3, 0.16);
      this.arrowWind.visible = true;
    } else {
      this.arrowWind.visible = false;
    }
  }
}
