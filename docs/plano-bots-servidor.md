# Plano — O bot no servidor, e a vida na Lua

Documento de **implementação**, escrito para ser seguido passo a passo. Cada
tarefa traz: **Objetivo → Arquivos → Passos → Critério de aceite**.

Regras que valem para o documento inteiro:

1. **Todo número que influencia a simulação mora em `src/config.js`.** Onde o
   plano diz "adicione a chave X em `CONFIG`", é literal. `server/` importa
   `../src/config.js` — o arquivo já é compartilhado.
2. **Comentários em português, explicando o PORQUÊ**, no estilo do arquivo em
   que você está mexendo.
3. **Nada de crase (`` ` ``) dentro dos blocos GLSL** de `src/core/renderer.js`
   — são template literals e uma crase num comentário quebra o build apontando
   para a linha errada.
4. Depois de cada tarefa: `npm run build` limpo.

O documento tem dois blocos independentes:

- **Bloco A — Lua e rover** (tarefas 1 a 7): correções e conteúdo novo, tudo
  no cliente. Não depende do Bloco B.
- **Bloco B — o bot vai para o servidor** (tarefas 8 a 14): a mudança
  estrutural. Faça o Bloco A primeiro; ele dá resultado visível cedo e não
  conflita com os arquivos do Bloco B.

> **O modo "duelo de times" foi retirado deste plano de propósito.** Ele
> dependia de bots locais e de um placar remendado por cima. Com o Bloco B, os
> bots passam a ser jogadores de verdade na sala — e o duelo de times vira um
> modo comum, escrito depois, sem gambiarra. Não implemente nada dele agora.

---

## Contexto de arquitetura — leia antes de tocar em qualquer arquivo

### Quem simula o quê, hoje

| Coisa | Onde vive | Como chega às outras telas |
|---|---|---|
| Jogador humano | cliente (dono) | `C2S.STATE` 20 Hz → `S2C.STATES` |
| Flecha de jogador | cliente do dono resolve; os outros só desenham | `S2C.SHOT` (voo) + `S2C.IMPACT` (onde parou) |
| Porco, alce, pássaro, zumbi, lobo | **servidor** (`server/*Sim.js`) | `S2C.BOARS` / `ELKS` / `BIRDS` / `ZOMBIES`, 10 Hz |
| Alien, nave, rover, meteorito | **cliente**, cada um o seu | não chega — são locais |
| **Bot (hoje)** | **cliente**, cada um o seu | **não chega — este plano muda isso** |

### O que o servidor sabe e o que não sabe

Sabe: o **relevo** (`src/shared/terrainField.js` e `src/shared/moonField.js`,
puros, sem Three.js), a posição de todo mundo, o modo, a fase e o placar.

**Não sabe: vegetação, rochas, cercas e as peças da base lunar.** Elas são malha
e vivem só no cliente. `server/birdSim.js` documenta a solução que o projeto já
usa para esse problema: o servidor manda "pouse por aqui (x, z)" e cada cliente
resolve para a copa mais próxima — como o cenário é determinístico (mesma
semente), todos resolvem para a mesma árvore.

**Isto tem consequência direta para o Bloco B** e está tratado na tarefa 13.

### O canal de retransmissão de tiro

`C2S.SHOT` → o servidor retransmite `S2C.SHOT { owner, ownerEntity, id, o, d, v, w }`
→ `RemoteArrows.onShot` (`src/net/remoteArrows.js`) cria a flecha com
`visualOnly: true` (voa, desenha traçado, **não** resolve colisão).
`S2C.IMPACT` → `RemoteArrows.onImpact` encaixa a flecha na pose final.

**O servidor pode ser o "dono" de uma flecha por este mesmo canal.** É a chave
do Bloco B: ele emite `S2C.SHOT` e depois `S2C.IMPACT` e nenhum código de
cliente precisa saber que o atirador não era gente.

### Pose na rede

`packState(obj)` (`src/shared/protocol.js`) é uma função **pura** que lê
`obj.position` (qualquer `{x,y,z}`), `obj.yaw`, `obj.pitch`, `obj.gaitPhase`,
`obj.gaitBlend`, `obj.runBlend`, `obj.drawFraction`, `obj.reloadFraction`,
`obj.knifeFraction`, `obj.moveF`, `obj.moveS`, `obj.airborne`, `obj.jetFlame`.
Um bot do servidor que tenha esses campos produz a pose sem adaptador nenhum.

### Ids

Jogadores recebem `nextPlayerId++`, um contador de módulo em `server/room.js`.
**Os bots usam o MESMO contador** — é isso que faz `S2C.KILL { victim }`,
`S2C.STATES { id }` e o placar funcionarem sem nenhum caso especial.

### Morte por coisa local

`Game.killedByLocalNPC(msg)` / `Game.reviveFromLocalDeath()` em `src/main.js`
existem porque alien, nave e explosão são locais e o servidor recusaria um
`C2S.KILL` autoinfligido. **Depois do Bloco B os bots deixam de usar esse
caminho** (passam a matar pelo `S2C.KILL` de verdade), mas alien, nave, meteoro
e estilhaço continuam usando. Não apague esses dois métodos.

---

## Ordem sugerida

| # | Tarefa | Bloco | Depende de |
|---|---|---|---|
| 1 | Rodas do rover giram como pneu | A | — |
| 2 | Rover preso em cratera | A | — |
| 3 | Sons novos (nave, alien, explosão) | A | — |
| 4 | Nave faz barulho, alien fala, explosão mata | A | 3 |
| 5 | Infraestrutura de plataforma (andar em cima) | A | 1, 2 |
| 6 | Nave de transporte | A | 3, 4, 5 |
| 7 | Meteoritos + estilhaços letais | A | 3, 4, 5 |
| 8 | O bot migra para o servidor | B | — |
| 9 | Comportamento do bot fácil | B | 8 |
| 10 | Coleira do bot no vale | B | 8 |
| 11 | Bot atira nos bichos | B | 8 |
| 12 | Atalhos (adicionar/remover bot, dificuldade) | B | 8 |
| 13 | Obstáculos compartilhados (linha de visada) | B | 8 |
| 14 | Verificações finais | — | todas |

---
---

# BLOCO A — Lua e rover

## 1. As rodas do rover giram como pneu, não como moeda

**Objetivo.** Hoje as rodas giram em torno do eixo vertical (como uma moeda
rodando na mesa). Devem girar em torno do próprio eixo.

**Por que acontece.** Em `src/entities/rover.js` a roda é um `CylinderGeometry`
(eixo local +Y) deitado com `roda.rotation.z = Math.PI / 2`. O `Euler` do Three,
na ordem padrão `XYZ`, compõe `R = Rx·Ry·Rz`: o `Rz` é aplicado **primeiro** e o
`Ry` **depois, no espaço do pai**. Ou seja, `roda.rotation.y += giro` gira em
torno da vertical do rover, não do eixo da roda.

**Arquivos.** `src/entities/rover.js`

**Passos.**

1. No laço que cria as rodas, troque:
   ```js
   const roda = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 12), escuro);
   roda.position.set(sx, 0.5, sz);
   roda.rotation.z = Math.PI / 2;
   ```
   por:
   ```js
   /* O eixo do cilindro é deitado NA GEOMETRIA, não na malha.
    *
    * Deitar pela malha (`rotation.z`) e girar por `rotation.y` faz a roda rodar
    * em torno da VERTICAL — a moeda girando na mesa. Com o eixo já deitado na
    * geometria, o eixo da roda passa a ser o X local, e girar é `rotation.x`:
    * o pneu roda para a frente, que é o que se espera de um veículo andando. */
   const geoRoda = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 12).rotateZ(Math.PI / 2);
   const roda = new THREE.Mesh(geoRoda, escuro);
   roda.position.set(sx, 0.5, sz);
   ```
2. Em `update(dt)`, troque `roda.rotation.y += giroRoda;` por
   `roda.rotation.x += giroRoda;`.

`giroRoda` já é `passo / 0.5` (distância ÷ raio) — não mexa.

**Critério de aceite.** Olhando o rover de lado enquanto anda, os quatro pneus
giram para a frente no eixo horizontal.

---

## 2. O rover não fica preso em cratera

**Objetivo.** Ao entrar numa cratera, o rover gira no lugar e não sai.

**Por que acontece.** `Rover.sondar(desvio)` faz um `castRay` horizontal a ~1 m
do chão. Dentro de uma cratera, a parede **é o terreno** — e o terreno é um
colisor. As três sondas acusam obstáculo em qualquer direção e `update()` fica
eternamente aplicando a esquiva, sem nunca voltar ao waypoint.

A correção tem três partes: (a) a sonda ignora o terreno, (b) relevo passa a ser
avaliado por **altura**, que é o teste certo para uma rampa, (c) um vigia de
"estou preso".

**Arquivos.** `src/config.js`, `src/entities/rover.js`

### 2.1 Config

Em `CONFIG.levels.moon`, acrescente:

```js
/* ------------------------------------------------------------- rover ----
   O veículo que ronda a base. Ver `entities/rover.js`. */
