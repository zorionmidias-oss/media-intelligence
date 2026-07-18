'use strict';
// Datas do NEGÓCIO são sempre no fuso de São Paulo. new Date().toISOString()
// é UTC — a partir das 21h BRT o "hoje" UTC já é amanhã, o que deslocava
// presets de data, sync e alertas. Usar SEMPRE estes helpers para "hoje".
const { DateTime } = require('luxon');
const TZ = 'America/Sao_Paulo';

function hojeBR() { return DateTime.now().setZone(TZ).toISODate(); }
function diasAtrasBR(n) { return DateTime.now().setZone(TZ).minus({ days: n }).toISODate(); }
function addDiasISO(iso, n) { return DateTime.fromISO(iso).plus({ days: n }).toISODate(); }

module.exports = { hojeBR, diasAtrasBR, addDiasISO, TZ };
