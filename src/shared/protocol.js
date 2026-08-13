/* ---------------------------------------------------------------------------
   O protocolo, num arquivo só — importado pelo cliente E pelo servidor.

   Tudo é JSON. Nessa escala (12 jogadores, ~10 KB/s por cliente) o binário não
   compraria nada que valha perder a legibilidade: um bug de rede se resolve
   abrindo a aba Network e LENDO o que passou, e isso vale mais do que os bytes.

   Duas convenções que explicam o formato:

   • Chaves curtas nas mensagens de alta frequência (`state`, `boars`), longas
     nas de evento. O `state` sai 20 vezes por segundo por jogador; o `welcome`,
     uma vez na vida.

   • Coordenadas viajam como array `[x, y, z]`, não como `{x,y,z}`. É metade dos
     bytes e não custa nada de clareza porque só existe uma ordem possível.

   Uma reserva importante: **`t` é sempre o TIPO da mensagem**, nunca um tempo.
   Instantes usam `w` (de *when*). Não é gosto — um payload com `t` sobrescrevia
   o tipo, o servidor recebia uma mensagem que não sabia rotear e nada quebrava:
   simplesmente nunca acontecia nada do outro lado.
   --------------------------------------------------------------------------- */

/**
 * Sobe quando o formato quebra. O servidor recusa quem não bate.
 *
 * 2 — entraram alces, pássaros e o reinício de mundo, e a mensagem de morte
 * passou a carregar o impacto (`c`, `v`) que alimenta o corpo mole. Uma aba
 * antiga que continuasse conectada não veria bicho nenhum e cairia sempre para
 * o mesmo lado: melhor recusar e pedir para recarregar do que deixar duas
 * pessoas jogando partidas diferentes na mesma sala.
 *
 * 3 — entrou o modo zumbi, com hordas, vidas, tochas quebráveis e um sexto
 * valor possível para `mode`. Uma aba antiga que continuasse conectada veria a
 * sala anunciar um modo que ela não sabe desenhar: ficaria de dia, sem tochas e
 * sem zumbi nenhum, atirando num campo vazio enquanto todos os outros defendem
 * um quadrado de luz.
 *
 * 4 — vento na flecha sincronizado pela sala, fim da série com placar de
 * vitória, e hordas de zumbi por tabela. Uma aba antiga divergiria na física
 * da flecha e reiniciaria a série no último alvo.
 *
 * 5 — caçada ao alce com fim de partida (vitória/derrota), respawn longo do
 * jogador e placar de flechas/golpe final. Uma aba antiga não mostraria a
 * tela de vitória nem o countdown de renascimento.
 *
 * 6 — `spawn` passou a poder trazer o rumo da câmera (`yaw`) e `elkHit` avisa
 * quando a investida foi quebrada. Uma aba antiga nasceria de costas para o
 * alce e não explicaria por que o bicho desistiu no meio da corrida.
 *
 * 7 — entrou a pose curta do golpe de faca e o comando de melee.
 *
 * 8 — o golpe de faca também passou a ter um canal próprio para acertar players.
 *
 * 9 — entrou o modo caça aos pássaros (`birdHunt`), com pássaro raro e placar
 * de vitória. Uma aba antiga não saberia desenhar o modo nem a tela final.
 *
 * 10 — preparação coordenada da noite dos zumbis. A sala espera os clientes
 * aquecerem os shaders e limparem a fauna antes de confirmar a troca.
 *
 * 11 — entraram as FASES: o jogo deixou de ter um cenário só. A pose passou a
 * carregar o estado do jetpack (`j`), sem o qual o arqueiro alheio sobe pelo ar
 * na Lua com as costas apagadas e nada explicando por que ele voa.
 *
 * 12 — os adversários de CPU deixaram de ser locais e passaram a viver na
 * sala, como os porcos e os zumbis. Antes cada cliente hospedava os próprios e
 * ninguém mais os via: dois amigos jogavam contra adversários invisíveis um
 * para o outro. Uma aba antiga veria os outros atirando em alguém que, para
 * ela, não existe — e levaria flechada de um arqueiro que não está lá.
 *
 * 13 — a fase da Lua deixou de ser cenário local. Alien, nave, rover, nave de
 * transporte e meteorito passaram a viver na sala, porque todos eles MATAM ou
 * CARREGAM alguém: com um mundo por aba, duas pessoas morriam de coisas
 * diferentes e o passageiro de um rover flutuava no ar para o outro.
 *
 * 14 — a sala deixou de ser uma só. O `hello` passou a carregar a ENTRADA
 * escolhida na tela inicial (`level` e `mode`), e cada uma delas é um lugar:
 * quem clica na Lua encontra quem está na Lua. Uma aba antiga não manda campo
 * nenhum e cairia sempre no vale — inclusive a de quem esperava a horda. Junto,
 * a nave de transporte saiu de cena e o `mode` passou a carregar o `roster` da
 * sala, que é o que conserta o bot que ficava parado após uma troca de fase.
 *
 * 15 — entrou a CHUVA DE METEOROS, com um sétimo valor para `mode`, rochas que
 * caem em canal próprio e um fim de partida por impacto no chão. Junto veio o
 * ESPECIAL: a pose passou a carregar `q`, a fração da animação do Kamehameha,
 * e o feixe viaja como um evento do qual cada cliente reconstrói a vida
 * inteira. Uma aba antiga veria a sala anunciar um modo que ela não desenha —
 * céu vazio, ninguém entendendo por que a partida acabou — e um arqueiro
 * parado em pose de tiro soltando um raio invisível que mata.
 *
 * 16 — entraram os dois modos de ARENA. O ÚLTIMO EM PÉ quebra a regra mais
 * antiga do jogo: quem morre não renasce, e passa a assistir em câmera livre.
 * Uma aba antiga esperaria o `SPAWN` que nunca vem e ficaria com o corpo caído
 * para sempre, sem entender que a partida continua sem ela. O ROUBA BANDEIRA
 * trouxe um objeto que se pega, se carrega e se entrega — e uma aba antiga não
 * desenharia a bandeira nem saberia dizer quem está com ela, que é a única
 * informação que o modo pede para ser jogável.
 *
 * 17 — o arqueiro ganhou SKINS. O `hello` passou a carregar o corpo escolhido e
 * a visão pública de um jogador passou a incluí-lo, ao lado do nome e da cor.
 *
 * Este é o único item da lista que NÃO quebraria nada se ficasse calado: campo
 * ausente cai no padrão, e uma aba antiga jogaria vendo todo mundo de atleta. É
 * justamente por isso que a versão subiu — o sintoma seria uma sala em que cada
 * pessoa vê um jogo diferente, sem nenhum aviso, e "recarregue a página" é uma
 * resposta muito melhor do que um mistério silencioso.
 *
 * 18 — entrou o CERCO AO CASTELO, e com ele a primeira mensagem BINÁRIA do
 * jogo. Uma aba antiga receberia um `ArrayBuffer` onde espera texto, falharia
 * calada no `JSON.parse` (o `catch` engole) e jogaria um cerco sem sitiante
 * nenhum: muralha, portão rachando sozinho e a partida terminando sem que nada
 * tenha aparecido na tela. É o pior tipo de incompatibilidade — a que não
 * levanta erro — e é exatamente o que a versão existe para evitar.
 */