rover: {
  speed: 3.6,          // m/s
  turnRate: 1.0,       // rad/s
  probeDist: 7,        // m — a que distância ele "olha" o relevo à frente
  maxClimb: 0.8,       // m — degrau que ele aceita subir no `probeDist`
  propRayDist: 6,      // m — alcance da sonda de obstáculo sólido
  stuckWindow: 3.0,    // s de observação do vigia de travamento
  stuckDistance: 2.0,  // m — andou menos que isto na janela ⇒ travado
  unstuckTime: 2.5,    // s dirigindo reto, ignorando sondas, para escapar
},
```

### 2.2 A sonda ignora o terreno

O Rapier aceita como **8º argumento** de `castRay` um `filterPredicate:
(collider) => boolean`, e `hit.collider.handle` casa com
`physics.ownerOf(handle)`. Em `Rover.sondar(desvio)`:

```js
const hit = this.physics.world.castRay(
  this._ray,
  CONFIG.levels.moon.rover.propRayDist,
  true,
  undefined,
  undefined,
  this.collider,
  undefined,
  /* O TERRENO NÃO É OBSTÁCULO para a sonda.
   *
   * Dentro de uma cratera a parede é o próprio terreno, e com ela contando
   * como obstáculo as três sondas acusavam bloqueio em toda direção — o rover
   * girava no lugar até o fim do mundo. Relevo é problema do teste de ALTURA
   * (`subidaAdiante`), que sabe distinguir rampa de parede; a sonda existe só
   * para caixas de carga, domos e o foguete. */
  (c) => this.physics.ownerOf(c.handle)?.kind !== "terrain",
);
return hit ? hit.timeOfImpact : Infinity;
```

Substitua as referências a `SONDA_ALCANCE` por
`CONFIG.levels.moon.rover.propRayDist` e remova a constante de módulo.

### 2.3 Teste de altura para o relevo

Novo método em `Rover`:

```js
/**
 * Quanto o chão SOBE numa direção, a `probeDist` metros daqui.
 *
 * É o teste certo para relevo, e o que a sonda de raio não sabe fazer: uma
 * rampa suave e uma parede de cratera devolvem o mesmo "tem terreno à frente"
 * para um raio, e coisas completamente diferentes para uma diferença de
 * altura. Negativo = o chão desce.
 * @param {number} desvio rad a partir do rumo atual
 */
subidaAdiante(desvio) {
  const d = CONFIG.levels.moon.rover.probeDist;
  const ang = this.yaw + desvio;
  const px = this.x + Math.sin(ang) * d;
  const pz = this.z + Math.cos(ang) * d;
  if (!this.terrain.isWalkable(px, pz)) return Infinity;
  return this.terrain.heightAt(px, pz) - this.y;
}
```

### 2.4 Nova lógica de rumo

Substitua o bloco `if (this.sondar(0) < SONDA_ALCANCE) { ... }` de `update(dt)`
por:

```js
const R = CONFIG.levels.moon.rover;

/* ------------------------------------------------------ vigia de travamento
   Se ele mal saiu do lugar na última janela, alguma coisa o prendeu (o fundo
   de uma cratera é o caso típico). A saída é dirigir RETO por alguns segundos
   ignorando as sondas: qualquer direção sustentada tira o veículo de uma
   depressão, e insistir na esquiva é o que o mantinha lá dentro. */
this.stuckT += dt;
if (this.escapeT > 0) {
  this.escapeT -= dt;
} else if (this.stuckT >= R.stuckWindow) {
  const andou = Math.hypot(this.x - this.marcoX, this.z - this.marcoZ);
  if (andou < R.stuckDistance) {
    this.escapeT = R.unstuckTime;
    // Troca de destino também: insistir no waypoint que o prendeu repete tudo.
    this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
  }
  this.stuckT = 0;
  this.marcoX = this.x;
  this.marcoZ = this.z;
}

if (this.escapeT <= 0) {
  // Sólido à frente (caixa, domo, foguete): vira para o lado mais livre.
  if (this.sondar(0) < R.propRayDist) {
    const esq = this.sondar(-SONDA_ANGULO);
    const dir = this.sondar(SONDA_ANGULO);
    rumo = this.yaw + (esq > dir ? -SONDA_ANGULO * 1.3 : SONDA_ANGULO * 1.3);
  } else {
    /* Relevo íngreme à frente: procura o lado que SOBE MENOS. Numa cratera
       isso aponta para a borda mais baixa, que é por onde se sai. */
    const frente = this.subidaAdiante(0);
    if (frente > R.maxClimb) {
      const esq = this.subidaAdiante(-SONDA_ANGULO);
      const dir = this.subidaAdiante(SONDA_ANGULO);
      rumo = this.yaw + (esq < dir ? -SONDA_ANGULO * 1.3 : SONDA_ANGULO * 1.3);
    }
  }
}
```

No construtor: `this.stuckT = 0; this.escapeT = 0; this.marcoX = this.x; this.marcoZ = this.z;`
e leia `speed`/`turnRate` do config em vez dos literais.

**Critério de aceite.** Teleportar o rover para o fundo de uma cratera grande:
em no máximo ~8 s ele sai e retoma a ronda. Continua desviando de caixas de
carga.

---

## 3. Sons novos: nave alienígena, voz de alien, explosão

**Objetivo.** Três efeitos sintetizados: `ufoHum` (zumbido de disco voador, **não**
de avião), `alienChirp` (voz curta e esganiçada) e `explosion`.

**Como o áudio funciona.** `src/systems/audio.js` sintetiza **todos** os efeitos
em código. Um som novo é: uma função `makeXBuffer(ctx)` no topo do arquivo + uma
linha em `_initBuffers()`. Para tocar, qualquer módulo emite
`gameEvents.emit(EventType.AUDIO_PLAY, { sound, position, volume })`.

**Arquivos.** `src/systems/audio.js`

**Passos.**

1. Acrescente as três funções junto das outras `make*Buffer`:

```js
/**
 * O zumbido de um disco voador.
 *
 * A assinatura sonora de "nave alienígena" não é motor: é um tom PURO batendo
 * contra outro quase igual. As duas senoides desafinadas produzem um batimento
 * lento, e a modulação em anel por cima acrescenta a bordinha metálica que um
 * motor de avião — ruído de banda larga — nunca tem. É a diferença entre "algo
 * voando" e "algo voando que não é daqui".
 */
function makeUfoBuffer(ctx) {
  const duration = 2.4;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const wob = Math.sin(TAU * 1.6 * t) * 22;   // vibrato lento na altura
    const voz =
      Math.sin(TAU * (196 + wob) * t) * 0.5 +
      Math.sin(TAU * (203 + wob) * t) * 0.5;    // 7 Hz de batimento
    const anel = 0.72 + 0.28 * Math.sin(TAU * 42 * t);
    const env = Math.sin(Math.PI * p) ** 0.9;   // aproxima e passa
    data[i] = voz * anel * env * 0.7;
  }
  return buffer;
}

/**
 * A voz do alien: curta, aguda e quebrada.
 *
 * Um trinado descendente com salto de oitava no meio — o salto é o que a faz
 * soar como fala de bicho e não como apito.
 */
function makeAlienChirpBuffer(ctx) {
  const duration = 0.55;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const salto = p > 0.45 && p < 0.7 ? 1.55 : 1;
    const freq = (880 - 380 * p) * salto + Math.sin(t * 70) * 60;
    phase += (TAU * freq) / sampleRate;
    const voz = Math.sin(phase) * 0.62 + Math.sin(phase * 2.7) * 0.2;
    const chiado = (Math.random() * 2 - 1) * 0.12;
    const env = Math.min(1, t / 0.015) * Math.pow(1 - p, 1.4);
    data[i] = (voz + chiado) * env;
  }
  return buffer;
}

/**
 * Explosão: estalo seco na frente, estrondo grave arrastando atrás.
 *
 * Sem altura definida — explosão não tem nota. O que a torna GRANDE é a cauda:
 * o estalo sozinho lê como tiro, e é o ronco de meio segundo depois dele que
 * diz "aquilo era do tamanho de uma nave".
 */
