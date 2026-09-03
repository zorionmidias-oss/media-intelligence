// Definição de colunas + formatadores + helpers de ROI/data da aba Campanhas.
// Porta COLS/roiCls/roiTxt/fmt de campanhas-a.html, mapeando cada coluna para o
// campo real de uma linha de /api/dashboard (agrupada por campaign_id).
import { hojeBR } from '../../lib/datas.js';

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

// Número com N casas, vírgula decimal pt-BR.
export const num = (v, d) => (Number(v) || 0).toFixed(d).replace('.', ',');
// Dinheiro inteiro com sinal de menos tipográfico (usado em Gasto/Receita/Lucro).
export const money = (v) => (Number(v) < 0 ? '−' : '') + 'R$ ' + nf0.format(Math.abs(Math.round(Number(v) || 0)));
// Dinheiro com 2 casas (eCPM/RPS/CPC/Custo·result).
export const money2 = (v) => 'R$ ' + num(v, 2);
// Inteiro com separador de milhar (Impressões/Sessões/Resultado).
export const intg = (v) => nf0.format(Math.round(Number(v) || 0));

// ROI% da linha = lucro ÷ gasto × 100 (faturamento_real já é líquido; NÃO reaplicar ×0.9).
export const roiOf = (c) => (Number(c.valor_gasto) > 0 ? (Number(c.lucro) / Number(c.valor_gasto)) * 100 : 0);
export const roiTxt = (r) => (r >= 0 ? '' : '−') + Math.abs(r).toFixed(1).replace('.', ',') + '%';
// Semáforo: ≥20 saudável (menta), ≥0 atenção (âmbar), <0 no vermelho.
export const roiCls = (r) => (r >= 20 ? 'ok' : r >= 0 ? 'warn' : 'bad');

// ── Datas (fuso BR) ────────────────────────────────────────────────────────
// Parse de 'YYYY-MM-DD' → epoch UTC de meia-noite, para diferença em dias sem tz.
const isoToUTC = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
// Data (fuso São Paulo) de um timestamp ISO — para ultima_otimizacao (timestamptz).
export const brDate = (isoTs) => new Date(isoTs).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
// Dias desde uma data 'YYYY-MM-DD' até hoje (BR). null quando a data é ausente.
export const daysSince = (isoDate) => (isoDate ? Math.round((isoToUTC(hojeBR()) - isoToUTC(isoDate)) / 864e5) : null);
// dd/mm/yy a partir de ISO (string-based, evita o bug de fuso de new Date('YYYY-MM-DD')).
export const fD = (iso) => {
  const s = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '—';
};

// Catálogo de colunas. `field` = campo bruto da linha de /api/dashboard; `def` =
// visível por padrão; `lock` = ROI sempre presente; `signed` = colore +/−.
// (Viewability foi omitida: /api/dashboard não retorna esse campo por campanha.)
export const COLS = [
  { k: 'criada', lb: 'Criada em', type: 'date', field: 'data_inicio', def: 1 },
  { k: 'otim', lb: 'Última otim.', type: 'reldate', field: 'ultima_otimizacao', def: 1 },
  { k: 'roi', lb: 'ROI', type: 'roi', def: 1, lock: 1 },
  { k: 'gasto', lb: 'Gasto', type: 'money', field: 'valor_gasto', def: 1 },
  { k: 'rec', lb: 'Receita', type: 'money', field: 'faturamento_real', def: 1 },
  { k: 'lucro', lb: 'Lucro', type: 'money', field: 'lucro', signed: 1, def: 1 },
  { k: 'roas', lb: 'ROAS', type: 'num2', field: 'roas', def: 1 },
  { k: 'ecpm', lb: 'eCPM', type: 'money2', field: 'ecpm', def: 1 },
  { k: 'rps', lb: 'RPS', type: 'money2', field: 'rps', def: 1 },
  { k: 'cpc', lb: 'CPC', type: 'money2', field: 'cpc' },
  { k: 'ctr', lb: 'CTR', type: 'pct2', field: 'ctr' },
  { k: 'impr', lb: 'Impressões', type: 'int', field: 'impressoes_gam', def: 1 },
  { k: 'sess', lb: 'Sessões', type: 'int', field: 'sessoes' },
  { k: 'par', lb: 'PAR', type: 'num1', field: 'par', def: 1 },
  { k: 'sesslead', lb: 'Sessão/lead', type: 'num1', field: 'sessao_por_conversa', def: 1 },
  { k: 'custores', lb: 'Custo/result', type: 'money2', field: 'custo_resultado', def: 1 },
  { k: 'result', lb: 'Resultado', type: 'int', field: 'resultado' },
  { k: 'be', lb: 'Break-even', type: 'num2', field: 'breakeven' },
];

export const DEFAULT_VIS = COLS.filter((c) => c.def).map((c) => c.k);

// Valor formatado de uma célula simples (ROI/date/reldate são tratados à parte pelo componente).
export function fmtCell(col, v) {
  switch (col.type) {
    case 'money': return money(v);
    case 'money2': return money2(v);
    case 'int': return intg(v);
    case 'pct2': return num(v, 2) + '%';
    case 'pct1': return num(v, 1) + '%';
    case 'num2': return num(v, 2);
    case 'num1': return num(v, 1);
    default: return v;
  }
}

// Chave de ordenação numérica por coluna (datas viram epoch; ROI é derivado).
export function sortVal(c, col) {
  if (col.k === 'roi') return roiOf(c);
  if (col.type === 'date') return c[col.field] ? isoToUTC(c[col.field]) : 0;
  if (col.type === 'reldate') return c[col.field] ? new Date(c[col.field]).getTime() : 0;
  return Number(c[col.field]) || 0;
}

// Chave estável de linha (id da campanha; fallback legado por utm+país).
export const rowKey = (c) => (c.campaign_id ? `c:${c.campaign_id}` : `${c.ad_utm}|${c.pais_sigla || ''}`);
