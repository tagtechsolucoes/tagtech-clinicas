import type { Metadata } from 'next';
import { Aviso } from '@/components/aviso';
import { Orcamento } from '@/components/orcamento';
import type { PlanView } from '@/lib/api';
import { estiloDoTema, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// Link do orçamento (/o/<token>): o paciente vê o plano e aprova escolhendo as parcelas.
export const metadata: Metadata = { title: 'Seu orçamento', robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  const r = /^[A-Za-z0-9_-]{22}$/.test(token)
    ? await fetch(`${API_URL}/public/plans/${token}`, { cache: 'no-store' }).catch(() => null)
    : null;
  if (!r || !r.ok) {
    return (
      <Aviso titulo="Este link não vale mais">
        Peça à clínica um novo link do orçamento pelo WhatsApp.
      </Aviso>
    );
  }
  const view = (await r.json()) as PlanView;
  const { estilo } = estiloDoTema(temaSeguro(view.clinic.theme));
  return (
    <div style={estilo}>
      <Orcamento token={token} inicial={view} />
    </div>
  );
}
