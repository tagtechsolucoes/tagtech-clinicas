import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABELS } from '@tagtech/domain';
import { api, ApiError, type Me } from './api';
import { Moldura } from './entrada';
import { Botao, Campo, Entrada as Input } from './ui';

export function Convite({
  token,
  me,
  aoEntrar,
}: {
  token: string;
  me: Me | null;
  aoEntrar: (me: Me) => void;
}) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.invite>> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState({ name: '', email: '', password: '' });
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .invite(token)
      .then((i) => {
        setInfo(i);
        setDados((d) => ({ ...d, name: i.name }));
      })
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Convite inválido.'));
  }, [token]);

  async function aceitar(e?: FormEvent) {
    e?.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      if (me) {
        await api.joinInvite(token);
        aoEntrar(await api.me());
      } else aoEntrar(await api.acceptInvite(token, dados));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível aceitar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura>
      {info ? (
        <>
          <p className="text-sm font-semibold text-petroleo">Convite</p>
          <h2 className="mt-1 text-[2.1rem] leading-tight font-medium">{info.clinicName}</h2>
          <p className="mt-2 text-nevoa">
            {info.name}, você foi convidado para entrar na equipe como{' '}
            <strong className="text-tinta">{ROLE_LABELS[info.role].toLowerCase()}</strong>.
          </p>
          {me ? (
            <div className="mt-8 space-y-4">
              <p className="text-sm text-nevoa">Você está logado como {me.email}.</p>
              {erro ? (
                <p className="rounded-xl bg-alerta-fundo px-4 py-3 text-sm text-alerta">{erro}</p>
              ) : null}
              <Botao
                variante="principal"
                tamanho="grande"
                className="w-full"
                disabled={enviando}
                onClick={() => aceitar()}
              >
                Entrar na equipe
              </Botao>
            </div>
          ) : (
            <form onSubmit={aceitar} className="mt-8 space-y-4">
              <Campo rotulo="Seu nome">
                <Input
                  value={dados.name}
                  onChange={(e) => setDados({ ...dados, name: e.target.value })}
                  required
                />
              </Campo>
              <Campo rotulo="E-mail">
                <Input
                  type="email"
                  value={dados.email}
                  onChange={(e) => setDados({ ...dados, email: e.target.value })}
                  required
                  autoComplete="email"
                />
              </Campo>
              <Campo rotulo="Crie uma senha (mínimo 10 caracteres)">
                <Input
                  type="password"
                  value={dados.password}
                  onChange={(e) => setDados({ ...dados, password: e.target.value })}
                  required
                  minLength={10}
                  autoComplete="new-password"
                />
              </Campo>
              {erro ? (
                <p className="rounded-xl bg-alerta-fundo px-4 py-3 text-sm text-alerta">{erro}</p>
              ) : null}
              <Botao
                type="submit"
                variante="principal"
                tamanho="grande"
                className="w-full"
                disabled={enviando}
              >
                Criar conta e entrar
              </Botao>
            </form>
          )}
        </>
      ) : erro ? (
        <>
          <h2 className="text-[2rem] font-medium">Convite indisponível</h2>
          <p className="mt-2 text-nevoa">{erro}</p>
        </>
      ) : (
        <p className="text-nevoa">Carregando convite…</p>
      )}
    </Moldura>
  );
}
