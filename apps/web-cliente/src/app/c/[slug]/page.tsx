import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { addDays, formatBRL, formatPhoneBR, localClock, whatsappLink } from '@tagtech/domain';
import { Agendar } from '@/components/agendar';
import { Galeria } from '@/components/galeria';
import { EscolherServico, Proximos, type DiaLivre } from '@/components/proximos';
import { Estrelas, Icone, Pilula, Rotulo, Selo, Titulo, type NomeIcone } from '@/components/site';
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
  min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? `${min % 60}` : ''}`;

const iniciais = (nome: string) =>
  nome
    .replace(/^(dra?\.?|dr\.)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('');

const corValida = (cor: string | null | undefined) =>
  cor && /^#[0-9a-f]{6}$/i.test(cor) ? cor : null;

const ICONES_DESTAQUE: NomeIcone[] = ['relogio', 'escudo', 'documento', 'coracao'];

export default async function Page({ params, searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const servicoInicial = typeof sp.servico === 'string' ? sp.servico : undefined;
  const c = await carregar((await params).slug);
  if (!c) notFound();
  const { estilo } = estiloDoTema(temaSeguro(c.theme));
  const site = c.site;
  const unidade = c.units[0];
  const zap = c.whatsapp ? whatsappLink(c.whatsapp, `Olá! Vim pelo site da ${c.name}.`) : null;
  const endereco = unidade?.address ?? '';
  const mapa = endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`
    : null;
  const waze = endereco
    ? `https://waze.com/ul?q=${encodeURIComponent(endereco)}&navigate=yes`
    : null;
  // "Av. X, 2000 · Boa Viagem · Recife/PE" -> rua e o resto
  const partes = endereco
    .split('·')
    .map((x) => x.trim())
    .filter(Boolean);
  const lugar = partes.slice(1).join(' · ');
  const categorias = [...new Set(c.services.map((s) => s.category || 'Outros'))];
  const proximos = await proximosHorarios(c);
  const primeiro = proximos?.dias[0]?.horarios[0]
    ? { dia: proximos.dias[0]!, hora: proximos.dias[0]!.horarios[0]!.time }
    : null;
  const unico = c.professionals.length === 1 ? c.professionals[0]! : null;
  const fotos = c.photos;
  const colagem = fotos.slice(0, 3);
  const nomeCurto = c.name.replace(/^cl[íi]nica\s+/i, '');
  const pag = site.payments;
  const formas = [
    pag.pix && {
      t: 'Pix',
      d: pag.pixDiscountPct ? `${pag.pixDiscountPct}% de desconto à vista` : 'à vista',
    },
    pag.credit && {
      t: 'Cartão de crédito',
      d: pag.installments > 1 ? `em até ${pag.installments}x` : 'à vista',
    },
    pag.debit && { t: 'Cartão de débito', d: 'na hora' },
    pag.cash && { t: 'Dinheiro', d: 'na recepção' },
    c.insurers.length > 0 && {
      t: 'Plano odontológico',
      d: `${c.insurers.length} ${c.insurers.length === 1 ? 'plano aceito' : 'planos aceitos'}`,
    },
  ].filter((x): x is { t: string; d: string } => !!x);
  const faixa = [
    ...new Set([...categorias.filter((x) => x !== 'Outros'), ...c.services.map((s) => s.name)]),
  ].slice(0, 8);
  const nav = [
    ['#sobre', 'Sobre'],
    ['#servicos', 'Serviços'],
    c.gallery.length ? ['#resultados', 'Resultados'] : null,
    c.professionals.length ? ['#equipe', 'Equipe'] : null,
    site.faq.length ? ['#duvidas', 'Dúvidas'] : null,
    ['#contato', 'Como chegar'],
  ].filter((x): x is string[] => !!x);

  return (
    <div style={estilo} className="min-h-dvh overflow-x-clip bg-[var(--marca-nevoa)]">
      {/* Barra flutuante */}
      <header className="sticky top-3 z-40 mx-auto mt-3 max-w-6xl px-3 sm:px-6">
        <div className="flex items-center gap-3 rounded-full bg-white/90 py-2 pr-2 pl-3 shadow-[0_12px_30px_-18px_rgb(15_32_40/0.35)] ring-1 ring-[var(--marca-borda)] backdrop-blur sm:pl-4">
          {c.logoUrl ? (
            <img src={imagem(c.logoUrl)} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full font-display text-sobre-marca [background:var(--marca-grad)]">
              {nomeCurto.charAt(0)}
            </span>
          )}
          <span className="truncate font-semibold text-marca-fundo">{c.name}</span>
          <nav
            aria-label="Seções"
            className="ml-auto hidden items-center gap-6 text-[0.92rem] text-nevoa lg:flex"
          >
            {nav.map(([h, t]) => (
              <a key={h} href={h} className="hover:text-marca">
                {t}
              </a>
            ))}
          </nav>
          <a
            href="#agendar"
            className="pilula pilula-cheia ml-auto min-h-0 py-1.5 pr-1.5 text-sm lg:ml-4"
          >
            Agendar
            <span className="pilula-icone h-8 w-8">
              <Icone nome="calendario" className="h-4 w-4" />
            </span>
          </a>
        </div>
      </header>

      {/* Abertura */}
      <section className="fundo-topo relative -mt-20 overflow-hidden pt-32 pb-14 sm:pt-36 lg:pb-20">
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="flex flex-wrap items-center gap-3 text-[0.9rem] font-semibold text-marca">
              {unico ? (
                <>
                  {unico.name}
                  {unico.council ? (
                    <>
                      <i className="h-px w-7 bg-[var(--marca-borda)]" />
                      <span className="font-normal text-nevoa">{unico.council}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <Icone nome="pino" className="h-4 w-4" />
                  {lugar || c.name}
                </>
              )}
            </p>
            <h1 className="mt-5 text-[2.5rem] leading-[1.04] text-balance text-marca-fundo sm:text-[3.3rem] lg:text-[3.9rem]">
              {c.tagline || c.name}
            </h1>
            {c.about ? (
              <p className="mt-6 max-w-xl text-[1.08rem] leading-relaxed text-nevoa">
                {c.about.split('\n')[0]}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Pilula href="#agendar">Agendar minha consulta</Pilula>
              <Pilula href="#servicos" vazia>
                Ver serviços
              </Pilula>
            </div>
            {primeiro && proximos ? (
              <EscolherServico
                serviceId={proximos.servico.id}
                data={primeiro.dia.date}
                hora={primeiro.hora}
                className="mt-5 flex w-full max-w-sm items-center gap-3 rounded-2xl bg-white p-2.5 pl-3 text-left shadow-[0_14px_30px_-22px_rgb(15_32_40/0.5)] ring-1 ring-[var(--marca-borda)] transition hover:ring-marca/40"
              >
                <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--marca-nevoa)] text-marca">
                  <Icone nome="calendario" />
                  <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.78rem] text-nevoa">Próximo horário livre</span>
                  <span className="block font-semibold text-tinta first-letter:uppercase">
                    {primeiro.dia.rotulo}, às {primeiro.hora}
                  </span>
                </span>
                <span className="rounded-full px-3.5 py-2 text-sm font-semibold text-sobre-marca [background:var(--marca-grad)]">
                  Reservar
                </span>
              </EscolherServico>
            ) : null}
            {site.stats.length ? (
              <dl className="mt-9 grid max-w-lg grid-cols-3">
                {site.stats.map((s, i) => (
                  <div
                    key={i}
                    className={i ? 'border-l border-[var(--marca-borda)] pl-4 sm:pl-7' : 'pr-4'}
                  >
                    <dt className="sr-only">{s.label}</dt>
                    <dd className="font-display text-[1.3rem] leading-none text-marca-fundo sm:text-[1.7rem]">
                      {s.value}
                    </dd>
                    <dd className="mt-1.5 text-[0.78rem] leading-snug text-nevoa sm:text-[0.85rem]">
                      {s.label}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          {c.coverUrl ? (
            <div className="relative mx-auto w-full max-w-[28rem] lg:mr-0">
              <div
                className="arco absolute -inset-3.5 right-5 bottom-6 border border-[var(--marca-borda)]"
                aria-hidden
              />
              <div className="arco relative aspect-[4/5] overflow-hidden shadow-[0_40px_70px_-40px_rgb(15_32_40/0.6)] [background:var(--marca-grad)]">
                <img src={imagem(c.coverUrl)} alt="" className="h-full w-full object-cover" />
              </div>
              <Selo
                texto={nomeCurto}
                className="absolute bottom-28 left-2 scale-90 sm:-left-12 sm:scale-100"
              />
              {site.rating ? (
                <div className="absolute right-0 bottom-8 rounded-2xl bg-white/95 px-4 py-3 shadow-[0_18px_40px_-26px_rgb(15_32_40/0.6)] sm:-right-4">
                  <Estrelas className="h-3.5 w-3.5" />
                  <p className="mt-1 font-display text-[1.8rem] leading-none text-marca-fundo">
                    {site.rating.value.toFixed(1).replace('.', ',')}
                  </p>
                  <p className="mt-1 text-xs text-nevoa">
                    de {site.rating.count.toLocaleString('pt-BR')} avaliações
                  </p>
                </div>
              ) : null}
            </div>
          ) : proximos ? (
            <Proximos
              serviceId={proximos.servico.id}
              serviceName={proximos.servico.name}
              duracao={duracaoTexto(proximos.servico.durationMinutes)}
              dias={proximos.dias}
              zap={zap}
            />
          ) : null}
        </div>
      </section>

      {/* Faixa das especialidades */}
      {faixa.length > 2 ? (
        <div
          className="overflow-hidden py-4 text-sobre-marca [background:var(--marca-grad)]"
          aria-hidden
        >
          <div className="faixa-corre flex w-max">
            {[0, 1].map((k) => (
              <div key={k} className="flex shrink-0 items-center">
                {[...faixa, ...faixa].map((t, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-8 pr-8 text-[0.95rem] font-semibold whitespace-nowrap"
                  >
                    {t}
                    <span className="h-1.5 w-1.5 rounded-full bg-sobre-marca/50" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Sobre */}
      <section id="sobre" className="scroll-mt-24 py-20 sm:py-28">
        <div
          className={`mx-auto grid max-w-6xl items-center gap-14 px-5 sm:px-8 ${colagem.length ? 'lg:grid-cols-2' : ''}`}
        >
          {colagem.length ? (
            <div className={`grid gap-4 ${colagem.length > 1 ? 'grid-cols-[1.15fr_1fr]' : ''}`}>
              <div
                className={`arco overflow-hidden ${colagem.length > 1 ? 'row-span-2' : ''} aspect-[4/5]`}
              >
                <img
                  src={imagem(colagem[0]!.url)}
                  alt={colagem[0]!.title}
                  className="h-full w-full object-cover"
                />
              </div>
              {colagem.slice(1).map((f) => (
                <div
                  key={f.id}
                  className={`overflow-hidden rounded-3xl ${colagem.length === 2 ? 'row-span-2' : 'aspect-square'}`}
                >
                  <img src={imagem(f.url)} alt={f.title} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          ) : null}
          <div>
            <Titulo rotulo="Sobre" texto={c.about || undefined}>
              Conheça a {c.name}
            </Titulo>
            {site.highlights.length ? (
              <ul className="mt-9 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {site.highlights.map((h, i) => (
                  <li key={i} className="flex gap-3.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-marca ring-1 ring-[var(--marca-borda)]">
                      <Icone
                        nome={ICONES_DESTAQUE[i % ICONES_DESTAQUE.length]!}
                        className="h-[1.15rem] w-[1.15rem]"
                      />
                    </span>
                    <span>
                      <span className="block font-semibold text-tinta">{h.title}</span>
                      <span className="mt-0.5 block text-[0.92rem] leading-snug text-nevoa">
                        {h.text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-9">
              <Pilula href="#agendar">Agendar pelo site</Pilula>
            </div>
          </div>
        </div>
      </section>

      {/* Serviços por área */}
      {c.services.length ? (
        <section id="servicos" className="scroll-mt-24 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Titulo
              rotulo="Serviços"
              centro
              texto="Toque em um serviço para ver os horários livres. Ao lado de cada um, a duração média e o valor particular."
            >
              O que cuidamos por aqui
            </Titulo>
            <div className="mt-14 gap-5 md:columns-2">
              {categorias.map((cat) => (
                <div
                  key={cat}
                  className="mb-5 break-inside-avoid rounded-[1.75rem] bg-[var(--marca-nevoa)] p-6 ring-1 ring-[var(--marca-borda)] sm:p-8"
                >
                  <h3 className="text-[1.35rem] text-marca-fundo">{cat}</h3>
                  <ul className="mt-5 divide-y divide-[var(--marca-borda)]">
                    {c.services
                      .filter((s) => (s.category || 'Outros') === cat)
                      .map((s) => (
                        <li key={s.id}>
                          <EscolherServico
                            serviceId={s.id}
                            className="group flex w-full items-center gap-3 py-3.5 text-left"
                          >
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-marca ring-1 ring-[var(--marca-borda)] transition group-hover:text-sobre-marca group-hover:[background:var(--marca-grad)]">
                              <Icone nome="check" className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-tinta group-hover:text-marca">
                                {s.name}
                              </span>
                              {s.description ? (
                                <span className="block truncate text-[0.85rem] text-nevoa">
                                  {s.description}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[0.95rem] font-semibold text-tinta tabular-nums">
                                {s.priceCents === null ? 'Sob avaliação' : formatBRL(s.priceCents)}
                              </span>
                              <span className="mt-0.5 inline-block rounded-full bg-white px-2 py-0.5 text-[0.75rem] text-nevoa ring-1 ring-[var(--marca-borda)]">
                                {duracaoTexto(s.durationMinutes)}
                                {s.telehealth ? ' · online' : ''}
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

      {/* Agendamento */}
      <section
        id="agendar"
        className="sobre-marca relative scroll-mt-20 overflow-hidden bg-marca-fundo py-20 text-sobre-marca sm:py-28"
      >
        <div
          className="absolute -top-40 -right-40 h-[30rem] w-[30rem] rounded-full border border-white/10"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="lg:pt-4">
            <Titulo
              rotulo="Agendamento online"
              claro
              texto="Os horários abaixo são os que estão livres agora na agenda. Você escolhe, confirma e recebe tudo no WhatsApp."
            >
              Escolha o melhor horário
            </Titulo>
            <ul className="mt-8 space-y-3.5">
              {[
                'Sem cadastro e sem senha',
                'Confirmação e lembrete pelo WhatsApp',
                'Remarque pelo link quando precisar',
                c.insurers.length
                  ? `Aceitamos ${c.insurers.length} ${c.insurers.length === 1 ? 'plano' : 'planos'}`
                  : null,
              ]
                .filter(Boolean)
                .map((t) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white/12 ring-1 ring-white/25">
                      <Icone nome="check" className="h-3.5 w-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
            </ul>
          </div>
          <div className="text-tinta">
            <Agendar clinic={c} servicoInicial={servicoInicial} />
          </div>
        </div>
      </section>

      {/* Resultados */}
      {c.gallery.length ? (
        <section id="resultados" className="scroll-mt-24 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Titulo
              rotulo="Resultados"
              texto="Arraste a linha para comparar. Fotos publicadas com autorização dos pacientes."
            >
              Antes e depois
            </Titulo>
            <div className="mt-10">
              <Galeria itens={c.gallery} />
            </div>
          </div>
        </section>
      ) : null}

      {/* Depoimentos */}
      {site.testimonials.length ? (
        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Titulo
              rotulo="Depoimentos"
              centro
              texto={
                site.rating
                  ? `Nota ${site.rating.value.toFixed(1).replace('.', ',')} de ${site.rating.count.toLocaleString('pt-BR')} avaliações.`
                  : undefined
              }
            >
              O que dizem os pacientes
            </Titulo>
            <ul className="sem-barra -mx-5 mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
              {site.testimonials.map((t, i) => (
                <li
                  key={i}
                  className="flex w-[82%] shrink-0 snap-start flex-col rounded-[1.5rem] bg-[var(--marca-nevoa)] p-6 ring-1 ring-[var(--marca-borda)] sm:w-auto"
                >
                  <Estrelas />
                  <blockquote className="mt-4 flex-1 leading-relaxed text-tinta">
                    “{t.text}”
                  </blockquote>
                  <footer className="mt-6 flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-sobre-marca [background:var(--marca-grad)]">
                      {iniciais(t.name)}
                    </span>
                    <span>
                      <span className="block font-semibold text-tinta">{t.name}</span>
                      {t.service ? (
                        <span className="block text-sm text-nevoa">{t.service}</span>
                      ) : null}
                    </span>
                  </footer>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Equipe */}
      {c.professionals.length ? (
        <section id="equipe" className="scroll-mt-24 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            {unico ? (
              <div className="grid items-stretch gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="arco relative aspect-[4/5] overflow-hidden lg:aspect-auto">
                  {unico.photoUrl ? (
                    <img
                      src={imagem(unico.photoUrl)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full place-items-center font-display text-[6rem] text-sobre-marca [background:var(--marca-grad)]">
                      {iniciais(unico.name)}
                    </span>
                  )}
                </div>
                <div className="rounded-[2rem] bg-white p-8 ring-1 ring-[var(--marca-borda)] sm:p-12">
                  <Rotulo>Quem atende</Rotulo>
                  <h2 className="mt-4 text-[2.2rem] leading-tight text-marca-fundo">
                    {unico.name}
                  </h2>
                  {unico.bio ? (
                    <p className="mt-4 leading-relaxed text-nevoa">{unico.bio}</p>
                  ) : null}
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {[unico.council, unico.specialty].filter(Boolean).map((x) => (
                      <li
                        key={x}
                        className="rounded-full bg-[var(--marca-nevoa)] px-3.5 py-1.5 text-sm text-tinta ring-1 ring-[var(--marca-borda)]"
                      >
                        {x}
                      </li>
                    ))}
                  </ul>
                  <Pilula href="#agendar" className="mt-8">
                    Agendar com {unico.name.split(' ').slice(0, 2).join(' ')}
                  </Pilula>
                </div>
              </div>
            ) : (
              <>
                <Titulo rotulo="Equipe" centro>
                  Quem vai cuidar de você
                </Titulo>
                <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {c.professionals.map((p) => {
                    const cor = corValida(p.color);
                    return (
                      <li
                        key={p.id}
                        className="overflow-hidden rounded-[1.75rem] bg-white ring-1 ring-[var(--marca-borda)]"
                      >
                        <div className="relative aspect-[5/4] overflow-hidden">
                          {p.photoUrl ? (
                            <img
                              src={imagem(p.photoUrl)}
                              alt=""
                              className="h-full w-full object-cover object-top"
                            />
                          ) : (
                            <span
                              className="grid h-full place-items-center font-display text-[4.5rem] text-marca"
                              style={
                                cor
                                  ? {
                                      background: `color-mix(in srgb, ${cor} 12%, white)`,
                                      color: cor,
                                    }
                                  : { background: 'var(--marca-nevoa)' }
                              }
                            >
                              {iniciais(p.name)}
                            </span>
                          )}
                        </div>
                        <div className="p-6">
                          <p className="text-lg font-semibold text-tinta">{p.name}</p>
                          <p className="text-sm text-marca">
                            {[p.specialty, p.council].filter(Boolean).join(' · ')}
                          </p>
                          {p.bio ? (
                            <p className="mt-3 text-[0.95rem] leading-relaxed text-nevoa">
                              {p.bio}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </section>
      ) : null}

      {/* Espaço */}
      {fotos.length > 1 ? (
        <section className="overflow-hidden bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Titulo
              rotulo="O espaço"
              centro
              texto="Um ambiente pensado para você se sentir à vontade do começo ao fim."
            >
              Um lugar feito para o seu conforto
            </Titulo>
          </div>
          <ul className="sem-barra mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-2 sm:px-[max(2rem,calc((100vw-72rem)/2+2rem))]">
            {fotos.map((f) => (
              <li
                key={f.id}
                className="relative aspect-[4/5] w-[72%] shrink-0 snap-start overflow-hidden rounded-[1.5rem] sm:w-[19rem]"
              >
                <img src={imagem(f.url)} alt={f.title} className="h-full w-full object-cover" />
                {f.title || f.caption ? (
                  <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-white/90 px-4 py-3 backdrop-blur">
                    {f.title ? <p className="font-semibold text-marca-fundo">{f.title}</p> : null}
                    {f.caption ? (
                      <p className="text-[0.82rem] leading-snug text-nevoa">{f.caption}</p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Pagamento */}
      {formas.length ? (
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <div className="rounded-[2rem] bg-white p-7 text-center ring-1 ring-[var(--marca-borda)] sm:p-12">
              <h2 className="text-[2rem] leading-tight text-marca-fundo sm:text-[2.4rem]">
                Pagamento e planos
              </h2>
              <ul className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {formas.map((f) => (
                  <li
                    key={f.t}
                    className="rounded-2xl bg-[var(--marca-nevoa)] px-4 py-5 ring-1 ring-[var(--marca-borda)]"
                  >
                    <p className="font-semibold text-marca-fundo">{f.t}</p>
                    <p className="mt-1 text-sm text-nevoa">{f.d}</p>
                  </li>
                ))}
              </ul>
              {c.insurers.length ? (
                <>
                  <p className="mt-10 font-semibold text-marca-fundo">Planos aceitos</p>
                  <ul className="mt-4 flex flex-wrap justify-center gap-2">
                    {c.insurers.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm text-tinta ring-1 ring-[var(--marca-borda)]"
                      >
                        <Icone nome="check" className="h-3.5 w-3.5 text-marca" />
                        {i.name}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {pag.note ? (
                <p className="mx-auto mt-6 max-w-md text-sm text-nevoa">{pag.note}</p>
              ) : null}
              <Pilula href="#agendar" className="mt-8">
                Agendar consulta
              </Pilula>
            </div>
          </div>
        </section>
      ) : null}

      {/* Dúvidas */}
      {site.faq.length ? (
        <section id="duvidas" className="scroll-mt-24 pb-20 sm:pb-28">
          <div className="mx-auto max-w-3xl px-5 sm:px-8">
            <Titulo rotulo="Dúvidas" centro>
              Perguntas frequentes
            </Titulo>
            <div className="mt-12 space-y-3">
              {site.faq.map((f, i) => (
                <details
                  key={i}
                  className="duvida group rounded-2xl bg-white ring-1 ring-[var(--marca-borda)]"
                  open={i === 0}
                >
                  <summary className="flex cursor-pointer items-center gap-4 px-5 py-4 font-semibold text-tinta sm:px-6">
                    <span className="flex-1">{f.question}</span>
                    <span className="duvida-icone grid h-7 w-7 shrink-0 place-items-center rounded-full text-sobre-marca transition-transform [background:var(--marca-grad)]">
                      <Icone nome="mais" className="h-4 w-4" />
                    </span>
                  </summary>
                  <p className="px-5 pb-5 leading-relaxed text-nevoa sm:px-6">{f.answer}</p>
                </details>
              ))}
            </div>
            {zap ? (
              <div className="mt-10 text-center">
                <Pilula href={zap} externo icone="zap">
                  Tirar outras dúvidas
                </Pilula>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Como chegar */}
      <section id="contato" className="scroll-mt-24 bg-white py-20 sm:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
          <div>
            <Titulo rotulo="Localização">Como chegar</Titulo>
            {partes[0] ? (
              <p className="mt-6 text-lg font-semibold text-tinta">{partes[0]}</p>
            ) : null}
            {lugar ? <p className="text-nevoa">{lugar}</p> : null}
            {site.arrival.length ? (
              <ul className="mt-6 space-y-2.5">
                {site.arrival.map((a) => (
                  <li key={a} className="flex items-center gap-2.5 text-[0.95rem] text-nevoa">
                    <Icone nome="check" className="h-4 w-4 text-marca" />
                    {a}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              {mapa ? (
                <Pilula href={mapa} externo icone="pino">
                  Abrir no Google Maps
                </Pilula>
              ) : null}
              {waze ? (
                <Pilula href={waze} externo vazia>
                  Abrir no Waze
                </Pilula>
              ) : null}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[2rem] p-8 text-sobre-marca sm:p-10 [background:var(--marca-grad)]">
            <div
              className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full border border-white/15"
              aria-hidden
            />
            <div
              className="absolute -right-10 -bottom-10 h-44 w-44 rounded-full border border-white/15"
              aria-hidden
            />
            <dl className="relative space-y-6">
              {site.hours.length ? (
                <div>
                  <dt className="flex items-center gap-2 text-sm text-sobre-marca/70">
                    <Icone nome="relogio" className="h-4 w-4" /> Horário de atendimento
                  </dt>
                  {site.hours.map((h) => (
                    <dd
                      key={h.days}
                      className="mt-1.5 flex justify-between gap-6 border-b border-white/10 pb-1.5 text-[1.05rem]"
                    >
                      <span>{h.days}</span>
                      <span className="font-semibold">{h.hours}</span>
                    </dd>
                  ))}
                </div>
              ) : null}
              {c.whatsapp && zap ? (
                <div>
                  <dt className="flex items-center gap-2 text-sm text-sobre-marca/70">
                    <Icone nome="zap" className="h-4 w-4" /> WhatsApp
                  </dt>
                  <dd className="mt-1">
                    <a
                      href={zap}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xl font-semibold underline-offset-4 hover:underline"
                    >
                      {formatPhoneBR(c.whatsapp)}
                    </a>
                  </dd>
                </div>
              ) : null}
              {c.instagram ? (
                <div>
                  <dt className="flex items-center gap-2 text-sm text-sobre-marca/70">
                    <Icone nome="instagram" className="h-4 w-4" /> Instagram
                  </dt>
                  <dd className="mt-1">
                    <a
                      href={`https://instagram.com/${c.instagram}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xl font-semibold underline-offset-4 hover:underline"
                    >
                      @{c.instagram}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--marca-borda)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-8 text-sm text-nevoa sm:px-8">
          <span className="font-semibold text-marca-fundo">{c.name}</span>
          <a href={`/c/${c.slug}/privacidade`} className="hover:text-marca">
            Privacidade
          </a>
          <a href={`/c/${c.slug}/termos`} className="hover:text-marca">
            Termos do agendamento
          </a>
          <span className="text-bruma sm:ml-auto">Site e agendamento por TagTech Clínicas</span>
        </div>
      </footer>

      {zap ? (
        <a
          href={zap}
          target="_blank"
          rel="noreferrer"
          aria-label="Falar no WhatsApp"
          className="fixed right-4 bottom-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-[#25d366] text-white shadow-[0_14px_30px_-10px_rgb(0_0_0/0.4)] transition hover:scale-105"
        >
          <Icone nome="zap" className="h-7 w-7" />
        </a>
      ) : null}
    </div>
  );
}
