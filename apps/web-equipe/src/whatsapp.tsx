import { useEffect, useState } from 'react';
import { WHATSAPP_TEMPLATE_BODY } from '@tagtech/domain';
import { api, type WhatsAppSettings } from './api';
import { mensagem, usePainel } from './contexto';
import { Botao, Campo, Entrada, Icone, Interruptor, Seletor } from './ui';

/**
 * Configuração das mensagens automáticas (API oficial da Meta). O token é colado uma vez e
 * nunca volta para a tela.
 */
export function WhatsAppConfig() {
  const { vinculo, avisar } = usePainel();
  const dono = vinculo.role === 'owner';
  const [cfg, setCfg] = useState<WhatsAppSettings | null>(null);
  const [form, setForm] = useState({
    phoneNumberId: '',
    accessToken: '',
    templateName: 'consulta_aviso',
    templateLang: 'pt_BR',
    reminderHours: 24,
  });
  const [teste, setTeste] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .whatsapp()
      .then((c) => {
        setCfg(c);
        setForm((f) => ({
          ...f,
          phoneNumberId: c.phoneNumberId,
          templateName: c.templateName,
          templateLang: c.templateLang,
          reminderHours: c.reminderHours,
        }));
      })
      .catch((e) => avisar(mensagem(e), 'erro'));
  }, [avisar]);

  if (!cfg) return null;

  async function salvar() {
    setSalvando(true);
    try {
      const { accessToken, ...resto } = form;
      const novo = await api.saveWhatsapp({
        ...resto,
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        enabled: cfg?.enabled || !cfg?.configured,
      });
      setCfg(novo);
      setForm({ ...form, accessToken: '' });
      avisar(`WhatsApp conectado${novo.displayPhone ? ` (${novo.displayPhone})` : ''}`);
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      {cfg.configured ? (
        <div className="flex items-center gap-3 rounded-2xl bg-ok-fundo px-4 py-3 text-ok">
          <Icone nome="whatsapp" className="h-5 w-5" />
          <span className="flex-1 text-sm font-semibold">
            Conectado{cfg.displayPhone ? ` ao ${cfg.displayPhone}` : ''}.{' '}
            {cfg.enabled ? 'Mensagens ligadas.' : 'Mensagens pausadas.'}
          </span>
        </div>
      ) : (
        <p className="rounded-2xl bg-porcelana px-4 py-3 text-sm text-nevoa">
          Sem conexão, a recepção ainda manda a confirmação pelo botão da consulta. Conectado, o
          sistema avisa sozinho ao agendar, remarcar e cancelar, e manda o lembrete antes da
          consulta.
        </p>
      )}

      {cfg.configured && dono ? (
        <Interruptor
          ligado={cfg.enabled}
          aoMudar={async (v) => {
            try {
              setCfg(await api.toggleWhatsapp(v));
            } catch (e) {
              avisar(mensagem(e), 'erro');
            }
          }}
          rotulo="Mandar mensagens automáticas"
        />
      ) : null}

      {dono ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="ID do número (Meta)">
              <Entrada
                inputMode="numeric"
                value={form.phoneNumberId}
                onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
                placeholder="Ex.: 123456789012345"
              />
            </Campo>
            <Campo rotulo={cfg.configured ? 'Token (deixe vazio para manter)' : 'Token de acesso'}>
              <Entrada
                type="password"
                autoComplete="off"
                value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              />
            </Campo>
            <Campo rotulo="Nome do modelo aprovado">
              <Entrada
                value={form.templateName}
                onChange={(e) => setForm({ ...form, templateName: e.target.value })}
              />
            </Campo>
            <Campo rotulo="Lembrete">
              <Seletor
                value={form.reminderHours}
                onChange={(e) => setForm({ ...form, reminderHours: Number(e.target.value) })}
              >
                {[2, 4, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h} horas antes
                  </option>
                ))}
              </Seletor>
            </Campo>
          </div>
          <details className="rounded-2xl bg-porcelana px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">
              Texto para cadastrar o modelo na Meta
            </summary>
            <p className="mt-2 text-nevoa">
              Categoria Utilidade, idioma português (Brasil), com este corpo:
            </p>
            <p className="mt-2 rounded-xl bg-folha p-3 font-mono text-[0.82rem] ring-1 ring-linha">
              {WHATSAPP_TEMPLATE_BODY}
            </p>
          </details>
          <div className="flex flex-wrap gap-2.5">
            <Botao variante="principal" disabled={salvando || !form.phoneNumberId} onClick={salvar}>
              {cfg.configured ? 'Salvar' : 'Conectar'}
            </Botao>
            {cfg.configured ? (
              <Botao
                variante="discreto"
                onClick={async () => {
                  setCfg(await api.removeWhatsapp());
                  avisar('WhatsApp desconectado');
                }}
              >
                Desconectar
              </Botao>
            ) : null}
          </div>
          {cfg.configured ? (
            <div className="flex gap-2">
              <Entrada
                inputMode="tel"
                placeholder="Seu WhatsApp para um teste"
                value={teste}
                onChange={(e) => setTeste(e.target.value)}
              />
              <Botao
                disabled={!teste.trim()}
                onClick={async () => {
                  try {
                    await api.testWhatsapp(teste);
                    avisar('Mensagem de teste enviada');
                  } catch (e) {
                    avisar(mensagem(e), 'erro');
                  }
                }}
              >
                Testar
              </Botao>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-nevoa">Só o dono da clínica conecta o WhatsApp.</p>
      )}
    </div>
  );
}
