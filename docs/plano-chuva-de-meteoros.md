# Plano — Chuva de Meteoros (modo da Lua)

> **Estado: IMPLEMENTADO.** O modo entra pela quinta porta da tela inicial e
> por `Shift+9`. O que este documento descrevia está em pé; o que ele ERROU
> está corrigido abaixo, com o número medido ao lado do número chutado.
>
> **O que o banco de provas (`scripts/bench-meteoros.js`) desmentiu:**
>
> * As velocidades de queda iam até 17,5 m/s e produziam **52 % de vitórias**
>   com o arqueiro médio, contra os 70 % que o §11.1 exigia. O erro não estava
>   na média e sim na VARIÂNCIA: com prazo de 12 s por rocha e ciclo de tiro de
>   ~2 s, dois erros seguidos já são fatais — e dois erros seguidos acontecem o
>   tempo todo a 78 % de acerto. Corrigido para o teto de 13,5 m/s e gaps mais
>   largos no fim: **87 %**, com a derrota concentrada na horda 10.
> * O `playerScale` de 0,70 dava ao quarteto **100 % de vitórias com margens de
>   14 a 22 s** — passeio. Ele supunha que boa parte das flechas do grupo se
>   perderia em pedras já mortas; o piscar do §5.1 resolve isso melhor do que a
>   suposição, e a folga voltou para a horda. Hoje: **0,88**.
> * O jogador ruim (67 % → 60 % de acerto) perde entre as hordas 6 e 10, que é
>   exatamente a faixa que o §11.3 pedia.
>
> Números atuais medidos: solo **83,5 %**, dupla e quarteto **100 %** no modelo
> de coordenação perfeita (margens de 1,1 s e 3,8 s — é a perda de coordenação
> real que fecha a conta). O playtest continua sendo o juiz final.

Um modo de hordas na Lua. Rochas em chamas descem do preto do céu na direção da
base lunar; o arqueiro tem que estourá-las no ar. **Uma que encoste no chão mata
todo mundo e acaba a partida.** A cada três hordas desce um colosso que exige
uma dezena de flechas. Aliens continuam aparecendo, raros, para que o jogador
nunca possa dedicar os dois olhos ao céu.

Formato dos outros planos (`plano-lua.md`, `plano-fases.md`): cada bloco traz a
decisão, o **porquê** e o custo.

---

## 1. A ideia, em uma frase

Todos os outros modos do jogo perguntam **onde está o alvo**. Este pergunta
**quanto tempo falta** — e essa é a diferença que o torna um modo, e não uma
variação de tiro ao prato.

Três consequências que organizam tudo o que vem abaixo:

* **A falha é coletiva e definitiva.** No modo zumbi você morre e volta em 10 s.
  Aqui um único erro de contagem termina a partida de quatro pessoas. Isso põe
  um teto rígido na dificuldade: a taxa de tiro exigida tem que ficar
  confortavelmente ABAIXO da capacidade do jogador, nunca colada nela. Um modo
  em que o jogador bom mal sobrevive é um modo em que o jogador médio perde na
  horda 3.
* **A dificuldade é CONCORRÊNCIA, não quantidade.** É a mesma lição que o
  `hordeArrivalGaps` do modo zumbi aprendeu na marra (ver o comentário em
  `config.js`): o que aperta não é o tamanho da horda, é de quanto em quanto
  tempo entra um alvo novo com prazo próprio. Aqui o número que manda é o
  **intervalo de entrada** contra o **tempo de queda**.
* **A informação é metade do jogo.** Se o jogador não vê a rocha, não vê que
  acertou, e não vê qual delas está mais perto do chão, a derrota vira sorteio.
  O bloco 5 é tão importante quanto o bloco 4.

---

## 2. O que já existe e vai ser reaproveitado

Nada aqui começa do zero. A Lua já tem quase todas as peças:

*(O Especial — o Kamehameha — tem plano próprio:
`docs/plano-kamehameha.md`. Ele é um sistema de uso geral que, por ora, só fica
ligado neste modo. Ver §4.8 para o que ele muda no equilíbrio.)*

| peça | onde está hoje | como entra |
|---|---|---|
| rocha esculpida (icosaedro + crateras) | `systems/spaceLife.js` → `esculpir()` | mesma função, raios maiores |
| estilhaços com a MESMA conta nos dois lados | `shared/fragments.js` | idem, **sem a parte letal** |
| explosão + `rockBurst` + partículas | `spaceLife.js` → `onEvent()` | mesmo caminho |
| alien que persegue e mata | `server/spaceSim.js` | mesmo, com outro perfil de frequência |
| hordas, faixa "HORDA n", tela de vitória | `zombieSim.js`, `ui/hud.js` | mesmo desenho, outro substantivo |
| preparo coordenado de modo (tela de carregamento) | `room.js` → `prepareMode` | mesmo handshake |
| trilha `lua_de_ossos` | `systems/audio.js` | ver §7 |

O que **não** dá para reaproveitar é o meteorito atual (`spaceSim.js` → `Meteor`):
ele é uma rocha em deriva HORIZONTAL, lenta (1,2–2,6 m/s), em que dá para pousar
de jetpack, e vive a 5 Hz na rede. O da chuva cai, é rápido, tem classe de
tamanho, tem vida, queima e precisa de 10 Hz. São dois bichos diferentes com o
mesmo nome — e por isso o novo mora num módulo próprio, `server/meteorSim.js`,
do mesmo jeito que `zombieSim.js` mora separado de `boarSim.js`.

**Decisão: no modo Chuva, a deriva e as naves são DESLIGADAS.** Um meteorito
lento passeando de lado no meio de uma chuva é um falso positivo que custa o
segundo que decide a partida, e um disco voador riscando o céu é o mesmo
problema com luz própria. O rover fica (é cenário no chão, não confunde nada).

---

## 3. A mecânica

### 3.1 De onde vêm e para onde vão

* **Altitude de entrada:** 210 m acima do ponto de queda (±20 m de sorteio).
  Fica abaixo do teto de 300 m em que a flecha lunar se apaga
  (`CONFIG.levels.moon.arrow.maxAltitude`), então nenhuma flecha morre de altura
  antes de chegar no alvo — e não precisa mexer naquele número.
* **Alvo no chão:** a base lunar É o centro da arena (`base {x:0,z:−97}` e
  `barrier.center {0,−97}` são o mesmo ponto). O sorteio é:
  * 35 % dentro do miolo da base (raio 0–18 m);
  * 65 % no anel de 18 a 55 m em volta dela.
  Nunca além de 55 m — "não muito longe disso" é o pedido, e é também o que
  mantém a chuva inteira dentro do campo de visão de quem está na base.
  O tanque cai sempre no **centro exato da base**: ele é o espetáculo, e o
  espetáculo tem endereço.
* **Separação entre rochas no ar:** com os diâmetros do §3.2 (até 12 m nas
  comuns), dois pontos de queda vizinhos produzem duas silhuetas sobrepostas
  que o jogador lê como **uma**, e aí ele atira uma flecha achando que resolveu
  duas. O sorteio recusa um ponto que esteja a menos de `r₁ + r₂ + 6 m` de
  qualquer rocha ainda em voo, e tenta de novo — até seis vezes, depois aceita
  o melhor. É o mesmo padrão de tentativa-e-desistência que
  `ZombieNight.spawnAt` já usa para achar terreno pisável.
