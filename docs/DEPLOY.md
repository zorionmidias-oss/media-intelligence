# Deploy no Render

## 1. Pré-requisitos
- Conta GitHub com este repositório
- Conta Render (login com GitHub)
- Variáveis do `.env.local` em mãos

## 2. Conectar repo
1. No Render: **New +** → **Web Service**
2. Conecte este repositório
3. Configure:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: **Free**

## 3. Configurar variáveis de ambiente
Em **Settings → Environment**, adicione todas as variáveis do `.env.example`:

| Variável | Observação |
|---|---|
| `GOOGLE_ADM_SERVICE_ACCOUNT_JSON_CONTENT` | Cole o conteúdo **completo** do JSON (não o caminho do arquivo) |
| `RENDER_EXTERNAL_URL` | Preencha após o primeiro deploy com a URL pública (ex: `https://media-intelligence.onrender.com`) |

## 4. Deploy
- Push para `main` ativa deploy automático
- Logs em tempo real no painel Render
- O cron de keep-alive pinga `/health` a cada 10 min para evitar cold start no plano free