export const PROTOCOL_VERSION = 20;

/* --------------------------------------------------------- cliente → servidor */

export const C2S = {
  /** Entrada na sala: `{ name, version, level, mode, skin }`.
   *  `level` e `mode` são a ESCOLHA DA PORTA (ver `ui/lobby.js`): eles decidem
   *  em que sala esta conexão entra, e não mudam nada dentro dela.
   *  `skin` é o corpo, e viaja SÓ aqui — a sala o guarda e o repassa na visão
   *  pública do jogador, como o nome e a cor. */
  HELLO: "hello",
  /** Pose própria, 20 Hz: `{ s: packState(), w: quandoFoiCapturada }`. */
  STATE: "state",
  /** Disparo: `{ id, o:[x,y,z], d:[x,y,z], v:speed, w:quandoSaiu }`. */
  SHOT: "shot",
  /** Impacto da PRÓPRIA flecha — quem atirou é a autoridade. */
  IMPACT: "impact",
  /** "Matei fulano": `{ victim, arrow }`. */
  KILL: "kill",
  /** Pedido de renascimento manual (tecla K). */
  RESPAWN: "respawn",
  /** Pedido de modo de jogo: `{ mode }`. */
  MODE: "mode",
  /** Pedido de FASE: `{ level }`. Leva a sala inteira, sem convite. */
  LEVEL: "level",
  /** Cliente terminou de preparar uma troca: `{ mode, token }`. */
  MODE_READY: "modeReady",
  /** "Acertei este porco": `{ id, distance }`. */
  BOAR_HIT: "boarHit",
  /** Soltar um porco avulso, só por diversão — não vale ponto. */
  SPAWN_BOAR: "spawnBoar",
  /** "Acertei este alce": `{ id }`. O dano e a morte quem decide é a sala. */
  ELK_HIT: "elkHit",
  /** Soltar um alce avulso (tecla L), em qualquer modo. */
  SPAWN_ELK: "spawnElk",
  /** Antecipar horda de lobos na caçada ao alce (tecla O, teste). */
  SPAWN_ELK_WOLVES: "spawnElkWolves",
  /** "Acertei este pássaro": `{ id }`. */
  BIRD_HIT: "birdHit",
  /** "Acertei o alvo da série": `{ seq }`. */
  SERIES_HIT: "seriesHit",
  /** Liga/desliga o vento na flecha para a sala: `{ on?: boolean }`. */
  WIND: "wind",
  /** Zerar o placar de todos. */
  RESET_SCORES: "resetScores",
  /** "Acertei este zumbi": `{ id, head, d, v, c? }`. `c` = contato (chefão). */
  ZOMBIE_HIT: "zombieHit",
  /** "Matei este zumbi/lobo com a faca": `{ id, d }`. */
  KNIFE_HIT: "knifeHit",
  /** "Acertei este player com a faca": `{ victim, p, d }`. */
  KNIFE_PLAYER_HIT: "knifePlayerHit",
  /** "Acertei esta tocha": `{ i }`. Apaga a chama e a luz dela. */
  TORCH_HIT: "torchHit",
  /** Sincronismo de relógio: `{ c: clientClock }`. */
  PING: "ping",
  /** Põe ou tira um adversário de CPU: `{ remove?: boolean }`. */
  BOT: "bot",
  /** Muda a perícia dos bots: `{ step: 1 | -1 }` ou `{ level: "easy" }`. */
  BOT_DIFFICULTY: "botDifficulty",
  /** "Acertei esta coisa do espaço": `{ kind: "alien"|"ship"|"meteor", id }`.
   *  Quem atira continua sendo a autoridade sobre o próprio acerto; quem decide
   *  se o alvo caiu é a sala, que é uma só para todo mundo. */
  SPACE_HIT: "spaceHit",
  /** "Acertei esta rocha": `{ id, d, kame? }`. Quem atira é a autoridade sobre
   *  o próprio acerto; quem decide se ela estourou é a sala. */
  METEOR_HIT: "meteorHit",
  /** "Disparei o especial": `{ o:[x,y,z], d:[x,y,z], w }`.
   *  A direção é TRAVADA aqui — girar depois não entorta o feixe. */
  KAME: "kame",
  /** "O meu feixe está apoiado no chão AQUI": `{ p:[x,y,z] }`.
   *
   *  Quem atira é a autoridade sobre onde a ponta do feixe parou — é a mesma
   *  conta do `C2S.IMPACT` da flecha, e pelo mesmo motivo: o cliente tem o
   *  terreno e a sala não tem malha. Quem decide QUEM morreu na área continua
   *  sendo a sala (ver `Room.registerKameBlast`), porque é ela que tem a vida
   *  de cada bicho.
   *
   *  Repetido a cada `special.groundBlast.interval` enquanto o feixe seguir
   *  apoiado: ele dura três segundos e varre o chão se o jogador tiver mirado
   *  na rampa, e uma onda só no primeiro contato faria o resto da sustentação
   *  não valer nada. */
  KAME_BLAST: "kameBlast",

  /* ------------------------------------------------------------------ cerco -- */
  /** "Acertei este sitiante": `{ id, head, d }`. Mesmo contrato da flecha em
   *  todo o resto do jogo — quem atira é a autoridade sobre o próprio acerto,
   *  e a sala decide o que é compartilhado (se caiu, quanto vale, se o pavês
   *  aparou). Ver `Siege.hit`. */
  SIEGE_HIT: "siegeHit",
  /** "Estourei a bola de magia no ar": `{ bid }`.
   *
   *  Mesmo contrato de sempre — quem atira é a autoridade sobre o próprio
   *  acerto —, e a sala é quem cancela a morte agendada (`Siege.cancelarRaio`).
   *  É a única ameaça do modo que se desfaz depois de anunciada, e é ela que dá
   *  ao mago uma resposta que não seja só sair da frente. */
  BOLT_HIT: "boltHit",
  /** "Soltei o trabuco": `{ i, o:[x,y,z], d:[x,y,z], v }`.
   *
   *  A pedra é um EVENTO DE UM JOGADOR, como a flecha, e por isso viaja como
   *  parâmetro de disparo em vez de pose a 10 Hz: os outros clientes replantam
   *  a mesma parábola localmente. Custo de rede por quadro: zero. */
  TREB_SHOT: "trebShot",
  /** "A pedra caiu aqui": `{ i, p:[x,y,z] }`. Separado do disparo porque é a
   *  sala que decide quem morreu no estouro — isso é placar. */
  TREB_IMPACT: "trebImpact",
  /** "Estou na manivela do trabuco i": `{ i, on }`. */
  TREB_WIND: "trebWind",
  /** "Estou reparando o portão": `{ on }`. */
  GATE_REPAIR: "gateRepair",
  /** "Acertei este morcego": `{ id }`. Uma flecha basta; a sala confirma. */
  BAT_HIT: "batHit",
  /** "Adianta o cerco até o próximo escalão": `{}`. Atalho de TESTE.
   *
   *  O modo abre os escaladores aos 105 s, os xamãs aos 165 e as catapultas aos
   *  450 — esperar isso a cada verificação é meia hora de relógio por tarde de
   *  ajuste. Ele vale para a sala inteira (o cerco é um só) e por isso passa
   *  pelo servidor como qualquer outra mudança de estado compartilhado. */
  SIEGE_SKIP: "siegeSkip",

  /** "Enche a minha barra do especial": `{}`. Atalho de TESTE.
   *
   *  Dez abates por disparo é o preço certo em jogo e é caro demais em bancada:
   *  verificar uma linha do feixe custava uma horda inteira, e a alternativa que
   *  se usava — baixar `hitsToCharge` no config e esquecer de subir — é a que
   *  vaza para o jogo de verdade.
   *
   *  Ele enche SÓ A DE QUEM PEDIU. É a diferença para o `SIEGE_SKIP`, que
   *  adianta o relógio da sala inteira porque o cerco é um só: aqui não há nada
   *  compartilhado, e encher a barra dos outros seria decidir pelos outros. */
  KAME_FILL: "kameFill",
};

