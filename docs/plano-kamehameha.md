# Plano — o Especial (Kamehameha)

> **Estado: IMPLEMENTADO, com o ajuste visual em aberto.** A carga, a pose das
> cinco fases, o arco nas costas, o feixe com afinamento, o acerto e a rede
> estão em pé. A tecla é `Q` e a barra enche com 3 acertos (valor de teste —
> ver §5).
>
> **O que o teste em tela desmentiu, e é a lição mais cara deste plano:**
>
> A geometria do §4.2 (núcleo Ø 5, casca Ø 9, halo Ø 14) foi calibrada
> comparando com as rochas, que têm Ø 8 — **e as rochas são vistas a duzentos
> metros, enquanto o feixe sai a quinze da câmera.** Na tela isso não era
> "grosso": era uma parede branca que apagava o personagem, o céu e as rochas.
> Só o núcleo, sem casca nem halo, já lavava o quadro.
>
> Três correções, todas medidas contra a tela:
>
> 1. **Afunilamento na base** (14 % do raio no punho). Sem ele a câmera de
>    terceira pessoa fica OLHANDO POR DENTRO do tubo.
> 2. **A câmera vai para o LADO** durante o golpe — que era a pergunta em aberto
>    do §12, e a resposta veio pela necessidade, não pela estética: de trás não
>    existe enquadramento que funcione. Ver `CONFIG.camera.special*`. **Segunda
>    passada:** o lado ficou sendo a câmera da CARGA, e o feixe ganhou uma câmera
>    própria que vai à frente da ponta e olha para trás — §4.4, com o interruptor
>    de volta em `CONFIG.camera.kameCam.enabled`.
> 3. **Raios e opacidades cortados**: Ø 2,2 / Ø 4 / Ø 6,4, e o núcleo deixou de
>    ser branco puro — trezentos metros de cilindro aditivo passam longe do
>    `bloomThreshold` e o passe de pós espalha o excesso pelo quadro inteiro.
>
> **O que continua em aberto:** o acabamento do brilho. Cada décimo de opacidade
> vale mais do que parece, e ajustar isso exige um laço de quadro de verdade —
> é a tarefa 8 do §10, e ela não foi fechada.
> **Escopo:** o sistema é de USO GERAL — carga, pose, feixe e rede não conhecem
> modo nenhum. Por enquanto ele fica **ligado só na Chuva de Meteoros**
> (`docs/plano-chuva-de-meteoros.md`), e ligá-lo em outro modo é uma linha de
> config.

O arqueiro enche uma barra acertando flechas. Cheia, ele planta os pés, o arco
vai para as costas, as duas mãos se juntam ao lado do quadril, uma esfera de
energia cresce entre as palmas por um segundo — e ele empurra as mãos para a
frente. Sai um feixe **grosso, branco-azulado e violento** na direção em que ele
estava mirando. Ele fica lá, segurando, por três segundos. Depois a energia
acaba: a cauda solta das mãos e vai embora atrás da ponta, afinando.

Destrói qualquer meteoro que atravesse. Mata qualquer jogador que atravesse.
Onde bate, explode.

---

## 1. A decisão que organiza tudo

**Isto não é "um golpe". É um SISTEMA DE ESPECIAL com uma implementação.**

A diferença aparece no código: `systems/special.js` não sabe o que é um meteoro.
Ele sabe três coisas — *quanto falta para carregar*, *em que fase da animação
está* e *para onde o feixe foi disparado*. Quem diz "isto encheu um ponto da
barra" é o modo, por uma linha de config:

```js
CONFIG.special = {
  kind: "kamehameha",
  modes: ["meteorRain"],        // onde está LIGADO hoje
  chargeSources: { meteor: 1 }, // o que enche a barra, e quanto
  hitsToCharge: 3,              // ← TESTE. O alvo final é 25 (ver §5)
  friendlyFire: true,
  // …tempos, geometria e cores nos blocos abaixo
};
```

Ligar na noite dos zumbis um dia é `modes: [..., "zombie"]` e
`chargeSources: { zombie: 1, boss: 3 }`. Nada mais.

