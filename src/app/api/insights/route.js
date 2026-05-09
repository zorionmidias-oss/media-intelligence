'use strict';
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um especialista sênior em mídia paga e monetização de publisher digital com mais de 10 anos de experiência.
Sua função é analisar dados de performance de campanhas e inventário publicitário e fornecer insights acionáveis e estratégicos.
Sempre responda em português do Brasil de forma clara, objetiva e profissional.
Ao analisar dados, foque em:
- Eficiência do investimento (ROI, ROAS, CPR, CTR, CPM)
- Anomalias e alertas de queda de performance
- Oportunidades de otimização de campanhas e criativos
- Análise de faturamento vs investimento (lucro e margem)
- Recomendações práticas com impacto mensurável e acionável`;

function summarizeMetrics(metrics) {
  if (!metrics) return 'Nenhum dado disponível.';
  try {
    const { kpis, topCampaigns, topFunnels, adUnits } = metrics;
    const lines = [];
    if (kpis) {
      lines.push('## KPIs Consolidados');
      lines.push(`Faturamento: R$ ${(kpis.faturamento || 0).toFixed(2)}`);
      lines.push(`Investimento: R$ ${(kpis.investimento || 0).toFixed(2)}`);
      lines.push(`Lucro: R$ ${(kpis.lucro || 0).toFixed(2)}`);
      lines.push(`ROI: ${(kpis.roi || 0).toFixed(1)}%`);
      lines.push(`Impressões: ${(kpis.impressions || 0).toLocaleString()}`);
      lines.push(`Cliques: ${(kpis.clicks || 0).toLocaleString()}`);
      lines.push(`CTR: ${(kpis.ctr || 0).toFixed(2)}%`);
      lines.push(`CPM: R$ ${(kpis.cpm || 0).toFixed(2)}`);
      lines.push(`eCPM GAM: R$ ${(kpis.ecpm || 0).toFixed(2)}`);
      lines.push(`Viewability: ${(kpis.viewability || 0).toFixed(1)}%`);
      lines.push(`Resultados: ${(kpis.results || 0).toLocaleString()}`);
      lines.push(`Custo por resultado: R$ ${(kpis.costPerResult || 0).toFixed(2)}`);
    }
    if (topCampaigns?.length) {
      lines.push('\n## Top Campanhas (por investimento)');
      topCampaigns.slice(0, 5).forEach(c => {
        lines.push(`- ${c.name}: R$ ${(c.spend || 0).toFixed(2)} invest, ${c.results || 0} result, ROAS ${(c.roas || 0).toFixed(2)}x`);
      });
    }
    if (topFunnels?.length) {
      lines.push('\n## Funnels por Objetivo');
      topFunnels.forEach(f => {
        lines.push(`- ${f.objective}: R$ ${(f.spend || 0).toFixed(2)} invest, ${f.results || 0} result, CTR ${(f.ctr || 0).toFixed(2)}%`);
      });
    }
    if (adUnits?.length) {
      lines.push('\n## Top Ad Units GAM (por impressões)');
      adUnits.slice(0, 5).forEach(u => {
        lines.push(`- ${u.name}: ${(u.impressions || 0).toLocaleString()} imp, eCPM R$ ${(u.ecpm || 0).toFixed(2)}, viewability ${(u.viewability || 0).toFixed(1)}%`);
      });
    }
    return lines.join('\n');
  } catch {
    return JSON.stringify(metrics).slice(0, 3000);
  }
}

async function handler(req, res) {
  try {
    const { mode = 'auto', question, history = [], metrics } = req.body;

    if (mode === 'auto') {
      const context = summarizeMetrics(metrics);
      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Analise os dados de performance abaixo e retorne um JSON válido com exatamente estas chaves:
- "summary": string com resumo executivo (2-3 frases)
- "highlights": array de 3-5 strings com pontos positivos de performance
- "alerts": array de strings com alertas ou anomalias detectadas (pode ser vazio)
- "recommendations": array de 3-5 strings com recomendações acionáveis

IMPORTANTE: Responda APENAS com o JSON, sem markdown, sem texto adicional.

Dados:
${context}`,
          },
        ],
      });

      let result;
      try {
        const raw = message.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        result = JSON.parse(raw);
      } catch {
        result = {
          summary: message.content[0].text,
          highlights: [],
          alerts: [],
          recommendations: [],
        };
      }
      return res.json(result);
    }

    // Chat mode — streaming
    const context = metrics ? `\n\n---\nDados de contexto:\n${summarizeMetrics(metrics)}\n---` : '';
    const messages = history
      .filter(h => h.role && h.content)
      .map(h => ({ role: h.role, content: h.content }));

    if (question) {
      messages.push({ role: 'user', content: question + context });
    }

    if (!messages.length) {
      return res.status(400).json({ error: 'Nenhuma pergunta fornecida.' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    });

    for await (const text of stream.textStream) {
      res.write(text);
    }
    res.end();
  } catch (err) {
    console.error('[insights]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
}

module.exports = handler;
