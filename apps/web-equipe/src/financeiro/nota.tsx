import { useEffect, useState } from 'react';
import { PAY_METHOD_LABELS, type PayMethod } from '@tagtech/domain';
import { api, type FiscalSettings, type ServiceInvoice } from '../api';
import { mensagem, usePainel } from '../contexto';
import { dinheiro } from '../formato';
import { Botao, Campo, Entrada, Interruptor, Seletor } from '../ui';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const doc = (d: string) =>
  d.length === 14
    ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
const extenso = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Abre o recibo pronto para imprimir ou salvar em PDF (o paciente usa no reembolso). */
export async function abrirRecibo(
  chargeId: string,
  avisar: (t: string, tipo?: 'ok' | 'erro') => void,
) {
  const janela = window.open('', '_blank');
  try {
    const r = await api.receipt(chargeId);
    const linhas = [
      r.appointment
        ? `${esc(r.appointment.serviceName)} em ${extenso.format(new Date(`${r.appointment.date}T12:00:00Z`))}, com ${esc(r.appointment.professionalName)}${r.appointment.council ? ` (${esc(r.appointment.council)})` : ''}`
        : esc(r.description),
    ];
    janela?.document
      .write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo ${r.number}</title>
<style>
  body{font:15px/1.6 "Instrument Sans",system-ui,sans-serif;color:#0f2028;max-width:680px;margin:48px auto;padding:0 24px}
  h1{font:500 30px/1.1 Fraunces,Georgia,serif;margin:0 0 4px} .sub{color:#56676f;margin:0 0 32px}
  .valor{font:600 34px/1 Fraunces,Georgia,serif;margin:24px 0} .caixa{border:1px solid #dce3e6;border-radius:16px;padding:24px}
  .ass{margin-top:72px;border-top:1px solid #0f2028;width:300px;padding-top:6px;color:#56676f;font-size:13px}
  @media print{body{margin:0}button{display:none}}
</style></head><body>
<h1>Recibo</h1><p class="sub">Nº ${r.number} · ${esc(r.clinic.legalName || r.clinic.name)}${r.clinic.document ? ` · ${r.clinic.document.length === 14 ? 'CNPJ' : 'CPF'} ${doc(r.clinic.document)}` : ''}</p>
<div class="caixa">
<p>Recebi de <strong>${esc(r.patient?.name ?? '—')}</strong>${r.patient?.cpf ? `, CPF ${doc(r.patient.cpf)}` : ''}, a quantia abaixo, referente a:</p>
<p>${linhas.join('<br>')}</p>
<p class="valor">${dinheiro(r.amountCents)}</p>
<p>Pago em ${esc(PAY_METHOD_LABELS[r.method as PayMethod] ?? r.method)}, ${extenso.format(new Date(r.paidAt))}.</p>
</div>
<p style="margin-top:24px;color:#56676f">${esc(r.clinic.address)}${r.clinic.phone ? ` · ${esc(r.clinic.phone)}` : ''}</p>
<div class="ass">${esc(r.appointment?.professionalName ?? r.clinic.legalName ?? r.clinic.name)}</div>
<button id="imprimir" style="margin-top:32px;padding:10px 18px;border-radius:12px;border:0;background:#1d4e5f;color:#fff;font-weight:600">Imprimir ou salvar PDF</button>
</body></html>`);
    janela?.document.close();
    // Sem onclick inline: a política de segurança do painel bloqueia script inline.
    janela?.document.getElementById('imprimir')?.addEventListener('click', () => janela.print());
  } catch (e) {
    janela?.close();
    avisar(mensagem(e), 'erro');
  }
}

const COR: Record<ServiceInvoice['status'], string> = {
  emitting: 'bg-azul-fundo text-azul',
  authorized: 'bg-ok-fundo text-ok',
  error: 'bg-alerta-fundo text-alerta',
  cancelled: 'bg-trilho text-bruma',
};
const TEXTO: Record<ServiceInvoice['status'], string> = {
  emitting: 'Emitindo',
  authorized: 'NFS-e',
  error: 'Nota com erro',
  cancelled: 'Cancelada',
};

/** Botão da nota de um recebimento: emitir, ver ou atualizar. */
export function BotaoNota({
  chargeId,
  nota,
  aoMudar,
}: {
  chargeId: string;
  nota: ServiceInvoice | undefined;
  aoMudar: (n: ServiceInvoice) => void;
}) {
  const { avisar } = usePainel();
  const [ocupado, setOcupado] = useState(false);
  async function agir(fn: () => Promise<ServiceInvoice>) {
    setOcupado(true);
    try {
      const n = await fn();
      aoMudar(n);
      if (n.status === 'error') avisar(n.message ?? 'A prefeitura recusou a nota', 'erro');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setOcupado(false);
    }
  }
  if (!nota || nota.status === 'cancelled' || nota.status === 'error')
    return (
      <Botao
        tamanho="pequeno"
        variante="discreto"
        disabled={ocupado}
        title={nota?.message ?? undefined}
        onClick={() => agir(() => api.emitInvoice(chargeId))}
      >
        {nota?.status === 'error' ? 'Tentar nota de novo' : 'Emitir nota'}
      </Botao>
    );
  if (nota.status === 'authorized' && nota.url && /^https:\/\//.test(nota.url))
    return (
      <a
        href={nota.url}
        target="_blank"
        rel="noreferrer"
        className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR.authorized}`}
      >
        NFS-e {nota.number}
      </a>
    );
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={() => agir(() => api.refreshInvoice(nota.id))}
      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR[nota.status]}`}
    >
      {TEXTO[nota.status]} · atualizar
    </button>
  );
}

/** Configuração da NFS-e pela Focus NFe (só o dono). */
export function NotaConfig() {
  const { avisar } = usePainel();
  const [s, setS] = useState<FiscalSettings | null>(null);
  const [f, setF] = useState({
    environment: 'homologacao',
    token: '',
    standard: 'nacional',
    cnpj: '',
    municipalRegistration: '',
    cityCode: '',
    serviceCode: '',
    municipalServiceCode: '',
    issRate: '0',
    simplesOption: '3',
    description: 'Serviços de saúde',
    autoEmit: false,
  });
  useEffect(() => {
    api
      .fiscal()
      .then((x) => {
        setS(x);
        if (x.configured)
          setF({
            environment: x.environment!,
            token: '',
            standard: x.standard!,
            cnpj: x.cnpj!,
            municipalRegistration: x.municipalRegistration!,
            cityCode: x.cityCode!,
            serviceCode: x.serviceCode!,
            municipalServiceCode: x.municipalServiceCode!,
            issRate: String(x.issRate).replace('.', ','),
            simplesOption: String(x.simplesOption),
            description: x.description!,
            autoEmit: x.autoEmit!,
          });
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [avisar]);
  if (!s) return null;

  async function salvar() {
    try {
      const x = await api.saveFiscal({
        ...f,
        ...(f.token.trim() ? { token: f.token.trim() } : { token: undefined }),
        issRate: Number(f.issRate.replace(',', '.')) || 0,
        simplesOption: Number(f.simplesOption),
      });
      setS(x);
      setF({ ...f, token: '' });
      avisar('Nota fiscal configurada');
    } catch (e) {
      avisar(mensagem(e), 'erro');
    }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <section className="mt-8 rounded-3xl bg-folha p-6 ring-1 ring-linha lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Nota fiscal de serviço</h2>
          <p className="mt-1 max-w-xl text-nevoa">
            NFS-e pela Focus NFe, com a conta da clínica. Teste em homologação antes de passar para
            produção.
          </p>
        </div>
        <span
          className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${s.configured ? 'bg-ok-fundo text-ok' : 'bg-trilho text-nevoa'}`}
        >
          {s.configured ? (s.environment === 'producao' ? 'Produção' : 'Homologação') : 'Desligada'}
        </span>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <Campo rotulo="Ambiente">
          <Seletor value={f.environment} onChange={set('environment')}>
            <option value="homologacao">Homologação (teste)</option>
            <option value="producao">Produção</option>
          </Seletor>
        </Campo>
        <Campo rotulo="Padrão da prefeitura">
          <Seletor value={f.standard} onChange={set('standard')}>
            <option value="nacional">NFS-e Nacional</option>
            <option value="municipal">Sistema da prefeitura</option>
          </Seletor>
        </Campo>
        <Campo rotulo="Token da Focus NFe" ajuda="Fica guardado e nunca volta para a tela.">
          <Entrada
            type="password"
            autoComplete="off"
            value={f.token}
            placeholder={s.configured ? '•••••••• (já salvo)' : ''}
            onChange={set('token')}
          />
        </Campo>
        <Campo rotulo="CNPJ">
          <Entrada inputMode="numeric" value={f.cnpj} onChange={set('cnpj')} />
        </Campo>
        <Campo rotulo="Inscrição municipal">
          <Entrada value={f.municipalRegistration} onChange={set('municipalRegistration')} />
        </Campo>
        <Campo rotulo="Código IBGE do município" ajuda="Ex.: Recife 2611606">
          <Entrada
            inputMode="numeric"
            maxLength={7}
            value={f.cityCode}
            onChange={set('cityCode')}
          />
        </Campo>
        <Campo
          rotulo={
            f.standard === 'nacional' ? 'Código de tributação nacional' : 'Item da lista de serviço'
          }
          ajuda="Confirme com o contador da clínica"
        >
          <Entrada value={f.serviceCode} onChange={set('serviceCode')} />
        </Campo>
        <Campo rotulo="Código municipal (se pedir)">
          <Entrada value={f.municipalServiceCode} onChange={set('municipalServiceCode')} />
        </Campo>
        <Campo rotulo="Alíquota do ISS (%)">
          <Entrada inputMode="decimal" value={f.issRate} onChange={set('issRate')} />
        </Campo>
        <Campo rotulo="Simples Nacional">
          <Seletor value={f.simplesOption} onChange={set('simplesOption')}>
            <option value="1">Não optante</option>
            <option value="2">MEI</option>
            <option value="3">ME/EPP</option>
          </Seletor>
        </Campo>
        <div className="md:col-span-2">
          <Campo rotulo="Descrição na nota">
            <Entrada value={f.description} maxLength={500} onChange={set('description')} />
          </Campo>
        </div>
      </div>
      <div className="mt-5">
        <Interruptor
          ligado={f.autoEmit}
          aoMudar={(v) => setF({ ...f, autoEmit: v })}
          rotulo="Emitir sozinha ao receber"
          descricao="Cada recebimento de paciente gera a nota na hora. Lotes de convênio ficam para emitir à mão."
        />
      </div>
      <div className="mt-6 flex gap-3">
        <Botao variante="principal" onClick={salvar}>
          Salvar
        </Botao>
        {s.configured ? (
          <Botao
            variante="perigo"
            onClick={() =>
              api
                .removeFiscal()
                .then((x) => {
                  setS(x);
                  avisar('Nota fiscal desligada');
                })
                .catch((e) => avisar(mensagem(e), 'erro'))
            }
          >
            Desligar
          </Botao>
        ) : null}
      </div>
    </section>
  );
}
