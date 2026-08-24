'use strict';
const axios=require('axios');const supabase=require('../src/lib/supabase');
const p=require('../src/lib/parser');
const BASE='https://graph.facebook.com/v19.0';
function extractPageToken(name,isAdset){const br=[...String(name||'').matchAll(/\[([^\]]*)\]/g)].map(m=>m[1].trim());
 if(!br.length)return null;const t=isAdset?(br[1]||br[0]):br[br.length-1];return t?t.toUpperCase():null;}
(async()=>{
 const {data:accs}=await supabase.from('meta_accounts').select('ad_account_id,nome,access_token').eq('ativo',true);
 const {data:doms}=await supabase.from('dominios').select('id,nome,prefixo_campanha').eq('ativo',true);
 console.log('domínios ativos:',doms.map(d=>`${d.prefixo_campanha}→${d.nome}`).join(', '),'\n');
 for(const acc of accs){
  let camps=[];
  try{const r=await axios.get(`${BASE}/${acc.ad_account_id}/campaigns`,
    {params:{access_token:acc.access_token,fields:'name,status',limit:200,effective_status:JSON.stringify(['ACTIVE'])}});
   camps=r.data.data||[];}catch(e){console.log(acc.nome,'ERRO',e.response?.data?.error?.message||e.message);continue;}
  if(!camps.length)continue;
  console.log(`### ${acc.nome} — ${camps.length} campanha(s) ativa(s)`);
  for(const c of camps.slice(0,4)){
   const est=p.extractEstrutura(c.name), pref=p.extractDomainPrefix(c.name);
   const pais=p.extractPaisSigla(c.name), nicho=p.extractNicho(null,c.name);
   const tok=extractPageToken(c.name,false);
   const domOk=doms.some(d=>String(d.prefixo_campanha||'').toUpperCase()===String(pref||'').toUpperCase());
   console.log(`  "${c.name}"`);
   console.log(`    estrutura=${est||'—'}  prefixo=${pref||'—'} ${domOk?'✓dominio':'✗SEM DOMINIO'}  pais=${pais||'✗VAZIO'}  nicho=${nicho||'✗NULL'}  tokenCampanha=${tok}`);
  }
  // um conjunto de exemplo
  try{const r2=await axios.get(`${BASE}/${acc.ad_account_id}/adsets`,
    {params:{access_token:acc.access_token,fields:'name',limit:3,effective_status:JSON.stringify(['ACTIVE'])}});
   for(const a of (r2.data.data||[])) console.log(`  CONJUNTO "${a.name}" → token=${extractPageToken(a.name,true)}  pais=${p.extractPaisSigla(a.name)||'✗VAZIO'}  nicho=${p.extractNicho(a.name,null)||'✗NULL'}`);
  }catch(e){}
  console.log('');
 }
})().catch(e=>console.error('FATAL',e.message));