* **Trajetória:** reta, com 12° a 22° fora da vertical e azimute sorteado. A
  queda perfeitamente vertical lê como elevador; a inclinação faz a rocha
  RISCAR o campo de estrelas, que é a leitura que o modo quer, e adiciona uma
  componente horizontal de antecipação sem complicar a mira.
* **Velocidade CONSTANTE, não queda livre.** Queda livre com g = 1,62 m/s²
  gastaria 16 s dos 210 m, e os primeiros 10 s seriam quase parados: a parte
  visível seria justamente a parte em que nada acontece, e a rocha chegaria
  acelerando na hora em que a antecipação fica difícil. Velocidade constante
  torna a antecipação APRENDÍVEL — que é o que separa um modo de perícia de um
  modo de sorte. (Fisicamente também não é violência: um meteoroide chega à Lua
  com a própria velocidade orbital, não com a que a gravidade lunar lhe deu.)

### 3.2 As classes de rocha — e por que elas são GRANDES

| classe | raio | diâmetro | flechas | fogo |
|---|---|---|---|---|
| pequena | 2,5 m | 5 m | 1 | rastro fino |
| média | 4,0 m | 8 m | 2 | rastro médio + brasa nas rachaduras |
| grande | 6,0 m | 12 m | 3 | rastro largo, halo grande |
| **tanque** | 14,0 m | **28 m** | 7 a 18 (ver §4.3) | coroa de fogo, escolta de cascalho |

Estes números são o **dobro** do que a primeira versão deste plano trazia
(1,2 / 2,2 / 3,2 / 7,0 m), e a conta abaixo é o motivo. Com o FOV de 58° da
câmera (`CONFIG.camera.fov`) e 720 px de altura de tela, cada grau vale 12,4 px.
O tamanho na tela, em pixels de diâmetro:

| classe | a 200 m (entrada) | a 120 m (meio da queda) | a 60 m (última chance) |
|---|---|---|---|
| pequena | **18 px** | 30 px | 59 px |
| média | 28 px | 47 px | 95 px |
| grande | 43 px | 71 px | 142 px |
| tanque | **99 px** | 166 px | **331 px** — meia tela |

Com os raios antigos a pequena entrava com **8 px** e o tanque com 50. Oito
pixels não é um meteoro, é um artefato de compressão — e o modo inteiro depende
de o jogador VER a coisa entrando. Pior: um alvo de 8 px pune a mira com uma
precisão que o arco do jogo não foi feito para ter, e num modo em que errar
custa a partida de todo mundo isso não é dificuldade, é ruído.

O tamanho luminoso é ainda maior que o da rocha, e de propósito: o halo aditivo
tem **2,2× o diâmetro** dela e o rastro de fogo se estende de 3 a 6 raios para
trás. A pequena entrando a 200 m ocupa, de fogo, uns 40 px de largura e um risco
comprido — que é exatamente a leitura que se quer contra o preto.

E o custo disso é **zero em triângulo**: `esculpir()` devolve um icosaedro de
detalhe 2 (320 triângulos) seja qual for o raio. Só o tanque sobe para detalhe 3
(1.280 triângulos), porque a 331 px na tela o facetamento apareceria — e há no
máximo um tanque em campo por vez.

A vida é **contada em flechas, não em dano**: qualquer flecha, em qualquer
tensão, em qualquer parte da rocha, tira exatamente um. Sem cabeça, sem crítico,
sem bônus de tensão. É o oposto do zumbi, e de propósito — aqui a decisão do
jogador já é "qual das quatro" e "quando", e somar "onde" e "com quanta tensão"
transformaria cada tiro num cálculo que não cabe nos 12 s de prazo.

### 3.3 A antecipação — a conta que o jogador faz

Sem arrasto e com 1/6 de g, a flecha da Lua é quase uma reta. Números de uma
rocha a 150 m de distância inclinada:

| tensão | v₀ | voo | queda da flecha | quanto a rocha desce no voo (h10, 17,5 m/s) |
|---|---|---|---|---|
| cheia (1,7 s) | 120 m/s | 1,25 s | 1,3 m | **22 m** |
| 70 % (1,2 s) | 93 m/s | 1,61 s | 2,1 m | **28 m** |
| 40 % (0,7 s) | 66 m/s | 2,27 s | 4,2 m | **40 m** |

A leitura importa: **a queda da flecha é ruído; o deslocamento da rocha é tudo.**
O jogador não mira acima do alvo, mira ABAIXO dele — e isso é uma inversão
saborosa em relação a todos os outros modos do jogo.

E daí sai o laço de risco do modo, que não precisou de regra nenhuma para
existir: **atirar cedo e alto** custa tensão cheia e uma antecipação enorme;
**atirar tarde e baixo** custa meia tensão, voo curto e antecipação pequena —
mas se errar, não há tempo para a segunda flecha. Quem aprende a esperar
atira menos e acerta mais. Quem tem medo gasta o dobro de flechas.

### 3.4 Explosão, estilhaço e o chão

* **No ar (a última flecha entrou):** clarão, `explosion` + `rockBurst`,
  partículas de fogo e fumaça — o mesmo `onEvent` que a Lua já toca — e os
  estilhaços de `shared/fragments.js`, com a mesma semente nos dois lados.
* **OS ESTILHAÇOS DESTE MODO NÃO MATAM.** É um pedido explícito, e é a coisa
  certa: aqui a rocha estourada é uma VITÓRIA, e uma vitória que às vezes mata
  quem venceu é uma punição por jogar bem. Implementação: o servidor
  simplesmente **não integra** os estilhaços da chuva (hoje ele integra só para
  decidir quem morre, em `SpaceField.update`). Ele manda a semente e o cliente
  desenha. Custo do lado do servidor: zero — menos do que hoje.
* **O estouro escala com a rocha.** Uma pedra de 12 m que se parte em dezesseis
  cascalhos do mesmo tamanho de sempre lê como uma pedra pequena que explodiu
  perto. O número e o tamanho dos estilhaços saem do raio: **8** pedaços na
  pequena, 14 na média, 20 na grande e **36** no tanque, com o raio de cada um
  proporcional ao da rocha-mãe. A conta continua sendo a de
  `shared/fragments.js`, com a mesma semente nos dois lados — o que muda é o
  bloco de parâmetros que ela recebe.
* **Os pedaços FICAM no chão.** `fragSettleTime` sobe de 4 s para 25 s no perfil
  da chuva, e o lote instanciado guarda até 60 pedaços, reciclando o mais velho.
  Ao longo de uma partida o campo em volta da base vai ficando coberto de
  cascalho — é o placar da noite, escrito no chão, e custa **uma** chamada de
  desenho.
* **No chão (a rocha encostou):** cratera de luz, tremor de câmera forte,
  explosão em volume alto, tela branca por 0,4 s → **game over para todos**.
  Não há raio de dano nem "morreu quem estava perto": a regra é a que foi
  pedida, e ela é boa justamente por não ter exceção. Cada rocha importa.

### 3.5 Onde os jogadores nascem, e o que não existe aqui

Todo mundo entra num anel de 20 a 30 m em volta da base — perto o bastante para
ver a zona de queda inteira sem girar, longe o bastante para não nascerem em
cima uns dos outros (mesmo raciocínio de `centerForZombie`).

