# Plano — Fase Lua (duelo em gravidade lunar, com jetpack)

A Lua é a **fase #2** do jogo. A infraestrutura que a carrega — contrato de
fase, destruição, reconstrução e carregamento — está em
[`plano-fases.md`](plano-fases.md) e é pré-requisito deste documento.

Documento de trabalho, no formato de `plano.md` e `plano-lobo.md`: cada bloco
traz a decisão, o **porquê** e o custo. Duas regras atravessam o plano inteiro:

1. **Nada da trajetória é simulado "de mentira".** A Lua não é um filtro de cor:
   é gravidade menor, ar nenhum e um chão diferente — e todo o resto do jogo
   obedece sozinho a partir daí.
2. **O cenário tem de ser tão leve quanto o vale.** O capricho é pago em
   função de altura e cor de vértice, que custam **zero** em tempo de execução,
   não em objetos novos na cena.

---

## 1. O pedido, em uma tabela

| Pedido | Como vira código |
|---|---|
| Cenário na Lua, chão de regolito | Nova função de altura (`MoonField`), sem serra |
| Céu do espaço, com a Terra e o Sol | Ramo `space` no shader de céu (Terra procedural) |
| Modo duelo jogável ali | Cenário **ortogonal** ao modo (§2) |
| Apertou a tecla, todo mundo vai — sem convite | `9` troca o cenário da sala inteira (§2) |
| Saltos mais altos e lentos | `g = 1,62 m/s²` + `jumpSpeed` do cenário |
| Sem vento | `wind.enabled = false` + `airDensity = 0` (vácuo) |
| Tudo obedece à gravidade, inclusive a flecha | Gravidade do mundo Rapier + os 3 leitores de `CONFIG` |
| Flecha some depois de um tempo de voo | Barreira + teto de 12 s + altitude (§3.4) |
| Jetpack com segundos de voo | `systems/jetpack.js` + estado no `PlayerPhysics` |
| Duplo-pulo aciona; segurar espaço queima | Ignição por borda + `jumpHeld` |
| WASD controla o voo, com física | Empuxo por aceleração (não "andar no ar") |
| Combustível só reabastece no chão, e é visível | Medidor no HUD (§6) |
| Base lunar e um foguete escalável | `entities/moonBase.js`, plataforma no topo |
| Cenário grande, sem montanhas, leve curvatura | Domo de raio efetivo 26 km + crateras (§4) |
| Barreira invisível ao se afastar | `isWalkable` radial + aviso no HUD (§8) |

---

## 2. Decisão estrutural: **fase ≠ modo**

Hoje a sala tem um `mode` só (`free`, `duel`, `boarHunt`, …) e um terreno só
(`TerrainField`, construído uma vez, igual no cliente e no servidor).

O pedido diz "o modo duelo **poderá ser jogado** nesse cenário" — ou seja, Lua
não é o sétimo modo: é **onde** o modo acontece. Daí os dois eixos:

```
Room.level : "valley" | "moon"      ← onde   (plano-fases.md)
Room.mode  : "free" | "duel" | …    ← o quê
```

**Por que não fazer um modo `moonDuel` e acabar?** Porque duplicaria a lógica
inteira do duelo (ranking, respawn, fim de partida) num modo gêmeo, e o próximo
pedido — "quero a série de alvos na Lua" — duplicaria de novo. Com o eixo
separado, um modo novo na Lua custa uma linha numa lista.

**Restrição da primeira entrega:** `MoonLevel.modos = ["free", "duel"]`. Pedir
qualquer outro modo devolve à fase do vale automaticamente. Porcos, alces,
pássaros, zumbis e a série dependem de `arenaDistance`, de copas de árvore e da
trilha — coisas que não existem lá.

### 2.1 Sem convite

O duelo do vale é convite (`2` marca você, dois marcados começam a partida)
porque ele **arrasta** gente para uma briga no meio do cenário livre. A Lua não
tem esse problema: é uma viagem, e todo mundo vai junto.

`9` funciona como `3` (caçada) e `6` (zumbis) funcionam hoje: **quem aperta
troca para a sala inteira**. Todo mundo nasce no anel de duelo lunar e a partida
já está valendo. `1` volta ao vale.

