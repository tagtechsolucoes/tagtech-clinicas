import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatBRL } from '@tagtech/domain';
import type { PublicClinic } from '@/lib/api';
import { estiloDoTema, imagem, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: 'Termos do agendamento online' };

// Regras do agendamento pelo site: o que o paciente aceita ao marcar.
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const r = await fetch(`${API_URL}/public/clinics/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!r || !r.ok) notFound();
  const c = (await r.json()) as PublicClinic;
  const { estilo } = estiloDoTema(temaSeguro(c.theme));
  const sinal = c.booking.depositCents;

  const Item = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <section className="mt-9">
      <h2 className="text-xl font-medium">{t}</h2>
      <div className="mt-3 space-y-3 leading-relaxed text-nevoa">{children}</div>
    </section>
  );

  return (
    <div style={estilo}>
      <header className="sobre-marca bg-marca px-5 py-8 text-sobre-marca">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {c.logoUrl ? (
            <img src={imagem(c.logoUrl)} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : null}
          <a href={`/c/${c.slug}`} className="font-semibold">
            {c.name}
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="text-[2.2rem] leading-tight font-medium">Termos do agendamento online</h1>
        <p className="mt-4 text-lg leading-relaxed text-nevoa">
          Ao marcar pelo site da {c.name}, você concorda com estas regras.
        </p>

        <Item t="Seu horário">
          <p>
            O horário é reservado no momento em que você confirma. Você recebe a confirmação e um
            lembrete pelo WhatsApp, com um link só seu para confirmar ou desmarcar.
          </p>
          <p>
            Use seu nome e WhatsApp verdadeiros. A clínica pode cancelar agendamentos com dados
            falsos ou repetidos.
          </p>
        </Item>

        {sinal > 0 ? (
          <Item t="Sinal">
            <p>
              Para garantir o horário, a clínica cobra um sinal de {formatBRL(sinal)} no Pix. Se o
              pagamento não for feito em 30 minutos, o horário volta a ficar livre para outra
              pessoa. A devolução do sinal em caso de desistência segue a política da clínica:
              pergunte antes de pagar.
            </p>
          </Item>
        ) : null}

        <Item t="Desmarcar ou remarcar">
          <p>
            Pelo link que você recebe, dá para desmarcar enquanto a consulta não começou. Avise o
            quanto antes: o horário pode ser oferecido a quem está na lista de espera.
          </p>
        </Item>

        <Item t="Valores">
          <p>
            Os preços mostrados no site são os da consulta ou do procedimento particular. O valor
            final do tratamento depende da avaliação do profissional e vem num orçamento à parte.
          </p>
        </Item>

        <Item t="Seus dados">
          <p>
            Veja{' '}
            <a href={`/c/${c.slug}/privacidade`} className="font-semibold text-marca underline">
              como a clínica cuida dos seus dados
            </a>
            .
          </p>
        </Item>

        <Item t="Sistema">
          <p>
            O site e a agenda são fornecidos pela TagTech, que não presta o atendimento de saúde.
            Dúvidas sobre consulta, valores e tratamento são com a {c.name}.
          </p>
        </Item>
      </main>
    </div>
  );
}
