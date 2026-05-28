'use strict';

const loc = (n, d) => {
  d = d == null ? 2 : d;
  return n == null || isNaN(+n) ? '—' : (+n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const BRL = n => n == null || isNaN(+n) ? '—' : 'R$ ' + loc(n, 2);
const PCT = n => n == null || isNaN(+n) ? '—' : loc(n, 2) + '%';
const NUM = n => n == null || isNaN(+n) ? '—' : (+n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

window.loc = loc;
window.BRL = BRL;
window.PCT = PCT;
window.NUM = NUM;