E há uma decisão de arquitetura que faz o resto ficar barato: **a animação viaja
como UM número na pose, e o feixe viaja como UM evento.** Nada de sincronizar
estado quadro a quadro — §6.

---

## 2. As cinco fases

| # | fase | duração | o que acontece |
|---|---|---|---|
| 1 | **carga** | 1,00 s | terceira pessoa forçada, arco para as costas, mãos ao quadril, esfera crescendo, zunido subindo |
| 2 | **disparo** | 0,15 s | as mãos vão à frente, o corpo recua, o feixe erupciona |
| 3 | **sustentação** | 3,00 s | feixe na espessura máxima, ancorado nas mãos, pulsando |
| 4 | **dissipação** | 1,20 s | a cauda **solta das mãos** e corre atrás da ponta, afinando |
| 5 | **retorno** | 0,56 s | a pose volta, o arco desce das costas para a mão |

**Total: 5,91 s.** Os 3 s de sustentação são o pedido; o resto é o que faz as
pontas se ligarem sem corte.

**A carga caiu de 2,00 para 1,00 s e o retorno de 0,80 para 0,56 s** (−30 %),
por decisão de quem joga. O que se ganha não é só relógio: os dois segundos de
concentração eram o trecho em que nada acontecia na tela, e numa horda com prazo
o custo deles era pago em rocha perdida. O preço do golpe continua sendo a
sustentação — que é onde o golpe É o golpe.

**O jogador fica preso as cinco fases inteiras.** Corpo plantado, sem andar, e
a direção do feixe é **travada no instante do disparo** — girar o mouse depois
não entorta o feixe (a câmera continua livre para olhar em volta; só o feixe e o
corpo é que não). Isso não é limitação técnica, é o **preço**: durante esses
segundos você não atira flecha, não desvia de alien e não cobre o resto do céu.
Numa horda em que uma rocha no chão encerra a partida, escolher a hora de gastar
o especial é a decisão mais interessante do modo.

---

## 3. A animação — e por que ela não precisa de osso novo

Esta é a melhor notícia do plano. O corpo do jogo **não usa animação de
esqueleto exportada**: `entities/player.js` monta a pose inteira por
procedimento, com IK de dois ossos e vetor de polo —
`poseArm(braço, ombro, alvoDaMão, polo, esticar)`. É o mesmo solver que anima a
marcha, o tensionamento, a recarga na aljava, a estocada de faca e até o corpo
mole (`poseRagdoll`).

Ou seja: **a pose do Kamehameha é um conjunto de alvos de mão, um vetor de polo
e uma postura de tronco, ao longo de uma linha do tempo.** Zero arquivos de
animação, zero ossos novos.

O caminho já existe e tem precedente exato — o `knifeFraction`:

| o que a faca fez | o que o especial faz |
|---|---|
| `Player.setKnife(f)` | `Player.setKame(f)` |
| `packState` manda `k` | `packState` manda `q` |
| `remotePlayers` interpola `setKnife` | interpola `setKame` |
| `updateArms` desvia para `updateKnifeArm()` | `update()` desvia para `poseKamehameha()` |

A diferença de escala: a faca troca **um braço**. O especial troca **os dois
braços, o arco, o tronco e as pernas** — por isso ele entra como um desvio no
`update()`, no mesmo lugar em que `poseRagdoll` entra, e não como um ramo dentro
de `updateArms`.

### 3.1 As poses-chave

Coordenadas no espaço do tronco, via `localToRoot(x, y, z, out)`.
Referência do corpo: ombro em `y = 1,42`, `shoulderX = 0,175`, braço
`0,28 + 0,26`, `stanceYaw = 1,16 rad` (o arqueiro fica **de lado**).

> **Sobre os segundos absolutos abaixo:** eles foram escritos para a carga de
> 2 s do plano original, e a carga hoje é 1 s (§2). O código não os usa —
> `poseKamehameha` lê as durações de `CONFIG.special` e trabalha em FRAÇÃO de
> cada fase, então mexer nos tempos do config reescala a pose sozinho. Leia os
> números daqui como proporções, não como relógio.

