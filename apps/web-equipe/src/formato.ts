import { formatBRL, formatPhoneBR, localClock, toMinutes, zonedToUtc } from '@tagtech/domain';

/** Fuso usado para mostrar a agenda (o da unidade principal). */
let fuso = 'America/Recife';
export const setFuso = (tz: string) => {
  fuso = tz;
};
export const getFuso = () => fuso;

export const hoje = () => localClock(new Date(), fuso).ymd;
export const minutoDoDia = (iso: string, dia: string) =>
  Math.round((new Date(iso).getTime() - zonedToUtc(dia, 0, fuso).getTime()) / 60_000);
export const instante = (dia: string, hhmm: string) =>
  zonedToUtc(dia, toMinutes(hhmm), fuso).toISOString();
export const inicioDoDia = (dia: string) => zonedToUtc(dia, 0, fuso).toISOString();

export const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );

export const diaLongo = (dia: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${dia}T12:00:00Z`));
export const diaCurto = (dia: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${dia}T12:00:00Z`),
  );
export const dataHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
export const dataCurta = (dia: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${dia}T12:00:00Z`),
  );

export const dinheiro = (cents: number | null) =>
  cents === null ? 'Sob avaliação' : formatBRL(cents);
export const telefone = (digits: string) => (digits ? formatPhoneBR(digits) : '');

export function idade(nascimento: string | null): string | null {
  if (!nascimento) return null;
  const [y, m, d] = nascimento.split('-').map(Number) as [number, number, number];
  const [hy, hm, hd] = hoje().split('-').map(Number) as [number, number, number];
  let anos = hy - y;
  if (hm < m || (hm === m && hd < d)) anos--;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

export const duracao = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;

/** Data local (no fuso da clínica) de um instante. */
export const diaLocal = (iso: string) => localClock(new Date(iso), fuso).ymd;
