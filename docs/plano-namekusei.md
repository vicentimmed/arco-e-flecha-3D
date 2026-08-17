# Namekusei — o modo de luta aérea

> **Referência declarada:** *Dragon Ball Z: Budokai Tenkaichi 3* (PS2, 2007).
> Voo livre em arena esférica, rajadas de ki, especiais que enchem a tela,
> cenário que se destrói e cratera onde o golpe bate. É disso que este modo tenta
> chegar perto — não de uma homenagem vaga, mas do jeito específico com que
> aquele jogo se sente na mão.

---

## 0. A regra que manda em todas as outras

**Este modo não pode encostar no jogo de arco e flecha.**

Não é um pedido de organização, é o requisito principal. O jogo atual —
vale, Lua, castelo, cerco, chuva, zumbi, as dezenas de sistemas em `src/` e os
5 700 linhas de `server/room.js` — precisa continuar funcionando **byte por
byte** como funciona hoje, com o modo novo instalado ao lado.

Daí três decisões que não estão em negociação:

1. **Namekusei NÃO é uma fase de `shared/levels.js`.** Entrar lá o poria na
   rotação de fases do arqueiro (tecla 9), no `levelForMode`, no `fallbackMode`
   e na checagem de integridade de `levels/index.js`. É um JOGO à parte que
   compartilha o servidor e a tela de entrada, não a quarta fase do arqueiro.

2. **Namekusei não usa Rapier.** O jogo do arqueiro tem um mundo de física só, e
   dividi-lo é como o `LevelManager` já avisa: colisor fantasma, ponteiro morto,
   pânico do WASM. Aqui a colisão é analítica contra o campo de altura — mais
   leve, mais rápida, mais fácil de sincronizar, e sem nenhuma superfície de
   contato com o mundo do arqueiro. Ver §4.

3. **Todo arquivo novo mora em pasta própria:** `src/namek/` (cliente),
   `src/shared/namek/` (os dois lados), `server/namek/` (sala). Os únicos
   arquivos existentes que podem ser tocados são os quatro listados no §11, e
   só com os acréscimos descritos lá.

---

## 1. O que o jogo é

Um **mata-mata aéreo** para até **15 jogadores** — humanos, bots ou mistura — no
planeta Namekusei. Cada um tem vida e ki. Quem morre reaparece depois de alguns
segundos, piscando e invulnerável. Não há fim de partida: é campo aberto, como o
`free` do vale, mas com placar de abates.

O tempo do planeta tem **dois climas**, e eles são a mesma arena com outra luz:

| Clima | O que é |
|---|---|
| `dia` | O céu verde-claro de Namekusei, **um sol**, duas luas, mar turquesa, calmaria. |
| `tempestade` | O planeta indo embora — céu vermelho, raios, tremor, fissuras de magma. É a batalha contra Freeza nos cinco minutos finais. |

### 1.1 O céu: um sol, não três

Esta linha contraria a referência de propósito, e o pedido do usuário é literal:

> *"Quando fui jogar me pareceu que tinha vários sóis. Deve ter um único sol, o
> maior e mais bem trabalhado."*

Namekusei tem três sóis no cânone, e o modo teve três — um de 7,8° de diâmetro e
dois de 1,7° e 1,4° em quadrantes opostos. O problema com aquilo não era o
cânone: é que dois discos de menos de dois graus não leem como "os três sóis de
Namekusei", leem como manchas claras no domo, e a primeira pergunta de quem vê
uma é se aquilo é um defeito de renderização.

O que ficou no lugar é **um sol de 12° de diâmetro** — maior que uma das duas
luas do céu e da ordem da outra —, com escurecimento de limbo pela lei física
(`I(μ)/I(0) = 1 − 0,72(1 − μ)`), granulação de convecção presa aos eixos do
disco, cromosfera no limbo e três camadas de dispersão. As três dispersões são
atenuadas DENTRO do disco (a coroa só se vê num eclipse), que é o que faz o
escurecimento de limbo chegar à tela em vez de ser cancelado pelo próprio brilho.