**Carga (0 → 2,0 s)**

* **Tronco esquadra para o alvo:** `stanceYaw` desce de 1,16 para **0,35 rad**
  em 0,6 s. É a mudança mais legível de todas — o arqueiro deixa de estar de
  perfil e passa a encarar o que vai destruir.
* **Mãos em concha, ao lado do quadril direito:** alvo em
  `localToRoot(0,26 · lado, 0,10, −0,10)`, as duas palmas separadas por 0,30 m
  fechando para **0,22 m**. Polo dos cotovelos para fora e para trás
  (`_aim × −0,5 + lateral × 0,7 − Y × 0,2`), que é o que dá os cotovelos
  abertos da referência em vez de braços colados no corpo.
* **Joelhos dobrados, base larga:** `stanceWidth` de 0,23 para **0,40 m**,
  `rootLift` −0,12 m (agacha), pé da frente girado para o alvo.
* **Tronco inclina para trás** 0,15 rad e a cabeça olha o alvo.
* **Tremor crescente:** ruído de ±0,004 m nas mãos no primeiro segundo, subindo
  a ±0,018 m no último — o corpo mal segurando o que está entre as palmas.

**Disparo (2,00 → 2,15 s)**

* As mãos saem do quadril para a frente do peito, à altura do ombro:
  `ombro + _aim · 0,42 + Y · (−0,04)`, **palmas para fora**, punhos juntos.
* Braços a ~90 % de extensão (`poseArm(..., straighten: 0.02)`) — braço
  travado no cotovelo lê como boneco.
* `stanceYaw` → **0,18 rad** (encarando de frente).
* **Recuo:** o root vai 0,12 m para trás em 0,08 s e volta em 0,5 s. É o que
  vende o peso.
* Perna da frente avança 0,35 m: afundo, não posição de sentido.

**Sustentação (2,15 → 5,15 s)**

* Pose mantida, com **micro-tremor** (±0,012 m a 18 Hz) e uma deriva lenta de
  0,05 m para a frente — ele está **empurrando**.
* Ombros sobem 0,03 m e o tronco inclina 0,08 rad para a frente ao longo dos
  três segundos: o esforço aumentando.

**Dissipação e retorno (5,15 → 7,15 s)**

* As mãos relaxam para 0,55 de extensão, os ombros caem, o tronco desencurva.
* Nos últimos 0,8 s tudo interpola de volta para a pose normal, e o
  `stanceYaw` volta a 1,16.

### 3.2 O arco nas costas

O arco é um `THREE.Group` filho do root, posicionado a cada quadro por
`updateBow()` — então "guardar nas costas" é escrever outra transformação, não
reparentar nada:

```
posição  localToRoot(-0.10, 0.30, -0.16)      // ao lado da aljava, que já existe ali
rotação  ~1,15 rad em torno do eixo de mira   // atravessado nas costas, na diagonal
```

A troca é uma interpolação de 0,35 s no começo da carga e outra de 0,35 s no
retorno. A flecha encaixada some (`bow.setArrowVisible(false)`) e o
`drawFraction` é zerado à força — não dá para tensionar e carregar ao mesmo
tempo.

---

## 4. O feixe

### 4.1 Vida

A direção é **travada no disparo**. A partir daí o feixe é um segmento sobre um
raio fixo, definido por duas distâncias:

```
frente (head)  0 → 400 m a 300 m/s, ou para no terreno
cauda  (tail)  0 (mãos) durante a sustentação;
               na dissipação corre até a frente em 1,2 s, com ease-in
```

É por isso que ele "não some de uma vez": na dissipação **a cauda persegue a
ponta**, e o que sobra é um traço que se estica, afina e vai embora — que é
exatamente o que a referência faz.

**Ele não para em meteoro nem em jogador — atravessa e mata.** Só o TERRENO (e
o cenário sólido, pela lista de `shared/blockers.js`) termina o feixe. Um raio
de energia que uma pedra interrompe não é um raio de energia.

