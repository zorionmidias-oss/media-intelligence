'use strict';
// Testa o endpoint /api/meta-resources/upload-image localmente
// Uso: node test-upload.js

const http = require('http');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mediaintel-2juniors-secret-change-in-prod';
const ACCOUNT_ID = 'act_24292507563699876';

// PNG 1x1 pixel
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const token = jwt.sign({ uid: 'test-user' }, JWT_SECRET, { expiresIn: '1h' });

  const form = new FormData();
  form.append('file', PNG_1X1, { filename: 'test.png', contentType: 'image/png' });
  form.append('account_id', ACCOUNT_ID);

  console.log('Enviando imagem para http://localhost:' + PORT + '/api/meta-resources/upload-image');
  console.log('account_id:', ACCOUNT_ID);
  console.log('image size:', PNG_1X1.length, 'bytes');

  const result = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: PORT, path: '/api/meta-resources/upload-image', method: 'POST',
        headers: { ...form.getHeaders(), 'Authorization': 'Bearer ' + token } },
      res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    form.pipe(req);
  });

  console.log('\n── RESPOSTA ──────────────────────────────');
  console.log('Status HTTP:', result.status);
  try {
    const json = JSON.parse(result.body);
    console.log('Body:', JSON.stringify(json, null, 2));
    if (json.hash) console.log('\n✅ SUCESSO — image_hash:', json.hash);
    else console.log('\n❌ ERRO —', json.error, ':', json.detail);
  } catch {
    console.log('Body (raw):', result.body);
  }
}

main().catch(e => console.error('THROW:', e.message));