> Mantenho o diálogo de confirmação que os outros modos de sala já usam
> (`"Ir para a Lua?"`). Não é convite — é só a proteção contra apertar `9` sem
> querer e arrancar 12 pessoas de uma partida. É uma linha; se preferir sem, sai.

---

## 3. A física da Lua

### 3.1 Gravidade

`g = 1,62 m/s²` — o valor real, não um "meio da Terra" arbitrário.

O mundo Rapier já tem `physics.gravity` com setter (`core/physics.js:48`), e é
ele que rege **flechas, alvos e todo corpo dinâmico**. A flecha obedece de
graça, sem uma linha nova de balística.

O que **não** obedece hoje, porque lê `CONFIG.physics.gravity` direto:

| Arquivo | Linha | O que quebra se não tratar |
|---|---|---|
| `systems/playerPhysics.js` | 81 | O jogador cai como na Terra |
| `game/ragdoll.js` | 239 | Corpo tomba rápido demais |
| `entities/bird.js` / `server/birdSim.js` | 203 / 126 | Só no vale, mas fica consistente |

Correção num ponto só: `CONFIG.physics.gravity` deixa de ser lido diretamente e
vira `activeGravity()`. O painel de depuração (`ui/debug.js:153`) continua
funcionando porque já escreve em `physics.gravity`.

**Partículas** (`systems/impactFx.js`, 12 valores de `gravity`) são cosméticas:
multiplicar por `g/9,81` na emissão faz a poeira do pouso subir devagar e ficar
segundos no ar. É barato e é o que mais "vende" a Lua.

### 3.2 Vácuo

```js
levels.moon.airDensity = 0   // kg/m³
levels.moon.wind.enabled = false
```

Como `entities/arrow.js:316` multiplica a força de arrasto por
`CONFIG.physics.airDensity`, zerar a densidade **desliga o arrasto pela
matemática**, não por um `if`.

**Decidido: o vácuo fica honesto.** Sem arrasto não existe torque no centro de
pressão, e é ele que alinha a flecha ao vetor velocidade. Na Lua a flecha
mantém a atitude de lançamento durante todo o arco — sobe apontada para cima e
cai apontada para cima. É o que aconteceria de verdade, e vai para o README como
característica do cenário, não como bug.

### 3.3 O salto

| | Vale | Lua |
|---|---|---|
| `jumpSpeed` | 4,2 m/s | **2,9 m/s** |
| Altura | 0,90 m | **2,60 m** |
| Tempo no ar | 0,86 s | **3,58 s** |

Manter os 4,2 m/s na Lua daria 5,4 m e 5,2 s de ar — alto demais para mirar, e o
duelo viraria uma troca de tiros entre dois pontos no céu. Com 2,9 m/s o salto é
**2,9× mais alto e 4,2× mais longo** que na Terra, que é a leitura pedida, e
ainda dá para usar o arco no ar.

Caminhada **não muda**: andar em câmera lenta frustra, e a sensação lunar já vem
do salto e do jetpack.

### 3.4 A flecha que nunca cai — e como ela some

Sem arrasto e com 1/6 de g, um tiro de tensão máxima (120 m/s) a 45° alcança
`v²/g = 8,9 km`; reto para cima, sobe **4,4 km** e leva **148 s** para voltar.
Cada flecha no ar é um corpo rígido com CCD + um traçado, e num duelo de 12
pessoas isso vira dezenas de corpos que nunca colidem com nada. É exatamente o
vazamento de memória que você apontou.

Três limites, do mais específico ao mais grosseiro:

| Limite | Valor | Pega o quê |
|---|---|---|
| **Cruzou a barreira** (+15 m de folga) | 180 m do centro | ~90 % das flechas, em ~2 s |
| **Altitude** | 300 m | O tiro reto para cima |
| **Tempo de voo** | **12 s** | Rede de segurança para o resto |

