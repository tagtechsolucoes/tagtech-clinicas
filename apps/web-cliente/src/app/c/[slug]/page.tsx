import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { addDays, formatBRL, formatPhoneBR, localClock, whatsappLink } from '@tagtech/domain';
import { Agendar, Foto } from '@/components/agendar';
import { Galeria } from '@/components/galeria';
import { EscolherServico, Proximos, type DiaLivre } from '@/components/proximos';
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

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ servico?: string | string[] }>;
};

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

/** Os próximos horários livres do serviço de entrada, para o cartão do topo. */
async function proximosHorarios(
  c: PublicClinic,
): Promise<{ servico: PublicClinic['services'][number]; dias: DiaLivre[] } | null> {
  const servico =
    c.services.find((s) => /avalia|consulta|primeira/i.test(`${s.name} ${s.category}`)) ??
    c.services[0];
  if (!servico || !c.booking.enabled) return null;
  const tz = c.units[0]?.timezone ?? 'America/Recife';
  const hoje = localClock(new Date(), tz).ymd;
  try {
    const q = (extra: string) => `${API_URL}/public/clinics/${c.slug}/${extra}`;
    const dias = (await (
      await fetch(q(`days?serviceId=${servico.id}&from=${hoje}&days=10`), { cache: 'no-store' })
    ).json()) as Array<{ date: string; count: number }>;
    const comVaga = dias.filter((d) => d.count > 0).slice(0, 3);
    const out: DiaLivre[] = [];
    for (const d of comVaga) {
      const slots = (await (
        await fetch(q(`slots?serviceId=${servico.id}&date=${d.date}`), { cache: 'no-store' })
      ).json()) as Array<{ professionalId: string; times: string[] }>;
      const vistos = new Map<string, string>();
      for (const s of slots)
        for (const t of s.times) if (!vistos.has(t)) vistos.set(t, s.professionalId);
      const horarios = [...vistos.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 4)
        .map(([time, professionalId]) => ({ time, professionalId }));
      const rotulo =
        d.date === hoje
          ? 'hoje'
          : d.date === addDays(hoje, 1)
            ? 'amanhã'
            : new Intl.DateTimeFormat('pt-BR', {
                weekday: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })
                .format(new Date(`${d.date}T12:00:00Z`))
                .replace('.', '');
      out.push({ date: d.date, rotulo, horarios });
    }
    return { servico, dias: out };
  } catch {
    return null;
  }
}

const duracaoTexto = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;

