/**
 * Atalhos entre telas do painel. "Novo agendamento" pode ser pedido de qualquer
 * lugar: vai para a agenda e a agenda abre o formulário assim que estiver na tela.
 */
const EVENTO = 'tt:novo-agendamento';
let pendente = false;

export function pedirNovoAgendamento() {
  pendente = true;
  if (location.hash !== '#agenda') location.hash = '#agenda';
  window.dispatchEvent(new Event(EVENTO));
}

/** A agenda chama ao montar e quando o evento chega; devolve true uma vez por pedido. */
export function consumirNovoAgendamento() {
  const tinha = pendente;
  pendente = false;
  return tinha;
}

export function aoPedirNovoAgendamento(fn: () => void) {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