### 4.2 Geometria e look

| camada | forma | raio | material |
|---|---|---|---|
| núcleo | cilindro | **2,5 m** (Ø 5) | aditivo, branco `#ffffff`, opacidade 1 |
| casca | cilindro | **4,5 m** (Ø 9) | aditivo, ciano `#4fc3ff`, opacidade 0,55 |
| halo externo | cilindro | 7,0 m | aditivo, azul `#1b4bd8`, opacidade 0,18 |
| ponta | esfera + cone | 6,0 m | aditivo branco, pulsando |
| anéis | UV rolando na casca | — | ondas de energia correndo para a frente a 60 m/s |

O raio de cada camada é modulado ao longo do feixe por `f(u)`, com `u` indo de 0
(cauda) a 1 (ponta): na sustentação `f` é quase constante com um leve
alargamento na ponta; na dissipação `f` cai a zero na cauda e o afinamento
percorre o feixe.

Comparação de escala, para calibrar "massivo": as rochas médias da Chuva têm
Ø 8 m (`plano-chuva-de-meteoros.md` §3.2). O feixe tem Ø 9 m de casca e Ø 14 m
de halo — **ele é mais grosso que os meteoros que destrói**, e é isso que faz a
imagem funcionar.

**Raio de morte: 4,0 m do eixo** — entre o núcleo e a casca. Generoso de
propósito: passar raspando conta.

### 4.3 Onde ele bate

Explosão de energia no ponto final: esfera aditiva expandindo de 3 a 22 m em
0,45 s, anel de choque rasteiro no terreno, 140 partículas de fagulha azul, e um
clarão. Enquanto o feixe estiver vivo e apontado para o chão, a explosão
**sustenta** (pulsa) em vez de acontecer uma vez — é a ponta continuando a
descarregar ali.

### 4.4 A câmera — uma só, lateral, do começo ao fim

**O especial usa o enquadramento lateral de `CONFIG.camera.special*` da carga
até o retorno.** A câmera sai de trás do ombro, desliza para o lado durante a
carga e fica lá — sem corte, sem viagem, sem volta.

Houve uma segunda câmera, e ela está escrita e desligada. Vale registrar as duas
coisas, porque a implementação continua no repositório:

| fase | câmera | onde |
|---|---|---|
| tudo | terceira pessoa, deslizando para o **lado** | `CONFIG.camera.special*` |
| ~~feixe vivo~~ | ~~à FRENTE da ponta, olhando para trás~~ | `CONFIG.camera.kameCam` — **`enabled: false`** |

A da frente era o inverso exato da câmera da flecha: em vez do alvo chegando,
mostrava a **origem** — o arqueiro plantado, mãos à frente, com trezentos metros
de energia saindo delas. Ela se punha adiante da cabeça do feixe, um pouco de
lado, olhava para o peito de quem atirou e se afastava junto com a ponta.
Funcionava, e foi recusada por quem joga: **o corte para a frente e a volta no
impacto tiram o jogador do lugar duas vezes em menos de um segundo** — e num
modo em que o resto do céu continua caindo enquanto o especial roda, saber onde
você está vale mais que o plano bonito.

Ligar de novo é trocar um `false` por `true` no config, ou apertar a chave
**"câmera do feixe"** no painel `~`, que faz isso ao vivo. `CameraMode.KAME`,
`onKame`/`leaveKame` e `updateKameCam` continuam em `camera.js`, e o resto desta
seção descreve como eles se comportam quando ligados.

Três números não são estética, são o que faz a imagem existir:

1. **O afastamento CRESCE com a viagem** (`lead/side/up` + `×Gain · frente`).
   Com deslocamento fixo, a 400 m o arqueiro ficaria a menos de um grau do eixo
   e o feixe viraria um ponto no meio da tela em vez de um traço.
2. **O lateral mínimo (6 m) é maior que o halo (Ø 6,4 → 3,2 m de raio).** Dentro
   do halo, um cilindro aditivo é uma tela branca — a lição do §8, pelo avesso.
