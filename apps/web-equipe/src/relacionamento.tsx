import { useEffect, useState } from 'react';
import { RELATIONSHIP_TEMPLATES } from '@tagtech/domain';
import { api, type RelationshipSettings } from './api';
import { mensagem, usePainel } from './contexto';
import { Botao, Campo, Entrada, Interruptor, Seletor } from './ui';

const NOMES: Record<keyof typeof RELATIONSHIP_TEMPLATES, string> = {
  vaga_oferta: 'Vaga para a lista de espera',
  retorno_aviso: 'Lembrete de retorno',
  reativacao: 'Reativação',
  avaliacao_pedido: 'Pedido de avaliação',
};

/** Mensagens automáticas que trazem paciente de volta. Usa o WhatsApp já conectado. */
export function Relacionamento() {
  const { avisar } = usePainel();
  const [s, setS] = useState<RelationshipSettings | null>(null);
  const [link, setLink] = useState('');
  useEffect(() => {
    api
      .relationship()
      .then((x) => {
        setS(x);
        setLink(x.googleReviewUrl);
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [avisar]);
  if (!s) return null;

  async function salvar(patch: Partial<RelationshipSettings>, ok = 'Salvo') {
    try {
      setS(await api.saveRelationship(patch));
      avisar(ok);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <div className="space-y-6">
      <Interruptor
        ligado={s.waitlistAutoOffer}
        aoMudar={(v) => salvar({ waitlistAutoOffer: v })}
        rotulo="Oferecer horário vago à lista de espera"
        descricao="Quando alguém desmarca, a primeira pessoa da fila recebe o horário e tem até 2 horas para aceitar. Sem resposta, passa para a próxima."
      />
      <Campo
        rotulo="Chamar de volta quem sumiu"
        ajuda="Mensagem para quem não volta há este tempo e não tem nada marcado. Uma vez por período."
      >
        <Seletor
          value={s.reactivationDays}
          onChange={(e) => salvar({ reactivationDays: Number(e.target.value) })}
        >
          <option value={0}>Desligado</option>
          {[90, 120, 180, 270, 365].map((d) => (
            <option key={d} value={d}>
              Sem vir há {d === 365 ? '1 ano' : `${d / 30} meses`}
            </option>
          ))}
        </Seletor>
      </Campo>
      <Campo
        rotulo="Link de avaliação no Google"
        ajuda="No Perfil da Empresa no Google › Pedir avaliações. Com o link, o paciente recebe o pedido 2 horas depois da consulta; nota 4 ou 5 vai para o Google, nota baixa fica só com a clínica."
      >
        <div className="flex gap-2">
          <Entrada
            value={link}
            placeholder="https://g.page/r/…/review"
            onChange={(e) => setLink(e.target.value)}
          />
          <Botao
            disabled={link.trim() === s.googleReviewUrl}
            onClick={() =>
              salvar(
                { googleReviewUrl: link.trim() },
                link.trim() ? 'Link salvo' : 'Pedido de avaliação desligado',
              )
            }
          >
            Salvar
          </Botao>
        </div>
      </Campo>
      <p className="text-sm text-nevoa">
        O lembrete de retorno se liga em cada serviço (Serviços › Lembrete de retorno). Mensagens
        que não são de consulta só saem entre 9h e 20h.
      </p>
      <details className="rounded-2xl bg-porcelana px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Modelos para cadastrar na Meta (um por mensagem)
        </summary>
        <ul className="mt-3 space-y-3">
          {Object.entries(RELATIONSHIP_TEMPLATES).map(([nome, t]) => (
            <li key={nome}>
              <p className="font-semibold">
                {NOMES[nome as keyof typeof NOMES]} · <code>{nome}</code> ·{' '}
                {t.category === 'MARKETING' ? 'Marketing' : 'Utilidade'}
              </p>
              <p className="mt-1 rounded-xl bg-folha p-3 font-mono text-[0.82rem] ring-1 ring-linha">
                {t.body}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
