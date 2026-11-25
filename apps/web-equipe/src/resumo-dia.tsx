import { useEffect, useState } from 'react';
import { api, type Appointment } from './api';
import { hoje, hora, inicioDoDia } from './formato';

/** Cartão do menu lateral: como vai o dia na agenda. Atualiza ao trocar de tela. */
export function ResumoDoDia() {
  const [itens, setItens] = useState<Appointment[] | null>(null);

  useEffect(() => {
    let vivo = true;
    const carregar = () => {
      const dia = hoje();
      const ini = inicioDoDia(dia);
      const fim = new Date(new Date(ini).getTime() + 86_400_000).toISOString();
      api.agenda(ini, fim).then(
        (r) => vivo && setItens(r.appointments.filter((a) => a.status !== 'cancelled')),
        () => vivo && setItens(null),
      );
    };
    carregar();
    const t = setInterval(carregar, 5 * 60_000);
    window.addEventListener('hashchange', carregar);
    return () => {
      vivo = false;
      clearInterval(t);
      window.removeEventListener('hashchange', carregar);
    };
  }, []);

  if (!itens) return null;
  const encerradas = itens.filter((a) => a.status === 'done' || a.status === 'no_show').length;
  const agora = new Date().toISOString();
  const proxima = itens
    .filter((a) => a.startsAt > agora && ['scheduled', 'confirmed'].includes(a.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const pct = itens.length ? Math.round((encerradas / itens.length) * 100) : 0;

  return (
    <a
      href="#agenda"
      className="block rounded-2xl bg-white/[0.06] p-3.5 [@media(max-height:760px)]:hidden ring-1 ring-white/10 transition hover:bg-white/[0.09]"
    >
      <p className="flex items-center gap-2 text-[0.72rem] font-semibold text-white/50">
        <span className="h-1.5 w-1.5 rounded-full bg-[#5fd39a]" /> Agenda de hoje
      </p>
      <p className="mt-1.5 text-[0.92rem] font-semibold">
        {!itens.length
          ? 'Nenhuma consulta hoje'
          : proxima
            ? `Próxima às ${hora(proxima.startsAt)}`
            : encerradas === itens.length
              ? 'Atendimentos encerrados'
              : 'Em atendimento'}
      </p>
      {itens.length ? (
        <>
          <p className="text-xs text-white/55">
            {encerradas} de {itens.length} {itens.length === 1 ? 'atendida' : 'atendidas'}
            {proxima ? ` · ${proxima.patient.name.split(' ')[0]}` : ''}
          </p>
          <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full bg-ambar" style={{ width: `${pct}%` }} />
          </span>
        </>
      ) : null}
    </a>
  );
}