Por que 12 s não é curto: um tiro tenso atravessa a arena inteira (330 m) em
2,8 s, e o arco mais longo que ainda **cai dentro** da arena — uma parábola a
60° cobrindo os 165 m — sobe 71 m e dura 9,3 s. Ou seja, 12 s cobre com folga
todo tiro que ainda pode acertar alguém, e mata os que já não podem. No pior
caso possível (12 jogadores atirando no ritmo máximo de recarga, 2,7 s por
flecha) o teto é de ~53 flechas vivas — dentro do que a arena de porcos já
sustenta hoje.

Para comparação: no vale o limite é 25 s, e lá o arrasto derruba a flecha
sozinho em menos de 8 s.

O desaparecimento é um **fade curto** (0,25 s), não um sumiço num quadro — some
sem parecer que travou.

---

## 4. O chão da Lua — o capricho

Arquivo novo: `src/shared/moonField.js` — **puro**, como
`shared/terrainField.js` (sem Three.js, sem Rapier, sem DOM), porque o servidor
precisa das mesmas alturas para escolher onde os duelistas nascem.

A ideia que organiza esta seção: **quase todo o realismo da Lua cabe dentro da
malha e das cores de vértice que já pagamos.** Cratera não é objeto — é altura.
Raio de ejeção não é textura — é cor de vértice. Nenhum dos dois custa um draw
call, e é por isso que dá para caprichar sem pesar.

### 4.1 Crateras — a assinatura da Lua

Lista determinística (PRNG com semente fixa, como todo o resto do mundo), em
**três escalas que se sobrepõem**:

| Escala | Raio | Quantidade | Onde |
|---|---|---|---|
| Grandes | 25–45 m | ~14 | Metade externa da arena e no anel distante |
| Médias | 8–25 m | ~40 | Espalhadas |
| Pequenas | 2–8 m | ~90 | Densas no miolo, onde se anda e se luta |

```
profundidade ≈ 0,18 · raio     borda elevada ≈ 0,06 · raio
perfil = tigela (smoothstep) + anel de borda + piso levemente plano
```

Duas coisas que separam "cratera de jogo" de cratera de verdade e que custam
nada:

- **Sobreposição com idade.** As crateras são aplicadas em ordem: a mais nova
  corta a borda da mais velha. Um campo onde todas as bordas estão inteiras lê
  como bolhas; onde umas cortam as outras, lê como Lua.
- **Tamanho cresce com a distância da base.** As pequenas ficam no miolo (onde a
  malha é fina e o duelo acontece) e as grandes vão para a borda e para o
  horizonte. Isso é honesto visualmente **e** resolve o orçamento de malha
  sozinho — cratera de 3 m nunca cai numa região de célula de 6 m.

Uma grade espacial grosseira indexa as crateras por célula, então `heightAt`
testa 2–4 crateras por chamada em vez das 144.

### 4.2 Curvatura e horizonte — os números

A curvatura real é invisível numa arena: com `R = 1.737 km`, o chão cai
`d²/2R = 8 mm` em 165 m. Ela é **exagerada de propósito**, mas o exagero tem um
teto: se for forte demais, o horizonte chega antes da barreira e o cenário vira
uma colina.

Uso **raio efetivo de 26 km**, e o que ele produz:

| Do olho a… | Horizonte | Leitura |
|---|---|---|
| Em pé no chão (1,72 m) | **300 m** | O chão acaba pouco depois da barreira — mundo pequeno e curvo, como nas fotos da Apollo |
| No topo do foguete (29,7 m) | **1.243 m** | Subir **afasta o horizonte em 4×** |

Esse segundo número é o presente do plano: escalar o foguete não dá só ângulo
de tiro, **dá mundo**. E é fisicamente correto — é a mesma conta `√(2hR)` dos
dois lados.

Queda do terreno na barreira (165 m): 52 cm. Presente, mas longe de morro.

### 4.3 Nada de borda visível

No vale, a névoa e a serra escondem onde a malha termina. No vácuo **não há
névoa** — o horizonte é recortado e nítido, e é justamente isso que denuncia a
falta de ar. Sem tratamento, o jogador veria a malha acabar e o vazio começar.

A solução são duas malhas:

| Malha | Extensão | Triângulos | Colisor |
|---|---|---|---|
| **Arena** | ±350 m, grade adensada no centro (`focusWarp`, o mesmo do vale) | ~57,8 k | Trimesh até 180 m |
| **Anel distante** | 350 → 1.600 m, 128 setores × 20 anéis | ~5,1 k | Nenhum |

Com a curvatura de 26 km, o horizonte no chão fica a 300 m: a borda da arena
(350 m) **já está abaixo dele** e nunca aparece. Do topo do foguete o horizonte
vai a 1,24 km — dentro do anel distante, que carrega só crateras gigantes e
antigas e serve exatamente para isso.

### 4.4 Cor: onde mora o resto do realismo

Tudo em `surfaceColor` (cor por vértice), custo zero:

| Detalhe | Como |
|---|---|
| **Regolito** | `#6b6459` no topo, `#3b3731` nas depressões — cinza-escuro quase marrom, albedo ~0,12. Regolito **não é branco**; é o erro nº 1 de cenário lunar |
| **Bordas de cratera** | `#8a8378`, mais claras: material fresco escavado, ainda não escurecido pelo Sol |
| **Raios de ejeção** | As estrias claras que saem das crateras jovens (o efeito Tycho). São a coisa mais reconhecível da Lua vista de longe, e aqui são só um `cos(θ·n)` no ângulo em torno da cratera |
| **Mares × terras altas** | Manchas de albedo por `fbm` de baixa frequência: umas regiões mais escuras que outras, como os mares |
| **Grão fino** | A textura triplanar que **já existe** (`applyTerrainDetail`), com parâmetros cinzentos |

E a luz faz o resto: **Sol rasante a ~15° do horizonte**. Sombras longas e
quase pretas transformam cada cratera de 2 m num acidente legível. É o item de
maior retorno visual do plano inteiro e custa uma linha de direção do sol.

### 4.5 Blocos de ejeção

Matacões reaproveitando `makeBoulderGeometry`, em material cinza e
`InstancedMesh`, distribuídos **mais densos perto das bordas de cratera** — que
é onde o material escavado cai de verdade. ~220 instâncias em 2 draw calls.

---

## 5. O céu do espaço

Tudo no shader de céu que já existe (`core/renderer.js:26`), num terceiro ramo
ao lado de `dia` e `noite` — **sem mesh nova, sem risco de clipping no far
plane, zero draw calls**:

```glsl
uniform float space;      // 0 = atmosfera, 1 = vácuo
uniform vec3  earthDir;
uniform float earthPhase; // fase da Terra, derivada de sunDir
```

| Elemento | Como |
|---|---|
| **Fundo** | Preto puro no zênite → `#04060a` rente ao chão. Sem gradiente atmosférico: no vácuo o céu é preto até a linha do horizonte |
| **Sol** | Disco **duro**, sem halo. O halo do vale é espalhamento atmosférico; na Lua o Sol é um recorte branco violento. O bloom do pós-processamento dá o resto |
| **Terra** | Disco procedural de ~2°: oceano `#1b4a86`, continentes por ruído, nuvens brancas, **fase** (terminador) calculada de `sunDir` e um halo azul finíssimo de atmosfera na borda |
| **Estrelas** | O `Points` que já existe, sempre visível e **sem cintilar** — cintilação é atmosfera |
| **Névoa** | `fogDensity = 0` |

A Terra fica **parada** a ~40° do horizonte. Não é preguiça: da superfície lunar
a Terra realmente não nasce nem se põe (rotação síncrona).

**Iluminação:** sol 3,4 · hemisférica 0,06 · preenchimento 0,04. Sombras quase
pretas, correto no vácuo, e é o contraste das fotos da Apollo. Um leve "bounce"
cinza do regolito impede que o lado escuro do jogador vire silhueta ilegível no
meio de um duelo.

---

## 6. O jetpack

O item de maior risco do plano, e o que precisa de física de verdade.

### 6.1 Máquina de estados

```
 no chão ──(Space, borda)──▶ SALTO ──(Space, 2ª borda + combustível)──▶ JATO
                                              │
    ┌──── (solta Space) ───────────────────────┤
    ▼                                          ▼
  PLANANDO ──(Space de novo)──▶ JATO      (combustível = 0) ──▶ QUEDA
    │                                          │
    └────────── toca o chão ───────────────────┘  → reabastece
```

