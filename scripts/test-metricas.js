'use strict';
// Teste de sanidade do módulo canônico de métricas (src/lib/metricas.js).
// Casos = exemplos dados pelo cliente em 18/07/2026. Qualquer mudança de fórmula
// que quebre um caso, este script acusa. Rodar: node scripts/test-metricas.js
const { derivar, breakevenContraRPS, corBreakeven, par } = require('../src/lib/metricas');

let fail = 0;
function eq(label, got, want) {
  const ok = (got === null && want === null)
    || (typeof got === 'string' || typeof want === 'string'
        ? got === want
        : got !== null && want !== null && Math.abs(got - want) < 1e-9);
  console.log(`${ok ? '✅' : '❌'} ${label}: ${got} ${ok ? '==' : '!='} ${want}`);
  if (!ok) fail++;
}

// ROAS / Lucro: fat 2000, inv 1000 → roas 2, lucro 1000
const m1 = derivar({ investimento: 1000, faturamento: 2000, sessoes: 0, conversas: 0 });
eq('roas 2000/1000', m1.roas, 2);
eq('lucro 2000-1000', m1.lucro, 1000);
eq('rps sem sessões → null', m1.rps, null);
eq('sessão/lead sem dados → null', m1.sessao_por_lead, null);

// Sessão por lead: 250 visualizações / 150 conversas = 1.6667 → 1.67 (2 casas)
const m2 = derivar({ investimento: 0, faturamento: 0, sessoes: 250, conversas: 150 });
eq('sessão/lead 250/150', m2.sessao_por_lead, 1.67);

// Breakeven exemplo do cliente: custo/visualização 0.05, rps 0.06 → 0.8333
const be = breakevenContraRPS({ investimento: 5, sessoes: 100, rps: 0.06 });
eq('breakeven 0.05/0.06', be, 0.8333);
eq('cor breakeven 0.8333', corBreakeven(be), 'ok');
eq('cor breakeven 0.95', corBreakeven(0.95), 'warn');
eq('cor breakeven 1.2', corBreakeven(1.2), 'bad');
eq('cor breakeven null', corBreakeven(null), null);

// Breakeven no mesmo escopo = inv/fat (sessões se cancelam): inv 900, fat 1000, 500 sessões
const m3 = derivar({ investimento: 900, faturamento: 1000, sessoes: 500, conversas: 10 });
eq('breakeven mesmo escopo = inv/fat', m3.breakeven, 0.9);
eq('rps 1000/500', m3.rps, 2);
eq('custo_sessao 900/500', m3.custo_sessao, 1.8);

// PAR = impressões GAM ÷ sessões: 25000/5000 = 5.00
eq('par 25000/5000', par({ impressoes: 25000, sessoes: 5000 }), 5);
eq('par 3000/1200 → 2.5', par({ impressoes: 3000, sessoes: 1200 }), 2.5);
eq('par sem sessões → null', par({ impressoes: 100, sessoes: 0 }), null);
// PAR também sai de derivar (mesma fórmula)
eq('par via derivar', derivar({ sessoes: 5000, impressoes: 25000 }).par, 5);

// Zeros nunca viram 0/Infinity
const m4 = derivar({ investimento: 0, faturamento: 0, sessoes: 0, conversas: 0 });
eq('roas 0/0 → null', m4.roas, null);
eq('breakeven 0/0 → null', m4.breakeven, null);
eq('lucro 0-0 = 0', m4.lucro, 0);

process.exit(fail ? 1 : 0);
