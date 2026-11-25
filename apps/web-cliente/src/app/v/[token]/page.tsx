import type { Metadata } from 'next';
import { Aviso } from '@/components/aviso';
import { Oferta } from '@/components/oferta';
import type { OfferView } from '@/lib/api';
import { estiloDoTema, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// Vaga da lista de espera (/v/<token>): o paciente aceita ou passa a vez. Sem login.
export const metadata: Metadata = { title: 'Abriu um horário', robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  const r = /^[A-Za-z0-9_-]{22}$/.test(token)
    ? await fetch(`${API_URL}/public/offers/${token}`, { cache: 'no-store' }).catch(() => null)
    : null;
  if (!r || !r.ok) {
    return (
      <Aviso titulo="Este link não vale mais">
        Você continua na lista de espera. A clínica avisa quando abrir outro horário.
      </Aviso>
    );
  }
  const view = (await r.json()) as OfferView;
  const { estilo } = estiloDoTema(temaSeguro(view.clinic.theme));
  return (
    <div style={estilo}>
      <Oferta token={token} inicial={view} />
    </div>
  );
}
