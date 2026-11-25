import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, type Me } from './api';
import { Botao, Campo, Entrada as Input } from './ui';

export type ModoEntrada =
  | { tipo: 'login' }
  | { tipo: 'cadastro' }
  | { tipo: 'esqueci' }
  | { tipo: 'redefinir'; token: string };

/** Moldura das telas sem login: a marca do produto de um lado, o formulário do outro. */
export function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-petroleo text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        <p className="flex items-center gap-3 text-lg font-semibold tracking-tight">
          <img src="/icone.svg" alt="" className="h-9 w-9 rounded-xl ring-1 ring-white/20" />
          TagTech Clínicas
        </p>
        <div className="relative z-10 max-w-md">
          <h1 className="text-[3.1rem] leading-[1.02] font-bold">
            A agenda cheia, sem a recepção correndo atrás.
          </h1>
          <p className="mt-5 text-lg text-white/70">
            Confirmação pelo WhatsApp, lista de espera que preenche o horário vago e o paciente
            marcando sozinho pelo site da clínica.
          </p>
        </div>
        {/* Uma coluna de agenda estilizada, só ilustração. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-24 -right-10 w-72 rotate-[-4deg] space-y-3 opacity-90"
        >
          {[
            ['08:00', 'Limpeza', 'Confirmado', 'bg-white/95 text-tinta'],
            ['08:30', 'Avaliação', 'Agendado', 'bg-white/80 text-tinta'],
            ['09:30', 'Clareamento', 'Chegou', 'bg-ambar text-tinta'],
            [
              '10:30',
              'Horário vago',
              'Oferecido à lista',
              'bg-white/10 text-white ring-1 ring-white/25 border-dashed',
            ],
          ].map(([h, s, e, c]) => (
            <div key={h} className={`rounded-2xl px-4 py-3 shadow-xl ${c}`}>
              <p className="text-xs font-semibold opacity-60">{h}</p>
              <p className="font-semibold">{s}</p>
              <p className="text-xs opacity-70">{e}</p>
            </div>
          ))}
        </div>
        <p className="relative z-10 text-sm text-white/50">Um produto TagTech Soluções</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

function Erro({ texto }: { texto: string | null }) {
  return texto ? (
    <p
      role="alert"
      className="rounded-xl bg-alerta-fundo px-4 py-3 text-sm font-medium text-alerta"
    >
      {texto}
    </p>
  ) : null;
}

export function Entrada({
  modo: inicial,
  aoEntrar,
}: {
  modo?: ModoEntrada;
  aoEntrar: (me: Me) => void;
}) {
  const [modo, setModo] = useState<ModoEntrada>(inicial ?? { tipo: 'login' });
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [dados, setDados] = useState({ name: '', email: '', password: '', clinicName: '' });
  const [emailReset, setEmailReset] = useState<string | null>(null);

  useEffect(() => {
    setErro(null);
    if (modo.tipo === 'redefinir') {
      api
        .resetInfo(modo.token)
        .then((r) => setEmailReset(r.email))
        .catch((e) => setErro(e instanceof ApiError ? e.message : 'Link inválido.'));
    }
  }, [modo]);

  const set = (k: keyof typeof dados) => (e: { target: { value: string } }) =>
    setDados({ ...dados, [k]: e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      if (modo.tipo === 'login') aoEntrar(await api.login(dados.email, dados.password));
      else if (modo.tipo === 'cadastro') aoEntrar(await api.signup(dados));
      else if (modo.tipo === 'esqueci') {
        await api.forgot(dados.email);
        setAviso(
          'Se este e-mail tiver conta, o link para criar uma senha nova chega em instantes.',
        );
      } else aoEntrar(await api.reset(modo.token, dados.password));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
    } finally {
      setEnviando(false);
    }
  }

  const titulos = {
    login: ['Entrar', 'Bom te ver de novo.'],
    cadastro: ['Criar a conta da clínica', 'Leva um minuto. Você ajusta o resto depois.'],
    esqueci: ['Esqueci a senha', 'Mandamos um link para você criar uma nova.'],
    redefinir: ['Nova senha', emailReset ? `Para ${emailReset}` : ''],
  } as const;
  const [titulo, sub] = titulos[modo.tipo];

  return (
    <Moldura>
      <h2 className="text-[2.1rem] leading-tight font-semibold">{titulo}</h2>
      {sub ? <p className="mt-2 text-nevoa">{sub}</p> : null}
      <form onSubmit={enviar} className="mt-8 space-y-4">
        {modo.tipo === 'cadastro' ? (
          <>
            <Campo rotulo="Nome da clínica">
              <Input
                value={dados.clinicName}
                onChange={set('clinicName')}
                required
                maxLength={120}
                autoFocus
                placeholder="Ex.: Clínica Sorriso"
              />
            </Campo>
            <Campo rotulo="Seu nome">
              <Input
                value={dados.name}
                onChange={set('name')}
                required
                maxLength={120}
                autoComplete="name"
              />
            </Campo>
          </>
        ) : null}
        {modo.tipo !== 'redefinir' ? (
          <Campo rotulo="E-mail">
            <Input
              type="email"
              value={dados.email}
              onChange={set('email')}
              required
              autoComplete="email"
              autoFocus={modo.tipo !== 'cadastro'}
            />
          </Campo>
        ) : null}
        {modo.tipo !== 'esqueci' ? (
          <Campo rotulo={modo.tipo === 'login' ? 'Senha' : 'Senha (mínimo 10 caracteres)'}>
            <Input
              type="password"
              value={dados.password}
              onChange={set('password')}
              required
              minLength={modo.tipo === 'login' ? 1 : 10}
              autoComplete={modo.tipo === 'login' ? 'current-password' : 'new-password'}
            />
          </Campo>
        ) : null}
        <Erro texto={erro} />
        {aviso ? (
          <p className="rounded-xl bg-ok-fundo px-4 py-3 text-sm font-medium text-ok">{aviso}</p>
        ) : null}
        <Botao
          type="submit"
          variante="principal"
          tamanho="grande"
          className="w-full"
          disabled={enviando}
        >
          {enviando
            ? 'Aguarde…'
            : {
                login: 'Entrar',
                cadastro: 'Criar conta',
                esqueci: 'Enviar link',
                redefinir: 'Salvar e entrar',
              }[modo.tipo]}
        </Botao>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm text-nevoa">
        {modo.tipo === 'login' ? (
          <>
            <button
              type="button"
              className="text-left font-semibold text-petroleo hover:underline"
              onClick={() => setModo({ tipo: 'esqueci' })}
            >
              Esqueci a senha
            </button>
            <p>
              Clínica nova?{' '}
              <button
                type="button"
                className="font-semibold text-petroleo hover:underline"
                onClick={() => setModo({ tipo: 'cadastro' })}
              >
                Criar conta
              </button>
            </p>
          </>
        ) : (
          <button
            type="button"
            className="text-left font-semibold text-petroleo hover:underline"
            onClick={() => setModo({ tipo: 'login' })}
          >
            Voltar para entrar
          </button>
        )}
      </div>
    </Moldura>
  );
}