- **Ignição por borda**, não por "estar segurando": pular e continuar com o dedo
  no espaço **não** acende o jato. Tem de ser um segundo toque.
- **Segurar mantém o fogo.** Soltar apaga e **guarda o combustível** — dá para
  dosar em pulsos, que é o que torna o jetpack habilidade em vez de botão.
- **Combustível zerado** corta o empuxo no meio do voo: o jogador cai.
- **Reabastece só no chão.** Confirmado: é essa regra que impede o voo eterno.

### 6.2 Números

| Constante | Valor | Leitura |
|---|---|---|
| `fuel` | 6,0 s | Voo contínuo máximo |
| `refuelRate` | 2,0 /s | Cheio em 3 s, **de pé no chão** |
| `refuelDelay` | 0,6 s | Pousar e sair voando de novo não é grátis |
| `thrust` | 6,0 m/s² | Empuxo líquido de +4,38 m/s² contra a gravidade |
| `maxRiseSpeed` | 9,0 m/s | Teto de subida |
| `airThrust` | 7,0 m/s² | Aceleração horizontal com WASD **no jato** |
| `maxAirSpeed` | 12,0 m/s | Teto horizontal |
| `airDrag` | 0,7 1/s | Amortecimento leve: dá controle sem virar "andar no ar" |

Com esses números, subir os 28 m até a plataforma do foguete leva **~3,9 s** —
sobram 2 s para se posicionar lá em cima. Descer de lá é queda livre de 5,9 s.

### 6.3 Física, não teleporte

O `PlayerPhysics` de hoje trata o movimento horizontal como **velocidade
desejada** (`setHorizontalMove`) e o vertical como `verticalVelocity`. Certo
para andar, errado para voar: no ar, WASD tem de aplicar **aceleração** sobre a
velocidade que já existe, senão o voo tem a inércia de um cursor de mouse.

`PlayerPhysics` ganha um `this.velocity` (Vector3) usado **apenas** quando
`jetActive`, ou no ar em cenário lunar. No chão e no vale, o caminho atual
continua idêntico — nenhum risco de regressão no que já funciona.

```js
// enquanto o jato queima
v.y += (thrust + g) * h;                    // g é negativo
v.x += dirX * airThrust * h;  v.z += dirZ * airThrust * h;
v.multiplyScalar(1 - airDrag * h);
clamp(v.y, -Inf, maxRiseSpeed);  clampXZ(v, maxAirSpeed);
```

Colisão, pouso e "subir em cima de coisas" continuam sendo resolvidos pelo
`KinematicCharacterController` que já está lá — inclusive o `computedGrounded()`
de `playerPhysics.js:118`, que é o que permite pousar **no topo do foguete**.

### 6.4 Entrada

`systems/input.js` hoje só emite `actions.jump` como pulso de `keydown`. Falta o
estado contínuo:

- `input.jumpHeld` — lido de `this.keys.has("Space")`, que já é mantido;
- `actions.jump` continua sendo a **borda**, e é ela que dá a ignição.

Fora isso, só a tecla `9`.

### 6.5 O medidor de combustível

Confirmado como requisito: cada jogador vê o **seu**.

Arco fino de 90° logo abaixo do retículo, na mesma família visual da barra de
tensão do arco que já existe. Três estados que se leem sem ler número:

| Estado | Aparência |
|---|---|
| Cheio, no chão | Some (não polui a mira) |
| Queimando | Âmbar, esvaziando em tempo real |
| Abaixo de 25 % | Pulsa em vermelho — é o aviso de "procure chão" |
| Reabastecendo | Verde, enchendo |

### 6.6 O que se vê

| Peça | Onde | Custo |
|---|---|---|
| Mochila (2 cilindros + bocais) | `player.spine`, junto da aljava | ~6 meshes, uma vez |
| Chama (cone + halo aditivo) | Nos bocais, `MeshBasicMaterial`, `fog:false` | 4 meshes, só com o jato aceso |
| Pluma de partículas | `EventType.PARTICLES` (pool que já existe) | 0 draw calls novos |
| Luz do jato | **Não.** Uma `PointLight` por jogador × 12 é o que derruba o modo zumbi | — |

