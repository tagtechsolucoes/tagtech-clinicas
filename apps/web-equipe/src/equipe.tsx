import { useCallback, useEffect, useState } from 'react';
import { canManage, rolesManagedBy, ROLE_LABELS, type ClinicRole } from '@tagtech/domain';
import { api, type Invite, type TeamMember } from './api';
import { mensagem, usePainel } from './contexto';
import { Avatar, Botao, Cabecalho, Campo, Entrada, Icone, Seletor } from './ui';

const O_QUE_FAZ: Record<ClinicRole, string> = {
  owner: 'Tudo, inclusive equipe e cadastro da clínica.',
  manager: 'Tudo, menos mexer em outros gerentes e no dono.',
  reception: 'Agenda, pacientes e lista de espera.',
  professional: 'A própria agenda, pacientes e atendimentos.',
};

export function EquipeTela() {
  const { vinculo, avisar } = usePainel();
  const [dados, setDados] = useState<{ members: TeamMember[]; invites: Invite[] } | null>(null);
  const [nome, setNome] = useState('');
  const papeis = rolesManagedBy(vinculo.role);
  const [papel, setPapel] = useState<ClinicRole>(papeis[0] ?? 'reception');
  const [link, setLink] = useState<{ nome: string; url: string } | null>(null);

  const carregar = useCallback(
    () =>
      api
        .team()
        .then(setDados)
        .catch((e) => avisar(mensagem(e), 'erro')),
    [avisar],
  );
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const urlConvite = (token: string) => `${location.origin}/convite/${token}`;

  async function convidar() {
    try {
      const i = await api.createInvite(nome.trim(), papel);
      setLink({ nome: i.name, url: urlConvite(i.token!) });
      setNome('');
      void carregar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Equipe"
        descricao="Cada pessoa entra com o próprio e-mail e senha. O que ela vê depende do papel."
      />

      <section className="mb-10 rounded-3xl bg-folha p-6 ring-1 ring-linha">
        <h2 className="text-xl font-medium">Convidar alguém</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
          <Campo rotulo="Nome">
            <Entrada
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Rita"
            />
          </Campo>
          <Campo rotulo="Papel">
            <Seletor value={papel} onChange={(e) => setPapel(e.target.value as ClinicRole)}>
              {papeis.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Seletor>
          </Campo>
          <Botao variante="principal" disabled={!nome.trim()} onClick={convidar}>
            Gerar convite
          </Botao>
        </div>
        <p className="mt-2 text-sm text-nevoa">{O_QUE_FAZ[papel]}</p>
        {link ? (
          <div className="mt-5 rounded-2xl bg-agua p-4">
            <p className="text-sm font-semibold text-petroleo">
              Mande este link para {link.nome}. Ele vale por 7 dias e funciona uma vez.
            </p>
            <div className="mt-2 flex gap-2">
              <Entrada
                readOnly
                value={link.url}
                onFocus={(e) => e.target.select()}
                className="font-mono text-sm"
              />
              <Botao
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    avisar('Link copiado');
                  } catch {
                    avisar('Selecione o link e copie.', 'erro');
                  }
                }}
              >
                <Icone nome="link" className="h-4 w-4" /> Copiar
              </Botao>
            </div>
          </div>
        ) : null}
      </section>

      {dados?.invites.length ? (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-medium">Convites pendentes</h2>
          <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
            {dados.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.name}</span>
                  <span className="text-sm text-nevoa"> · {ROLE_LABELS[i.role]}</span>
                </span>
                {canManage(vinculo.role, i.role) ? (
                  <>
                    <Botao
                      tamanho="pequeno"
                      onClick={async () => {
                        const r = await api
                          .renewInvite(i.id)
                          .catch((e) => avisar(mensagem(e), 'erro'));
                        if (r?.token) setLink({ nome: r.name, url: urlConvite(r.token) });
                      }}
                    >
                      Gerar link novo
                    </Botao>
                    <Botao
                      tamanho="pequeno"
                      variante="discreto"
                      onClick={async () => {
                        await api.revokeInvite(i.id).catch((e) => avisar(mensagem(e), 'erro'));
                        void carregar();
                      }}
                    >
                      Cancelar
                    </Botao>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-xl font-medium">Quem já está na equipe</h2>
        <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
          {dados?.members.map((m) => (
            <li key={m.membershipId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <Avatar nome={m.name} cor="#56676f" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {m.name}
                  {m.isYou ? <span className="text-nevoa"> (você)</span> : null}
                </span>
                <span className="block text-sm text-nevoa">{m.email}</span>
              </span>
              {!m.isYou && canManage(vinculo.role, m.role) ? (
                <>
                  <select
                    aria-label={`Papel de ${m.name}`}
                    value={m.role}
                    onChange={async (e) => {
                      await api
                        .changeRole(m.membershipId, e.target.value as ClinicRole)
                        .catch((err) => avisar(mensagem(err), 'erro'));
                      void carregar();
                    }}
                    className="h-9 rounded-lg bg-folha px-2.5 text-sm ring-1 ring-linha"
                  >
                    {papeis.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <Botao
                    tamanho="pequeno"
                    variante="perigo"
                    onClick={async () => {
                      await api
                        .removeMember(m.membershipId)
                        .catch((err) => avisar(mensagem(err), 'erro'));
                      void carregar();
                    }}
                  >
                    Remover
                  </Botao>
                </>
              ) : (
                <span className="rounded-md bg-trilho px-2.5 py-1 text-sm text-nevoa">
                  {ROLE_LABELS[m.role]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
