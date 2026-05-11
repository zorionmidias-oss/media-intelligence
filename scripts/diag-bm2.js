require('dotenv').config({ path: '.env.local' });
const axios = require('axios');

(async () => {
  for (let i = 1; i <= 10; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`];
    const account = process.env[`META_AD_ACCOUNT_BM${i}`];
    if (!token || !account) continue;

    console.log(`\n=== BM${i} (${account}) ===`);

    try {
      // Verifica conta
      const r = await axios.get(`https://graph.facebook.com/v19.0/${account}`, {
        params: {
          access_token: token,
          fields: 'id,name,account_status,disable_reason,currency,timezone_name,business'
        }
      });
      console.log('Conta:', JSON.stringify(r.data, null, 2));

      // Testa insights (a chamada que falha no sync)
      const today = new Date().toISOString().slice(0, 10);
      const i1 = await axios.get(`https://graph.facebook.com/v19.0/${account}/insights`, {
        params: {
          access_token: token,
          level: 'ad',
          time_range: JSON.stringify({ since: today, until: today }),
          fields: 'ad_id,ad_name,spend,clicks',
          time_increment: 1,
          limit: 10
        }
      });
      console.log(`Insights HOJE: ${(i1.data.data || []).length} ads`);

    } catch (e) {
      console.log('ERRO:', e.response?.status, JSON.stringify(e.response?.data || e.message, null, 2));
    }
  }
})();