**Não existe coleira** — nada do `safeRadius` que o modo zumbi tem. E não é
esquecimento: lá a coleira existe porque fugir para o escuro DERROTA o modo (a
horda lenta vira alvo parado). Aqui fugir não salva ninguém: a rocha cai na base
de qualquer jeito e o game over vem igual. O único efeito de se afastar é
aumentar a distância dos próprios tiros — o modo se autolimita, e uma regra a
menos é uma regra a menos.

O `pitchMax` de 86° (`CONFIG.player.pitchMin/Max`) cobre a rocha quase a pino.
Com a zona de queda num anel de até 55 m e o jogador na base, o ângulo típico
fica entre 50° e 75°: alto, desconfortável, jogável — e é um motivo legítimo
para o jogador andar 30 m para o lado e ganhar um ângulo melhor.

### 3.6 Os primeiros 10 segundos — e quem chega depois

**A partida não começa com uma pedra caindo.** Assim que a sala entra no modo,
entra uma contagem de **10 segundos** no centro da tela até a horda 1. Só depois
dela a primeira rocha nasce.

Por que dez, e por que existe: quem acabou de sair de uma tela de carregamento
não sabe para onde está olhando, onde é a base, nem onde estão os outros. Dez
segundos é o tempo de girar a câmera uma vez, escolher um lugar no anel e
levantar a cabeça. Sem isso, a horda 1 pega o jogador de costas — e "de costas"
neste modo é a coisa que o §5.2 inteiro existe para evitar.

Durante a contagem: **nenhuma rocha, nenhum alien**, movimento livre, e a trilha
já tocando. Nos últimos três segundos entra um bipe por segundo, o mesmo do
alerta do §5.2 — é a mesma linguagem sonora usada para dizer "agora".

**Quem chega depois pega o bonde andando.** A contagem **não reinicia**, nunca,
por ninguém.

| quem entra | e quando | o que vê |
|---|---|---|
| o primeiro | dispara o modo | `HORDA 1 EM 10` e o relógio correndo |
| o segundo | 4 s depois | `HORDA 1 EM 6` — o mesmo relógio, no mesmo instante |
| um retardatário | na horda 5 | nada de contagem: nasce no anel, invulnerável por 2,5 s, com `HORDA 5` na faixa e as rochas que já estão no ar |

Isto sai de graça se o instante for transmitido do jeito certo. O que viaja
**não é "faltam 6 segundos"**, é o **instante absoluto no relógio da sala**
(`startsAt`), e cada cliente calcula o resto sozinho. É o mesmo padrão que
`invulnUntil`, `inviteExpires` e `zDownUntil` já usam no jogo inteiro, e é o que
faz um retardatário receber um `startsAt` no passado e simplesmente não desenhar
contagem nenhuma — sem um único `if` escrito para o caso dele.

O `snapshot()` de quem entra já carrega o `METEOR_STATUS` e a lista de rochas
(§6), então o retardatário chega com a horda, o número de rochas restantes e o
céu preenchido, tudo na primeira mensagem.

**O tamanho da horda é medido no começo de CADA horda**, e não no começo da
partida. Assim quem chegou na horda 5 engrossa a horda 6, e quem saiu na 7 alivia
a 8 — sem nunca mexer numa horda em curso, cujas rochas já foram agendadas com
horário marcado (§4.3). A vida do tanque é congelada no nascimento dele pelo
mesmo motivo: um colosso que ganha vida no meio da luta porque alguém entrou é
um colosso que pune o grupo por receber ajuda.

*(O modo zumbi congela o `playerCount` no `start()` — aqui a escolha é outra, e
de propósito: lá a horda dura 40 s e a partida 9; aqui a partida dura 12 minutos,
e é normal alguém entrar no meio.)*

---

## 4. O equilíbrio — os números, e de onde eles saem

### 4.1 A capacidade de fogo de um arqueiro

Do `CONFIG.bow`: tensão cheia em **1,7 s**, recarga em **0,65 s**. Um ciclo de
tiro cheio é ~2,4 s com a mira; um de 60 % de tensão é ~1,7 s. Contra uma rocha
média (Ø 8 m) a 150 m — que subtende **3,05°**, um alvo francamente grande — um
jogador médio acerta em torno de 3 de cada 4.

> **C = 0,40 acertos por segundo, por jogador.**
> (≈ 0,50 tiros/s × 78 % de acerto. Cauteloso: 0,28. Muito bom: 0,55.)

**Este número subiu de 0,35 para 0,40 quando as rochas dobraram de tamanho**
(§3.2), e não podia deixar de subir: alvo maior é alvo mais fácil, e fingir o
contrário seria entregar um modo 12 % mais fácil do que a tabela diz. Onde essa
folga foi retomada está no §4.3 — **nas hordas 7 a 10, não nas primeiras**. A
rampa inicial pode ficar mais generosa sem prejuízo nenhum; o fim, não.

Este é o único número de "jogador" em todo o plano, e é ele que todas as tabelas
abaixo dividem. Se o playtest disser que ele está errado, **muda-se um número e
o modo inteiro se reequilibra** — é para isso que ele está isolado.

### 4.2 A régua: o fator D

> **D = (flechas exigidas ÷ segundos da horda) ÷ (C × jogadores)**

D = 1,0 significa "o jogador tem que atirar no limite absoluto da capacidade,
sem nenhum erro". Como aqui um erro encerra a partida de todo mundo, a meta é
**D de 0,21 na horda 1 a 0,85 no clímax** — nunca acima. Não é conservadorismo:
é o preço do game over coletivo.

### 4.3 As dez hordas (base para 1 jogador)

Velocidade e janela de queda (dos 210 m):

| horda | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| v (m/s) | 8,0 | 8,8 | 9,6 | 10,5 | 11,4 | 12,4 | 13,5 | 14,7 | 16,0 | 17,5 |
| prazo (s) | 26,3 | 23,9 | 21,9 | 20,0 | 18,4 | 16,9 | 15,6 | 14,3 | 13,1 | 12,0 |

Composição, ritmo e o D resultante (**P** = pequena, **M** = média, **G** = grande):

| h | P | M | G | rochas | flechas | gap (s) | duração (s) | taxa (fl/s) | **D** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 3 | — | — | 3 | 3 | 7,5 | 41 | 0,073 | **0,18** |
| 2 | 4 | 1 | — | 5 | 6 | 6,8 | 51 | 0,117 | **0,29** |
| 3 | 3 | 1 | — | 4 | 5 | 6,4 | 41 | 0,122 | **0,31** |
| 4 | 5 | 2 | — | 7 | 9 | 5,9 | 55 | 0,162 | **0,41** |
| 5 | 5 | 3 | — | 8 | 11 | 5,4 | 56 | 0,196 | **0,49** |
| 6 | 5 | 2 | — | 7 | 9 | 5,1 | 48 | 0,189 | **0,47** |
| 7 | 6 | 3 | **1** | **10** | **15** | 4,7 | 58 | 0,259 | **0,65** |
| 8 | 6 | 2 | **2** | **10** | **16** | 4,5 | 55 | 0,292 | **0,73** |
| 9 | 5 | **3** | — | **8** | **11** | 4,1 | 42 | 0,263 | **0,66** |
| 10 | 6 | 2 | **2** | **10** | **16** | 4,2 | 50 | 0,321 | **0,80** |

