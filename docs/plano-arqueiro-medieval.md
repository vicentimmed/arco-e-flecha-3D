# Plano — O Arqueiro Medieval, do zero e para valer

> **Estado: IMPLEMENTADO.** O conteúdo de `entities/skins/medieval.js` foi
> reescrito do zero e o rig ganhou o nível de detalhe do corpo.
>
> ## O que foi medido no fim
>
> | critério | alvo | atleta | ranger |
> | --- | --- | ---: | ---: |
> | amplitude de valor | ≥ 40× | 42× | **52×** ✓ |
> | peças na faixa média | ≤ 2 | 1 / 13 | **1 / 12** ✓ |
> | âncora clara | ≥ 0,60 | 0,82 | **0,74** ✓ |
> | malhas — perto | ≤ 220 | 84 | **119** ✓ |
> | malhas — médio | ≤ 100 | 74 | **88** ✓ |
> | malhas — longe | ≤ 50 | 54 | **52** ✗ |
>
> A régua está calibrada: rodada na arqueira ela devolve os mesmos 42× que a
> análise à mão previa. O nível LONGE ficou 2 malhas acima do teto — o arco
> sozinho são 14 delas, e cortá-lo não é opção.
>
> **A sala de doze, que é onde a conta importa:**
>
> ```
>   antes   1 × 99  + 11 × 89                 = 1 078 malhas
>   agora   1 × 119 +  2 × 88  +  9 × 52      =   763 malhas   (−29 %)
> ```
>
> **A cabeça perdeu dois apêndices, a pedido e por medição.** O RABICHO do capuz
> (o liripipe) saiu porque lia como pingente em vez de roupa e roubava a leitura
> da forma do capuz — `sway: null` é um valor previsto pelo contrato, e o rig sai
> de `updateSway` na primeira linha. A PONTA do capuz saiu junto por outro
> motivo: medida contra a casca, ela emergia um centímetro, ou seja, era malha
> invisível pagando desenho e passe de sombra. O capuz virou uma abóbada lisa.
>
> Um corpo com anatomia torneada, mão de duas falanges e roupa em camadas saiu
> **mais barato** que o boneco de tubos — porque o que mudou não foi a
> quantidade de detalhe, foi ONDE ele é pago. A arqueira ganhou os mesmos três
> níveis de graça e caiu de 1 078 para 718 numa sala só dela.
>
> Verificado ainda: nenhum nível abre buraco (conferido forçando os três de
> perto), primeira pessoa a 40 cm, ragdoll, marcha, corrida, recarga, troca de
> skin ao vivo e a rede (o `WELCOME` traz `skin: "medieval"`).
>
> **O que continua em aberto:** os dedos não se fecham em volta do arco — a mão
> é um grupo rígido orientado pelo antebraço, e curvá-los exigiria pose de dedo
> no rig. É o próximo item se o realismo da primeira pessoa for esticado.
>
> ---
>
> Substitui o conteúdo de `entities/skins/medieval.js`, que saiu inteiro, e
> acrescenta ao rig um sistema de NÍVEL DE DETALHE do corpo — sem ele,
> "realista" e "doze jogadores na sala" não cabem juntos.
>
> **Escopo:** um segundo personagem, ranger encapuzado, construído do zero.
> Movimento, física, mira, câmera, colisor e rede continuam idênticos aos da
> arqueira.
>
> **A meta, em uma frase mensurável:** um corpo que **aguenta ser olhado a um
> metro** — que é a distância da mão do arco em primeira pessoa — e que continua
> legível a quarenta. Hoje nenhum dos dois arqueiros aguenta o primeiro teste.

---

## 0. O que "realista" pode significar aqui — e o que não pode

Preciso ser direto sobre isto antes de gastar o seu tempo, porque a palavra
carrega duas leituras muito diferentes.

**O que este jogo é.** Cada corpo dele — arqueira, lobo, zumbi, javali, alce,
pássaro — é feito de primitivas geradas em código. Não há nenhum carregador de
modelo no projeto (`GLTFLoader`, `FBXLoader`: zero ocorrências), nenhuma textura
de personagem, nenhum arquivo de malha. O único asset de imagem é a Terra do céu
da Lua. O mundo é low-poly de propósito: serra facetada, árvore de duas peças,
grama de tiras.

