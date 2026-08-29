'use strict';
const crypto = require('crypto');
const supabase = require('../../../lib/supabase');
const SECRET = process.env.REVENUE_API_SECRET || '';

function safeEq(a, b) {
  const ba = Buffer.from(a || '', 'utf8'), bb = Buffer.from(b || '', 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function handler(req, res) {
  try {
    if (!SECRET || !safeEq(req.headers['x-api-key'], SECRET)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { campaign, since, until } = req.query;
    if (!campaign || !since || !until) return res.status(400).json({ error: 'campaign, since, until obrigatórios' });

    const { data, error } = await supabase
      .from('report_utm_campaign')
      .select('data,receita')
      .eq('utm_campaign', campaign).eq('dominio_id', 0)
      .gte('data', since).lte('data', until)
      .order('data');
    if (error) return res.status(500).json({ error: error.message });

    const byDay = {};
    for (const r of data || []) {
      const g = Number(r.receita || 0);
      byDay[r.data] = (byDay[r.data] || 0) + g;
    }
    const days = Object.entries(byDay).map(([date, gross]) => ({
      date, gross: +gross.toFixed(2), net: +(gross * 0.9).toFixed(2),
    }));
    const total_gross = +days.reduce((a, d) => a + d.gross, 0).toFixed(2);
    res.json({ campaign, currency: 'BRL', total_gross, total_net: +(total_gross * 0.9).toFixed(2), days });
  } catch (err) {
    console.error('[revenue-by-utm]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