**Não custou luz nenhuma.** Os dois menores nunca foram `Light` — eram dois
produtos escalares no fragmento do domo. O modo tinha DUAS luzes dinâmicas (uma
direcional e uma hemisférica) e continua com duas; a terceira vaga do §3 continua
sendo dos poderes. Em custo de fragmento a troca SOBRA: saíram dois `acos`, dois
`smoothstep` e dois `pow` de cada pixel da tela, e o que entrou (limbo,
granulação, cromosfera) mora atrás de um `if` que só vale dentro do disco — 2,7 %
dos pixels.

A **direção não mudou** (azimute 33,7°, altura 32°), e isso é requisito: ela é
exportada como `NAMEK_SOL_DIR` e alimenta o rastro do mar, a bruma do terreno, a
folha em contraluz do mato e as FASES das duas luas (ver `NAMEK.planetas.corpos`
no config), escolhidas contra ela para uma sair 72 % iluminada e a outra 42 %.
Girar o sol apagaria esse trabalho.

Ver `src/namek/world/sky.js`, bloco `SOL`.

---

## 2. Escala do mundo

Arena **circular de 900 m de raio**, teto de voo em **520 m**, chão descendo até
o mar em −8 m. É grande de propósito: o pedido é espaço para voar, e um combate
aéreo a 60 m/s come 900 m em quinze segundos.

O tamanho **não** custa memória proporcional — ver §3 e §4. O que cresce com a
arena é a malha do terreno, e ela é resolvida por LOD radial, não por densidade
uniforme.

```
       ┌──────────────── 1800 m ────────────────┐
       │            teto de voo 520 m           │
       │   ▲                                    │
       │   │        ☁  ilhas flutuantes         │
       │   │   ▲▲▲ montanhas 60–140 m           │
       │   │  ▲▲▲▲▲▲                            │
       │   │ ~~~ mar ~~~   ⌂⌂ vila   ♣ ajisa    │
       └────────────────────────────────────────┘
```

---

## 3. Orçamento (o requisito "leve de memória")

O jogo atual roda com um orçamento apertado e o modo novo herda a régua:

| Item | Teto |
|---|---|
| Draw calls do cenário | **≤ 90** |
| Triângulos do cenário | **≤ 180 k** |
| Texturas carregadas | **0** (tudo por código, como o resto do jogo) |
| Luzes dinâmicas simultâneas | **≤ 3** |
| Alocação por quadro em regime | **0 B** (pools pré-alocados) |
| Personagens desenhados | 15 × ~30 primitivas, com LOD |

Instanciar é obrigatório para rocha, ajisa, casa e detrito:
`THREE.InstancedMesh`, uma chamada por espécie. Já existe precedente no
repositório (`entities/environment.js`, `systems/spaceLife.js`) — siga o padrão
de lá.

---

## 4. Física: por que não há Rapier aqui

Um lutador de Namekusei é uma **cápsula cinemática**. Ele não tumbla, não é
empurrado por solver, não precisa de junta nem de CCD. O que ele faz é: andar,
correr, voar, arrancar com ki, levar knockback e cair.

Tudo isso é integração explícita contra um campo de altura, e cabe em umas
duzentas linhas. Em troca ganha-se:

- **Determinismo pleno** — o mesmo passo dá o mesmo resultado em toda máquina,
  que é o que torna a interpolação de rede honesta;
- **Custo constante** — 15 lutadores + 200 projéteis não têm broad-phase;
- **Isolamento total** — nenhum corpo, colisor ou evento chega perto do mundo do
  arqueiro;
- **Memória** — o WASM do Rapier já está carregado pelo outro jogo, mas nenhum
  mundo novo é criado.

Colisão de projétil é **esfera contra cápsula** por varredura de segmento
(`distância ponto-segmento`), a mesma conta que `distanciaAoFeixe` já faz no
Kamehameha atual. Colisão com o chão é `y ≤ heightAt(x, z)`.

---

## 5. Ki, vida e o botão de carga

```
vida  0 ────────────────────── 100      morre em 0
ki    0 ────────────────────── 100      carrega segurando a tecla
```

A economia, tirada do BT3 e ajustada ao pedido:

