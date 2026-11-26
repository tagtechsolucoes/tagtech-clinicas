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
  type Subscription,
  type Feature,
} from './api';
import { Agenda } from './agenda/agenda';
import { Busca } from './busca';
import { ClinicaTela } from './clinica';
import { InicioTela } from './inicio';
import { AvisoAssinatura, ForaDoPlano, PlanoTela } from './plano';
import { TagTechTela } from './tagtech';
import { ResumoDoDia } from './resumo-dia';
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
import { Avatar, Gaveta, Icone, Recado } from './ui';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'entrada'; modo?: ModoEntrada }
  | { fase: 'convite'; token: string; me: Me | null }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; me: Me; vinculo: Membership };

export type Secao =
  | 'inicio'
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
  | 'equipe'
  | 'plano'
  | 'tagtech';

const SECOES: Array<{
  id: Secao;
  nome: string;
  icone: string;
  gerencia?: boolean;
  balcao?: boolean;
  /** Só com 2 profissionais ou mais (modo consultório esconde). */
  equipe?: boolean;
  convenio?: boolean;
  /** Recurso do plano: sem ele, a tela mostra o convite para mudar de plano. */
  recurso?: Feature;
  /** Só a equipe da TagTech. */
  plataforma?: boolean;
  grupo: 'Atendimento' | 'Gestão' | 'Clínica';
}> = [
  { id: 'inicio', nome: 'Painel', icone: 'painel', gerencia: true, grupo: 'Atendimento' },
  { id: 'agenda', nome: 'Agenda', icone: 'agenda', grupo: 'Atendimento' },
  { id: 'recepcao', nome: 'Recepção', icone: 'fila', grupo: 'Atendimento' },
  { id: 'pacientes', nome: 'Pacientes', icone: 'pessoas', grupo: 'Atendimento' },
  { id: 'espera', nome: 'Lista de espera', icone: 'espera', grupo: 'Atendimento' },
  { id: 'financeiro', nome: 'Financeiro', icone: 'dinheiro', balcao: true, grupo: 'Gestão' },
  { id: 'estoque', nome: 'Estoque', icone: 'caixa', balcao: true, grupo: 'Gestão' },
  {
    id: 'convenios',
    nome: 'Convênios',
    icone: 'recibo',
    balcao: true,
    convenio: true,
    recurso: 'insurance',
    grupo: 'Gestão',
  },
  { id: 'resultado', nome: 'Resultado', icone: 'grafico', gerencia: true, grupo: 'Gestão' },
  {
    id: 'relatorios',
    nome: 'Relatórios',
    icone: 'relatorio',
    gerencia: true,
    equipe: true,
    recurso: 'reports',
    grupo: 'Gestão',
  },
  {
    id: 'profissionais',
    nome: 'Profissionais',
    icone: 'estetoscopio',
    gerencia: true,
    grupo: 'Clínica',
  },
  { id: 'servicos', nome: 'Serviços', icone: 'lista', gerencia: true, grupo: 'Clínica' },
  { id: 'clinica', nome: 'Clínica e site', icone: 'clinica', gerencia: true, grupo: 'Clínica' },
  { id: 'equipe', nome: 'Equipe', icone: 'equipe', gerencia: true, grupo: 'Clínica' },
  { id: 'plano', nome: 'Plano', icone: 'recibo', gerencia: true, grupo: 'Clínica' },
  { id: 'tagtech', nome: 'TagTech', icone: 'grafico', plataforma: true, grupo: 'Clínica' },
];

const ESCOLHA = 'tt:clinica';

