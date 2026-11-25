import { formatPhoneBR } from '@tagtech/domain';
import { useEffect, useState } from 'react';
import { api, type ClinicalDocument, type DocumentKind, type PrintableDocument } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dataHora, hoje } from '../formato';
import { Botao, Campo, Entrada, Gaveta, Icone, Interruptor, Seletor, Texto, Vazio } from '../ui';

const NOMES: Record<DocumentKind, string> = {
  prescription: 'Receita',
  certificate: 'Atestado',
  declaration: 'Declaração de comparecimento',
  exam_request: 'Pedido de exame',
  meal_plan: 'Plano alimentar',
};

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
const extenso = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T12:00:00Z`));
const cpf = (d: string) => d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

type C = Record<string, unknown>;

function corpo(d: PrintableDocument): string {
  const c = d.content as C;
  const nome = `<strong>${esc(d.patient.name)}</strong>${d.patient.cpf ? `, CPF ${cpf(d.patient.cpf)}` : ''}`;
  switch (d.kind) {
    case 'prescription': {
      const itens = (c.items as C[]).map(
        (
          i,
          n,
        ) => `<li><p class="med"><span>${n + 1}.</span> ${esc(i.name)}${i.quantity ? `<em>${esc(i.quantity)}</em>` : ''}</p>
        <p class="uso">${esc([i.dosage, i.instructions].filter(Boolean).join(', '))}</p></li>`,
      );
      return `<p class="para">Para: ${nome}</p>${c.controlled ? '<p class="tag">Receita de controle especial — 2 vias</p>' : ''}
        <p class="uso-titulo">Uso</p><ol class="receita">${itens.join('')}</ol>
        ${c.notes ? `<p class="obs">${esc(c.notes)}</p>` : ''}`;
    }
    case 'certificate': {
      const dias = Number(c.days);
      return `<p class="texto">Atesto, para os devidos fins, que ${nome} esteve sob meus cuidados profissionais em ${extenso(String(c.from))}${
        dias > 0
          ? ` e necessita de <strong>${dias} ${dias === 1 ? 'dia' : 'dias'}</strong> de afastamento de suas atividades a partir desta data`
          : ''
      }.</p>${c.cid ? `<p class="texto">CID: ${esc(c.cid)} (informado com autorização do paciente).</p>` : ''}
      ${c.notes ? `<p class="obs">${esc(c.notes)}</p>` : ''}`;
    }
    case 'declaration':
      return `<p class="texto">Declaro, para os devidos fins, que ${nome} compareceu a esta clínica em ${extenso(String(c.date))}, das ${esc(c.start)} às ${esc(c.end)}, para atendimento${
        c.companion ? `, acompanhado(a) de ${esc(c.companion)}` : ''
      }.</p>`;
    case 'exam_request':
      return `<p class="para">Para: ${nome}</p><p class="uso-titulo">Solicito</p>
        <ol class="receita">${(c.exams as string[]).map((e) => `<li><p class="med">${esc(e)}</p></li>`).join('')}</ol>
        ${c.indication ? `<p class="obs"><strong>Indicação clínica:</strong> ${esc(c.indication)}</p>` : ''}`;
    case 'meal_plan':
      return `<p class="para">Para: ${nome}</p>
        ${(c.meals as C[])
          .map(
            (
              m,
            ) => `<div class="refeicao"><p class="med">${m.time ? `<span>${esc(m.time)}</span>` : ''} ${esc(m.name)}</p>
            <ul>${(m.items as string[]).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`,
          )
          .join('')}
        ${c.water ? `<p class="obs"><strong>Água:</strong> ${esc(c.water)} por dia</p>` : ''}
        ${c.notes ? `<p class="obs">${esc(c.notes)}</p>` : ''}`;
  }
}

/** Abre o documento com a identidade da clínica, pronto para imprimir ou salvar em PDF. */
export async function abrirDocumento(
  id: string,
  avisar: (t: string, tipo?: 'ok' | 'erro') => void,
) {
  const janela = window.open('', '_blank');
  try {
    const d = await api.document(id);
    const cor = /^#[0-9a-f]{6}$/i.test(d.clinic.primaryColor) ? d.clinic.primaryColor : '#1d4e5f';
    const logo = d.clinic.logoUrl
      ? `<img src="${esc(`${location.origin}/api${d.clinic.logoUrl}`)}" alt="">`
      : '';
    const dia = d.createdAt.slice(0, 10);
    janela?.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(NOMES[d.kind])} · ${esc(d.patient.name)}</title>
<style>
  @page{size:A4;margin:18mm 20mm}
  *{box-sizing:border-box}
  body{font:15px/1.65 "Instrument Sans",system-ui,sans-serif;color:#0f2028;max-width:720px;margin:40px auto;padding:0 28px}
  header{display:flex;align-items:center;gap:16px;padding-bottom:18px;border-bottom:3px solid ${cor}}
  header img{height:54px;width:54px;border-radius:12px;object-fit:cover}
  header .nome{font:500 22px/1.15 Fraunces,Georgia,serif;margin:0}
  header .sub{margin:2px 0 0;color:#56676f;font-size:13px}
  h1{font:500 30px/1.1 Fraunces,Georgia,serif;margin:36px 0 22px;color:${cor}}
  .para{margin:0 0 18px}
  .tag{display:inline-block;border:1px solid ${cor};color:${cor};border-radius:8px;padding:2px 10px;font-size:13px;font-weight:600}
  .uso-titulo{text-transform:none;font-weight:600;color:#56676f;margin:18px 0 6px}
  ol.receita{list-style:none;padding:0;margin:0}
  ol.receita li{padding:12px 0;border-bottom:1px dashed #dce3e6}
  .med{margin:0;font-weight:600;display:flex;gap:8px}
  .med em{margin-left:auto;font-style:normal;font-weight:500;color:#56676f}
  .uso{margin:2px 0 0 22px;color:#3a4b53}
  .texto{font-size:16px;line-height:1.8;text-align:justify}
  .obs{margin-top:20px;color:#3a4b53}
  .refeicao{padding:12px 0;border-bottom:1px dashed #dce3e6;break-inside:avoid} .refeicao ul{margin:4px 0 0 22px;padding:0;color:#3a4b53} .refeicao .med span{color:${cor};min-width:44px}
  .local{margin-top:40px}
  .ass{margin:84px auto 0;width:320px;border-top:1px solid #0f2028;padding-top:8px;text-align:center}
  .ass strong{display:block} .ass span{color:#56676f;font-size:13px}
  footer{margin-top:56px;padding-top:12px;border-top:1px solid #dce3e6;color:#56676f;font-size:12px;text-align:center}
  button{margin-top:28px;padding:10px 18px;border-radius:12px;border:0;background:${cor};color:#fff;font-weight:600;cursor:pointer}
  @media print{body{margin:0;max-width:none}button{display:none}}
</style></head><body>
<header>${logo}<div><p class="nome">${esc(d.clinic.name)}</p><p class="sub">${esc(d.professional.name)}${d.professional.council ? ` · ${esc(d.professional.council)}` : ''}${d.professional.specialty ? ` · ${esc(d.professional.specialty)}` : ''}</p></div></header>
<h1>${esc(NOMES[d.kind])}</h1>
${corpo(d)}
<p class="local">${esc(d.clinic.city || '')}${d.clinic.city ? ', ' : ''}${extenso(dia)}.</p>
<div class="ass"><strong>${esc(d.professional.name)}</strong><span>${esc(d.professional.council)}</span></div>
<footer>${esc(d.clinic.legalName || d.clinic.name)}${d.clinic.address ? ` · ${esc(d.clinic.address)}` : ''}${d.clinic.phone ? ` · ${esc(formatPhoneBR(d.clinic.phone))}` : ''}</footer>
<button onclick="print()">Imprimir ou salvar PDF</button>
</body></html>`);
    janela?.document.close();
  } catch (e) {
    janela?.close();
    avisar(mensagem(e), 'erro');
  }
}

