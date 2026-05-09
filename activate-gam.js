require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const axios = require('axios')
const { google } = require('googleapis')

const V   = 'v202505'
const NS  = `https://www.google.com/apis/ads/publisher/${V}`
const NC  = process.env.GOOGLE_ADM_NETWORK_CODE
const KEY = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON

function envelope(networkCode, body) {
  const ncTag = networkCode ? `<ns1:networkCode>${networkCode}</ns1:networkCode>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="${NS}" soapenv:mustUnderstand="0">
      ${ncTag}
      <ns1:applicationName>media-intelligence-activate</ns1:applicationName>
    </ns1:RequestHeader>
  </soapenv:Header>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`
}

async function soapCall(token, service, xml) {
  const url = `https://ads.google.com/apis/ads/publisher/${V}/${service}`
  console.log(`\n  → POST ${url}`)
  try {
    const r = await axios.post(url, xml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '',
        Authorization: `Bearer ${token}`,
      },
      timeout: 25000,
    })
    console.log(`  ← HTTP ${r.status}`)
    console.log(String(r.data))
    return { ok: true, status: r.status, body: String(r.data) }
  } catch (err) {
    console.log(`  ← HTTP ${err.response?.status ?? 'ERR'}`)
    console.log(String(err.response?.data ?? err.message))
    return { ok: false, status: err.response?.status, body: String(err.response?.data ?? err.message) }
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════════')
  console.log(' ACTIVATE GAM — SA activation attempt')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  SA  : ${JSON.parse(fs.readFileSync(KEY,'utf8')).client_email}`)
  console.log(`  Net : ${NC}`)

  // Token
  console.log('\n[0] Obtendo token OAuth...')
  const auth = new google.auth.GoogleAuth({ keyFile: KEY, scopes: [`https://www.googleapis.com/auth/admanager`] })
  const token = (await (await auth.getClient()).getAccessToken()).token
  console.log(`  token: ${token.slice(0,50)}…`)

  // ── 1. NetworkService.getAllNetworks (sem networkCode) ──────────────────
  console.log('\n══ [1] NetworkService.getAllNetworks — SEM networkCode ══')
  await soapCall(token, 'NetworkService', envelope(null, `<getAllNetworks xmlns="${NS}"/>`))

  // ── 2. NetworkService.getAllNetworks (COM networkCode) ──────────────────
  console.log('\n══ [2] NetworkService.getAllNetworks — COM networkCode ══')
  await soapCall(token, 'NetworkService', envelope(NC, `<getAllNetworks xmlns="${NS}"/>`))

  // ── 3. NetworkService.getCurrentNetwork (COM networkCode) ───────────────
  console.log('\n══ [3] NetworkService.getCurrentNetwork — COM networkCode ══')
  await soapCall(token, 'NetworkService', envelope(NC, `<getCurrentNetwork xmlns="${NS}"/>`))

  // ── 4. UserService.getCurrentUser (COM networkCode) ─────────────────────
  console.log('\n══ [4] UserService.getCurrentUser — COM networkCode ══')
  await soapCall(token, 'UserService', envelope(NC, `<getCurrentUser xmlns="${NS}"/>`))

  // ── 5. UserService.getCurrentUser (SEM networkCode) ─────────────────────
  console.log('\n══ [5] UserService.getCurrentUser — SEM networkCode ══')
  await soapCall(token, 'UserService', envelope(null, `<getCurrentUser xmlns="${NS}"/>`))

  // ── 6. UserService.getUsersByStatement (paginado, COM networkCode) ───────
  console.log('\n══ [6] UserService.getUsersByStatement — COM networkCode ══')
  await soapCall(token, 'UserService', envelope(NC,
    `<getUsersByStatement xmlns="${NS}">
       <filterStatement><query>LIMIT 5</query></filterStatement>
     </getUsersByStatement>`))

  console.log('\n══════════════════════════════════════════════════════')
  console.log(' FIM')
  console.log('══════════════════════════════════════════════════════\n')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