**Por isso, "realista" não pode querer dizer fotorrealista.** Um homem
fotorrealista em pé naquele vale chapado não leria como capricho — leria como
erro. E, tecnicamente, ele exigiria um modelo com esqueleto e skinning
importado, o que substituiria a IK de dois ossos que resolve a pose em qualquer
ângulo de mira. Ou seja: quebraria justamente **"os mesmos movimentos"**, que é
a única coisa que você pediu para preservar nas três vezes.

**O que "realista" PODE querer dizer, e é muito:** anatomia em vez de cápsulas
empilhadas, roupa em camadas com espessura e borda, assimetria, caimento de
pano, materiais que se distinguem, e detalhe alto onde a câmera chega perto. A
distância entre o que existe hoje e esse alvo é grande — o corpo atual é um
boneco de tubos, e este plano é sobre atravessar essa distância inteira.

> **Se você quis dizer modelo importado mesmo** — malha esculpida, textura PBR,
> normal map —, é outro projeto e eu não o escondo: precisaria de um `.glb`
> riggado (que eu não sei autorar, só integrar), de trocar a IK por animação de
> esqueleto, de refazer ragdoll, primeira pessoa e o LOD, e o resultado
> destoaria do cenário. Diga e eu escrevo esse plano; ele só não é este.

---

## 1. O que falhou na v1 — medido, e continua valendo

Realismo não cancela este item: um personagem detalhadíssimo que vira um borrão
marrom a quarenta metros continua sendo um fracasso.

Luminância relativa de cada material:

```
ATLETA (funciona)                      MEDIEVAL v1 (falhou)
  faixa      0.851  ███████████████      pele        0.412  ███████
  tênis      0.820  ██████████████       linho       0.364  ██████
  pele       0.474  ████████             madeira     0.161  ███
  camiseta   0.150  ███                  túnica      0.150  ███
  bermuda    0.089  ██                   bota        0.106  ██
  couro      0.075  █                    couro       0.075  █
  cabelo     0.020  ▌                    luva        0.065  █
                                         calças      0.064  █
  amplitude 43×                          lã/capuz    0.059  █
  faixa média: 4 de 8                    cabelo      0.026  ▌
                                         couro-esc   0.024  ▌
                                         amplitude 17× · faixa média: 7 de 11
```

**Sete das onze peças estão na mesma faixa.** Túnica, calças, luva, lã, couro e
bota são, para o olho a quarenta metros, a mesma cor — daí a coluna marrom.
E não há âncora clara: o ponto mais claro da v1 é a pele (0,41), escondida dentro
de um capuz.

E o erro de origem: **eu vesti a arqueira em vez de construir um homem.** Mesmas
proporções, mesmos raios de membro, adereços por cima.

---

## 2. Os cinco sinais de "boneco", e a morte de cada um

Isto é o coração do plano. Um corpo procedural não parece de brinquedo por ter
poucos polígonos — parece por estes cinco motivos, e cada um tem conserto barato.

### 2.1 Simetria perfeita

Nada no mundo real é simétrico, e o cérebro sabe. A v1 era espelhada em tudo:
dois braceletes iguais, duas ombreiras iguais, tudo centrado.

**Conserto — a lista de assimetrias, explícita e obrigatória:**

| lado direito | lado esquerdo |
| --- | --- |
| aljava nas costas, inclinada 0,52 rad | adaga curta no quadril |
| escarcela (bolsa) no cinto | ponta do cinto pendurada |
| — | bracelete de couro (o braço do arco) |
| bandoleira cruzando por cima do ombro | — |
| rabicho do capuz caindo deste lado | — |

O rabicho caindo de um lado só faz mais pela leitura de "pessoa" que qualquer
peça simétrica que se acrescente.

### 2.2 Membros de raio constante

Um cilindro de raio fixo lê como cano. Um membro real tem **massa muscular no
meio e osso nas pontas**.

**Conserto:** cada membro ganha uma peça de massa por cima do segmento —
o segmento continua sendo o que a IK orienta, a massa é filha dele e não muda
nada da pose. (Atenção: `orientSegment` escreve `scale.y = comprimento do osso`,
então uma peça filha herda essa escala — a massa precisa ser desenhada em espaço
unitário, o que é justamente o que a torna barata: uma cápsula achatada em
`y = 0,45` do segmento.)