/** Aba "Documentos" do paciente. */
export function Documentos({ patientId }: { patientId: string }) {
  const { avisar, professionals } = usePainel();
  const [lista, setLista] = useState<ClinicalDocument[] | null>(null);
  const [novo, setNovo] = useState<DocumentKind | null>(null);
  const carregar = () =>
    api
      .documents(patientId)
      .then(setLista)
      .catch((e) => avisar(mensagem(e), 'erro'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (!lista) return <p className="text-nevoa">Carregando…</p>;
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(NOMES) as DocumentKind[])
          .filter((k) => k !== 'meal_plan' || professionals.some((p) => p.recordKind === 'nutri'))
          .map((k) => (
            <Botao
              key={k}
              variante={k === 'prescription' ? 'principal' : 'contorno'}
              onClick={() => setNovo(k)}
            >
              <Icone nome="mais" className="h-4 w-4" /> {NOMES[k]}
            </Botao>
          ))}
      </div>
      {lista.length ? (
        <ul className="divide-y divide-linha rounded-2xl bg-folha ring-1 ring-linha">
          {lista.map((d) => (
            <li key={d.id} className="flex items-center gap-4 px-5 py-3.5">
              <Icone nome="recibo" className="h-5 w-5 text-petroleo" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{NOMES[d.kind]}</span>
                <span className="text-sm text-nevoa">
                  {d.professional.name} · {dataHora(d.createdAt)}
                </span>
              </span>
              <Botao tamanho="pequeno" onClick={() => abrirDocumento(d.id, avisar)}>
                Abrir PDF
              </Botao>
            </li>
          ))}
        </ul>
      ) : (
        <Vazio
          titulo="Nenhum documento emitido"
          texto="Receita, atestado, declaração e pedido de exame com o logo da clínica e os dados do profissional."
        />
      )}
      <Emitir
        tipo={novo}
        patientId={patientId}
        aoFechar={() => setNovo(null)}
        aoEmitir={(d) => {
          setNovo(null);
          void carregar();
          void abrirDocumento(d.id, avisar);
        }}
      />
    </>
  );
}