/* --------------------------------------------------------- servidor → cliente */

export const S2C = {
  /** Aceito: `{ you, time, snapshot }`. */
  WELCOME: "welcome",
  /** Recusado: `{ reason, players, max }`. */
  REJECT: "reject",
  /** Alguém entrou: `{ player }`. */
  JOIN: "join",
  /** Alguém saiu: `{ id, name }`. */
  LEAVE: "leave",
  /** Poses de todos os OUTROS, 20 Hz: `{ time, s: [ ... ] }`. */
  STATES: "states",
  /** Retransmissão de disparo, com `owner`. */
  SHOT: "shot",
  /** Retransmissão de impacto, com `owner` e `distance`. */
  IMPACT: "impact",
  /** Morte confirmada: `{ victim, killer }`. */
  KILL: "kill",
  /** Onde nascer: `{ id, x, z, y, drop, invulnUntil, yaw? }`. `yaw` só vem
   *  quando a sala quer decidir para onde a pessoa olha (caçada ao alce). */
  SPAWN: "spawn",
  /** Estado dos modos: `{ mode, level, invites, roster, … }`.
   *  `roster` é a lista COMPLETA de quem tem corpo em campo — humanos e CPU.
   *  O cliente reconcilia a coleção de bonecos com ela em vez de confiar no
   *  histórico de `join`/`leave`. Ver `Room.modeView`. */
  MODE: "mode",
  /** Preparação de modo: `{ mode, token, ready, total }`. */
  MODE_PREPARE: "modePrepare",
  /** Cancela uma preparação que não chegou a virar troca. */
  MODE_PREPARE_CANCEL: "modePrepareCancel",
  /** Transformações dos porcos, 10 Hz. */
  BOARS: "boars",
  /** Porco morto: `{ id, killer, points, distance }`. */
  BOAR_DEATH: "boarDeath",
  /** Nova onda da caçada: `{ n, size }`. Vira faixa na tela e toque de trompa. */
  WAVE: "wave",
  /**
   * A caçada acabou: a quinta onda esgotou.
   * `{ ranking: [{ id, name, color, boars }, ...] }`, do maior abatedor ao
   * menor. Vira a tela de vitória — os porcos que sobraram continuam vivos.
   */
  HUNT_OVER: "huntOver",
  /** Transformações dos alces, 10 Hz — com a fração de vida de cada um. */
  ELKS: "elks",
  /** Alce levou uma flecha: `{ id, health, killer }` — dor, não morte. */
  ELK_HIT: "elkHit",
  /** Alce derrubado: `{ id, killer, points }`. */
  ELK_DEATH: "elkDeath",
  /** Alce chifrou alguém: a morte vem pela mensagem `KILL`, esta é o aviso. */
  ELK_GORE: "elkGore",
  /** Caídos e fim da caçada ao alce. Ver `Room.elkStatus()`. */
  ELK_STATUS: "elkStatus",
  /**
   * A caçada ao alce acabou.
   * `{ reason: "win"|"wipe", ranking?, finisher? }`.
   * Vitória carrega o placar de flechas e quem deu o golpe final.
   */
  ELK_OVER: "elkOver",
  /** Transformações dos pássaros, 10 Hz. */
  BIRDS: "birds",
  /** Pássaro abatido: `{ id, killer, points, special? }`. */
  BIRD_DEATH: "birdDeath",
  /**
   * A caça aos pássaros acabou.
   * `{ reason: "count"|"special", winner, ranking: [{ id, name, color, birds }] }`.
   */
  BIRD_HUNT_OVER: "birdHuntOver",
  /**
   * O mundo recomeçou (troca de modo).
   *
   * Existe porque "trocar de modo" passou a significar recomeçar de verdade:
   * bichos, flechas cravadas e placar. Sem uma mensagem própria, cada cliente
   * teria de deduzir isso da mudança de modo — e deduzir dá margem a cada um
   * limpar uma coisa diferente.
   */
  WORLD_RESET: "worldReset",
  /** O alvo da vez na série (ou null quando o modo sai). */
  SERIES: "series",
  /** Alvo da série derrubado — explosão, pontos e o próximo. */
  SERIES_HIT: "seriesHit",
  /**
   * A série acabou: o último alvo caiu.
   * `{ ranking: [{ id, name, color, targets, points }, ...] }`.
   */
  SERIES_OVER: "seriesOver",
  /** Vento na flecha (sala): `{ on, silent? }`. */
  WIND: "wind",
  /** Placar completo (sempre que muda). */
  SCORES: "scores",
  /** Alguém zerou o placar: `{ by }`. */
  SCORES_RESET: "scoresReset",
  /** A perícia dos bots mudou: `{ level }`. Vira aviso na tela de todos. */
  BOT_DIFFICULTY: "botDifficulty",
  /** Tudo o que se mexe na Lua, 10 Hz: `{ a, s, m, r, d }` — aliens, naves,
   *  meteoritos, rover e nave de transporte. Só sai na fase lunar. */
  SPACE: "space",
  /** Acontecimento do espaço que não cabe numa amostra de 10 Hz:
   *  `{ kind: "explosion"|"meteorBurst", p, r, seed? }`. */
  SPACE_EVENT: "spaceEvent",
  /** Placar do duelo de times: `{ humans, bots }`. */
  TEAM_SCORES: "teamScores",
  /** Transformações dos zumbis, 10 Hz: `{ z: [...] }`. */
  ZOMBIES: "zombies",
  /** Chefão levou flecha: `{ id, c?, head }` — clarão vermelho nas outras telas. */
  ZOMBIE_HIT: "zombieHit",
  /** Zumbi derrubado: `{ id, killer, points, head }`. `head` = pegou fogo. */
  ZOMBIE_DEATH: "zombieDeath",
  /** Horda nova: `{ n, size, boss? }`. Vira a faixa "HORDA n" na tela. */
  HORDE: "horde",
  /** Estado das quatro tochas: `{ t4: [true,true,false,true] }`.
   *  A chave é `t4` e não `t` porque `t` é o tipo da mensagem — ver o cabeçalho. */
  TORCHES: "torches",
  /** Vidas, caídos e contadores do modo zumbi. Ver `Room.zombieStatus()`. */
  ZOMBIE_STATUS: "zombieStatus",
  /** Acabou: `{ reason, horde, ranking? }`. Todos caíram, ou a horda 10 foi
   *  vencida — só a vitória carrega `ranking` (abates e mortes de cada um),
   *  para a tela final. */
  ZOMBIE_OVER: "zombieOver",
  /* ------------------------------------------------------ chuva de meteoros --
     Canal PRÓPRIO, e não o `SPACE` da Lua livre: lá o meteorito é uma rocha em
     deriva horizontal a 1,2 m/s que vai a 5 Hz (ver `SpaceField.view`). Esta
     cai a 17 m/s e anda 1,75 m entre amostras a 10 Hz — a 5 Hz seriam 3,5 m, e
     3,5 m é mais que o raio da maior rocha comum: a interpolação começaria a
     mentir sobre onde mirar. */
  /** Rochas em queda, 10 Hz: `{ time, m: [{ i, p, r, k, hp, f }] }`. */
  METEORS: "meteors",
  /** Rocha levou flecha: `{ id, by, left, p }`. É o PISCAR nas outras telas —
   *  em co-op, a mensagem mais importante do modo: *aquela ali já tem dono*. */
  METEOR_HIT: "meteorHit",
  /** Estourou no ar: `{ id, p, seed, r }`. Os estilhaços deste modo NÃO matam;
   *  o servidor nem os integra, só manda a semente. */
  METEOR_BURST: "meteorBurst",
  /** Encostou no chão: `{ p, r }`. Vem colado com o `METEOR_OVER`. */
  METEOR_IMPACT: "meteorImpact",
  /** Estado do modo: `{ horde, hordes, rocks, tank, startsAt }`.
   *  `startsAt` é o INSTANTE ABSOLUTO no relógio da sala em que a horda 1
   *  começa, não uma contagem regressiva — é o que faz o relógio ser o mesmo em
   *  todas as telas e o retardatário não ver contagem nenhuma, sem uma linha
   *  escrita para o caso dele. */
  METEOR_STATUS: "meteorStatus",
  /** Acabou: `{ reason: "win"|"impact", horde, ranking? }`. */
  METEOR_OVER: "meteorOver",

  /* ---------------------------------------------------------------- especial --
     O feixe viaja como UM evento, e cada cliente reconstrói frente, cauda,
     afinamento e explosão a partir dele — porque tudo isso é função pura de
     (origem, direção, tempo desde o disparo). É o mesmo contrato da flecha. */
  /** Alguém soltou o especial: `{ owner, o, d, w }`. ~60 bytes. */
  KAME: "kame",
  /** A barra de alguém mudou: `{ id, charge, max }`. Saber que o companheiro
   *  está carregado é informação de verdade num modo cooperativo. */
  KAME_CHARGE: "kameCharge",

  /* --------------------------------------------------------- o último em pé --
     A morte é definitiva, e por isso ela precisa de canal próprio: `KILL` diz
     que alguém caiu, e só. Quem ainda está de pé — e quando sobrou um — é uma
     conta que a SALA faz, e mandá-la pronta evita que doze abas cheguem a doze
     respostas ligeiramente diferentes sobre quem ganhou. */
  /** Quem ainda está vivo: `{ alive: [{id,name,color}], eliminated, total }`. */
  STAND_STATUS: "standStatus",
  /** Acabou: `{ winner, winnerName, winnerColor, ranking }`. `winner: null`
   *  quando ninguém sobrou (o último caiu para o cenário, não para alguém). */
  STAND_OVER: "standOver",

  /* ---------------------------------------------------------- rouba bandeira --
     A bandeira vai em canal próprio, a 10 Hz, junto do estado dos times.
     Ela é UM objeto: uma mensagem pequena, e nela cabe tudo o que o cliente
     precisa para desenhar o objeto E para dizer, em letras grandes, quem está
     com ele. Ver `entities/flag.js`. */
  /** Estado da bandeira e do placar: ver `Room.flagView()`. */
  FLAG: "flag",
  /** Acontecimento da bandeira: `{ kind: "pickup"|"drop"|"capture"|"return",
   *  by?, byName?, team?, p? }`. É o que vira faixa na tela e som. */
  FLAG_EVENT: "flagEvent",
  /** Acabou: `{ winner: "humans"|"bots", scores, ranking }`. */
  FLAG_OVER: "flagOver",

  /* ------------------------------------------------------------------ cerco --
     O ÚNICO canal binário do jogo, e a razão dele está em `Siege.packFrame`:
     120 sitiantes em JSON a 10 Hz para quatro clientes são 380 KB/s de subida.
     O quadro binário são 10 B por bicho — 12 KB/s por cliente.

     Ele não tem campo `t` como todas as outras mensagens: o tipo é o primeiro
     BYTE do quadro, e é assim que o cliente separa um `ArrayBuffer` de cerco de
     qualquer outro que venha a existir. Ver `FRAME` abaixo. */
  /** Estado da partida, 2 Hz, em JSON: ver `Siege.status()`. */
  SIEGE_STATUS: "siegeStatus",
  /** Escalão novo: `{ nome, kind }`. Vira trompa e faixa na tela — é o único
   *  resquício da mecânica de onda, e ele existe porque a primeira aparição de
   *  uma espécie precisa ser vista ANTES de ser um problema. */
  SIEGE_TIER: "siegeTier",
  /** Sitiante derrubado: `{ id, killer, points, kind, head }`. */
  SIEGE_DEATH: "siegeDeath",
  /** O pavês aparou: `{ id }`. Vira o "clang" e nenhum dano — a informação de
   *  que o ângulo estava errado, que é o que ensina o §6.4 do plano. */
  SIEGE_BLOCK: "siegeBlock",
  /** Tiro de xamã ou catapulta: `{ kind, from, to, speed?, flight? }`. */
  SIEGE_SHOT: "siegeShot",
  /** O portão levou pancada: `{ f }` — fração de vida. Vira o baque e o
   *  tranco. A FREQUÊNCIA dos baques é a leitura da fila, e é o único canal
   *  que informa sem exigir que se tire os olhos da mira. */
  GATE_HIT: "gateHit",
  /** O portão caiu. Fim de partida, e vem colado com `SIEGE_OVER`. */
  GATE_FALL: "gateFall",
  /** A pedra caiu: `{ p, seed }`. Estouro, piche em chamas e estilhaços. */
  TREB_IMPACT: "trebImpact",
  /** Estado dos três engenhos: `{ e: [{ i, ready, wind }] }`. */
  TREB_STATE: "trebState",
  /** Acabou: `{ reason: "dusk"|"gate", ranking }`.
   *  `dusk` é a VITÓRIA — o Sol tocou o horizonte e eles recuaram. O cerco é
   *  uma tarde, não uma noite: ver `Game.updateDusk`. */
  SIEGE_OVER: "siegeOver",
  /** Poses dos morcegos, a 10 Hz: `{ b: [{ i, p, y, s }] }`.
   *
   *  EM JSON, e de propósito: são no máximo quatro bichos, ~60 B cada. O quadro
   *  binário do cerco existe porque lá são 120; a mesma conta que o justifica lá
   *  o descarta aqui. Ver o cabeçalho de `server/batSim.js`. */
  BATS: "bats",
  /** Morcego abatido: `{ id, killer, points, p }`. Vira estouro e placar. */
  BAT_DEATH: "batDeath",

  /** Resposta do sincronismo: `{ c, s }`. */
  PONG: "pong",
};

