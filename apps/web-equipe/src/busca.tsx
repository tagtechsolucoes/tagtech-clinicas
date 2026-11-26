import { useEffect, useRef, useState } from 'react';
import { api, type PatientSummary } from './api';
import { pedirNovoAgendamento } from './atalhos';
import { telefone } from './formato';
import { Avatar, Icone } from './ui';

interface Tela {
  id: string;
  nome: string;
  icone: string;
}

type Item =
  | { tipo: 'acao'; nome: string; icone: string; ir: () => void }
  | { tipo: 'tela'; tela: Tela }
  | { tipo: 'paciente'; p: PatientSummary };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca rápida (Ctrl K / ⌘ K): pacientes, telas e "novo agendamento". */
export function Busca({
  telas,
  aberta,
  setAberta,
}: {
  telas: Tela[];
  aberta: boolean;
  setAberta: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [pacientes, setPacientes] = useState<PatientSummary[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAberta(true);
      }
    };
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, [setAberta]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) {
      setQ('');
      setSel(0);
      d.showModal();
    }
    if (!aberta && d.open) d.close();
  }, [aberta]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setPacientes([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      api.patients(q.trim(), 6).then(
        (r) => vivo && setPacientes(r),
        () => vivo && setPacientes([]),
      );
    }, 180);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  const termo = semAcento(q.trim());
  const itens: Item[] = [
    ...pacientes.map((p) => ({ tipo: 'paciente' as const, p })),
    ...(!termo || semAcento('novo agendamento marcar consulta').includes(termo)
      ? [
          {
            tipo: 'acao' as const,
            nome: 'Novo agendamento',
            icone: 'mais',
            ir: () => pedirNovoAgendamento(),
          },
        ]
      : []),
    ...telas
      .filter((t) => !termo || semAcento(t.nome).includes(termo))
      .map((tela) => ({ tipo: 'tela' as const, tela })),
  ];
  const atual = Math.min(sel, Math.max(0, itens.length - 1));

  function escolher(i: Item) {
    setAberta(false);
    if (i.tipo === 'acao') i.ir();
    else if (i.tipo === 'tela') location.hash = `#${i.tela.id}`;
    else location.hash = `#paciente/${i.p.id}`;
  }

  return (
    <dialog
      ref={ref}
      onClose={() => setAberta(false)}
      onClick={(e) => e.target === ref.current && setAberta(false)}
      aria-label="Busca rápida"
      className="m-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-folha p-0 text-tinta shadow-[0_40px_90px_-30px_rgb(15_32_40/0.6)] ring-1 ring-linha backdrop:bg-tinta/40 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 border-b border-linha px-5">
        <Icone nome="busca" className="h-5 w-5 text-bruma" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              setSel(Math.min(itens.length - 1, atual + 1));
              e.preventDefault();
            } else if (e.key === 'ArrowUp') {
              setSel(Math.max(0, atual - 1));
              e.preventDefault();
            } else if (e.key === 'Enter' && itens[atual]) {
              escolher(itens[atual]);
              e.preventDefault();
            }
          }}
          placeholder="Buscar paciente pelo nome, WhatsApp ou CPF, ou ir para uma tela"
          className="h-14 flex-1 bg-transparent text-[1rem] outline-none placeholder:text-bruma"
        />
        <kbd className="font-sans rounded-md bg-trilho px-1.5 py-0.5 text-[0.7rem] font-semibold text-nevoa">
          Esc
        </kbd>
      </div>
      <ul className="rolagem-fina max-h-[min(26rem,60vh)] overflow-y-auto p-2" role="listbox">
        {itens.length ? (
          itens.map((i, n) => (
            <li key={i.tipo === 'paciente' ? i.p.id : i.tipo === 'tela' ? i.tela.id : i.nome}>
              <button
                type="button"
                role="option"
                aria-selected={n === atual}
                onMouseMove={() => setSel(n)}
                onClick={() => escolher(i)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${n === atual ? 'bg-agua' : ''}`}
              >
                {i.tipo === 'paciente' ? (
                  <>
                    <Avatar nome={i.p.name} tamanho="h-9 w-9 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{i.p.name}</span>
                      <span className="block text-sm text-nevoa">{telefone(i.p.phone)}</span>
                    </span>
                    <span className="text-xs text-bruma">Paciente</span>
                  </>
                ) : (
                  <>
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-trilho text-petroleo">
                      <Icone
                        nome={i.tipo === 'acao' ? i.icone : i.tela.icone}
                        className="h-[1.1rem] w-[1.1rem]"
                      />
                    </span>
                    <span className="flex-1 font-semibold">
                      {i.tipo === 'acao' ? i.nome : i.tela.nome}
                    </span>
                    <span className="text-xs text-bruma">
                      {i.tipo === 'acao' ? 'Ação' : 'Tela'}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))
        ) : (
          <li className="px-4 py-8 text-center text-sm text-nevoa">
            Nada encontrado para “{q.trim()}”.
          </li>
        )}
      </ul>
    </dialog>
  );
}
