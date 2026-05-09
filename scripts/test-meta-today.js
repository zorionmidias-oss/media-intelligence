require('dotenv').config({ path: '.env.local' });
const axios = require('axios');

(async () => {
  const token = process.env.META_ACCESS_TOKEN_BM1;
  const account = process.env.META_AD_ACCOUNT_BM1;
  const today = new Date().toISOString().slice(0, 10);

  console.log('Token prefix:', token?.slice(0, 20) + '...');
  console.log('Account:', account);
  console.log('Date:', today);

  // Teste 1: insights de hoje
  const r1 = await axios.get(`https://graph.facebook.com/v19.0/${account}/insights`, {
    params: {
      access_token: token,
      time_range: JSON.stringify({ since: today, until: today }),
      level: 'ad',
      fields: 'ad_id,ad_name,campaign_name,adset_name,spend,clicks,impressions,actions',
      limit: 100
    }
  }).catch(e => ({ error: e.response?.data || e.message }));

  console.log('\nMETA insights HOJE:', JSON.stringify(r1.data || r1.error, null, 2));

  // Teste 2: budgets por campanha
  const r2 = await axios.get(`https://graph.facebook.com/v19.0/${account}/campaigns`, {
    params: {
      access_token: token,
      fields: 'id,name,daily_budget,lifetime_budget,status,effective_status',
      limit: 50
    }
  }).catch(e => ({ error: e.response?.data || e.message }));

  console.log('\nMETA campaigns:', JSON.stringify(r2.data || r2.error, null, 2));

  // Teste 3: insights últimos 7 dias para ver se tem dados históricos
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const r3 = await axios.get(`https://graph.facebook.com/v19.0/${account}/insights`, {
    params: {
      access_token: token,
      time_range: JSON.stringify({ since: since7, until: today }),
      level: 'campaign',
      fields: 'campaign_name,spend,impressions,clicks',
      limit: 50
    }
  }).catch(e => ({ error: e.response?.data || e.message }));

  console.log('\nMETA insights últimos 7 dias (campaign level):', JSON.stringify(r3.data || r3.error, null, 2));
})();
