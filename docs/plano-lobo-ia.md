# Plano — IA do lobo (comportamento de predador)

Complementa `plano-lobo.md`, que trata do visual. Aqui o assunto é **como o lobo
pensa e se move**. Objetivo: um inimigo difícil e legível, que se comporte como
lobo de verdade — cerco, espera, investida oportunista — em vez de um míssil em
zigue-zague.

Código relevante: `server/zombieSim.js` (classe `Wolf`, linhas ~127–413),
`server/elkWolves.js` (matilha do alce reusa a mesma classe),
`src/entities/wolf.js` (render/animação), `src/config.js` (~650–683).

---

## 1. Por que o comportamento atual parece artificial

| # | Causa no código | Efeito percebido |
|---|---|---|
| 1 | `walkToward()` faz `yaw = atan2(...)` — sem limite de giro | O lobo troca de direção instantaneamente. Nenhum animal de 40 kg a 6 m/s faz isso. É a maior fonte de "robô". |
| 2 | `pickStalkWaypoint()` executa `this.stalkSide = -this.stalkSide` **toda vez** | Zigue-zague estritamente alternado, com métrica de metrônomo. Previsível e mecânico. |
| 3 | Waypoint é refeito ao chegar a 1.6 m dele, com avanço de 3.5–8 m | A ~6 m/s isso é uma manobra nova a cada ~0.8 s → zigue curtíssimo. |
| 4 | `wolfAmbushCommitRange: 7.5` desliga o stalk abaixo de 7.5 m | Justamente o trecho que o jogador vê de perto é uma reta pura. O pior dos dois mundos: longe é serrote, perto é trilho. |
| 5 | Velocidade constante (`baseSpeed`), sem aceleração | Sem trote/disparada/freada. Não existe ritmo nem antecipação. |
| 6 | Zero coordenação: cada lobo roda a mesma lógica isolado | N lobos empilham na mesma linha, zigues fora de fase. Vira ruído visual, não matilha. |
| 7 | `playerPositions()` só entrega `x/y/z/alive/id` | O lobo não sabe para onde o jogador olha nem para onde ele corre. Não tem como parecer esperto. |
| 8 | Salto dispara sempre a 5 m, mirando a posição atual | Determinístico e sem antecipação: dá para desviar sempre do mesmo jeito. |
| 9 | Desvio de obstáculo por varredura de 7 ângulos fixos (`DEFLECTIONS`) | Ao raspar terreno não-caminhável o lobo pula 0.45 rad de uma vez — mais um solavanco. |

Fator agravante: a simulação roda a **10 Hz** (`net.boarHz`) e o cliente amortece
posição/yaw com `k = 14`. Mudanças bruscas de rumo a 10 Hz chegam como
teleportes suavizados — o lobo parece "escorregar" em vez de correr.

---

## 2. Arquitetura proposta

Seis camadas, cada uma independente e testável. A ordem importa: as duas
primeiras resolvem ~70% da sensação de artificialidade sozinhas.

```
WolfPack (coordenador)     ← papéis, vagas no cerco, fichas de ataque
      ↓ atribui
Wolf.brain (FSM)           ← approach / flank / stalk / commit / leap / retreat
      ↓ pede rumo e velocidade desejados
Wolf.locomotion (motor)    ← taxa de giro, aceleração, steering, whiskers
      ↓ posição + yaw + estado
Rede (10 Hz) → cliente     ← animação por estado, inclinação na curva, áudio
```

### Camada A — Locomoção com inércia (o motor)

Separar **querer ir** de **conseguir ir**. O cérebro só produz um vetor de
desejo; o motor decide o que é fisicamente possível.

- **Taxa de giro máxima** em rad/s, decrescente com a velocidade:
  `turnRate = turnRateMax * (1 - 0.6 * v / vMax)`. Trote gira rápido; disparada
  faz curva larga. Consequência direta: o lobo passa a **não conseguir** fazer
  zigue-zague curto em alta velocidade. O problema deixa de ser tunado e passa a
  ser impossível.
- **Aceleração e frenagem** limitadas (`accel`, `brake`). Ganhar velocidade custa
  ~0.5 s; parar também. Isso cria o overshoot natural do predador que erra o bote.
- **Steering por soma de forças** (Reynolds), não por waypoint discreto:
  `seek(alvo) + separation(outros lobos) + avoid(terreno)`. O resultado é um único
  rumo desejado por tick, sempre contínuo.
