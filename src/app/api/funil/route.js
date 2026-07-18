'use strict';
const { hojeBR, diasAtrasBR } = require('../../../lib/datas');
const { fetchGAMBlocosFunil } = require('../../../lib/gam');

async function handler(req, res) {
  try {
    const { utm, since, until } = req.query;
    if (!utm) return res.status(400).json({ erro: 'utm é obrigatório' });

    const now = hojeBR();
    const df = since || now;
    const dt = until || now;

    const blocos = await fetchGAMBlocosFunil({ since: df, until: dt, utm });

    const totals = blocos.reduce(
      (acc, b) => ({
        impressoes: acc.impressoes + b.impressoes,
        cliques:    acc.cliques    + b.cliques,
        receita:    acc.receita    + b.receita,
      }),
      { impressoes: 0, cliques: 0, receita: 0 }
    );
    totals.receita = +totals.receita.toFixed(2);

    res.json({ utm, total_blocos: blocos.length, totals, blocos });
  } catch (err) {
    console.error('[/api/funil]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

module.exports = handler;