/**
 * Os quadros BINÁRIOS, por primeiro byte.
 *
 * Um número e não uma string porque o quadro inteiro existe para caber em dez
 * bytes por bicho; um campo de texto no cabeçalho seria mais caro que a metade
 * de um sitiante.
 */
export const FRAME = {
  /** As poses do cerco. Ver `Siege.packFrame` e `systems/siege.js`. */
  SIEGE: 1,
};

export const RejectReason = {
  FULL: "full",
  VERSION: "version",
  KEY: "key",
};

/**
 * Fechamento por chave da sala inválida.
 *
 * É um CÓDIGO DE FECHAMENTO e não um `REJECT` porque a recusa acontece antes de
 * existir uma sala com quem falar: o servidor barra no `upgrade`, sem nunca
 * aceitar a conexão. A faixa 4000+ é a reservada à aplicação, e o navegador a
 * entrega intacta em `event.code` — que é justamente o que um `socket.destroy()`
 * não faria (toda queda crua chega como 1006).
 */
export const CLOSE_BAD_KEY = 4003;

/* ------------------------------------------------------------------ estado -- */

/**
 * A pose de um arqueiro, compactada.
 *
 * Vão junto a posição, os ângulos de mira E a fase da marcha. Mandar a fase é o
 * que faz as pernas do outro andarem de verdade: o `Player.update()` já monta o
 * corpo inteiro a partir desses números, então não é preciso transmitir osso
 * nenhum — só o relógio da caminhada.
 */
