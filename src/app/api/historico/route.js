'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  try {
    const utm = req.params.utm;
    if (!utm) return res.status(400).json({ error: 'UTM é obrigatório' });

    const { data, error } = await supabase
      .from('historico_campanhas')
      .select('*')
      .eq('ad_utm', utm)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('[historico]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
