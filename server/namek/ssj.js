/* ---------------------------------------------------------------------------
   O SUPER SAIYAJIN — a metade SALA, que é a que manda.

   O cliente prevê a transformação para o gesto responder no quadro em que a
   tecla desce (ver `src/namek/character/ssj.js`); quem DECIDE é este arquivo,
   pelo mesmo motivo que a sala decide todo o resto: vida e ki são dela (§8 do
   plano), e a transformação mexe nos dois.

   Ele vive fora de `room.js` de propósito. A sala já tem 2 200 linhas e sete
   assuntos; este é o oitavo, ele é fechado (um estado por lutador, quatro
   perguntas de economia, dois anúncios) e ele precisa de um vizinho que ainda
   está sendo escrito — o Freeza. Um assunto que depende de um arquivo que pode
   não existir é o último que se deve espalhar por dentro de outro.

   ============================================================================
   O FREEZA, LIDO COM CUIDADO
   ============================================================================

   `sala.freeza` é de outro autor e pode não existir ainda. TODA leitura dele
   aqui passa por `?.` e cai num padrão — e o padrão é o conservador: **sem
   chefe em campo, não há transformação.** É o que o pedido descreve ("durante a
   batalha com freeza") e é o que falha do lado seguro se o arquivo dele chegar
   depois: o modo continua exatamente como era antes desta feature.

   Duas grafias do mesmo estado são aceitas (`vivo` e `alive`) porque a sala usa
   `alive` nos lutadores e o plano do chefe fala em `vivo`. Aceitar as duas custa
   um `??` e evita que a feature inteira dependa de adivinhar uma palavra.

   ============================================================================
   AS FÓRMULAS SÃO GÊMEAS, OS NÚMEROS SÃO ÚNICOS
   ============================================================================

   As mesmas quatro contas existem em `src/namek/character/ssj.js`, e não é
   descuido: uma roda em Node e a outra no navegador, e o modo não tem um módulo
   compartilhado onde as duas caibam sem criar um arquivo novo em terreno de
   todo mundo. O que NÃO pode divergir são os valores, e eles não divergem: os
   dois lados leem `NAMEK.ssj`, que é do config compartilhado. Cada função aqui
   aponta para a gêmea pelo nome.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../src/shared/namek/config.js";
import { NS2C } from "../../src/shared/namek/protocol.js";

/* ================================================================ o chefe == */

/**
 * O Freeza está em campo e de pé?
 *
 * Escrito uma vez para que a leitura defensiva não se espalhe. Ver o cabeçalho:
 * na dúvida, a resposta é não.
 */
export function freezaEmCampo(sala) {
  const f = sala?.freeza;
  if (!f) return false;
  return (f.vivo ?? f.alive ?? false) === true;
}

/**
 * **O Freeza já foi DERRUBADO nesta partida?**
 *
 * A pergunta que destrava a transformação livre — *"após destruir o Freeza, o
 * Goku pode voltar a ser Super Saiyajin sempre que ele quiser… mas o Freeza tem
 * que estar morto"* —, e ela não é o contrário de `freezaEmCampo`: fora de campo
 * ele pode estar por nunca ter entrado, ou por ter sido RETIRADO (o clima
 * voltando para `dia` chama `sair()`, que não é morte). Só a queda conta.
 *
 * Quem guarda a marca é o boss (`NamekFreeza.derrotado`) e não este arquivo, pelo
 * mesmo motivo de sempre: é ele que sabe a diferença entre morrer e sair, e essa
 * diferença é a regra inteira. Lida com `?.` e com padrão conservador, como todo
 * o resto deste módulo — sem boss instalado, ninguém derrotou ninguém.
 */
export function freezaDerrotado(sala) {
  return sala?.freeza?.derrotado === true;
}

/**
 * A transformação está LIVRE — sem limiar de vida, sem chefe em campo?
 *
 * Uma função porque a mesma composição de duas chaves e um estado é feita em
 * três lugares (`podeAcender`, `manutencao` e a resposta ao `welcome`), e três
 * cópias de um `&&` é onde uma delas fica para trás.
 */
export function transformacaoLivre(sala) {
  return NAMEK.ssj.livreAposOFreeza === true && freezaDerrotado(sala);
}

/* ============================================================== a economia == */

/** Está transformado? Uma função e não `f.ssj === true` espalhado por aí: é o
 *  ponto único por onde a sala inteira faz esta pergunta. */
export function ativo(f) {
  return f?.ssj === true;
}

/**
 * O teto de vida deste lutador. GÊMEA de `vidaMaxima` no cliente.
 *
 * Ver o §"a vida no INSTANTE da virada" em `NAMEK.ssj` para o que acontece com
 * a vida ATUAL quando o teto sobe (resumo: ela sobe junto, o bônus inteiro).
 */
