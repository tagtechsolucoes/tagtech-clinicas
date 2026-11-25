import { useEffect, useState, type PointerEvent as EventoPonteiro } from 'react';
import { api, photoUrl, type GalleryItem, type ImageConsent, type Photo } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataCurta, hoje } from '../formato';
import { Botao, Campo, Entrada, Icone, Seletor, Texto } from '../ui';

const ETAPAS: Record<Photo['stage'], string> = {
  before: 'Antes',
  during: 'Durante',
  after: 'Depois',
};
const ESCOPO = {
  site: 'Site da clínica',
  social: 'Redes sociais',
  both: 'Site e redes sociais',
} as const;

/** Fotos clínicas: envio, linha do tempo por região, comparação e autorização de imagem. */
export function Fotos({ patientId }: { patientId: string }) {
  const { avisar, gerencia } = usePainel();
  const [fotos, setFotos] = useState<Photo[] | null>(null);
  const [consent, setConsent] = useState<ImageConsent | null>(null);
  const [publicadas, setPublicadas] = useState<GalleryItem[]>([]);
  const [meta, setMeta] = useState({
    stage: 'before' as Photo['stage'],
    region: '',
    angle: 'Frente',
    takenOn: hoje(),
  });
  const [enviando, setEnviando] = useState(false);
  const [par, setPar] = useState<{ antes: string | null; depois: string | null }>({
    antes: null,
    depois: null,
  });

  const carregar = async () => {
    try {
      const [f, c, g] = await Promise.all([
        api.photos(patientId),
        api.imageConsent(patientId),
        gerencia ? api.gallery() : Promise.resolve([]),
      ]);
      setFotos(f);
      setConsent(c);
      setPublicadas(g.filter((x) => x.patientId === patientId));
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function enviar(files: FileList | null) {
    if (!files?.length) return;
    setEnviando(true);
    try {
      for (const f of Array.from(files)) await api.addPhoto(patientId, f, meta);
      avisar(files.length === 1 ? 'Foto guardada' : `${files.length} fotos guardadas`);
      await carregar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setEnviando(false);
    }
  }

  const regioes = [...new Set((fotos ?? []).map((f) => f.region || 'Sem região'))];
  const antes = fotos?.find((f) => f.id === par.antes);
  const depois = fotos?.find((f) => f.id === par.depois);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
      <div className="space-y-8">
        <section className="rounded-3xl bg-folha p-5 ring-1 ring-linha">
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo rotulo="Etapa">
              <Seletor
                value={meta.stage}
                onChange={(e) => setMeta({ ...meta, stage: e.target.value as Photo['stage'] })}
              >
                {Object.entries(ETAPAS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Seletor>
            </Campo>
            <Campo rotulo="Região">
              <Entrada
                list="regioes"
                value={meta.region}
                onChange={(e) => setMeta({ ...meta, region: e.target.value })}
                placeholder="Ex.: Sorriso"
              />
              <datalist id="regioes">
                {regioes.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Campo>
            <Campo rotulo="Ângulo">
              <Seletor
                value={meta.angle}
                onChange={(e) => setMeta({ ...meta, angle: e.target.value })}
              >
                {['Frente', 'Perfil direito', 'Perfil esquerdo', 'Oclusal', 'Detalhe'].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </Seletor>
            </Campo>
            <Campo rotulo="Data">
              <Entrada
                type="date"
                value={meta.takenOn}
                max={hoje()}
                onChange={(e) => setMeta({ ...meta, takenOn: e.target.value })}
              />
            </Campo>
          </div>
          <label
            className={`mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-linha bg-porcelana px-4 py-5 font-semibold text-petroleo hover:bg-agua ${enviando ? 'pointer-events-none opacity-60' : ''}`}
          >
            <Icone nome="upload" className="h-5 w-5" />
            {enviando ? 'Enviando…' : 'Enviar fotos'}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => void enviar(e.target.files)}
            />
          </label>
          <p className="mt-2 text-xs text-bruma">
            As fotos ficam só na ficha, para a equipe clínica. Localização e dados da câmera são
            apagados.
          </p>
        </section>

        {antes && depois ? <Comparar antes={antes} depois={depois} /> : null}

        {fotos === null ? null : fotos.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-linha px-6 py-10 text-center text-nevoa">
            Nenhuma foto ainda.
          </p>
        ) : (
          regioes.map((r) => (
            <section key={r}>
              <h3 className="mb-3 text-lg font-medium">{r}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {fotos
                  .filter((f) => (f.region || 'Sem região') === r)
                  .map((f) => {
                    const lado =
                      par.antes === f.id ? 'antes' : par.depois === f.id ? 'depois' : null;
                    return (
                      <figure
                        key={f.id}
                        className={`overflow-hidden rounded-2xl bg-folha ring-1 ${lado ? 'ring-2 ring-petroleo' : 'ring-linha'}`}
                      >
                        <img
                          src={photoUrl(f.id)}
                          alt={`${ETAPAS[f.stage]}, ${f.angle}`}
                          className="aspect-[4/3] w-full object-cover"
                          loading="lazy"
                        />
                        <figcaption className="space-y-2 p-3 text-sm">
                          <p>
                            <span className="font-semibold">{ETAPAS[f.stage]}</span>
                            <span className="text-nevoa">
                              {' '}
                              · {f.angle} · {dataCurta(f.takenOn)}
                            </span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setPar({ ...par, antes: par.antes === f.id ? null : f.id })
                              }
                              className={`rounded-lg px-2 py-1 text-xs font-semibold ${par.antes === f.id ? 'bg-petroleo text-white' : 'bg-trilho text-nevoa'}`}
                            >
                              Comparar: antes
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPar({ ...par, depois: par.depois === f.id ? null : f.id })
                              }
                              className={`rounded-lg px-2 py-1 text-xs font-semibold ${par.depois === f.id ? 'bg-petroleo text-white' : 'bg-trilho text-nevoa'}`}
                            >
                              depois
                            </button>
                            <button
                              type="button"
                              aria-label="Apagar foto"
                              onClick={async () => {
                                try {
                                  await api.deletePhoto(f.id);
                                  await carregar();
                                } catch (e) {
                                  avisar(mensagem(e), 'erro');
                                }
                              }}
                              className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-bruma hover:text-alerta"
                            >
                              Apagar
                            </button>
                          </div>
                        </figcaption>
                      </figure>
                    );
                  })}
              </div>
            </section>
          ))
        )}
      </div>

      <aside className="space-y-5 xl:sticky xl:top-6">
        <Autorizacao patientId={patientId} consent={consent} aoMudar={() => void carregar()} />
        {gerencia && antes && depois && consent?.active && consent.scope !== 'social' ? (
          <Publicar antes={antes} depois={depois} aoPublicar={() => void carregar()} />
        ) : null}
        {publicadas.length ? (
          <section className="rounded-3xl bg-folha p-5 ring-1 ring-linha">
            <h3 className="font-semibold">No site da clínica</h3>
            <ul className="mt-3 space-y-2">
              {publicadas.map((g) => (
                <li key={g.id} className="flex items-center gap-3 text-sm">
                  <img
                    src={`/api${g.afterUrl}`}
                    alt=""
                    className="h-10 w-10 rounded-lg object-cover"
                  />
                  <span className="flex-1 font-medium">{g.title}</span>
                  <button
                    type="button"
                    className="font-semibold text-nevoa hover:text-alerta"
                    onClick={async () => {
                      await api.unpublish(g.id).catch((e) => avisar(mensagem(e), 'erro'));
                      await carregar();
                    }}
                  >
                    Tirar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

/** Antes e depois sobrepostos, com o divisor arrastável. */
function Comparar({ antes, depois }: { antes: Photo; depois: Photo }) {
  const [pos, setPos] = useState(50);
  return (
    <section className="rounded-3xl bg-folha p-4 ring-1 ring-linha">
      <div className="relative mx-auto aspect-[4/3] max-w-3xl overflow-hidden rounded-2xl bg-trilho select-none">
        <img
          src={photoUrl(depois.id)}
          alt="Depois"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <img
          src={photoUrl(antes.id)}
          alt="Antes"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]"
          style={{ left: `${pos}%` }}
        />
        <span className="absolute top-3 left-3 rounded-lg bg-tinta/75 px-2.5 py-1 text-xs font-semibold text-white">
          Antes · {dataCurta(antes.takenOn)}
        </span>
        <span className="absolute top-3 right-3 rounded-lg bg-tinta/75 px-2.5 py-1 text-xs font-semibold text-white">
          Depois · {dataCurta(depois.takenOn)}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          aria-label="Divisor entre antes e depois"
          onChange={(e) => setPos(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
    </section>
  );
}

function Autorizacao({
  patientId,
  consent,
  aoMudar,
}: {
  patientId: string;
  consent: ImageConsent | null;
  aoMudar: () => void;
}) {
  const { avisar } = usePainel();
  const [abrindo, setAbrindo] = useState(false);
  const [scope, setScope] = useState<'site' | 'social' | 'both'>('both');
  const [data, setData] = useState(hoje());
  const [termo, setTermo] = useState('');
  if (!consent) return null;
  return (
    <section className="rounded-3xl bg-folha p-5 ring-1 ring-linha">
      <h3 className="font-semibold">Autorização de imagem</h3>
      {consent.active ? (
        <>
          <p className="mt-2 flex items-center gap-2 text-sm text-ok">
            <Icone nome="ok" className="h-4 w-4" /> Assinada em {dataCurta(consent.signedOn!)} ·{' '}
            {ESCOPO[consent.scope!]}
          </p>
          <p className="mt-2 text-xs text-nevoa">{consent.termText}</p>
          <Botao
            tamanho="pequeno"
            variante="perigo"
            className="mt-3"
            onClick={async () => {
              try {
                await api.revokeConsent(patientId);
                avisar('Autorização revogada · fotos retiradas do site');
                aoMudar();
              } catch (e) {
                avisar(mensagem(e), 'erro');
              }
            }}
          >
            Paciente revogou
          </Botao>
        </>
      ) : abrindo ? (
        <div className="mt-3 space-y-3">
          <Campo rotulo="Onde pode aparecer">
            <Seletor value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              {Object.entries(ESCOPO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo rotulo="Assinada em">
            <Entrada
              type="date"
              value={data}
              max={hoje()}
              onChange={(e) => setData(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Texto do termo assinado">
            <Texto
              rows={5}
              value={termo || consent.termText}
              onChange={(e) => setTermo(e.target.value)}
            />
          </Campo>
          <Botao
            variante="principal"
            className="w-full"
            onClick={async () => {
              try {
                await api.recordConsent(patientId, {
                  scope,
                  signedOn: data,
                  ...(termo ? { termText: termo } : {}),
                });
                avisar('Autorização registrada');
                setAbrindo(false);
                aoMudar();
              } catch (e) {
                avisar(mensagem(e), 'erro');
              }
            }}
          >
            Registrar autorização assinada
          </Botao>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-nevoa">Sem autorização, as fotos nunca saem da ficha.</p>
          <Botao tamanho="pequeno" className="mt-3" onClick={() => setAbrindo(true)}>
            Registrar autorização
          </Botao>
        </>
      )}
    </section>
  );
}

function Publicar({
  antes,
  depois,
  aoPublicar,
}: {
  antes: Photo;
  depois: Photo;
  aoPublicar: () => void;
}) {
  const { services, avisar } = usePainel();
  const [titulo, setTitulo] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [esconderAntes, setEsconderAntes] = useState<Area[]>([]);
  const [esconderDepois, setEsconderDepois] = useState<Area[]>([]);
  return (
    <section className="rounded-3xl bg-agua p-5">
      <h3 className="font-semibold text-petroleo">Publicar este antes e depois no site</h3>
      <p className="mt-1 text-sm text-nevoa">
        O nome do paciente nunca aparece. Revogar a autorização tira do site na hora.
      </p>
      <div className="mt-4">
        <p className="text-sm font-semibold text-petroleo">Esconder rosto ou marcas</p>
        <p className="mt-0.5 text-sm text-nevoa">
          Arraste sobre a foto para marcar o que deve sair borrado no site. A foto do prontuário não
          muda.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Marcador foto={antes} rotulo="Antes" areas={esconderAntes} aoMudar={setEsconderAntes} />
          <Marcador
            foto={depois}
            rotulo="Depois"
            areas={esconderDepois}
            aoMudar={setEsconderDepois}
          />
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Entrada
          placeholder="Título, ex.: Clareamento em 2 sessões"
          value={titulo}
          maxLength={80}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <Seletor value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Sem serviço ligado</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Seletor>
        <Botao
          variante="principal"
          className="w-full"
          disabled={!titulo.trim()}
          onClick={async () => {
            try {
              await api.publish({
                beforePhotoId: antes.id,
                afterPhotoId: depois.id,
                title: titulo.trim(),
                ...(serviceId ? { serviceId } : {}),
                ...(esconderAntes.length ? { hideBefore: esconderAntes } : {}),
                ...(esconderDepois.length ? { hideAfter: esconderDepois } : {}),
              });
              avisar('Publicado no site');
              setTitulo('');
              setEsconderAntes([]);
              setEsconderDepois([]);
              aoPublicar();
            } catch (e) {
              avisar(mensagem(e), 'erro');
            }
          }}
        >
          Publicar
        </Botao>
      </div>
    </section>
  );
}

type Area = { x: number; y: number; w: number; h: number };

/** Foto em que se arrasta para marcar áreas a borrar. A prévia já mostra o desfoque. */
function Marcador({
  foto,
  rotulo,
  areas,
  aoMudar,
}: {
  foto: Photo;
  rotulo: string;
  areas: Area[];
  aoMudar: (a: Area[]) => void;
}) {
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null);
  const [atual, setAtual] = useState<Area | null>(null);
  const ponto = (e: EventoPonteiro<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const caixa = (a: { x: number; y: number }, b: { x: number; y: number }): Area => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });
  const todas = atual ? [...areas, atual] : areas;
  return (
    <figure>
      <div
        role="img"
        aria-label={`Foto ${rotulo.toLowerCase()}: arraste para marcar a área a esconder`}
        className="relative cursor-crosshair touch-none overflow-hidden rounded-2xl bg-tinta select-none"
        onPointerDown={(e) => {
          if (areas.length >= 6) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setInicio(ponto(e));
        }}
        onPointerMove={(e) => inicio && setAtual(caixa(inicio, ponto(e)))}
        onPointerUp={(e) => {
          if (inicio) {
            const a = caixa(inicio, ponto(e));
            if (a.w > 0.02 && a.h > 0.02) aoMudar([...areas, a]);
          }
          setInicio(null);
          setAtual(null);
        }}
      >
        <img src={photoUrl(foto.id)} alt="" draggable={false} className="block w-full" />
        {todas.map((a, i) => (
          <span
            key={i}
            className="absolute rounded-md ring-2 ring-ambar backdrop-blur-md"
            style={{
              left: `${a.x * 100}%`,
              top: `${a.y * 100}%`,
              width: `${a.w * 100}%`,
              height: `${a.h * 100}%`,
            }}
          />
        ))}
      </div>
      <figcaption className="mt-1.5 flex items-center justify-between text-sm">
        <span className="font-semibold">{rotulo}</span>
        {areas.length ? (
          <button
            type="button"
            onClick={() => aoMudar([])}
            className="font-semibold text-nevoa hover:text-alerta"
          >
            Limpar ({areas.length})
          </button>
        ) : (
          <span className="text-bruma">nada escondido</span>
        )}
      </figcaption>
    </figure>
  );
}