| Ação | Custo | Regra |
|---|---|---|
| Rajada de ki (tiro básico) | **2** por bola | bloqueada abaixo de 2 |
| Arranque com ki (boost) | **14 / s** | enquanto segura |
| Voo parado / normal | 0 | voar não custa |
| **Especial (Kamehameha e cia.)** | **a barra inteira** | **só sai com o ki CHEIO** |

> **"Ele só pode soltar com o ki cheio"** vale para os ESPECIAIS. A rajada
> básica das duas mãos é o tiro comum — se ela também exigisse barra cheia, o
> jogador ficaria sem ataque nenhum durante 90 % da partida e o modo não teria
> jogabilidade. É exatamente a divisão do BT3: bola de ki custa uma lasca,
> especial custa estoque cheio.

Carregar ki (`segurar C`) trava o personagem no lugar, acende a aura, ergue o
chão em pedrinhas ao redor e enche a barra a **38/s**. É a pose mais icônica do
anime e é também o momento em que você está vulnerável — é a troca.

---

## 6. Os poderes

| Poder | Tecla | Custo | Comportamento |
|---|---|---|---|
| **Rajada de ki** | segurar botão esq. | 2 | Uma bola por mão, ALTERNANDO, a 6/s enquanto segura. Perseguição fraca (§6.1). |
| **Kamehameha** | 1 | barra cheia | Feixe azul sustentado, atravessa tudo menos o chão. **Faz CURVA, com alvo sob a mira** (§6.1). Cratera grande. |
| **Galick Gun** | 2 | barra cheia | Esfera roxa densa, arrasta uma fita de energia. Persegue forte. |
| **Destructo Disk** | 3 | barra cheia | Disco que corta cenário e não explode. Persegue forte. |
| **Genki Dama** | 4 | barra cheia | Carga longa (3,6 s parado), esfera enorme, cratera máxima. Persegue de leve. |
| **Explosão de ki** | espaço no ar | 25 | Onda esférica curta que empurra quem está perto. Defesa de pressão. |

### 6.1 A perseguição — TODOS os poderes perseguem

O pedido original era sobre as bolas: *"elas devem seguir levemente o outro
player"*. Levemente era a palavra que importava — uma bola que persegue de
verdade tira o jogo do jogador e o dá ao software.

Depois ele foi estendido a tudo: *"todos os poderes devem perseguir o player,
alguns perseguem mais, outros menos"*, com a régua de fuga junto: *"ele não é
tão ágil quanto o player voando, e o player consegue desviar se estiver voando
rápido"*.

**A regra, comum a todos.** A cada quadro, o golpe gira a direção em direção ao
alvo com quatro travas:

| Trava | O que é |
|---|---|
| `turnRate` | teto de giro por segundo |
| `arcMax` | teto da correção TOTAL na vida do golpe — o *limite da curva* |
| `duration` | prazo; depois dele, reta para sempre |
| `cone` | meio-ângulo à frente. Fora dele não há correção nenhuma |

O `cone` é o que faz o passo lateral funcionar, e o `arcMax` é o que impede um
golpe de virar bumerangue. Nem todo golpe declara `arcMax`: o Kienzan e o Galick
Gun não têm, porque contornar é o que eles fazem — no Galick Gun quem faz o papel
de teto é o `duration`, curto de propósito; no Kienzan não há teto nenhum, e é
isso que faz dele o que mais persegue.

**Quem persegue quanto.** O que o jogador sente não é o `turnRate` e sim o RAIO
da curva (`v/ω`) e a distância em que dá para escapar de lado no boost
(`v_jogador > ω·d`, com o arranque a 64 m/s):

| Poder | Giro | Teto total | Raio da curva | Corrida angular perdida a menos de |
|---|---|---|---|---|
| Genki Dama | 40°/s | 75° | 66 m | **92 m** |
| Rajada de ki | 52°/s | — (39° por prazo) | 86 m | 70 m |
| Galick Gun | 110°/s | — (176° por prazo) | 50 m | 33 m |
| Kienzan | 114°/s | — (sem teto) | 53 m | 32 m *(medido: 55 m)* |
| **Kamehameha** | **170°/s** | **70°** | **115 m** | **22 m** |

