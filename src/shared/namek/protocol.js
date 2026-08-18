/* ---------------------------------------------------------------------------
   O protocolo de Namekusei — importado pelo cliente E pela sala.

   **Separado do protocolo do arqueiro, de propósito.** As duas salas nunca
   trocam mensagem: uma conexão entra numa ou na outra e morre lá. Compartilhar
   a tabela de tipos criaria a dependência que o §0 do plano existe para evitar
   — a primeira mensagem nova daqui obrigaria a subir a `PROTOCOL_VERSION` de lá,
   e uma aba do vale seria recusada por causa de uma bola de ki.

   As convenções são as MESMAS do outro protocolo, e isso não é contradição: são
   convenções boas e o repositório inteiro as segue. Vale a pena repetir a mais
   importante — **`t` é sempre o TIPO da mensagem, nunca um tempo.** Instantes
   usam `w`.

   Coordenadas viajam como `[x, y, z]`. Chaves curtas no que sai 20 vezes por
   segundo, longas no que sai uma vez na vida.
   --------------------------------------------------------------------------- */

/**
 * Sobe quando o formato quebra. A sala recusa quem não bate.
 *
 * 1 — o modo nasceu.
 * 2 — o atordoamento: `NS2C.STAGGER` e o bit 4 da pose. Um cliente da versão 1
 *     ignoraria a mensagem em silêncio e desenharia de pé quem está caído — que
 *     é justamente o tipo de divergência que esta versão existe para recusar.
 * 3 — a guarda (bit 8) e a DIFICULDADE dos bots (`NC2S`/`NS2C.DIFFICULTY`, mais
 *     o campo no `welcome`). Um cliente antigo não teria o botão e ficaria
 *     mostrando um nível que não é o da sala.
 * 4 — o planeta ganhou tudo o que faltava para ele acabar: o EMBATE entre
 *     poderes (`POWER_CLASH`), os dois PLANETAS e a chuva de meteoros
 *     (`PLANET_HIT`/`PLANET_DOWN`/`METEOR`/`METEOR_HIT`), o PEIXE gigante
 *     (`FISH_HIT`/`FISH`/`FISH_DOWN`), o BOSS Freeza (`FREEZA_*`), o FIM de
 *     Namekusei com a fuga para o espaço (`FIM_*`) e o SUPER SAIYAJIN (`SSJ`,
 *     `SSJ_ON`/`SSJ_OFF`, mais o bit 16 da pose).
 *
 *     Uma versão só para os seis, e não seis versões, porque a régua desta
 *     constante é o FORMATO e não a data: quem tem a 3 não entende nenhum dos
 *     seis, e recusá-lo uma vez é a mesma recusa que recusá-lo seis. Subir de
 *     um em um só faria sentido se as adições tivessem sido publicadas
 *     separadamente, e elas não foram.
 *
 *     Cada um deles, sozinho, já justificaria a subida — e por um motivo mais
 *     duro do que "tem mensagem nova". A regra que vale aqui é a mesma da
 *     versão 2: o perigo não é o cliente antigo QUEBRAR, é ele IGNORAR EM
 *     SILÊNCIO e desenhar um mundo que não existe. Um cliente da versão 3 numa
 *     sala destas veria o chão intacto onde caiu um meteoro, não veria o Freeza
 *     que está matando todo mundo, ficaria no planeta enquanto ele explode sem
 *     nunca saber que havia um relógio, e desenharia de cabelo preto quem já é
 *     Super Saiyajin. Nenhuma dessas divergências dá erro em lugar nenhum — que
 *     é exatamente por isso que ela tem de ser recusada na porta.
 */
export const NAMEK_PROTOCOL_VERSION = 4;

/** O que o `hello` precisa carregar para cair NESTA sala e não na do arqueiro. */
export const NAMEK_LEVEL = "namek";
export const NAMEK_MODE = "deathmatch";

/* --------------------------------------------------------- cliente → servidor */

