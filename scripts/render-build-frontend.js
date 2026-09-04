'use strict';
// Compila o frontend React (frontend/ → frontend/dist) SOMENTE no deploy do Render.
// Roda como `postinstall` do package.json raiz. Fora do Render (npm install local do
// dev) vira no-op, então instalar dependências na sua máquina NÃO dispara build.
//
// Por que --include=dev: o Render define NODE_ENV=production no build, e nesse modo o
// `npm ci` pula devDependencies. O Vite (compilador) é devDependency do frontend, então
// sem --include=dev ele não seria instalado e o build falharia.
//
// Deploy é atômico no Render: se este passo falhar, o site atual continua no ar.

if (!process.env.RENDER) {
  console.log('[render-build] fora do Render (RENDER não definido) — build do frontend pulado');
  process.exit(0);
}

const { execSync } = require('node:child_process');

console.log('[render-build] Render detectado — instalando deps do frontend e compilando...');
execSync('npm --prefix frontend ci --include=dev', { stdio: 'inherit' });
execSync('npm --prefix frontend run build', { stdio: 'inherit' });
console.log('[render-build] frontend compilado em frontend/dist');