export function vidaMaxima(f) {
  return NAMEK.fighter.maxHealth + (ativo(f) ? NAMEK.ssj.vidaBonus : 0);
}

/**
 * O multiplicador de todo gasto de ki que NÃO é o especial — arranque, rajada,
 * onda e guarda. É o "seu ki demora mais para gastar".
 *
 * GÊMEO de `fatorDeGasto` no cliente.
 */
export function fatorDeGasto(f) {
  return ativo(f) ? NAMEK.ssj.kiDreno : 1;
}

/** O custo já multiplicado. É por aqui que os quatro gastos contínuos passam. */
export function custo(f, base) {
  return base * fatorDeGasto(f);
}

/** A fração da barra que o ESPECIAL exige. GÊMEA de `limiarDeEspecial`. */
export function limiarEspecial(f) {
  return ativo(f) ? NAMEK.ssj.limiar : NAMEK.ki.specialThreshold;
}

/** Quantos pontos de ki o especial custa. **Sem `fatorDeGasto`** — o desconto
 *  do especial é `especialCusto` e aplicar os dois cobraria 13 % da barra por
 *  um Kamehameha. Ver `NAMEK.ssj.kiDreno`. GÊMEA de `custoDeEspecial`. */
export function custoEspecial(f) {
  return NAMEK.ki.max * (ativo(f) ? NAMEK.ssj.especialCusto : 1);
}

/** A fração a partir da qual o arranque sai de graça. Em Super Saiyajin ela
 *  acompanha o limiar do especial, senão o voo de graça morreria no primeiro
 *  golpe — ver `NAMEK.ssj.voaDeGracaEm`. */
export function voaDeGracaEm(f) {
  return ativo(f) ? NAMEK.ssj.voaDeGracaEm : NAMEK.ki.freeFlightAt;
}

/* =============================================================== o dano ==== */

/**
 * **"Tiram mais life do freeza."** O dano de um golpe de jogador CONTRA O BOSS,
 * já com o multiplicador do Super Saiyajin.
 *
 * É a função que quem cobra o dano do chefe deve chamar no lugar de ler
 * `NAMEK.freeza.dano[kind]` direto — ela é a mesma leitura, com o `?.` e o
 * padrão que o config já documenta, mais o multiplicador de quem atirou.
 *
 * O padrão quando a tabela do chefe ainda não existe é o dano que o golpe faz
 * num JOGADOR (`damage`, ou `dps` para os que cobram por segundo, ou o da
 * rajada). Ele não é um chute: é a única resposta honesta disponível — "este
 * golpe tira do chefe o que ele tiraria de uma pessoa" — e ela mantém a
 * proporção entre os golpes, que é o que importaria numa tabela ausente.
 *
 * @param {object} atacante o lutador que soltou o golpe
 * @param {string} kind `"blast"` ou uma chave de `NAMEK.specials`
 * @returns {number} dano por acerto — ou por SEGUNDO, para quem tem `dps`
 */
export function danoNoFreeza(atacante, kind) {
  const tabela = NAMEK.freeza?.dano;
  const S = NAMEK.specials?.[kind];
  const base =
    tabela?.[kind] ??
    tabela?.blast ??
    S?.damage ??
    S?.dps ??
    NAMEK.blast.damage;
  return base * (ativo(atacante) ? NAMEK.ssj.danoNoFreeza : 1);
}

/**
 * Só o multiplicador, para quem já tem o dano na mão.
 *
 * Ele é 1 contra qualquer coisa que não seja o chefe — inclusive contra outros
 * jogadores, e isso é decisão e não esquecimento: ver o parágrafo final de
 * `NAMEK.ssj.danoNoFreeza`. Quem se transforma ganha fôlego, vida e cadência;
 * somar dano a isso faria da queixa óbvia uma queixa correta.
 */
export function ganhoContraFreeza(atacante) {
  return ativo(atacante) ? NAMEK.ssj.danoNoFreeza : 1;
}