A poeira no pouso reaproveita `updateFootDust` (`main.js:1400`) com gravidade
lunar: a nuvem sobe devagar e demora a assentar.

### 6.7 Rede

`packState` (`shared/protocol.js:236`) ganha **um campo**: `j` = 0 ou 1 (jato
aceso). `PROTOCOL_VERSION` sobe para **11**. Nada mais trafega — `airborne` e
posição já viajam, e a chama é consequência de `j`.

---

## 7. A base lunar e o foguete

Arquivo novo: `src/entities/moonBase.js`. Nasce e morre com o cenário, como
`systems/torches.js` faz com as tochas (`build()` / `clear()`).

| Peça | Geometria | Colisor |
|---|---|---|
| **Foguete** (28 m até a plataforma, 34 m com a torre) | Cilindro + cone + 4 aletas + anéis | Cilindro no corpo + **cilindro chato no topo** |
| Torre de serviço | Treliça instanciada | Caixa |
| 3 hábitats-domo | Meia-esfera + tubos de ligação | Caixa por domo |
| Painéis solares (2 fileiras) | Placas instanciadas | Nenhum (passa por baixo) |
| Antena parabólica | Esfera cortada + tripé | Cilindro |
| Módulo de pouso + rover | Caixas + pernas + rodas | Caixa |
| Contêineres de carga | `InstancedMesh` | Caixas — cobertura útil no duelo |
| Bandeira | Pano **rígido** (não há vento) | Nenhum |
| Pegadas em volta dos módulos | Cor de vértice no terreno | Nenhum |

**A plataforma do topo é o ponto do pedido.** Ela precisa de:

1. colisor horizontal de raio ~3,5 m, para o `computedGrounded()` pousar;
2. um parapeito baixo, para não se cair sem querer ao andar mirando;
3. linha de tiro limpa para a base inteira — o foguete fica no centro do anel.

Merge por material: a base inteira sai em **~12 draw calls**.

---

## 8. A barreira invisível

O gancho já existe: `isWalkable(x, z)` é consultado a cada passo
(`playerPhysics.js:136`) e ao escolher onde alguém nasce. A `MoonField` devolve
`false` fora de um círculo:

```js
levels.moon.barrier = { centerX: 0, centerZ: -97, radius: 165 }
```

Raio de 165 m centrado no ponto mais denso da malha: arena de **330 m de
diâmetro**, três vezes o anel de duelo do vale.

**Feedback**, porque parede invisível sem aviso é bug percebido:

- **12 m antes**: brilho hexagonal fraco (aditivo, `fog:false`) acende **só no
  setor** para onde a pessoa vai, não na cúpula inteira;
- **Na barreira**: o HUD mostra `LIMITE DA BASE` e o movimento para sem tranco;
- **Flechas**: passam e somem 15 m depois (§3.4) — a barreira segura gente, não
  projétil, e uma flecha batendo no nada leria pior que uma flecha sumindo longe.

---

## 9. O duelo na Lua

Sem arrasto e com 1/6 de g, um tiro tenso de 120 m/s cai **12 cm em 46 m** — o
anel atual transformaria o arco no revólver que o comentário do
`spawnPoints.js:57` diz querer evitar. O anel cresce:

| | Vale | Lua |
|---|---|---|
| `ringRadius` | 46 m | **95 m** |
| `minSeparation` | 45 m | **90 m** |
| Queda a 120 m/s | 0,72 m | 0,46 m |
| Queda a 40 m/s | — | 4,1 m |

Duas mudanças no servidor:

- `duelPositions` (`server/spawnPoints.js:62`) lê o anel do cenário ativo e
  distribui os duelistas **em volta da base** — foguete, domos e contêineres
  viram cobertura no meio do campo, que é o que dá graça ao duelo com jetpack;
- na Lua, **participantes = todos os jogadores da sala** (não só os de
  `duelInvites`), e a partida não acaba quando `duelInvites` esvazia.