*(duração = (rochas − 1) × gap + prazo de queda)*

As linhas em negrito são o ajuste do §4.1: as hordas 7 a 10 ganharam uma rocha
grande (ou uma média, na 9) para retomar a folga que o alvo maior deu. As seis
primeiras ficaram como estavam e desceram de D — é a rampa, e é o lugar certo
para o modo ser generoso. O pico segue em **0,80 na horda 10**, como antes.

Concorrência (rochas no ar ao mesmo tempo, ≈ prazo ÷ gap) fica entre **2,9 e
3,5** em todas as hordas, no jogo solo. Não é acidente: é ela, e não a
quantidade total, que define o quanto o céu pesa (§1).

**O tanque, nas hordas 3, 6, 9 e 10.** Ele entra num **segundo ato**: 4 s depois
de a última rocha comum da horda morrer, o céu fica vazio e ele desce sozinho.

Por que sozinho, se o pedido não dizia isso: dois prazos simultâneos, um deles
pedindo doze acertos, é a diferença entre difícil e arbitrário — o jogador perde
sem saber qual das duas coisas ele deveria ter feito. E o silêncio antes da
descida é o melhor anúncio que o modo pode dar de graça.

| horda | vida (1 jog.) | velocidade | janela | taxa (fl/s) | **D** |
|---|---|---|---|---|---|
| 3 | 7 | 5,2 m/s | 40 s | 0,175 | **0,44** |
| 6 | 11 | 4,0 m/s | 52 s | 0,212 | **0,53** |
| 9 | 16 | 3,4 m/s | 62 s | 0,258 | **0,65** |
| 10 | 18 | 3,0 m/s | 70 s | 0,257 + pingado | **0,81** |

(A vida subiu uma ou duas flechas em cada um pelo mesmo motivo do §4.1 — e ainda
por cima o colosso agora tem 28 m de diâmetro: errá-lo passou a ser difícil.)

Na horda 10 — e só nela — a chuva **não para** durante o tanque: uma rocha
pequena a cada 15 s. É o clímax do modo: 70 s de fogo contínuo em algo que não
morre, com a chuva pingando por cima. D = 0,85, o pico da partida inteira.

**Partida completa:** ~77 rochas, ~110 acertos, **11 a 12 minutos**. Mesma ordem
de grandeza da noite dos zumbis, que é a referência que os jogadores já têm.

### 4.4 Escala por número de jogadores — e por que os dois fatores são diferentes

```
rochas  = ceil( base × (1 + 0,70 × (min(N,6) − 1)) )
gap     = base ÷ (1 + 0,70 × (min(N,6) − 1))
tanque  = round( base × (1 + 1,00 × (N − 1)) )     // linear, sem teto
```

* **A chuva escala a 0,70, não a 1,0.** Duas pessoas mirando na mesma pedra
  pequena desperdiçam uma flecha — e o céu é compartilhado, então a coordenação
  falha justamente quando o céu está cheio. Os 0,30 que faltam são a margem
  dessa perda. (O piscar do §5.1 é o que a reduz; se o playtest mostrar que a
  coordenação funciona melhor que isso, o fator sobe.)
* **O tanque escala a 1,0.** Nele nenhuma flecha é desperdiçada: são todas
  necessárias, venham de quem vierem. Não há perda de coordenação para
  compensar. É a mesma lógica do `arrowsToKillPerPlayer` do chefão zumbi.
* **`min(N,6)` na chuva.** Acima de seis arqueiros o gap fica abaixo de 1 s e o
  céu vira uma parede — deixa de ser um modo de perícia e vira um modo de sorte.

Aferição rápida, horda 10 com 4 jogadores: 10 × 3,1 = **31 rochas**, gap 1,35 s,
~9 no ar ao mesmo tempo (o teto de 16 do §4.5 não morde). É uma chuva de
meteoros de verdade na tela — e com os diâmetros do §3.2, uma que enche o céu.
Tanque final: **72 flechas em 70 s**.

### 4.5 Tetos de segurança

`maxAlive: 16` rochas vivas e `maxEntities: 24` (vivas + estourando). Ao bater no
teto, o relógio do próximo nascimento **fica preso em zero em vez de acumular
dívida negativa** — exatamente o truque que `ZombieNight.tickPendingSpawns`
usa, e pelo mesmo motivo: acumulando, a fila represada nasceria inteira no
quadro em que a primeira vaga abrisse.

O teto desceu de 22 para 16 junto com o aumento das rochas (§3.2): dezesseis
silhuetas de 5 a 12 m ocupam mais céu do que vinte e duas de 2,4 a 6,4 m, e o
limite que importa é **quanto do céu dá para ler**, não quantos objetos cabem
na memória.

### 4.6 Os aliens

Secundários, e o config diz isso sozinho:

| | Lua livre (hoje) | Chuva de Meteoros |
|---|---|---|
| vivos ao mesmo tempo | 3 | **2** |
| intervalo de nascimento | 26–52 s | **55–95 s** |
| primeiro nascimento | 12 s | **só a partir da horda 3** |

Morrer para um alien **não** encerra a partida: é a morte normal da Lua, com o
renascimento de sempre (`agendarRenascimento`). E é aí que está o acoplamento
bonito do modo — o alien não te mata, ele te tira **5 segundos de céu**, e cinco
segundos na horda 9 são duas rochas que ninguém estourou. A punição do alien é
medida na moeda do modo, sem uma linha de regra para isso.

Ele continua morrendo com uma flecha, pelo `C2S.SPACE_HIT` que já existe. E essa
flecha é uma que não foi para o céu: a decisão "atiro nele ou ignoro" é do
jogador, e é uma boa decisão.

### 4.7 Os bots — artilharia antiaérea, e só isso

> **A regra, e ela não tem exceção: neste modo o bot atira EXCLUSIVAMENTE em
> meteoro. Ele não mira em jogador, não mata jogador, e a flecha dele não pode
> matar jogador nem por acidente. Ele está ali para ajudar.**

O bot do jogo nasceu adversário de duelo: `Bot.escolherAlvo` procura o
personagem vivo mais próximo, e `matarPeloBot` declara a morte direto na sala.
Trazer isso para cá seria trazer outro jogo — a Chuva é cooperativa, e uma
partida em que a CPU mata um dos quatro defensores no meio da horda 9 termina em
game over por um motivo que ninguém pediu.

**Três camadas, e a segunda é a que realmente garante.** A primeira é intenção;
a segunda é impossibilidade. Uma flecha mirada num meteoro a 200 m de altura
cruza muito espaço, e na Lua tem gente voando de jetpack dentro desse espaço.

| camada | onde | o quê |
|---|---|---|
| 1 — **mira** | `botSim.js` | um sinalizador `soPresas` (irmão do `semFogoAmigo` que o duelo de times já usa). Ligado, `escolherAlvo` devolve `null` e `escolherAlvoDeTiro` considera **só** a lista de presas. Sem alvo humano nem para mirar nem para se mover. |
| 2 — **flecha** | `room.js` → `dispararDoBot` | `simularFlechaDoBot` é chamado com `personagens: []`. A flecha do bot **atravessa** qualquer arqueiro. Uma linha, e nenhum caminho de código consegue produzir um acerto em gente. |
| 3 — **morte** | `room.js` | como `r.kind` nunca mais pode ser `"character"`, `matarPeloBot` fica inalcançável neste modo. Não é um `if` a mais: é um ramo que deixa de existir. |

