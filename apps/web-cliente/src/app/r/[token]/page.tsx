import type { Metadata } from 'next';
import { Aviso } from '@/components/aviso';
import { Avaliar } from '@/components/avaliar';
import type { ReviewView } from '@/lib/api';
import { estiloDoTema, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// Pedido de avaliação (/r/<token>): nota de 1 a 5; nota alta leva ao Google.
export const metadata: Metadata = { title: 'Como foi o atendimento?', robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  const r = /^[A-Za-z0-9_-]{22}$/.test(token)
    ? await fetch(`${API_URL}/public/reviews/${token}`, { cache: 'no-store' }).catch(() => null)
    : null;
  if (!r || !r.ok) {
    return <Aviso titulo="Este link não vale mais">Obrigado pelo carinho com a clínica.</Aviso>;
  }
  const view = (await r.json()) as ReviewView;
  const { estilo } = estiloDoTema(temaSeguro(view.clinic.theme));
  return (
    <div style={estilo}>
      <Avaliar token={token} inicial={view} />
    </div>
  );
}