3. **`standoff: 30`.** MEDIDO: acompanhando a ponta até o fim, a câmera
   terminava a dez metros da explosão, com a luz de impacto (intensidade 900,
   alcance 90) encostada na lente, e o quadro lavava inteiro. Parando trinta
   metros antes, a ponta se afasta nos últimos 0,1 s e a explosão acontece onde
   dá para ver.

**Duração real:** a ponta viaja a 300 m/s, então a viagem dura
`alcance ÷ 300` — 0,37 s num feixe de 112 m, 1,33 s nos 400 m cheios. Os
`hold: 0,55 s` no impacto existem porque sem eles o corte acontece no mesmo
quadro da explosão e ninguém a vê.

**Como ela desliga.** `kameCam.enabled: false` — o estado de hoje — devolve o
especial inteiro ao enquadramento lateral, e nada mais precisa ser desfeito:
`onKame` simplesmente recusa, e nenhum outro arquivo sabe da diferença. A chave
**"câmera do feixe"** no painel `~` liga e desliga ao vivo (e, desligada no meio
de um feixe, devolve a terceira pessoa na hora), porque a escolha entre as duas
se faz olhando, não lendo.

Duas recusas deliberadas, para quem for religá-la:

* **feixe curto não vira cinema** (`minRange: 45`). Mirar no chão a vinte metros
  daria um corte de dois frames ida e volta, que lê como falha de render.
* **`returnToArcher()` não encerra esta câmera.** O clique e o W chegam lá como
  `dismissArrowCam` sempre que o tiro está bloqueado — e durante o especial ele
  está. Aceitá-los cancelaria a imagem sem devolver o movimento, que continua
  travado pela duração inteira. Quem encerra a câmera do feixe é o impacto.

### 4.4.1 O impacto: fagulha, não nuvem

`pulsarImpacto` emitia duas nuvens de partícula no ponto de acerto, e as duas
erravam pelo mesmo motivo: elas **sustentam**. A cada 0,12 s sai um sopro novo,
e nos três segundos de feixe isso são vinte e cinco sopros no mesmo lugar.

A poeira cinza (vida 2,2 s, crescimento 3,2×) virava uma cortina opaca. Medido
em tela, a fagulha azul sozinha — 26 partículas de 3 m crescendo 2,8× — fazia a
MESMA cortina, só que clara: ~260 bolas grandes vivas em regime permanente.
Nos dois casos quem atirou perdia de vista a única coisa que a ponta precisa
comunicar: **onde ela acertou**.

A poeira saiu inteira. A fagulha ficou, mas em regime de fagulha: um terço da
conta, um quinto do tamanho, quase sem crescer, meio segundo de vida — ~40
riscos pequenos em vez de ~260 bolas. Quem marca o lugar é a ponta do feixe, que
já cresce 1,9× no impacto e é a coisa mais brilhante do quadro.

### 4.5 Luzes

Duas `PointLight` no máximo, e só durante o especial: uma nas mãos na carga
(0 → 400 de intensidade, alcance 40 m) e uma no ponto de impacto (900, alcance
120 m, decaindo em 0,8 s). Fora dos 200 m da câmera, nenhuma — o emissivo e o
bloom bastam. O `plano-lua-desempenho.md` mostra que luz dinâmica é o item mais
caro que se pode acrescentar à Lua; duas, por seis segundos, num evento raro,
cabem.

---

## 5. A carga

**Quem conta é a SALA**, não o cliente. Ela já recebe todo `C2S.METEOR_HIT`
validado, então incrementar ali é de graça — e evita a barra de cada um contar
uma coisa diferente.

```
hitsToCharge: 3     // ← É ISTO QUE VAI NO CÓDIGO AGORA, para testar
                    //    O alvo de produção é 25. Trocar = trocar este número.
```

Deixar 3 no config e 25 num comentário é deliberado: um valor de teste que mora
num arquivo de teste é um valor de teste que ninguém lembra de subir. Aqui ele
está na linha que se edita, com o alvo escrito ao lado, e o §10 tem a
verificação de que ele voltou a 25 antes de a fase sair do forno.