*(A perseguição do repertório inteiro DOBROU, a pedido. Eram 20 · 26 · 55 · 70 ·
85. O Kienzan é a exceção: 70 → 114 em vez de 140 — ver abaixo.)*

A última coluna é `v/ω`, e ela é um **piso**: é um critério de regime permanente
("o golpe consegue manter o nariz no alvo para sempre?"), enquanto o que decide
um acerto é passar a menos de um `hitRadius` uma vez só. Perseguição pura
desperdiça giro na curva, e medido no Kienzan a fuga real é 1,7 vez a calculada.
Use a coluna para ordenar os golpes, nunca para calibrar um contra uma distância.

O Kamehameha tem o giro mais alto e a curva mais MANSA da tabela ao mesmo
tempo, e não há contradição: ele voa a 340 m/s, três vezes mais rápido que
qualquer outro, então o mesmo giro produz um arco muito mais aberto. O que o olho
lê é o raio.

A última coluna é a conta `v > ω·d` — a distância abaixo da qual quem arranca de
lado no boost vence a velocidade angular do golpe. Ela **não** é a história
inteira para quem tem teto de correção total: perto, o jogador ganha a corrida
angular; longe, quem segura o golpe é o teto — o Kamehameha gasta os 70° dele em
0,41 s e o resto da vida é reta, e o Galick Gun para de corrigir a 152 m. O que a
curva compra não é acertar quem foge: é acertar quem se mexe **sem se
comprometer**, e punir quem fica no eixo.

**O Kienzan é a exceção, e é o único `turnRate` do modo que foi MEDIDO em vez de
derivado.** O pedido foi *"o kienzan é o que persegue mais, o player só consegue
desviar se ele estiver voando com burst lateralmente"* — a única regra do
projeto que fixa os dois lados de uma desigualdade, e a fórmula não serve para
resolvê-la (ver o parágrafo acima).

O banco roda o `perseguirPonto` e o `passoDeGiro` de verdade a 60 Hz, na ordem de
`Disco.passo`, com o alvo arrancando de través. A faixa em que ele **escapa**:

| ω | reação 0 | reação 0,15 s | reação 0,22 s |
|---|---|---|---|
| 70 | 7,0 – 95,5 m | 23 – 111,5 m | 31,5 – 120 m |
| 110 | 7,5 – 58,0 m | 23 – 73,5 m | 32 – 82,5 m |
| **114** | **7,5 – 55,5 m** | 23 – 71,5 m | 32 – 80,0 m |
| 118 | 7,5 – 53,5 m | 23 – 69,0 m | 32 – 78,0 m |
| 140 | 7,5 – 43,5 m | 23 – 59,5 m | 32 – 68,0 m |

Três coisas que a fórmula não previa:

1. **O voo normal nunca escapa** — em nenhum giro de 70 a 140, em nenhuma
   distância de 6 a 200 m. Essa metade do pedido é grátis.
2. **A fuga é um intervalo**: colado demais não há tempo de acumular
   deslocamento (a 20 m o disco voa 0,19 s). O piso é do tempo de REAÇÃO, não do
   giro — 23 m com 0,15 s, 32 m com os 0,22 s de `bot.reaction`.
3. **Reagir tarde ajuda**, porque um disco que já comprometeu a curva na posição
   velha erra mais feio.

O teto tem de cobrir a faixa de briga (22 a 55 m — `tooClose` e `idealRange`, a
faixa que `bots.js` declara em "atacar"). No caso mais severo, reflexo
instantâneo: 112 → 56,5 m ✓; **114 → 55,5 m ✓ (o último que cobre)**; 116 →
54,5 m ✗; 140 → 43,5 m ✗, doze metros abaixo da briga. Ou seja, o dobro literal
apagaria a própria frase do pedido — a 140 não há desvio nem com burst.

Ele é **o que mais persegue** por todas as vias: maior giro entre os projéteis
(o feixe só curva com trava e gasta o arco em 0,41 s), único sem teto de
correção, 114 × 4,5 s = 513° de orçamento sobre 18 s de vida, cone mais largo
(75°) e aquisição de 300 m. Os 513° não o tornam bumerangue porque quem segura é
o cone: medido sobre a vida inteira, um disco que errou gasta 65° a 91° e nunca
volta.