function makeExplosionBuffer(ctx) {
  const duration = 1.8;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let low = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const branco = Math.random() * 2 - 1;
    low += (branco - low) * 0.05;
    const estalo = branco * Math.exp(-t * 34) * 0.9;
    const corpo =
      low * (Math.exp(-t * 2.6) * 0.9 + Math.exp(-Math.max(0, t - 0.3) * 1.7) * 0.5);
    const ronco =
      Math.sin(TAU * (52 - 26 * Math.min(1, t / duration)) * t) * Math.exp(-t * 2.2) * 0.3;
    data[i] = Math.tanh((estalo + corpo + ronco) * 1.4);
  }
  return buffer;
}
```

2. Em `_initBuffers()`:
   ```js
   this.buffers.ufoHum = makeUfoBuffer(this.ctx);
   this.buffers.alienChirp = makeAlienChirpBuffer(this.ctx);
   this.buffers.explosion = makeExplosionBuffer(this.ctx);
   ```
3. Em `this.dedicatedSize = { ... }` (construtor), acrescente `alienChirp: 4,` e
   `ufoHum: 2,` — sem isso, seis aliens falando ao mesmo tempo comem o pool geral.
4. Em `_playClip3D`, na cadeia de `if (id === ...)`, acrescente um ramo antes do
   `else` final:
   ```js
   } else if (id === "ufoHum" || id === "explosion") {
     /* A nave cruza o céu a 50–80 m de altura e a explosão precisa ser ouvida
        do outro lado da arena. Com o alcance padrão (80 m) as duas sumiam
        justamente quando são o acontecimento da cena. */
     audio.setRefDistance(22);
     audio.setRolloffFactor(0.8);
     audio.setMaxDistance(240);
   } else {
   ```

**Critério de aceite.** No console:
`window.game.audio.play3D("explosion", window.game.player.position, 1)` produz um
estouro audível. Idem para `ufoHum` e `alienChirp`.

---

## 4. A nave faz barulho, o alien fala, e a explosão mata

**Depende de:** 3.

**Arquivos.** `src/config.js`, `src/core/events.js`, `src/systems/spaceLife.js`, `src/main.js`

### 4.1 Config

Em `CONFIG.levels.moon`:

```js
/* ------------------------------------------------------------- naves ----
   O disco voador que cruza o céu. Ver `systems/spaceLife.js`. */
ship: {
  humInterval: 1.9,     // s entre repetições do zumbido enquanto ela passa
  humVolume: 0.75,
  explosionRadius: 13,  // m — quem estiver dentro disto quando ela cai, morre
},
/* ------------------------------------------------------------ aliens ---- */
alien: {
  chirpMinInterval: 5,  // s
  chirpMaxInterval: 15, // s
  chirpVolume: 0.7,
},
```

### 4.2 Evento de explosão

Em `src/core/events.js`, dentro de `EventType`:

```js
/* Uma explosão com raio de dano, no mundo. Quem escuta decide se foi
   atingido — hoje só o jogador local, porque naves, meteoros e estilhaços são
   inteiramente locais (como o alien). */
EXPLOSION: "EXPLOSION",
```

### 4.3 O zumbido da nave

Na classe `Nave` (`src/systems/spaceLife.js`):

1. No construtor, junto de `this.piscar = 0;`: `this.somT = 0;`
2. Em `update(dt, chaoY)`, no ramo de voo normal (depois do
   `this.group.position.lerpVectors(...)`):
   ```js
   /* O ZUMBIDO ACOMPANHA A NAVE. Ele é reemitido na posição ATUAL dela a cada
      poucos segundos em vez de tocado uma vez na entrada: o som do Three é
      posicionado onde nasce e não segue nada, e uma nave que atravessa 500 m
      soaria parada no ponto de onde veio. */
   this.somT -= dt;
   if (this.somT <= 0) {
     const S = CONFIG.levels.moon.ship;
     this.somT = S.humInterval;
     gameEvents.emit(EventType.AUDIO_PLAY, {
       sound: "ufoHum",
       position: vec3Payload(this.group.position),
       volume: S.humVolume,
     });
   }
   ```

### 4.4 A voz do alien

Na classe `Alien`:

1. No construtor, junto de `this.fase = ...`:
   ```js
   const A = CONFIG.levels.moon.alien;
   this.chirpT = A.chirpMinInterval + Math.random() * (A.chirpMaxInterval - A.chirpMinInterval);
   ```
2. No começo de `update(dt, alvos)`, **depois** do `if (this.dead)`:
   ```js
   /* A VOZ, espaçada. Um alien que guincha a cada quadro vira alarme de carro;
      o que assusta é ouvir um deles atrás de você de vez em quando. */
   this.chirpT -= dt;
   if (this.chirpT <= 0) {
     const A = CONFIG.levels.moon.alien;
     this.chirpT = A.chirpMinInterval + Math.random() * (A.chirpMaxInterval - A.chirpMinInterval);
     gameEvents.emit(EventType.AUDIO_PLAY, {
       sound: "alienChirp",
       position: vec3Payload(this.group.position),
       volume: A.chirpVolume,
     });
   }
   ```

### 4.5 A explosão que mata

Em `SpaceLife.explodir(pos, chaoY)`:

1. Troque `sound: "hitScenery"` por `sound: "explosion"`, volume `1.2`.
2. No fim do método:
   ```js
   /* O ESTOURO TEM RAIO. Quem estava embaixo da nave quando ela caiu não
      escapa — e isso transforma "derrubei a nave" numa decisão (mirar nela
      quando vem na sua direção tem preço) em vez de um alvo grátis. */
   gameEvents.emit(EventType.EXPLOSION, {
     position: { x: pos.x, y: chaoY + 1, z: pos.z },
     radius: CONFIG.levels.moon.ship.explosionRadius,
   });
   ```

### 4.6 Quem morre

Em `src/main.js`, junto dos outros `gameEvents.on(...)` do construtor:

```js
/* Explosão perto demais. Mesma razão do alien: naves, meteoros e estilhaços
   são locais, o servidor não os conhece, então quem decide se você morreu é
   esta tela. */
gameEvents.on(EventType.EXPLOSION, (e) => {
  const p = this.player.position;
  const d = Math.hypot(p.x - e.position.x, p.y - e.position.y, p.z - e.position.z);
  if (d <= e.radius) this.killedByLocalNPC(null);
});
```

`killedByLocalNPC` já checa `death.dying` e invulnerabilidade — não repita.

**Critério de aceite.** Zumbido acompanha a nave e vira com a câmera; aliens
guincham ocasionalmente; derrubar a nave em cima de si mata, longe não mata.

---

## 5. Infraestrutura: "andar em cima de coisa que se move"

**Objetivo.** Hoje só o rover carrega o jogador, com a lógica espalhada entre
`Rover.isOnDeck` / `Rover.carry` e `Game.updateRoverRide()`. As tarefas 6 e 7
precisam do mesmo em mais dois objetos. Extraia antes de duplicar.

**Arquivos.** novo `src/entities/rideable.js`, `src/entities/rover.js`, `src/main.js`

**Passos.**

1. Crie `src/entities/rideable.js`:
   ```js
   /* ---------------------------------------------------------------------------
      Andar em cima de coisa que se move.

      O character controller do Rapier não empresta velocidade de colisor
      cinemático a quem está em pé sobre ele: o rover desliza por baixo dos pés
      de quem está parado nele. A solução é a de sempre para plataforma móvel —
      a cada quadro, reprojetar a posição do passageiro do referencial que a
      plataforma tinha ONTEM para o que ela tem AGORA. Translação e guinada.

      Como três coisas diferentes precisam disso (rover, nave de transporte e
      meteorito), a conta mora aqui e cada uma só declara a própria geometria de
      convés.
      --------------------------------------------------------------------------- */

   /** Gira (x, z) por `ang` radianos em torno da origem. */
   export function girar(x, z, ang) {
     const c = Math.cos(ang);
     const s = Math.sin(ang);
     return [x * c - z * s, x * s + z * c];
   }

   /**
    * Mistura para plataformas: guarda a pose do quadro anterior e sabe carregar
    * um ponto. Quem usa precisa manter `x`, `z`, `yaw` e chamar `marcarPose()`
    * no COMEÇO do próprio `update`, antes de se mover.
    */
   export class Plataforma {
     constructor() {
       this.prevX = 0;
       this.prevZ = 0;
       this.prevYaw = 0;
     }

     marcarPose(x, z, yaw) {
       this.prevX = x;
       this.prevZ = z;
       this.prevYaw = yaw;
     }

     /** Convés RETANGULAR (rover, e qualquer coisa com frente e traseira). */
     pisandoEmCaixa(pos, x, z, yaw, deckY, halfW, halfL, tolY = 0.4) {
       const [lx, lz] = girar(pos.x - x, pos.z - z, -yaw);
       if (Math.abs(lx) > halfW || Math.abs(lz) > halfL) return false;
       return Math.abs(pos.y - deckY) < tolY;
     }

     /** Convés REDONDO (disco voador, meteorito) — o giro não importa. */
     pisandoEmDisco(pos, x, z, deckY, raio, tolY = 0.5) {
       if (Math.hypot(pos.x - x, pos.z - z) > raio) return false;
       return Math.abs(pos.y - deckY) < tolY;
     }

     /** Move `pos` (mutado) pelo tanto que a plataforma andou e girou. */
     carregar(pos, x, z, yaw, deckY) {
       const [lx, lz] = girar(pos.x - this.prevX, pos.z - this.prevZ, -this.prevYaw);
       const [wx, wz] = girar(lx, lz, yaw);
       pos.x = x + wx;
       pos.z = z + wz;
       pos.y = deckY;
     }
   }
   ```
2. Refatore `src/entities/rover.js` para usar `Plataforma` por **composição**
   (`this.plat = new Plataforma()`), mantendo a API pública `isOnDeck(pos)` /
   `carry(pos)` / `deckY` que `src/main.js` já chama. Remova a função `girar`
   local e importe a do módulo novo.
3. Em `src/main.js`, renomeie `updateRoverRide()` para `updateRideables()`:
   ```js
   /**
    * Carona: rover, nave de transporte e meteoritos.
    *
    * Roda DEPOIS de `environment.update` — as plataformas já se moveram neste
    * quadro —, e o corpo cinemático do jogador é realinhado na mão porque
    * `player.position` acabou de ser escrito por fora do character controller.
    */
   updateRideables() {
     if (this.death.dying) return;
     // Acabou de pular (ou ligar o jato): deixa sair, senão o pulo nunca decola.
     if (this.playerPhysics.verticalVelocity > 0.5) return;

     const base = this.environment?.base;
     const espaco = this.environment?.space;
     const candidatos = [base?.rover, espaco?.dropship, ...(espaco?.meteors ?? [])];

     for (const plataforma of candidatos) {
       if (!plataforma?.isOnDeck?.(this.player.position)) continue;
       plataforma.carry(this.player.position);
       /* Enquanto ele é carregado, não está caindo: sem zerar a velocidade
          vertical, a plataforma que SOBE (a nave decolando) briga com uma queda
          acumulada e o passageiro treme. */
       this.playerPhysics.verticalVelocity = 0;
       this.playerPhysics.grounded = true;
       this.player.airborne = false;
       this.playerPhysics.syncFromPlayer();
       this.rideando = plataforma;
       return;
     }
     this.rideando = null;
   }
   ```
   Troque a chamada e inicialize `this.rideando = null;` no construtor.

**Critério de aceite.** O rover continua carregando o jogador como antes,
inclusive nas curvas, e o pulo continua permitindo descer.

---

## 6. A nave de transporte: pousa, leva o jogador, e explode

**Objetivo.** Uma nave **maior** que as que cruzam o céu: circunda a base; de
tempos em tempos **pousa** perto do centro; fica um tempo no chão; **decola** com
quem tiver subido; **não some** (a órbita é fechada); levar flecha ⇒ explode no
ar e quem estava em cima morre; destruída, some por um tempo e volta.

**Depende de:** 3, 4, 5.

**Arquivos.** `src/config.js`, novo `src/entities/dropship.js`,
`src/systems/spaceLife.js`, `src/core/hitResolver.js`

### 6.1 Config

Em `CONFIG.levels.moon`:

```js
/* -------------------------------------------------- nave de transporte --
   Grande o bastante para se ficar em cima, e é isso que ela é: um posto de
   tiro que anda. Ver `entities/dropship.js`. */
dropship: {
  raio: 6.0,           // m — raio do disco (o convés)
  alturaVoo: 26,       // m acima do chão em cruzeiro
  raioOrbita: 70,      // m — a órbita em volta da base
  velOrbita: 0.16,     // rad/s
  velVertical: 4.0,    // m/s na subida e na descida
  tempoPousada: 14,    // s parada no chão, esperando passageiro
  tempoVoando: 26,     // s de cruzeiro antes de procurar onde pousar
  raioPouso: 55,       // m — distância máxima do centro da base para pousar
  hp: 3,               // flechas até explodir
  explosionRadius: 14, // m
  reaparecerEm: 20,    // s fora de cena depois de destruída
},
```

### 6.2 A classe

Crie `src/entities/dropship.js`. Estados:
`"cruzeiro" → "descendo" → "pousada" → "subindo" → "cruzeiro"`, mais
`"destruida"`.

- **Visual.** Disco de ~6 m, convés plano por cima, três pés de pouso visíveis
  só em `descendo`/`pousada`, luzes piscando na borda, cúpula emissiva como a da
  `Nave`.
- **Física.** `kinematicPositionBased` + `ColliderDesc.cylinder(0.4, raio)` na
  altura do convés, com `setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)`.
  `physics.register(collider, { kind: "dropship", entityId, dropship: this })`.
- **Órbita.** Em `cruzeiro`, o ângulo avança `velOrbita * dt` em torno de
  `(base.x, base.z)` com raio `raioOrbita`; `y = chao + alturaVoo`; `yaw` na
  tangente.
- **Pouso.** Ao fim de `tempoVoando`, sorteia até 30 pontos com
  `terrain.isFlatGround?.(x, z)` dentro de `raioPouso` do centro. Nenhum servir
  ⇒ mais um ciclo de cruzeiro.
- **Plataforma.** `Plataforma` + `pisandoEmDisco(pos, x, z, deckY, raio * 0.85)`.
  `deckY` = topo do disco.
- **Decolagem com passageiro.** Nada especial: `carry()` escreve
  `pos.y = deckY`, então o passageiro sobe junto. A tarefa 5 já zera a
  velocidade vertical do jogador enquanto ele é carregado, que é o que impede o
  tremor na subida.
- **Destruição.** `abater()`: `hp--`; com `hp > 0`, partículas + `hitScenery`;
  a zero:
  1. `EventType.PARTICLES` — bola de fogo grande;
  2. `AUDIO_PLAY` `explosion`, volume 1.4;
  3. `EventType.EXPLOSION` com `explosionRadius` — mata quem estava em cima
     **e** quem estava perto embaixo, pelo mesmo caminho da tarefa 4.6;
  4. remove o corpo, esconde o grupo;
  5. estado `"destruida"`, `this.voltaEm = cfg.reaparecerEm`.
- **Retorno.** Zerado o cronômetro, recria o corpo, mostra o grupo, zera `hp`,
  volta a `cruzeiro` num ângulo sorteado.

### 6.3 Ligações

1. `SpaceLife`: `this.dropship = new Dropship(parent, physics, terrain, this.centro);`
   no construtor; `this.dropship.update(dt);` no `update`;
   `this.dropship.dispose(this.parent); this.dropship = null;` no `dispose`.
2. `src/core/hitResolver.js`, em `resolveArrowHit`, antes do
   `return resolveSceneryHit(ctx)` final:
   ```js
   if (other.kind === "dropship") return resolveDropshipHit(ctx);
   ```
   ```js
   /**
    * Nave de transporte: a flecha ATRAVESSA e a nave conta o dano.
    *
    * Não crava pelo mesmo motivo do disco voador — ela está no ar e vai
    * explodir; uma flecha presa numa coisa que deixa de existir é uma flecha
    * pendurada no vazio.
    */
   function resolveDropshipHit({ arrow, other, impact, deps }) {
     const nave = other.dropship;
     if (!nave || nave.destruida) return null;
     const explodiu = nave.abater();
     emitImpact(arrow, "dropship", nave.entityId, impact, null, {
       label: "nave de transporte",
       hit: true,
     });
     deps.spawnPuff?.(impact, null);
     deps.removeArrow?.(arrow);
     return { kind: "dropship", entityId: nave.entityId, killed: !!explodiu };
   }
   ```
3. `updateRideables()` já a inclui via `espaco?.dropship`.

**Critério de aceite.** A nave circunda, pousa, espera, decola. Subindo nela no
chão, o jogador viaja em cima e consegue atirar de lá. Três flechas ⇒ explosão,
som, passageiro morre. ~20 s depois ela volta.

---

## 7. Meteoritos lunares, e os estilhaços que matam

**Objetivo.** Rochas grandes vagando lentamente pelo céu da Lua:

- movimento **lento**; dá para pular em cima com o jetpack e ficar lá;
- destrutíveis, **mínimo 3 flechas**, explodindo em vários pedaços;
- grandes o bastante para caber um jogador em cima;
- pelo menos **3 formatos** diferentes, com pequenas crateras;
- **meteoritos bem menores** voando junto, como cauda;
- **os estilhaços da explosão são letais enquanto caem**: acertar um jogador ou
  um alien em pleno voo mata. Depois de assentarem no chão ficam inofensivos e
  **somem em alguns segundos**.

**Depende de:** 3, 4, 5.

**Arquivos.** `src/config.js`, novo `src/entities/meteor.js`,
`src/systems/spaceLife.js`, `src/core/hitResolver.js`

### 7.1 Config

Em `CONFIG.levels.moon`:

```js
/* -------------------------------------------------------- meteoritos ----
   Rocha grande em deriva lenta. Ver `entities/meteor.js`. */