export function packState(player) {
  return {
    p: round3(player.position),
    y: r3(player.yaw),
    i: r3(player.pitch),
    g: r3(player.gaitPhase),
    b: r3(player.gaitBlend),
    r: r3(player.runBlend),
    d: r3(player.drawFraction),
    l: r3(player.reloadFraction ?? 0),
    k: r3(player.knifeFraction ?? 0),
    f: r3(player.moveF),
    s: r3(player.moveS),
    a: player.airborne ? 1 : 0,
    // Jato aceso. Um bit, e é o que faz a chama do amigo existir na sua tela.
    j: player.jetFlame > 0.01 ? 1 : 0,
    /* A ANIMAÇÃO INTEIRA DO ESPECIAL, num número.
     *
     * Sete segundos de pose — concha no quadril, esfera crescendo, empurrão,
     * tremor, retorno — cabem numa fração de 0 a 1 porque o corpo do jogo é
     * montado por procedimento (`poseKamehameha`), não por animação gravada.
     * É o mesmo truque do `k` da faca, e é o que faz todo mundo ver a carga do
     * companheiro sem uma única mensagem nova. */
    q: r3(player.kameFraction ?? 0),
  };
}

/** Escreve um `packState()` num objeto simples (amostra do buffer de interpolação). */
export function unpackState(state, out) {
  out.x = state.p[0];
  out.y = state.p[1];
  out.z = state.p[2];
  out.yaw = state.y;
  out.pitch = state.i;
  out.gaitPhase = state.g;
  out.gaitBlend = state.b;
  out.runBlend = state.r;
  out.drawFraction = state.d;
  out.reloadFraction = state.l ?? 0;
  out.knifeFraction = state.k ?? 0;
  out.moveF = state.f;
  out.moveS = state.s;
  out.airborne = state.a === 1;
  // `?? 0` porque a pose pode vir de um cliente que ainda não tem jetpack
  // nenhum: fora da Lua o campo não significa nada.
  out.jetFlame = state.j ?? 0;
  out.kameFraction = state.q ?? 0;
  return out;
}