Regras:

* **1 ponto por flecha que conecta**, inclusive as parciais no tanque — o que é
  justo: acertar o colosso quinze vezes é trabalho.
* A barra **sobrevive à morte** (foi ganha) e zera ao usar, ao reiniciar o modo
  e no game over.
* Cheia, o HUD acende: a barra pulsa em ciano e aparece `ESPECIAL PRONTO · Q`.
* A carga de cada um é **transmitida para a sala inteira** (são três números).
  Saber que o companheiro está carregado é informação de verdade num modo
  cooperativo: significa que aquela horda tem uma carta na mão.

---

## 6. Rede — o que viaja, e por que é tão pouco

Duas adições. Só duas.

**1. A animação vai na pose que já existe.** `packState` ganha um campo:

```js
q: r3(player.kameFraction),   // 0 → 1 ao longo das cinco fases
```

Um número, a 20 Hz, no pacote que já sai. Com ele, **todo mundo vê a carga, o
disparo, o tremor e o retorno** sem uma linha de rede nova — `remotePlayers.js`
interpola `setKame` do mesmo jeito que já interpola `setKnife`.

**2. O feixe vai como UM evento.**

| | conteúdo |
|---|---|
| `C2S.KAME` | `{ o:[x,y,z], d:[x,y,z], w }` — "disparei daqui, nesta direção, neste instante" |
| `S2C.KAME` | o mesmo, com `owner` |
| `S2C.KAME_CHARGE` | `{ id, charge, max }` — a barra de cada um |

A partir do evento, **cada cliente reconstrói a vida inteira do feixe** — frente,
cauda, afinamento, explosão — porque ela é função pura de `(origem, direção,
tempo desde o disparo)`. É exatamente o que o jogo já faz com a flecha: "cada
cliente recalcula a partir do evento de disparo" (`room.js`, cabeçalho). Um
Kamehameha custa ~60 bytes.

**Quem decide o que morreu:** quem atirou, como em todo o resto do jogo. O
cliente do atirador testa o segmento do feixe contra rochas, jogadores e aliens
a cada quadro enquanto ele vive, e manda pelos canais que já existem —
`C2S.METEOR_HIT` com `kame: true`, `C2S.KILL` com `cause: "kame"`,
`C2S.SPACE_HIT`. A sala recusa um `C2S.KAME` de quem não está com a barra cheia
ou já tem um feixe vivo.

**O feixe mata coisa que ENTRA nele depois.** O teste roda todo quadro, não uma
vez no disparo — então um meteoro que cai dentro do feixe durante os 3 segundos
de sustentação morre ali. Isso transforma o especial em algo mais interessante
que "apagar o que está na tela": mirar **para cima, no corredor de queda**, e
segurar, vira uma jogada de leitura.

**Versão do protocolo:** se sair junto com a Chuva de Meteoros, é a mesma subida
para **15**; se sair depois, **16**.

---

## 7. Som

Três camadas, sintetizadas no estilo que `audio.js` já usa (`makeCryBuffer`,
`makeBossLaughBuffer`):

* **carga** — zunido subindo de 90 Hz a 420 Hz em 2 s, com um segundo oscilador
  em quinta e ruído filtrado por cima; termina num "clique" grave de energia
  contida;
* **feixe** — loop grave e sujo (ruído passa-baixa modulado a 30 Hz), tocado
  posicionalmente no ponto médio do feixe, ligando com rampa de 60 ms e
  desligando com 400 ms na dissipação;
* **impacto** — a `explosion` que já existe, mais grave e mais alta, com uma
  cauda longa.

**Sobre o grito.** O jogo não vai reproduzir o áudio original da série — nem
deve: o nome "Kamehameha" e o grito são obra e marca de terceiros, e usar um
sample é exposição desnecessária num jogo que você distribui. O plano entrega o
som sintetizado acima, que faz o trabalho. Se você quiser a voz, o caminho
limpo é **gravar a sua**: um mp3 em `src/assets/audio/`, carregado como os
outros. E vale considerar um nome próprio para o golpe dentro do jogo — a
mecânica é livre, o nome não é.