meteors: {
  max: 3,               // quantos existem ao mesmo tempo
  spawnMin: 16,         // s entre nascimentos
  spawnMax: 34,
  raioMin: 2.4,         // m — grande o bastante para se ficar em cima
  raioMax: 3.6,
  velMin: 1.2,          // m/s — deriva, não meteoro em queda
  velMax: 2.6,
  alturaMin: 11,        // m acima do chão
  alturaMax: 26,
  giro: 0.12,           // rad/s de tombo lento
  hp: 3,                // flechas para estourar
  escoltaMin: 5,        // pedrinhas acompanhando
  escoltaMax: 9,
  explosionRadius: 7,   // m — o estouro em si
  formatos: 3,          // variantes de silhueta

  /* -------------------------------------------------------- estilhaços --
     Os pedaços que saem voando quando ele estoura.

     Eles MATAM ENQUANTO VOAM e param de matar assim que assentam. Não é
     detalhe de física: é o que dá consequência a estourar um meteorito em
     cima da cabeça de alguém — inclusive da sua. Um pedaço parado no chão que
     continuasse matando viraria uma mina invisível, que é o oposto de
     legível. */
  fragCount: 12,        // quantos pedaços
  fragRaioMin: 0.25,    // m
  fragRaioMax: 0.7,
  fragSpeedMin: 5,      // m/s — velocidade inicial radial
  fragSpeedMax: 13,
  fragKillSpeed: 3.5,   // m/s — abaixo disto ele já não machuca ninguém
  fragKillRadius: 1.1,  // m — raio de acerto do pedaço em voo
  fragRestitution: 0.25,// quique ao bater no chão
  fragSettleTime: 4.0,  // s no chão até sumir
  fragFadeTime: 1.0,    // s de desaparecimento
},
```

### 7.2 A classe do meteorito

Crie `src/entities/meteor.js`.

**Geometria — os três formatos.** Parta de `IcosahedronGeometry(raio, 2)` e
deforme os vértices com `makeRandom(semente)` de `src/utils/math.js`, com
semente derivada do índice do formato — assim os três são **estáveis** entre
sessões e claramente distintos:

```js
/**
 * Uma rocha, esculpida a partir de um icosaedro.
 *
 * Três coisas, na ordem: um alongamento por eixo (é ele que separa "batata" de
 * "seixo" de "lasca" — a silhueta é o que se lê de longe), um ruído para a
 * superfície não ser lisa, e algumas CRATERAS, que são vértices puxados para
 * dentro num raio pequeno em torno de pontos sorteados.
 *
 * Tudo assado na geometria, uma vez: não custa nada por quadro.
 */
function esculpir(raio, formato) {
  const rnd = makeRandom(7000 + formato * 131);
  const geo = new THREE.IcosahedronGeometry(raio, 2);
  const pos = geo.attributes.position;

  const eixos = [
    [1.0, 0.78, 1.15],
    [1.25, 0.62, 0.9],
    [0.9, 1.0, 0.85],
  ][formato % 3];

  const crateras = [];
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const b = Math.acos(2 * rnd() - 1);
    crateras.push({
      x: Math.sin(b) * Math.cos(a),
      y: Math.cos(b),
      z: Math.sin(b) * Math.sin(a),
      r: 0.22 + rnd() * 0.24, // raio angular
      d: 0.10 + rnd() * 0.12, // profundidade, fração do raio
    });
  }

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nrm = v.clone().normalize();
    let escala = 1 + (rnd() - 0.5) * 0.16;
    for (const c of crateras) {
      const d = Math.hypot(nrm.x - c.x, nrm.y - c.y, nrm.z - c.z);
      if (d < c.r) escala -= c.d * (1 - d / c.r) ** 2;
    }
    v.copy(nrm).multiplyScalar(raio * escala);
    v.x *= eixos[0];
    v.y *= eixos[1];
    v.z *= eixos[2];
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
```

**Material.** `MeshStandardMaterial({ color: "#8a8880", roughness: 0.95, metalness: 0.05, flatShading: true })`.
O `flatShading` é o que faz a rocha ler como rocha e não como bolha.

**Escolta.** `escoltaMin..escoltaMax` malhas pequenas
(`IcosahedronGeometry(0.15 + rnd*0.25, 0)`), filhas do grupo, cada uma com
`{raio, angulo, velAngular, altura}` próprio, atualizadas por quadro.
**Sem colisor** — são visuais. Concentre-as um pouco atrás para lerem como cauda.

**Movimento.** Uma reta atravessando a arena, como a `Nave`: entra pela borda
(`raio da barreira + 40 m`), atravessa até o outro lado, `velMin..velMax`,
altura constante.

> **Cuidado com o tombo.** Girar o grupo inteiro faria o passageiro girar junto.
> Gire só um **grupo interno** com a malha e a escolta; o grupo externo — o que
> define a pose de plataforma — fica sem rotação. É esse externo que
> `Plataforma`/`carry` usam.

**Física.** `kinematicPositionBased` + `ColliderDesc.ball(raio)`, registrado como
`{ kind: "meteor", entityId, meteor: this }` com `COLLISION_EVENTS`.

**Convés.** `deckY = this.y + raio * 0.9`;
`isOnDeck(pos)` → `plat.pisandoEmDisco(pos, this.x, this.z, this.deckY, raio * 0.7, 0.6)`.

**Dano.** `atingir()`: `hp--`, partículas cinzentas + `hitScenery`. A zero:

1. `EventType.PARTICLES` — poeira grande;
2. `AUDIO_PLAY` `explosion`, volume 1.1;
3. `EventType.EXPLOSION` com `explosionRadius` — o estouro em si;
4. **cria os estilhaços** (abaixo);
5. remove o corpo, `this.dead = true`.

### 7.3 Os estilhaços

Escreva uma classe `Estilhaco` no mesmo arquivo (ou um `FragmentField` que
gerencia todos — prefira o segundo: um pool só é mais barato e mais fácil de
limpar no `dispose`).

Cada estilhaço tem:

- malha pequena (reaproveite `esculpir` com raio pequeno e subdivisão 0, ou um
  `IcosahedronGeometry(r, 0)` simples — o que estiver mais barato);
- `vel` (`THREE.Vector3`) inicial radial a partir do centro da explosão, módulo
  em `fragSpeedMin..fragSpeedMax`, com componente vertical positiva;
- giro próprio;
- `assentado = false`, `tempoNoChao = 0`.

`update(dt)`:

```js
/* ------------------------------------------------------- estilhaço em voo
   Enquanto ele VOA, ele mata. Isto é o que dá consequência a estourar um
   meteorito em cima de alguém — e a estourar um em cima de si mesmo.

   O critério é a VELOCIDADE, não o tempo: um pedaço que já parou no chão não
   machuca ninguém, e um que ainda está quicando machuca. Sem isso teríamos
   uma mina invisível no chão da Lua, que é o oposto de legível. */