export default async function Page({ params, searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const servicoInicial = typeof sp.servico === 'string' ? sp.servico : undefined;
  const c = await carregar((await params).slug);
  if (!c) notFound();
  const { estilo } = estiloDoTema(temaSeguro(c.theme));
  const unidade = c.units[0];
  const zap = c.whatsapp ? whatsappLink(c.whatsapp, `Olá! Vim pelo site da ${c.name}.`) : null;
  const mapa = unidade?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(unidade.address)}`
    : null;
  // "Av. X, 2000 · Boa Viagem · Recife/PE" -> "Boa Viagem, Recife"
  const partes = (unidade?.address ?? '')
    .split('·')
    .map((x) => x.trim())
    .filter(Boolean);
  const lugar =
    partes.length >= 3 ? `${partes[1]}, ${partes[2]!.split('/')[0]}` : (partes[1] ?? '');
  const especialidades = [...new Set(c.services.map((s) => s.category).filter(Boolean))];
  const proximos = await proximosHorarios(c);
  const categorias = [...new Set(c.services.map((s) => s.category || 'Outros'))];

  return (
    <div style={estilo} className="min-h-dvh bg-porcelana">
      {/* Barra do topo */}
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-5 pt-5 sm:px-8 sm:pt-7">
        {c.logoUrl ? (
          <img src={imagem(c.logoUrl)} alt="" className="h-10 w-10 rounded-xl object-cover" />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-marca font-display text-lg text-sobre-marca">
            {c.name.replace(/^cl[íi]nica\s+/i, '').charAt(0)}
          </span>
        )}
        <span className="font-semibold">{c.name}</span>
        <nav
          aria-label="Seções"
          className="ml-auto hidden items-center gap-7 text-[0.95rem] text-nevoa md:flex"
        >
          <a href="#servicos" className="hover:text-tinta">
            Serviços
          </a>
          {c.professionals.length ? (
            <a href="#equipe" className="hover:text-tinta">
              Equipe
            </a>
          ) : null}
          {c.gallery.length ? (
            <a href="#resultados" className="hover:text-tinta">
              Resultados
            </a>
          ) : null}
          <a href="#contato" className="hover:text-tinta">
            Contato
          </a>
        </nav>
        <a
          href="#agendar"
          className="ml-auto inline-flex h-10 items-center rounded-xl bg-tinta px-4 text-sm font-semibold text-white md:ml-7"
        >
          Agendar
        </a>
      </header>

      {/* Abertura: a promessa da clínica e os horários livres de verdade */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pt-12 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16 lg:pt-20 lg:pb-24">
        <div>
          {lugar || especialidades.length ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.95rem] text-nevoa">
              {especialidades.slice(0, 3).map((e) => (
                <span key={e}>{e}</span>
              ))}
              {lugar ? (
                <span className="inline-flex items-center gap-1.5 text-marca">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" />
                    <circle cx="12" cy="9.5" r="2.5" />
                  </svg>
                  {lugar}
                </span>
              ) : null}
            </p>
          ) : null}
          <h1 className="mt-5 text-[2.6rem] leading-[1.02] font-medium tracking-[-0.01em] text-balance sm:text-[3.4rem] lg:text-[4rem]">
            {c.tagline || c.name}
          </h1>
          {c.about ? (
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-nevoa">
              {c.about.split('\n')[0]}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a
              href="#agendar"
              className="inline-flex h-13 items-center rounded-2xl bg-destaque px-6 text-[1.05rem] font-semibold text-sobre-destaque hover:bg-destaque-forte"
            >
              Ver todos os horários
            </a>
            {zap ? (
              <a
                href={zap}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-marca underline decoration-2 underline-offset-4"
              >
                Falar no WhatsApp
              </a>
            ) : null}
          </div>
          {c.insurers.length ? (
            <p className="mt-8 text-sm text-nevoa">
              Atende {c.insurers.map((i) => i.name).join(', ')} e particular.
            </p>
          ) : null}
        </div>
        {proximos ? (
          <Proximos
            serviceId={proximos.servico.id}
            serviceName={proximos.servico.name}
            duracao={duracaoTexto(proximos.servico.durationMinutes)}
            dias={proximos.dias}
            zap={zap}
          />
        ) : null}
      </section>

      {/* Agendamento: faixa na cor da clínica */}
      <section
        id="agendar"
        className="sobre-marca scroll-mt-4 bg-marca-fundo py-14 text-sobre-marca sm:py-20"
      >
        <div className="mx-auto grid max-w-6xl gap-10 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
          <div className="lg:pt-4">
            <h2 className="text-[2.2rem] leading-tight font-medium sm:text-[2.6rem]">
              Marque sua consulta
            </h2>
            <p className="mt-3 max-w-sm text-sobre-marca/75">
              Escolha o serviço, o profissional e o horário. Leva um minuto e não precisa de senha.
            </p>
            <ul className="mt-8 space-y-4 text-[0.95rem]">
              {[
                ['Confirmação no WhatsApp', 'com um link para confirmar ou desmarcar'],
                ['Lembrete antes da consulta', 'para você não esquecer'],
                ['Só horários livres de verdade', 'tirados da agenda da clínica'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-destaque text-[0.7rem] font-bold text-sobre-destaque">
                    ✓
                  </span>
                  <span>
                    <span className="block font-semibold">{t}</span>
                    <span className="text-sobre-marca/65">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-tinta">
            <Agendar clinic={c} servicoInicial={servicoInicial} />
          </div>
        </div>
      </section>

      {/* Serviços como tabela de preços */}
      {c.services.length ? (
        <section
          id="servicos"
          className="mx-auto max-w-6xl scroll-mt-4 px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <div>
              <h2 className="text-[2.2rem] leading-tight font-medium sm:text-[2.6rem]">
                Serviços e valores
              </h2>
              <p className="mt-3 max-w-sm text-nevoa">
                Preço do atendimento particular. Tratamentos maiores recebem orçamento por escrito
                antes de começar.
              </p>
            </div>
            <div className="space-y-10">
              {categorias.map((cat) => (
                <div key={cat}>
                  <h3 className="border-b-2 border-tinta pb-2 font-sans text-[0.95rem] font-bold">
                    {cat}
                  </h3>
                  <ul>
                    {c.services
                      .filter((s) => (s.category || 'Outros') === cat)
                      .map((s) => (
                        <li key={s.id} className="border-b border-linha">
                          <EscolherServico serviceId={s.id} className="group w-full py-4 text-left">
                            <span className="flex items-baseline gap-3">
                              <span className="text-[1.08rem] font-semibold group-hover:text-marca">
                                {s.name}
                              </span>
                              <span
                                aria-hidden
                                className="mb-1 flex-1 border-b border-dotted border-bruma"
                              />
                              <span className="font-display text-[1.15rem] tabular-nums">
                                {s.priceCents === null ? 'sob avaliação' : formatBRL(s.priceCents)}
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-3 text-sm text-nevoa">
                              <span>
                                {duracaoTexto(s.durationMinutes)}
                                {s.telehealth ? ' · online' : ''}
                                {s.description ? ` · ${s.description}` : ''}
                              </span>
                              <span className="ml-auto shrink-0 font-semibold text-marca opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                Agendar →
                              </span>
                            </span>
                          </EscolherServico>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Equipe */}
      {c.professionals.length ? (
        <section id="equipe" className="scroll-mt-4 bg-folha py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <h2 className="text-[2.2rem] leading-tight font-medium sm:text-[2.6rem]">
              Quem vai cuidar de você
            </h2>
            <ul className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {c.professionals.map((p) => (
                <li key={p.id}>
                  {p.photoUrl ? (
                    <img
                      src={imagem(p.photoUrl)}
                      alt=""
                      className="aspect-[5/4] w-full rounded-3xl object-cover"
                    />
                  ) : (
                    <div
                      className="relative grid aspect-[5/4] w-full place-items-center overflow-hidden rounded-3xl bg-marca/10 text-marca"
                      style={
                        p.color && /^#[0-9a-f]{6}$/i.test(p.color)
                          ? {
                              background: `color-mix(in srgb, ${p.color} 13%, white)`,
                              color: p.color,
                            }
                          : undefined
                      }
                    >
                      <span className="font-display text-[5rem] leading-none">
                        {p.name
                          .replace(/^(dra?\.?|dr\.)\s+/i, '')
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((x) => x[0])
                          .join('')}
                      </span>
                    </div>
                  )}
                  <p className="mt-5 text-xl font-semibold">{p.name}</p>
                  <p className="text-nevoa">
                    {[p.specialty, p.council].filter(Boolean).join(' · ')}
                  </p>
                  {p.bio ? <p className="mt-2 leading-relaxed text-nevoa">{p.bio}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {c.gallery.length ? (
        <section
          id="resultados"
          className="mx-auto max-w-6xl scroll-mt-4 px-5 py-16 sm:px-8 sm:py-24"
        >
          <h2 className="text-[2.2rem] leading-tight font-medium sm:text-[2.6rem]">Resultados</h2>
          <p className="mt-3 max-w-xl text-nevoa">
            Arraste para comparar. Fotos publicadas com autorização dos pacientes.
          </p>
          <div className="mt-8">
            <Galeria itens={c.gallery} />
          </div>
        </section>
      ) : null}

      {/* Contato */}
      <section id="contato" className="mx-auto max-w-6xl scroll-mt-4 px-5 py-16 sm:px-8 sm:py-24">
        <div className="grid gap-10 rounded-[2rem] bg-folha p-8 ring-1 ring-linha sm:p-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div>
            <p className="text-nevoa">Onde fica</p>
            <p className="mt-2 font-display text-[1.9rem] leading-tight sm:text-[2.3rem]">
              {partes[0] || unidade?.name || c.name}
            </p>
            {partes.length > 1 ? (
              <p className="mt-1 text-lg text-nevoa">{partes.slice(1).join(' · ')}</p>
            ) : null}
            {mapa ? (
              <a
                href={mapa}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex h-11 items-center rounded-xl px-4 font-semibold ring-1 ring-linha hover:ring-tinta/40"
              >
                Abrir no mapa
              </a>
            ) : null}
          </div>
          <dl className="space-y-5 lg:border-l lg:border-linha lg:pl-10">
            {c.whatsapp && zap ? (
              <div>
                <dt className="text-sm text-nevoa">WhatsApp</dt>
                <dd>
                  <a
                    href={zap}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lg font-semibold text-marca"
                  >
                    {formatPhoneBR(c.whatsapp)}
                  </a>
                </dd>
              </div>
            ) : null}
            {c.instagram ? (
              <div>
                <dt className="text-sm text-nevoa">Instagram</dt>
                <dd>
                  <a
                    href={`https://instagram.com/${c.instagram}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lg font-semibold text-marca"
                  >
                    @{c.instagram}
                  </a>
                </dd>
              </div>
            ) : null}
            {c.insurers.length ? (
              <div>
                <dt className="text-sm text-nevoa">Convênios</dt>
                <dd className="text-lg font-semibold">
                  {c.insurers.map((i) => i.name).join(', ')}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 border-t border-linha px-5 py-8 text-sm text-bruma sm:px-8">
        <span>© {c.name}</span>
        <a href={`/c/${c.slug}/privacidade`} className="hover:text-nevoa">
          Privacidade
        </a>
        <a href={`/c/${c.slug}/termos`} className="hover:text-nevoa">
          Termos do agendamento
        </a>
        <span className="sm:ml-auto">Agendamento por TagTech Clínicas</span>
      </footer>
    </div>
  );
}
