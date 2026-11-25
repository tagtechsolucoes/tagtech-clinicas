import type { Metadata } from 'next';
import { Tv } from '@/components/tv';

// Tela da TV da sala de espera (/tv/<token>). O link vem do painel (Recepção › Conectar TV).
export const metadata: Metadata = { title: 'Chamada', robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  return <Tv token={/^[A-Za-z0-9_-]{22}$/.test(token) ? token : ''} />;
}