if (!this.assentado) {
  this.vel.y += CONFIG.levels.moon.gravity * dt;
  this.mesh.position.addScaledVector(this.vel, dt);
  this.mesh.rotation.x += this.giroX * dt;
  this.mesh.rotation.z += this.giroZ * dt;

  const chao = terrain.heightAt(this.mesh.position.x, this.mesh.position.z) + this.raio;
  if (this.mesh.position.y <= chao) {
    this.mesh.position.y = chao;
    // Quica com perda; abaixo do limiar de morte ele simplesmente assenta.
    this.vel.y = -this.vel.y * M.fragRestitution;
    this.vel.x *= 0.5;
    this.vel.z *= 0.5;
    if (this.vel.length() < M.fragKillSpeed) {
      this.assentado = true;
      this.vel.set(0, 0, 0);
    }
  }
} else {
  /* No chão: некого matar, só esperar sumir. O fade evita o pedaço
     desaparecendo num quadro na frente de quem está olhando. */
  this.tempoNoChao += dt;
  const sobra = this.tempoNoChao - M.fragSettleTime;
  if (sobra > 0) {
    this.mesh.material.opacity = Math.max(0, 1 - sobra / M.fragFadeTime);
    this.mesh.material.transparent = true;
  }
  return this.tempoNoChao > M.fragSettleTime + M.fragFadeTime; // true = descarta
}
```

> Corrija o comentário acima ao escrever — trocar "некого" por "não há quem".
> (Deixado de propósito para você reparar que comentário é para ser lido.)

**A parte letal.** Não use colisor de física — são doze pedaços por explosão e
eles vivem poucos segundos. Faça o teste por distância, no `update` do gerente,
e emita o mesmo evento de explosão com raio pequeno:

```js
/* Um pedaço em voo acertou algo. Reaproveita `EXPLOSION` porque o efeito é
   idêntico do ponto de vista de quem escuta — "morreu quem estava a menos de
   X metros deste ponto" —, e assim o jogador local, o alien e qualquer coisa
   futura respondem pelo mesmo caminho. */
if (!frag.assentado && frag.vel.length() >= M.fragKillSpeed) {
  gameEvents.emit(EventType.EXPLOSION, {
    position: vec3Payload(frag.mesh.position),
    radius: M.fragKillRadius,
    silencioso: true, // sem som: o estouro já tocou
  });
}
```

> **Não emita isso a cada quadro para cada pedaço** — seriam ~700 eventos por
> segundo por explosão. Emita só quando o pedaço estiver **perto de alguém**:
> percorra a lista de alvos (jogador local + aliens) e teste a distância
> diretamente; emita o evento apenas no quadro em que houver acerto, e marque o
> pedaço como `jaAcertou = true` para não repetir.

**Aliens também morrem.** No gerente dos estilhaços, além do jogador local,
teste contra `space.aliens` e chame `alien.atingir()` no acerto — o alien já
morre com um golpe (`hp = 1`).

### 7.4 Ligações

1. `SpaceLife`: `this.meteors = []; this.tMeteor = 8;` no construtor; o mesmo
   padrão das naves no `update` (cronômetro, teto `meteors.max`, criar,
   atualizar, remover); `dispose` limpa meteoros **e** estilhaços.
2. `src/core/hitResolver.js`: ramo `other.kind === "meteor"` →
   `resolveMeteorHit`, análogo ao `resolveDropshipHit` (a flecha **atravessa**,
   `deps.removeArrow`).
3. `updateRideables()` já os inclui via `espaco?.meteors`.

**Critério de aceite.**
- Até 3 meteoritos derivando lentamente, com pedrinhas em volta; três formatos
  visivelmente diferentes, com crateras.
- Voar de jetpack e pousar em cima: o jogador é carregado.
- Duas flechas não destroem; a terceira sim, com explosão, som e estilhaços.
- Ficar embaixo de um meteorito estourando: os estilhaços em queda matam.
- Depois de assentarem, andar por cima dos pedaços **não** mata.
- Os pedaços somem ~5 s depois de tocar o chão, com fade.

---
---

# BLOCO B — O bot vai para o servidor

## 8. Migração: o bot vira um jogador da sala

**Objetivo.** Tirar o bot do cliente e colocá-lo no servidor, como os porcos e
os zumbis. Depois disso, um bot adicionado durante uma partida online **é visto
por todos**, aparece no placar, é perseguido pelos aliens, é alvo dos porcos e
morre para todo mundo ao mesmo tempo.

**Por que isso é possível sem inventar nada.** Todo o encanamento já existe:

| O bot precisa de | O que já existe |
|---|---|
| Corpo desenhado nas outras telas | `S2C.STATES` → `RemotePlayers` (com cápsula de física, então a flecha do humano o acerta) |
| Entrar e sair da sala | `S2C.JOIN` / `S2C.LEAVE` |
| Flecha visível voando | `S2C.SHOT` → `RemoteArrows.onShot` (`visualOnly`) |
| Flecha parando no lugar certo | `S2C.IMPACT` → `RemoteArrows.onImpact` |
| Morrer com ragdoll e som | `S2C.KILL` → `RemotePlayers.kill` + o som que `Game.deathPosition` já toca |
| Pose no formato da rede | `packState(obj)` é **pura** e aceita qualquer `{position, yaw, pitch, ...}` |

**O que o servidor NÃO tem** e precisa ser resolvido: física de flecha (ele não
roda Rapier) e conhecimento de árvores/rochas. O primeiro é resolvido aqui
(§8.4, integração numérica pura); o segundo é a tarefa 13.

**Arquivos.** novo `server/botSim.js`; `server/room.js`; `src/shared/protocol.js`;
`src/main.js`; `src/systems/input.js`; remoção de `src/systems/bot.js`

### 8.1 Protocolo

`src/shared/protocol.js`:

1. Suba `PROTOCOL_VERSION` de `11` para `12` e escreva o parágrafo no estilo dos
   anteriores: *"12 — os adversários de CPU deixaram de ser locais e passaram a
   viver na sala, como os porcos e os zumbis. Uma aba antiga veria os outros
   atirando em alguém que, para ela, não existe."*
2. Em `C2S`:
   ```js
   /** Põe ou tira um adversário de CPU: `{ remove?: boolean }`. */
   BOT: "bot",
   /** Muda a perícia dos bots: `{ step: 1 | -1 }` ou `{ level: "easy" }`. */
   BOT_DIFFICULTY: "botDifficulty",
   ```
3. Em `S2C`:
   ```js
   /** A perícia dos bots mudou: `{ level }`. Vira aviso na tela de todos. */
   BOT_DIFFICULTY: "botDifficulty",
   ```

### 8.2 `server/botSim.js`

Porte a lógica de `src/systems/bot.js`, **removendo tudo que é Three.js e
Rapier**. O que sobrevive quase intacto: `mirarComLead`, `elevacaoPara`,
`escolherAlvo`, `mover` (trocando `terrain.isWalkable` pelo mesmo teste, que já é
puro) e a máquina de tensionar/atirar.

```js
/* ---------------------------------------------------------------------------
   O adversário de CPU, no servidor.

   Ele deixou de ser local. Antes cada cliente hospedava os próprios bots, e
   isso tinha um limite óbvio: **ninguém mais os via**. Dois amigos na mesma
   sala jogavam contra adversários invisíveis um para o outro, e o abate de um
   bot não existia para o placar de ninguém.

   Aqui ele é o que sempre deveria ter sido: um jogador da sala que não tem
   socket. Ele nasce pelo mesmo contador de id, aparece no mesmo `S2C.STATES`,
   atira pelo mesmo `S2C.SHOT` e morre pelo mesmo `S2C.KILL`. Nenhuma linha de
   cliente precisa saber que o atirador não era gente — e é justamente por isso
   que a migração cabe num arquivo.

   ------------------------------------------------------------------ a flecha

   O servidor não roda Rapier. A flecha do bot é integrada AQUI, à mão, com o
   mesmo modelo de arrasto de `entities/arrow.js` (F = -½·ρ·Cd·A·|v|·v) no mesmo
   passo fixo. Duas simplificações deliberadas, e o motivo de cada uma:

   • **Sem o termo de ângulo de ataque.** A flecha real se realinha ao vetor
     velocidade em poucos décimos de segundo (é o que o centro de pressão faz),
     então `A_ef ≈ A` durante quase todo o voo. O erro é de centímetros.
   • **Sem colisão com vegetação.** O servidor não conhece árvore (ver
     `birdSim.js`). Enquanto a tarefa 13 não estiver feita, a flecha do bot
     atravessa tronco — e isso o torna um franco-atirador injusto no vale. Não
     considere a migração terminada sem a tarefa 13.
   --------------------------------------------------------------------------- */