/**
 * **"Os ataques do Freeza tiram bem menos life do player."**
 *
 * O espelho de `ganhoContraFreeza`: quanto do golpe do BOSS ainda passa. 0,45
 * para quem está transformado, 1 para todo mundo.
 *
 * Ela vale SÓ para o dano do chefe, e é por isso que ela é uma função à parte em
 * vez de um redutor no funil de `NamekRoom.aplicarDano`: por aquele funil passa
 * também o fogo amigo entre jogadores (que continua ligado e sem redutor
 * nenhum — ver o parágrafo do fogo amigo lá), a lava, a queda e o mar. Um
 * redutor genérico ali daria ao Super Saiyajin uma resistência a tudo que
 * ninguém pediu, e apagaria a assimetria que é o ponto: ele é forte CONTRA O
 * CHEFE, não contra a arena.
 *
 * Quem a chama é `NamekFreeza.bater`, que é a porta única dos quatro golpes do
 * boss (rajada, raio da morte, esfera da morte e onda) — aplicar lá cobre os
 * quatro e cobre o quinto que a recalibragem do boss inventar, sem esta função
 * precisar conhecer o nome de nenhum deles.
 *
 * A composição com a GUARDA está documentada em `NAMEK.ssj.danoDoFreeza`: os
 * dois se multiplicam (9,9 % do dano), e o que impede isso de virar imunidade é
 * o ki que a guarda escoa, não o número.
 */
export function resistenciaAoFreeza(vitima) {
  return ativo(vitima) ? NAMEK.ssj.danoDoFreeza : 1;
}

/* ======================================================== a transformação == */

/**
 * Este lutador pode virar Super Saiyajin AGORA?
 *
 * A mesma pergunta que o cliente faz em `podeAcender` para desenhar o alerta —
 * e aqui ela é a que vale. Cinco condições, e cada uma é uma regra:
 *
 * • vivo e de pé — quem está caído não se transforma (é o preço da queda, e o
 *   mesmo critério que já barra tiro, especial e onda em `atordoado`);
 * • ainda não transformado — a mensagem é idempotente por construção;
 * • o Freeza em campo, enquanto `NAMEK.ssj.exigeFreeza` estiver ligado;
 * • vida ≤ 30 % do teto BASE. Contra o teto base e não contra `vidaMaxima(f)`
 *   porque quem ainda não se transformou tem teto 100 por definição.
 *
 * ------------------------------------------- E DEPOIS QUE O CHEFE CAI, NENHUMA
 *
 * As duas últimas somem no instante em que o Freeza é derrubado — é o
 * `NAMEK.ssj.livreAposOFreeza`, e o pedido é literal: *"após destruir o Freeza,
 * ele pode virar Super Saiyajin sempre que ele quiser, não precisa mais estar
 * com aquele volume de vida específico… se ele morrer e voltar, mas o Freeza tem
 * que estar morto."*
 *
 * As DUAS primeiras continuam valendo, e continuam por serem de outra natureza:
 * elas não perguntam se ele merece a transformação, perguntam se o corpo está em
 * condição de fazer o gesto. Um cadáver e um corpo caído no chão não gritam.
 */
export function podeAcender(sala, f) {
  if (!f?.alive) return false;
  if (ativo(f)) return false;
  if (sala?.atordoado?.(f)) return false;
  /* A CONQUISTA. Uma linha, e ela responde por Namekusei e pelo espaço de uma
     vez — a pergunta é sobre o BOSS, não sobre onde o lutador está. */
  if (transformacaoLivre(sala)) return true;
  if (NAMEK.ssj.exigeFreeza && !freezaEmCampo(sala)) return false;
  return f.health <= NAMEK.fighter.maxHealth * NAMEK.ssj.gatilho;
}

/**
 * Liga a transformação e conta para a sala inteira.
 *
 * Três coisas no mesmo quadro, e a ordem importa:
 *
 * 1. o BIT sobe (`f.ssj`), e com ele o cabelo, a aura e a cor dos poderes na
 *    tela de todo mundo — pela pose, a 20 Hz;
 * 2. a INVENCIBILIDADE começa e dura os três segundos inteiros. Ela é escrita
 *    como um instante e não como um contador porque é assim que a sala já
 *    guarda a invulnerabilidade de nascimento (`invulnUntil`), e um segundo
 *    formato para a mesma ideia seria um segundo lugar para errar;
 * 3. a VIDA VAI AO TETO NOVO. *"Quando o player vira Super Saiyajin, toda a vida
 *    dele é recuperada."* São 220 cheios (`vidaMaxima`), e não mais os 30 + 120
 *    da regra antiga — ver `NAMEK.ssj.curaTotal`, que tem o argumento.
 *
 *    A chave existe porque a regra anterior ("soma o bônus na vida atual") tinha
 *    um motivo próprio e bem escrito, e apagá-la sem deixar o interruptor
 *    apagaria também a possibilidade de voltar atrás numa linha.
 *
 * O ki NÃO é enchido. A transformação não é um prêmio de recurso: ela muda o
 * preço das coisas, e encher a barra por cima disso daria três especiais de
 * graça no quadro seguinte ao aperto da tecla.
 */