---

## 10. Rede e servidor

Quase tudo já vem pronto de [`plano-fases.md`](plano-fases.md) — `Room.level`,
o handshake de carregamento, o `get terrain()` da fase ativa. O que é específico
da Lua:

| Ponto | Mudança |
|---|---|
| `MoonLevel.campo()` | Devolve a `MoonField` — é ela que o servidor usa para nascimentos |
| `MoonLevel.modos` | `["free", "duel"]` |
| `startDuel` | Na Lua, participantes = **todos** os jogadores (§9) |
| `duelPositions` | Anel de 95 m em volta da base |

---

## 11. Orçamento — a promessa de "leve"

Linha de base medida do vale, de `plano.md`: **222 draw calls** com o vale
vazio, ~270 k triângulos.

O que a Lua **não tem**: 4.200 tufos de grama, ~200 árvores com copa e balanço,
~180 rochas gramadas, cercas, bandeirolas de vento, névoa exponencial, nuvens.
O que ela ganha: um terreno mais barato e uma base.

| Item | Draw calls | Triângulos |
|---|---|---|
| Terreno da arena | 1 | 57,8 k |
| Anel distante | 1 | 5,1 k |
| Matacões de ejeção (2 variantes) | 2 | ~9 k |
| Base lunar completa (merge por material) | ~12 | ~14 k |
| Céu + estrelas | 2 | ~1 k |
| **Cenário vazio, total** | **~18** | **~87 k** |
| *(mesmo item no vale hoje)* | *222* | *~270 k* |

Sobra tudo. O orçamento liberado é o que financia o Sol rasante com sombras
longas (que é caro em shadow map, não em draw call) e os 144 acidentes de
cratera — que, de novo, não são objetos: são a mesma malha, com outras alturas.

**A regra que garante isso:** nenhum detalhe lunar entra como objeto novo se
puder entrar como altura ou cor de vértice.

---

## 12. HUD e controles

| Item | Estado |
|---|---|
| Tecla `9` | **Nova** — "Lua" (cenário + duelo, sala inteira) |
| `Space` | Pular · **2º toque no ar = jetpack** · segurar = queima |
| Medidor de combustível | **Novo** — arco sob o retículo (§6.5) |
| Widget de vento | Vira `VÁCUO` na Lua — a ausência é informação |
| Faixa de modo | `LUA · DUELO` |
| Legenda de atalhos | Uma linha em "Modos de jogo", uma em "Mover" (`ui/hud.js:34`) |

---

## 13. Arquivos

### Novos

| Arquivo | Linhas (est.) | O que é |
|---|---|---|
| `src/levels/moonLevel.js` | ~120 | A fase: monta e desmonta tudo o que está abaixo |
| `src/shared/moonField.js` | ~260 | Altura, crateras, curvatura, barreira. Puro (cliente **e** servidor) |
| `src/entities/moonBase.js` | ~450 | Foguete, domos, painéis, rover, colisores |
| `src/systems/jetpack.js` | ~180 | Combustível, estados, chama, partículas |

### Modificados

| Arquivo | Mudança | Risco |
|---|---|---|
| `src/config.js` | Bloco `levels` com física, salto, jetpack, barreira, duelo, limites de flecha | baixo |
| `src/shared/terrainField.js` | Extrair base comum; `MoonField` herda | **médio** — é a classe que o servidor usa |
| `src/shared/protocol.js` | Versão 11, `j` no `packState` | baixo |
| `src/core/renderer.js` | Ramo `space`, Terra, Sol duro, luzes, névoa zero | médio |
| `src/systems/playerPhysics.js` | Gravidade do cenário, `velocity` no ar, jetpack | **alto** |
| `src/systems/input.js` | `jumpHeld`, tecla `9` | baixo |
| `src/entities/player.js` | Mochila + chama no `spine` | baixo |
| `src/net/remotePlayers.js` | Aplicar `j` no boneco remoto | baixo |
| `src/entities/arrow.js` | Limites por cenário + despawn na barreira, com fade | baixo |
| `src/systems/wind.js` | Vetor zero quando o cenário não tem ar | baixo |
| `src/game/ragdoll.js` | Ler a gravidade ativa | baixo |
| `src/systems/impactFx.js` | Escalar a gravidade das partículas | baixo |
| `src/ui/hud.js` | Combustível, `VÁCUO`, faixa, atalhos | baixo |
| `src/main.js` | Tecla `9` → `changeLevel("moon")` | baixo |
| `server/room.js` | Duelo com todos na Lua | médio |
| `server/spawnPoints.js` | Anel de duelo e nascimento lunares | médio |
| `README.md` | Fase, controles, tabela de física | — |