- braço: deltoide sobre o ombro, bíceps no terço superior, antebraço afinando
- perna: quadríceps na frente da coxa, panturrilha ATRÁS da canela, tornozelo fino

### 2.3 Roupa pintada no corpo

Na v1, "vestir" era trocar a cor do segmento. Roupa sem espessura não é roupa: é
tinta. O olho lê camada pela BORDA dela.

**Conserto — toda peça de roupa termina numa borda visível:**

| camada | a borda que a denuncia |
| --- | --- |
| túnica | gola no pescoço, barra na coxa, punho na manga |
| capuz | aba grossa em volta do vão do rosto |
| manto | anel na barra, 1,5 cm mais largo que o cone |
| bota | volta do cano, dobrada para fora |
| bracelete | duas tiras e uma fivela, não um cilindro liso |

Regra: **a borda é sempre 1 a 2 cm mais larga que a peça que ela termina**, e
mais escura. É esse degrau que o olho lê como espessura de pano.

### 2.4 Uma forma primária por região do corpo

O tronco da v1 era **um cilindro**. Nenhum tronco humano é um cilindro.

**Conserto — o tronco vira três formas com seções diferentes:**

- **caixa torácica**: larga no peito, achatada na frente-atrás (escala z 0,68),
  afinando para baixo
- **abdome**: mais estreito, seção mais redonda (escala z 0,80)
- **pelve**: alargando de novo, achatada (escala z 0,72)

Três formas empilhadas com seções diferentes dão a curva de um torso. Uma dá um
barril. Custa duas malhas.

Some-se a isso o **trapézio**: uma cunha que desce do pescoço até o ombro. É a
peça que mais faz um corpo parecer humano em vez de manequim — sem ela, o
pescoço sai do tronco em ângulo reto.

### 2.5 Facetas, e a ausência de vinco

Os segmentos do corpo têm 10 a 12 lados. A um metro do olho isso é um prisma.

**Conserto, e é o mais barato de todos: subir para 20–24 lados nas formas
estruturais.** Faceta custa VÉRTICE, não chamada de desenho — a placa de vídeo
não sente a diferença, e é a única melhoria deste plano que é literalmente de
graça.

E o sombreado de contato: `utils/geometry.js` já assa gradiente e AO de junta em
cor de vértice. O mesmo truque, aplicado onde uma camada encontra a outra
(embaixo da gola, sob a barra do manto, dentro do vão do capuz), dá a sombra que
faz a camada ter profundidade — de graça, sem luz nova.

---

## 3. Anatomia — os números

Osso congelado (alturas de junta, comprimentos, `stanceYaw`, `armReach`, âncora
da corda): câmera, colisor e rede dependem deles. Carne livre.

| | arqueira | ranger | por quê |
| --- | ---: | ---: | --- |
| peito → cintura | 0,152 → 0,128 | **0,178 → 0,110** | V de 1,62 contra 1,19 |
| escala z do peito | 0,66 | **0,68** | caixa torácica achatada |
| escala z do abdome | — | **0,80** | seção mais redonda: é o que diferencia |
| ombro (junta) | 0,062 | **0,076** | ombro que existe na silhueta |
| braço → antebraço | 0,057 → 0,047 | **0,068 → 0,044** | afunilamento 1,55× contra 1,21× |
| coxa → canela | 0,092 → 0,068 | **0,104 → 0,058** | 1,79× contra 1,35× |
| pescoço | 0,043 | **0,055** | pescoço curto e grosso |
| crânio (escala) | 0,94/1,06/1,00 | **1,00/0,97/1,03** | mandíbula quadrada |
| lados dos segmentos | 10–12 | **20–24** | ver §2.5 |

**A cintura é o que quebra a coluna.** A v1 tinha manto 0,203 sobre cinto 0,152
— 1,33:1, quase nada. O ranger: manto **0,245** sobre cinto **0,110**, que é
**2,23:1**.

### As mãos, onde o realismo mais rende

Em primeira pessoa a mão do arco fica a meio metro do olho — é o pedaço do corpo
mais visto do jogo inteiro, e hoje são cinco caixas. Nível de perto:

- palma com dorso e base do polegar (2 formas, não 1)
- dedos em **duas falanges** com nó entre elas, dobrados progressivamente
- polegar em 2 peças, oposto de verdade
- nós dos dedos como uma fileira de calotas
- costura da luva no dorso

