/* ---------------------------------------------------------------------------
   A porta do personagem. Quem monta o mundo, a sala ou o HUD importa DAQUI.

   O que está exportado é o que os outros sistemas têm o direito de saber:

     Fighter        a classe inteira — corpo, pose, aura e o estado que a rede
                    transporta. É o contrato do §10 do plano.
     OSSO           a antropometria. A câmera precisa da altura do ombro e o
                    HUD precisa saber onde flutua a etiqueta; os dois leem daqui
                    em vez de repetir 1,47 no meio de um arquivo qualquer.
     PIVO           a cota em torno da qual o corpo inclina (o centro de massa).
     Aura           exportada porque a Genki Dama precisa de uma aura no CÉU, e
                    não em cima de um lutador. É o único uso previsto fora daqui.

   O que NÃO está exportado é tão importante quanto: `poses.js` inteiro, os
   materiais, o montador do corpo. Ninguém de fora tem por que chamar
   `poseCarga` — quem decide qual pose vale é o `Fighter`, e é essa fronteira que
   permite reescrever a mistura de poses sem procurar quem mais a usava.
   --------------------------------------------------------------------------- */

export { Fighter } from "./fighter.js";
export { Aura } from "./aura.js";
export { OSSO, LOD_PERTO, LOD_MEDIO } from "./rig.js";
export { PIVO } from "./poses.js";
