/* ---------------------------------------------------------------------------
   A chave da sala, do lado de quem joga.

   O link que você manda é `…/?k=algumacoisa`. Isso bastaria se a pessoa
   entrasse uma vez só — mas ela sai e volta: fecha a aba, aperta F5, clica num
   favorito, volta pelo histórico, tromba com o domínio pelado. Em metade desses
   caminhos o `?k=` não vem junto, e um jogo que exigisse o link completo toda
   vez seria um jogo que expulsa o jogador na segunda entrada.

   Por isso a chave é LEMBRADA. O `?k=` é só a primeira entrega; a partir do
   primeiro `welcome` ela mora no `localStorage` e o domínio pelado passa a
   funcionar sozinho. Guardar só DEPOIS do welcome é o que evita gravar lixo:
   um link com a chave errada não sobrescreve a chave boa que já estava ali.

   A chave NÃO é apagada da barra de endereço de propósito — é o que faz o link
   continuar copiável para o próximo convidado.
   --------------------------------------------------------------------------- */

const ARMAZEM = "arcoFlecha.chaveDaSala";

/* Navegador em aba anônima com storage bloqueado joga exceção só de tocar no
   `localStorage`. A memória é o plano B: dura o que durar a aba, que é
   exatamente a sessão que a pessoa já está jogando. */
let naMemoria = null;

/** A chave a usar agora: a do link, se veio; senão a lembrada. */
export function roomKey() {
  return urlKey() ?? storedKey();
}

/** Só a do link. Serve para saber DE ONDE veio a chave que foi recusada. */
export function urlKey() {
  return new URLSearchParams(location.search).get("k") || null;
}

/** Só a lembrada. É o segundo palpite quando o link traz uma chave velha. */
export function storedKey() {
  return naMemoria ?? ler();
}

/** Chamada quando o servidor ACEITOU a chave — só então ela vira a lembrada. */
export function rememberKey(chave) {
  if (!chave) return;
  naMemoria = chave;
  try {
    localStorage.setItem(ARMAZEM, chave);
  } catch {
    /* sem storage: `naMemoria` já resolve esta aba */
  }
}

/** Chamada quando o servidor RECUSOU: uma chave inválida não merece memória. */
export function forgetKey() {
  naMemoria = null;
  try {
    localStorage.removeItem(ARMAZEM);
  } catch {
    /* nada a esquecer */
  }
}

function ler() {
  try {
    return localStorage.getItem(ARMAZEM) ?? null;
  } catch {
    return null;
  }
}