O contrário continua valendo e é bom que continue: **o alien pode matar o bot**
(`playerPositions` já inclui os bots, e o alien vai atrás do mais próximo). O
bot cai, renasce pelo caminho normal, e nesses segundos o alien esteve ocupado
com ele em vez de com você. É ajuda, e não custou nenhuma regra.

**O que falta para ele conseguir acertar uma pedra no céu**

1. **A rocha entra na lista de presas.** `Room.botPrey()` passa a devolver, no
   modo, `{ kind: "meteor", id, x, y, z, r, aimY: 0 }`.
2. **Raio de verdade.** `botArrow.js` testa bicho contra um `RAIO_BICHO = 0.8`
   fixo, e ainda soma 0,8 ao `y` (porque a posição de um porco é a pata, não o
   centro). A rocha tem raio de 2,5 a 14,0 m (§3.2) e a posição dela **é** o centro:
   `const raio = b.r ?? RAIO_BICHO`, e o deslocamento em `y` só se aplica quando
   `b.r` não veio.
3. **Mirar no meio.** `mirarComLead` soma 0,55 m à altura de um bicho. Para a
   rocha o valor certo é zero — `c.aimY ?? (isCreature ? 0.55 : 1.15)`.
4. **Sem penalidade de distração.** O `creaturePenalty` de 1,8 existe para o bot
   não largar o duelo por causa de um javali. Aqui a distração **é** o trabalho:
   penalidade 1,0.

**O tiro quase a pino — o risco técnico real deste bloco**

`Bot.elevacaoPara` itera sobre a distância HORIZONTAL: `t = distH / (v·cos ang)`.
Com a rocha em cima da cabeça, `distH → 0`, logo `t → 0`, logo a queda estimada
some e a função devolve ~90° — que o `pitchMax` de 86° corta. O erro em 200 m
passa de dez metros. **O bot não erra por perícia; ele erra por álgebra.**

* **Correção obrigatória (barata, sem risco):** filtro de alvo. O bot só engaja
  rocha com `distH ≥ 0,40 × Δy` (elevação ≤ 68°). Fora disso ele guarda o tiro,
  como já faz quando `temVisada` reprova.
* **Correção opcional:** iterar o tempo de voo sobre a distância INCLINADA em
  vez da projeção horizontal. Resolve o caso geral, mas mexe em código que o
  duelo usa — fica para depois de o modo estar de pé, e com o
  `debug.selfTest` como rede.

**Onde eles ficam.** Distribuídos no anel de 35 a 45 m do centro da base, parados.
Um bot que persegue não existe aqui (camada 1 já tirou o alvo de movimento), e
parado é justamente a postura certa de um arqueiro antiaéreo — além de ser o que
mantém a maioria das rochas dentro da janela de 68° do parágrafo acima.

**Eles não desperdiçam flecha entre si.** `simularFlechaDoBot` resolve o voo
inteiro no instante do disparo e já devolve qual rocha vai ser atingida: a sala,
portanto, sabe com exatidão quantas flechas de bot estão a caminho de cada
pedra. Um bot não escolhe rocha cuja vida restante já esteja coberta por flechas
em voo de outros bots. Isso **não** se estende às flechas humanas, e não por
preguiça: a sala não sabe para onde vai a flecha de um humano até o
`C2S.IMPACT` chegar — quem coordena os humanos é o piscar do §5.1.

**E o acerto do bot tem que ESPERAR a flecha chegar.** Hoje `dispararDoBot`
aplica o abate no mesmo quadro do disparo. Para um javali a 40 m isso são 0,4 s e
ninguém nota; para uma rocha a 200 m são **1,7 s**, e a pedra estouraria bem
antes de a flecha tocá-la — na tela de todo mundo. `simularFlechaDoBot` já
devolve `tempo`: o abate é agendado para `r.tempo`, reconferindo se a rocha
ainda existe (um humano pode tê-la estourado no meio do caminho).

**Quanto um bot vale no equilíbrio.** Ele é um atirador, então entra na conta
do §4.4:

```
N_efetivo = humanos + 0,70 × bots        // na perícia "medium"
```

Os 0,70 são um ponto de partida — o bot tensiona por tabela de distância, tem
giro de 2,6 rad/s e perde tiros no filtro de elevação. **O banco de provas do
§11.1 mede o número real** em vez de discuti-lo: basta rodar a mesma partida com
1 humano + 2 bots e comparar a margem com a de 3 humanos.

**Duas coisas que NÃO mudam:** o bot continua sem pontuar (`abaterBichoPeloBot`
já não pontua — creditar a rocha a um humano ao acaso seria mentir no placar), e
ele continua entrando só quando alguém aperta `B`. Nada de esquadra automática
como no duelo de times: quem quer ajuda pede. E como a troca de fase dispensa os
bots (`commitPreparedMode`), quem chega à Lua chega sozinho e monta a bateria
antiaérea ali.

---

### 4.8 O Especial — e o que ele faz com este equilíbrio

O Kamehameha tem plano próprio (**`docs/plano-kamehameha.md`**), porque é um
sistema de uso geral que só está LIGADO aqui. O que importa para as contas deste
documento é o seguinte:

* **Ele apaga rochas de graça, mas custa 7 segundos parado.** Durante a carga,
  o disparo e a dissipação o jogador não atira flecha nenhuma — ou seja, o
  especial **subtrai ~3 flechas** da capacidade `C` do §4.1 no momento em que é
  usado. Numa horda com D = 0,80 isso é caro, e é essa tensão que o torna uma
  decisão em vez de um botão de "vencer".
* **A conta líquida decide se ele está calibrado.** Uma barra a cada 25 acertos
  (§5 do plano dele) dá ~4 usos numa partida completa de ~110 acertos. Se cada
  uso limpa 2 ou 3 rochas e custa 3 flechas, ele é **neutro em taxa** e vale
  pelo posicionamento — que é exatamente onde ele deve ficar. Se limpar seis, a
  barra fica mais cara.
* **Nada nas tabelas do §4.3 conta com ele.** Elas são o modo sem especial, de
  propósito: um jogador que nunca apertar `Q` ainda tem que conseguir vencer.
* **O banco de provas do §11.1 ganha uma variável a mais** — o arqueiro
  simulado passa a poder gastar um especial a cada N acertos, e a saída
  compara as duas partidas.

---

## 5. O retorno na tela — o bloco que decide se o modo é justo

### 5.1 "Acertei" (o pedido explícito), em quatro camadas

1. **A rocha PISCA.** 0,18 s: o emissivo vai a branco puro e o halo dobra de
   tamanho. Vale para todas as telas — quem atirou vê no mesmo quadro (local,
   como o `spawnBossFlash` faz hoje); os outros recebem `S2C.METEOR_HIT`. Em
   co-op esta é a mensagem mais importante do modo inteiro: *aquela ali já tem
   dono.*
