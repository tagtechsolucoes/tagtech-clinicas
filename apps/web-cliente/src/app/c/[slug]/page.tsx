import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { formatPhoneBR, whatsappLink } from '@tagtech/domain';
import { Agendar, Foto } from '@/components/agendar';
import { Galeria } from '@/components/galeria';
import type { PublicClinic } from '@/lib/api';
import { estiloDoTema, iconesDaCasa, imagem, temaSeguro } from '@/lib/tema';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// Site público da clínica (/c/<endereço>): apresentação e agendamento online.
const carregar = cache(async (slug: string): Promise<PublicClinic | null> => {
  const r = await fetch(`${API_URL}/public/clinics/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`API respondeu ${r.status}`);
  return (await r.json()) as PublicClinic;
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await carregar((await params).slug).catch(() => null);
  return c
    ? {
        title: `${c.name} · Agende online`,
        description: c.tagline || `Agende sua consulta na ${c.name}.`,
        ...iconesDaCasa(c.logoUrl),
      }
    : {};
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const c = await carregar((await params).slug).catch(() => null);
  return c ? { themeColor: temaSeguro(c.theme).primaryColor } : {};
}

export default async function Page({ params }: Props) {
  const c = await carregar((await params).slug);
  if (!c) notFound();
  const { estilo } = estiloDoTema(temaSeguro(c.theme));
  const unidade = c.units[0];
  const zap = c.whatsapp ? whatsappLink(c.whatsapp, `Olá! Vim pelo site da ${c.name}.`) : null;
  const mapa = unidade?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(unidade.address)}`
    : null;

  return (
    <div style={estilo}>
      <header className="sobre-marca relative overflow-hidden bg-marca text-sobre-marca">
        {c.coverUrl ? (
          <img
            src={imagem(c.coverUrl)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity"
          />
        ) : null}
        <div className="relative mx-auto max-w-6xl px-5 pt-8 pb-28 sm:px-8 lg:pb-36">
          <div className="flex items-center gap-3">
            {c.logoUrl ? (
              <img
                src={imagem(c.logoUrl)}
                alt=""
                className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/20"
              />
            ) : null}
            <span className="font-semibold">{c.name}</span>
          </div>
          <h1 className="mt-14 max-w-3xl text-[2.7rem] leading-[1.03] font-medium sm:text-[3.6rem]">
            {c.tagline || c.name}
          </h1>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#agendar"
              className="inline-flex h-12 items-center rounded-2xl bg-destaque px-6 font-semibold text-sobre-destaque hover:bg-destaque-forte"
            >
              Agendar horário
            </a>
            {zap ? (
              <a
                href={zap}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center rounded-2xl px-5 font-semibold ring-1 ring-current/30 hover:ring-current/60"
              >
                Falar no WhatsApp
              </a>
            ) : null}
          </div>
          {unidade?.address ? <p className="mt-6 text-sm opacity-75">{unidade.address}</p> : null}
        </div>
      </header>

      <main className="mx-auto -mt-16 grid max-w-6xl gap-10 px-5 pb-20 sm:px-8 lg:-mt-24 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <section id="agendar" className="scroll-mt-6">
          <Agendar clinic={c} />
        </section>

        <aside className="space-y-10 lg:pt-28">
          {c.professionals.length ? (
            <section>
              <h2 className="text-2xl font-medium">Quem atende</h2>
              <ul className="mt-5 space-y-5">
                {c.professionals.map((p) => (
                  <li key={p.id} className="flex gap-4">
                    <Foto nome={p.name} url={p.photoUrl} tamanho="h-16 w-16 text-lg" />
                    <div className="min-w-0">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-sm text-nevoa">
                        {[p.specialty, p.council].filter(Boolean).join(' · ')}
                      </p>
                      {p.bio ? (
                        <p className="mt-1.5 text-sm leading-relaxed text-nevoa">{p.bio}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {c.about ? (
            <section>
              <h2 className="text-2xl font-medium">Sobre a clínica</h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-nevoa">{c.about}</p>
            </section>
          ) : null}

          {c.insurers.length ? (
            <section>
              <h2 className="text-2xl font-medium">Convênios aceitos</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {c.insurers.map((i) => (
                  <li
                    key={i.id}
                    className="rounded-xl bg-folha px-3.5 py-2 text-sm font-semibold ring-1 ring-linha"
                  >
                    {i.name}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-3xl bg-folha p-6 ring-1 ring-linha">
            <h2 className="text-xl font-medium">Como chegar e contato</h2>
            <dl className="mt-4 space-y-3 text-sm">
              {unidade?.address ? (
                <div>
                  <dt className="font-semibold text-nevoa">Endereço</dt>
                  <dd className="mt-0.5">
                    {unidade.address}
                    {mapa ? (
                      <>
                        {' '}
                        <a
                          href={mapa}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-marca underline"
                        >
                          Abrir no mapa
                        </a>
                      </>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              {c.whatsapp && zap ? (
                <div>
                  <dt className="font-semibold text-nevoa">WhatsApp</dt>
                  <dd className="mt-0.5">
                    <a
                      href={zap}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-marca underline"
                    >
                      {formatPhoneBR(c.whatsapp)}
                    </a>
                  </dd>
                </div>
              ) : null}
              {c.instagram ? (
                <div>
                  <dt className="font-semibold text-nevoa">Instagram</dt>
                  <dd className="mt-0.5">
                    <a
                      href={`https://instagram.com/${c.instagram}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-marca underline"
                    >
                      @{c.instagram}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </main>

      {c.gallery.length ? (
        <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
          <h2 className="text-[2rem] font-medium">Resultados</h2>
          <p className="mt-2 max-w-xl text-nevoa">
            Arraste para comparar. Fotos publicadas com autorização dos pacientes.
          </p>
          <div className="mt-6">
            <Galeria itens={c.gallery} />
          </div>
        </section>
      ) : null}

      <footer className="border-t border-linha py-8 text-center text-sm text-bruma">
        Agendamento online por TagTech Clínicas
      </footer>
    </div>
  );
}
