import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatPhoneBR, whatsappLink } from '@tagtech/domain';
import type { PublicClinic } from '@/lib/api';
import { estiloDoTema, imagem, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: 'Aviso de privacidade' };

// Aviso de privacidade da clínica (controladora), com a TagTech como operadora.
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const r = await fetch(`${API_URL}/public/clinics/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!r || !r.ok) notFound();
  const c = (await r.json()) as PublicClinic;
  const { estilo } = estiloDoTema(temaSeguro(c.theme));
  const contato = c.whatsapp
    ? whatsappLink(c.whatsapp, 'Olá! Quero fazer um pedido sobre os meus dados pessoais (LGPD).')
    : null;

  const Secao = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <section className="mt-10">
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
        <h1 className="text-[2.2rem] leading-tight font-medium">
          Como a {c.name} cuida dos seus dados
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-nevoa">
          Este aviso explica quais dados pessoais a clínica guarda, para quê, com quem compartilha e
          como você pede uma cópia, uma correção ou a exclusão, conforme a Lei Geral de Proteção de
          Dados (Lei 13.709/2018).
        </p>

        <Secao t="Quem é responsável">
          <p>
            A <strong className="text-tinta">{c.name}</strong> é a controladora dos seus dados: é
            ela quem decide como eles são usados. A TagTech fornece o sistema de agenda e prontuário
            e trata os dados só em nome da clínica, sob contrato.
          </p>
        </Secao>

        <Secao t="Quais dados e para quê">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-tinta">Nome, WhatsApp, e-mail e nascimento:</strong> para
              marcar a consulta, enviar confirmação e lembrete e falar com você sobre o atendimento.
            </li>
            <li>
              <strong className="text-tinta">
                Dados de saúde (prontuário, exames, fotos clínicas):
              </strong>{' '}
              para o seu tratamento. O prontuário é guardado pelo prazo que a lei exige (20 anos,
              pela Lei 13.787/2018) e só a equipe clínica autorizada vê; cada acesso fica
              registrado.
            </li>
            <li>
              <strong className="text-tinta">CPF, pagamentos e convênio:</strong> para cobrança,
              recibo, nota fiscal e faturamento ao seu plano de saúde.
            </li>
            <li>
              <strong className="text-tinta">Fotos de antes e depois no site ou nas redes:</strong>{' '}
              só com a sua autorização assinada, que você pode revogar quando quiser. Ao revogar, a
              foto sai do site.
            </li>
          </ul>
        </Secao>

        <Secao t="Com quem os dados são compartilhados">
          <p>Só com quem é necessário para o atendimento:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>WhatsApp (Meta), para enviar a confirmação e o lembrete da consulta;</li>
            <li>Mercado Pago, quando você paga pelo Pix;</li>
            <li>prefeitura, pela Focus NFe, para emitir a nota fiscal;</li>
            <li>o seu convênio, quando o atendimento é pelo plano.</li>
          </ul>
          <p>A clínica não vende nem cede seus dados para propaganda.</p>
        </Secao>

        <Secao t="Seus direitos">
          <p>
            Você pode pedir a qualquer momento: confirmação de que a clínica tem dados seus, uma
            cópia deles, correção, e a exclusão do que não precisa ser guardado por lei. A clínica
            entrega a cópia em arquivo e, no pedido de exclusão, apaga seus contatos e cancela os
            agendamentos futuros; o prontuário fica guardado pelo prazo legal, sem uso para
            mensagens.
          </p>
        </Secao>

        <Secao t="Como pedir">
          {contato ? (
            <p>
              Fale com a clínica pelo{' '}
              <a
                href={contato}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-marca underline"
              >
                WhatsApp {formatPhoneBR(c.whatsapp)}
              </a>
              . A clínica responde em até 15 dias.
            </p>
          ) : (
            <p>Fale com a recepção da clínica. A clínica responde em até 15 dias.</p>
          )}
        </Secao>

        <p className="mt-12 text-sm text-bruma">
          {c.units[0]?.address ? `${c.name} · ${c.units[0].address}` : c.name}
        </p>
      </main>
    </div>
  );
}
