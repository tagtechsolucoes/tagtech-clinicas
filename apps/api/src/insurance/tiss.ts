import { createHash } from 'node:crypto';

/**
 * Lote de guias de consulta no padrão TISS 4.01.00 (ANS). O hash do epílogo é o MD5 do
 * texto de todos os campos, na ordem em que aparecem, como pede o padrão.
 *
 * Cada operadora valida o arquivo no próprio portal: a clínica confere no primeiro envio.
 */

export const TISS_VERSION = '4.01.00';

export interface TissClaim {
  claimId: string;
  date: string;
  cardNumber: string;
  guideNumber: string | null;
  professionalName: string;
  /** Conselho como foi cadastrado, ex.: "CRO-PE 12345". */
  council: string;
  tussCode: string;
  valueCents: number;
}

// Tabela 26 da TISS: conselho profissional.
const CONSELHOS: Record<string, string> = {
  CRAS: '01',
  COREN: '02',
  CRF: '03',
  CRFA: '04',
  CREFITO: '05',
  CRM: '06',
  CRN: '07',
  CRO: '08',
  CRP: '09',
};

/** "CRO-PE 12345" → conselho 08, UF PE, número 12345. */
export function parseCouncil(c: string) {
  const m = /^\s*([A-Za-z]+)\s*[-/ ]?\s*([A-Za-z]{2})?\s*[-/: ]*\s*(\d+)/.exec(c);
  const sigla = (m?.[1] ?? '').toUpperCase();
  return {
    code: CONSELHOS[sigla] ?? '10',
    uf: (m?.[2] ?? '').toUpperCase(),
    number: m?.[3] ?? '',
  };
}

// Códigos de UF do IBGE (a TISS usa o código numérico).
const UF: Record<string, string> = {
  RO: '11',
  AC: '12',
  AM: '13',
  RR: '14',
  PA: '15',
  AP: '16',
  TO: '17',
  MA: '21',
  PI: '22',
  CE: '23',
  RN: '24',
  PB: '25',
  PE: '26',
  AL: '27',
  SE: '28',
  BA: '29',
  MG: '31',
  ES: '32',
  RJ: '33',
  SP: '35',
  PR: '41',
  SC: '42',
  RS: '43',
  MS: '50',
  MT: '51',
  GO: '52',
  DF: '53',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reais = (c: number) => (c / 100).toFixed(2);

type No = [string, string | No[]];

function render(n: No, ind = ''): string {
  const [tag, v] = n;
  if (typeof v === 'string') return `${ind}<ans:${tag}>${esc(v)}</ans:${tag}>`;
  return `${ind}<ans:${tag}>\n${v.map((c) => render(c, `${ind}  `)).join('\n')}\n${ind}</ans:${tag}>`;
}

function texto(n: No): string {
  const [, v] = n;
  return typeof v === 'string' ? v : v.map(texto).join('');
}

export function tissXml(o: {
  ansCode: string;
  providerCode: string;
  batchNumber: number;
  now: Date;
  claims: TissClaim[];
}): string {
  const iso = o.now.toISOString();
  const cabecalho: No = [
    'cabecalho',
    [
      [
        'identificacaoTransacao',
        [
          ['tipoTransacao', 'ENVIO_LOTE_GUIAS'],
          ['sequencialTransacao', String(o.batchNumber)],
          ['dataRegistroTransacao', iso.slice(0, 10)],
          ['horaRegistroTransacao', iso.slice(11, 19)],
        ],
      ],
      ['origem', [['identificacaoPrestador', [['codigoPrestadorNaOperadora', o.providerCode]]]]],
      ['destino', [['registroANS', o.ansCode]]],
      ['Padrao', TISS_VERSION],
    ],
  ];
  const guias: No[] = o.claims.map((c, i) => {
    const cons = parseCouncil(c.council);
    return [
      'guiaConsulta',
      [
        [
          'cabecalhoConsulta',
          [
            ['registroANS', o.ansCode],
            ['numeroGuiaPrestador', String(o.batchNumber * 1000 + i + 1)],
          ],
        ],
        ...(c.guideNumber ? ([['numeroGuiaOperadora', c.guideNumber]] as No[]) : []),
        [
          'dadosBeneficiario',
          [
            ['numeroCarteira', c.cardNumber],
            ['atendimentoRN', 'N'],
          ],
        ],
        ['contratadoExecutante', [['codigoPrestadorNaOperadora', o.providerCode]]],
        [
          'profissionalExecutante',
          [
            ['nomeProfissional', c.professionalName.slice(0, 70)],
            ['conselhoProfissional', cons.code],
            ['numeroConselhoProfissional', cons.number],
            ['UF', UF[cons.uf] ?? ''],
            ['CBOS', '999999'],
          ],
        ],
        ['indicacaoAcidente', '9'],
        [
          'dadosAtendimento',
          [
            ['regimeAtendimento', '01'],
            ['dataAtendimento', c.date],
            ['tipoConsulta', '1'],
            [
              'procedimento',
              [
                ['codigoTabela', '22'],
                ['codigoProcedimento', c.tussCode || '10101012'],
                ['valorProcedimento', reais(c.valueCents)],
              ],
            ],
          ],
        ],
      ],
    ];
  });
  const corpo: No = [
    'prestadorParaOperadora',
    [
      [
        'loteGuias',
        [
          ['numeroLote', String(o.batchNumber)],
          ['guiasTISS', guias],
        ],
      ],
    ],
  ];
  const hash = createHash('md5')
    .update(texto(cabecalho) + texto(corpo), 'latin1')
    .digest('hex');
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    render(cabecalho, '  '),
    render(corpo, '  '),
    render(['epilogo', [['hash', hash]]], '  '),
    '</ans:mensagemTISS>',
    '',
  ].join('\n');
}
