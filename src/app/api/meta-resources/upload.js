'use strict';
const multer = require('multer');
const axios  = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas imagens jpg/png/gif/webp são aceitas'));
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

  const { account_id } = req.body || {};
  if (!account_id)
    return res.status(400).json({ error: 'UPLOAD_FAILED', detail: 'account_id é obrigatório' });
  if (!req.file)
    return res.status(400).json({ error: 'UPLOAD_FAILED', detail: 'arquivo de imagem não enviado' });

  const acctId = normalizeActId(account_id);

  const { data: conta } = await supabase.from('meta_accounts')
    .select('access_token').eq('ad_account_id', acctId).maybeSingle();
  if (!conta?.access_token)
    return res.status(400).json({ error: 'UPLOAD_FAILED', detail: 'Conta Meta não encontrada ou sem token' });

  const base64 = req.file.buffer.toString('base64');

  try {
    const r = await axios.post(
      `${META_BASE}/${acctId}/adimages`,
      { bytes: base64, access_token: conta.access_token },
      { timeout: 30000 }
    );

    const images = r.data?.images;
    if (!images) throw new Error('Resposta inesperada da API Meta');

    const entry = Object.values(images)[0];
    return res.json({ hash: entry.hash, url: entry.url || null });
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.message;
    console.error('[upload-image]', acctId, detail);
    return res.status(500).json({ error: 'UPLOAD_FAILED', detail });
  }
}

module.exports = handler;
