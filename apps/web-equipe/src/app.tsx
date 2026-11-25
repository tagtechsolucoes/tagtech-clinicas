import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLE_LABELS } from '@tagtech/domain';
import {
  api,
  ApiError,
  setTenant,
  siteUrl,
  type Clinic,
  type Me,
  type Membership,
  type Professional,
  type Room,
  type Service,
} from './api';
import { Agenda } from './agenda/agenda';
import { ClinicaTela } from './clinica';
import { PainelContexto, type Painel } from './contexto';
import { Convite } from './convite';
import { Entrada, type ModoEntrada } from './entrada';
import { EquipeTela } from './equipe';
import { EsperaTela } from './espera';
import { FinanceiroTela } from './financeiro/financeiro';
import { EstoqueTela } from './estoque/estoque';
import { ConveniosTela } from './convenios/convenios';
import { ResultadoTela } from './resultado';
import { RelatoriosTela } from './relatorios';
import { RecepcaoTela } from './recepcao';
import { setFuso } from './formato';
import { PacientesTela } from './pacientes';
import { PacienteTela } from './paciente/paciente';
import { ProfissionaisTela } from './profissionais';
import { ServicosTela } from './servicos';
import { Avatar, Icone, Recado } from './ui';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'entrada'; modo?: ModoEntrada }
  | { fase: 'convite'; token: string; me: Me | null }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; me: Me; vinculo: Membership };

export type Secao =
  | 'agenda'
  | 'recepcao'
  | 'pacientes'
  | 'espera'
  | 'financeiro'
  | 'estoque'
  | 'convenios'
  | 'resultado'
  | 'relatorios'
  | 'profissionais'
  | 'servicos'
  | 'clinica'
  | 'equipe';

const SECOES: Array<{
  id: Secao;
  nome: string;
  icone: string;
  gerencia?: boolean;
  balcao?: boolean;
  convenio?: boolean;
}> = [
  { id: 'agenda', nome: 'Agenda', icone: 'agenda' },
  { id: 'recepcao', nome: 'Recepção', icone: 'fila' },
  { id: 'pacientes', nome: 'Pacientes', icone: 'pessoas' },
  { id: 'espera', nome: 'Lista de espera', icone: 'espera' },
  { id: 'financeiro', nome: 'Financeiro', icone: 'dinheiro', balcao: true },
  { id: 'estoque', nome: 'Estoque', icone: 'caixa', balcao: true },
  { id: 'convenios', nome: 'Convênios', icone: 'recibo', balcao: true, convenio: true },
  { id: 'resultado', nome: 'Resultado', icone: 'grafico', gerencia: true },
  { id: 'relatorios', nome: 'Relatórios', icone: 'relatorio', gerencia: true },
  { id: 'profissionais', nome: 'Profissionais', icone: 'estetoscopio', gerencia: true },
  { id: 'servicos', nome: 'Serviços', icone: 'lista', gerencia: true },
  { id: 'clinica', nome: 'Clínica e site', icone: 'clinica', gerencia: true },
  { id: 'equipe', nome: 'Equipe', icone: 'equipe', gerencia: true },
];

const ESCOLHA = 'tt:clinica';