2. **A rocha MUDA.** Cada acerto abre uma rachadura de brasa permanente e
   arranca um pedaço da silhueta. Uma média com 1 acerto é visivelmente
   diferente de uma média inteira. **Isso substitui uma barra de vida** — a
   informação fica no objeto, à distância em que ele é visto, sem HUD nenhum.
3. **A rocha SOA.** `rockBurst` curto no ponto do impacto, com o tom subindo a
   cada acerto: o último soa mais agudo que o primeiro. Quem está de costas
   sabe que o amigo acertou, e sabe se falta pouco.
4. **A tela CONTA.** Marcador de acerto (o `hud.impact()` que já existe) e o
   número de flechas restantes flutuando no ponto do acerto — `2`, `1`, e na
   última o estouro fala por si.

### 5.2 "Uma está chegando" — o alerta

Sem isto o modo é injusto, porque a rocha que mata é sempre a que estava fora da
tela.

* **A MANCHA NO CHÃO** — a peça mais importante deste bloco. Um disco aditivo
  desenhado sobre o terreno no ponto exato de queda, com raio 1,6× o da rocha,
  que **acende conforme ela desce**: fraco e alaranjado aos 200 m, branco e
  pulsando abaixo de 40 m. Ele resolve duas coisas de uma vez — é o que faz o
  impacto ser JUSTO (ninguém morre sem ter tido onde ler o aviso) e é metade do
  espetáculo, porque um círculo de 22 m de luz crescendo no chão da base diz
  "vem coisa grande" melhor do que qualquer HUD. Custo: uma chamada de desenho
  por rocha, nenhuma luz dinâmica, nenhum mapa de sombra.
* **Seta de borda** apontando para a rocha mais próxima do chão que não está no
  campo de visão. Uma só, a mais urgente — três setas ao mesmo tempo é ruído.
* **Pulso vermelho na borda**, do lado de onde ela vem, quando qualquer rocha
  cruza **60 m** de altitude. Abaixo de **25 m**, o pulso vira contínuo e entra
  um bipe crescente.
* **Chip de estado** no canto (o mesmo elemento do chip do modo zumbi):
  `CHUVA 4 / 10 · rochas 6 · próxima em 3 s`.
* **Faixa de horda**, a mesma do zumbi: `CHUVA 4` / `6 rochas`, e `COLOSSO` /
  `o segundo ato` no tanque.

### 5.3 O fim

* **Derrota:** clarão branco, tremor, e o card central `GAME OVER` / `uma rocha
  encostou na horda 7`.
* **Vitória (dez hordas):** a mesma tela de vitória da caçada e do zumbi
  (`hud.showHuntVictory`), com o ranking por **rochas destruídas**, e as colunas
  de **flechas gastas** e **precisão** ao lado. Numa partida cooperativa em que
  a métrica é economia de flecha, a precisão é o placar honesto.

---

## 6. Como isso vive na rede

O modo é **da sala**, como todos os outros — nada de mundo por aba. A regra que
o `spaceSim.js` já registra vale inteira aqui: *vai para o servidor o que muda a
partida para outra pessoa*, e uma rocha que encosta no chão muda a partida de
todo mundo ao mesmo tempo.

**`PROTOCOL_VERSION` sobe de 14 para 15.** Uma aba antiga veria a sala anunciar
um modo que ela não sabe desenhar: céu vazio, ninguém entendendo por que a
partida acabou. Melhor recusar e pedir recarga.

### Mensagens novas

**Cliente → servidor**

| | conteúdo | nota |
|---|---|---|
| `C2S.METEOR_HIT` | `{ id, d }` | "acertei esta rocha". `d` só alimenta o texto de distância. Quem atirou é a autoridade sobre o próprio acerto — o contrato do jogo —, mas quem decide se a rocha estourou é a sala. |

**Servidor → cliente**

| | conteúdo | Hz |
|---|---|---|
| `S2C.METEORS` | `{ time, m: [{ i, p:[x,y,z], k, hp, f }] }` | **10** |
| `S2C.METEOR_HIT` | `{ id, by, left, p }` | evento |
| `S2C.METEOR_BURST` | `{ id, p, seed, r }` | evento |
| `S2C.METEOR_IMPACT` | `{ p }` | evento |
| `S2C.METEOR_STATUS` | `{ horde, hordes, rocks, next, tank, startsAt }` | ao mudar |
| `S2C.METEOR_OVER` | `{ reason: "win"\|"impact", horde, ranking? }` | evento |

`S2C.HORDE` é **reaproveitada** para a faixa, com um campo `kind: "meteor"` — é a
mesma faixa na mesma posição com outro substantivo, e duas mensagens para isso
seriam duas coisas para manter em sincronia.

`startsAt` é o **instante absoluto no relógio da sala** em que a horda 1 começa,
não uma contagem regressiva (§3.6). É o que faz a contagem ser a mesma em todas
as telas e o retardatário não ver contagem nenhuma, sem código para o caso dele.

**10 Hz e não 5.** O meteorito em deriva vai a 5 Hz porque anda 20 cm entre
amostras (ver o comentário em `SpaceField.view`). Este anda **1,75 m** entre
amostras a 10 Hz na horda 10 — a 5 Hz seriam 3,5 m, e 3,5 m é mais que o raio da
maior rocha comum: a interpolação começaria a mentir sobre onde mirar. Custo:
28 rochas × ~28 B = 0,8 kB por amostra, 8 kB/s por cliente no pico de 4
jogadores. Cabe no orçamento de 22,5 kB/s que o `plano-lua-desempenho.md` mediu.

`m${id}` é o prefixo de entidade da rocha (`meteorEntity`), livre no espaço de
nomes atual (`p`, `b`, `e`, `v`, `z`, `t` estão tomados).

---

## 7. Som

**A trilha é a `lua_de_ossos.mp3`** — a mesma que toca no modo zumbi inteiro,
inclusive na luta do chefão. É a única trilha "de chefão" que o jogo tem; se o
pedido era outra coisa, é aqui que se corrige.

O problema técnico é pequeno e vale registrar: hoje quem escolhe a trilha é
`audio.setAmbientNight(true)`, que **junto** liga os grilos e o céu noturno. Na
Lua o ambiente é o vácuo (`setAmbientSpace(true)` cala tudo, e com razão). A
correção é extrair de `setAmbientNight` um método próprio:

```js
audio.setMusicTrack("zombie");   // só a trilha e o volume dela
audio.setAmbientSpace(true);     // continua sem ambiente nenhum: é o vácuo
```

Sons do modo, todos já existentes: `explosion` (estouro e impacto),
`rockBurst` (a pedra se partindo, e o "acertei"), `waveHorn` (faixa de horda),
`victoryFanfare` (as dez hordas). O bipe de alerta do §5.2 é o único sintetizado
novo — uma senoide curta, no molde do que `audio.js` já faz.

---

## 8. Custo de imagem

Orçamento medido no `plano-lua-desempenho.md`: seis arqueiros na Lua custam
847–1015 chamadas de desenho, e **60 % disso são os arqueiros**.

Uma rocha custa **3 chamadas**: a malha (o `esculpir()` que já existe), o
billboard aditivo de brilho e a mancha no chão (§5.2). O rastro de fogo sai do
pool de partículas — **zero chamadas novas** (o pool inteiro do jogo são duas).
Os estilhaços e o cascalho acumulado no chão são **uma** malha instanciada.