São ~14 malhas por mão que só existem abaixo de 12 m — e são as que decidem se a
primeira pessoa parece um jogo cuidado ou um protótipo.

---

## 4. O caimento do pano

Pano parado não é pano: é chapa. Três lugares, todos com peças estáticas (nada
de simulação, que é caro e não é o que falta aqui):

- **barra da túnica:** 5 painéis finos e levemente angulados em volta da coxa,
  em vez de um cilindro liso. As diferenças de ângulo produzem sombras
  verticais irregulares — é isso que o olho lê como tecido.
- **manga:** um vinco na dobra do cotovelo (uma cunha achatada, filha do
  antebraço).
- **manto:** a barra ondula — cada um dos 20 lados do cone alterna 8 mm de raio.
  Custa zero malhas, é um laço na geração da geometria.

---

## 5. Valor — o critério de aceitação do §1

A paleta, já medida contra a regra de alternância (o corpo lido de cima para
baixo tem de inverter o valor a cada faixa):

```
  capuz         #232a20   0.021  escuro
  rosto         #e0a97e   0.457  CLARO        salto 20.6×
  manto         #1e241c   0.016  escuro       salto 27.2×
  túnica (cor)  do jogador 0.15  médio        salto  8.3×
  mangas        #e8dfc4   0.739  BRILHANTE    salto  3.9×
  cinto         #2a1d12   0.014  escuro       salto 51.3×
  calças        #c2b393   0.458  CLARO        salto 31.4×
  botas         #241a12   0.012  escuro       salto 38.6×

  amplitude 64× (arqueira: 43×) · 1 peça na faixa média (arqueira: 4)
```

A âncora brilhante são as **mangas**: os braços se mexem sempre e ficam
recortados contra o fundo em qualquer pose de tiro — é o equivalente funcional
dos tênis brancos dela. E a cor do jogador fica **só na túnica**, cercada por
escuro em cima e brilhante embaixo; é assim que uma cor média continua sendo
lida como cor. A v1 espalhou a cor por túnica, calças, bota e bracelete, e
apagou as quatro.

**O rosto é uma mancha CLARA dentro do escuro.** Três regras que vêm disso e não
são estéticas:

- a barba não passa da linha da boca (na v1 ela tomava a bochecha, e bochecha
  escura dentro de capuz escuro apaga o rosto);
- nada de franja — a testa que aparece no vão é PELE, e é ela que brilha;
- o vão do capuz é largo o bastante para o rosto ser visível a 10 m.

---

## 6. O LOD do corpo — é ele que paga por tudo isto

**Sem esta seção, o resto do plano é irresponsável.** Hoje existe um único corte
de detalhe: o rosto, a 12 m, e só para jogadores remotos
(`net/remotePlayers.js`). Fora isso, **todo arqueiro desenha ~90 malhas a
qualquer distância até 160 m**.

Proposta: `setFaceDetail(bool)` vira `setDetailLevel(distância)`, com três
níveis que a skin declara.

| nível | quando | o que desenha | malhas |
| --- | --- | --- | ---: |
| **perto** | ≤ 12 m, e sempre o jogador local | tudo: rosto, dedos em duas falanges, costuras, fivelas, vincos | ~210 |
| **médio** | 12 – 40 m | corpo, roupa em camadas, massas musculares, bordas | ~95 |
| **longe** | > 40 m | formas estruturais e silhueta | ~45 |

**A regra que torna isso seguro: nenhuma peça de detalhe pode ser estrutural.**
Cada peça que some, some POR CIMA de uma forma que continua ali — o deltoide
some sobre o braço, a gola some sobre a túnica, o nó do dedo some sobre o dedo.
Nunca aparece um buraco, e a silhueta do §2 sobrevive aos três níveis.

### A conta, e ela é a boa notícia

Sala de doze, distribuição típica (um local, dois por perto, nove espalhados):

```
  hoje    1 × 99  +  11 × 89                        = 1 078 malhas
  novo    1 × 210 +   2 × 95  +  9 × 45             =   805 malhas
```

**O arqueiro realista com LOD é ~25 % mais barato que o boneco de tubos de
hoje** — e é vinte vezes mais detalhado no único lugar onde você o vê de perto.
Este é o argumento central do plano: realismo aqui não é gastar mais, é gastar
onde se vê.

