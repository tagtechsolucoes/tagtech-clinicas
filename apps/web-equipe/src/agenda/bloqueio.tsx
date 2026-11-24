import { useState } from 'react';
import { addDays } from '@tagtech/domain';
import { api } from '../api';
import { mensagem, usePainel } from '../contexto';
import { instante } from '../formato';
import { Botao, Campo, Entrada, Gaveta, Seletor } from '../ui';

/** Bloqueia horário de um profissional ou da clínica toda (feriado, curso, férias). */
export function Bloqueio({
  aberto,
  dia,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  dia: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { professionals, avisar } = usePainel();
  const [quem, setQuem] = useState('');
  const [de, setDe] = useState(dia);
  const [ate, setAte] = useState(dia);
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [hDe, setHDe] = useState('12:00');
  const [hAte, setHAte] = useState('13:00');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await api.createTimeOff({
        professionalId: quem || null,
        unitId: null,
        startsAt: instante(de, diaInteiro ? '00:00' : hDe),
        endsAt: diaInteiro ? instante(addDays(ate, 1), '00:00') : instante(ate, hAte),
        reason: motivo.trim(),
      });
      avisar('Horário bloqueado');
      aoSalvar();
      aoFechar();
    } catch (e) {
      avisar(mensagem(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      aberta={aberto}
      aoFechar={aoFechar}
      titulo="Bloquear horário"
      subtitulo="O site deixa de oferecer o período e a recepção vê o bloqueio na agenda."
      rodape={
        <Botao variante="principal" className="flex-1" disabled={salvando} onClick={salvar}>
          Bloquear
        </Botao>
      }
    >
      <div className="space-y-4">
        <Campo rotulo="De quem">
          <Seletor value={quem} onChange={(e) => setQuem(e.target.value)}>
            <option value="">Clínica toda (feriado, recesso)</option>
            {professionals
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Seletor>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Do dia">
            <Entrada type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Campo>
          <Campo rotulo="Até o dia">
            <Entrada type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
          </Campo>
        </div>
        <label className="flex items-center gap-2.5 text-[0.95rem] font-medium">
          <input
            type="checkbox"
            checked={diaInteiro}
            onChange={(e) => setDiaInteiro(e.target.checked)}
            className="h-4 w-4 accent-petroleo"
          />
          Dia inteiro
        </label>
        {!diaInteiro ? (
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Das">
              <Entrada
                type="time"
                step={300}
                value={hDe}
                onChange={(e) => setHDe(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Até">
              <Entrada
                type="time"
                step={300}
                value={hAte}
                onChange={(e) => setHAte(e.target.value)}
              />
            </Campo>
          </div>
        ) : null}
        <Campo rotulo="Motivo (aparece só para a equipe)">
          <Entrada
            value={motivo}
            maxLength={120}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: Congresso, almoço, feriado"
          />
        </Campo>
      </div>
    </Gaveta>
  );
}
