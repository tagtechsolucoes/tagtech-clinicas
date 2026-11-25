import { useState, type ReactNode } from 'react';
import { DISPLAY_FONTS, isHexColor, themeTokens, type DisplayFont } from '@tagtech/domain';
import { api, siteUrl } from './api';
import { mensagem, usePainel } from './contexto';
import { telefone } from './formato';
import { WhatsAppConfig } from './whatsapp';
import { Botao, Cabecalho, Campo, Entrada, Icone, Interruptor, Seletor, Texto } from './ui';

const FONTES: Record<DisplayFont, { nome: string; css: string }> = {
  // As mesmas fontes do site de agendamento (apps/web-cliente/src/lib/tema.ts).
  grotesca: { nome: 'Moderna', css: "'Bricolage Grotesque Variable', sans-serif" },
  serifada: { nome: 'Clássica', css: "'Fraunces Variable', serif" },
  condensada: { nome: 'Marcante', css: "'Oswald Variable', sans-serif" },
};

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-linha py-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-xl font-medium">{titulo}</h2>
        {descricao ? <p className="mt-1.5 text-sm text-nevoa">{descricao}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function ClinicaTela() {
  const { clinic, setClinic, avisar, rooms, recarregar } = usePainel();
  const unidade = clinic.units[0];
  const [d, setD] = useState({
    name: clinic.name,
    tagline: clinic.tagline,
    about: clinic.about,
    whatsapp: clinic.whatsapp ? telefone(clinic.whatsapp) : '',
    instagram: clinic.instagram,
    primaryColor: clinic.theme.primaryColor,
    accentColor: clinic.theme.accentColor,
    displayFont: clinic.theme.displayFont,
    bookingEnabled: clinic.booking.enabled,
    minNoticeMinutes: clinic.booking.minNoticeMinutes,
    horizonDays: clinic.booking.horizonDays,
    slotStepMinutes: clinic.booking.slotStepMinutes,
  });
  const [endereco, setEndereco] = useState(unidade?.address ?? '');
  const [sala, setSala] = useState('');
  const [salvando, setSalvando] = useState(false);
  const cores =
    isHexColor(d.primaryColor) && isHexColor(d.accentColor)
      ? themeTokens(d)
      : themeTokens(clinic.theme);

  async function salvar() {
    setSalvando(true);
    try {
      setClinic({ ...(await api.updateClinic(d)), units: clinic.units });
      if (unidade && endereco !== unidade.address)
        await api.updateUnit(unidade.id, { address: endereco });
      await recarregar();
      avisar('Alterações salvas · o site já mostra');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function imagem(tipo: 'logo' | 'cover', file: File | null) {
    try {
      const nova = file
        ? await (tipo === 'logo' ? api.setLogo(file) : api.setCover(file))
        : await (tipo === 'logo' ? api.removeLogo() : api.removeCover());
      setClinic({ ...nova, units: clinic.units });
      avisar(file ? 'Imagem atualizada' : 'Imagem removida');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  const link = siteUrl(clinic.slug);

  return (
    <>
      <Cabecalho
        titulo="Clínica e site"
        descricao="O que o paciente vê no site de agendamento. Cada clínica com a sua cara."
        acoes={
          <Botao variante="principal" disabled={salvando} onClick={salvar}>
            Salvar alterações
          </Botao>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-3 rounded-2xl bg-folha p-4 ring-1 ring-linha">
        <Icone nome="globo" className="h-5 w-5 text-petroleo" />
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-medium text-petroleo hover:underline"
        >
          {link.replace(/^https?:\/\//, '')}
        </a>
        <Botao
          tamanho="pequeno"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              avisar('Link copiado');
            } catch {
              avisar('Não deu para copiar. Selecione o link e copie.', 'erro');
            }
          }}
        >
          <Icone nome="link" className="h-4 w-4" /> Copiar link
        </Botao>
      </div>
      <p className="mb-6 text-sm text-nevoa">
        Coloque este link na bio do Instagram e na resposta automática do WhatsApp.
      </p>

      <Secao titulo="Identidade" descricao="Nome, frase de apresentação, logo e foto de capa.">
        <Campo rotulo="Nome da clínica">
          <Entrada value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Campo>
        <Campo rotulo="Frase de apresentação">
          <Entrada
            maxLength={120}
            value={d.tagline}
            onChange={(e) => setD({ ...d, tagline: e.target.value })}
            placeholder="Ex.: Odontologia com hora marcada e sem pressa"
          />
        </Campo>
        <Campo rotulo="Sobre a clínica">
          <Texto
            rows={4}
            maxLength={1200}
            value={d.about}
            onChange={(e) => setD({ ...d, about: e.target.value })}
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Imagem
            rotulo="Logo"
            url={clinic.logoUrl}
            quadrada
            aoEscolher={(f) => imagem('logo', f)}
          />
          <Imagem
            rotulo="Foto de capa"
            url={clinic.coverUrl}
            aoEscolher={(f) => imagem('cover', f)}
          />
        </div>
      </Secao>

      <Secao
        titulo="Cores e letra"
        descricao="Contraste é ajustado sozinho para o texto continuar legível."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Cor
            rotulo="Cor principal"
            valor={d.primaryColor}
            aoMudar={(v) => setD({ ...d, primaryColor: v })}
          />
          <Cor
            rotulo="Cor de destaque"
            valor={d.accentColor}
            aoMudar={(v) => setD({ ...d, accentColor: v })}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {DISPLAY_FONTS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={d.displayFont === f}
              onClick={() => setD({ ...d, displayFont: f })}
              className={`rounded-2xl px-4 py-3 text-left ring-1 ${d.displayFont === f ? 'bg-agua ring-petroleo' : 'bg-folha ring-linha'}`}
            >
              <span
                className="block text-2xl"
                style={{ fontFamily: FONTES[f].css, fontWeight: 600 }}
              >
                Aa
              </span>
              <span className="text-sm text-nevoa">{FONTES[f].nome}</span>
            </button>
          ))}
        </div>
        {/* Prévia do topo do site com as escolhas atuais. */}
        <div className="overflow-hidden rounded-3xl ring-1 ring-linha">
          <div className="px-6 py-7" style={{ background: cores.primary, color: cores.onPrimary }}>
            <p className="text-xs opacity-70">Prévia do site</p>
            <p
              className="mt-1 text-[1.7rem] leading-tight"
              style={{ fontFamily: FONTES[d.displayFont].css, fontWeight: 600 }}
            >
              {d.name || 'Sua clínica'}
            </p>
            <p className="mt-1 text-sm opacity-80">{d.tagline || 'Sua frase de apresentação'}</p>
          </div>
          <div className="flex items-center gap-3 bg-folha px-6 py-4">
            <span
              className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: cores.accent, color: cores.onAccent }}
            >
              Agendar horário
            </span>
            <span className="text-sm text-nevoa">Botões e destaques usam esta cor.</span>
          </div>
        </div>
      </Secao>

      <Secao titulo="Contato" descricao="Aparece no site e no link que o paciente recebe.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="WhatsApp da clínica">
            <Entrada
              inputMode="tel"
              value={d.whatsapp}
              onChange={(e) => setD({ ...d, whatsapp: e.target.value })}
              placeholder="(81) 99999-0000"
            />
          </Campo>
          <Campo rotulo="Instagram">
            <Entrada
              value={d.instagram}
              onChange={(e) => setD({ ...d, instagram: e.target.value })}
              placeholder="@suaclinica"
            />
          </Campo>
        </div>
        {unidade ? (
          <Campo rotulo="Endereço">
            <Entrada
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Rua, número, sala · bairro · cidade"
            />
          </Campo>
        ) : null}
      </Secao>

      <Secao
        titulo="Agendamento pelo site"
        descricao="Regras para o paciente marcar sozinho. A recepção não segue essas regras."
      >
        <Interruptor
          ligado={d.bookingEnabled}
          aoMudar={(v) => setD({ ...d, bookingEnabled: v })}
          rotulo="Aceitar agendamentos pelo site"
          descricao="Desligado, o site mostra a clínica e o WhatsApp, sem os horários."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Antecedência mínima">
            <Seletor
              value={d.minNoticeMinutes}
              onChange={(e) => setD({ ...d, minNoticeMinutes: Number(e.target.value) })}
            >
              {[0, 60, 120, 240, 720, 1440, 2880].map((m) => (
                <option key={m} value={m}>
                  {m === 0
                    ? 'Nenhuma'
                    : m < 1440
                      ? `${m / 60} h`
                      : `${m / 1440} ${m === 1440 ? 'dia' : 'dias'}`}
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Até quantos dias à frente">
            <Seletor
              value={d.horizonDays}
              onChange={(e) => setD({ ...d, horizonDays: Number(e.target.value) })}
            >
              {[14, 30, 60, 90, 180].map((n) => (
                <option key={n} value={n}>
                  {n} dias
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Horários de quantos em quantos minutos">
            <Seletor
              value={d.slotStepMinutes}
              onChange={(e) => setD({ ...d, slotStepMinutes: Number(e.target.value) })}
            >
              {[10, 15, 20, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </Seletor>
          </Campo>
        </div>
      </Secao>

      <Secao
        titulo="WhatsApp automático"
        descricao="Aviso ao agendar, remarcar e cancelar, e lembrete antes da consulta com o link para confirmar."
      >
        <WhatsAppConfig />
      </Secao>

      <Secao
        titulo="Salas"
        descricao="Opcional. Com salas, a agenda não deixa marcar duas consultas na mesma sala ao mesmo tempo."
      >
        {rooms.length ? (
          <ul className="divide-y divide-linha rounded-2xl ring-1 ring-linha">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3">
                <span className={r.active ? 'font-medium' : 'text-bruma line-through'}>
                  {r.name}
                </span>
                <Botao
                  tamanho="pequeno"
                  variante="discreto"
                  onClick={async () => {
                    await api
                      .updateRoom(r.id, { active: !r.active })
                      .catch((e) => avisar(mensagem(e), 'erro'));
                    await recarregar();
                  }}
                >
                  {r.active ? 'Desativar' : 'Reativar'}
                </Botao>
              </li>
            ))}
          </ul>
        ) : null}
        {unidade ? (
          <div className="flex gap-2">
            <Entrada
              value={sala}
              onChange={(e) => setSala(e.target.value)}
              placeholder="Ex.: Consultório 2"
            />
            <Botao
              disabled={!sala.trim()}
              onClick={async () => {
                try {
                  await api.createRoom(unidade.id, sala.trim());
                  setSala('');
                  await recarregar();
                } catch (e) {
                  avisar(mensagem(e), 'erro');
                }
              }}
            >
              Adicionar
            </Botao>
          </div>
        ) : null}
      </Secao>
    </>
  );
}

function Cor({
  rotulo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <Campo rotulo={rotulo}>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={isHexColor(valor) ? valor : '#000000'}
          onChange={(e) => aoMudar(e.target.value)}
          className="h-11 w-14 cursor-pointer rounded-xl bg-folha p-1 ring-1 ring-linha"
        />
        <Entrada
          value={valor}
          onChange={(e) => aoMudar(e.target.value.toLowerCase())}
          className="font-mono"
        />
      </span>
    </Campo>
  );
}

function Imagem({
  rotulo,
  url,
  quadrada,
  aoEscolher,
}: {
  rotulo: string;
  url: string | null;
  quadrada?: boolean;
  aoEscolher: (f: File | null) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[0.82rem] font-semibold text-nevoa">{rotulo}</span>
      <div
        className={`relative overflow-hidden rounded-2xl bg-porcelana ring-1 ring-linha ${quadrada ? 'aspect-square max-w-40' : 'aspect-[16/9]'}`}
      >
        {url ? (
          <img src={`/api${url}`} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full place-items-center text-sm text-bruma">Sem imagem</span>
        )}
      </div>
      <div className="mt-2 flex gap-3 text-sm font-semibold">
        <label className="cursor-pointer text-petroleo hover:underline">
          {url ? 'Trocar' : 'Enviar'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && aoEscolher(e.target.files[0])}
          />
        </label>
        {url ? (
          <button
            type="button"
            className="text-nevoa hover:text-alerta"
            onClick={() => aoEscolher(null)}
          >
            Remover
          </button>
        ) : null}
      </div>
    </div>
  );
}