export function acender(sala, f) {
  if (!podeAcender(sala, f)) return false;
  const agora = sala.now();
  f.ssj = true;
  f.ssjAte = agora + NAMEK.ssj.duracao * 1000;
  f.health = NAMEK.ssj.curaTotal
    ? vidaMaxima(f)
    : Math.min(vidaMaxima(f), f.health + NAMEK.ssj.vidaBonus);

  sala.broadcastAll({
    t: NS2C.SSJ_ON,
    id: f.id,
    w: agora,
    maxHealth: vidaMaxima(f),
    health: Math.round(f.health),
  });
  return true;
}

/**
 * Desliga — e só há dois caminhos até aqui: a morte e a queda do Freeza.
 *
 * **Não há relógio**, e o §"quando ela ACABA" em `NAMEK.ssj` explica por quê
 * (resumo: um prazo obrigaria a aparar a vida no meio de uma briga, e toda poda
 * lê como dano vindo do nada).
 *
 * A vida é aparada ao teto base ao sair, e essa poda é inevitável — o teto
 * caiu. O que a torna aceitável é o instante: as duas saídas acontecem quando
 * ninguém está atirando (o corpo já morreu, ou a luta acabou).
 *
 * @param {boolean} [calado] a morte não anuncia: `NS2C.DEATH` já sai no mesmo
 *   quadro e `nascer` devolve vida cheia logo atrás. Um `SSJ_OFF` no meio
 *   contaria uma terceira versão da mesma vida para o HUD.
 */
export function apagar(sala, f, calado = false) {
  if (!ativo(f)) return false;
  f.ssj = false;
  f.ssjAte = 0;
  const teto = vidaMaxima(f);
  if (f.health > teto) f.health = teto;
  if (!calado) {
    sala.broadcastAll({
      t: NS2C.SSJ_OFF,
      id: f.id,
      maxHealth: teto,
      health: Math.round(f.health),
    });
  }
  return true;
}

/** "Fica invencível enquanto está se transformando" — os três segundos. */
export function invencivel(f, agora) {
  return ativo(f) && agora < (f.ssjAte ?? 0);
}

/**
 * O pedido do cliente (`NC2S.SSJ`). Recusa em SILÊNCIO — ver o protocolo.
 *
 * Não há nada a validar na mensagem porque ela não carrega nada: todas as
 * condições são estado que a sala já tem.
 */
export function pedir(sala, f) {
  acender(sala, f);
}

/**
 * Uma passada por quadro: **o Freeza caiu, a transformação acaba.**
 *
 * Ela vive aqui e é chamada do `passo` porque é a única regra do Super Saiyajin
 * que não tem gatilho próprio — não há mensagem de "o chefe morreu, desligue".
 * Observar a condição por quadro é o mesmo remédio de `relogioDaQueda`, e custa
 * uma varredura de quinze corpos sem alocar nada.
 *
 * Com `exigeFreeza` desligado ela não faz nada, e é assim que tem de ser: quem
 * quiser transformação fora da batalha do chefe não quer que ela morra com ele.
 */
export function manutencao(sala) {
  if (!NAMEK.ssj.exigeFreeza) return;
  if (freezaEmCampo(sala)) return;
  /* **ELE CAIU: A TRANSFORMAÇÃO FICA.** É a inversão que `livreAposOFreeza`
   * traz, e ela desmenta de propósito o §"quando ela ACABA" de `NAMEK.ssj`, que
   * dizia "até morrer, ou até o Freeza cair".
   *
   * A metade do argumento que morreu era a de que o fim pelo Freeza é "de graça"
   * — a batalha acabou, ninguém está atirando, a barra volta ao normal sem
   * custar nada. A metade que continua viva é a outra: a poda de vida (o teto
   * caindo de 220 para 100) só é aceitável num instante em que ninguém está
   * atirando. Só que agora existe jogo DEPOIS da queda dele — a contagem do
   * planeta, a fuga e a briga no espaço —, e apagar a transformação no começo
   * desse trecho é justamente o oposto do que o pedido descreve.
   *
   * Sobra, portanto, um caminho só para desligar: a MORTE (`NamekRoom.matar` →
   * `apagar`), que já devolve vida e ki cheios e não precisa de poda nenhuma.
   * E logo depois dela a tecla está livre outra vez, que é o pedido inteiro. */
  if (transformacaoLivre(sala)) return;
  for (const f of sala.todos()) {
    if (ativo(f)) apagar(sala, f);
  }
}

/** Os campos que um lutador (humano ou bot) precisa ter. Chamado na entrada e
 *  em todo renascimento, para os dois caminhos escreverem os mesmos nomes. */
export function limpar(f) {
  f.ssj = false;
  f.ssjAte = 0;
}