import { CONFIG, drawSpeed } from "../src/config.js";

let proximoBotId = null; // injetado pela sala: o MESMO contador dos jogadores
```

Requisitos concretos da classe `Bot`:

- **Campos de pose**, para `packState` funcionar sem adaptador:
  `position: {x,y,z}`, `yaw`, `pitch`, `gaitPhase`, `gaitBlend`, `runBlend`,
  `drawFraction`, `reloadFraction`, `knifeFraction`, `moveF`, `moveS`,
  `airborne`, `jetFlame`.
- **Campos de sala**, para o bot atravessar o código existente sem caso
  especial: `id`, `name` (`"CPU 1"`), `color`, `score` (mesmo formato de
  `emptyScore()`), `alive`, `invulnUntil`, `state`, `stateTime`, `isBot: true`.
  **`conn` não existe** — é isso que impede o `broadcast` de tentar mandar
  pacote para ele.
- **`update(dt, alvos, agora)`** — `alvos` é a lista de personagens vivos
  (humanos + outros bots), no formato `{ id, position, alive }`.
- **Gravidade e salto**: porte o `gravidade(dt)` do cliente, lendo
  `levelPhysics(this.levelId).gravity` e `.jumpSpeed`.
- **Tiro**: quando decidir atirar, **não** crie flecha nenhuma; devolva um
  descritor `{ origem:[x,y,z], direcao:[x,y,z], velocidade }` e deixe a sala
  cuidar do resto (§8.4).
- **O ponto de disparo (`muzzle`)**: no cliente sai da postura do boneco
  (`player.getMuzzle`). No servidor não há boneco. Use uma aproximação
  documentada: `position + (0, 1.35, 0)` deslocado 0,3 m à frente ao longo da
  mira. Comente que a diferença para o muzzle real é de centímetros e não muda
  a balística.

Requisitos da classe `BotSquad` (a coleção):

- `add(opcoes)`, `removeLast()`, `clear()`, `get count()`, `update(dt, alvos, agora)`,
  `relevel(terrain, levelId)`, `setDifficulty(nome)`, `cycleDifficulty(passo)`.
- Teto de 6, como hoje.
- Cores da mesma paleta de hoje.

### 8.3 A sala adota os bots

`server/room.js`:

1. No construtor: `this.bots = new BotSquad(this.terrain, this.level);`
2. **Um lugar só para "todo mundo que tem corpo"** — sem isso, cada uso vira um
   caso especial:
   ```js
   /**
    * Jogadores e bots, juntos.
    *
    * Quase todo o resto da sala quer "quem tem corpo em campo", e não "quem tem
    * socket": os porcos fogem dos dois, o alce escolhe vítima entre os dois, o
    * placar mostra os dois e uma flecha acerta os dois. O único lugar que
    * precisa da distinção é o envio de pacote — e lá o critério é `conn`, que o
    * bot não tem.
    */
   allCharacters() {
     return [...this.players.values(), ...this.bots.list];
   }
   ```
3. Passe a usar `allCharacters()` em:
   - `playerPositions()` — porcos, alces e zumbis passam a reagir aos bots;
   - `scores()` — o bot aparece no placar (mande `isBot: true` junto);
   - `playerById(id)` — **essencial**: é por aqui que `registerKill` encontra o
     bot como vítima quando um humano o acerta;
   - `sendStates()` — empurre também `{ id: bot.id, w: agora, ...bot.state }`.
4. **Nascimento e morte.** `spawn(player)` **já funciona para bot sem nenhuma
   alteração** — está conferido: ele não toca em `player.conn`, só escreve
   `alive` / `invulnUntil` / `state` e faz `broadcastAll`. `registerKill`
   também: a vítima bot tem `alive`, `invulnUntil`, `state` e `score`.
   Uma correção pequena vale a pena mesmo assim: `spawn` monta a lista de
   pontos `ocupados` a partir de `this.players.values()`, então os bots não são
   levados em conta na separação mínima e podem nascer em cima de alguém.
   Troque por `this.allCharacters()`.
5. **Entrar e sair.** Ao criar um bot:
   ```js
   this.broadcastAll({ t: S2C.JOIN, player: { id: bot.id, name: bot.name, color: bot.color, isBot: true } });
   this.spawn(bot);
   this.broadcastScores();
   ```
   Ao remover: `this.broadcastAll({ t: S2C.LEAVE, id: bot.id, name: bot.name });`
6. **Snapshot.** Em `snapshot(exceto)`, concatene os bots na lista `players`
   (com `state`), para quem entra no meio ver os que já estão lá.
7. **Tique.** Os bots precisam de passo mais fino que os bichos (10 Hz): rode-os
   no mesmo timer de `sendStates` (20 Hz) ou num timer próprio a 30 Hz. Comente
   a escolha. Passe `dt` real medido, não o nominal.
8. **Troca de fase.** Em `commitPreparedMode(token)`, depois de `this.level = ...`:
   ```js
   /* Os bots saem na troca de fase.
    *
    * Poderiam atravessar — `relevel` sabe religá-los — e ainda assim saem:
    * quem viaja para a Lua está mudando de assunto, e chegar lá com a mesma
    * escolta de CPU do vale não é o que ninguém pediu. Uma linha para mudar de
    * ideia, se um dia o modo de times quiser o contrário. */
   this.clearBots();
   ```
   `clearBots()` remove cada um com o `S2C.LEAVE` correspondente.
9. **Mensagens novas** no `switch` de `handleMessage`:
   ```js
   case C2S.BOT:
     if (msg.remove) this.removeBot();
     else this.addBot();
     break;

   case C2S.BOT_DIFFICULTY: {
     const nivel = msg.level
       ? this.bots.setDifficulty(msg.level)
       : this.bots.cycleDifficulty(msg.step === -1 ? -1 : 1);
     this.broadcastAll({ t: S2C.BOT_DIFFICULTY, level: nivel });
     break;
   }
   ```

### 8.4 A flecha do bot, no servidor

Escreva `server/botArrow.js` (ou uma seção de `botSim.js`).

Quando um bot decide atirar, a sala:

1. **Anuncia o voo** — todos os clientes desenham a flecha, sem resolver nada:
   ```js
   this.broadcastAll({
     t: S2C.SHOT,
     owner: bot.id,
     ownerEntity: playerEntity(bot.id),
     id: idDaFlecha,
     o: tiro.origem,
     d: tiro.direcao,
     v: tiro.velocidade,
     w: this.now(),
   });
   ```
2. **Simula o voo** num passo fixo (`CONFIG.physics.fixedStep`), com a física da
   fase (`levelPhysics(this.level)`):
   - `v += (g + arrasto/massa) * h`, `p += v * h`;
   - arrasto: `F = -½·ρ·Cd·A·|v|·v` com `ρ = fisica.airDensity`,
     `Cd = CONFIG.arrow.dragCoefficient`, `A = CONFIG.arrow.frontalArea`;
   - a cada passo, teste o segmento `[anterior, atual]` contra:
     - **personagens** (`allCharacters()`, exceto o dono, vivos e não imunes):
       distância do segmento à cápsula vertical
       `[pos, pos + CONFIG.player.height]` menor que
       `CONFIG.player.colliderRadius + CONFIG.arrow.shaftRadius * 1.5`;
     - **bichos** (tarefa 11);
     - **terreno**: `terrain.heightAt(x, z) >= y`;
   - encerre por `CONFIG.arrow.maxLifetime` da fase, por altitude ou por sair da
     área jogável (`isWalkable`).
3. **Anuncia onde parou** — é isto que faz a cópia visual de cada cliente
   encaixar no lugar certo:
   ```js
   this.broadcastAll({
     t: S2C.IMPACT,
     owner: bot.id,
     ownerEntity: playerEntity(bot.id),
     id: idDaFlecha,
     k: tipoDoAlvo,      // "character" | "terrain" | "boar" | ...
     ti: idDoAlvo,
     p: [x, y, z],       // pose final
     q: [qx, qy, qz, qw],// orientação: use a direção da velocidade no impacto
     c: [cx, cy, cz],    // ponto de contato
     v: [vx, vy, vz],    // velocidade no impacto
   });
   ```
   Confira os nomes de campo contra o que `RemoteArrows.onImpact` lê
   (`msg.p`, `msg.c`, `msg.k`, `msg.ti`, `msg.v`) e contra o que o handler de
   `C2S.IMPACT` já retransmite — **use exatamente os mesmos**, para não haver
   dois formatos de impacto no protocolo.
4. **Se acertou personagem**, chame o caminho de morte já existente
   (`registerKill`-equivalente com o bot como matador), que faz o `S2C.KILL`,
   o placar e o respawn.

> **Simule no máximo umas 20 flechas de bot ao mesmo tempo.** Com 6 bots e
> ~1,4 s de recarga, o pico real fica em ~6. Cada uma são ~360 passos de conta
> escalar — irrelevante para o Node. Mas ponha o teto assim mesmo, para um bug
> de recarga não virar um vazamento.

### 8.5 O cliente esquece de simular bots

`src/main.js`:

1. **Remova** `import { BotManager }`, `this.bots = new BotManager({...})`,
   `this.bots.update(...)`, `this.bots.relevel(...)`, `this.bots.positions(...)`
   em `livePlayers()`, `botTargets()` e a chamada `this.bots.clear()` em
   `beforeLevelDispose()`.
2. **Remova** o listener de `ARROW_IMPACT` que detecta flecha de bot acertando o
   jogador local e chama `killedByLocalNPC` — o servidor agora manda um
   `S2C.KILL` de verdade. **Mantenha** `killedByLocalNPC` e
   `reviveFromLocalDeath`: alien, nave, meteoro e estilhaço continuam usando.
3. `handleActions`: `if (a.toggleBot)` passa a mandar
   `this.net.send(C2S.BOT, { remove: a.toggleBot === "remove" })`.
4. Novo handler: `net.on(S2C.BOT_DIFFICULTY, (msg) => { ... toast ... })`.
5. `src/systems/bot.js` pode ser **apagado**. Antes de apagar, confirme com
   `grep -rn "systems/bot" src/` que ninguém mais o importa.

**Critério de aceite.**
- Abrir **duas abas** na mesma sala. Apertar `B` numa delas: o bot aparece
  **nas duas**, com etiqueta "CPU 1", andando igual.
- O bot atira; a flecha é vista voando nas duas abas e crava no mesmo lugar.
- O bot mata um humano: as duas abas veem o corpo cair e o placar mudar.
- Um humano mata o bot: idem, e o som de morte toca (vem de graça pelo
  `S2C.KILL`, que já toca `playerDeath` via `Game.deathPosition`).
- Apertar `9` com bots em campo: a troca completa e os bots somem.

---

## 9. O bot fácil: para para mirar, erra mais, e às vezes avança

**Depende de:** 8. **Todas as mudanças agora são em `server/botSim.js`.**

**Objetivo.** Três mudanças, **só na dificuldade fácil**: às vezes ele **para de
andar** para atirar (não sempre); **erra mais**; às vezes **chega mais perto**.

### 9.1 Config

Em `src/config.js`, `CONFIG.bot.difficulties`:

```js
easy: {
  erroMira: 0.026,      // era 0.02 — a mão treme mais
  missChance: 0.62,     // era 0.45 — erra de propósito quase 2 em 3 tiros
  missSpread: 7,
  reacao: 0.55,
  precisaoLead: 0.5,
  /* PARAR PARA MIRAR. Um bot que atira em movimento o tempo todo lê como
     máquina; parar é o que um jogador iniciante faz — e é também o que o
     torna um alvo, que é o outro lado do trato. */
  pausaChance: 0.55,
  pausaMin: 0.8,        // s
  pausaMax: 1.6,        // s
  /* AVANÇAR. De vez em quando ele encurta a distância ideal e vem para cima,
     em vez de circular eternamente na mesma órbita. */
  avancoChance: 0.3,
  avancoIntervalo: 7,   // s entre sorteios
  avancoMin: 3.0,       // s de duração
  avancoMax: 6.0,
  avancoMetros: 16,     // quanto a faixa ideal encolhe durante o avanço
},
```

`medium` e `hard` recebem as mesmas chaves com valores mais tímidos
(`pausaChance` 0.35 / 0.2; `avancoChance` 0.25 / 0.2; `avancoMetros` 12 / 10).
Atualize também o objeto `PERICIA` de rede de segurança.

### 9.2 Estado

No construtor de `Bot` (servidor):
```js
this.pausaT = 0;              // s restantes parado para mirar
this.avancoT = 0;             // s restantes de avanço
this.avancoSorteioEm = Math.random() * (this.pericia.avancoIntervalo ?? 8);
this._decidiuPausa = false;
```

### 9.3 `mover(dt, alvo)`

Antes do cálculo de `IDEAL_MIN`/`IDEAL_MAX`:

```js
/* PARADO PARA MIRAR. Ele continua girando o corpo para o alvo — o que para
   são os PÉS. */