**O alvo** é escolhido **no disparo** e nunca reavaliado — golpe que troca de
alvo no meio do voo lê como bug. Quem está sob o CURSOR (a mira assistida —
houve uma trava manual no `R`, e ela foi removida a pedido) ganha de tudo; sem
ninguém sob o cursor vale
o mais alinhado com a mira dentro do alcance de aquisição do golpe. O id viaja
na mensagem para que o golpe persiga a mesma pessoa em todas as telas.

### 6.2 A curva do Kamehameha

*"Hoje é só algo muito reto, mas ele deve, sim, ter uma curvatura para perseguir
o player. Porém a curva nunca deve ser muito brusca — é sempre uma curva suave e
deve ter um limite."*

O feixe **era** função pura de (origem, direção, tempo): três cilindros
esticados sobre um eixo fixo. Não havia onde pendurar uma curva. Agora ele é uma
cobra, e as três peças são:

```
CABEÇA    um ponto que voa a 340 m/s e gira em direção ao alvo
CAMINHO   a polilinha por onde ela passou (um nó a cada 14 m)
CAUDA     uma distância ao longo desse caminho, que a persegue no fim
```

O corpo é o trecho entre cauda e cabeça, varrido como tubo e reamostrado a cada
quadro — os 26 anéis são gastos no pedaço VISÍVEL, e é por isso que o mesmo
número serve a um feixe de 620 m e aos últimos vinte metros dele.

Três regras que são do pedido, e não do desenho:

1. **Só com alvo designado.** *"Para fazer curva, ele só faz curva quando o
   player está travado o foco no inimigo."* Quem designa é o cursor: sem ninguém
   sob a mira no instante do disparo, o Kamehameha sai sem alvo e é o feixe reto
   de sempre. O preço da curvatura era uma tecla (o `R`, removido a pedido) e
   hoje é a pontaria — estar apontando para alguém na hora de gastar a barra.
2. **Passou, acabou.** *"Se o Kamehameha passar o player… segue o trajeto reto,
   sem tentar ficar fazendo curva mais."* Quando o alvo fica para trás do plano
   da cabeça, a perseguição é desligada **para sempre** — não é o cone
   expirando, que voltaria a valer se a vítima cruzasse na frente de novo.
3. **A cauda fecha em bico.** *"Não sai do player um bloco redondo, e sim uma
   cauda fina ao final do poder."* Os últimos 6 % do traço convergem para raio
   zero. O cilindro de antes terminava num disco aberto, e dava para ver por
   dentro do tubo quando a cauda desgrudava da mão.

**O acerto mudou junto.** O dano é medido contra o CAMINHO, segmento por
segmento — um feixe que contorna e cobra pela reta original erra nos dois
sentidos: passa por cima de quem pegou e queima quem não encostou. O chão também
deixou de ser resolvido de uma vez no disparo: com curva, o caminho não existe
antes de ser percorrido.

**No servidor**, o `arcMax` paga por si: como a posição do golpe é a integral de
versores que nunca se afastam mais de `arcMax` da direção do disparo, o feixe
inteiro cabe num cone de meia-abertura `arcMax` — e é com esse cone que o acerto
declarado é conferido, em vez da esfera de 620 m que os golpes sem teto usam.

---

## 7. Destruição e deformação

Três coisas diferentes que o jogador lê como uma só:

**a) Cratera no terreno.** O campo de altura tem uma lista de crateras
dinâmicas — exatamente a mesma ideia das crateras estáticas da Lua
(`shared/moonField.js`), mas acrescentadas em jogo. Raio e profundidade saem da
potência do golpe:

```
raio      = 3.2 + 7.6 · √potência        (m, teto 52)
fundura   = 0.62 · raio · craterDeep     (m)
```

`craterDeep` é o multiplicador SÓ da profundidade, e ele existe porque a fórmula
move raio e fundura juntos — sem ele não há como pedir um buraco estreito e
fundo. Vale 1 em quase tudo, 1,7 na rajada de ki e 3,5 no Kamehameha, e viaja na
rede no campo `df` de `NC2S.GROUND_HIT`. A escala que sai disso:

