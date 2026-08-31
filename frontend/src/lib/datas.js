// "Hoje" SEMPRE no fuso São Paulo (espelha src/lib/datas.js do backend).
// Nunca usar new Date().toISOString() cru — a partir das 21h BRT viraria amanhã.
export const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export function addDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const ontemBR = () => addDias(hojeBR(), -1);
// N dias incluindo hoje: 7d = hoje-6 .. hoje
export const diasAtrasBR = (n) => addDias(hojeBR(), -(n - 1));
export const inicioMesBR = () => hojeBR().slice(0, 8) + '01';

export function mesPassadoBR() {
  const [y, m] = hojeBR().split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

// Presets do filtro de período (retornam { since, until, label }).
export function periodPresets() {
  const h = hojeBR();
  const mp = mesPassadoBR();
  return [
    { key: 'hoje', label: 'Hoje', since: h, until: h },
    { key: 'ontem', label: 'Ontem', since: ontemBR(), until: ontemBR() },
    { key: '7d', label: 'Últimos 7 dias', since: diasAtrasBR(7), until: h },
    { key: '14d', label: 'Últimos 14 dias', since: diasAtrasBR(14), until: h },
    { key: '30d', label: 'Últimos 30 dias', since: diasAtrasBR(30), until: h },
    { key: 'mes', label: 'Este mês', since: inicioMesBR(), until: h },
    { key: 'mes-passado', label: 'Mês passado', since: mp.from, until: mp.to },
  ];
}

// "16 ago" / intervalo "16 ago – 29 ago"
export function fmtRange(since, until) {
  const M = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const one = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${M[m - 1]}`; };
  return since === until ? one(since) : `${one(since)} – ${one(until)}`;
}