- **Whiskers** no lugar de `DEFLECTIONS`: três sondas (frente, ±35°) em
  `isWalkable`; a que falha empurra o rumo desejado proporcionalmente, em vez de
  saltar para um ângulo fixo.
- **Separação entre lobos** com raio ~1.8 m: impede o empilhamento atual e, de
  graça, produz o espalhamento em leque que a matilha real tem.

### Camada B — FSM do lobo individual

Substitui `walk / attack / leap` por um ciclo com tensão e alívio:

| Estado | Quando | Movimento | Leitura para o jogador |
|---|---|---|---|
| `approach` | d > ~18 m | Trote a 65% da velocidade, com **bearing offset** de ±15–35° em relação à linha reta, sorteado e mantido por 3–6 s | Vem em curva longa, nunca de frente, nunca serrilhado |
| `flank` | 8–18 m, sem ficha | Órbita tangencial no raio do cerco, corpo virado para o jogador | Está me cercando |
| `stalk` | 4–8 m, sem ficha | Quase parado, agachado, ajustes lentos de posição, rosnado | Está esperando a hora — momento de tensão |
| `commit` | com ficha de ataque | Disparada de 1.5–2.5 s pelo melhor ângulo disponível | Aquele ali vem pra cima |
| `leap` | dentro do alcance, durante `commit` | Como hoje, mas mirando a **posição prevista** do jogador | Bote |
| `retreat` | pós-ataque, ao levar susto, ou ficha revogada | Recua 5–10 m em arco, sem dar as costas de imediato | Errou e vai tentar de novo — dá respiro ao jogador |

O `bearing offset` do `approach` é a peça que substitui o zigue-zague: em vez de
alternar lado a cada segundo, o lobo escolhe **um** lado e sustenta a curva.
Duas ou três correções em 40 m, não quarenta.

### Camada C — Coordenador da matilha (`WolfPack`)

É aqui que nasce a inteligência percebida. Um objeto por matilha, tickado antes
dos lobos.

- **Vagas no cerco**: distribui ângulos igualmente ao redor do alvo e atribui cada
  lobo à vaga angularmente mais próxima (guloso, minimizando cruzamentos). Vagas
  atrás do jogador ganham prioridade.
- **Fichas de ataque** (`attackTokens`): só 1–2 lobos podem estar em `commit` ao
  mesmo tempo. Escala com o tamanho da matilha e o número da horda. Os outros
  seguram posição em `flank`/`stalk`. **Só esta regra já muda o jogo**: em vez de
  cinco lobos em estouro de boiada, você vê um anel com um investindo.
- **Cadência**: temporizador de matilha libera a próxima ficha a cada 1.2–2.5 s,
  preferindo o lobo com melhor ângulo (mais próximo das costas do jogador). É o
  clássico "revezam a pressão".
- **Finta**: com probabilidade configurável, o portador da ficha faz uma
  investida curta e quebra antes do contato. Custa uma flecha do jogador e cria
  desconfiança em toda investida seguinte.
- **Corte de fuga**: se o jogador corre consistentemente numa direção, o
  coordenador manda o lobo mais bem posicionado interceptar o ponto previsto em
  vez de perseguir a bunda dele.
- Com 2+ jogadores, a divisão atual (`pickTarget`) sobe para o nível da matilha:
  sub-grupos por alvo, em vez de decisão individual por paridade de `id`.

### Camada D — Percepção

Exige um ajuste pequeno no servidor: `room.playerPositions()` passa a incluir
`yaw` e a velocidade derivada (diferença entre ticks).

- **Cone frontal**: se o jogador está de frente para o lobo em média distância, a
  vaga no cerco é reponderada para fora do cone. Efeito emergente: os lobos sempre
  aparecem pelos cantos da tela, que é exatamente a sensação de estar cercado.
- **Previsão**: `alvoPrevisto = pos + vel * tempoDeVoo` para o salto e para o
  corte de fuga. Acaba o salto que sempre erra igual.
- **Susto** (`spook`): morte de um companheiro por perto ou flecha passando raspando
  dispara `retreat` breve em alguns lobos e reabre o cerco mais largo. É também a
  válvula de dificuldade — quanto mais fácil o nível, mais eles se assustam.

### Camada E — Cliente (honestidade visual)

O protocolo já transmite `s` como string livre (`view()` → `setNetworkTarget`),
então novos estados não quebram nada; só precisam de tratamento em
`src/entities/wolf.js`.

- `stalk`: postura agachada (`visualRoot.rotation.x` maior), cabeça baixa, orelhas
  para trás, cauda baixa, passada quase nula.
