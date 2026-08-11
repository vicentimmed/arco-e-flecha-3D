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

O documento tem quatro blocos, nesta ordem de dependência:

- **Bloco A — correções locais** (tarefas 1 a 5): coisas que não tocam em rede.
  Dão resultado visível cedo e não conflitam com o resto.
- **Bloco B — o bot vai para o servidor** (tarefas 6 a 11): a primeira mudança
  estrutural.
- **Bloco C — a fase do espaço vai para o servidor** (tarefas 12 a 17): alien,
  nave, rover, nave de transporte e meteoritos passam a ser da sala.
- **Bloco D — duelo de times** (tarefa 18): só faz sentido depois de B e C.

> **A nave de transporte e os meteoritos NÃO são construídos no cliente.**
> Eles nascem direto no Bloco C, já como entidade de servidor. Construí-los
> primeiro no cliente e migrar depois seria escrever duas vezes a mesma coisa —
> e a segunda escrita jogaria a primeira fora.

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

**Isto tem consequência direta para o Bloco B** e está tratado na tarefa 11.

### O que vai para o servidor, e o que NÃO vai

A regra é **uma só: vai para o servidor o que muda a partida para outra
pessoa.** O que só existe dentro dos olhos de quem está olhando fica onde
está — sincronizar isso não deixaria a partida mais justa, só mais cara.

| Elemento da Lua | Vai? | Por quê |
|---|---|---|
| **Alien** | **sim** | persegue e mata; se cada um vir o seu, dois jogadores morrem de coisas diferentes |
| **Nave (disco voador)** | **sim** | é abatível, explode e o estouro mata |
| **Rover** | **sim** | carrega jogador e atropela alien; visto em lugares diferentes, o passageiro fica flutuando na tela dos outros |
| **Nave de transporte** | **sim** | idem, e ainda é destrutível com passageiro dentro |
| **Meteorito** | **sim** | dá para ficar em cima, é destrutível e os estilhaços matam |
| **Estilhaço de meteorito** | **sim, mas sem tráfego** | ver a tarefa 17: o servidor manda o *evento* e a semente; os dois lados integram a mesma conta |
| **Estrela cadente** | **não — relógio** | não tem efeito de jogo nenhum. Sincronizar pelo relógio da sala custa **zero byte** e dá o mesmo resultado (tarefa 4) |
| **Baliza do foguete** | **não — relógio** | idem: piscar em fase sai de graça de uma função do tempo |
| **Poeira em suspensão** | **não, nunca** | ela é definida *em torno da câmera de quem olha*. Não existe "a mesma poeira" para duas pessoas — a ideia não tem sentido |
| **Foguete, domos, painéis, carga, bandeira** | **não** | geometria estática, sorteada por semente fixa: já é idêntica em todas as telas desde sempre |
| **Terreno e crateras** | **não** | `MoonField` já é compartilhado (`src/shared/`) |

O padrão do "relógio da sala" não é invenção deste plano: é o mesmo que o
**vento** já usa (`Game.frame` faz `this.wind.setTime(this.net.serverTime / 1000)`),
e pelo mesmo motivo — uma função pura do tempo compartilhado dá sincronia
perfeita sem trafegar nada.

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

### Morte por coisa local — e o fim dela

`Game.killedByLocalNPC(msg)` / `Game.reviveFromLocalDeath()` em `src/main.js`
existem porque bot, alien e explosão eram locais e o servidor recusaria um
`C2S.KILL` autoinfligido (`registerKill` rejeita quando vítima e remetente são a
mesma pessoa).

Os dois vão **desaparecer** ao longo deste plano, e isso é intencional:

- depois do **Bloco B** o bot mata pelo `S2C.KILL` de verdade;
- depois do **Bloco C** o alien, a explosão de nave, a de meteorito e os
  estilhaços também.

Não apague antes da hora — o Bloco A e o começo do B ainda dependem deles. Mas
ao terminar o Bloco C, apague: manter um segundo caminho de morte que ninguém
percorre é convite a percorrê-lo por engano.

---

## Ordem sugerida