function lerSecao(): Secao {
  const h = location.hash.replace(/^#/, '');
  if (/^paciente\/[0-9a-f-]{36}$/.test(h)) return 'pacientes';
  return SECOES.some((s) => s.id === h) ? (h as Secao) : 'agenda';
}

/** Paciente aberto em página própria (#paciente/<id>). */
const lerPaciente = () => /^#paciente\/([0-9a-f-]{36})$/.exec(location.hash)?.[1] ?? null;

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  const entrar = useCallback((me: Me) => {
    let salvo: string | null = null;
    try {
      salvo = localStorage.getItem(ESCOLHA);
    } catch {
      /* navegador sem armazenamento */
    }
    const vinculo = me.memberships.find((m) => m.tenantId === salvo) ?? me.memberships[0];
    if (!vinculo) {
      setEstado({
        fase: 'erro',
        mensagem: 'Sua conta ainda não está ligada a nenhuma clínica. Peça um convite.',
      });
      return;
    }
    setTenant(vinculo.tenantId);
    if (location.pathname !== '/') history.replaceState(null, '', `/${location.hash}`);
    setEstado({ fase: 'pronto', me, vinculo });
  }, []);

  useEffect(() => {
    const convite = /^\/convite\/([A-Za-z0-9_-]{43})$/.exec(location.pathname);
    const redefinir = /^\/redefinir\/([A-Za-z0-9_-]{43})$/.exec(location.pathname);
    if (redefinir) {
      setEstado({ fase: 'entrada', modo: { tipo: 'redefinir', token: redefinir[1]! } });
      return;
    }
    api
      .me()
      .then((me) => (convite ? setEstado({ fase: 'convite', token: convite[1]!, me }) : entrar(me)))
      .catch((e) => {
        if (convite) setEstado({ fase: 'convite', token: convite[1]!, me: null });
        else if (e instanceof ApiError && e.status === 401)
          setEstado({
            fase: 'entrada',
            modo: { tipo: location.pathname === '/cadastro' ? 'cadastro' : 'login' },
          });
        else
          setEstado({
            fase: 'erro',
            mensagem: e instanceof Error ? e.message : 'Erro ao carregar.',
          });
      });
  }, [entrar]);

  switch (estado.fase) {
    case 'carregando':
      return <div className="grid h-full place-items-center text-nevoa">Carregando…</div>;
    case 'entrada':
      return <Entrada {...(estado.modo ? { modo: estado.modo } : {})} aoEntrar={entrar} />;
    case 'convite':
      return <Convite token={estado.token} me={estado.me} aoEntrar={entrar} />;
    case 'erro':
      return (
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="font-display text-2xl">Não deu para abrir o painel</p>
            <p className="mt-2 text-nevoa">{estado.mensagem}</p>
          </div>
        </div>
      );
    case 'pronto':
      return (
        <Casca
          key={estado.vinculo.tenantId}
          me={estado.me}
          vinculo={estado.vinculo}
          aoTrocar={(m) => {
            try {
              localStorage.setItem(ESCOLHA, m.tenantId);
            } catch {
              /* sem armazenamento */
            }
            setTenant(m.tenantId);
            setEstado({ fase: 'pronto', me: estado.me, vinculo: m });
          }}
          aoSair={async () => {
            await api.logout().catch(() => {});
            setTenant(null);
            setEstado({ fase: 'entrada', modo: { tipo: 'login' } });
          }}
        />
      );
  }
}

