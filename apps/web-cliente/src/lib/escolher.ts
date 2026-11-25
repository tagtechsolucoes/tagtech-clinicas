'use client';

/** O que o resto da página manda para o agendamento (serviço e, se houver, dia e hora). */
export interface Escolha {
  serviceId: string;
  professionalId?: string | null;
  date?: string;
  time?: string;
}

export const EVENTO_ESCOLHA = 'tt:escolher';

/** Abre o agendamento já com a escolha feita e rola até ele. */
export function escolher(e: Escolha) {
  window.dispatchEvent(new CustomEvent<Escolha>(EVENTO_ESCOLHA, { detail: e }));
  document.getElementById('agendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