| # | Tarefa | Bloco | Depende de |
|---|---|---|---|
| 1 | Rodas do rover giram como pneu | A | — |
| 2 | Rover preso em cratera | A | — |
| 3 | Sons novos (nave, alien, explosão) | A | — |
| 4 | Céu e baliza no relógio da sala | A | — |
| 5 | Infraestrutura de plataforma (andar em cima) | A | 1, 2 |
| 6 | O bot migra para o servidor | B | — |
| 7 | Comportamento do bot fácil | B | 6 |
| 8 | Coleira do bot no vale | B | 6 |
| 9 | Bot atira nos bichos | B | 6 |
| 10 | Atalhos (bot, dificuldade em tempo real) | B | 6 |
| 11 | Obstáculos compartilhados (linha de visada) | B | 6 |
| 12 | O canal do espaço (`S2C.SPACE`) | C | 6 |
| 13 | Aliens no servidor | C | 12 |
| 14 | Naves no servidor + explosão que mata | C | 12, 3 |
| 15 | Rover no servidor | C | 12, 1, 2, 5 |
| 16 | Nave de transporte (nasce no servidor) | C | 12, 5 |
| 17 | Meteoritos + estilhaços (nascem no servidor) | C | 12, 5 |
| 18 | Duelo de times | D | 6, 13 |
| 19 | Verificações finais | — | todas |

---
---

# BLOCO A — Correções locais

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

## 4. O céu e a baliza no relógio da sala

**Objetivo.** Estrela cadente e baliza do foguete passam a acontecer no mesmo
instante em todas as telas — **sem trafegar um único byte**.

**Por que assim e não pelo servidor.** Nenhuma das duas tem efeito de jogo: são
luz. Mandar mensagem para elas seria pagar tráfego por enfeite. Mas as duas são
função do tempo, e a sala já distribui um relógio comum — o mesmo que o vento
usa (`this.wind.setTime(this.net.serverTime / 1000)` em `Game.frame`). Trocando
o cronômetro local pelo relógio compartilhado, a sincronia sai de graça.

**Arquivos.** `src/systems/spaceLife.js`, `src/entities/moonBase.js`,
`src/levels/moonLevel.js`, `src/main.js`

**Passos.**

1. `Game.frame` já calcula `this.net.serverTime`. Passe-o para a fase:
   `this.environment.update(dt, this.wind.vector, this.livePlayers(), this.net.serverTime);`
2. `MoonLevel.update(dt, _wind, jogadores, tempoSala)` repassa `tempoSala` para
   `this.base.update(dt, tempoSala)` e `this.space.update(dt, jogadores, tempoSala)`.
3. **Baliza** (`MoonBase.update`): troque o acumulador
   `this.beaconPhase = (this.beaconPhase + dt) % 2.6;` por uma leitura direta do
   relógio:
   ```js
   /* A fase sai do RELÓGIO DA SALA, não de um acumulador local.
      É a mesma ideia do vento: uma função pura do tempo compartilhado pisca em
      fase em todas as telas sem trafegar nada. Sem servidor (jogo local), o
      relógio vale 0 e ela pisca pelo tempo da própria máquina — igualmente
      correto, só não compartilhado. */
   const t = ((tempoSala ?? performance.now()) / 1000) % 2.6;
   ```
4. **Estrelas cadentes** (`Ambiente`): substitua o par
   `cadenteVoando` / `cadenteT` por uma função do tempo. O truque é fatiar o
   relógio em **janelas fixas** e sortear a cadente a partir do índice da janela:
   ```js
   /* A cadente é uma FUNÇÃO DO RELÓGIO, não um cronômetro.
    *
    * O tempo é fatiado em janelas de `JANELA` segundos; o índice da janela
    * alimenta um sorteio determinístico que decide se há cadente nela, por onde
    * ela entra e para onde vai. Duas telas com o mesmo relógio calculam a mesma
    * cadente sem trocar uma palavra — e uma tela sozinha continua vendo
    * cadentes, porque a conta não depende de haver sala. */
   const JANELA = 26; // s — uma cadente a cada ~26 s, quando ela cai
   ```
   Dentro da janela, `progresso = (t % JANELA) / duracao` governa o rastro
   exatamente como hoje (`atualizarCadente`), e o sorteio por índice
   (`makeRandom(1000 + indiceDaJanela)`) decide origem, direção e se a janela
   tem cadente (por exemplo, 70 % das janelas têm).

**Critério de aceite.** Duas abas na mesma sala, câmeras apontadas para a mesma
região do céu: a cadente cruza no **mesmo instante e no mesmo lugar** nas duas,
e a baliza do foguete pisca em fase. Nenhuma mensagem nova no tráfego (confira
na aba Network).

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

# BLOCO B — O bot vai para o servidor

## 6. Migração: o bot vira um jogador da sala

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
(§8.4, integração numérica pura); o segundo é a tarefa 11.

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
     `birdSim.js`). Enquanto a tarefa 11 não estiver feita, a flecha do bot
     atravessa tronco — e isso o torna um franco-atirador injusto no vale. Não
     considere a migração terminada sem a tarefa 11.
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
     - **bichos** (tarefa 9);
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