| cenário | rochas na tela | chamadas extras | % do quadro |
|---|---|---|---|
| solo, horda 10 | ~3 | 10 | 1 % |
| 4 jogadores, horda 10 | ~9 + tanque | 31 | 3 % |
| teto (`maxAlive: 16`) | 16 | 49 | 5 % |

**Dobrar o tamanho das rochas (§3.2) não custou nada disto.** Uma esfera de
raio 6 tem exatamente os mesmos 320 triângulos de uma de raio 3 —
`IcosahedronGeometry(raio, 2)` não depende do raio. No teto de 16 rochas são
5,1 k triângulos, mais 1,3 k do tanque em detalhe 3, contra os 92 k que a Lua
já desenha. O que o tamanho custa é **preenchimento de pixel**, e o preenchimento
de um material `MeshStandardMaterial` sem sombra é a coisa mais barata do quadro.

**Zero luzes dinâmicas.** Dezesseis `PointLight` seriam dezesseis recompilações
de material e o fim do quadro. O brilho vem de emissivo + bloom + o halo
aditivo — e o halo é justamente o que segura a leitura no preset `low`, que não
tem bloom (ver `CONFIG.render.presets.low`).

**As rochas não projetam sombra.** O mapa de sombra da Lua é um só (`2048` no
preset `high`) e enquadra a arena inteira; enfiar nele um objeto a 200 m de
altura gastaria resolução da cena toda para desenhar uma mancha que ninguém
associaria à rocha. A mancha do §5.2 faz o trabalho de leitura no chão, e faz
melhor: ela marca **onde vai cair**, não onde está.

**As rochas não podem entrar no corte por distância.** `cullDistance` é 45–60 m
e serve para bicho; uma rocha a 210 m é o alvo do modo. Elas ficam de fora da
regra, explicitamente.

---

## 9. Os arquivos

### Novos

| arquivo | o que é |
|---|---|
| `server/meteorSim.js` | `FallingMeteor`, `TankMeteor`, `MeteorRain` — o espelho de `zombieSim.js` |
| `src/systems/meteorRain.js` | o gerente cliente — o espelho de `zombieManager.js` |
| `src/entities/fallingMeteor.js` | malha, fogo, halo, rachaduras, colisor |

### Alterados

| arquivo | o quê |
|---|---|
| `src/shared/protocol.js` | versão 15, mensagens do §6, `meteorEntity`/`meteorIdFrom` |
| `src/shared/levels.js` | `"meteorRain"` entra em `LEVEL_INFO.moon.modos` |
| `src/config.js` | bloco `CONFIG.modes.meteorRain` com **todas** as tabelas do §4 |
| `src/shared/fragments.js` | perfil sem letalidade e com `fragSettleTime` longo |
| `server/room.js` | ciclo do modo, tick, acertos, wipe, `lineUpForMeteorRain`, `needsPreparation`, `resetWorld`, `modeView`, `snapshot`, rota do `C2S.METEOR_HIT`; e, para os bots: `botPrey` com as rochas, `personagens: []` no disparo, abate agendado por `r.tempo` |
| `server/botSim.js` | sinalizador `soPresas`, `aimY` na mira, `creaturePenalty` do modo, filtro de elevação ≤ 68°, posto fixo no anel |
| `server/botArrow.js` | raio de acerto por presa (`b.r ?? RAIO_BICHO`) em vez do 0,8 fixo |
| `server/spaceSim.js` | perfil do modo: alien raro, **sem** nave, **sem** deriva |
| `src/main.js` | handlers das seis mensagens, `applyMeteorMode`, preparo, alerta, trilha |
| `src/ui/hud.js` | `setMeteor`, **contagem de entrada** (§3.6), faixa genérica, alerta de borda, seta fora da tela, tela final |
| `src/entities/fallingMeteor.js` | inclui a **mancha no chão** (§5.2): disco aditivo no ponto de queda, acendendo com a descida |
| `src/ui/lobby.js` | a quinta porta: **Chuva de Meteoros** |
| `src/systems/input.js` | **`Shift+9`** — ver o quadro abaixo |
| `src/ui/hud.js` → `ATALHOS` | **a linha nova na lista de atalhos (F1)** — obrigatória, ver abaixo |
| `src/core/hitResolver.js` | `kind === "fallingMeteor"` → pisca local + `C2S.METEOR_HIT` |
| `src/systems/audio.js` | `setMusicTrack()` extraído de `setAmbientNight()`; bipe de alerta |

### A porta na tela de entrada

```js
{
  id: "meteorRain",
  level: "moon",
  mode: "meteorRain",
  rotulo: "Chuva de Meteoros",
  detalhe: "dez chuvas — uma no chão e acabou",
  classe: "porta-meteoro",
}
```

Como os outros modos, é **um lugar, não um ajuste**: quem clica encontra quem
já está lá (ver `RoomHost.ensure`). A tecla existe para quem já está dentro e
quer arrastar a sala junto, e ela passa pelo mesmo preparo coordenado que a
noite dos zumbis usa (`prepareMode`) — o modo compila malhas de rocha e
materiais de fogo, e sem a espera uns entrariam segundos antes dos outros, o
que num modo com prazo decide a partida.

### A tecla, e a lista de atalhos

**A tecla é `Shift+9`, e não `0`.** O `0` já é o placar (`Digit0`/`Numpad0` →
`input.scoreboard`, e está na lista de atalhos como `[["0"], "placar"]`);
propô-lo aqui teria sequestrado o placar no dia da implementação. Os dez dígitos
estão todos ocupados — 1 a 8 são modos, 9 é a fase, 0 é o placar.

`Shift+9` é a escolha certa por convenção e por significado: o repo já usa Shift
como "o segundo sentido da mesma tecla" (`Shift+B` tira bot, `Shift+N` volta a
dificuldade), e este modo **só existe na Lua**. Lê-se sozinho: *9 é a Lua,
Shift+9 é a Lua chovendo*. O `e.code` continua sendo `"Digit9"` com Shift
pressionado, então é um `e.shiftKey` dentro do `case` que já existe.

**E ela entra na lista de atalhos (F1), no mesmo commit.** O painel é montado a
partir da tabela `ATALHOS` em `ui/hud.js` — que existe, nas palavras do próprio
arquivo, "para que o painel não saia de sincronia com o `input.js` por
esquecimento de editar HTML". Uma linha, no grupo **Fases e bots**, logo abaixo
da do `9`:

```js
[["Shift", "9"], "chuva de meteoros (Lua)"],
```

Nenhum outro atalho global é criado por este plano. O que eu tinha proposto para
pular de horda em teste (`Shift+0` / `Ctrl+0`) **está cancelado** e vai para o
painel de depuração (`~`, `ui/debug.js`), que é onde controle de teste mora — e
onde não disputa tecla com ninguém. Ver §11.2.

---

## 10. A ordem de execução

