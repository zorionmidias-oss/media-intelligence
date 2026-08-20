'use strict';
// Helpers de fuso compartilhados (sync, drilldown, intraday por campanha).
// Re-bucketing horário Meta → dia/hora São Paulo. DST resolvido via IANA (luxon).
const { DateTime } = require('luxon');

// Offset (horas inteiras) de um IANA timezone numa data. Ex.: LA em PDT → -7.
function tzOffsetHours(dateStr, timezone) {
  const ref = new Date(`${dateStr}T12:00:00Z`);
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false })
      .formatToParts(ref).find(p => p.type === 'hour')?.value ?? '12',
    10,
  );
  return (localHour === 24 ? 0 : localHour) - 12;
}

// Converte uma linha horária Meta ("HH:MM:SS - HH:MM:SS") do fuso da conta para
// { dataBR, horaBR } no fuso Brasil. Retorna null se inválido.
function converterHoraParaBR(dateStr, horaField, accountTz) {
  const hh = (horaField || '').slice(0, 8);
  if (!hh || hh.length < 5) return null;
  const dt = DateTime.fromISO(`${dateStr}T${hh}`, { zone: accountTz });
  if (!dt.isValid) return null;
  const dtBR = dt.setZone('America/Sao_Paulo');
  return { dataBR: dtBR.toISODate(), horaBR: dtBR.hour };
}

module.exports = { tzOffsetHours, converterHoraParaBR };
