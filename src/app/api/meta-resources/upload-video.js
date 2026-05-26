'use strict';
const multer   = require('multer');
const FormData = require('form-data');
const axios    = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
  fileFilter: (_req, file, cb) => {
    if (/^video\/(mp4|quicktime)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas vídeos mp4/mov são aceitos'));
  },
}).single('file');

function normalizeActId(v) {
  const s = String(v || '');
  return s.startsWith('act_') ? s : `act_${s}`;
}

async function handler(req, res) {
  await new Promise((resolve, reject) =>
    upload(req, res, err => (err ? reject(err) : resolve()))
  ).catch(err => {
    res.status(400).json({ error: 'UPLOAD_FAILED', detail: err.message });
    return null;
  });
  if (res.headersSent) return;

  const { account_id, title } = req.body || {};
  if (!account_id)
    return res.status(400).json({ error: 'UPLOAD_FAILED', detail: 'account_id é obrigatório' });
  if (!req.file)
    return res.status(400).json({ error: 'UPLOAD_FAILED', detail: 'arquivo de vídeo não enviado' });

  const acctId = normalizeActId(account_id);

  let conta;
  try {
    const { data, error } = await supabase.from('meta_accounts')
      .select('access_token').eq('ad_account_id', acctId).maybeSingle();
    if (error) {
      console.error('[upload-video] supabase error:', acctId, error.message);
      return res.status(500).json({ error: 'UPLOAD_FAILED', detail: 'Erro ao consultar conta Meta: ' + error.message });
    }
    conta = data;
  } catch (e) {
    console.error('[upload-video] supabase throw:', acctId, e.message);
    return res.status(500).json({ error: 'UPLOAD_FAILED', detail: 'Falha na conexão com banco: ' + e.message });
  }

  if (!conta?.access_token)
    return res.status(400).json({ error: 'UPLOAD_FAILED', detail: 'Conta Meta não encontrada ou sem token' });

  try {
    const form = new FormData();
    form.append('access_token', conta.access_token);
    if (title) form.append('title', title);
    form.append('source', req.file.buffer, {
      filename: req.file.originalname || 'video.mp4',
      contentType: req.file.mimetype,
    });

    const r = await axios.post(
      `${META_BASE}/${acctId}/advideos`,
      form,
      { headers: form.getHeaders(), timeout: 120000, maxContentLength: Infinity, maxBodyLength: Infinity }
    );

    const video_id = r.data?.id;
    if (!video_id) throw new Error('Resposta inesperada da API Meta — sem video id');

    return res.json({ video_id, title: title || req.file.originalname || null });
  } catch (e) {
    const metaStatus = e.response?.status;
    const detail = e.response?.data?.error?.message || e.message;
    console.error('[upload-video] meta error:', acctId, metaStatus, detail);
    return res.status(500).json({ error: 'UPLOAD_FAILED', detail });
  }
}

module.exports = handler;
