'use strict';
const axios    = require('axios');
const supabase = require('../lib/supabase');

let _usdToBrl       = null;
let _usdToBrlExpiry = 0;
const _rateCache    = {}; // date-string → taxa

async function getUSDtoBRL() {
  if (_usdToBrl && Date.now() < _usdToBrlExpiry) return _usdToBrl;
  let taxa = null;
  try {
    const r = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', { timeout: 8000 });
    const bid = Number(r.data?.USDBRL?.bid);
    if (bid > 3 && bid < 12) taxa = bid;
  } catch { /* fallback abaixo */ }
  if (!taxa) {
    try {
      const r = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 10000 });
      taxa = Number(r.data?.rates?.BRL) || null;
    } catch (e) {
      console.warn('[USD→BRL]', e.message);
    }
  }
  if (!taxa || taxa < 3 || taxa > 12) taxa = _usdToBrl || 5.0;
  _usdToBrl       = taxa;
  _usdToBrlExpiry = Date.now() + 3600 * 1000;
  return _usdToBrl;
}

// Taxa histórica por data — usa cache DB (taxas_cambio) para dias passados.
// A API gratuita só fornece taxa atual; ao primeiro acesso para uma data, salva a
// taxa atual como referência fixa para aquele dia (sincronizações futuras reusam esse valor).
async function getUSDtoBRLByDate(date) {
  const dateStr = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);

  if (_rateCache[dateStr]) {
    console.log(`[taxa USD→BRL] ${dateStr}: ${_rateCache[dateStr]} (fonte: memory-cache)`);
    return _rateCache[dateStr];
  }

  try {
    const { data: cached } = await supabase
      .from('taxas_cambio')
      .select('taxa,fonte')
      .eq('data', dateStr)
      .maybeSingle();

    if (cached) {
      _rateCache[dateStr] = Number(cached.taxa);
      console.log(`[taxa USD→BRL] ${dateStr}: ${cached.taxa} (fonte: db/${cached.fonte || 'unknown'})`);
      return _rateCache[dateStr];
    }
  } catch { /* tabela pode não existir ainda */ }

  let taxa  = null;
  let fonte = 'exchangerate-api';
  try {
    const r = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', { timeout: 8000 });
    const bid = Number(r.data?.USDBRL?.bid);
    if (bid > 3 && bid < 12) { taxa = bid; fonte = 'awesomeapi'; }
  } catch { /* fallback abaixo */ }

  if (!taxa) {
    try {
      const r = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 10000 });
      taxa = Number(r.data?.rates?.BRL) || null;
    } catch { /* usa fallback */ }
  }

  if (!taxa || taxa < 3 || taxa > 12) {
    console.warn(`[taxa USD→BRL] ${dateStr}: API retornou valor inválido (${taxa}), usando fallback 5.70`);
    taxa  = 5.70;
    fonte = 'fallback';
  }

  _rateCache[dateStr] = taxa;
  console.log(`[taxa USD→BRL] ${dateStr}: ${taxa} (fonte: ${fonte})`);

  const { error: uErr } = await supabase
    .from('taxas_cambio')
    .upsert({ data: dateStr, taxa, fonte }, { onConflict: 'data' });
  if (uErr) console.warn(`[taxa USD→BRL] falha ao salvar ${dateStr}:`, uErr.message);

  return taxa;
}

module.exports = { getUSDtoBRL, getUSDtoBRLByDate };