this.pausaT = Math.max(0, this.pausaT - dt);
if (this.pausaT > 0) {
  this._andando = false;
  this.gaitBlend = 0;
  return;
}

this.avancoT = Math.max(0, this.avancoT - dt);
this.avancoSorteioEm -= dt;
if (this.avancoSorteioEm <= 0) {
  this.avancoSorteioEm = this.pericia.avancoIntervalo ?? 8;
  if (this.avancoT <= 0 && Math.random() < (this.pericia.avancoChance ?? 0)) {
    const min = this.pericia.avancoMin ?? 3;
    const max = this.pericia.avancoMax ?? 6;
    this.avancoT = min + Math.random() * (max - min);
  }
}
```

E as faixas passam a responder ao avanço:
```js
const encolhe = this.avancoT > 0 ? (this.pericia.avancoMetros ?? 0) : 0;
const IDEAL_MIN = Math.max(8, 34 - encolhe);
const IDEAL_MAX = Math.max(IDEAL_MIN + 12, 62 - encolhe);
```

### 9.4 `mirarEAtirar(dt, alvo)`

**Depois** da linha que declara `tensaoAlvo` e da que atualiza `this.drawTime`:

```js
/* A parada é decidida NO MEIO do tensionamento, e uma vez só por tiro: no
   começo ele ainda não sabe se vai atirar, e no fim já seria tarde para a
   parada significar alguma coisa. */
