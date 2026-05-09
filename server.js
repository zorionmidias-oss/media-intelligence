'use strict';
require('dotenv').config({ path: '.env.local' });
const express = require('express');
const path = require('path');

const metricsHandler = require('./src/app/api/metrics/route');
const insightsHandler = require('./src/app/api/insights/route');
const dashboardHandler = require('./src/app/api/dashboard/route');
const overviewHandler = require('./src/app/api/overview/route');
const reportsGamHandler = require('./src/app/api/reports-gam/route');
const supabase = require('./src/lib/supabase');
const { syncAll } = require('./src/lib/sync');
const { startScheduler } = require('./src/lib/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/lib/chart.umd.min.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.min.js')));

// ── Legacy live-API routes ──────────────────────────────────────────────────
app.get('/api/metrics', metricsHandler);
app.post('/api/insights', insightsHandler);

// ── Supabase-backed routes (fast — no external API calls) ──────────────────
app.get('/api/overview', overviewHandler);
app.get('/api/dashboard', dashboardHandler);
app.get('/api/reports-gam', reportsGamHandler);

// ── Domínios ────────────────────────────────────────────────────────────────
app.get('/api/dominios', async (req, res) => {
  const { data, error } = await supabase
    .from('dominios')
    .select('*')
    .order('nome');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/dominios', async (req, res) => {
  const { nome, prefixo_campanha, codigo_pedido_gam } = req.body || {};
  if (!nome || !prefixo_campanha) {
    return res.status(400).json({ error: 'nome e prefixo_campanha são obrigatórios' });
  }
  const { data, error } = await supabase
    .from('dominios')
    .insert({ nome, prefixo_campanha: prefixo_campanha.toUpperCase(), codigo_pedido_gam: codigo_pedido_gam || null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/dominios/pendentes', async (req, res) => {
  const { data, error } = await supabase
    .from('dominios_pendentes')
    .select('*')
    .eq('resolvido', false)
    .order('primeira_deteccao', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/dominios/aprovar', async (req, res) => {
  const { prefixo_detectado, nome, codigo_pedido_gam } = req.body || {};
  if (!prefixo_detectado || !nome) {
    return res.status(400).json({ error: 'prefixo_detectado e nome são obrigatórios' });
  }

  const { data: newDomain, error: insErr } = await supabase
    .from('dominios')
    .insert({
      nome,
      prefixo_campanha: prefixo_detectado.toUpperCase(),
      codigo_pedido_gam: codigo_pedido_gam || null,
      detectado_automaticamente: true,
    })
    .select()
    .single();

  if (insErr) return res.status(500).json({ error: insErr.message });

  await supabase
    .from('dominios_pendentes')
    .update({ resolvido: true })
    .eq('prefixo_detectado', prefixo_detectado);

  res.json(newDomain);
});

// ── Sync ─────────────────────────────────────────────────────────────────────
app.post('/api/sync/forcar', async (req, res) => {
  try {
    const result = await syncAll(req.body?.dateRange || undefined);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sync/log', async (req, res) => {
  const { data, error } = await supabase
    .from('sync_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Media Intelligence Dashboard running at http://localhost:${PORT}`);
  startScheduler();
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