## 7. O bot fácil: para para mirar, erra mais, e às vezes avança

**Depende de:** 6. **Todas as mudanças agora são em `server/botSim.js`.**

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

## 8. O bot não sobe a serra para sempre

**Depende de:** 6. **Mudança em `server/botSim.js`.**

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

## 9. O bot atira nos bichos

**Depende de:** 6.

**Objetivo.** O bot passa a mirar também na fauna: porcos, alces, zumbis e
lobos. **Pássaros ficam de fora** — alvo pequeno, alto e rápido; um bot atirando
neles vira um bot olhando para o céu.

**Por que ficou fácil.** Com a tarefa 6 feita, bot e bichos vivem **no mesmo
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

## 10. Atalhos: adicionar/remover bot e trocar a dificuldade

**Depende de:** 6.

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

## 11. Obstáculos compartilhados: a linha de visada do bot

**Depende de:** 6. **Sem esta tarefa, a migração não está terminada.**

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

---
---

# BLOCO C — A fase do espaço vai para o servidor

Leia a tabela **"O que vai para o servidor, e o que NÃO vai"** no contexto de
arquitetura antes de começar. Ela é a justificativa de tudo neste bloco, e
também do que fica de fora.

O resultado esperado: **a partida na Lua é a mesma para todo mundo.** O alien
que te persegue é o mesmo que persegue o outro; a nave que você derrubou some
para os dois; o rover está no mesmo lugar nas duas telas, com o mesmo passageiro
em cima.

---

## 12. O canal do espaço (`S2C.SPACE`)

**Objetivo.** Criar o encanamento que as tarefas 13 a 17 vão usar: um simulador
de espaço no servidor e um `SpaceLife` de cliente que deixa de simular e passa a
**renderizar** o que a sala manda.

**Depende de:** 6 (o padrão de entidade de sala já estar entendido).

**Arquivos.** novo `server/spaceSim.js`; `server/room.js`;
`src/shared/protocol.js`; `src/systems/spaceLife.js`

**O padrão a seguir é o dos porcos.** Não invente outro:
`server/boarSim.js` simula → `Room` transmite a lista a 10 Hz →
`BoarManager.applyNetwork(lista)` reconcilia por id (cria o que é novo,
atualiza o que existe, descarta o que sumiu da lista). Releia
`src/systems/boarManager.js:51` antes de escrever.

**Passos.**

1. **Protocolo** (`src/shared/protocol.js`):
   ```js
   // S2C
   /** Tudo o que se mexe na Lua, 10 Hz: `{ a, s, r, d, m }` — aliens, naves,
    *  rover, nave de transporte e meteoritos. Só sai na fase lunar. */
   SPACE: "space",
   /** Acontecimento pontual do espaço que não cabe numa amostra de 10 Hz:
    *  `{ kind, ... }`. Hoje: `"explosion"` e `"meteorBurst"`. */
   SPACE_EVENT: "spaceEvent",

   // C2S
   /** "Acertei esta coisa do espaço": `{ kind: "alien"|"ship"|"dropship"|"meteor", id }`.
    *  Quem atira continua sendo a autoridade sobre o próprio acerto. */
   SPACE_HIT: "spaceHit",
   ```
   Suba `PROTOCOL_VERSION` (o Bloco B já o levou a 12; este vai a **13**) e
   escreva o parágrafo: *"13 — a fase da Lua deixou de ser cenário local. Alien,
   nave, rover e meteorito passaram a viver na sala; uma aba antiga veria um
   mundo diferente do de todo mundo."*

2. **`server/spaceSim.js`** — uma classe `SpaceField` que possui as cinco
   coleções e um `update(dt, jogadores, agora)`. Cabeçalho:
   ```js
   /* ---------------------------------------------------------------------------
      O que se mexe na Lua, no servidor.

      Antes isto vivia no cliente, um mundo por aba: o alien que te perseguia não
      era o alien que perseguia o seu amigo, e a nave que você derrubou continuava
      voando na tela dele. Numa fase que é só cenário isso passaria; nesta não,
      porque tudo aqui MATA ou CARREGA alguém.

      O que ficou de fora, e por quê, está na tabela do plano: poeira é definida
      em torno da câmera de quem olha (não existe "a mesma poeira" para duas
      pessoas), e cadente e baliza são função pura do relógio — sincronizam de
      graça, sem trafegar nada.
      --------------------------------------------------------------------------- */
   ```
   `SpaceField` só é atualizado quando `room.level === "moon"`; fora da Lua ela
   fica vazia e nada é transmitido.

