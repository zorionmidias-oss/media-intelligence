// Formatação pt-BR. Números sem centavos em BRL por padrão (dashboard de arbitragem).
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const BRL = (n) => 'R$ ' + nf0.format(Math.round(Number(n) || 0));
export const NUM = (n) => nf0.format(Number(n) || 0);
export const INT = NUM;

export const PCT = (n, d = 1) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0) + '%';

// Percentual com sinal explícito (+ / −), usando o traço tipográfico de menos.
export const SIGNPCT = (n, d = 1) => (Number(n) >= 0 ? '+' : '−') + PCT(Math.abs(Number(n) || 0), d);