---

## 8. Custo

| item | custo |
|---|---|
| feixe (3 cilindros + ponta) | **4 chamadas de desenho** por Kamehameha ativo |
| explosão de impacto | 1 chamada + partículas do pool (0 novas) |
| esfera de carga | 2 chamadas |
| luzes | 2 `PointLight`, só durante os 7 s, só perto da câmera |
| pose | **zero** — é o mesmo solver de IK que já roda por corpo |
| rede | ~60 B por disparo + 4 B por pose (o campo `q`) |

O teto realista é dois ou três feixes simultâneos numa sala de quatro: ~12
chamadas, contra as 847–1015 que seis arqueiros na Lua já custam
(`plano-lua-desempenho.md`). Irrelevante.

**O risco de imagem não é custo, é BLOOM.** Um cilindro branco aditivo de 14 m
com `bloomStrength: 0.62` estoura a tela inteira. A casca e o halo ficam
**abaixo** do `bloomThreshold` (0,78) e só o núcleo passa dele — assim o feixe
brilha sem apagar o resto do quadro. Isto precisa de uma passada de ajuste
visual com a cena rodando, e está na ordem de execução como tarefa própria.

---

## 9. Os arquivos

### Novos

| arquivo | o que é |
|---|---|
| `src/entities/kamehameha.js` | o feixe: geometria em camadas, ciclo de vida, explosão |
| `src/systems/special.js` | carga, máquina de estados das 5 fases, disparo, teste de acerto |

### Alterados

| arquivo | o quê |
|---|---|
| `src/entities/player.js` | `setKame()`, `poseKamehameha()` (§3), arco nas costas |
| `src/shared/protocol.js` | `q` no `packState`/`unpackState`, `C2S/S2C.KAME`, `S2C.KAME_CHARGE`, versão |
| `src/net/remotePlayers.js` | interpolar `q` → `setKame`, como já faz com `k` |
| `server/room.js` | contador de carga, validação e retransmissão do `C2S.KAME`, `cause: "kame"` no `KILL` |
| `src/main.js` | tecla, ciclo do especial, trava de movimento, câmera, envio dos acertos |
| `src/systems/input.js` | **`Q`** — a única letra livre com significado ("especial") |
| `src/ui/hud.js` | barra de especial, aviso `ESPECIAL PRONTO`, **e a linha em `ATALHOS`** |
| `src/systems/camera.js` | terceira pessoa forçada + recuo suave durante o especial |
| `src/systems/audio.js` | as três camadas do §7 |
| `src/config.js` | bloco `CONFIG.special` inteiro |

### A tecla

**`Q`.** Os dez dígitos estão ocupados (1–8 modos, 9 fase, 0 placar) e das
letras livres — Q, X, Z, I, J, U — só o Q tem convenção a favor. Na lista de
atalhos (`ui/hud.js` → `ATALHOS`), no grupo **Mirar e atirar**, **no mesmo
commit**:

```js
[["Q"], "especial (barra cheia)"],
```

---

## 10. A ordem de execução

| # | tarefa | entrega verificável |
|---|---|---|
| 1 | `CONFIG.special` + carga na sala + barra no HUD | acertar 3 rochas acende `ESPECIAL PRONTO` |
| 2 | Máquina de estados e `kameFraction` | o `Q` consome a carga e roda as cinco fases, sem imagem nenhuma |
| 3 | **A pose** (§3) — as cinco fases, arco nas costas | dá para reconhecer o golpe só pela silhueta, sem efeito |
| 4 | O feixe (§4.1, §4.2) | sai o raio, cresce, sustenta e afina |
| 5 | Acerto: rochas, jogadores, aliens | rocha que cai dentro do feixe morre |
| 6 | Rede: `q` na pose + `S2C.KAME` | dois navegadores veem o mesmo feixe no mesmo lugar |
| 7 | Explosão de impacto, som, luzes | o §4.3 e o §7 |
| 8 | **Ajuste visual** (bloom, cores, escala) | o feixe brilha sem apagar a tela em `low`, `medium` e `high` |
| 9 | **`hitsToCharge` volta para 25** | antes de a fase sair do forno (§5) |

