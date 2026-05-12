'use strict';
const supabase = require('./supabase');

async function detectarAlertas() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const [{ data: todayAds }, { data: yesterdayAds }, { data: metas }] = await Promise.all([
      supabase.from('ads_consolidados').select('ad_utm,dominio_id,valor_gasto,faturamento_real,lucro,roas,cpc,ecpm,resultado,impressoes_gam').eq('data', today),
      supabase.from('ads_consolidados').select('ad_utm,ecpm,roas,lucro').eq('data', yesterday),
      supabase.from('metas').select('*').eq('ativa', true),
    ]);

    const alertas = [];
    const today_ = todayAds || [];
    const yesterday_ = yesterdayAds || [];

    const totalSpend = today_.reduce((s, a) => s + Number(a.valor_gasto || 0), 0);

    for (const ad of today_) {
      const spend = Number(ad.valor_gasto || 0);
      const roas  = Number(ad.roas  || 0);
      const lucro = Number(ad.lucro || 0);
      const ecpm  = Number(ad.ecpm  || 0);
      const utm   = ad.ad_utm;

      // 1. Alta concentração + baixo ROI
      if (totalSpend > 0) {
        const pct = (spend / totalSpend) * 100;
        if (pct > 30 && roas < 1) {
          alertas.push({
            tipo: 'utm_alta_concentracao_baixo_roi',
            severidade: 'warning',
            titulo: `${utm} consumindo ${pct.toFixed(0)}% do investimento`,
            mensagem: `ROAS ${roas.toFixed(2)}x — abaixo do break-even`,
            ad_utm: utm,
          });
        }
      }

      // 2. Lucro negativo > R$50
      if (lucro < -50) {
        alertas.push({
          tipo: 'lucro_negativo',
          severidade: 'danger',
          titulo: `${utm} com prejuízo de R$ ${Math.abs(lucro).toFixed(2)}`,
          mensagem: `Investiu R$ ${spend.toFixed(2)} e faturou R$ ${Number(ad.faturamento_real || 0).toFixed(2)}`,
          ad_utm: utm,
        });
      }

      // 3. Oportunidade de escalar (ROAS > 3)
      if (roas > 3) {
        alertas.push({
          tipo: 'oportunidade_escalar',
          severidade: 'success',
          titulo: `${utm} com ROAS ${roas.toFixed(2)}x — escalar!`,
          mensagem: `Cada R$ 1 investido retorna R$ ${roas.toFixed(2)}`,
          ad_utm: utm,
        });
      }

      // 4. eCPM variation vs yesterday
      const yd = yesterday_.find(a => a.ad_utm === utm);
      if (yd && Number(yd.ecpm || 0) > 0) {
        const ecpmYd = Number(yd.ecpm);
        const variacao = ((ecpm - ecpmYd) / ecpmYd) * 100;
        if (Math.abs(variacao) >= 10) {
          alertas.push({
            tipo: 'ecpm_variacao',
            severidade: variacao > 0 ? 'success' : 'warning',
            titulo: `eCPM de ${utm} ${variacao > 0 ? 'subiu' : 'caiu'} ${Math.abs(variacao).toFixed(0)}%`,
            mensagem: `Hoje: R$ ${ecpm.toFixed(2)} | Ontem: R$ ${ecpmYd.toFixed(2)}`,
            ad_utm: utm,
          });
        }
      }
    }

    // 5. Metas atingidas
    const totFat   = today_.reduce((s, a) => s + Number(a.faturamento_real || 0), 0);
    const totSpend_ = totalSpend;
    for (const meta of metas || []) {
      let atual = 0;
      if (meta.tipo === 'faturamento_diario') atual = totFat;
      else if (meta.tipo === 'investimento_diario') atual = totSpend_;
      if (atual >= meta.valor && meta.valor > 0) {
        alertas.push({
          tipo: `meta_atingida_${meta.tipo}`,
          severidade: 'success',
          titulo: `Meta de ${meta.tipo.replace(/_/g, ' ')} atingida!`,
          mensagem: `Alcançou R$ ${atual.toFixed(2)} de R$ ${meta.valor.toFixed(2)}`,
          ad_utm: null,
        });
      }
    }

    // Insert new alerts (avoid duplicates on same day)
    for (const a of alertas) {
      const { data: existing } = await supabase
        .from('notificacoes')
        .select('id')
        .eq('tipo', a.tipo)
        .eq('ad_utm', a.ad_utm || '')
        .gte('created_at', today + 'T00:00:00')
        .limit(1);

      if (!existing?.length) {
        await supabase.from('notificacoes').insert(a);
      }
    }

    return alertas;
  } catch (e) {
    console.error('[alertas] detectarAlertas falhou:', e.message);
    return [];
  }
}

module.exports = { detectarAlertas };
