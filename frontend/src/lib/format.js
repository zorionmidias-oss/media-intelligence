// Formatação pt-BR. Números sem centavos em BRL por padrão (dashboard de arbitragem).
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const BRL = (n) => 'R$ ' + nf0.format(Math.round(Number(n) || 0));
export const NUM = (n) => nf0.format(Number(n) || 0);
export const INT = NUM;

export const PCT = (n, d = 1) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0) + '%';

// Percentual com sinal explícito (+ / −), usando o traço tipográfico de menos.
export const SIGNPCT = (n, d = 1) => (Number(n) >= 0 ? '+' : '−') + PCT(Math.abs(Number(n) || 0), d);

// Data curta dd/mm a partir de string ISO (YYYY-MM-DD), sem passar por Date() —
// evita o bug de fuso (new Date('YYYY-MM-DD') vira meia-noite UTC, que pode exibir
// o dia errado no fuso de São Paulo). Usado no tooltip de hover dos gráficos.
export const DDMM = (iso) => {
  const s = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
};

// Querystring dos filtros globais (período + domínio) — omite domain quando 'all'
// (backend trata ausência = todos os domínios). Usado por Overview/HourTable/RoiPorPais.
export function filterQs({ since, until, domain } = {}) {
  const p = new URLSearchParams();
  if (since) p.set('since', since);
  if (until) p.set('until', until);
  if (domain && domain !== 'all') p.set('domain', domain);
  const s = p.toString();
  return s ? `?${s}` : '';
}