/* ------------------------------------------------------------------- nomes -- */

// Faixas de caracteres invisíveis que não podem entrar num nome: controle C0 e
// C1, largura zero, marcas de direção e o BOM. Não é preciosismo — são eles que
// produzem nomes idênticos na tela mas diferentes na memória, nomes que parecem
// vazios, e texto que se reordena sozinho ao ser desenhado.
const INVISIBLE = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];

/**
 * Limpa um nome vindo da rede.
 *
 * NÃO escapa HTML de propósito: quem desenha na tela usa `textContent`, e
 * escapar aqui só produziria etiquetas cheias de `&amp;`. A defesa mora no
 * ponto de saída — que é onde ela não pode ser esquecida.
 */
export function sanitizeName(raw, max) {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const c = ch.codePointAt(0);
    if (INVISIBLE.some(([lo, hi]) => c >= lo && c <= hi)) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

/** O nome pronto para a tela: nunca vazio, nunca só espaço. */
export function displayName(raw, max, fallback = "Arqueiro") {
  return sanitizeName(raw, max) || fallback;
}

/* ------------------------------------------------------------------- ids ---- */

/*
 * Ids de entidade com prefixo.
 *
 * O `entityRegistry` é um espaço de nomes só, e os ids da sala (1, 2, 3…) e os
 * dos porcos colidiriam nele — o jogador #2 e o porco #2 viram a mesma chave, e
 * uma flecha mirada num acerta o outro. O prefixo separa os dois espaços e, de
 * quebra, torna qualquer log de rede legível: `p3` e `b7` se explicam sozinhos.
 */
export const playerEntity = (id) => `p${id}`;
export const boarEntity = (id) => `b${id}`;
export const elkEntity = (id) => `e${id}`;
export const birdEntity = (id) => `v${id}`; // v de "voador": o `b` já é do porco
export const zombieEntity = (id) => `z${id}`;
export const torchEntity = (id) => `t${id}`;
// `m` de meteoro. Livre: p, b, e, v, z e t já estavam tomados.
export const meteorEntity = (id) => `m${id}`;
// `g` de morcego GIGANTE: `m` é do meteoro, `b` do porco e `v` do pássaro.
export const batEntity = (id) => `g${id}`;

/** O caminho de volta: `"p3"` → `3`. Devolve null se não for de jogador. */
export function playerIdFrom(entityId) {
  return idFrom(entityId, "p");
}

/** `"b7"` → `7`. */
export function boarIdFrom(entityId) {
  return idFrom(entityId, "b");
}

/** `"e2"` → `2`. */
export function elkIdFrom(entityId) {
  return idFrom(entityId, "e");
}

/** `"v9"` → `9`. */
export function birdIdFrom(entityId) {
  return idFrom(entityId, "v");
}

/** `"z12"` → `12`. */
export function zombieIdFrom(entityId) {
  return idFrom(entityId, "z");
}

/** `"t2"` → `2`. */
export function torchIdFrom(entityId) {
  return idFrom(entityId, "t");
}

/** `"m5"` → `5`. */
export function meteorIdFrom(entityId) {
  return idFrom(entityId, "m");
}

function idFrom(entityId, prefixo) {
  if (typeof entityId !== "string" || entityId[0] !== prefixo) return null;
  const n = Number(entityId.slice(1));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ vetores - */

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Vetor com precisão de milímetro — de sobra, e metade dos bytes. */
export function round3(v) {
  return [r3(v.x), r3(v.y), r3(v.z)];
}

export function vecFrom(a) {
  return { x: a[0], y: a[1], z: a[2] };
}
