import type { Metadata } from 'next';
import { Aviso } from '@/components/aviso';
import { Gerenciar } from '@/components/gerenciar';
import type { ManageView } from '@/lib/api';
import { estiloDoTema, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// Link do paciente (/a/<token>): ver a consulta, confirmar ou desmarcar. Sem login.
export const metadata: Metadata = { title: 'Sua consulta', robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  const r = /^[A-Za-z0-9_-]{22}$/.test(token)
    ? await fetch(`${API_URL}/public/appointments/${token}`, { cache: 'no-store' }).catch(
        () => null,
      )
    : null;
  if (!r || !r.ok) {
    return (
      <Aviso titulo="Este link não vale mais">
        Fale com a clínica pelo WhatsApp para saber da sua consulta.
      </Aviso>
    );
  }
  const view = (await r.json()) as ManageView;
  const { estilo } = estiloDoTema(temaSeguro(view.clinic.theme));
  return (
    <div style={estilo}>
      <Gerenciar token={token} inicial={view} />
    </div>
  );
}