| # | tarefa | entrega verificável |
|---|---|---|
| 1 | Config + protocolo + `levels.js` | o modo existe como id, a Lua o aceita, versão 15 |
| 2 | `server/meteorSim.js` (queda, classes, vida, hordas) | o bench do §11 roda sem cliente nenhum |
| 3 | Integração em `room.js` (tick, hit, wipe, fim) | sala solo joga o modo inteiro, sem imagem |
| 4 | `entities/fallingMeteor.js` + gerente cliente | as rochas aparecem, caem e são acertáveis |
| 5 | Estouro, estilhaço não letal, cascalho no chão | o §3.4 inteiro, na tela |
| 6 | Retorno de acerto — as quatro camadas do §5.1 | dois clientes não desperdiçam flecha na mesma rocha |
| 7 | Contagem de entrada, mancha no chão, alerta, chip, faixa, telas de fim | o §3.6, o §5.2 e o §5.3 — e um segundo cliente entrando na horda 5 sem reiniciar nada |
| 8 | Porta, tecla, preparo, trilha | dois navegadores entram juntos pela tela inicial |
| 9 | Perfil do espaço (alien raro, sem nave, sem deriva) | o céu só tem o que o modo quer |
| 10 | **Os bots antiaéreos** (§4.7) | `B` põe um bot; ele atira só em rocha, e um humano parado na frente dele não morre nem em cem flechas |
| 11 | **O Especial** — `docs/plano-kamehameha.md` | plano próprio, nove tarefas; entra depois de o modo estar de pé |
| 12 | **Balanceamento contra o bench e o playtest** | §11 |

Tarefas 1 a 3 são jogáveis sem uma linha de Three.js — e isso não é acidente: é
o que permite equilibrar o modo com um script antes de existir imagem.

---

## 11. Como provar que ficou difícil sem ficar impossível

O pedido foi explícito: *"Faça os testes de quantos meteoros podem vir cada
horda."* Três instrumentos, do mais barato ao mais caro.

### 11.1 O banco de provas (`scripts/bench-meteoros.js`)

`MeteorRain` é puro (só `CONFIG` e o campo de altura), como `ZombieNight`. Roda
em Node, sem cliente, sem física, sem imagem. Contra ele, um **arqueiro
simulado**: atira a cada `1/taxa` segundos, acerta com probabilidade `p`, e
sempre na rocha **mais próxima do chão** que ainda não morreu.

Saída, por horda e por número de jogadores:

* margem mínima — **quantos segundos sobraram** na rocha que chegou mais perto do
  chão. É o número que decide o modo: **abaixo de 3 s, a horda é injusta**;
  acima de 15 s, é passeio;
* pico de rochas no ar;
* flechas exigidas ÷ flechas disponíveis (o D real medido, não o estimado);
* taxa de derrota em 200 partidas.

**Critério de aceite:** com `taxa = 0,50 tiros/s` e `p = 0,67` (o jogador médio
do §4.1), a partida completa termina em vitória em **≥ 70 %** das 200 rodadas,
para N = 1, 2 e 4. Com `p = 0,50` (jogador ruim), a derrota deve cair entre as
hordas 6 e 9 — não na 2, e não nunca.

### 11.2 O salto de horda, no painel de depuração

No painel `~` (`ui/debug.js`): um campo "horda" e dois botões — *pular* e
*reiniciar em N*. **Não é um atalho global**, de propósito: controle de teste
não disputa tecla com controle de jogo, e o teclado do jogo já está cheio (ver
§9). Sem esse salto, testar a horda 9 custa oito minutos por tentativa e o
balanceamento simplesmente não acontece — foi por isso que o modo zumbi ganhou
o `startBossOnly`.

### 11.3 O playtest, e o que ele mede

Três sessões: solo, dupla, quarteto. Uma pergunta cada:

* **solo** — em que horda o jogador para de acertar por perícia e começa a
  acertar por sorte? Se for antes da 7, o `C` do §4.1 está otimista.
* **dupla** — as duas pessoas atiram na mesma rocha? Quantas vezes por horda? É
  isso que valida (ou derruba) o fator 0,70 do §4.4, e é isso que mede se o
  piscar do §5.1 está fazendo o trabalho dele.
* **quarteto** — em que horda o céu deixa de ser legível? Esse número vira o
  `maxAlive` real.

E uma quarta, com bots (§4.7): **1 humano + 2 bots contra 3 humanos, na mesma
horda.** A diferença de margem entre as duas partidas É o fator de conversão do
bot — hoje chutado em 0,70. Junto, o teste que não pode faltar: um humano parado
na linha de tiro de dois bots durante uma horda inteira, e o placar de mortes
dele no fim tem que estar em **zero**.

**A conclusão de cada um deles é um número no `CONFIG.modes.meteorRain`, e nada
mais.** Nenhuma tabela deste documento vive em código espalhado: as velocidades,
as composições, os gaps, a vida do tanque, os fatores de escala e o `C` são
todos campos de config — pelo mesmo motivo que `hordeArrivalGaps` é, e para que
o próximo ajuste de dificuldade seja uma linha, e não uma arqueologia.

---

## 12. Riscos conhecidos

| risco | por que é real | o que se faz |
|---|---|---|
| ~~**Mirar a pino é desconfortável**~~ **ACONTECEU** | o plano confiou no anel de queda de 55 m e isso não bastou: de 210 m de altitude com 12°–22° de inclinação, a rocha entrava a **68°–78° de elevação** — jogar era olhar para o teto | corrigido pela GEOMETRIA DA ENTRADA, não pela câmera: altitude 210 → **150 m** e inclinação 12°–22° → **35°–52°**, o que põe o ponto de entrada de 105 a 193 m ao lado do alvo e a elevação em **38°–55°**. As velocidades foram reescaladas por 150/210 para o prazo de queda — que é o que a dificuldade usa — ficar idêntico ao que o banco aprovou (medido de novo: 87,5 %) |
| **A rocha some contra o Sol** | o Sol da Lua tem flare e é ofuscante | o halo é aditivo e branco-azulado no núcleo, distinto do amarelo do Sol; e a zona de queda é fixa, então o jogador pode escolher de onde olhar |
| **Sala cheia vira parede** | 12 jogadores dariam 87 rochas na horda 10 | `min(N,6)` na escala corta em 45, e `maxAlive: 16` segura o céu |
| **Entrar no meio da partida** | quem chega na horda 8 não tem contexto | §3.6: o `snapshot` traz `METEOR_STATUS` (com `startsAt`) e a lista de rochas; a faixa e o chip explicam em dois segundos, e a contagem não reinicia para ninguém |
| **Rocha grande esconder rocha grande** | com Ø 12 m duas silhuetas vizinhas viram uma | separação mínima de `r₁ + r₂ + 6 m` entre pontos de queda simultâneos (§3.1) e teto de 16 rochas vivas (§4.5) |
| **Latência e a última flecha** | duas pessoas acertam a última flecha da mesma rocha quase juntas | a sala é a árbitra (é ela que decrementa); o segundo acerto vira um piscar sem efeito, que é o comportamento certo |
| **`C` estar errado** | é o único chute do plano | está isolado num campo só, e o §11.1 o mede em vez de discutir |
| **Flecha de bot matando amigo** | o bot nasceu adversário de duelo, e o caminho `matarPeloBot` existe e funciona | duas camadas independentes no §4.7 — ele não mira em gente, e a flecha dele não testa gente. A segunda vale mesmo se a primeira tiver um furo |
| **Bot inútil contra rocha a pino** | `elevacaoPara` degenera com `distH → 0` (§4.7) | filtro de elevação ≤ 68° e posto no anel externo; a correção do solver fica para depois, fora do caminho do duelo |