O LOD entra no rig e serve às DUAS skins: a arqueira ganha os mesmos três níveis
de graça, e a sala inteira fica mais barata que hoje mesmo sem ninguém escolher
o ranger.

---

## 7. As ferramentas de verificação

Faltaram no plano anterior, e é por isso que a v1 passou. Eu julguei em cor, de
perto, uma figura de cada vez — as três condições em que o defeito é invisível.

Na bancada (`dev/skins.html`):

1. **Chave do CINZA** — `filter: grayscale(1)` no canvas. Uma linha de CSS. Em
   cinza a v1 é uma mancha só. **Toda decisão de cor passa por aqui antes de
   valer.**
2. **Chave da SILHUETA CHAPADA** — corpo todo preto sem luz, contra o céu.
   Responde à pergunta dos quarenta metros: *a forma se lê?*
3. **Régua de valor** — imprime a tabela do §5 a partir dos materiais VIVOS:
   amplitude, menor salto entre vizinhas, peças na faixa média.
4. **Chave dos NÍVEIS** — força perto/médio/longe para conferir que nenhum corte
   abre buraco, e mostra a contagem de cada um.
5. **Câmera de primeira pessoa** — a 40 cm da mão do arco, tensionando. É o teste
   da meta declarada no cabeçalho, e é o que a bancada ainda não faz.

E duas disciplinas: **nunca julgar sozinho** (a arqueira sempre ao lado, mesmo
ângulo, mesma luz) e **julgar a 40 m antes de julgar de perto** — a ordem
inversa foi o que me fez gastar tempo no bigode de um personagem sem silhueta.

---

## 8. Pronto quando

Os quatro primeiros passam ou não passam:

1. **Régua de valor:** amplitude ≥ 40×, menor salto entre vizinhas ≥ 3×, no
   máximo 2 peças na faixa 0,05–0,25.
2. **Cinza a 40 m:** cabeça, tronco, pernas e pés são quatro manchas
   distinguíveis. Na v1 são uma.
3. **Silhueta chapada:** ranger e arqueira não são confundíveis, e a cintura do
   ranger aparece.
4. **Orçamento:** perto ≤ 220, médio ≤ 100, longe ≤ 50; nenhum nível abre buraco.
5. **Primeira pessoa a 40 cm:** a mão tem dedos com nó, a luva tem costura, o
   bracelete não atravessa a manga ao tensionar, nenhuma peça da cabeça na
   câmera.
6. **Ciclo de tiro:** a corda ancora no canto da boca (se a barba a cobre, a
   barba está grande) e a mão da recarga alcança a aljava.
7. **Morrer:** ragdoll três vezes, ângulos diferentes — nada fica para trás,
   nada vira do avesso.

---

## 9. Ordem de execução

| # | passo | por que nesta ordem |
| --- | --- | --- |
| 1 | As cinco ferramentas do §7 | **Antes de desenhar.** Elas são o critério; construí-las depois é escolher o critério que aprova o que já foi feito. |
| 2 | Régua de valor rodando na v1 | Fixa o número de partida e prova que a ferramenta detecta o defeito conhecido. |
| 3 | O LOD do corpo no rig (§6) | Antes da geometria, não depois: é ele que define o orçamento de cada peça nova. Feito agora, a arqueira também ganha e a sala já fica mais barata. |
| 4 | Corpo novo: anatomia do §3, materiais velhos | Isola a variável FORMA. Se a silhueta chapada não melhorar aqui, paleta nenhuma salva. |
| 5 | Paleta do §5 | Isola a variável VALOR. A régua tem de saltar de 17× para ≥ 40×. |
| 6 | Camadas, assimetria e caimento (§2.1, 2.3, 4) | O que transforma "corpo certo" em "personagem". |
| 7 | Nível de perto: mãos, rosto, costuras (§3) | O detalhe caro, por último e só no nível que o comporta. |
| 8 | Testes 5–7 e a conta final | Primeira pessoa, tiro, morte, orçamento. |

Os passos 4 e 5 são separados de propósito. Juntos, se o resultado não
convencesse, não haveria como saber qual dos dois errou — que é exatamente o
buraco em que a v1 caiu.
