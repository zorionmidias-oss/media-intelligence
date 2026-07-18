'use strict';
const supabase = require('./supabase');

async function registrarHistorico({ utm, adset_id, adset_name, acao, antes, depois, usuario_id, observacao } = {}) {
  if (!utm || !acao) return;
  try {
    // Grab current UTM metrics as snapshot
    const today = require('./datas').hojeBR();
    const { data: rows } = await supabase
      .from('ads_consolidados')
      .select('valor_gasto,faturamento_real,lucro,roas,cpc,ecpm')
      .eq('ad_utm', utm)
      .eq('data', today);

    const metricas_antes = rows?.length
      ? rows.reduce((acc, r) => {
          acc.spend    = (acc.spend    || 0) + Number(r.valor_gasto      || 0);
          acc.fat      = (acc.fat      || 0) + Number(r.faturamento_real || 0);
          acc.lucro    = (acc.lucro    || 0) + Number(r.lucro            || 0);
          return acc;
        }, {})
      : null;

    await supabase.from('historico_campanhas').insert({
      ad_utm: utm,
      adset_id: adset_id || null,
      adset_name: adset_name || null,
      acao,
      valor_antes: antes != null ? String(antes) : null,
      valor_depois: depois != null ? String(depois) : null,
      usuario_id: usuario_id || null,
      observacao: observacao || null,
      metricas_antes,
    });
  } catch (e) {
    console.error('[historico] registrar falhou:', e.message);
  }
}

module.exports = { registrarHistorico };
