/* ---------------------------------------------------------------------------
   O VOO DA ALMA — e por que ele mora no `shared`.

   A bolinha que sai do corpo é desenhada pelo cliente (`systems/souls.js`) e
   nada nela precisava do servidor enquanto ela era só enfeite. Deixou de ser: a
   BARRA DO ESPECIAL agora sobe quando a alma ENCOSTA em quem matou, e não no
   instante da morte.

   A diferença é a razão de o sistema existir. A alma é a única confirmação de
   abate legível a duzentos metros, e ela é uma coisa que VEM NA SUA DIREÇÃO —
   uma barra que subia antes de a bolinha chegar contava o final da história
   primeiro, e transformava a viagem inteira em decoração atrasada. Chegando
   junto, a bolinha vira a causa do ponto em vez do comentário dele.

   Só que quem conta a barra é a SALA (`Room.addKameCharge`) e quem desenha a
   bolinha é o cliente. Para os dois concordarem sobre "quando ela chega" sem
   uma mensagem nova por alma — seriam dezenas por segundo no auge de uma
   horda —, os dois calculam o MESMO voo a partir da MESMA distância. É o
   contrato da flecha e o do feixe outra vez: um parâmetro atravessa a rede, e
   cada lado reconstrói o resto.

   E é o que faz o BOT funcionar de graça. Ele não tem tela, não desenha alma
   nenhuma, e mesmo assim a barra dele enche no mesmo ritmo da de um humano —
   porque o ritmo é uma conta, não uma animação.

   ------------------------------------------------------------- a curva em si

   Ela SAI PARADA e vai ganhando velocidade o tempo todo. Três peças:

   • a RAMPA (`rampa`): nos primeiros meio segundo a aceleração ainda está
     entrando. É o que dá o "ela se solta do corpo" — sem isso a bolinha parte
     como projétil, que é a única coisa que ela não pode parecer, porque o
     jogador não pode se perguntar se aquilo vem para machucá-lo.

   • a ACELERAÇÃO cresce com o que FALTA (`accelPorMetro`): quanto mais longe
     estiver o destino, mais forte é a atração. É o que faz uma alma de 200 m
     não levar quatro vezes o tempo de uma de 50.

   • o TETO cresce com a distância INICIAL (`velPorMetro`), entre `velMin` e
     `velMax`. Uma morte a quarenta metros continua produzindo uma bolinha
     mansa, que é o que se quer de perto; uma rocha vaporizada a duzentos manda
     um risco de luz. Sem o teto variável, escolher uma velocidade só era
     escolher qual dos dois casos estragar — era o defeito velho, e ele aparecia
     inteiro na chuva de meteoros: a 20 m/s a alma de uma rocha atravessava a
     tela por dez segundos e chegava depois de o jogador já ter esquecido dela.
   --------------------------------------------------------------------------- */

export const ALMA = {
  /** s até a aceleração valer inteira. É o "ela se solta devagar". */
  rampa: 0.55,
  /** m/s² fixos, e mais isto por metro que falta para o destino. */
  accelBase: 6,
  accelPorMetro: 0.3,
  /** O teto: parte fixa mais isto por metro da distância INICIAL. */
  velBase: 9,
  velPorMetro: 0.2,
  velMin: 14, // m/s — nem a alma mais curta rasteja
  velMax: 62, // m/s — nem a mais longa vira um borrão
  /** A que distância ela conta como "chegou". */
  encosto: 1.1, // m
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * O teto desta alma, decidido no nascimento pela distância até quem matou.
 * @param {number} d0 m
 */
export function tetoDaAlma(d0) {
  return clamp(ALMA.velBase + d0 * ALMA.velPorMetro, ALMA.velMin, ALMA.velMax);
}

/**
 * Um passo da velocidade. É a MESMA linha nos dois lados da rede.
 *
 * @param {number} vel m/s de agora
 * @param {number} dt s
 * @param {number} faltam m até o destino
 * @param {number} t s desde que ela saiu do corpo (para a rampa)
 * @param {number} teto m/s — de `tetoDaAlma`
 */
export function passoDaAlma(vel, dt, faltam, t, teto) {
  const rampa = Math.min(1, t / ALMA.rampa);
  const a = (ALMA.accelBase + faltam * ALMA.accelPorMetro) * rampa;
  return Math.min(teto, vel + a * dt);
}

/**
 * Quantos segundos ela leva para cruzar `d0` metros.
 *
 * Integrada e não resolvida: a aceleração depende da distância que falta, então
 * não há fórmula fechada barata — e isto roda UMA VEZ POR ABATE no servidor,
 * onde ~300 passos de ponto flutuante não são nada perto do que já custa um
 * quadro de horda.
 *
 * O que ela NÃO modela: a subida inicial e o bamboleio que o cliente desenha
 * (`SoulSystem.update`), e o fato de o destino andar. As três coisas somam uns
 * poucos décimos, e a conta serve para agendar um ponto de barra — não para
 * sincronizar um quadro.
 *
 * @param {number} d0 m
 * @returns {number} s
 */
export function tempoDeVoo(d0) {
  if (!Number.isFinite(d0) || d0 <= ALMA.encosto) return 0;
  const teto = tetoDaAlma(d0);
  const dt = 1 / 60;
  let d = d0;
  let vel = 0;
  let t = 0;
  // O teto de 20 s é rede contra um `d0` absurdo — ele nunca é alcançado com os
  // números acima, em que a alma mais longa do jogo chega em menos de cinco.
  while (d > ALMA.encosto && t < 20) {
    vel = passoDaAlma(vel, dt, d, t, teto);
    d -= vel * dt;
    t += dt;
  }
  return t;
}
