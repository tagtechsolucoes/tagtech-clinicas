/** Regras da agenda: estados da consulta e cálculo de horários livres. */

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'done',
  'no_show',
  'cancelled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  arrived: 'Chegou',
  in_progress: 'Em atendimento',
  done: 'Finalizado',
  no_show: 'Faltou',
  cancelled: 'Cancelado',
};

/** Estados que ocupam o horário. Falta e cancelamento liberam a agenda. */
export const BLOCKING_STATUSES: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'done',
];

const NEXT: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'arrived', 'no_show', 'cancelled'],
  confirmed: ['scheduled', 'arrived', 'no_show', 'cancelled'],
  arrived: ['in_progress', 'done', 'confirmed', 'cancelled'],
  in_progress: ['done', 'arrived'],
  // Reabrir um atendimento finalizado por engano.
  done: ['in_progress'],
  // Desfazer a falta (o paciente chegou atrasado, ou foi engano).
  no_show: ['scheduled', 'arrived'],
  cancelled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return NEXT[from].includes(to);
}

export function nextStatuses(from: AppointmentStatus): AppointmentStatus[] {
  return NEXT[from];
}

export interface Interval {
  /** Minutos desde a meia-noite (pode passar de 1440 para quem invade o dia seguinte). */
  start: number;
  end: number;
}

export interface SlotQuery {
  /** Turnos de trabalho do profissional no dia. */
  windows: Interval[];
  /** Consultas e bloqueios que já ocupam o profissional (ou a sala) no dia. */
  busy: Interval[];
  /** Duração do serviço, em minutos. */
  duration: number;
  /** De quantos em quantos minutos oferecer horário. */
  step: number;
  /** Nada antes deste minuto (hoje: agora + antecedência mínima). */
  notBefore?: number;
}

/**
 * Horários de início em que o serviço cabe inteiro num turno sem bater em nada ocupado.
 * Os horários seguem a grade do turno (um turno das 08:10 oferece 08:10, 08:40…).
 */
export function freeSlots(q: SlotQuery): number[] {
  if (q.duration <= 0 || q.step <= 0) return [];
  const busy = [...q.busy].sort((a, b) => a.start - b.start);
  const out = new Set<number>();
  for (const w of q.windows) {
    for (let s = w.start; s + q.duration <= w.end; s += q.step) {
      if (q.notBefore !== undefined && s < q.notBefore) continue;
      const e = s + q.duration;
      if (!busy.some((b) => b.start < e && b.end > s)) out.add(s);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Dois intervalos se sobrepõem (encostar não conta: 09:00–09:30 e 09:30–10:00 cabem). */
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;
