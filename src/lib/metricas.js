'use strict';
// ÚNICO lugar do sistema onde métricas derivadas são calculadas.
// Regras de ouro (à prova de erro de cálculo):
//   1. Derivar SEMPRE de somas brutas — nunca média de linhas, nunca reaproveitar
//      derivada armazenada.
//   2. Divisão por zero/dados ausentes → null (a UI mostra "—"), nunca 0 ou Infinity.
//   3. Backend calcula, frontend só formata.
// Fórmulas canônicas (definidas pelo cliente em 18/07/2026):
//   faturamento real  = bruto GAM × 0.9  (aplicado UMA vez no sync — não aqui)
//   roas              = faturamento ÷ investimento
//   lucro             = faturamento − investimento
//   rps               = faturamento ÷ sessões           (retorno por sessão)
//   custo_sessao      = investimento ÷ sessões          (custo por visualização)
//   breakeven         = custo_sessao ÷ rps              (<1 = saudável)
//   sessao_por_lead   = sessões ÷ conversas iniciadas   (view_content ÷ mensagens Meta)
//   par               = impressões GAM ÷ sessões        (anúncios exibidos por sessão · def. cliente 19/08/2026)
// Obs.: no nível onde investimento e faturamento são do MESMO escopo, breakeven
// reduz a investimento ÷ faturamento (sessões se cancelam) — imune a erro de
// contagem de sessão. A forma completa importa quando o custo_sessao é de um
// escopo menor (conjunto) e o rps vem do escopo maior (página).

const div = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0) ? a / b : null;
const round = (v, d) => (v === null ? null : +v.toFixed(d));

// Entradas: SOMAS brutas do período/escopo.
//   investimento (BRL c/ imposto), faturamento (real, pós-taxa), sessoes
//   (view_content Meta), conversas (mensagens iniciadas Meta).
// PAR = impressões GAM ÷ sessões (view_content) — anúncios exibidos por sessão
// do site. Único ponto da fórmula; overview e aba Campanhas consomem daqui.
function par({ impressoes, sessoes }) {
  return round(div(Number(impressoes) || 0, Number(sessoes) || 0), 2);
}

function derivar({ investimento, faturamento, sessoes, conversas, impressoes }) {
  const inv = Number(investimento) || 0;
  const fat = Number(faturamento) || 0;
  const ses = Number(sessoes) || 0;
  const conv = Number(conversas) || 0;

  const rps = div(fat, ses);
  const custoSessao = div(inv, ses);
  return {
    roas: round(div(fat, inv), 4),
    lucro: round(fat - inv, 2),
    rps: round(rps, 4),
    custo_sessao: round(custoSessao, 4),
    breakeven: round(div(custoSessao, rps), 4),
    sessao_por_lead: round(div(ses, conv), 2),
    par: par({ impressoes, sessoes: ses }),
  };
}

// Breakeven de um escopo menor contra o RPS do escopo maior:
// ex. conjunto (spend + view_content próprios) vs RPS da página.
// breakeven = (spend ÷ sessões do conjunto) ÷ rps → <1 = saudável.
function breakevenContraRPS({ investimento, sessoes, rps }) {
  const custoSessao = div(Number(investimento) || 0, Number(sessoes) || 0);
  return round(div(custoSessao, Number(rps) || 0), 4);
}

// Régua única do semáforo (equivale ao ROI antigo: ótimo ≥1.2x, bom ≥1.0x):
// ótimo be ≤ 1/1.2 · bom be ≤ 1 · ruim be > 1 · null sem dado.
function corBreakeven(be) {
  if (be === null || be === undefined) return null;
  if (be <= 1 / 1.2 + 1e-9) return 'ok';
  if (be <= 1) return 'warn';
  return 'bad';
}

module.exports = { derivar, breakevenContraRPS, corBreakeven, par };