| Golpe | Boca | Fundo |
|---|---|---|
| Rajada de ki | 5,8 m | 6,1 m |
| Kienzan | 17,6 m | 10,9 m |
| Kamehameha | 9,0 m | 19,5 m |
| Galick Gun | 26,3 m | 16,3 m |
| Genki Dama | 52 m (teto) | 32,2 m |

Crateras que caem uma dentro da outra se FUNDEM e aprofundam (cada golpe novo
soma 80 % da fundura dele), e é assim que se fura a crosta até a lava: 4
Kamehamehas, 14 tiros rápidos ou 3 Genki Damas no mesmo ponto.

A malha do terreno é re-esculpida **só nos vértices dentro do raio**, num
`BufferAttribute` marcado `needsUpdate` — nunca a malha inteira.

**b) Objeto destruído.** Rocha, ajisa e casa têm vida. Ao morrer, o índice sai
do `InstancedMesh` (escala 0) e vira estilhaço no pool de detritos.

**c) Poeira e pedrinha.** Todo impacto no chão emite poeira (partícula grande,
opaca, subindo e abrindo) e pedrinha (partícula pequena, escura, balística).
A contagem escala com a potência. Queda de altura usa a mesma emissão.

**Sincronismo:** cratera é estado COMPARTILHADO. Quem atira reporta o ponto
(`ponto` + `potência`); o **servidor** carimba um id e retransmite. Todo cliente
aplica a mesma cratera com a mesma conta determinística. Um cliente que chega
depois recebe a lista inteira no `welcome`.

---

## 8. Rede

Modelo de confiança **idêntico ao que o jogo já usa** — e isso é deliberado, não
preguiça: o jogo inteiro já é construído sobre "quem atira é a autoridade sobre
o próprio acerto, a sala é a autoridade sobre a vida" (ver `C2S.IMPACT`,
`C2S.SIEGE_HIT`, `Room.registerKameBlast`). Um segundo modelo de confiança no
mesmo servidor seria a inconsistência que ninguém lembra de manter.

| Quem decide | O quê |
|---|---|
| **Cliente** | a própria pose, o próprio disparo, o próprio acerto |
| **Servidor** | vida, morte, renascimento, placar, cratera, clima, bots |

Frequências: pose a **20 Hz**, projéteis por evento (custo zero por quadro),
vida/ki a **10 Hz**, placar quando muda.

Protocolo em `src/shared/namek/protocol.js`, **numerado à parte** do protocolo do
arqueiro — as duas salas nunca trocam mensagem.

---

## 9. Bots

Precisam "saber jogar muito bem". Uma máquina de estados com cinco estados
(`procurar`, `aproximar`, `atacar`, `esquivar`, `carregar`) rodando **no
servidor**, como `server/botSim.js` já faz para os arqueiros.

O que os torna bons, em ordem de importância:

1. **Gerenciam ki.** Recuam e carregam quando abaixo de 30; guardam a barra
   cheia para quando o alvo estiver a menos de 90 m e sem cobertura.
2. **Esquivam lateralmente**, nunca para trás — desviar de bola perseguidora
   exige mudar o ângulo, e recuar não muda.
3. **Erram de propósito** conforme a dificuldade, no ângulo do disparo e não na
   decisão. Bot que decide mal parece burro; bot que mira mal parece humano.
4. **Não se agrupam**: repulsão mútua de 25 m, senão viram cardume.

---

## 10. Animação

O rig é procedural, como todo o resto do jogo (não há um único asset externo no
repositório e não vai haver agora). Uma pose por ação, e **transições
amortecidas** entre elas — o que faz parecer animação de verdade não é a
quantidade de poses, é a interpolação entre elas nunca ser instantânea.

`parado · andar · correr · voar · voar rápido · arrancada · carregar ki ·
rajada (esq/dir) · especial · levar dano · arremessado · queda · morte`

Cada uma tem entrada e saída próprias. A rede manda a pose como **um número
por canal** (o mesmo truque do `q` do Kamehameha atual — sete segundos de
animação numa fração), nunca ossos.

---