export const NC2S = {
  /** Entrada: `{ name, version, level, mode, char }`.
   *  `level`/`mode` são o que faz o `RoomHost` rotear para cá. */
  HELLO: "hello",

  /** Pose própria, 20 Hz: `{ s: packFighter(), w }`. */
  STATE: "state",

  /** Rajada básica: `{ id, o:[x,y,z], d:[x,y,z], hand, target, w }`.
   *
   *  `target` é o id escolhido NO DISPARO e nunca reavaliado (§6.1): quem manda
   *  é quem atirou, e mandá-lo junto é o que faz a bola perseguir a mesma
   *  pessoa em todas as telas. Sem ele, cada cliente escolheria o alvo mais
   *  perto do SEU ponto de vista e a mesma bola voaria para lados diferentes. */
  BLAST: "blast",

  /** "A minha bola acertou": `{ id, victim, p:[x,y,z] }`.
   *  Mesmo contrato do `C2S.IMPACT` do arqueiro — quem atira é a autoridade
   *  sobre o próprio acerto; a sala é a autoridade sobre a vida. */
  BLAST_HIT: "blastHit",

  /** Especial disparado: `{ kind, o:[x,y,z], d:[x,y,z], target, w }`.
   *
   *  A direção é TRAVADA aqui: girar depois não entorta o feixe.
   *
   *  `target` existe pela mesma razão que o do `NC2S.BLAST`, e agora vale para
   *  mais que uma bolinha: o Kienzan e o Galick Gun PERSEGUEM (ver `homing` em
   *  `NAMEK.specials`), e quem escolhe a vítima é quem atirou, no instante do
   *  disparo. Sem este campo, cada cliente escolheria o alvo mais alinhado com o
   *  SEU ponto de vista e o mesmo disco faria curvas diferentes em cada tela —
   *  que é a única classe de divergência que este modo não tolera, porque ela
   *  decide quem morre. É `null` para o Kamehameha e para a Genki Dama, que não
   *  perseguem. */
  SPECIAL: "special",

  /** "O meu especial está queimando fulano": `{ victim, kind, dt }`.
   *  `dt` são os segundos de exposição desde o último aviso — é assim que um
   *  feixe SUSTENTADO cobra por segundo sem mandar uma mensagem por quadro. */
  SPECIAL_HIT: "specialHit",

  /** "O meu golpe bateu no chão aqui": `{ p:[x,y,z], power }`.
   *  Vira cratera para a sala inteira. Ver §7 do plano. */
  GROUND_HIT: "groundHit",

  /** "Quebrei este objeto do cenário": `{ kind, i }`.
   *  `kind` é "rocha" | "arvore" | "casa"; `i` é o índice na instância. */
  PROP_HIT: "propHit",

  /** Onda de empurrão: `{ p:[x,y,z] }`. Custa ki e empurra quem está perto. */
  BURST: "burst",

  /** "Caí de muito alto": `{ p:[x,y,z], speed }`. Cratera + poeira + dano. */
  SLAM: "slam",

  /** Pedido de renascimento antecipado (depois do tempo mínimo). */
  RESPAWN: "respawn",

  /** Põe ou tira um bot: `{ remove?: boolean }`. */
  BOT: "bot",

  /** Muda o clima da sala: `{ id: "dia"|"tempestade" }`. Vale para todos. */
  WEATHER: "weather",

  /**
   * "O meu Kamehameha está apontado para o SOL": `{}` — sem carga nenhuma.
   *
   * Ela é gêmea de `PLANET_HIT` e o desenho é o mesmo dele, de propósito (ver
   * §2 de `server/namek/planetas.js`): o cliente declara, a sala confere a
   * direção TRAVADA no disparo (`player.especial.d`) contra `NAMEK.sol.dir` com
   * a folga de `NAMEK.sol.folga` graus, e o registro do especial — que já custou
   * a barra cheia — é o que dá dentes à mensagem.
   *
   * Sem campo nenhum porque não há o que escolher: existe UM sol. `PLANET_HIT`
   * manda `id` porque lá são dois corpos.
   *
   * Três acertos derrubam o sol e ligam o fim do planeta (`NAMEK.sol.vidas`).
   */
  SUN_HIT: "sunHit",

  /** Muda a dificuldade dos bots: `{ id }`, um de `NAMEK.bot.dificuldadeOrdem`.
   *
   *  É da SALA, como o clima, e pelo mesmo motivo: os bots são de todos. Quem
   *  pede é qualquer um pelo menu, e o efeito é imediato para quem já está em
   *  campo — ver `NamekBotSquad.setDificuldade`, que é onde "dinamicamente"
   *  vira código. */
  DIFFICULTY: "difficulty",

  /** Sincronismo de relógio: `{ c: clientClock }`. */
  PING: "ping",

  /** "O meu poder acertou o peixe gigante": `{ i, kind, dt }`.
   *
   *  Mesmo contrato do `BLAST_HIT` e do `SPECIAL_HIT` — quem atira é a autoridade
   *  sobre o próprio acerto, a sala é a autoridade sobre a vida —, e por isso ele
   *  é uma mensagem à parte em vez de um `BLAST_HIT` com a vítima "peixe": lá a
   *  sala procura um LUTADOR pelo id, e um id que não é de ninguém seria recusado
   *  em silêncio.
   *
   *  `i` é o id do peixe. Ele existe para o caso que acontece o tempo todo numa
   *  rede real: a bola já estava no ar quando o bicho morreu, e o aviso chega
   *  depois do `FISH_DOWN`. Com o id, esse acerto atrasado morre no id velho em
   *  vez de arrancar vida do peixe seguinte.
   *
   *  `kind` é `"blast"` ou uma chave de `NAMEK.specials`; `dt` são os segundos de
   *  exposição desde o último aviso e só valem para os feixes, exatamente como no
   *  `SPECIAL_HIT`. */
  FISH_HIT: "fishHit",

  /**
   * "DOIS PODERES SE ENCOSTARAM": `{ a, ka, b, kb, p:[x,y,z], c }`.
   *
   * `a`/`ka` e `b`/`kb` são dono e tipo de cada um dos dois golpes; `p` é o
   * ponto de contato; `c` é 1 quando os dois eram a BOLA DE CARGA de um
   * Kamehameha (a regra 4 de `NAMEK.embate`, que tem explosão própria).
   *
   * ------------------------------------------------------------ por que existe
   *
   * Porque sem ela o embate seria a única coisa deste modo que duas telas não
   * conseguiriam concordar. Cada cliente simula os próprios projéteis e
   * reconstrói os alheios a partir do disparo retransmitido; as duas cópias do
   * mesmo Galick Gun estão a alguns metros uma da outra, e "a alguns metros" é
   * exatamente a margem que decide se ele encostou ou não no Kamehameha que
   * vinha de frente. Deixado a cada tela, um jogador veria o golpe sumir e o
   * outro o veria acertar — e esse é o único desacordo que o modo não tolera,
   * porque ele decide quem morre.
   *
   * -------------------------------------------------------- por que não tem id
   *
   * Um especial nunca teve id no protocolo (`NC2S.SPECIAL` manda tipo, origem,
   * direção e alvo, e mais nada), e inventar um obrigaria a mexer no formato
   * que os dois lados já falam. Dono + tipo + ponto identificam o projétil sem
   * ambiguidade prática: é preciso a MESMA pessoa ter DOIS golpes do MESMO tipo
   * vivos a menos de `NAMEK.embate.busca` metros um do outro para o casamento
   * errar — e mesmo então os dois são idênticos.
   *
   * ---------------------------------------------------- o que ela NÃO carrega
   *
   * O RESULTADO. Quem morre, quem sobrevive e que estouro sai não viajam: são
   * recalculados por cada cliente a partir de `ka`, `kb` e `c` pela mesma
   * tabela pura (`NAMEK.embate.classe` + `resolverEmbate`, em
   * `powers/colisao.js`). Mandar o desfecho pronto seria a mesma regra
   * existindo em dois lugares, e no dia em que as duas divergissem o jogo
   * mostraria uma Genki Dama sumindo na tela de quem tem a tabela velha.
   *
   * A rajada de ki NÃO passa por aqui: bola pequena morrendo contra poder
   * grande é resolvido localmente em cada tela, sem mensagem nenhuma. É a mesma
   * tolerância que a onda de empurrão já assume ao varrer bolas alheias (ver
   * `PowerSystem.spawnBurst`) e pelo mesmo motivo — se ela sobreviver na tela
   * de quem atirou e acertar, o acerto vale, porque é ele quem julga. Fazê-la
   * subir seria uma mensagem por bola varrida, dezenas por segundo num
   * tiroteio, para sincronizar dois pontos de dano.
   */
  POWER_CLASH: "powerClash",

  /**
   * "O meu Kamehameha está apontado para o planeta": `{ id }`.
   *
   * `id` é um dos `NAMEK.planetas.corpos[].id` — `"kuraia"` ou `"rubel"`.
   *
   * Mesmo contrato do `GROUND_HIT` e do `BLAST_HIT`, e é ele que responde à
   * pergunta óbvia ("por que o cliente decide?"): quem sabe para onde o feixe
   * está apontado é quem o disparou, e a conta é uma interseção raio-esfera
   * contra um corpo que ACOMPANHA O OLHO daquele jogador. A sala não tem olho e
   * não poderia refazê-la; o que ela faz é conferir o que dá para conferir do
   * lado dela, e é bastante: o especial declarado existe, é um Kamehameha, está
   * dentro da janela de tempo dele, custou a barra cheia, e a direção travada no
   * disparo aponta para aquele planeta dentro do cone que a curva do golpe
   * permite. Ver `NamekPlanetas.pedido`.
   *
   * A mensagem sai UMA vez por disparo, no instante em que o especial é
   * declarado — não por quadro. O planeta cai `NAMEK.planetas.viagem` segundos
   * depois, e quem conta é a sala.
   */
  PLANET_HIT: "planetHit",

  /**
   * "O meu golpe acertou o FREEZA": `{ kind, dt, p:[x,y,z] }`.
   *
   * Mesmo contrato do `BLAST_HIT`/`SPECIAL_HIT` — quem atira é a autoridade
   * sobre o próprio acerto, a sala é a autoridade sobre a vida —, numa mensagem
   * só e **sem `victim`**, porque o boss é UM: não há vítima a declarar, e é
   * justamente essa ausência que barateia a conferência do outro lado (não há
   * como escolher a vítima errada quando só existe uma).
   *
   * Ela é separada do `BLAST_HIT` pela mesma razão que o `FISH_HIT`: lá a sala
   * procura um LUTADOR pelo id, e o Freeza não é um — ele não entra em
   * `todos()`, não ocupa vaga, não renasce e não vai ao placar. Um id que não é
   * de ninguém seria recusado em silêncio.
   *
   * `kind` é `"blast"` ou uma chave de `NAMEK.specials`, e é ele que escolhe a
   * linha de `NAMEK.freeza.dano` — a tabela de quanto cada poder do jogador suga
   * do boss. `dt` são os segundos de exposição desde o último aviso e só valem
   * para o Kamehameha, o único golpe que cobra por tempo; os outros mandam 0.
   * `p` é onde bateu: a sala confere que o ponto é perto do corpo dele, que é a
   * mesma checagem de plausibilidade que o `BLAST_HIT` já faz.
   */
  FREEZA_HIT: "freezaHit",

  /**
   * "Quero virar Super Saiyajin." **Sem corpo — não há nada a declarar.**
   *
   * É a mensagem mais magra deste protocolo, de propósito: todas as condições
   * da transformação (vida ≤ `NAMEK.ssj.gatilho`, Freeza em campo, vivo, não
   * caído, ainda não transformado) são coisas que a SALA sabe melhor que o
   * cliente — ela é a autoridade sobre vida desde sempre e é ela quem tem o
   * `sala.freeza`. Qualquer campo aqui seria oferecer ao cliente a chance de
   * mentir sobre um estado que ele nem precisa declarar.
   *
   * A recusa é SILENCIOSA, como a do especial (ver `registrarEspecial`): o
   * cliente já começou a animação — ele prevê tudo — e a cancela sozinho se o
   * `NS2C.SSJ_ON` não chegar até o fim dos três segundos. Uma mensagem de
   * recusa só existiria para dizer o que a ausência da confirmação já diz.
   */
  SSJ: "ssj",
};