- `commit`: passada longa, pescoço estendido, rosnado curto no início.
- `retreat`: orelhas para trás, cabeça virada para o alvo enquanto o corpo sai.
- **Inclinação na curva**: `visualRoot.rotation.z ∝ velocidadeAngular` — o lobo
  deita na curva. Barato e vende muito o realismo.
- Amortecimento de yaw separado do de posição (yaw pode ser mais lento), já que
  agora o servidor garante rumo contínuo.

### Camada F — Dificuldade por horda

Bloco `wolfAI` no config, com escalonamento por número da horda:

| Horda | Fichas | Pausa entre investidas | Chance de finta | Raio do cerco |
|---|---|---|---|---|
| 1–2 | 1 | 2.5 s | 0.15 | 12 m |
| 3–4 | 2 | 1.8 s | 0.30 | 10 m |
| 5–7 | 2–3 | 1.2 s | 0.40 | 8 m |

---

## 3. Parâmetros novos de config (`CONFIG.modes.zombie.wolfAI`)

```
turnRateMax        3.2 rad/s   giro no trote
turnRateMin        1.1 rad/s   giro na disparada
accel              7.0 m/s²
brake              11.0 m/s²
speedApproach      0.65        fração de wolfSpeed
speedFlank         0.8
speedCommit        1.15
separationRadius   1.8 m
ringRadius         10 m        raio do cerco (por horda)
ringTolerance      1.5 m
bearingOffsetMin   15°         curva do approach
bearingOffsetMax   35°
bearingHoldMin     3.0 s       quanto tempo sustenta o lado
bearingHoldMax     6.0 s
attackTokens       1–3         por horda
attackGapMin       1.2 s
attackGapMax       2.5 s
commitDuration     2.2 s
feintChance        0.15–0.40
retreatDistance    5–10 m
retreatDuration    1.6 s
spookRadius        4 m
frontConePenalty   0.6         peso contra vagas no cone frontal
leapLeadTime       0.35 s      antecipação do bote
```

Os parâmetros antigos `wolfZigzag*`, `wolfFlank*` e `wolfAmbushCommitRange` saem.

---

## 4. Fases de implementação

| Fase | Escopo | Arquivos | Risco | Ganho |
|---|---|---|---|---|
| **1** | Motor de locomoção: taxa de giro, aceleração, steering, whiskers, separação | `server/zombieSim.js` | Baixo | Alto — mata o serrote e o snap de yaw sozinho |
| **2** | FSM individual (`approach`/`flank`/`stalk`/`commit`/`leap`/`retreat`) | `server/zombieSim.js`, `src/config.js` | Médio | Alto — cria ritmo e tensão |
| **3** | `WolfPack`: vagas, fichas, cadência, finta | novo `server/wolfPack.js`, `zombieSim.js`, `elkWolves.js` | Médio | Alto — é o que faz parecer inteligente |
| **4** | Percepção: `yaw` + velocidade do jogador, cone frontal, previsão, susto | `server/room.js`, `wolfPack.js` | Baixo | Médio-alto |
| **5** | Animação e áudio dos novos estados, inclinação na curva | `src/entities/wolf.js`, `src/systems/audio.js` | Baixo | Médio |
| **6** | Tuning por horda + playtest | `src/config.js` | Baixo | Fecha o balanceamento |

Fases 1 e 2 já entregam um lobo aceitável. A 3 é o que separa "bom" de "assustador".

Ponto de atenção: `server/elkWolves.js` reusa a mesma classe `Wolf`, então o
coordenador precisa servir aos dois contextos (horda zumbi e matilha do alce).
Instanciar um `WolfPack` por gerenciador, não global.

---

## 5. Critérios de aceite

1. Em 10 s de perseguição, o lobo não inverte o lado da curva mais que 2 vezes.
2. Nenhuma mudança de yaw acima de `turnRateMax * dt` entre dois ticks.
3. Com 4+ lobos vivos, nunca mais de `attackTokens` em `commit` simultâneo — dá para
   contar visualmente: um vem, os outros rondam.
4. O jogador parado e girando vê lobos aparecendo pelas laterais, não empilhados à frente.
5. Salto acerta jogador em movimento retilíneo constante ≥ 60% das vezes, e ≤ 25%
   quando o jogador troca de direção no último instante.
6. Existe um momento observável de silêncio/espera (`stalk`) antes de pelo menos
   uma investida em cada encontro.
7. Custo de CPU do tick da matilha ≤ 1 ms com 10 lobos (é O(n·jogadores), trivial).
8. Sem regressão no modo alce: a pack invocada continua funcional.
