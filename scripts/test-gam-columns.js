require('dotenv').config({ path: '.env.local' });
const { fetchGAMReport, fetchGAMFunnelsByUTM } = require('../src/lib/gam');

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const since = '2026-05-04';
  console.log(`Fetching GAM report ${since} → ${today}...\n`);

  const r = await fetchGAMReport({ since, until: today });
  console.log('=== SUMMARY ===');
  console.log(JSON.stringify(r.summary, null, 2));
  console.log('\n=== AD UNITS (first 3) ===');
  console.log(JSON.stringify((r.adUnits || []).slice(0, 3), null, 2));

  console.log('\nFetching GAM UTM funnels...\n');
  const f = await fetchGAMFunnelsByUTM(null, { since, until: today });
  const byDayEntries = Object.entries(f.byDay || {});
  if (byDayEntries.length > 0) {
    const [lastDay, utms] = byDayEntries[byDayEntries.length - 1];
    console.log(`=== byDay SAMPLE (${lastDay}) ===`);
    const top3 = Object.entries(utms).slice(0, 3);
    console.log(JSON.stringify(Object.fromEntries(top3), null, 2));
  } else {
    console.log('byDay is empty — GAM UTM funnels returned no data');
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