/* --------------------------------------------------------- servidor → cliente */

export const NS2C = {
  /** Aceito: `{ you, time, weather, fighters, craters, scores }`.
   *  `craters` é a lista INTEIRA — é o que faz quem entra no meio ver o chão
   *  já deformado (critério 6 do §12). */
  WELCOME: "welcome",
  /** Recusado: `{ reason, players, max }`. */
  REJECT: "reject",

  /** Alguém entrou: `{ fighter }`. */
  JOIN: "join",
  /** Alguém saiu: `{ id, name }`. */
  LEAVE: "leave",

  /** Poses de todos os OUTROS, 20 Hz.
   *
   *  `{ time, s: [ { id, w, ...packFighter() }, ... ] }` — a pose vem
   *  **ACHATADA** dentro da entrada, não aninhada num campo `s`. Fica dito em
   *  letra e não em reticências porque as duas metades já divergiram aqui uma
   *  vez: a sala achatava, o cliente procurava `entrada.s`, e o resultado foi
   *  cinco lutadores existindo, brigando e perdendo vida — todos parados na
   *  origem do mundo. Nenhum erro em lugar nenhum.
   *
   *  Achatada porque é mais barata: são 15 poses 20 vezes por segundo, e o
   *  objeto intermediário custaria três bytes por lutador por pacote para não
   *  dizer nada.
   *
   *  E ela vem PODADA: todo canal que valha o padrão é omitido (ver
   *  `unpackFighter`, que por isso lê tudo com `?? 0`). Numa sala de quinze isso
   *  cortou a descida de 55,6 para 41,0 KB/s. */
  STATES: "states",

  /** Vida e ki de todos, 10 Hz: `{ h: [[id, health, ki], ...] }`.
   *  Num array de arrays e não de objetos: 15 lutadores a 10 Hz são a segunda
   *  mensagem mais cara do modo, e as chaves seriam metade dos bytes. */
  VITALS: "vitals",

  /** Retransmissão de rajada, com `owner`. */
  BLAST: "blast",
  /** Retransmissão de especial, com `owner`. */
  SPECIAL: "special",
  /** Retransmissão da onda, com `owner`. */
  BURST: "burst",

  /** Alguém levou dano: `{ id, health, by, amount, kind, g }`.
   *  Vira o clarão vermelho, o número subindo e a pose de dor.
   *  `g` é 1 quando o golpe foi APARADO por uma guarda — é o que separa, no
   *  ouvido e na tela, defender de apanhar. Ver `NAMEK.guard`. */
  HURT: "hurt",

  /** Morte confirmada: `{ victim, killer, kind, p:[x,y,z], d:[x,y,z] }`.
   *  `d` é a direção do golpe — é ela que joga o corpo para o lado certo. */
  DEATH: "death",

  /**
   * Derrubado por golpes seguidos: `{ id, by, s, w }`.
   *
   * `s` são os SEGUNDOS em que a vítima fica caída — vem na mensagem em vez de
   * ser lido de `NAMEK.fighter.stagger.time` pelos dois lados porque quem conta
   * os golpes é a sala, e é ela que decide se aquela queda vale o tempo cheio.
   * Ler a constante daqui funcionaria hoje e passaria a mentir no dia em que a
   * sala quisesse encurtar a queda de quem já está com pouca vida.
   *
   * A mensagem NÃO move ninguém: quem derruba o corpo é o cliente da vítima
   * (§8 — a posição de um humano é dele). Para os outros, a queda chega pela
   * pose, no bit 4 de `packFighter`. Esta mensagem é o gatilho, não o estado.
   */
  STAGGER: "stagger",

  /** Onde renascer: `{ id, p:[x,y,z], yaw, invulnUntil }`. */
  SPAWN: "spawn",

  /** Cratera nova, para todos: `{ i, p:[x,y,z], power, by }`.
   *  `i` é o id da sala — é ele que deixa o cliente reaplicar sem duplicar.
   *  `by` é quem a abriu (ou null): quem atirou já tocou o próprio estouro no
   *  instante do impacto, e sem este campo ele o tocaria de novo ao receber o
   *  carimbo de volta. */
  CRATER: "crater",

  /** Objeto do cenário quebrado: `{ kind, i, by }`. */
  PROP_DOWN: "propDown",

  /** Clima: `{ id, w }`. `w` é o instante em que a transição começou. */
  WEATHER: "weather",

  /**
   * O ESTADO DO SOL: `{ feridas, morto, by, w }`.
   *
   * `feridas` são quantos Kamehamehas ele já levou (0 a `NAMEK.sol.vidas`), e o
   * cliente pinta o disco um degrau mais vermelho a cada um — é o *"cada vez que
   * Kamehameha o sol, ele muda um pouco de cor, ficando cada vez mais vermelho"*
   * do pedido. `morto` é 1 só na mensagem do TERCEIRO acerto, e é ela que dispara
   * a explosão na tela.
   *
   * Ela sai em broadcast e vem também no `welcome` (campo `sol`), pelo mesmo
   * motivo que a lista de crateras vem: quem entra no meio de uma partida em que
   * o sol já apanhou duas vezes tem de ver o mesmo céu que os outros.
   *
   * O que ela NÃO carrega é a virada de clima. O terceiro acerto chama
   * `pedirClima("tempestade")` na sala, e o `NS2C.WEATHER` sai por conta própria
   * logo atrás — dizer as duas coisas na mesma mensagem daria ao cliente duas
   * verdades sobre o mesmo estado, e a que chegasse por último ganharia.
   */
  SUN: "sun",

  /** Dificuldade dos bots: `{ id }`. Retransmitida a todos para o menu de cada
   *  um mostrar o nível que de fato está valendo — e não o que aquela pessoa
   *  pediu por último. */
  DIFFICULTY: "difficulty",

  /** Raio da tempestade: `{ p:[x,z], w }`. A sala decide para todos verem o
   *  mesmo relâmpago no mesmo lugar — meio do céu piscando em horas diferentes
   *  em cada tela seria o oposto de um planeta explodindo JUNTO. */
  BOLT: "bolt",

  /** Placar completo (sempre que muda): `{ s: [{id, name, kills, deaths}] }`. */
  SCORES: "scores",

  /** Resposta do sincronismo: `{ c, s }`. */
  PONG: "pong",

  /**
   * O PEIXE GIGANTE vai saltar: `{ i, w, p:[x,z], rumo, alcance, alto, dur,
   * curva, giro }`.
   *
   * **O salto inteiro num pacote só, mandado com `NAMEK.peixe.aviso` segundos de
   * antecedência.** `w` é o instante (relógio da sala) em que o corpo ROMPE a
   * superfície; antes dele o cliente desenha o vulto subindo, depois integra a
   * parábola. Nada mais viaja: nem posição por quadro, nem pose, nem o instante
   * do mergulho — tudo isso é função fechada destes nove números, e é por isso
   * que quinze telas veem o mesmo peixe no mesmo lugar sem custar um byte por
   * quadro. É o mesmo princípio do `packFighter`: manda-se o relógio, não o osso.
   *
   * `p` tem DOIS componentes e não três de propósito — a altura da saída é a
   * linha d'água, que os dois lados já conhecem por `NAMEK.world.seaLevel`.
   *
   * `rumo` é o azimute do arco em radianos; `alcance` o avanço horizontal em
   * metros; `alto` o ápice acima da água; `dur` o tempo de voo em segundos;
   * `curva` o desvio lateral no ápice como fração de `alcance`; `giro` a rolagem
   * acumulada em radianos (com sinal — ele parafusa para um lado ou para o
   * outro).
   *
   * Vem também no `welcome`, no campo `fish`, quando há um salto em curso: quem
   * entra no meio de um mergulho tem de ver o mesmo peixe que os outros, pelo
   * mesmo motivo que recebe a lista de crateras.
   */
  FISH: "fish",

  /**
   * O peixe morreu: `{ i, p:[x,y,z], by }`.
   *
   * A vida dele é da SALA, como a de todo mundo (§8): o cliente relata o acerto
   * (`NC2S.FISH_HIT`) e é esta mensagem que confirma. `p` é onde o corpo estava
   * no instante da morte — o estouro nasce lá — e `by` é quem o matou, para o
   * aviso na tela. Depois dela o cliente vira o bicho de barriga para cima e o
   * afunda; o próximo peixe chega num `FISH` novo, `NAMEK.peixe.respawn`
   * segundos mais tarde.
   */
  FISH_DOWN: "fishDown",

  /* ===================================================================== fim
     O FIM DE NAMEKUSEI — o Freeza, a contagem, a explosão e o espaço.

     As quatro mensagens abaixo respondem à mesma pergunta em escalas de tempo
     diferentes, e é por isso que são quatro e não uma: `FIM_ESTADO` troca de fase
     (raro), `FIM_CONTAGEM` bate o relógio (1 Hz), `FIM_ESCAPOU` e `FIM_EXPLODIU`
     são os dois instantes em que alguém deixa de estar onde estava.

     **Nada disto sobe do cliente.** A fuga é medida na pose que ele já manda 20
     vezes por segundo — a sala é a autoridade sobre quem escapa e quem morre
     (§8) —, e uma mensagem "estou subindo" seria a mesma informação uma segunda
     vez, com a diferença de que a segunda dá para mentir. */

  /**
   * A fase do fim, sempre que ela muda — e no `welcome`, para quem chega no meio.
   *
   * `{ fase, w, restante, portal:[x,y,z], teto, escapados:[id] }`
   *
   * `fase` é `"calmo" | "freeza" | "contagem" | "explodindo" | "espaco"`.
   * `restante` são os MILISSEGUNDOS que faltam no relógio da fase (a contagem
   * regressiva, ou o que sobra do espetáculo da explosão); 0 quando a fase não
   * tem relógio. `portal` é a boca da escapatória e `teto` é o limite de voo que
   * passa a valer — os dois viajam em vez de serem lidos do config porque quem
   * decide QUANDO eles valem é a sala, e um cliente que os deduzisse sozinho
   * abriria o céu antes da hora.
   *
   * `escapados` é a lista de quem já está no espaço: sem ela, quem entra no meio
   * desenharia no chão gente que está a dois quilômetros de altura.
   */
  FIM_ESTADO: "fimEstado",

  /**
   * O relógio do planeta, uma vez por segundo e para todos: `{ restante }`.
   *
   * `restante` são os segundos que faltam para a explosão. É um número só porque
   * sobrou um relógio só: a fuga é ALTITUDE (chegar à boca do portal antes do
   * zero), não mais trinta segundos de subida acumulados por jogador. Enquanto
   * aquele relógio pessoal existia, esta mensagem era diferente para cada
   * destinatário e saía quinze vezes por segundo; hoje é a mesma para as quinze
   * telas.
   *
   * O cliente conta sozinho entre dois tiques (`EstadoDoFim.passo`) e é corrigido
   * aqui. Um segundo de deriva num cronômetro de sessenta é invisível; um
   * cronômetro que só o cliente conta é o caminho para duas telas discordarem
   * sobre quem estava dentro quando o planeta foi.
   */
  FIM_CONTAGEM: "fimContagem",

  /** O planeta explodiu: `{ w, mortos:[id], escapados:[id] }`.
   *
   *  Os `mortos` já receberam o `DEATH` de sempre (com `kind: "planeta"`) — esta
   *  lista existe para o CENÁRIO e não para a vida: é ela que diz ao cliente, num
   *  pacote só, que a explosão foi geral e que o chão deixou de existir, em vez
   *  de quinze mensagens de morte chegando em ordem qualquer. */
  FIM_EXPLODIU: "fimExplodiu",

  /** Alguém saiu do planeta: `{ id, p:[x,y,z], w }`.
   *
   *  Vai para TODOS e não só para quem escapou: o corpo dele é teleportado para a
   *  bolha do espaço, e sem este aviso os outros continuariam interpolando um
   *  lutador que sumiu do céu deles sem explicação. Quem escapou também usa a
   *  posição — é a SALA que decide onde a bolha começa, não o cliente. */
  FIM_ESCAPOU: "fimEscapou",

  /**
   * O EMBATE CONFIRMADO, para todos: `{ a, ka, b, kb, p:[x,y,z], c }`.
   *
   * Os mesmos campos do `NC2S.POWER_CLASH` (ver o comentário longo lá), com uma
   * diferença que é a razão de a mensagem existir: **ela é a versão canônica.**
   *
   * Qualquer cliente que enxergue o choque avisa a sala; a sala guarda o
   * primeiro aviso de cada par e DESCARTA os repetidos que chegarem dentro de
   * `NAMEK.embate.janelaSala` segundos, retransmitindo um só. Não é economia de
   * banda: é o que impede que quinze telas, cada uma com a sua reconstrução do
   * mesmo Galick Gun, produzam quinze embates ligeiramente diferentes do mesmo
   * encontro.
   *
   * Por que "qualquer cliente" e não "o dono do projétil de menor id", que
   * seria o critério óbvio: porque metade dos golpes deste modo é de BOT, e bot
   * não tem cliente. Com o critério do menor id, todo embate em que o número
   * menor coubesse a um bot simplesmente não aconteceria em tela nenhuma — e
   * numa sala de quinze bots isso é quase todo embate. Deixando qualquer um
   * avisar e centralizando o desempate na SALA, o mesmo mecanismo cobre humano
   * contra humano, humano contra bot e bot contra bot, sem um caso especial.
   *
   * Quem avisou já aplicou o embate localmente antes de mandar — é predição,
   * como tudo o mais neste jogo — e a volta é INÓCUA para ele: os projéteis já
   * morreram e a busca por dono+tipo não acha mais nada. A mensagem é
   * idempotente por construção, e é isso que permite retransmiti-la a todos sem
   * excluir o remetente.
   */
  POWER_CLASH: "powerClash",

  /* ====================================================== planetas e chuva ==
     As três mensagens do pedido: o planeta morre, as rochas caem, as rochas
     estouram. Todas descem, nenhuma sobe — a única coisa que o cliente declara
     neste assunto é a mira (`NC2S.PLANET_HIT`).                                */

  /**
   * O planeta se partiu: `{ id, by, w }`.
   *
   * `w` é o instante (relógio da sala) em que a sequência COMEÇA, e é ele que
   * faz quinze telas verem o mesmo planeta rachar no mesmo segundo. O cliente
   * não recebe mais nada porque não precisa: rachadura, clarão e cacos são
   * função fechada de `(w, NAMEK.planetas.rachar/clarao/cacos)` e o desenho
   * inteiro cabe nessa conta — o mesmo princípio do `packFighter` e do salto do
   * peixe, manda-se o relógio e não o quadro.
   *
   * `by` é quem o destruiu, para o aviso na tela. Não muda nada no desenho.
   *
   * Quem entra no meio recebe a lista dos que já caíram no campo `planetas` do
   * `welcome`, e os apaga do céu SEM sequência — pelo mesmo motivo que ele
   * recebe a lista de crateras e a de peças derrubadas.
   */
  PLANET_DOWN: "planetDown",

  /**
   * Uma rocha entrou no céu: `{ i, o:[x,y,z], p:[x,y,z], r, dur, w }`.
   *
   * `i` é o id da rocha (contador da sala), `o` de onde ela vem, `p` onde ela
   * VAI bater, `r` o raio dela em metros, `dur` os segundos de queda e `w` o
   * instante da largada. A duração NÃO se chama `t` porque `t` é o tipo da
   * mensagem em todo este protocolo — ver o cabeçalho.
   *
   * **A trajetória inteira num pacote só**, como o salto do peixe e pela mesma
   * razão: a posição é `o + (p − o) · (agora − w)/t`, uma reta e um relógio.
   * Vinte rochas no ar custariam 400 números por quadro se a sala mandasse
   * posição; assim custam seis números uma vez cada.
   *
   * E é a mesma conta dos dois lados — a sala integra a mesma reta para saber em
   * quem a rocha encostou —, então o que o jogador vê passando por cima dele é
   * exatamente o que cobra os 50 % de vida.
   *
   * `dur` viaja em vez de ser derivada da velocidade da classe porque quem
   * escolhe a classe é a sala: derivá-la aqui obrigaria o cliente a descobrir de
   * que classe era a rocha a partir do raio, que é a informação certa dita do
   * jeito errado.
   */
  METEOR: "meteor",

  /**
   * A rocha estourou: `{ i, p:[x,y,z], r, power }`.
   *
   * O instante do impacto já era calculável (`w + dur` da `METEOR`), e mesmo assim
   * esta mensagem existe — porque o que ela carrega não é o QUANDO, é o
   * ACONTECIMENTO: é ela que autoriza o clarão, a poeira, o tranco de câmera e o
   * som, no quadro em que a sala de fato cobrou o dano. Sem ela, cada tela
   * escolheria o próprio quadro a partir do próprio relógio, e a explosão
   * aconteceria antes da morte em umas e depois em outras.
   *
   * **A CRATERA NÃO VEM AQUI.** Ela desce pelo `NS2C.CRATER` de sempre, carimbada
   * pelo mesmo `NamekRoom.cratera` que atende bola de ki, Genki Dama e baque de
   * queda — é o que garante que o buraco do meteoro seja o mesmo buraco em todas
   * as telas, que ele apareça na lista do `welcome` de quem chegar depois e que
   * ele funda a lava como qualquer outro. É também de onde sai o SOM do estouro:
   * `NamekAudio.estouroNoChao` escolhe a receita pela potência, e as três classes
   * de rocha caem em três degraus diferentes dela (2,4 → médio, 6 → grande,
   * 20 → colossal). Um som próprio aqui seria o mesmo estouro tocado duas vezes.
   */
  METEOR_HIT: "meteorHit",

  /* ======================================================== o BOSS: Freeza ==
     Cinco mensagens, e a divisão entre elas é a mesma que o modo já usa para um
     lutador: IDENTIDADE uma vez (`FREEZA_IN`), POSE muitas vezes por segundo
     (`FREEZA_STATE`), ACONTECIMENTO por evento (`FREEZA_POWER`, `FREEZA_HURT`,
     `FREEZA_DOWN`). Nada aqui reaproveita `JOIN`/`STATES`/`HURT`/`DEATH`, e a
     razão é uma só: aquelas mensagens fazem o cliente criar um `Fighter` — o
     corpo humano de 1,78 m, com gi, cabelo e as treze poses. O Freeza tem outro
     corpo, outra escala e outra máquina de estados; entrar por ali seria pedir
     ao `RemoteFighters` que soubesse desenhar duas coisas diferentes. */

  /**
   * O boss ENTROU: `{ id, nome, dificuldade, vida, vidaMax, p:[x,y,z], w }`.
   *
   * É o `JOIN` dele, e sai para todos — inclusive, sozinha, para quem entra na
   * sala com a luta já em curso (a sala a reenvia logo depois do `welcome`,
   * exatamente como faz com a lista de crateras).
   *
   * `vidaMax` viaja mesmo sendo derivável por `vidaDoFreeza(n, dificuldade)`:
   * quem acabou de entrar ainda não sabe quantos lutadores há em campo, e a
   * barra do topo da tela não pode aparecer errada por um quadro. E ela MUDA
   * durante a luta (alguém entra, alguém sai), o que faz do número mandado a
   * única fonte honesta.
   */
  FREEZA_IN: "freezaIn",

  /**
   * A pose do boss, 20 Hz: `{ p:[x,y,z], v:[x,y,z], y, i, r, a, k, s, u, tp, w }`.
   *
   * Chaves curtas pelo mesmo motivo do `packFighter`: ela sai vinte vezes por
   * segundo para todo mundo. `y`/`i`/`r` são guinada, arfagem e rolagem; `a` é a
   * aura (0…1); `k` é a fração da barra de ki dele (a barra do HUD mostra as
   * duas); `s` é a fração da POSE em curso e `u` é qual pose (0 = parado,
   * 1 = investida, 2 = rajada, 3 = Death Beam, 4 = Death Ball, 5 = onda,
   * 6 = dor); `tp` é 1 no quadro de um TELEPORTE — é o sinal para o cliente
   * cortar a interpolação em vez de arrastar o corpo pelo mapa inteiro.
   *
   * A pose é do SERVIDOR, e aqui não vale a divisão do §8 (a posição de um
   * humano é dele): o boss não tem cliente, então não há com quem dividir a
   * autoridade. Isso o torna o único corpo do modo cuja posição é inteiramente
   * autoritativa — e é o que permite ao servidor cobrar o dano dos golpes DELE
   * sem esperar ninguém declarar acerto.
   */
  FREEZA_STATE: "freezaState",

  /**
   * O boss soltou alguma coisa: `{ kind, o:[x,y,z], d:[x,y,z], id, hand, w }`.
   *
   * `kind` é `"rajada"` ou uma chave de `NAMEK.freeza.poderes`. O cliente só
   * DESENHA — o dano já foi resolvido no servidor, que é dono do corpo dele e da
   * vida de todo mundo. Por isso os projéteis dele nascem com `local: false` nos
   * pools de `src/namek/powers/`: eles voam, colidem, morrem e abrem cratera na
   * tela, e não reportam nada a ninguém.
   *
   * `id` só importa para a rajada (mantém os ids do pool distintos entre
   * surtos); `hand` é a mão que atirou, para o braço certo se estender.
   */
  FREEZA_POWER: "freezaPower",

  /**
   * O boss levou dano: `{ vida, vidaMax, dano, by, kind }`.
   *
   * Só sai quando há dano acumulado a despejar — a sala junta e manda a 8 Hz,
   * como o `HURT` contínuo já faz. É o que faz a barra do topo "descer ao vivo"
   * sem transformar uma rajada de nove bolas por segundo em nove mensagens para
   * quinze clientes.
   *
   * `by` é quem bateu por último no acúmulo e `kind` é o golpe, para o número
   * que sobe ter a cor certa.
   */
  FREEZA_HURT: "freezaHurt",

  /**
   * O boss CAIU: `{ by, p:[x,y,z], w }`.
   *
   * `by` é quem deu o último golpe. Não há `killer` no sentido do placar: matar
   * o Freeza não é um abate (ele não entra em `scores`), é o fim de uma luta —
   * quem quiser premiar quem o derrubou faz isso lendo esta mensagem.
   */
  FREEZA_DOWN: "freezaDown",

  /* ================================================== o SUPER SAIYAJIN ==
     Duas mensagens e um bit, e a divisão entre eles é a mesma que o
     atordoamento já usa (ver `STAGGER`): **a mensagem é o GATILHO, o bit é o
     ESTADO.**

     O bit 16 da pose (`packFighter`) diz "este lutador está em Super Saiyajin"
     vinte vezes por segundo, e é ele que sustenta o cabelo amarelo, a aura de
     ouro e a cor dos poderes na tela de todo mundo — inclusive na de quem
     entrou na sala depois da transformação alheia e nunca recebeu o `SSJ_ON`.

     As mensagens existem porque o bit não sabe QUANDO. Os três segundos de
     animação precisam começar no mesmo instante em todas as telas, e um bit que
     acende não diz se ele acendeu agora ou há dois segundos e meio.            */

  /**
   * A transformação COMEÇOU: `{ id, w, maxHealth, health }`.
   *
   * `w` é o instante do começo, no relógio da sala — é dele que sai a fração da
   * animação em cada tela, e mandá-lo em vez de deixar cada cliente marcar a
   * chegada do pacote é o que impede o grito de um lutador de estar no meio na
   * tela dele e no fim na tela do vizinho.
   *
   * `maxHealth` e `health` vêm juntos porque a transformação MEXE NOS DOIS no
   * mesmo quadro (`NAMEK.ssj.vidaBonus` entra na vida atual e no teto — ver o
   * §"a vida no INSTANTE da virada" no config), e o `VITALS` seguinte só carrega
   * a vida. Sem o teto aqui, o HUD de quem se transformou desenharia 90 numa
   * barra de 100 durante os 100 ms até o próximo `VITALS`: a barra apareceria
   * cheia e o número diria noventa.
   *
   * Ela vai para TODOS, e não só para o dono: quem está do outro lado da arena
   * precisa do começo do relógio para ver a mesma animação, e a barra de vida do
   * alvo travado (`NamekHud.setTarget`) precisa do teto novo pelo mesmo motivo
   * que o dono precisa.
   */
  SSJ_ON: "ssjOn",

  /**
   * A transformação ACABOU: `{ id, maxHealth, health }`.
   *
   * Ela sai em dois casos e só nesses dois — ver o §"quando ela ACABA" em
   * `NAMEK.ssj`: o lutador morreu, ou o Freeza caiu. **Não há relógio**, e por
   * isso não há campo de tempo aqui.
   *
   * `health` vem porque o fim APARA a vida ao teto base (quem estava com 140 de
   * 160 fica com 100 de 100), e essa poda tem de chegar junto com o motivo — e
   * não como um número que despenca sozinho no `VITALS` seguinte.
   */
  SSJ_OFF: "ssjOff",
};

