/* ---------------------------------------------------------------------------
   Áudio 3D posicional — reativo a eventos, pronto para rede futura.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { gameEvents, EventType } from "../core/events.js";

const TAU = Math.PI * 2;

function makeNoiseBuffer(ctx, duration, type = "impact") {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env =
      type === "bow"
        ? Math.exp(-t * 14) * (1 - t * 0.3)
        : Math.exp(-t * 8) * (1 - t * 0.5);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

function makeToneBuffer(ctx, freq, duration) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 10);
    data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.4;
  }
  return buffer;
}

/** Guincho curto, descendente e áspero — síntese procedural, sem asset externo. */
function makeBoarDeathBuffer(ctx) {
  const duration = 0.9;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const frequency =
      520 - 330 * p + Math.sin(t * 48) * 45 * (1 - p);
    phase += (Math.PI * 2 * frequency) / sampleRate;
    const voice =
      Math.sin(phase) * 0.56 +
      Math.sin(phase * 1.93) * 0.24 +
      Math.sin(phase * 3.07) * 0.1;
    const rasp = (Math.random() * 2 - 1) * 0.16;
    const attack = Math.min(1, t / 0.025);
    const release = Math.pow(1 - p, 1.8);
    data[i] = (voice + rasp) * attack * release;
  }
  return buffer;
}

/**
 * Trilha instrumental original em Ré menor: pulso de tambor, baixo e um motivo
 * de sopro curto. A síntese evita depender de arquivos externos e permite que
 * a música toque em qualquer build offline do jogo.
 */
function makeHuntMusicBuffer(ctx) {
  const tempo = 132; // bpm — caçada ágil e energética
  const beat = 60 / tempo;
  const bars = 8;
  const duration = bars * 4 * beat;
  const sampleRate = ctx.sampleRate;
  const length = Math.ceil(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const addTone = (start, noteDuration, freq, volume, color = "sine") => {
    const from = Math.max(0, Math.floor(start * sampleRate));
    const to = Math.min(length, Math.ceil((start + noteDuration) * sampleRate));
    for (let i = from; i < to; i++) {
      const time = (i - from) / sampleRate;
      const progress = time / noteDuration;
      const attack = Math.min(1, time / 0.025);
      const release = Math.pow(Math.max(0, 1 - progress), 1.45);
      const phase = TAU * freq * time;
      let wave;
      if (color === "horn") {
        wave =
          Math.sin(phase) * 0.72 +
          Math.sin(phase * 2) * 0.2 +
          Math.sin(phase * 3) * 0.08;
      } else if (color === "bass") {
        wave = Math.sin(phase) * 0.82 + Math.sin(phase * 0.5) * 0.18;
      } else {
        wave = Math.sin(phase);
      }
      data[i] += wave * volume * attack * release;
    }
  };

  const addDrum = (start, volume, snare = false) => {
    const from = Math.floor(start * sampleRate);
    const noteLength = snare ? 0.16 : 0.2;
    const to = Math.min(length, from + Math.ceil(noteLength * sampleRate));
    for (let i = Math.max(0, from); i < to; i++) {
      const time = (i - from) / sampleRate;
      const env = Math.exp(-time * (snare ? 22 : 16));
      const rumble = Math.sin(TAU * (snare ? 175 : 72) * time) * (snare ? 0.15 : 0.65);
      const noise = (Math.random() * 2 - 1) * (snare ? 0.72 : 0.16);
      data[i] += (rumble + noise) * volume * env;
    }
  };

  // Tambor e chocalho: pulso rápido de perseguição.
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 4 * beat;
    addDrum(base, 0.24);
    addDrum(base + beat * 2, 0.21);
    addDrum(base + beat, 0.13, true);
    addDrum(base + beat * 3, 0.13, true);
    for (let eighth = 0; eighth < 8; eighth++) {
      addDrum(base + (eighth + 0.5) * beat * 0.5, 0.035, true);
    }
  }

  // Baixo em Ré menor: D, C, Bb, A, com passos curtos e mais dançantes.
  const bass = [73.42, 65.41, 58.27, 55.0];
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 4 * beat;
    const root = bass[bar % bass.length];
    for (let step = 0; step < 4; step++) {
      addTone(base + step * beat, beat * 0.72, root * (step === 3 ? 1.5 : 1), 0.13, "bass");
    }
  }

  // Chamadas de sopro em resposta ao tambor, com uma frase mais viva.
  const melody = [
    293.66, 349.23, 440.0, 587.33,
    440.0, 349.23, 293.66, 440.0,
    493.88, 440.0, 349.23, 293.66,
    349.23, 440.0, 587.33, 440.0,
  ];
  for (let i = 0; i < melody.length; i++) {
    const start = (i + 0.35) * beat;
    if (start >= duration - 0.4) break;
    addTone(start, beat * 0.7, melody[i], 0.09, "horn");
  }

  // Impede clipping ao somar as camadas.
  for (let i = 0; i < length; i++) {
    data[i] = Math.tanh(data[i] * 1.25);
  }
  return buffer;
}

