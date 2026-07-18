'use strict';
const { hojeBR, diasAtrasBR } = require('../../../lib/datas');
const { fetchGAMBotoesIndependente } = require('../../../lib/gam');

async function handler(req, res) {
  try {
    const { since, until, origem, pagina } = req.query;
    const now = hojeBR();
    const df = since || now;
    const dt = until || now;

    const result = await fetchGAMBotoesIndependente({
      since: df,
      until: dt,
      filtroOrigem: origem || null,
      filtroPagina: pagina || null,
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/funil-botoes]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

module.exports = handler;