function Emitir({
  tipo,
  patientId,
  aoFechar,
  aoEmitir,
}: {
  tipo: DocumentKind | null;
  patientId: string;
  aoFechar: () => void;
  aoEmitir: (d: ClinicalDocument) => void;
}) {
  const { avisar, vinculo, professionals } = usePainel();
  const [pro, setPro] = useState('');
  const [itens, setItens] = useState([{ name: '', dosage: '', instructions: '', quantity: '' }]);
  const [controlado, setControlado] = useState(false);
  const [dias, setDias] = useState(1);
  const [cid, setCid] = useState('');
  const [autorizou, setAutorizou] = useState(false);
  const [data, setData] = useState(hoje());
  const [ini, setIni] = useState('08:00');
  const [fim, setFim] = useState('09:00');
  const [acomp, setAcomp] = useState('');
  const [exames, setExames] = useState('');
  const [obs, setObs] = useState('');
  const [refeicoes, setRefeicoes] = useState([
    { time: '07:00', name: 'Café da manhã', items: '' },
    { time: '12:00', name: 'Almoço', items: '' },
    { time: '19:30', name: 'Jantar', items: '' },
  ]);
  const [agua, setAgua] = useState('');

  useEffect(() => {
    if (!tipo) return;
    setItens([{ name: '', dosage: '', instructions: '', quantity: '' }]);
    setObs('');
    setCid('');
    setAutorizou(false);
    setExames('');
    setData(hoje());
  }, [tipo]);

  async function emitir() {
    if (!tipo) return;
    const content: Record<DocumentKind, Record<string, unknown>> = {
      prescription: {
        items: itens.filter((i) => i.name.trim()),
        controlled: controlado,
        notes: obs,
      },
      certificate: {
        days: dias,
        from: data,
        cid: cid.trim(),
        patientAllowedCid: autorizou,
        notes: obs,
      },
      declaration: { date: data, start: ini, end: fim, companion: acomp },
      meal_plan: {
        meals: refeicoes
          .map((m) => ({
            time: m.time,
            name: m.name.trim(),
            items: m.items
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
          }))
          .filter((m) => m.name && m.items.length),
        water: agua,
        notes: obs,
      },
      exam_request: {
        exams: exames
          .split('\n')
          .map((e) => e.trim())
          .filter(Boolean),
        indication: obs,
      },
    };
    try {
      aoEmitir(
        await api.createDocument(patientId, {
          kind: tipo,
          content: content[tipo],
          ...(pro ? { professionalId: pro } : {}),
        }),
      );
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }

  return (
    <Gaveta
      aberta={tipo !== null}
      aoFechar={aoFechar}
      titulo={tipo ? NOMES[tipo] : ''}
      subtitulo="Depois de emitido, o documento não muda: para corrigir, emita outro."
      rodape={
        <Botao variante="principal" className="flex-1" onClick={emitir}>
          Emitir e abrir PDF
        </Botao>
      }
    >
      <div className="space-y-5">
        {vinculo.role !== 'professional' ? (
          <Campo rotulo="Profissional que assina">
            <Seletor value={pro} onChange={(e) => setPro(e.target.value)}>
              <option value="">Escolha…</option>
              {professionals
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Seletor>
          </Campo>
        ) : null}

        {tipo === 'prescription' ? (
          <>
            {itens.map((it, i) => (
              <div key={i} className="space-y-2 rounded-2xl bg-porcelana p-3.5 ring-1 ring-linha">
                <Entrada
                  placeholder="Medicamento e concentração"
                  value={it.name}
                  onChange={(e) =>
                    setItens(itens.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
                <div className="grid grid-cols-[1fr_8rem] gap-2">
                  <Entrada
                    placeholder="Como usar (ex.: 1 comprimido de 8/8 h por 5 dias)"
                    value={it.instructions}
                    onChange={(e) =>
                      setItens(
                        itens.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)),
                      )
                    }
                  />
                  <Entrada
                    placeholder="Qtd."
                    value={it.quantity}
                    onChange={(e) =>
                      setItens(
                        itens.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <Botao
              onClick={() =>
                setItens([...itens, { name: '', dosage: '', instructions: '', quantity: '' }])
              }
            >
              <Icone nome="mais" className="h-4 w-4" /> Outro item
            </Botao>
            <Interruptor
              ligado={controlado}
              aoMudar={setControlado}
              rotulo="Controle especial"
              descricao="Marca a receita como de controle especial (2 vias)."
            />
          </>
        ) : null}

        {tipo === 'certificate' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Campo rotulo="Data do atendimento">
                <Entrada type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </Campo>
              <Campo rotulo="Dias de afastamento">
                <Seletor value={dias} onChange={(e) => setDias(Number(e.target.value))}>
                  {[0, 1, 2, 3, 5, 7, 10, 14, 15, 30].map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? 'Só o comparecimento' : `${d} ${d === 1 ? 'dia' : 'dias'}`}
                    </option>
                  ))}
                </Seletor>
              </Campo>
            </div>
            <Campo rotulo="CID (opcional)" ajuda="Só vai no atestado se o paciente autorizar.">
              <Entrada
                value={cid}
                maxLength={10}
                onChange={(e) => setCid(e.target.value.toUpperCase())}
              />
            </Campo>
            {cid.trim() ? (
              <Interruptor
                ligado={autorizou}
                aoMudar={setAutorizou}
                rotulo="O paciente autorizou o CID no atestado"
              />
            ) : null}
          </>
        ) : null}

        {tipo === 'declaration' ? (
          <>
            <Campo rotulo="Data">
              <Entrada type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
            <div className="grid grid-cols-2 gap-4">
              <Campo rotulo="Das">
                <Entrada type="time" value={ini} onChange={(e) => setIni(e.target.value)} />
              </Campo>
              <Campo rotulo="Às">
                <Entrada type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
              </Campo>
            </div>
            <Campo rotulo="Acompanhante (opcional)">
              <Entrada
                value={acomp}
                onChange={(e) => setAcomp(e.target.value)}
                placeholder="Nome de quem acompanhou"
              />
            </Campo>
          </>
        ) : null}

        {tipo === 'exam_request' ? (
          <Campo rotulo="Exames" ajuda="Um por linha.">
            <Texto
              rows={6}
              value={exames}
              onChange={(e) => setExames(e.target.value)}
              placeholder={'Radiografia panorâmica\nHemograma completo'}
            />
          </Campo>
        ) : null}

        {tipo === 'meal_plan' ? (
          <>
            {refeicoes.map((m, i) => (
              <div key={i} className="space-y-2 rounded-2xl bg-porcelana p-3.5 ring-1 ring-linha">
                <div className="grid grid-cols-[6.5rem_1fr_auto] gap-2">
                  <Entrada
                    type="time"
                    value={m.time}
                    onChange={(e) =>
                      setRefeicoes(
                        refeicoes.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)),
                      )
                    }
                  />
                  <Entrada
                    value={m.name}
                    onChange={(e) =>
                      setRefeicoes(
                        refeicoes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Tirar refeição"
                    onClick={() => setRefeicoes(refeicoes.filter((_, j) => j !== i))}
                    className="grid h-11 w-11 place-items-center rounded-xl text-nevoa hover:text-alerta"
                  >
                    <Icone nome="x" className="h-4 w-4" />
                  </button>
                </div>
                <Texto
                  rows={3}
                  placeholder={
                    'Um alimento por linha, com a quantidade\n2 ovos mexidos\n1 fatia de pão integral'
                  }
                  value={m.items}
                  onChange={(e) =>
                    setRefeicoes(
                      refeicoes.map((x, j) => (j === i ? { ...x, items: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
            <Botao
              onClick={() => setRefeicoes([...refeicoes, { time: '', name: 'Lanche', items: '' }])}
            >
              <Icone nome="mais" className="h-4 w-4" /> Refeição
            </Botao>
            <Campo rotulo="Água por dia">
              <Entrada
                value={agua}
                onChange={(e) => setAgua(e.target.value)}
                placeholder="Ex.: 2,5 litros"
              />
            </Campo>
          </>
        ) : null}

        {tipo && tipo !== 'declaration' ? (
          <Campo rotulo={tipo === 'exam_request' ? 'Indicação clínica' : 'Observações'}>
            <Texto rows={3} value={obs} maxLength={600} onChange={(e) => setObs(e.target.value)} />
          </Campo>
        ) : null}
      </div>
    </Gaveta>
  );
}
