/** Datas e horas no fuso da clínica, sem biblioteca: o Intl do Node já sabe os fusos. */

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isHHMM = (v: string) => HHMM.test(v);
export const isYMD = (v: string) => YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** "08:30" -> 510 */
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 510 -> "08:30" */
export const fromMinutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function parts(instant: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    second: Number(get('second')),
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

/** Data, dia da semana (0 = domingo) e minuto do dia de um instante, no fuso dado. */
export function localClock(instant: Date, timeZone: string) {
  const { ymd, minute, day } = parts(instant, timeZone);
  return { ymd, minute, day };
}

/** Instante UTC de uma data e hora locais do fuso ("2026-11-24", 510 -> Date). */
export function zonedToUtc(ymd: string, minute: number, timeZone: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`).getTime() + minute * 60_000;
  // Diferença entre o que o relógio local mostraria e o que queremos; duas passadas
  // acertam também os dias de troca de horário de verão.
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t), timeZone);
    const shown = new Date(`${p.ymd}T00:00:00Z`).getTime() + p.minute * 60_000 + p.second * 1000;
    t += guess - shown;
  }
  return new Date(t);
}

/** Dia da semana (0 = domingo) de uma data YYYY-MM-DD. */
export const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** Soma dias a uma data YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
