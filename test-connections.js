require('dotenv').config({ path: '.env.local' })
const fs = require('fs')

async function testMeta() {
  console.log('\n── Meta Ads ──────────────────────────')
  for (let i = 1; i <= 5; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`]
    const account = process.env[`META_AD_ACCOUNT_BM${i}`]
    if (!token || !account) continue

    try {
      const axios = require('axios')
      const res = await axios.get(
        `https://graph.facebook.com/v19.0/${account}`,
        { params: { fields: 'name,account_status,currency', access_token: token }, timeout: 15000 }
      )
      const d = res.data
      const status = d.account_status === 1 ? 'Ativa' : `Status ${d.account_status}`
      console.log(`  ✓ BM${i}: ${d.name} (${account}) — ${status} — moeda: ${d.currency}`)
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message
      console.log(`  ✗ BM${i} (${account}): ${msg}`)
    }
  }
}

async function testGAM() {
  console.log('\n── Google Ad Manager ─────────────────')
  const jsonPath = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON
  const targetNetwork = process.env.GOOGLE_ADM_NETWORK_CODE
  const GAM_VERSION = 'v202505'
  const NS = `https://www.google.com/apis/ads/publisher/${GAM_VERSION}`

  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.log(`  ✗ Arquivo JSON não encontrado: ${jsonPath}`)
    return
  }

  // Read service account email for display
  let saEmail = '(desconhecido)'
  try {
    saEmail = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).client_email
  } catch {}
  console.log(`  SA: ${saEmail}`)

  // 1. Authenticate
  let accessToken
  try {
    const { google } = require('googleapis')
    const auth = new google.auth.GoogleAuth({ keyFile: jsonPath, scopes: ['https://www.googleapis.com/auth/admanager'] })
    const client = await auth.getClient()
    const resp = await client.getAccessToken()
    accessToken = resp.token
    console.log('  ✓ OAuth token obtido')
  } catch (err) {
    console.log(`  ✗ Falha ao obter token: ${err.message}`)
    return
  }

  // 2. SOAP getAllNetworks — no networkCode in header (lists accessible networks)
  const getAllNetworksXML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="${NS}"
      soapenv:mustUnderstand="0">
      <ns1:applicationName>media-intelligence-test</ns1:applicationName>
    </ns1:RequestHeader>
  </soapenv:Header>
  <soapenv:Body>
    <getAllNetworks xmlns="${NS}"/>
  </soapenv:Body>
</soapenv:Envelope>`

  let networks = []
  try {
    const axios = require('axios')
    const res = await axios.post(
      `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/NetworkService`,
      getAllNetworksXML,
      {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 20000,
      }
    )
    // Parse networkCode + displayName from response XML
    const body = res.data
    const matches = [...body.matchAll(/<networkCode>(\d+)<\/networkCode>[\s\S]*?<displayName>(.*?)<\/displayName>/g)]
    networks = matches.map(m => ({ networkCode: m[1], displayName: m[2] }))

    if (networks.length === 0) {
      console.log('  ✗ getAllNetworks: service account não tem acesso a nenhuma rede GAM')
      console.log('    → Adicione o e-mail da SA como usuário no GAM (Admin → Usuários → Novo usuário)')
    } else {
      console.log(`  ✓ getAllNetworks: ${networks.length} rede(s) acessível(is)`)
      for (const n of networks) {
        const marker = n.networkCode === targetNetwork ? ' ← alvo' : ''
        console.log(`      • ${n.networkCode}: ${n.displayName}${marker}`)
      }
    }
  } catch (err) {
    const fault = String(err.response?.data || '').match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]
    console.log(`  ✗ getAllNetworks falhou: ${fault || err.message}`)
    return
  }

  // 3. Check if target network is in the list
  const found = networks.find(n => n.networkCode === targetNetwork)
  if (!found) {
    if (networks.length > 0) {
      console.log(`  ✗ Rede alvo ${targetNetwork} não está na lista — verifique GOOGLE_ADM_NETWORK_CODE`)
    }
    return
  }
  console.log(`  ✓ Rede ${targetNetwork} acessível: "${found.displayName}"`)

  // 4. Test report creation with the target network
  const today = new Date()
  const since = new Date(today); since.setDate(today.getDate() - 7)
  const fmt = d => `<year>${d.getFullYear()}</year><month>${d.getMonth()+1}</month><day>${d.getDate()}</day>`

  const reportXML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="${NS}"
      soapenv:mustUnderstand="0">
      <ns1:networkCode>${targetNetwork}</ns1:networkCode>
      <ns1:applicationName>media-intelligence-test</ns1:applicationName>
    </ns1:RequestHeader>
  </soapenv:Header>
  <soapenv:Body>
    <runReportJob xmlns="${NS}">
      <reportJob>
        <reportQuery>
          <dimensions>DATE</dimensions>
          <columns>AD_SERVER_IMPRESSIONS</columns>
          <columns>AD_SERVER_CPM_AND_CPC_REVENUE</columns>
          <startDate>${fmt(since)}</startDate>
          <endDate>${fmt(today)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery>
      </reportJob>
    </runReportJob>
  </soapenv:Body>
</soapenv:Envelope>`

  try {
    const axios = require('axios')
    const res = await axios.post(
      `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/ReportService`,
      reportXML,
      {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 20000,
      }
    )
    const jobId = res.data.match(/<id>(\d+)<\/id>/)?.[1]
    if (jobId) {
      console.log(`  ✓ Report job criado com sucesso — jobId: ${jobId}`)
      console.log('  ✓ GAM totalmente funcional')
    } else {
      console.log('  ✗ Report criado mas sem jobId na resposta')
    }
  } catch (err) {
    const fault = String(err.response?.data || '').match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]
    console.log(`  ✗ Criação de relatório falhou: ${fault || err.message}`)
  }
}

async function main() {
  console.log('=== Testando conexões ===')
  await testMeta()
  await testGAM()
  console.log('\n=== Concluído ===\n')
}

main().catch(console.error)