3. **`Room`**: `this.space = new SpaceField(this.terrain);` no construtor;
   `this.space.setTerrain(...)` na troca de fase; `this.space.clear()` ao sair da
   Lua. No timer de 10 Hz (`tickCreatures`), quando `this.level === "moon"`:
   ```js
   this.space.update(this.boarStep, this.playerPositions(), this.now());
   this.broadcastAll({ t: S2C.SPACE, time: this.now(), ...this.space.view() });
   ```
   `view()` devolve arrays enxutos, no estilo de `hunt.view()` — posições
   arredondadas com `round`, e **só o que muda**: id, posição, rumo, estado.

4. **`src/systems/spaceLife.js`** vira renderizador:
   - `SpaceLife.update(dt, jogadores, tempoSala)` continua cuidando de
     **poeira** e **cadentes** (tarefa 4) — essas continuam locais.
   - Some toda a lógica de decisão: `tNave`, `tAlien`, criação, IA de alien,
     rota de nave. Fica `applyNetwork(msg)` no padrão do `BoarManager`, e um
     `update` que só interpola/anima o que já existe.
   - As classes visuais (`Nave`, `Alien`) **perdem o corpo de física de
     decisão** mas **mantêm o colisor** — é ele que faz a flecha do jogador
     acertar. O `hitResolver` continua igual; o que muda é o que acontece
     depois do acerto (passo 5).
   - Ganha `setNetworkTarget(...)` por entidade, como `Boar`, para a pose não
     saltar entre amostras.

5. **O acerto passa a ser um pedido, não uma decisão.** Em
   `src/core/hitResolver.js`, `resolveSpaceHit` deixa de chamar
   `alvo.abater()` / `alvo.atingir()` e passa a só emitir o evento de impacto.
   Em `src/main.js`, um listener manda ao servidor:
   ```js
   /* Quem atira é a autoridade sobre o PRÓPRIO acerto — é o mesmo contrato do
      porco e do zumbi. Mas quem decide se a nave caiu é a sala: ela é uma só
      para todo mundo, e duas telas não podem discordar sobre uma nave que
      explodiu. */
   gameEvents.on(EventType.SPACE_HIT, (e) => {
     if (e.ownerId !== this.player.entityId) return;
     this.net.send(C2S.SPACE_HIT, { kind: e.kind, id: e.id });
   });
   ```
   O servidor aplica o dano e o resultado volta na próxima amostra de
   `S2C.SPACE` (ou num `SPACE_EVENT`, quando é explosão).

**Critério de aceite.** Duas abas na Lua: a lista de aliens e naves é idêntica
nas duas (confira por `window.game.environment.space` no console). Nada ainda
precisa estar *jogável* — este passo é o encanamento.

---

## 13. Aliens no servidor

**Depende de:** 12.

**Objetivo.** O alien vira NPC de sala: todos veem os mesmos, na mesma posição,
e quando ele mata alguém a morte vale para a partida inteira.

**Passos.**

1. Porte a IA do `Alien` de `src/systems/spaceLife.js` para `server/spaceSim.js`.
   Ela é simples e já é quase pura: escolher o alvo mais próximo, andar até
   `ALIEN_ATTACK_RANGE`, erguer os braços por `ALIEN_ATTACK_WINDUP`, golpear,
   recuar. Só tire o Three.js.
2. Os números vão para `CONFIG.levels.moon.alien` (o bloco já criado na tarefa 3
   ganha `attackRange`, `attackWindup`, `attackCooldown`, `speed`, `hp`,
   `maxAlive`, `spawnMin`, `spawnMax`).
3. **A morte pelo golpe deixa de ser local.** O servidor, ao concluir o golpe,
   chama o mesmo caminho de morte dos outros NPCs e emite
   `S2C.KILL { victim, cause: "alien" }`. No cliente, **remova** o listener de
   `ALIEN_MELEE_HIT` que chamava `killedByLocalNPC`.
4. **O som continua local.** O guincho (`alienChirp`) é tocado pelo cliente na
   posição que veio da rede — som não precisa trafegar, só a posição, que já
   está na amostra.
5. A pose visual do braço erguido vem no estado do alien (`st: "golpeando"`), e
   o cliente anima a partir disso.

**Critério de aceite.** Duas abas: os mesmos aliens, nos mesmos lugares. Um
alien mata o jogador A; a aba do jogador B vê o corpo dele cair. Uma flechada
mata o alien nas duas telas.

---

## 14. Naves no servidor, e a explosão que mata

**Depende de:** 12, 3.

**Passos.**

1. Porte a rota da `Nave` (uma reta atravessando a arena, `de` → `para`,
   duração) e o estado `morta`/queda para `server/spaceSim.js`. Números em
   `CONFIG.levels.moon.ship` (a tarefa 3 já criou o bloco).