if (
  !this._decidiuPausa &&
  this.drawTime > tensaoAlvo * 0.5 &&
  Math.random() < (this.pericia.pausaChance ?? 0)
) {
  const min = this.pericia.pausaMin ?? 0.6;
  const max = this.pericia.pausaMax ?? 1.2;
  this.pausaT = min + Math.random() * (max - min);
}
if (this.drawTime > tensaoAlvo * 0.5) this._decidiuPausa = true;
```

Zere `this._decidiuPausa = false;` em `atirar()` e em `renascer()`.

**Critério de aceite.** Com `easy`, observar um bot por ~1 min: ele visivelmente
para em alguns tiros e atira andando em outros; a taxa de acerto cai; em algum
momento ele encurta a distância e depois volta a orbitar.

---

## 10. O bot não sobe a serra para sempre

**Depende de:** 8. **Mudança em `server/botSim.js`.**

**Objetivo.** No vale os bots sobem a montanha e duelam lá em cima, fora do campo
de visão de quem está na bacia. Podem **subir até o alto do sopé**, não além.

**Por que acontece.** `TerrainField.isWalkable(x, z)` só bloqueia as bordas da
malha (±175 m em X, −400..120 m em Z); a inclinação não impede nada — é
intencional para o humano. O bot usa exatamente esse teste.

A medida certa já existe e não estava sendo usada: `CONFIG.world.arena.walkMargin`
(12 m). E `terrain.arenaDistance(x, z)` devolve a distância à borda da bacia
(negativo = dentro). Os dois são puros e existem no servidor.

**Passos.**

1. `src/config.js`, em `CONFIG.bot`:
   ```js
   /* Coleira: até onde o bot pode se afastar da bacia jogável.
      Medida em `arenaDistance` (negativo = dentro da arena), então 12 significa
      "pode subir 12 m sopé acima e nem um metro além". Sem ela os bots subiam a
      serra e duelavam no alto, fora do campo de visão de quem ficou embaixo. Na
      Lua o valor não faz diferença: lá `arenaDistance` já é negativo em toda a
      arena e a barreira circular resolve sozinha. */
   leash: 12, // m de `arenaDistance`
   ```
2. Novo método em `Bot`:
   ```js
   /**
    * O bot pode pisar aqui?
    *
    * É o `isWalkable` do terreno MAIS a coleira: o jogador humano pode subir a
    * serra se quiser (é o cenário dele), mas um adversário que sobe some do
    * duelo — e um duelo que acontece onde ninguém vê não é um duelo.
    */
   podeAndar(x, z) {
     if (!this.terrain.isWalkable(x, z)) return false;
     const limite = CONFIG.bot?.leash ?? 12;
     return (this.terrain.arenaDistance?.(x, z) ?? -Infinity) <= limite;
   }
   ```
3. Em `mover()`, troque `isWalkable(nx, nz)` por `podeAndar(nx, nz)`.
4. Ainda em `mover()`, **antes** do cálculo normal de direção (e depois dos
   blocos da tarefa 9), o retorno para dentro — sem ele um bot já fora da
   coleira fica raspando na borda invisível:
   ```js
   /* Já está fora da coleira: o único objetivo é voltar. Sem este caso, o
      strafe o joga contra o limite e ele fica vibrando lá em cima. */
   const dist0 = this.terrain.arenaDistance?.(p.x, p.z) ?? -Infinity;
   if (dist0 > (CONFIG.bot?.leash ?? 12)) {
     const cx = this.terrain.spawnCenter?.x ?? CONFIG.spawn.centerX;
     const cz = this.terrain.spawnCenter?.z ?? CONFIG.spawn.centerZ;
     const vx0 = cx - p.x;
     const vz0 = cz - p.z;
     const m0 = Math.hypot(vx0, vz0) || 1;
     const passo0 = CONFIG.player.walkSpeed * dt;
     p.x += (vx0 / m0) * passo0;
     p.z += (vz0 / m0) * passo0;
     this._andando = true;
     this.gaitBlend = 1;
     this.gaitPhase = (this.gaitPhase + (passo0 / CONFIG.gait.strideLength) * TAU) % TAU;
     return;
   }
   ```

**Critério de aceite.** No vale, 3 bots por 2 minutos: nenhum ultrapassa a faixa
gramada do sopé; todos permanecem visíveis de dentro da bacia. Na Lua nada muda.

---

## 11. O bot atira nos bichos

**Depende de:** 8.

**Objetivo.** O bot passa a mirar também na fauna: porcos, alces, zumbis e
lobos. **Pássaros ficam de fora** — alvo pequeno, alto e rápido; um bot atirando
neles vira um bot olhando para o céu.

**Por que ficou fácil.** Com a tarefa 8 feita, bot e bichos vivem **no mesmo
processo**. A sala já tem `this.hunt.boars`, `this.elks.elks` e
`this.zombies.zombies` em mãos; o abate é autoritativo e todos os clientes o
veem pelo `S2C.BOAR_DEATH` / `ELK_DEATH` / `ZOMBIE_DEATH` que já existem. A
desconexão que existiria com bots locais (o porco morrendo só numa tela)
simplesmente não acontece.

> **Aliens ficam de fora.** Eles continuam sendo do cliente
> (`src/systems/spaceLife.js`) — o servidor não sabe que existem. Incluí-los
> exige migrar o alien para o servidor, que é outro trabalho e não está neste
> plano. Não invente um canal só para isto.

**Passos.**

1. `src/config.js`, em `CONFIG.bot`:
   ```js
   /* Quanto o bot PREFERE um adversário a um bicho.
      A distância até o bicho é multiplicada por isto na escolha do alvo: com
      1.8, um porco a 20 m só ganha de um duelista a 36 m. O bot continua sendo
      um duelista que atira na caça de passagem, não um caçador que ignora
      você. */
   creaturePenalty: 1.8,
   ```
2. `server/room.js` — monte a lista de bichos vivos no formato que o bot
   entende, e passe no `update` da esquadra:
   ```js
   /**
    * Os bichos que o bot pode caçar.
    *
    * PÁSSAROS FICAM DE FORA de propósito: alvo pequeno, alto e em movimento —
    * o bot passaria o duelo de cabeça erguida mirando o céu, e um adversário
    * distraído por pardais não é adversário.
    */
   botPrey() {
     const lista = [];
     for (const b of this.hunt.boars) {
       if (!b.dead) lista.push({ kind: "boar", id: b.id, x: b.x, y: b.y, z: b.z });
     }
     for (const e of this.elks.elks) {
       if (!e.dead) lista.push({ kind: "elk", id: e.id, x: e.x, y: e.y, z: e.z });
     }
     for (const z of this.zombies.zombies) {
       if (!z.dead) lista.push({ kind: "zombie", id: z.id, x: z.x, y: z.y, z: z.z });
     }
     return lista;
   }
   ```
   > Os nomes acima já foram conferidos: `Boar`, `Elk` e `Zombie` do servidor
   > guardam `x`, `y`, `z` e `dead` direto no objeto, e as coleções são mesmo
   > `hunt.boars`, `elks.elks` e `zombies.zombies`.
3. `server/botSim.js` — separe as duas perguntas:
   ```js
   /**
    * Em quem ATIRAR — que não é necessariamente para quem se posicionar.
    *
    * Separar as duas perguntas é o que permite o bot dar um tiro no porco que
    * passou sem largar a órbita do duelo: o MOVIMENTO continua governado pelo
    * adversário mais próximo (`escolherAlvo`), e só a MIRA considera bicho.
    */
   escolherAlvoDeTiro(alvos, bichos) { /* ... penalidade ao quadrado ... */ }
   ```
   O movimento continua usando `escolherAlvo(alvos)`; só `mirarEAtirar` recebe o
   alvo de tiro.
4. Altura de mira: bicho é baixo. Em `mirarComLead`:
   ```js
   // Bicho é baixo: mirar no peito de gente passa por cima de um porco.
   const ALTURA_PEITO = alvo.isCreature ? 0.55 : 1.15;
   ```
5. Na simulação da flecha (§8.4), teste também contra os bichos, com raio
   generoso (~0,8 m). No acerto, chame o abate correspondente da sala com o bot
   como matador — **sem pontos** (o bot não disputa placar de caçada) — e
   deixe o `S2C.*_DEATH` sair normalmente.

**Critério de aceite.** No vale, com um bot e porcos soltos (`P`), o bot
ocasionalmente vira e atira num porco, e o porco morre **nas duas abas**. Ele não
persegue porcos. Pássaros nunca são alvo.

---

## 12. Atalhos: adicionar/remover bot e trocar a dificuldade

**Depende de:** 8.

**Objetivo.** O `B` continua adicionando/removendo (agora pela rede), e uma tecla
nova cicla a dificuldade. As duas na lista do `F1`.

**Tecla escolhida: `N`** (de *nível*). `Shift+N` cicla ao contrário.

**Arquivos.** `src/systems/input.js`, `src/main.js`, `src/ui/hud.js`

**Passos.**

1. `src/systems/input.js` — em `this.actions`, acrescente
   `cycleBotDifficulty: 0,` e, no `switch`, ao lado do `case "KeyB":`:
   ```js
   case "KeyN":
     // N de nível. Shift+N volta — a mesma tecla nos dois sentidos, como o B
     // faz com os bots e o 9 com a fase.
     this.actions.cycleBotDifficulty = e.shiftKey ? -1 : 1;
     break;
   ```
   Em `consume()`, `a.cycleBotDifficulty = 0;`.
2. `src/main.js`, em `handleActions(a)`:
   ```js
   if (a.cycleBotDifficulty) {
     this.net.send(C2S.BOT_DIFFICULTY, { step: a.cycleBotDifficulty });
   }
   ```
   E o handler de rede (o aviso vem do servidor, para toda a sala ver):
   ```js
   net.on(S2C.BOT_DIFFICULTY, (msg) => {
     const rotulo = { easy: "fácil", medium: "médio", hard: "difícil" }[msg.level] ?? msg.level;
     this.hud.toast(`bots: dificuldade ${rotulo}`, "hit");
   });
   ```
3. `src/ui/hud.js`, tabela `ATALHOS`: renomeie o grupo `"Fases"` para
   `"Fases e bots"` e acrescente, depois das linhas de bot:
   ```js
   [["N"], "dificuldade do bot"],
   [["Shift", "N"], "dificuldade anterior"],
   ```

**Critério de aceite.** `N` mostra o aviso ciclando fácil → médio → difícil, e
o aviso aparece **nas duas abas**. `F1` lista as duas linhas novas. Um bot já em
campo muda de comportamento na hora.

---

## 13. Obstáculos compartilhados: a linha de visada do bot

**Depende de:** 8. **Sem esta tarefa, a migração não está terminada.**

**O problema.** O comentário original em `src/systems/bot.js` documenta o bug que
a linha de visada resolveu no cliente:

> *"No vale ele duela dentro de um bosque, e a balística resolvida ao centímetro
> só garante que a flecha acerte o TRONCO na frente dele com precisão. Medido:
> noventa tiros, zero acertos, todas as flechas cravadas na mesma árvore."*

No servidor o defeito é o **oposto e pior**: sem árvore nenhuma, a flecha do bot
atravessa tronco, pedra e cerca. Ele vira um franco-atirador que acerta através
do cenário — injusto de um jeito que o jogador não tem como ler.

**A solução.** Extrair as **posições** dos obstáculos do vale para um módulo
puro em `src/shared/`, que cliente e servidor importam. É o mesmo princípio de
`shared/terrainField.js`: a matemática é compartilhada, a malha não.

**Arquivos.** novo `src/shared/valleyProps.js`, `src/entities/environment.js`,
`server/botSim.js` (ou `botArrow.js`)

**Passos.**

1. Crie `src/shared/valleyProps.js`, **puro** (sem Three.js):
   ```js
   /* ---------------------------------------------------------------------------
      Onde ficam as árvores, as rochas e as cercas do vale — só as POSIÇÕES.

      Puro, como `terrainField.js`, e pelo mesmo motivo: o servidor precisa saber
      o que bloqueia uma flecha para que o adversário de CPU não atire através de
      um tronco, e ele não tem — nem quer ter — malha nenhuma.

      O sorteio é DETERMINÍSTICO (`makeRandom` com semente fixa), então a lista
      que o servidor calcula é exatamente a que o cliente desenha. É o mesmo
      contrato que `birdSim.js` usa para os poleiros.

      Cada obstáculo é um CILINDRO VERTICAL — `{ x, z, r, h }`. Não é a silhueta
      da árvore, e não precisa ser: para decidir "a flecha passa ou não passa", a
      copa não conta (ela é folha) e o tronco é um cilindro de verdade.
      --------------------------------------------------------------------------- */
   ```
   Exporte `valleyBlockers(terrain)` devolvendo o array de cilindros.
2. Mova para lá o sorteio de posições que hoje vive em `scatterTrees` e
   `scatterBoulders` (`src/entities/environment.js`). **Não mova a construção da
   malha** — só o `for` que decide `(x, z, escala)`. `environment.js` passa a
   consumir a lista e apenas *desenhar* nela.
   > Faça isso com cuidado: as duas funções também sorteiam variação visual
   > (tipo de árvore, rotação, cor). Só a **posição, o raio e a altura** precisam
   > ser compartilhados; o resto continua no cliente, sorteado com um
   > `makeRandom` de semente própria para não deslocar a sequência do outro.
3. Confirme visualmente que o vale não mudou: mesmas árvores nos mesmos lugares.
   Se mudaram, a sequência de números aleatórios foi alterada — reveja a ordem
   das chamadas de `random()`.
4. No servidor, use a lista em dois lugares:
   - **`temVisada(de, para)`** no bot: um teste segmento × cilindro para cada
     obstáculo dentro da caixa envolvente do tiro. Porte o comportamento do
     cliente: sem visada, o bot **guarda o tiro e continua circundando**.
   - **A simulação da flecha** (§8.4): a flecha para no primeiro cilindro que
     atravessa, e o `S2C.IMPACT` sai com `k: "scenery"`.
5. Indexe por célula (como `MoonField.indexCraters` já faz com as crateras) se o
   custo aparecer no perfil. Com ~algumas centenas de obstáculos e ~6 flechas
   simultâneas, provavelmente não aparece — meça antes de otimizar.

**Critério de aceite.** No vale, um bot atrás de uma árvore **não** atira através
dela: ele circunda até abrir a linha. Uma flecha de bot mirada num jogador atrás
de um tronco crava no tronco, e as duas abas veem a flecha no mesmo lugar.

---

## 14. Verificações finais

1. `npm run build` — sem erro e sem aviso novo.
2. `grep -rn "systems/bot" src/` — nenhum resultado (o módulo local morreu).
3. Roteiro com **duas abas** na mesma sala, em `npm run dev`:
   - `B` numa aba → bot aparece nas duas, anda igual, atira igual.
   - Bot mata humano → corpo cai e placar muda nas duas.
   - Humano mata bot → idem, com som de morte.
   - `N` → aviso de dificuldade nas duas abas.
   - Bot atira num porco → porco morre nas duas.
   - Bot atrás de árvore não atira através dela.
   - 2 min de observação no vale → nenhum bot na serra.
   - `9` com bots em campo → viagem completa, bots removidos.
4. Roteiro de Lua (aba única basta):
   - nave passa com zumbido que a acompanha;
   - alien guincha de vez em quando;
   - derrubar nave em cima de si ⇒ morre; longe ⇒ não morre;
   - rover roda os pneus certo e sai de cratera;
   - nave de transporte pousa, decola com o jogador, e explode com 3 flechas;
   - meteoritos: pousar em cima, 3 flechas para estourar, estilhaços em queda
     matam, estilhaços parados não matam e somem em ~5 s.
5. Console do navegador: **zero** erros durante os dois roteiros.
6. Nenhum número novo fora de `src/config.js`.