function Casca({
  me,
  vinculo,
  aoTrocar,
  aoSair,
}: {
  me: Me;
  vinculo: Membership;
  aoTrocar: (m: Membership) => void;
  aoSair: () => void;
}) {
  const [secao, setSecao] = useState<Secao>(lerSecao);
  const [pacienteId, setPacienteId] = useState<string | null>(lerPaciente);
  const [dados, setDados] = useState<{
    clinic: Clinic;
    professionals: Professional[];
    services: Service[];
    rooms: Room[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<{ texto: string; tipo: 'ok' | 'erro' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gerencia = vinculo.role === 'owner' || vinculo.role === 'manager';

  const recarregar = useCallback(async () => {
    try {
      const [clinic, professionals, services, rooms] = await Promise.all([
        api.clinic(),
        api.professionals(),
        api.services(),
        api.rooms(),
      ]);
      setFuso(clinic.units.find((u) => u.active)?.timezone ?? 'America/Recife');
      setDados({ clinic, professionals, services, rooms });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);

  useEffect(() => {
    void recarregar();
    const aoMudar = () => {
      setSecao(lerSecao());
      setPacienteId(lerPaciente());
    };
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, [recarregar]);

  const avisar = useCallback((texto: string, tipo: 'ok' | 'erro' = 'ok') => {
    setRecado({ texto, tipo });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRecado(null), tipo === 'erro' ? 6000 : 3000);
  }, []);

  const painel = useMemo<Painel | null>(
    () =>
      dados
        ? {
            me,
            vinculo,
            ...dados,
            recarregar,
            setClinic: (clinic) => setDados((d) => (d ? { ...d, clinic } : d)),
            avisar,
            gerencia,
          }
        : null,
    [dados, me, vinculo, recarregar, avisar, gerencia],
  );

  if (erro) return <div className="grid h-full place-items-center text-alerta">{erro}</div>;
  if (!painel)
    return <div className="grid h-full place-items-center text-nevoa">Carregando a clínica…</div>;

  const visiveis = SECOES.filter(
    (s) =>
      (!s.gerencia || gerencia) &&
      (!s.balcao || vinculo.role !== 'professional') &&
      (!s.convenio || painel.clinic.insuranceEnabled),
  );
  const atual = visiveis.some((s) => s.id === secao) ? secao : 'agenda';

  return (
    <PainelContexto.Provider value={painel}>
      <div className="min-h-full lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="border-linha bg-folha lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r">
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 lg:px-5 lg:pt-6">
            {painel.clinic.logoUrl ? (
              <img
                src={`/api${painel.clinic.logoUrl}`}
                alt=""
                className="h-10 w-10 rounded-xl object-cover"
              />
            ) : (
              <img src="/icone.svg" alt="" className="h-10 w-10 rounded-xl" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight">{painel.clinic.name}</p>
              {me.memberships.length > 1 ? (
                <select
                  aria-label="Trocar de clínica"
                  value={vinculo.tenantId}
                  onChange={(e) => {
                    const m = me.memberships.find((x) => x.tenantId === e.target.value);
                    if (m) aoTrocar(m);
                  }}
                  className="mt-0.5 max-w-full truncate bg-transparent text-xs text-nevoa"
                >
                  {me.memberships.map((m) => (
                    <option key={m.tenantId} value={m.tenantId}>
                      {m.tenantName}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-nevoa">{ROLE_LABELS[vinculo.role]}</p>
              )}
            </div>
          </div>

          <nav
            aria-label="Seções"
            className="rolagem-fina flex gap-1 overflow-x-auto px-3 pb-3 lg:mt-3 lg:flex-col lg:overflow-visible"
          >
            {visiveis.map((s) => {
              const ativo = s.id === atual;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  aria-current={ativo ? 'page' : undefined}
                  className={`flex h-10 shrink-0 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium whitespace-nowrap transition-colors ${
                    ativo ? 'bg-agua text-petroleo' : 'text-nevoa hover:bg-trilho hover:text-tinta'
                  }`}
                >
                  <Icone nome={s.icone} className="h-[1.15rem] w-[1.15rem]" />
                  {s.nome}
                </a>
              );
            })}
          </nav>

          <div className="mt-auto hidden space-y-3 px-5 pb-6 lg:block">
            <a
              href={siteUrl(painel.clinic.slug)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl bg-porcelana px-3 py-2.5 text-sm font-medium text-petroleo hover:bg-agua"
            >
              <Icone nome="globo" className="h-4 w-4" />
              Ver site de agendamento
            </a>
            <div className="flex items-center gap-3">
              <Avatar nome={me.name} tamanho="h-8 w-8 text-xs" />
              <p className="min-w-0 flex-1 truncate text-sm">{me.name}</p>
              <button
                type="button"
                onClick={aoSair}
                aria-label="Sair"
                className="grid h-9 w-9 place-items-center rounded-lg text-nevoa hover:bg-trilho hover:text-tinta"
              >
                <Icone nome="sair" className="h-[1.1rem] w-[1.1rem]" />
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          {atual === 'agenda' ? <Agenda /> : null}
          {atual !== 'agenda' ? (
            <div className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
              {atual === 'pacientes' && pacienteId ? (
                <PacienteTela key={pacienteId} id={pacienteId} />
              ) : null}
              {atual === 'pacientes' && !pacienteId ? <PacientesTela /> : null}
              {atual === 'espera' ? <EsperaTela /> : null}
              {atual === 'financeiro' ? <FinanceiroTela /> : null}
              {atual === 'estoque' ? <EstoqueTela /> : null}
              {atual === 'convenios' ? <ConveniosTela /> : null}
              {atual === 'resultado' ? <ResultadoTela /> : null}
              {atual === 'relatorios' ? <RelatoriosTela /> : null}
              {atual === 'recepcao' ? <RecepcaoTela /> : null}
              {atual === 'profissionais' ? <ProfissionaisTela /> : null}
              {atual === 'servicos' ? <ServicosTela /> : null}
              {atual === 'clinica' ? <ClinicaTela /> : null}
              {atual === 'equipe' ? <EquipeTela /> : null}
            </div>
          ) : null}
        </main>
      </div>
      <Recado texto={recado?.texto ?? null} tipo={recado?.tipo ?? 'ok'} />
    </PainelContexto.Provider>
  );
}
