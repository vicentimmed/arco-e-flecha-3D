# Plano — Cerco (fase Castelo)

> **Estado: IMPLEMENTADO.** O modo entra pela sexta porta da tela inicial. O que
> este documento descrevia está em pé; o que ele ERROU está corrigido abaixo,
> com o número medido ao lado do número chutado.
>
> **O que a GEOMETRIA desmentiu** — e estes são os erros que importam, porque
> nenhum deles aparecia na leitura do plano:
>
> * **O muro de 11 m tornava o próprio arco inútil.** A corda sai a 1,42 m do
>   piso do adarve; para acertar quem está no portão, a flecha tem de vencer os
>   3,2 m de espessura do muro antes de descer abaixo do topo dele. Com 11 m, o
>   primeiro ponto com linha limpa fica a **5,6 m** da face — longe demais para
>   ser "o portão". Medido: o arqueiro de CPU passou uma partida inteira de arco
>   tensionado sem soltar uma flecha, porque todo alvo estava atrás de pedra.
>   Hoje o muro tem **8 m** e a fila para a 5,2 m da face. Ver `WALL_TOP` em
>   `shared/castleProps.js`, que carrega a conta inteira.
> * **O merlão de 1,6 m barrava a flecha do defensor.** Ele precisa ficar entre
>   duas coisas: abaixo de 1,42 m (a corda) e acima de ~1,2 m (o peito de quem
>   se abriga). Hoje: **1,15 m**.
> * **O arqueiro de muralha mirava no companheiro.** Sem `soPresas`, o bot
>   escolhe o alvo mais próximo — que no adarve é o humano ao lado, não o
>   soldado a sessenta metros. Ele não é adversário aqui; é guarnição.
> * **O posto central nascia dentro do trabuco.** Adarve e engenho ocupavam o
>   mesmo metro quadrado, e quem entrava sozinho aparecia com a pedra em chamas
>   encostada na câmera.
>
> **O que o banco de provas (`scripts/bench-cerco.js`) desmentiu:**
>
> * A primeira `gapBase` abria em 4,5 s e dava **0 % de vitórias**, com a
>   derrota mediana no minuto 3,6. Não era balanceamento fino: 4,5 s já era
>   mais rápido do que um arco consegue matar (2 acertos × 5,1 s por abate).
>   Hoje ela abre em **7,0 s** e cruza a capacidade do arco por volta do minuto
>   8 — e é esse cruzamento que obriga o trabuco a existir.
> * **1 200 de vida de portão era um sexto do necessário.** O número vinha da
>   âncora "portão ignorado cai em 40 s", que é boa para o pânico e ignora a
>   conta do prazo: vinte minutos de vazamento médio somam ~4 000. Hoje são
>   **4 400**, e o portão ignorado cai em 2 min 27 s.
> * **A maré travada na preamar produzia um precipício.** Entre 4 200 e 4 800 de
>   vida a taxa de vitória pulava de 28 % para 80 %, com todas as derrotas nos
>   últimos 40 s: dezoito minutos sem consequência e um dado de uma face no fim.
>   Hoje ela para em 1 depois do minuto 18.
>
> ---
>
> **Segunda rodada de correções, depois do primeiro playtest.** O que veio da
> tela e não da conta:
>
> * **A partida caiu de 20 para 10 minutos.** Vinte é longo demais para uma
>   curva que só sobe: o meio virava planalto. A curva foi REAMOSTRADA (mesma
>   forma, metade dos pontos) para a medição continuar valendo, e a vida do
>   portão encolheu junto — ela é o integral do vazamento ao longo da partida.
> * **As ameias saíram.** Merlões alternados são historicamente certos e
>   injogáveis: ficam na altura do olho e cortam o campo de tiro em fatias de
>   90 cm. No lugar entrou um parapeito corrido — e ele **não barra flecha**,
>   ver §6.4, que foi reescrito depois de medir que ele não cobria nada.
> * **O adarve passou de 2,6 m livres para 6,1 m.** Com 2,6 ele era um corredor,
>   e andar de costas enquanto se mira virava uma queda.
> * **Entrou a HOURD.** Alargar o adarve empurrou o arqueiro para dentro da
>   espessura do muro e o ângulo morto ao pé dele saltou para 13,8 m — alargar o
>   muro e alcançar o portão eram pedidos que se anulavam. A galeria de madeira
>   projetada 1,2 m para fora desempata os dois, e é literalmente para isso que
>   hourds existiram.
> * **Cair do muro mata** (§7.2), por desnível, valendo para os dois lados.
> * **A planície ganhou BOSQUE.** Vazia e lisa, ela lia como lâmina d'água — o
>   relato foi "os personagens surgem da água". Agora eles saem de uma linha de
>   árvores, que é o que o §3.1 sempre descreveu e nunca tinha sido construído.
> * **A rampa ganhou superfície**: sulcos de roda, miolo pisado, cascalho
>   aflorando e grama voltando pela beirada. Era uma faixa marrom chapada de
>   noventa metros no centro da tela.
> * **Cada espécie ganhou corpo próprio** (§6.5). Eram oito repinturas do mesmo
>   boneco; agora são oito silhuetas e oito marchas.
> * **As flechas param de flutuar.** `SiegeSystem` não tinha sequer referência
>   ao gerenciador de flechas, então nada soltava a flecha cravada num sitiante
>   que morria. E o teto de cravadas caiu de 24 para 14 por arqueiro, com as
>   excedentes APAGANDO em vez de sumirem num quadro.
>
> ---
>
> **Terceira rodada, depois do segundo playtest.**
>
> * **O parapeito saiu de vez.** Terceira tentativa de pôr borda no adarve,
>   terceiro fracasso: mesmo sem barrar flecha, ele atravessava o terço inferior
>   da tela justamente onde a rampa aparece. Hoje o adarve é chão limpo, e o que
>   protege é a regra de que cair mata. Ver `castleParapets`.
> * **O pavês virou COLISOR.** A conta de ângulo no servidor ("veio de frente e
>   raso ⇒ aparou") acerta na média e mente no caso: aparava tiro que passava
>   pela cabeça e deixava passar tiro que batia na tábua. Agora o escudo é uma
>   caixa do tamanho do escudo, e quem decide é o solver de contato — como no
>   resto do jogo. E ele deixou de ser marrom: azul-cobalto, cor que não existe
>   em nenhum outro lugar da fase.
> * **Tiro na cabeça mata de primeira** — menos no ogro, onde vale quatro
>   flechas. Isso obrigou a **reapertar a curva em 22 %**: com 18 % dos acertos
>   virando abate instantâneo o arco ficou ~35 % mais rápido, e medido, três
>   defensores passaram a vencer 100 % das partidas SEM TRABUCO. A arma que o
>   modo existe para justificar tinha virado enfeite.
> * **O buraco no canto do castelo.** O bastião ia até z = 3,4 e o muro de
>   flanco começava em x = 19,2 — sobravam dois metros por onde se andava para
>   fora e se caía. Era o "atravessando a parede nas extremidades laterais".
> * **O esqueleto DESMONTA.** Os ossos caem, ficam no chão e se remontam; a
>   segunda morte é definitiva, e o fogo cancela a volta. Um esqueleto no chão
>   deixou de ser um abate e virou um relógio.
> * **O trabuco ganhou modo de mira** (§5.6), e é a mudança mais pesada desta
>   rodada.
> * **Mastim serpenteia**, **xamã tem feixe visível** ao remontar, **ogro
>   enfurece** na metade da vida (§6.5).
>
> ---
>
> ---
>
> **Terceira rodada — o trabuco que não atirava, e o castelo que não parecia um.**
>
> O relato tinha duas frases e as duas estavam certas: *"o trabuco parece estar
> invertido"* e *"ao apertar o botão do mouse não atira"*.
>
> * **O CLIQUE NUNCA CHEGAVA.** Na mira, `blockDraw` fica ligado para o arco não
>   tensionar por baixo da câmera — mas `blockDrawReason` ficava `null`, e o
>   `input` trata todo motivo sem nome como "câmera da flecha": ele APAGA
>   `primaryDown` e sai. A borda de subida que `updateSiege` procura para soltar
>   a pedra não chegava a existir. O bloqueio ganhou nome (`"trebuchet"`), e com
>   ele o clique passa a ser registrado sem virar um puxão de corda.
> * **A ARMAÇÃO ESTAVA DE CABEÇA PARA BAIXO.** Armado, o contrapeso ficava
>   EMBAIXO e a funda no alto; ao soltar, o peso SUBIA. Um trabuco carregado se
>   reconhece de longe pelo peso pendurado lá em cima — os três engenhos do muro
>   mentiam sobre o próprio estado a vinte metros, que é a única distância de que
>   se olha para eles. Junto vieram a armação de verdade (dois cavaletes em A, o
>   sarilho com a corda que puxa o braço, a calha em que a pedra descansa) e a
>   descoberta de que `fireAt` não zerava o içamento: o braço só se mexia quando
>   o `TREB_STATE` seguinte chegava do servidor.
> * **A RECARGA CORRIA AO DOBRO.** `pronto` é um PRAZO no relógio da sala, e o
>   tique descontava o passo cheio dele enquanto `agora` avançava o mesmo tanto:
>   o tempo era gasto duas vezes. Sozinho, o engenho recarregava em 7 s e não em
>   14; com alguém na manivela, em 3,4 s e não em 4,5. A troca central do modo —
>   largar o arco para içar o engenho de outro — pagava metade do preço, e o
>   banco de provas (que sempre modelou a regra certa) media um jogo que a sala
>   não jogava. Corrigido, o banco e a sala voltam a falar do mesmo jogo:
>   **71,7 %** de vitórias com três defensores, derrota sempre no último minuto,
>   trabuco valendo 28 pontos de taxa de vitória.
> * **NASCIA-SE DE COSTAS PARA A RAMPA.** `faceYaw` já existia no `room.js` com
>   a conta certa; os três pontos de nascimento do cerco e da chuva de meteoros
>   tinham a fórmula escrita à mão, com o sinal trocado. O primeiro segundo de
>   toda partida e de todo renascimento era um giro de mouse às cegas.
> * **A CÂMERA JOGAVA DE DENTRO DO ENGENHO.** Os postos de tiro ficavam no mesmo
>   x do seu trabuco, e a terceira pessoa fica quatro metros atrás do arqueiro:
>   a partida inteira era vista através de um cavalete. Os postos saíram do eixo
>   das máquinas; os braseiros do adarve saíram junto, da hourd para a faixa de
>   dentro, pelo mesmo motivo.
> * **O MURO NÃO TINHA UMA LINHA VERTICAL.** Visto de fora era uma laje de 34 m
>   com o topo perfeitamente reto. O que destravou a correção foi perceber que a
>   HOURD já tinha resolvido o problema: o arqueiro fica em z = 8,3 e a face
>   externa em z = 8,0, então tudo o que se erga sobre o adarve nasce ATRÁS dele
>   e não pode entrar na linha de tiro nem em princípio. Entraram duas torres de
>   portão, ameias no fundo, nos flancos e nos cantos de trás dos bastiões,
>   guaritas de canto, embasamento e pilastras na face externa, frestas e coroa
>   na menagem, estandartes que leem o vento e um pátio com poço, depósito e
>   carroça quebrada. **Tudo no mesmo lote de fusão: ~180 caixas a mais e
>   nenhuma chamada de desenho a mais.**
> * **E a pedra do calcário era cinza-azulada** porque a face que importa passa a
>   partida em luz rasante ou em sombra própria, iluminada só pelo hemisférico,
>   que é azul. A correção é na TINTA: subir o hemisférico clarearia junto a
>   horda, a rampa e o pátio, que estão certos.
>
> **Desempenho, medido contra o Vale Verde** (a régua que o pedido nomeou):
>
> ```
>   Vale Verde                    289 chamadas · 267 k triângulos · 217 geometrias
>   Cerco (3 arqueiros, 23 sitiantes)
>     antes                       789 chamadas
>     depois                      609 chamadas
> ```
>
> Os dois cortes que pagaram isso não são do castelo — são de TODO modo:
>
> * **a flecha caiu de 6 malhas para 2.** Haste, ponta e nó eram três `Mesh` com
>   três materiais; viraram uma geometria só com COR POR VÉRTICE. As empenas
>   ficam de fora do lote porque levam a cor de quem atirou, e passaram a buscar
>   o material num cache por cor em vez de clonar um por disparo — com 120
>   cravadas em cena eram 120 materiais para seis cores. O custo do corte é
>   honesto: um material só significa um acabamento só, e o brilho de aço da
>   ponta virou contraste de cor em vez de expoente especular;
> * **o ferro dos sete braseiros virou uma malha.** Cesto e tripé não se mexem;
>   quem respira é a chama.
>
> A malha da FASE castelo ficou em 35 objetos visíveis, contra 79 do vale. O que
> sobra de diferença é o que o modo é: três arqueiros a sete metros um do outro
> (todos no nível de detalhe de perto, 119 malhas cada) e a horda. Nenhum dos
> dois é gordura.
>
> ---
>
> **Quarta rodada — o adarve, e quatro coisas que o playtest viu.**
>
> * **AS DUAS ESCADAS ERAM MACIÇAS.** `castleBlockers()` declara cada escada
>   como um BLOCO do pátio ao adarve — aproximação deliberada, porque o formato
>   compartilhado não tem caixa girada em X e o servidor só precisa dela para
>   visada. O cliente monta a rampa de verdade em `buildStairs`… e montava o
>   bloco TAMBÉM, porque `buildSolids` percorre a lista inteira sem exceção. O
>   que existia, então, era um pilar de pedra de oito metros com paredes
>   verticais, com uma rampa inútil por dentro. Quem morria renascia na menagem
>   e não tinha por onde voltar ao muro.
> * **E, mesmo sem o bloco, não dava para subir.** O piso vencia por
>   ATRIBUIÇÃO: estando a menos de 8 cm do terreno, o corpo era recolado nele.
>   Subindo uma rampa de 30° a 4 m/s, o passo de um quadro sobe 3,8 cm — menos
>   que a tolerância. O corpo ganhava os 3,8 cm pelo controlador e os perdia no
>   mesmo quadro, para sempre; dava para atravessar a escada inteira por baixo,
>   no nível do pátio. Hoje o terreno só ERGUE, nunca puxa para baixo: o chão é
>   o mais alto dos dois. Medido: 14 → 22 m em ~5 s, nas duas escadas.
> * **OS PÉS AFUNDAVAM 45 cm NA PEDRA.** A IK do pé amostra o campo de altura, e
>   no adarve o campo de altura é o PÁTIO, oito metros abaixo. Havia um limite
>   de um passo (45 cm) para a perna não esticar até lá — e era exatamente esse
>   limite que se via, o tempo todo, em todo o muro. A correção é de
>   interpretação: uma amostra que cai mais de um passo abaixo do corpo não está
>   descrevendo o chão em que se pisa, e nesse caso quem sabe a verdade é o
>   controlador. 0,451 m → 0,001 m.
> * **O CHÃO DO MURO PISCAVA.** Toda peça que assenta sobre outra nascia com a
>   face de baixo na cota exata do piso — torres do portão, ameias, guaritas,
>   coroa da menagem, soleiras do trabuco. Duas faces coplanares na mesma
>   profundidade são z-fighting, e na tela isso é o piso piscando em manchas.
>   Hoje elas afundam 6 cm (`Lote.assenta`).
> * **ANDAR PARA A FRENTE MATAVA.** A faixa de tiro da hourd tem 90 cm e termina
>   em oito metros de queda. Medido agora contra a geometria de hoje: a flecha
>   que vai à fila do portão passa a **5 cm** do deque na beira externa, então o
>   §6.4 continua certo — não cabe borda nenhuma ali, nem de dez centímetros. O
>   que entrou não é pedra, é regra: **o corpo não ANDA para dentro de uma queda
>   que o mata** (`PlayerPhysics.ledgeGuard`). Só o componente sem chão é
>   cancelado, então dá para correr rente à beira; e PULAR para fora continua
>   sendo escolha de quem joga. Ligado só no cerco, que é o único modo com dano
>   de queda — na Lua se anda para fora de uma plataforma de propósito.
>
> Isto revisa o §6.4 num ponto: a beira do adarve deixou de ser "uma decisão a
> cada passo" e passou a ser uma decisão que se toma com o salto. A pedra
> continua proibida ali pelo mesmo motivo de sempre.
>
> ---
>
> **Números atuais medidos** (arqueiro médio: 0,5 tiro/s, 78 % de acerto,
> 18 % dos acertos na cabeça):
> três defensores **75 %** de vitórias, com a derrota sempre no último minuto;
> sem trabuco, **35 %** — quarenta pontos de diferença, contra os 15 que o §12
> exigia para ele não ser enfeite. Um defensor sozinho perde entre os minutos 4
> e 8, e é por isso que o modo entra com dois arqueiros de CPU na muralha
> (§10). O playtest continua sendo o juiz final.

Noite. Um castelo num esporão de rocha, com uma única rampa de acesso. Os
jogadores estão **em cima do muro**, com arco e com **trabucos de madeira** que
cospem pedras em chamas. Lá embaixo, soldados, esqueletos e monstros sobem a
rampa sem parar — não em ondas, em **fluxo**, cada vez mais denso e mais
estranho.

Ninguém precisa sobreviver. Ninguém precisa matar todos. **Só se perde quando o
grande portão cai.**

Formato dos outros planos (`plano-lua.md`, `plano-chuva-de-meteoros.md`): cada
bloco traz a decisão, o **porquê** e o custo.

---

## 1. A ideia, em uma frase

Todos os outros modos do jogo perguntam **onde está o alvo**; a chuva de
meteoros pergunta **quanto tempo falta**. Este pergunta **quantos passaram** —
e é a primeira vez que a resposta é uma taxa, não um evento.

Três consequências que organizam tudo o que vem abaixo:

* **A derrota é uma FILA, não um erro.** O portão não cai porque alguém errou um
  tiro; cai porque, durante quarenta segundos, chegou mais gente na base dele do
  que saiu. Isso é uma diferença de gênero em relação ao modo zumbi (onde o erro
  é pessoal e imediato) e à chuva (onde um erro único encerra a partida). Aqui o
  erro é lento, visível, e **reversível** — dá para recuperar uma fila que
  cresceu, e é essa recuperação que faz a partida ter história.
* **Matar não é o objetivo, é o método.** O contador que importa é a integridade
  do portão. Um jogador que fez 300 abates e deixou o portão em 12 % jogou pior
  que um que fez 120 e o manteve em 70 %. O HUD tem que dizer isso desde o
  primeiro segundo (§8), senão o modo é lido como "modo zumbi com muro" e o
  jogador otimiza a coisa errada.
* **A dificuldade é CONCORRÊNCIA, de novo.** É a terceira vez que o projeto
  aprende isto — `hordeArrivalGaps` no zumbi, `hordeGaps` na chuva. O que aperta
  não é quantos inimigos existem, é de quanto em quanto tempo um deles **encosta
  no portão**. O ritmo é agendado pela CHEGADA, nunca pelo nascimento (§4.2), e
  quem ignorar isso vai produzir de novo a horda que "saiu enfileirada e chegou
  em bloco" que o comentário do `zombieSim.js` registra.

E a decisão que dá forma ao resto: **não há ondas.** Sem onda não há pausa entre
elas, e sem pausa não há o momento em que o jogo devolve o fôlego. Isso não pode
ficar por resolver — a maré do §4.3 é a substituição, e ela é obrigatória, não
enfeite.

---

## 2. O que já existe e vai ser reaproveitado

Quase nada aqui começa do zero. O jogo já tem uma horda que caminha, um projétil
em chamas que cai, um placar coletivo que mora só no servidor e um contrato de
fase pronto para receber a terceira.

| peça | onde está hoje | como entra |
|---|---|---|
| horda que anda, separa e ataque corpo a corpo | `server/zombieSim.js` | classe-base dos sitiantes |
| chefão com vida escalada por jogador | `zombieSim.js` → `boss` | o ogro é ele com outro perfil |
| lobo (rápido, quebra o ritmo) | `zombieSim.js` → `Wolf` | vira o `mastim` da matilha inimiga |
| projétil grande em chamas, com vida e estouro | `server/meteorSim.js`, `entities/fallingMeteor.js` | a pedra do trabuco |
| estilhaços com a MESMA conta nos dois lados | `shared/fragments.js` | portão rachando, pedra estourando |
| geometria estática que o SERVIDOR entende | `shared/blockers.js` + `valleyProps.js` | o castelo (§3.3) — e ver §6.4 |
| visada bloqueada por cenário | `botSim.js` → `bloqueado()` | **as ameias, de graça** (§6.4) |
| estado compartilhado só no servidor | `server/flagSim.js` (o cabeçalho inteiro) | a vida do portão |
| noite, tochas, luz de canto | `systems/torches.js`, `modes.zombie.torch*` | os braseiros do muro |
| retransmissão de projétil por parâmetros de disparo | `net/remoteArrows.js` | a pedra do trabuco (§5.4) |
| preparo coordenado de modo, tela de carregamento | `room.js` → `prepareMode` | mesmo handshake |
| trompa de onda, faixa na tela, tela de fim | `S2C.WAVE`, `ui/hud.js` | o toque de escalão (§4.4) |
| adversário de CPU que mira e solta a corda | `server/botSim.js` | arqueiro de muralha (§10) |
| segunda trilha no mesmo `THREE.Audio` | `systems/audio.js` → `_musicBuffers` | terceira trilha, mesmo mecanismo |

O que **não** dá para reaproveitar, e por quê:

* **O agendamento por horda** (`nextHorde`, `hordeSizes`, `hordeDelay`). O modo
  não tem hordas. O que entra no lugar é uma função contínua de pressão (§4.1),
  e tentar exprimi-la como "hordas muito juntas" produziria justamente os
  degraus que o modo existe para não ter.
* **O alvo do bicho.** `Zombie.pickTarget()` procura o jogador mais próximo.
  Aqui o alvo padrão é o **portão**, e o jogador só vira alvo de quem tem como
  alcançá-lo. Inverter isso é uma linha, mas é a linha que define o modo.
* **`Zombie.step()`**, que só consulta `terrain.isWalkable` e `arenaDistance`.
  O servidor não tem castelo nenhum: sem o teste do §3.3, a horda inteira
  atravessa o muro andando. Este é o defeito mais provável da primeira versão
  jogável, e ele aparece como monstro dentro do pátio sem nenhum erro no log.

---

## 3. A fase: Castelo

### 3.1 A forma do terreno, e por que ela é assim

`shared/castleField.js` — puro, como `terrainField.js` e `moonField.js`, porque
o servidor precisa das mesmas alturas para nascer gente e caminhar bicho.

* Um **esporão de rocha** a ~14 m acima da planície, com o castelo em cima.
* **Três lados em despenhadeiro** (declive > 55°, `isWalkable` falso). Não é
  cenário: é o que impede a resposta óbvia de "a horda contorna o muro e entra
  por trás", que transformaria o modo numa defesa de perímetro de 360° em que
  quatro arqueiros não cobrem nada.
* **Uma rampa**, de 26 m de largura, subindo 90 m desde a linha de árvores. É o
  campo de tiro inteiro do modo, e o dimensionamento dela é o dimensionamento da
  dificuldade: a 1,15 m/s um soldado leva **78 s** da árvore ao portão, e esses
  78 s são o prazo que o defensor tem para resolvê-lo.
* **A linha de árvores a 90–120 m** é de onde eles saem. Longe o bastante para a
  silhueta entrar pequena e crescer (a leitura que o modo quer), perto o
  bastante para caber no campo de visão de quem está no muro.

Física idêntica à do vale — gravidade, ar, vento. O `fisica: {}` da entrada em
`LEVEL_INFO` fica vazio, pelo mesmo motivo que o do vale: repetir os padrões é
como eles saem de sincronia no primeiro ajuste.

### 3.2 O castelo

| peça | medida | para que serve |
|---|---|---|
| muro frontal | 34 m de vão, **8 m** de altura | a linha de tiro — a altura saiu da geometria do tiro, ver o cabeçalho |
| adarve (passarela) | 3,2 m de largura, a 8 m | onde os jogadores ficam |
| ameias | **1,15 m** de alto, 1,2 m de merlão, 0,9 m de vão | cobertura de verdade (§6.4) |
| torres | 2 bastiões abertos, no nível do adarve | posto do trabuco de flanco |
| **grande portão** | 6 m × 5,5 m, no centro do muro | **a única condição de derrota** |
| pátio | 30 m × 22 m | reparo, escadas, renascimento |
| torre de menagem | ao fundo | onde se renasce (§7.2) |
| escadas | 2, do pátio ao adarve | 3,5 s de subida — ver §7.2 |

O adarve é **aberto por dentro**. Cair dele para o pátio custa vida; cair dele
para FORA custa a partida de quem caiu, porque lá embaixo é a fila. Isso não é
crueldade — é o que dá peso a andar de costas enquanto se mira.

**O pé do muro é ângulo morto, e continua sendo.** Mesmo com 8 m, quem está
colado na alvenaria não pode ser atingido de cima: a flecha atravessaria o
próprio muro. É fisicamente verdade — é por isso que castelos de verdade têm
matacães, que são buracos para despejar coisas, não postos de tiro. A resposta
do modo não é fingir que o tiro existe: é `gateInfo().standZ`, que põe a fila a
5,2 m da face, na boca do portão, onde a muralha alcança.

### 3.3 A geometria que o servidor precisa ter

`shared/castleProps.js`, no molde exato de `valleyProps.js` e `moonProps.js`, e
pelo mesmo motivo declarado no cabeçalho daquele arquivo: *"ou ele sabe onde
está o tronco, ou atira através dele"*.

Exporta quatro coisas:

1. **`castleBlockers()`** — a lista de caixas orientadas do formato de
   `shared/blockers.js` (`{ box:true, x,y,z, hx,hy,hz, ry }`). Muro, torres,
   merlões, portão. O teste de caixa de lá já é exato; não precisa de nada novo.
2. **`gatePlane()`** — o retângulo do portão, para o servidor saber quem está
   encostado nele.
3. **`walkway()`** — a polilinha do adarve, para nascer jogador em cima do muro
   sem coordenada escrita à mão.
4. **`footprint()`** — o polígono do castelo no plano, que é o que entra no
   `step()` da horda. **Sem isto o muro não existe para o servidor.** É um teste
   de ponto-em-retângulo por peça: barato, e a alternativa (dar Rapier ao
   servidor) é uma reescrita do projeto.

O cliente monta a malha em `levels/castleLevel.js` LENDO essa mesma lista, e não
uma cópia dela. É a única defesa possível contra a divergência clássica: o muro
que na tela está 40 cm à frente de onde o servidor acha que está, e que aparece
como flecha do bot cravando no ar.

---

## 4. O fluxo: a horda sem ondas

### 4.1 A pressão é uma função do tempo

Um único número governa o modo:

```
gap(t) = gapBase(t) × maré(t) × escalaJogadores(N)
```

`gap` é o intervalo, em segundos, entre duas **chegadas ao portão** — não entre
dois nascimentos (§4.2).

* **`gapBase`** cai de **4,5 s** (t = 0) a **0,9 s** (t = 20 min), por
  interpolação numa tabela de 21 pontos, um por minuto. Tabela, e não fórmula,
  pela razão de sempre neste projeto: é a tabela que o banco de provas consegue
  corrigir num ponto só sem reescrever a curva inteira.
* **`escalaJogadores`** = `N^−1,05` (`playerGapExp`), e `gapBase` é a curva de
  **um** defensor.

  Era `0,85^(N−1)`, emprestado do modo zumbi, e o empréstimo estava errado por
  uma razão que só apareceu quando o banco de provas mediu as duas pontas: a
  capacidade de abate cresce **linearmente** com N — cada defensor é um arco —,
  e um fator geométrico de 0,85 devolvia ×1,38 de pressão para ×3 de poder de
  fogo. O resultado é que cada reforço deixava o cerco mais fácil: 0 % de
  vitórias sozinho, 100 % com três, sem degrau no meio. Era por isso que a sala
  precisava forçar dois bots na entrada do modo — eles não eram ajuda, eram a
  calibragem.

  Com a potência, a pressão por defensor é constante e o número de arcos na
  muralha deixa de mudar a dificuldade do modo, que é o que ele sempre quis
  dizer. Medido: ~82 % sozinho, ~78 % em dupla, 97 % com três. O que os
  defensores dividem (34 m de muro, a mesma linha de tiro) continua sendo
  cobrado, mas do outro lado da conta — quem larga a muralha para içar o trabuco
  ou remendar o portão não está atirando, e é isso que faz o quarto valer menos
  que o primeiro.

### 4.1.1 Os três níveis

`gap(t)` ganha um multiplicador de nível, e `gateHealth` outro. Ver
`difficulties` em `config.js`; `normal` é o cerco de sempre, com tudo em 1,00.

| nível | `gap` | `gate` | `exp` | N=1 | N=2 | N=3 | N=4 |
|---|---|---|---|---|---|---|---|
| fácil | 1,08 | 1,15 | — | 93 % | 96 % | 100 % | 100 % |
| normal | 1,00 | 1,00 | — | ~82 % | ~78 % | 97 % | 100 % |
| difícil | 0,90 | 0,65 | 1,15 | **25 %** | 6 % | 25 % | 52 % |

`exp` sobrescreve `playerGapExp`, e só o difícil declara o seu — sem isso ele
media 100 % com quatro defensores, isto é, existia só para quem jogava sozinho.

**O que estes números valem, e o que não valem.** A coluna N=1 é a que o banco
mede honestamente, e é a que foi calibrada: 25 % no difícil vem de 300 partidas.
As outras três carregam dois vieses conhecidos, em direções opostas:

* **N=2 lê mais difícil do que joga.** O modelo põe meio arqueiro na manivela
  assim que há dois defensores (§12), e é meio arco em cima de uma capacidade de
  um e meio. No jogo, o segundo defensor costuma ser um *bot*, e bot não vai à
  manivela nem repara portão — ele é um arco inteiro. Os 6 % do difícil são o
  pior caso do modelo, não o caso comum.
* **N≥3 lê mais fácil do que joga.** O trabuco do banco é o teto do engenho:
  três deles, sempre achando o melhor aglomerado, nunca errando o ponto. Numa
  rampa cheia isso é muito: 21 % da vazão com um defensor, 40 % com quatro.
  Jogadores de verdade miram à mão e recarregam em catorze segundos.

Uma corrida só não decide nada aqui. A MESMA configuração do normal devolveu de
75 % a 88 % em corridas de 100 a 300 partidas — a dispersão é maior que a de uma
binomial porque o acaso é correlacionado dentro da partida (o sorteio de
espécies e a fase da maré valem para os dez minutos inteiros). Cem partidas
distinguem 25 % de 80 %; não distinguem 75 % de 85 %.

### 4.2 Agendado pela CHEGADA — de novo

O comentário de `hordeArrivalGaps` em `config.js` já escreveu este parágrafo:
espaçar o nascimento não espaça nada, porque a viagem varia mais que o intervalo.
Aqui é pior. A rampa tem 90 m de comprimento; um esqueleto a 2,4 m/s cobre isso
em 37 s e um ogro a 0,9 m/s em 100 s. Nascer alternando os dois em intervalos
iguais entrega **todos os esqueletos juntos** e os ogros num bloco um minuto
depois.

Então o servidor agenda o instante de **chegada**, sorteia a espécie, e
**subtrai a viagem** (`distância ÷ velocidade`) para achar o instante de
nascimento. Um ogro nasce um minuto antes de estar previsto na fila. É a mesma
conta do `ZombieNight.nextHorde`, só que contínua.

### 4.3 A maré: o que substitui a pausa entre ondas

Uma rampa contínua e monótona não tem textura: o jogador nunca sente que venceu
nada, nunca larga o arco, nunca conversa. As ondas davam isso de graça e foram
descartadas. A reposição é uma **maré**:

```
maré(t) = 1 + 0,32 · sen(2π · t / 78 s)
```

De 78 em 78 segundos a chegada afrouxa um terço por ~20 s e depois aperta um
terço. A vazante é a janela para: içar o contrapeso do trabuco (§5.3), descer e
reforçar o portão (§7.1), recolher-se atrás de um merlão, respirar.

**A maré tem que ser AUDÍVEL.** Na preamar, tambores de guerra sobem na mistura;
na vazante, saem, e o que fica é o vento e o fogo. Um jogador que só descobre a
maré pelo gráfico não tem maré nenhuma — tem uma variação aleatória de
dificuldade, que é a mesma coisa sem o benefício.

### 4.4 Escalões: a variedade que sobe por degraus

A densidade sobe liso; a **composição** sobe em degraus, e cada degrau é
anunciado — trompa (a de `S2C.WAVE`, que já existe) e faixa na tela com o nome
do que está chegando. É o único momento em que o modo pausa a leitura do
jogador, e ele existe justamente porque a primeira aparição de uma espécie nova
precisa ser vista **antes** de ser um problema.

| a partir de | entra | por que aqui |
|---|---|---|
| 0:00 | **soldados** | ensinam o básico: alvo grande, lento, morre com 2 flechas |
| 1:30 | **esqueletos** | o volume. Frágeis, rápidos — e **se remontam uma vez, a não ser que queimem**. É o que cria a demanda por fogo antes do trabuco parecer necessário |
| 3:30 | **escaladores** | sobem o muro. Acabam com a hipótese de que lá em cima é seguro |
| 5:30 | **xamã** | fica atrás, cura e remonta esqueletos. Alvo de valor a 70 m, que castiga quem só olha para o portão |
| 7:30 | **ogro** | 1 acerto = 60 de dano no portão. É o prazo curto dentro do prazo longo |
| 10:00 | **soldados com pavês** | escudo que para flecha de frente. Ver §6.4 — a resposta é o ângulo, ou o fogo |
| 12:30 | **matilha de mastins** | velocidade pura, para quebrar o ritmo de quem já achou o dele |
| 15:00 | **catapulta inimiga** | a 110 m, atira no ADARVE. Pela primeira vez o jogador é o alvo |
| 18:00 | **maré cheia** | tudo, sem vazante |
| 20:00 | **o Sol toca o horizonte** | vitória (§4.5) |

### 4.5 O pôr do sol

**O cerco TERMINA em 20 min, quando o Sol toca o horizonte.** O pedido é
sobrevivência, e sobrevivência sem fim é uma tabela de recordes — o que é um
modo legítimo, mas não é o que os outros modos deste jogo são. Todos eles
terminam, e todos têm tela de vitória.

> **Corrigido depois da primeira execução.** O plano dizia "amanhecer", e com
> ele a partida começava de noite e clareava. O pedido virou o inverso: **começa
> de dia e termina ao entardecer, sem nunca escurecer** — e isso não é uma troca
> de rótulo, é outro sistema. `setNight` é um dial dia↔noite: pela metade ele
> dá um dia escuro, sem sombra projetada e com estrelas às cinco da tarde. Ver
> §4.6.

**O CRONÔMETRO FICA DO LADO DE FORA DA TELA.** `Game.updateDusk` amarra a
posição do Sol ao relógio da partida, então os vinte minutos do modo são
exatamente a distância entre o Sol alto e o Sol na linha do horizonte. Quem está
sob pressão não lê o número no HUD; olha para fora e vê que a luz está acabando.
É a mesma ideia do baque do portão (§7.1) — informação que chega sem exigir que
se tire os olhos da mira.

Quem quiser mais que 20 min: `endless: true` no `CONFIG`, com a curva continuando
a cair depois do minuto 20 e o placar virando "tempo sobrevivido". Uma linha,
não um segundo modo.

### 4.6 A luz, e por que ela é um segundo dial

`Renderer.setDusk(t)` existe ao lado de `setNight(t)` em vez de ser um caso
dele. Os dois fenômenos não são o mesmo, e tentar exprimir um pelo outro produz
justamente o defeito que o pedido recusa:

| | `setNight` (vale, zumbi) | `setDusk` (castelo) |
|---|---|---|
| Sol | apaga (intensidade → 0) | desce 41° → 7°, cai 42 % e para |
| sombra projetada | **desligada** acima de 0,3 | **ligada**, e é o efeito inteiro |
| estrelas | acendem acima de 0,15 | nunca |
| céu | preto | zênite fundo, horizonte em brasa |
| névoa | preta | quente, porque ela É o ar que avermelhou o Sol |

A sombra é o ponto. Com o Sol a 7° a muralha projeta trinta metros de sombra
sobre a rampa, e isso sai **de graça**: a direção da luz já alimenta a câmera de
sombra, o halo do céu e a névoa direcional. Nenhuma linha de código de sombra
foi escrita.

E o poente vai para o **lado**, não para trás da rampa. Pôr o Sol em +Z daria a
imagem bonita da horda saindo do sol — e contra a luz o defensor não distingue
um esqueleto de um ogro a sessenta metros. De lado, a mesma sombra comprida
atravessa a rampa e torna cada silhueta mais legível, não menos.

---

## 5. O trabuco

É o que faz este modo não ser "modo zumbi com muro". Merece o cuidado que o
Kamehameha teve (`plano-kamehameha.md`), e pela mesma razão: uma arma nova muda
o equilíbrio inteiro, e uma arma nova mal medida arruína o modo em que ela mora.

### 5.1 Três, e onde ficam

Um em cada torre, um sobre o portão. Três engenhos e (tipicamente) até quatro
jogadores: **nunca há trabuco para todo mundo**, e é isso que faz "quem vai
para o trabuco" ser uma decisão em vez de um estado.

### 5.2 Como se atira, e por que assim

O arco é mira livre; o trabuco **não pode ser**, senão ele é um arco que causa
mais dano e o arco morre. Um trabuco de verdade tem ângulo de solta fixo e
alcance dado pelo contrapeso, e essa restrição é exatamente a que interessa:

* **Azimute** — o jogador gira a armação com o mouse, dentro de um arco de ±40°.
* **Ângulo de solta FIXO em 45°.**
* **Alcance = tensão do contrapeso**, escolhida segurando o botão, como o arco
  já faz. Velocidade de saída de **18 a 33 m/s**.

Ou seja: mirar no trabuco é escolher **onde**, no chão, e não **para onde**, no
ar. É uma habilidade diferente da do arco — antecipação de posição, não de
trajetória — e é por isso que as duas armas convivem.

### 5.3 A pedra, e a conta dela

Pedra de verdade, corpo rígido de verdade, pelas mesmas regras da flecha:

| grandeza | valor | consequência |
|---|---|---|
| massa | 25 kg | |
| raio | 0,14 m (A = 0,0616 m²) | calcário, ~2 200 kg/m³ |
| Cd | 0,47 | esfera |
| v₀ | 18 → 33 m/s | alcance de **33 a 111 m** no plano |
| altura de saída | +12 m | ~8 % de alcance a mais que o plano |

A desaceleração por arrasto a 33 m/s é **0,77 m/s²** — 8 % de g. Quer dizer: a
pedra descreve uma parábola quase limpa, o vento entorta pouco mas entorta, e a
diferença em relação à flecha (que perde ~20 % da velocidade em 100 m) é
sentida, não explicada. Nada disso precisa de código novo: é a mesma integração
com a mesma fórmula de arrasto que `entities/arrow.js` já roda.

**A consequência que decide o desenho do modo:** com 45° fixos, o alcance MÍNIMO
é 33 m. **O trabuco não consegue atingir o pé do próprio muro.** Ele é a arma da
aproximação; o arco é a arma do portão. Um não substitui o outro em nenhuma
distância, e é isso que impede o modo de virar "todo mundo no trabuco".

Ao cair, a pedra estoura: dano de área em raio de 3,5 m e **piche em chamas por
8 s num raio de 6 m**, que queima quem atravessa e **impede o esqueleto de se
remontar**. É a resposta ao volume — e a única que existe, porque flecha não
resolve trinta esqueletos.

E ela machuca o que for seu: um tiro curto acerta o próprio portão e tira vida
dele. Não é punição arbitrária — com mínimo de 33 m, acertar o próprio portão
exige errar feio, de propósito, para trás. O projeto inteiro é feito de não
mentir sobre física; abrir exceção para a pedra amiga seria a primeira.

### 5.4 Quem é a autoridade sobre a pedra

**Quem atira**, como na flecha. O cabeçalho de `flagSim.js` já formulou a regra
que decide isto: *"a flecha é um evento de UM jogador, a bandeira é o estado
compartilhado da partida"*. A pedra é um evento de um jogador — ele simula, ele
reporta o impacto, e a sala decide quem morreu no estouro (porque isso é
placar).

Custo de rede: **zero por frame**. Vai um `C2S.TREB_SHOT` com origem, direção e
tensão, e os outros clientes replantam a parábola localmente — exatamente o que
`net/remoteArrows.js` já faz. Replicar a pedra a 10 Hz seria mais tráfego e
menos preciso.

### 5.6 O modo de mira — e por que ele precisou existir

> **Acrescentado depois do segundo playtest**, cujo veredito foi: *"não dá para
> saber onde a bola vai"*. Estava certo, e o motivo é estrutural.

A primeira versão era o arco outra vez: gire o corpo, segure para tensionar,
solte para atirar. No arco isso funciona porque **o retículo está sobre o alvo**
e a queda é a habilidade. No trabuco não havia nada disso: a tensão é um número
invisível, a pedra sai por cima do ombro, o alvo está cinquenta metros abaixo e
o resultado só aparece três segundos depois. Não havia o que aprender — havia o
que adivinhar.

Agora o engenho tem **modo de mira**:

* a câmera sobe e mostra o castelo e a rampa de cima;
* uma **marca** no chão diz onde a pedra cai, com o arco desenhado até ela;
* o mouse arrasta a marca dentro do que o engenho alcança;
* o clique solta. `F` desiste.

**O raio da marca é o raio do estouro** — o jogador vê, antes de soltar, quanta
gente cabe dentro dele. E ela fica vermelha quando o engenho ainda está içando:
continua dizendo onde cairia, e a cor diz que ainda não cai.

Nada disso é assistência de mira. A marca é o resultado de **integrar o voo**
com o mesmo arrasto que a pedra vai sofrer (`voar`), e a velocidade sai da busca
binária inversa (`velocidadePara`). Fórmula fechada não serviria: `v²/g` ignora o
ar, e a 110 m o erro é de 4,5 m — mais que o raio do estouro. A marca mentiria
justamente onde é mais usada.

O que a tela mostra é o que vai acontecer, o que é o **oposto** de facilitar:
agora errar é escolha.

### 5.5 O contrapeso, que é o custo

Depois do tiro, o trabuco está descarregado. Ele se iça sozinho em **14 s**, ou
em **4,5 s** com alguém na manivela. Quem está na manivela **não está atirando**.

É a mesma troca que o aríete tinha na versão anterior deste plano, invertida de
lado: a decisão central do modo continua sendo *quem sai da linha de tiro*, e
agora ela existe três vezes por minuto em vez de uma vez por partida.

---

## 6. Os sitiantes

### 6.5 Oito corpos, oito marchas

> **Acrescentado depois do primeiro playtest**, cujo veredito foi direto: *"me
> pareceu que são iguais, só muda a cor"*. Estava certo — a primeira versão
> montava o mesmo boneco oito vezes e trocava a tinta.

O que distingue um inimigo do outro a sessenta metros não é a cor: é a
**silhueta** e a **marcha**. O olho lê movimento antes de forma e forma antes de
cor, e a implementação segue essa ordem:

| espécie | silhueta | marcha |
|---|---|---|
| soldado | elmo de aba, sobreveste, escudo redondo, lança | passada firme, braço contrário à perna |
| pavês | **um retângulo com pernas** — o escudo tapa o corpo | passo curto e arrastado, quase sem oscilar |
| esqueleto | **vazado**: costelas com ar entre elas, crânio com maxilar | passada larga e solta, tronco jogando junto |
| escalador | braços **mais longos que as pernas**, corcova, garras | quatro apoios; no muro, vertical |
| mastim | **horizontal** — o único que se identifica pela orientação | galope, patas em dois pares, lombo subindo |
| xamã | manto até o chão (não tem pernas) e o **cajado**, a única vertical alta da horda | desliza; o manto balança, nada mais |
| ogro | **largo antes de alto**: ombros no dobro do quadril, clava | lento, pesado, pendendo de um lado ao outro |
| catapulta | máquina: quadro, viga, contrapeso, rodas | **parada** — a única silhueta imóvel da rampa |

Os olhos continuam emissivos e ganharam posição por anatomia: os do mastim são
baixos e à frente, os da catapulta são um braseiro único, os do esqueleto ficam
fundos. A 80 m o corpo some na névoa e sobram eles — é por eles que se conta
quantos vêm e de que tipo.

O orçamento não mudou: continua uma fusão por material por espécie, feita uma
vez e compartilhada por todos os indivíduos daquela espécie.

### 6.1 A tabela

Vida em flechas de corpo (a flecha de cabeça vale 2, como no zumbi).

| espécie | flechas | m/s | dano/golpe no portão | intervalo | o que ela faz de diferente |
|---|---|---|---|---|---|
| soldado | 2 | 1,15 | 8 | 1,6 s | o padrão; a régua de todo o resto |
| soldado com pavês | 3 | 1,0 | 8 | 1,6 s | escudo frontal para flecha (§6.4) |
| esqueleto | 1 | 2,4 | 5 | 1,2 s | remonta 1× em 4 s se não queimar |
| escalador | 2 | 2,0 | — | 1,2 s | sobe o muro em 6 s; ataca o jogador |
| mastim | 1 | 6,7 | 4 | 1,0 s | chega 60 s antes do resto e quebra o ritmo |
| xamã | 3 | 0,9 | — | 3,4 s | para a 70 m; remonta esqueletos a 12 m dele |
| ogro | **16** | 0,9 | **45** | 3,2 s | escala 3,4. Os 22 acertos do plano davam ~1 000 de dano por ogro — sozinho ele decidia a partida |
| catapulta | 14 | parada | — | 9 s | a 110 m, atira no adarve |

### 6.2 O alvo padrão é o portão

`pickTarget()` inverte: o alvo é o portão, e o jogador só entra na conta de quem
alcança o adarve (escalador) ou atira (xamã, catapulta). Um jogador no pátio
volta a ser alvo de todo mundo que já entrou — o que só acontece se o portão
tiver caído, e aí a partida acabou.

### 6.3 A fila no portão

Cabem **6 atacantes** de frente no portão de 6 m. O sétimo espera. Isso importa
por dois motivos: põe um **teto no dano por segundo** (6 × 5 = 30/s de soldado),
o que impede a morte instantânea por acúmulo; e produz o aglomerado parado que é
o alvo natural do trabuco — se ele existir, o trabuco tem para onde atirar.

Com o teto de 30/s e **4 400** de vida, um portão sem defesa nenhuma cai em
**2 min 27 s**.

Os 1 200 do plano vinham da âncora "ignorá-lo por 40 s perde a partida", que é
uma boa âncora de pânico e ignora a conta do PRAZO: numa partida de vinte
minutos, mesmo uma defesa que segura a fila em ~1,5 deixa passar ~4 000 de dano.
Com 1 200, o modo não era difícil — era impossível, e o banco de provas mediu
0 % de vitórias em toda configuração. Ver o cabeçalho.

### 6.4 A cobertura que não existe — e por quê

> **Corrigido depois de medir.** O plano prometia que o parapeito seria
> cobertura de graça, pela mesma chamada `bloqueado()` que o bot já usa. Medido
> contra a lista real, ele falhava dos DOIS lados ao mesmo tempo.

As duas exigências são a **mesma altura**:

* para o defensor atirar por cima, o topo da pedra tem de ficar **abaixo** de
  1,42 m (onde a corda solta);
* para o defensor se abrigar atrás, tem de ficar **acima** de ~1,2 m (o peito de
  quem está de pé).

Não há pedra que resolva as duas. Insistir produzia o pior dos dois mundos:
medido, um parapeito alto o bastante para cobrir engolia toda a faixa de 12 a
29 m do campo de tiro — justamente onde a fila se forma —, e mesmo assim o raio
do xamã a 68 m atingia peito e cabeça de quem estava de pé. Cobrir de verdade
exigiria agachar, e o jogo não tem agachar.

Então: **o parapeito é peitoril e silhueta, não obstáculo.** Ele tem colisor só
no cliente (impede o pé de sair do muro) e não entra em `castleBlockers()`. A
resposta ao xamã não é se esconder — é matá-lo, que é o que faz dele um alvo de
valor em vez de um incômodo.

O que CONTINUA saindo de graça é a cobertura de verdade: a torre, o lintel do
portão e a menagem barram tiro, pela mesma chamada `bloqueado()` que
`botSim.js` já fazia. As caixas do §3.3 seguem sendo o sistema de cobertura —
só que as que cobrem são as que têm três metros de pedra, não as de noventa
centímetros.

O escudo do pavês é o mesmo teste com uma caixa que anda junto do soldado: ele
para a flecha que vem **de frente** e não a que vem **de cima**. Um arqueiro a
12 m de altura, a 20 m de distância, atira num ângulo de 31° — passa por cima do
escudo. A 60 m o ângulo é 11° — não passa. **A altura vira uma vantagem que se
usa, com alcance ótimo e tudo**, em vez de um bônus passivo.

---

## 7. O portão, o reparo e a morte

### 7.1 Reparar é sair da muralha

1 200 de vida. Do lado de dentro, segurando **F** junto às vigas: **+12/s**, até
o teto de **80 %** — portão remendado nunca volta a ser novo.

Os números dizem uma frase: **o reparo vence dois soldados e perde para três.**
É um remendo, nunca uma solução, e a solução continua sendo matar antes de
chegar. Se o reparo fechasse a conta sozinho, o modo teria uma dominante — um
jogador de plantão no portão para sempre — e dominante é o que mata modo.

Estados visíveis: inteiro → tábuas soltas → rachado com fresta (dá para atirar
por ela, dos dois lados) → cai. Os estilhaços saem de `shared/fragments.js`, com
a mesma conta nos dois lados.

**O portão tem que ser audível.** Cada golpe é um baque grave que atravessa a
mistura, e a frequência dos baques é a leitura da fila. O jogador precisa saber
que a coisa está desandando **sem tirar os olhos da mira** — e som é o único
canal que faz isso.

### 7.2 Morrer custa vazão, não a partida

Renasce na torre de menagem em **8 s**, e sobe a escada em **3,5 s**. Onze
segundos e meio sem um arco no muro, numa maré em que chega um inimigo por
segundo, são ~11 inimigos que ninguém parou. **É esse o preço, e ele é
suficiente** — matar o jogador de vez seria transformar a derrota coletiva numa
eliminação individual, que é o modo zumbi, que já existe.

Quem ENTRA no meio de um cerco é outro caminho, e ele precisou existir: o
alinhamento do §7.2 só roda na troca de modo, e sem `Room.postoLivreNoAdarve`
o retardatário caía no sorteio comum e nascia no pátio, oito metros abaixo do
jogo, sem nada explicando por quê.

---

## 8. O HUD

O modo se perde por uma taxa, e taxa é a coisa que HUD costuma esconder.

* **Integridade do portão** — barra grossa embaixo, no centro. Muda de cor e
  **pulsa no ritmo dos golpes**, não no ritmo do relógio.
* **A fila** — um número pequeno ao lado: quantos estão batendo no portão AGORA.
  É a única variável que o jogador consegue controlar diretamente, e sem
  mostrá-la o jogo pede que ele adivinhe o que otimizar.
* **Relógio até o pôr do sol** — e ele é o menos importante dos quatro, porque
  o Sol na janela já diz a mesma coisa (§4.5).
* **Os três trabucos** — carregado / içando (com a fração) / disponível, sempre
  visíveis, senão ninguém desce da mira para checar.
* **Faixa de escalão** — o que reaparece da mecânica de onda, e só ela.

Nenhum contador de abates no lugar de destaque. Ele vai para a tela de fim, com
o que realmente importa: **quanto tempo o portão passou abaixo de 30 %**.

---

## 9. Rede e desempenho — o risco de verdade

O pedido é "grande número". O teto atual é `maxAlive: 48` / `maxEntities: 64`
(`CONFIG.modes.zombie`), e ele não foi escolhido por acaso.

**Três gargalos, em ordem de gravidade:**

**1. Tráfego.** `ZombieNight.view()` emite JSON — `{id, p:[x,y,z], y, s, b, d, k}`
dá ~80 B por bicho. A 10 Hz, com 120 vivos e 4 clientes: **380 KB/s de subida**.
Não vai. E `wsAdapter.js` faz `data.toString()` no recebimento: o transporte
hoje é texto puro dos dois lados.

*Solução:* um quadro **binário** só para este modo — id (2 B), x/y/z como int16
a 1,2 cm (6 B), yaw em uint8 (1 B), espécie+estado+flags (1 B) = **10 B por
bicho**. 120 vivos = 1,2 KB por quadro, 12 KB/s por cliente. Cabe com folga.
Custo: mexer no adaptador e no cliente para aceitar `ArrayBuffer`, o que é
pequeno mas é infraestrutura — e por isso está na **etapa 3** do §11, não na 1.

**2. Malha.** `entities/zombie.js` são 874 linhas de corpo articulado. Cento e
vinte deles não desenham.

*Solução:* três faixas de LOD, com a lição do `plano-lua-desempenho.md`. E aqui
o cenário faz um presente: **o jogador está 12 m acima e a horda está a 20–90 m**,
então a faixa próxima está quase sempre vazia por construção. O orçamento fecha
por causa da geometria da fase, não apesar dela.

| faixa | quantos, tipicamente | o que se desenha |
|---|---|---|
| < 25 m | 0–8 (escaladores, fila do portão) | corpo articulado atual |
| 25–60 m | ~30 | corpo simplificado, 1 malha, sem dedo nem dobra |
| > 60 m | ~80 | `InstancedMesh`, silhueta e cor |

**3. CPU do servidor.** 120 bichos com separação entre vizinhos a 10 Hz. A grade
`NPC_GRID_CELL` do `zombieSim.js` já existe e é o que torna isso O(n) — mas ela
nunca viu 120. Medir antes de acreditar.

---

## 10. Bots

`botSim.js` já mira, corrige elevação e solta a corda. Um bot parado num ponto
do adarve, atirando no inimigo mais próximo do portão, é um **arqueiro de
muralha** sem código de comportamento novo — só um alvo diferente e a posição
travada.

Isso importa mais aqui do que nos outros modos: o cerco com um jogador só é uma
pessoa cobrindo 34 m de muro, e a curva de pressão do §4.1 escala por `N`.

**Eles são convite, não requisito.** O modo entrava criando dois bots à força, e
a razão era a curva mal escalada que o §4.1 descreve — sem eles, o solitário
perdia 40 de 40 partidas. Corrigida a escala, o cerco entra vazio e os bots
voltam a ser o que a tecla `B` é em todo outro modo: uma escolha de quem joga. O
sitiante não distingue um arco de CPU de um arco humano, então chamar um bot e
receber um jogador valem a mesma coisa para o portão — e as duas coisas são
contadas a cada passo (`Room.tickSiege`), não congeladas no começo da partida.

O quarteto continua sendo melhor que o solo, porque bot não vai à manivela nem
repara portão.

---

## 11. Etapas

Cada uma termina jogável. Nenhuma delas é "a infraestrutura da próxima".

| # | entrega | estado |
|---|---|---|
| **1** | fase Castelo: `castleField`, `castleProps`, `castleGround`, `castle`, `gate`, `castleLevel`, entrada em `LEVEL_INFO` com `modos: ["free","duel","siege"]` | ✅ |
| **2** | modo Cerco: `server/siegeSim.js`, protocolo, wiring em `room.js`, `systems/siege.js`, `entities/besieger.js` | ✅ |
| **3** | trabuco (`entities/trebuchet.js`), quadro binário (§9.1), três faixas de LOD (§9.2) | ✅ |
| **4** | escalões, maré, reparo, HUD, pôr do sol, `scripts/bench-cerco.js` | ✅ |

**O que ficou de fora, e é honesto dizer:**

* **O som próprio.** O baque do portão usa `arrowHitWood` com o tom baixado e a
  trompa do escalão é a de onda. Funciona e não é o que o §7.1 pede: os tambores
  da maré (§4.3) não existem, e sem eles a maré é sentida só pelo que aparece na
  rampa. É a primeira coisa a fazer depois.
* **A trilha.** O mecanismo de terceira trilha está previsto em `audio.js` e não
  foi ligado — o cerco toca a do dia.
* **A pontaria do arqueiro de CPU em tiro mergulhado.** `elevacaoPara` já se
  declara aproximada, e a aproximação piora com elevação muito negativa: medido,
  o bot acerta ~13 % dos tiros contra a rampa. Ele contribui; não carrega.

A ordem não é negociável em dois pontos: o **§3.3 (footprint) na etapa 1**,
senão a etapa 2 é depurada contra uma horda que atravessa parede; e o **binário
antes dos escalões**, senão a etapa 4 é ajustada em cima de um jogo que engasga
por rede e o ajuste vai medir a coisa errada.

---

## 12. `scripts/bench-cerco.js`

O modelo do `bench-meteoros.js`, adaptado ao que este modo pergunta. Roda a sala
sem cliente, com um arqueiro sintético de taxa de acerto e cadência conhecidas.

**O que ele tem que responder:**

1. **Sobrevive-se?** Alvo: **75 %** de partidas vencidas com o arqueiro médio
   (78 % de acerto, ~2 s de ciclo), solo e com dois bots. Abaixo de 60 %, a
   curva do §4.1 está errada; acima de 90 %, também.
2. **Onde se perde?** A derrota tem que se concentrar depois do minuto 12. Uma
   derrota no minuto 4 é bug de curva, não dificuldade.
3. **A fila fecha?** Registrar `fila(t)` e a integral dela. Se a fila nunca passa
   de 2, o portão é decoração; se passa de 6 antes do minuto 8, o teto do §6.3
   está frouxo.
4. **O trabuco vale a pena?** Simular com e sem. Se a taxa de vitória mudar menos
   de 15 pontos, ele é enfeite caro — e aí ou o dano de área sobe, ou o volume
   de esqueletos sobe até ele ser obrigatório.
5. **O reparo vale a pena?** Mesma pergunta, sinal invertido: se reparar sozinho
   segurar o portão sem ninguém atirando, ele é dominante e o `+12/s` cai.

O que o banco NÃO mede: se é divertido, se a maré é sentida, se dá para ouvir o
portão. Isso é playtest, e o playtest é o juiz final — como sempre foi.