Tarefas 1 e 2 são jogáveis sem uma única linha de Three.js — e é assim que se
descobre se ficar parado tanto tempo é divertido ou irritante **antes** de
gastar o trabalho de arte.

---

## 11. Como testar

* **`hitsToCharge: 3`** (§5) — três flechas e a barra enche.
* **Botão no painel `~`**: "encher especial", para não depender nem das três.
* **O teste que importa é o de RITMO**: entre na horda 7 da Chuva, guarde o
  especial e conte quantas rochas passam enquanto você está preso. Se sobreviver
  ao Kamehameha for sempre um mau negócio, ou o tempo cai ou a barra fica mais
  barata. **Sete segundos é um chute — este teste é quem decide.**
* **Dois navegadores**, um atirando no outro: a morte tem que aparecer com
  `cause: "kame"` no feed, e o feixe tem que estar no mesmo lugar nas duas telas.
* **Um terceiro navegador entrando no meio de um feixe**: ele não recebeu o
  `S2C.KAME`, então não desenha nada — e está certo. O feixe dura 4 s; o custo
  de perdê-lo é menor que o de manter estado de feixe no `snapshot`.

---

## 12. Riscos e decisões em aberto

| risco | por que é real | o que se faz |
|---|---|---|
| **Nome e voz** | "Kamehameha" e o grito são marca e obra de terceiros | mecânica é livre; som sintetizado próprio (§7), e vale um nome próprio dentro do jogo |
| **Bloom estourando a tela** | núcleo branco aditivo de 14 m com bloom em 0,62 | só o núcleo passa do `bloomThreshold`; tarefa 8 é uma passada de ajuste dedicada |
| **7 s parado numa horda com prazo** | pode ser sempre um mau negócio, e aí ninguém usa | o teste de ritmo do §11 é o juiz; os tempos são config |
| **Fogo amigo num modo cooperativo** | você pediu que mate outros jogadores, e no modo da Lua um erro coletivo encerra a partida | entra como pedido, com `friendlyFire: true` no config — virar `false` por modo é uma linha, se a brincadeira azedar |
| **Direção travada frustrar** | o jogador vai tentar "varrer" o céu com o feixe | é decisão de projeto (§2), e a alternativa — feixe que acompanha a mira — exige transmitir direção a 20 Hz e reabre o acerto para trapaça |
| **A pose ficar boneco de pau** | IK de dois ossos sem cuidado trava cotovelo e joelho | os vetores de polo do §3.1 são a parte que **não** pode ser improvisada; braço nunca a 100 % de extensão |

### O que eu te pergunto

Duas coisas em que sua referência decide melhor que o meu chute:

1. **Cor.** Fui no clássico — núcleo branco, casca ciano, halo azul. Contra o
   céu preto e o chão cinza da Lua, funciona. Se você quer outra (dourado,
   verde), é um campo de config e uma passada de ajuste.
2. ~~**Enquadramento da câmera na carga.**~~ **RESPONDIDO — ver §4.4.** A carga
   ficou com o deslizamento lateral; o feixe ganhou câmera própria, à frente da
   ponta e olhando para trás. A mira não precisou de mudança nenhuma: a direção
   já era travada no disparo, e a câmera de cinema não entra na conta da mira
   (`CameraRig.aimMode`). O que ficou em aberto é só o AJUSTE dos números do
   `kameCam` — e a chave do painel `~` existe para isso.

Se tiver imagens de referência da pose (principalmente **as mãos no quadril** e
**o afundo no disparo**), elas ajudam mais que qualquer descrição: os alvos de
mão do §3.1 são números que eu tirei da proporção do corpo do jogo, e uma
imagem os corrige em minutos.