O `main.js` e o `room.js` saíram de "alto risco" porque a troca de mundo deixou
de ser problema deles: quem a resolve é o sistema de fases.

---

## 14. Fases

Cada fase termina **jogável**. Nada de "só funciona no fim".

Pré-requisito: **F0, o sistema de fases** ([`plano-fases.md`](plano-fases.md)).

| Fase | Entrega | Est. |
|---|---|---|
| **F1 — Fundação** | `levels` no config · `MoonField` com crateras e curvatura · `MoonLevel` registrada · gravidade e vácuo em todos os leitores · limites da flecha · barreira | 1 sessão longa |
| **F2 — Céu e luz** | Ramo `space`, Terra, Sol rasante, estrelas fixas, névoa zero, cores do regolito, raios de ejeção, anel distante | 1 sessão |
| **F3 — Jetpack** | Estados, empuxo, combustível, medidor no HUD, mochila, chama, partículas, campo `j`, protocolo 11 | 1 sessão longa |
| **F4 — Base** | Foguete com plataforma, domos, painéis, rover, contêineres, matacões de ejeção, colisores | 1 sessão |
| **F5 — Duelo** | Anel de 95 m, duelo sem convite, modos permitidos, aviso da barreira, preparação coordenada, README | 1 sessão curta |

Ordem escolhida de propósito: **F1 antes de F2** porque física errada com céu
bonito é pior que física certa com céu feio — e **F3 antes de F4** porque o
foguete só faz sentido se já der para subir nele.

---

## 15. Riscos, e o que fazer com eles

| Risco | Por quê | Mitigação |
|---|---|---|
| **Regressão no `PlayerPhysics`** | É o arquivo que todo modo usa | O caminho novo (`velocity` 3D) só liga no ar **e** na Lua; no vale nada muda de fluxo |
| **`TerrainField` criado uma vez em 6 sims do servidor** | `BoarHunt`, `ElkHunt`, `BirdFlock`, `ZombieNight`, `TargetSeries` guardam a referência no construtor | Na Lua só rodam `free` e `duel`, que não usam nenhum deles; o `get terrain()` da fase cobre o resto |
| **Protocolo 11 derruba abas antigas** | Comportamento desejado e já implementado | `RejectReason.VERSION` já pede recarregar |
| **Cratera pequena em malha grossa** | Célula de 6 m não resolve cratera de 3 m | Tamanho de cratera cresce com a distância do centro (§4.1) |
| **Sol rasante custa shadow map** | Sombras longas esticam o frustum | `render.shadowRange` próprio do cenário, seguindo o jogador como já faz |

---

## 16. Decisões tomadas

| # | Decisão |
|---|---|
| 1 | **Vácuo honesto.** A flecha não se realinha; em compensação some por barreira (180 m), altitude (300 m) ou **12 s de voo** — com fade de 0,25 s |
| 2 | **Sem convite.** `9` leva a sala inteira para a Lua, com o duelo já valendo. Confirmação simples, como os outros modos de sala |
| 3 | **Combustível só no chão**, 6 s de voo, cheio em 3 s de pé, com medidor próprio no HUD |
| 4 | **Capricho sem peso:** nenhum detalhe lunar entra como objeto novo se puder entrar como altura ou cor de vértice. Meta de ~18 draw calls no cenário vazio, contra 222 do vale |
| 5 | **Fases de verdade:** a fase antiga é destruída e a nova construída, com carregamento. Nada de esconder cenário ou desligar colisor — ver [`plano-fases.md`](plano-fases.md) |