function lerSecao(): Secao {
  const h = location.hash.replace(/^#/, '');
  if (/^paciente\/[0-9a-f-]{36}$/.test(h)) return 'pacientes';
  return SECOES.some((s) => s.id === h) ? (h as Secao) : 'inicio';
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
    assinatura: Subscription;
    admin: boolean;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<{ texto: string; tipo: 'ok' | 'erro' } | null>(null);
  const [busca, setBusca] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gerencia = vinculo.role === 'owner' || vinculo.role === 'manager';

  const recarregar = useCallback(async () => {
    try {
      const [clinic, professionals, services, rooms, assinatura, admin] = await Promise.all([
        api.clinic(),
        api.professionals(),
        api.services(),
        api.rooms(),
        api.subscription(),
        api.platformMe().then(
          (r) => r.admin,
          () => false,
        ),
      ]);
      setFuso(clinic.units.find((u) => u.active)?.timezone ?? 'America/Recife');
      setDados({ clinic, professionals, services, rooms, assinatura, admin });
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
            tem: (f) => !dados.assinatura.blocked && dados.assinatura.features.includes(f),
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
      (!s.convenio || painel.clinic.insuranceEnabled) &&
      (!s.equipe || painel.professionals.filter((p) => p.active).length > 1) &&
      (!s.plataforma || painel.admin),
  );
  const atual = visiveis.some((s) => s.id === secao)
    ? secao
    : visiveis.some((s) => s.id === 'inicio')
      ? 'inicio'
      : 'agenda';

  return (
    <PainelContexto.Provider value={painel}>
      <div className="min-h-full lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="bg-folha lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:bg-noite lg:text-white">
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
              <p className="truncate leading-tight font-semibold">{painel.clinic.name}</p>
              {me.memberships.length > 1 ? (
                <select
                  aria-label="Trocar de clínica"
                  value={vinculo.tenantId}
                  onChange={(e) => {
                    const m = me.memberships.find((x) => x.tenantId === e.target.value);
                    if (m) aoTrocar(m);
                  }}
                  className="mt-0.5 max-w-full truncate bg-transparent text-xs text-nevoa lg:text-white/55 [&>option]:text-tinta"
                >
                  {me.memberships.map((m) => (
                    <option key={m.tenantId} value={m.tenantId}>
                      {m.tenantName}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-nevoa lg:text-white/55">{ROLE_LABELS[vinculo.role]}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setBusca(true)}
            className="mx-4 mb-2 hidden h-10 items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 text-sm text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white lg:flex"
          >
            <Icone nome="busca" className="h-4 w-4" />
            <span className="flex-1 text-left">Buscar</span>
            <kbd className="font-sans rounded bg-white/10 px-1.5 py-0.5 text-[0.68rem] font-semibold">
              Ctrl K
            </kbd>
          </button>

          <nav
            aria-label="Seções"
            className="rolagem-fina hidden flex-1 overflow-y-auto px-3 pb-3 lg:block"
          >
            {GRUPOS.map((g) => {
              const itens = visiveis.filter((s) => s.grupo === g);
              if (!itens.length) return null;
              return (
                <div key={g} className="mt-3 first:mt-0">
                  <p className="px-3 pb-1.5 text-[0.72rem] font-semibold text-white/40">{g}</p>
                  {itens.map((s) => (
                    <ItemMenu key={s.id} s={s} ativo={s.id === atual} />
                  ))}
                </div>
              );
            })}
          </nav>

          <div className="mt-auto hidden space-y-3 px-4 pb-5 lg:block">
            <ResumoDoDia />
            <a
              href={siteUrl(painel.clinic.slug)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white/70 hover:bg-white/[0.07] hover:text-white"
            >
              <Icone nome="globo" className="h-4 w-4" />
              Ver site de agendamento
            </a>
            <div className="flex items-center gap-3">
              <Avatar nome={me.name} tamanho="h-8 w-8 text-xs" />
              <p className="min-w-0 flex-1 truncate text-sm text-white/85">{me.name}</p>
              <button
                type="button"
                onClick={aoSair}
                aria-label="Sair"
                className="grid h-9 w-9 place-items-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white"
              >
                <Icone nome="sair" className="h-[1.1rem] w-[1.1rem]" />
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 pb-24 lg:pb-0">
          {atual === 'agenda' ? (
            <>
              <Agenda />
              <AvisoAssinatura flutuante />
            </>
          ) : null}
          {atual !== 'agenda' ? (
            <div className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
              <AvisoAssinatura />
              {SECOES.find((s) => s.id === atual)?.recurso &&
              !painel.tem(SECOES.find((s) => s.id === atual)!.recurso!) ? (
                <ForaDoPlano recurso={SECOES.find((s) => s.id === atual)!.recurso!} />
              ) : (
                <>
                  {atual === 'inicio' ? <InicioTela /> : null}
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
                  {atual === 'plano' ? <PlanoTela /> : null}
                  {atual === 'tagtech' ? <TagTechTela /> : null}
                </>
              )}
            </div>
          ) : null}
        </main>
      </div>
      <BarraCelular
        visiveis={visiveis}
        atual={atual}
        siteHref={siteUrl(painel.clinic.slug)}
        aoSair={aoSair}
      />
      <Busca telas={visiveis} aberta={busca} setAberta={setBusca} />
      <Recado texto={recado?.texto ?? null} tipo={recado?.tipo ?? 'ok'} />
    </PainelContexto.Provider>
  );
}

const GRUPOS = ['Atendimento', 'Gestão', 'Clínica'] as const;
type ItemSecao = (typeof SECOES)[number];

function ItemMenu({ s, ativo }: { s: ItemSecao; ativo: boolean }) {
  return (
    <a
      href={`#${s.id}`}
      aria-current={ativo ? 'page' : undefined}
      className={`relative flex h-[2.15rem] items-center gap-3 rounded-xl px-3 text-[0.93rem] font-medium whitespace-nowrap transition-colors ${
        ativo
          ? 'bg-white/[0.12] text-white before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-ambar'
          : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <Icone nome={s.icone} className="h-[1.1rem] w-[1.1rem]" />
      {s.nome}
    </a>
  );
}

/** No celular: as 4 telas do dia a dia embaixo, ao alcance do polegar, e o resto em "Mais". */
function BarraCelular({
  visiveis,
  atual,
  siteHref,
  aoSair,
}: {
  visiveis: ItemSecao[];
  atual: string;
  siteHref: string;
  aoSair: () => void;
}) {
  const [mais, setMais] = useState(false);
  const principais = visiveis.filter((s) =>
    ['inicio', 'agenda', 'recepcao', 'pacientes'].includes(s.id),
  );
  const noMais = !principais.some((s) => s.id === atual);
  useEffect(() => {
    const fechar = () => setMais(false);
    window.addEventListener('hashchange', fechar);
    return () => window.removeEventListener('hashchange', fechar);
  }, []);
  return (
    <>
      <nav
        aria-label="Seções"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-linha bg-folha/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${principais.length + 1}, minmax(0, 1fr))` }}
      >
        {principais.map((s) => {
          const ativo = s.id === atual;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={ativo ? 'page' : undefined}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold ${ativo ? 'text-petroleo' : 'text-nevoa'}`}
            >
              <span
                className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${ativo ? 'bg-agua' : ''}`}
              >
                <Icone nome={s.icone} className="h-5 w-5" />
              </span>
              {s.nome}
            </a>
          );
        })}
        <button
          type="button"
          onClick={() => setMais(true)}
          aria-expanded={mais}
          className={`flex h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold ${noMais ? 'text-petroleo' : 'text-nevoa'}`}
        >
          <span
            className={`grid h-7 w-12 place-items-center rounded-full ${noMais ? 'bg-agua' : ''}`}
          >
            <Icone nome="lista" className="h-5 w-5" />
          </span>
          Mais
        </button>
      </nav>
      <Gaveta aberta={mais} aoFechar={() => setMais(false)} titulo="Menu">
        <div className="space-y-5">
          {GRUPOS.map((g) => {
            const itens = visiveis.filter((s) => s.grupo === g);
            if (!itens.length) return null;
            return (
              <div key={g}>
                <p className="mb-2 text-[0.78rem] font-semibold text-bruma">{g}</p>
                <div className="grid grid-cols-2 gap-2">
                  {itens.map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className={`flex h-14 items-center gap-2.5 rounded-2xl px-3.5 text-[0.95rem] font-semibold ring-1 ${
                        s.id === atual
                          ? 'bg-agua text-petroleo ring-petroleo/30'
                          : 'bg-folha ring-linha'
                      }`}
                    >
                      <Icone nome={s.icone} className="h-5 w-5 shrink-0" />
                      <span className="truncate">{s.nome}</span>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex gap-2 border-t border-linha pt-5">
            <a
              href={siteHref}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-porcelana font-semibold text-petroleo"
            >
              <Icone nome="globo" className="h-4 w-4" /> Ver site
            </a>
            <button
              type="button"
              onClick={aoSair}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl font-semibold text-nevoa ring-1 ring-linha"
            >
              <Icone nome="sair" className="h-4 w-4" /> Sair
            </button>
          </div>
        </div>
      </Gaveta>
    </>
  );
}