export const NamekReject = {
  FULL: "full",
  VERSION: "version",
  KEY: "key",
};

/* ------------------------------------------------------------------ estado -- */

/**
 * A pose de um lutador, compactada.
 *
 * O princípio é o mesmo do `packState` do arqueiro, e ele é a razão de a rede
 * deste modo ser barata: **o corpo é montado por procedimento nos dois lados**,
 * então não se transmite osso nenhum — só os relógios que alimentam as poses.
 *
 * Treze números e dois bits por lutador, 20 vezes por segundo. Com 15 em campo
 * dá ~9 KB/s de descida por cliente, que é a mesma ordem do jogo do arqueiro.
 */
export function packFighter(f) {
  return {
    p: r3v(f.position),
    /** velocidade — o interpolador precisa dela para extrapolar sem borracha */
    v: r2v(f.velocity),
    y: r3(f.yaw),
    i: r3(f.pitch),
    /** rolagem: o lutador INCLINA na curva, e sem isso o voo fica de trilho */
    r: r3(f.roll ?? 0),
    /** fase da marcha/corrida */
    g: r3(f.gaitPhase ?? 0),
    /** 0 andando … 1 correndo */
    n: r3(f.runBlend ?? 0),
    /** 0 no chão … 1 voando */
    fl: r3(f.flyBlend ?? 0),
    /** 0 … 1 — o quanto o arranque de ki está aceso */
    bo: r3(f.boostBlend ?? 0),
    /** 0 … 1 — a pose de carregar ki */
    ch: r3(f.chargeBlend ?? 0),
    /** fração da animação do especial em curso; 0 quando não há */
    sp: r3(f.specialFraction ?? 0),
    /** qual especial está sendo feito — índice em `NAMEK.specialOrder`, -1 = nenhum */
    sk: f.specialIndex ?? -1,
    /** 0 … 1 — a pose de dor, decaindo */
    hu: r3(f.hurtBlend ?? 0),
    /** mão que atirou por último e há quanto tempo: alimenta o braço estendido */
    ha: f.lastHand ?? 0,
    hp: r3(f.handPose ?? 0),
    /* bits: 1 = morto, 2 = invulnerável (piscando), 4 = ATORDOADO, 8 = DEFENDENDO,
     *       16 = SUPER SAIYAJIN.
     *
     * O 4 é um bit e não um canal contínuo porque estar caído é um estado, não
     * uma grandeza — e porque ele já viaja de graça no byte que os outros dois
     * ocupavam. `tonto` é lido como VERDADEIRO/FALSO: o cliente guarda um
     * booleano, o bot do servidor guarda os segundos que faltam, e os dois
     * escrevem o mesmo bit sem tradutor no meio.
     *
     * O 8 é a GUARDA, e ela é um caso especial que vale explicar: a defesa é um
     * estado CONTÍNUO que custa ki e reduz dano, e mandá-la aqui — em vez de num
     * par de mensagens "comecei/parei" — é a mesma decisão que a sala já toma
     * para o arranque e para a pose de carga. O motivo está escrito em
     * `NamekRoom.economiaDeKi`: a pose é reenviada 20 vezes por segundo, então
     * um pacote perdido se conserta sozinho no seguinte, enquanto um "parei"
     * perdido deixaria alguém defendendo (e drenando) para sempre. */
    /* O 16 é o SUPER SAIYAJIN, e ele é o primeiro bit livre — 1, 2, 4 e 8 já
     * tinham dono. Ele é o ESTADO da transformação, não o gatilho dela: quem
     * anuncia o começo é `NS2C.SSJ_ON`, com o instante, porque três segundos de
     * animação precisam do mesmo relógio em todas as telas (ver lá).
     *
     * Aqui ele vale como bit e não como canal contínuo pela mesma razão do 4 e
     * do 8: estar transformado é um estado, não uma grandeza, e ele viaja de
     * graça no byte que os outros quatro já ocupavam. E ele é o que faz o
     * cabelo, a aura e a cor dos poderes de um adversário estarem certos na sua
     * tela mesmo que você tenha entrado na sala depois do grito dele. */
    b:
      (f.down ? 1 : 0) |
      (f.invuln ? 2 : 0) |
      (f.tonto ? 4 : 0) |
      (f.defendendo ? 8 : 0) |
      (f.ssj ? 16 : 0),
  };
}