export class AudioSystem {
  constructor(camera, scene) {
    this.scene = scene;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.unlocked = false;
    this.musicEnabled = true;
    this.buffers = {};
    this.pool = [];
    this.maxVoices = 16;

    this._initBuffers();
    this.music = new THREE.Audio(this.listener);
    this.music.setBuffer(makeHuntMusicBuffer(this.ctx));
    this.music.setLoop(true);
    this.music.setVolume(0.18);

    gameEvents.on(EventType.ARROW_SHOT, (e) => {
      if (e.origin) this.play3D("bow", e.origin, 0.85);
    });
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (!e.impact) return;
      const pos = e.impact;
      if (e.targetKind === "target") this.play3D("hitTarget", pos, 1);
      else if (e.targetKind === "boar") this.play3D("hitBoar", pos, 1.1);
      else if (e.targetKind === "character") this.play3D("hitCharacter", pos, 1);
      else this.play3D("hitScenery", pos, 0.7);
    });
    gameEvents.on(EventType.BOAR_DEATH, (e) => {
      if (e.impact) this.play3D("boarDeath", e.impact, 1.15);
    });
    gameEvents.on(EventType.AUDIO_PLAY, (e) => {
      if (e.position && e.sound) this.play3D(e.sound, e.position, e.volume ?? 1);
    });
  }

  _initBuffers() {
    this.buffers.bow = makeNoiseBuffer(this.ctx, 0.12, "bow");
    this.buffers.hitTarget = makeNoiseBuffer(this.ctx, 0.18, "impact");
    this.buffers.hitBoar = makeToneBuffer(this.ctx, 90, 0.22);
    this.buffers.boarDeath = makeBoarDeathBuffer(this.ctx);
    this.buffers.hitCharacter = makeToneBuffer(this.ctx, 120, 0.2);
    this.buffers.hitScenery = makeNoiseBuffer(this.ctx, 0.14, "impact");
  }

  unlock() {
    if (this.unlocked) {
      this.startMusic();
      return;
    }
    this.unlocked = true;
    const start = () => this.startMusic();
    if (this.ctx.state === "suspended") {
      this.ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
  }

  startMusic() {
    if (!this.unlocked || !this.musicEnabled || this.music.isPlaying) return;
    this.music.play();
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled) this.startMusic();
    else if (this.music.isPlaying) this.music.stop();
    return this.musicEnabled;
  }

  play3D(soundId, position, volume = 1) {
    if (!this.unlocked) return;
    const buffer = this.buffers[soundId];
    if (!buffer) return;

    let audio = this.pool.pop();
    if (!audio) {
      audio = new THREE.PositionalAudio(this.listener);
      audio.setRefDistance(3);
      audio.setRolloffFactor(1.2);
      audio.setMaxDistance(80);
      audio.setDistanceModel("inverse");
    }

    const holder = new THREE.Object3D();
    holder.position.set(position.x, position.y, position.z);
    holder.add(audio);
    this.scene.add(holder);

    audio.setBuffer(buffer);
    audio.setVolume(volume);
    audio.setLoop(false);
    audio.play();

    audio.onEnded = () => {
      holder.remove(audio);
      this.scene.remove(holder);
      this.pool.push(audio);
    };
  }
}