2. `C2S.SPACE_HIT { kind: "ship" }` derruba a nave **no servidor**.
3. Ao bater no chão, o servidor emite:
   ```js
   this.broadcastAll({
     t: S2C.SPACE_EVENT,
     kind: "explosion",
     p: [x, y, z],
     r: CONFIG.levels.moon.ship.explosionRadius,
   });
   ```
   e **mata quem estiver dentro do raio** pelo caminho normal de `S2C.KILL`
   (`cause: "explosion"`).
4. No cliente, `SPACE_EVENT/explosion` dispara **só o efeito**: partículas, o
   som `explosion` e o clarão. **Nenhuma decisão de morte.** Remova o listener de
   `EventType.EXPLOSION` que chamava `killedByLocalNPC`.

> **Depois desta tarefa, `killedByLocalNPC` e `reviveFromLocalDeath` ficam sem
> nenhum chamador.** Confirme com `grep -rn "killedByLocalNPC" src/` e
> **apague os dois**. Eles existiam para contornar a ausência de servidor nessas
> entidades; com o servidor presente, mantê-los seria manter um segundo caminho
> de morte que ninguém percorre — e que um dia alguém percorreria por engano.

**Critério de aceite.** Duas abas: a nave é a mesma e cruza igual. A aba A a
derruba; a aba B vê a queda e a explosão. Quem estava perto morre **nas duas
telas**, com o mesmo corpo caindo no mesmo lugar.

---

## 15. O rover no servidor

**Depende de:** 12, 1, 2, 5.

**Objetivo.** A ronda, a esquiva e o atropelamento passam a ser da sala; o
cliente desenha e permite a carona.

**O ponto delicado.** O rover **carrega gente**. Se cada tela o puser num lugar
diferente, o passageiro flutua no ar para os outros. Por isso a posição vem da
rede e a carona é calculada **sobre a posição recebida** — nunca sobre uma
simulação local paralela.

**Passos.**

1. Porte para `server/spaceSim.js`: waypoints, `subidaAdiante` (que é só
   `terrain.heightAt`, puro — ver tarefa 2) e o vigia de travamento.
   **A sonda de raio não vai**: ela depende do Rapier e das caixas de carga, que
   o servidor não conhece. Troque-a pela lista de obstáculos compartilhada da
   tarefa 11, se ela já existir para a Lua; senão, o teste de altura sozinho já
   evita o problema que motivou a tarefa 2, e as caixas de carga passam a ser
   atravessadas — **anote isso como dívida no comentário**.
2. Atropelamento: o servidor testa a distância do rover a cada alien e chama o
   abate. Vale para todos ao mesmo tempo.
3. Cliente: `Rover` mantém o visual, o colisor (para o jogador se apoiar) e o
   `Plataforma`/`carry` da tarefa 5, mas `update` deixa de decidir rumo — ele
   interpola em direção à pose da rede, como um `Boar`.
4. `deckY`, `isOnDeck` e `carry` continuam iguais; eles só leem a pose.

**Critério de aceite.** Duas abas: o rover está no mesmo lugar nas duas. O
jogador A sobe nele; a aba B vê o A em cima, andando junto. O rover atropela um
alien e ele morre nas duas.

---

## 16. A nave de transporte (nasce no servidor)

**Depende de:** 12, 5. **Não construa uma versão local antes.**

**Objetivo.** Uma nave **maior** que as que cruzam o céu: circunda a base;
de tempos em tempos **pousa** perto do centro; fica um tempo no chão; **decola**
com quem tiver subido; **não some** (a órbita é fechada); levar flecha ⇒ explode
no ar e quem estava em cima morre; destruída, some por um tempo e volta.

### 16.1 Config

Em `CONFIG.levels.moon`:

```js
/* -------------------------------------------------- nave de transporte --
   Grande o bastante para se ficar em cima, e é isso que ela é: um posto de
   tiro que anda. */
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

### 16.2 Servidor (`server/spaceSim.js`)

Máquina de estados: `"cruzeiro" → "descendo" → "pousada" → "subindo" →
"cruzeiro"`, mais `"destruida"`.

- **Órbita**: ângulo avança `velOrbita * dt` em torno de `(base.x, base.z)` com
  raio `raioOrbita`; `y = heightAt + alturaVoo`; `yaw` na tangente.
- **Pouso**: ao fim de `tempoVoando`, sorteia até 30 pontos com
  `terrain.isFlatGround(x, z)` (existe no `MoonField`) dentro de `raioPouso`.
- **Destruição**: `SPACE_HIT { kind: "dropship" }` decrementa `hp`. A zero:
  `SPACE_EVENT/explosion` + `S2C.KILL` para todos dentro de `explosionRadius`
  — **inclusive o passageiro**, que por definição está a distância zero.
- **Retorno**: `reaparecerEm` segundos depois, volta ao cruzeiro num ângulo
  sorteado.

### 16.3 Cliente (`src/entities/dropship.js`)

Só visual + colisor + plataforma:

- disco de ~6 m, convés plano, três pés de pouso visíveis só em
  `descendo`/`pousada`, luzes na borda, cúpula emissiva como a da `Nave`;
- colisor `ColliderDesc.cylinder(0.4, raio)` na altura do convés, registrado
  `{ kind: "dropship", entityId, dropship: this }` com `COLLISION_EVENTS`;
- `Plataforma` da tarefa 5 com `pisandoEmDisco(pos, x, z, deckY, raio * 0.85)`;
- `setNetworkTarget` + interpolação, como o `Boar`.

**Decolagem com passageiro** não precisa de nada especial: `carry()` escreve
`pos.y = deckY`, e a tarefa 5 já zera a velocidade vertical do jogador enquanto
ele é carregado — que é o que impede o tremor na subida.

**Critério de aceite.** Duas abas: a nave pousa no mesmo ponto nas duas. O
jogador A sobe e decola; B vê o A subindo em cima dela e pode acertá-lo de
baixo. Três flechas ⇒ explosão nas duas telas, e o passageiro morre.

---

## 17. Meteoritos e os estilhaços que matam

**Depende de:** 12, 5. **Não construa uma versão local antes.**

**Objetivo.** Rochas grandes vagando lentamente:

- movimento **lento**; dá para pular em cima com o jetpack e ficar lá;
- destrutíveis, **mínimo 3 flechas**, explodindo em vários pedaços;
- grandes o bastante para caber um jogador em cima;
- pelo menos **3 formatos**, com pequenas crateras;
- **meteoritos bem menores** voando junto, como cauda;
- **os estilhaços são letais enquanto caem**: acertar jogador ou alien em pleno
  voo mata. Depois de assentarem ficam inofensivos e **somem em alguns
  segundos**.

### 17.1 Config

Em `CONFIG.levels.moon`:

```js
/* -------------------------------------------------------- meteoritos ---- */
meteors: {
  max: 3, spawnMin: 16, spawnMax: 34,
  raioMin: 2.4, raioMax: 3.6,          // m — cabe um jogador em cima
  velMin: 1.2, velMax: 2.6,            // m/s — deriva, não queda
  alturaMin: 11, alturaMax: 26,        // m acima do chão
  giro: 0.12,                          // rad/s de tombo lento
  hp: 3,
  escoltaMin: 5, escoltaMax: 9,        // pedrinhas acompanhando
  explosionRadius: 7,
  formatos: 3,

  /* -------------------------------------------------------- estilhaços --
     Eles MATAM ENQUANTO VOAM e param de matar assim que assentam. Não é
     detalhe de física: é o que dá consequência a estourar um meteorito em cima
     da cabeça de alguém — inclusive da sua. Um pedaço parado no chão que
     continuasse matando viraria uma mina invisível, que é o oposto de
     legível. */
  fragCount: 12,
  fragRaioMin: 0.25, fragRaioMax: 0.7,
  fragSpeedMin: 5, fragSpeedMax: 13,   // m/s radiais
  fragKillSpeed: 3.5,                  // m/s — abaixo disto já não machuca
  fragKillRadius: 1.1,                 // m — raio de acerto em voo
  fragRestitution: 0.25,               // quique
  fragSettleTime: 4.0,                 // s no chão até sumir
  fragFadeTime: 1.0,                   // s de desaparecimento
},
```

### 17.2 Os estilhaços: uma conta, dois consumidores

**Este é o ponto de projeto da tarefa.** Doze pedaços por explosão, a 10 Hz,
seriam ~120 posições por segundo por explosão no fio — caro para algo que dura
cinco segundos. E simular só no servidor deixaria o visual travado; só no
cliente deixaria a morte discordando entre telas.

A saída é a que o projeto já usa para o vento: **uma função pura do tempo, com
a mesma entrada nos dois lados.**

1. Crie `src/shared/fragments.js`, puro:
   ```js
   /* ---------------------------------------------------------------------------
      Os estilhaços de um meteorito — a mesma conta nos dois lados do fio.

      O servidor precisa deles para decidir quem morre; o cliente precisa deles
      para desenhar. Trafegar doze posições a 10 Hz por explosão seria caro para
      uma coisa que dura cinco segundos — então não se trafega nada além do
      EVENTO: origem, semente e instante. Com as três, os dois lados integram a
      mesma parábola e chegam ao mesmo lugar.

      É o mesmo contrato do vento (`systems/wind.js`), e pela mesma razão.
      --------------------------------------------------------------------------- */

   /** As velocidades iniciais, sorteadas de forma determinística pela semente. */
   export function fragmentSeeds(seed, count) { /* makeRandom(seed) */ }

   /** Posição e velocidade de um estilhaço `t` segundos depois do estouro. */
   export function fragmentAt(origem, vel0, t, gravity, heightAt) { /* ... */ }
   ```
2. O servidor emite **uma vez**:
   ```js
   this.broadcastAll({
     t: S2C.SPACE_EVENT, kind: "meteorBurst",
     p: [x, y, z], seed, w: this.now(),
   });
   ```
3. O cliente desenha a partir disso; o servidor integra a mesma conta para
   decidir os acertos (jogador e alien) enquanto `|v| >= fragKillSpeed`, e emite
   `S2C.KILL` no acerto.

### 17.3 O meteorito

**Geometria — três formatos.** Parta de `IcosahedronGeometry(raio, 2)` e deforme
com `makeRandom(7000 + formato * 131)` — semente derivada do índice, para os três
serem **estáveis** entre sessões e claramente distintos. Três coisas, nesta
ordem: **alongamento por eixo** (a silhueta, que é o que se lê de longe),
**ruído** para a superfície não ser lisa, e **crateras** (vértices puxados para
dentro num raio angular em torno de pontos sorteados). Material com
`flatShading: true` — é ele que faz a rocha ler como rocha e não como bolha.

**Escolta.** 5 a 9 malhas pequenas, filhas do grupo, com órbita própria, **sem
colisor** — são visuais. Concentre-as um pouco atrás para lerem como cauda.

> **Cuidado com o tombo.** Girar o grupo inteiro faria o passageiro girar junto.
> Gire só um **grupo interno** com a malha e a escolta; o grupo externo — o que
> define a pose de plataforma — fica sem rotação.

**Convés.** `deckY = y + raio * 0.9`;
`isOnDeck` → `pisandoEmDisco(pos, x, z, deckY, raio * 0.7, 0.6)`.

**Servidor.** Rota reta atravessando a arena, `hp`, e o estouro que emite
`meteorBurst` + `explosion`.

**Critério de aceite.** Duas abas: os mesmos três meteoritos, nos mesmos
lugares, com os mesmos formatos. Pousar em cima de um funciona e o outro jogador
vê você lá. Duas flechas não destroem; a terceira sim, e os dois veem o mesmo
estouro. Ficar embaixo quando estoura mata **nas duas telas**. Pedaços parados
não matam e somem em ~5 s.

---
---

# BLOCO D — Duelo de times

## 18. Humanos × CPU

**Depende de:** 6 (bots na sala) e 13 (para valer também na Lua).

**Objetivo.** Um modo em que os jogadores humanos formam um time e os bots o
outro. Começa **equilibrado** — tantos bots quantos humanos —, e durante a
partida dá para **acrescentar mais CPUs manualmente**, engrossando o time da
máquina. Placar dizendo qual time está ganhando. Vale no vale e na Lua.

**Por que agora ficou simples.** Com o Bloco B, o servidor é dono dos dois
times. Ele sabe quem matou quem sem perguntar a ninguém — não há placar
declarado pelo cliente, não há esquadra por aba, não há limitação a documentar.
O modo vira o que ele deveria ser: uma variação de regra em cima de coisas que
já existem.

### 18.1 Fases e modo

1. `src/shared/levels.js`: acrescente `"teamDuel"` aos `modos` de **valley** e
   de **moon**.
2. `src/main.js`, `MODE_LABELS`: `teamDuel: "duelo de times",`.
3. `src/ui/hud.js`, no mapa de rótulos de `setMode`:
   `teamDuel: "DUELO DE TIMES",`.

### 18.2 Servidor

1. `Room`: `this.teamScores = { humans: 0, bots: 0 };` no construtor, zerado em
   `resetWorld()`.
2. `requestMode`: trate `"teamDuel"` como os modos cooperativos — quem aperta
   liga para a sala inteira, sem convite.
3. Em `setMode("teamDuel")`, **equilibre os times**:
   ```js
   /* Começa parelho: um bot por humano.
    *
    * Depois disso o número é livre — quem quiser aperta B e engrossa o time da
    * máquina no meio da partida. O equilíbrio inicial existe para a partida
    * COMEÇAR justa; mantê-lo à força tiraria a única alavanca de dificuldade
    * que o modo tem. */
   const humanos = this.players.size;
   while (this.bots.count > humanos) this.removeBot();
   while (this.bots.count < humanos) this.addBot();
   ```
4. **O placar sai de graça.** Em `registerKill(killer, msg)` e no caminho de
   morte causada por bot (a simulação de flecha da §6.4), acrescente:
   ```js
   if (this.mode === "teamDuel") {
     this.teamScores[vitima.isBot ? "humans" : "bots"]++;
     this.broadcastAll({ t: S2C.TEAM_SCORES, ...this.teamScores });
   }
   ```
   Repare que **não há nada a conferir**: o servidor é dono das duas pontas.
5. `snapshot(exceto)`: acrescente `teamScores: this.teamScores`.
6. Protocolo: `S2C.TEAM_SCORES: "teamScores"` (`{ humans, bots }`).

### 18.3 Cliente

1. `net.on(S2C.TEAM_SCORES, ...)` guarda e chama `this.hud.setTeamScores(...)`.
2. `applyMode`: mostra o painel quando `msg.mode === "teamDuel"`, esconde fora.
3. `src/ui/hud.js` — `setTeamScores(placar)`:
   ```js
   /**
    * Placar dos dois times, no alto da tela.
    *
    * O time à frente fica destacado — é a única informação que importa num
    * relance, e ler dois números para descobrir quem ganha é trabalho demais no
    * meio de um tiroteio.
    * @param {{humans:number, bots:number}|null} placar null esconde o painel
    */
   ```
   Construa `this.el.teamChip` em `build()` no padrão do `zombieChip`, com dois
   blocos (`HUMANOS n` / `CPU n`) e a classe `liderando` no que estiver à frente.
   Estilos em `src/style.css`, no padrão dos outros chips.
4. `src/systems/input.js`: `case "KeyG": this.actions.setMode = "teamDuel"; break;`
   — G de *grupo*; não cabe em dígito, 1–8 já são dos outros modos e 9 é da fase.
5. `src/ui/hud.js`, `ATALHOS`, grupo "Modos de jogo":
   `[["G"], "duelo de times (humanos × CPU)"],`.

**Critério de aceite.**
- Duas abas na sala, `G` numa delas: nascem **2 bots** (um por humano), o painel
  aparece zerado nas duas.
- `B` no meio da partida: o time da CPU vai a 3, e as duas abas veem o novo bot.
- Matar um bot ⇒ `HUMANOS` sobe nas duas telas. Morrer para um ⇒ `CPU` sobe.
- `N` troca a dificuldade **em tempo real, para todos** — o aviso aparece nas
  duas abas e os bots mudam de comportamento na hora (isto vem da tarefa 10; os
  bots são um só conjunto, no servidor).
- `9` no meio do duelo de times: a viagem completa e o modo continua na Lua.
- `1` (livre) tira os bots e esconde o painel.

---
---

## 19. Verificações finais

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
4. Roteiro de Lua, **também com duas abas** — é o ponto do Bloco C:
   - a lista de aliens, naves e meteoritos é a mesma nas duas
     (`window.game.environment.space` no console);
   - nave passa com zumbido que a acompanha, e é a mesma nave nas duas;
   - alien guincha de vez em quando; matar um mata nas duas;
   - derrubar nave em cima de si ⇒ morre **nas duas telas**; longe ⇒ não morre;
   - rover: pneus giram certo, sai de cratera, está no mesmo lugar nas duas, e
     o passageiro é visto em cima por quem está de fora;
   - nave de transporte pousa no mesmo ponto nas duas, decola com o jogador
     (visível para o outro), e explode com 3 flechas matando o passageiro;
   - meteoritos: mesmos formatos e lugares nas duas; pousar em cima; 3 flechas
     para estourar; estilhaços em queda matam; parados não matam e somem em ~5 s;
   - cadente e baliza acontecem no **mesmo instante** nas duas abas.
5. Roteiro do duelo de times (duas abas):
   - `G` → 2 bots, painel zerado nas duas;
   - `B` → time da CPU vai a 3 nas duas;
   - abates movem o painel nas duas;
   - `N` muda a dificuldade para todos, em tempo real.
6. `grep -rn "killedByLocalNPC\|reviveFromLocalDeath" src/` — nenhum resultado.
   Depois do Bloco C não sobrou entidade local que mate ninguém, e manter um
   segundo caminho de morte que ninguém percorre é convite a percorrê-lo por
   engano.
7. Console do navegador: **zero** erros durante os roteiros.
8. Nenhum número novo fora de `src/config.js`.