/**
 * Escreve um `packFighter()` numa amostra do buffer de interpolação.
 *
 * **Todo campo é opcional.** A sala poda da mensagem tudo o que valha o padrão
 * (ver `NS2C.STATES`), então uma pose legítima pode chegar sem `v`, sem `y` e
 * sem mais nada além da posição. Ler qualquer um deles direto produz `undefined`
 * — e `undefined` em conta de interpolação vira `NaN`, que é a pior falha
 * possível aqui: o corpo some da tela sem erro nenhum, porque o Three.js
 * simplesmente não desenha uma matriz com `NaN`. Daí o `?? 0` em tudo, inclusive
 * nos vetores.
 */
export function unpackFighter(s, out) {
  const p = s.p ?? VEC_ZERO;
  const v = s.v ?? VEC_ZERO;
  out.x = p[0] ?? 0;
  out.y = p[1] ?? 0;
  out.z = p[2] ?? 0;
  out.vx = v[0] ?? 0;
  out.vy = v[1] ?? 0;
  out.vz = v[2] ?? 0;
  out.yaw = s.y ?? 0;
  out.pitch = s.i ?? 0;
  out.roll = s.r ?? 0;
  out.gaitPhase = s.g ?? 0;
  out.runBlend = s.n ?? 0;
  out.flyBlend = s.fl ?? 0;
  out.boostBlend = s.bo ?? 0;
  out.chargeBlend = s.ch ?? 0;
  out.specialFraction = s.sp ?? 0;
  out.specialIndex = s.sk ?? -1;
  out.hurtBlend = s.hu ?? 0;
  out.lastHand = s.ha ?? 0;
  out.handPose = s.hp ?? 0;
  const b = s.b ?? 0;
  out.down = (b & 1) === 1;
  out.invuln = (b & 2) === 2;
  out.tonto = (b & 4) === 4;
  out.defendendo = (b & 8) === 8;
  /** Super Saiyajin — o bit 16. Ver `packFighter`. */
  out.ssj = (b & 16) === 16;
  return out;
}