## 11. Os únicos arquivos existentes que podem ser tocados

| Arquivo | Acréscimo permitido |
|---|---|
| `src/ui/lobby.js` | uma entrada em `PORTAS` com `jogo: "namek"` |
| `src/main.js` | um `if` no `onEnter` que arranca o outro jogo |
| `server/room.js` | um `if` em `RoomHost.ensure` que cria a `NamekRoom` |
| `index.html` / `src/style.css` | nada, se der para evitar |

**Nada mais.** Nenhuma linha de `config.js`, `levels.js`, `protocol.js`,
`player.js`, `renderer.js` ou qualquer sistema do arqueiro. Se um subsistema
parecer exigir isso, ele está desenhado errado — copie o que precisa para
`src/namek/` em vez de alterar o original.

---

## 12. Critério de aceite

O modo está pronto quando, com ele instalado:

1. O jogo do arqueiro abre, joga e troca de fase **sem nenhuma diferença**;
2. `git diff` mostra os quatro arquivos do §11 e mais nada de existente;
3. 15 lutadores (bots) em campo mantêm **60 fps** em qualidade média;
4. Uma partida de 10 minutos não cresce a memória (sem vazamento de pool);
5. Duas abas veem **a mesma cratera no mesmo lugar** depois de um Kamehameha;
6. Um jogador que entra no meio vê o terreno já deformado corretamente.

---

## 13. Os dois planetas e a chuva de meteoros

Pedido literal: *"Adicione 2 planetas distintos grandes no cenário. Eles devem
ficar distantes. Devem ser planetas parecidos com luas. Kamehameha nesses
planetas os destrói (assim como o planeta Terra da fase do espaço). Porém, após
destruído, cai uma chuva de meteoros pegando fogo de tamanhos variados no
cenário, causando grandes explosões e deformidade no cenário. Esses meteoros, se
pegam no player, tira 50% da vida. Os meteoros têm som ao explodir. O raio de
explosão do meteoro também mata os players."*

**Kuraia** (cinzenta, 16,1° de diâmetro) e **Rubel** (ferrugem com mares
escuros, 11,2°), a 2.400 m do olho e a 82° uma da outra. Elas são ESFERAS de
verdade e não discos pintados no domo, e a diferença paga por si em três
lugares: o relevo as recorta (elas escrevem profundidade), o Kamehameha é testado
contra elas por interseção raio-esfera, e as fases saem da direção do sol em vez
de serem pintadas à mão. Sem textura: crateras, terminador e rachaduras são ruído
celular no fragmento. Ver `src/namek/world/planetas.js`.

**Só o Kamehameha as destrói**, como o feixe do arqueiro destrói a Terra. O
cliente declara a mira (`NC2S.PLANET_HIT`) e a sala confere contra a direção
travada no disparo; o planeta cai 3,2 s depois — o mesmo teatro de `earth.travel`
do vale, pela mesma razão.

**A chuva é da SALA** (`server/namek/planetas.js`), como todo o resto que decide
alguma coisa (§8): onde cada rocha cai, quando, de que tamanho, quem ela atropela
e quem ela mata. Cada rocha viaja numa mensagem só — uma reta e um relógio
(`NS2C.METEOR`) — e a sala integra a mesma reta que o cliente desenha.

**Os dois raios de dano são dois de propósito**, e é a distinção que o pedido faz
em duas frases: a rocha EM VOO encostando em alguém tira metade da vida
(`raioAcerto`, uma vez por vítima); a bola de fogo NO CHÃO mata quem está dentro
dela (`raioLetal`, sem guarda e sem fração). Se fossem o mesmo número, ou o
atropelamento mataria ou a explosão pouparia — e uma das duas frases deixaria de
valer.

A cratera desce pelo `NS2C.CRATER` de sempre, carimbada pelo mesmo
`NamekRoom.cratera` que atende bola de ki e Genki Dama: é o que faz o buraco do
meteoro ser o mesmo em todas as telas, entrar na lista do `welcome` e furar até a
lava. O SOM sai por ali também — `NamekAudio.estouroNoChao` escolhe a receita
pela potência, e as três classes de rocha caem em três degraus dela.
