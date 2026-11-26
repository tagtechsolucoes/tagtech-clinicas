/**
 * Atalhos entre telas do painel. "Novo agendamento" pode ser pedido de qualquer
 * lugar: vai para a agenda e a agenda abre o formulário assim que estiver na tela.
 */
import type { PatientSummary } from './api';

const EVENTO = 'tt:novo-agendamento';

/** Quem já vem escolhido: paciente do cadastro ou alguém novo (nome e telefone). */
export interface PedidoAgendamento {
  patient?: PatientSummary;
  novoPaciente?: { name: string; phone: string };
}
let pendente: PedidoAgendamento | null = null;

export function pedirNovoAgendamento(pedido: PedidoAgendamento = {}) {
  pendente = pedido;
  if (location.hash !== '#agenda') location.hash = '#agenda';
  window.dispatchEvent(new Event(EVENTO));
}

/** A agenda chama ao montar e quando o evento chega; devolve o pedido uma vez só. */
export function consumirNovoAgendamento(): PedidoAgendamento | null {
  const tinha = pendente;
  pendente = null;
  return tinha;
}

export function aoPedirNovoAgendamento(fn: () => void) {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