/** Lido quando a pose chega sem posição ou sem velocidade. Ver `unpackFighter`. */
const VEC_ZERO = [0, 0, 0];

/* -------------------------------------------------------------------- ids --- */

/*
 * Espaço de nomes PRÓPRIO. Os ids do arqueiro (`p3`, `b7`) não circulam aqui e
 * os daqui não circulam lá — as duas salas não se falam —, mas o prefixo
 * continua valendo a pena pelo motivo de sempre: um log de rede em que se lê
 * `k4` e `q12` se explica sozinho.
 */
/** `k` de Kakarot: um lutador. */
export const fighterEntity = (id) => `k${id}`;
/** `q` de ki: uma bola em voo. */
export const blastEntity = (id) => `q${id}`;

/* ------------------------------------------------------------------ nomes --- */

/* A limpeza de nome é a MESMA do arqueiro, e é importada de lá em vez de
   copiada: é a única coisa deste protocolo que já existe pronta, é código de
   segurança (as faixas de caractere invisível), e duas cópias de uma defesa são
   uma defesa que envelhece em metades. Importar não acopla nada — `protocol.js`
   é puro e não conhece sala nenhuma. */
export { sanitizeName, displayName } from "../protocol.js";

/* ---------------------------------------------------------------- vetores --- */

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

/** Posição com precisão de milímetro. */
export function r3v(v) {
  return [r3(v.x), r3(v.y), r3(v.z)];
}

/** Velocidade com precisão de centímetro por segundo: de sobra, e menos bytes.
 *  Ela só alimenta extrapolação de 100 ms — o terceiro decimal ali é ruído. */
export function r2v(v) {
  return [r2(v.x), r2(v.y), r2(v.z)];
}

export function vecFrom(a) {
  return { x: a[0], y: a[1], z: a[2] };
}
