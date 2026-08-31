import assert from 'node:assert';
import { BRL, NUM, PCT, SIGNPCT } from '../src/lib/format.js';

assert.equal(BRL(12480), 'R$ 12.480');
assert.equal(BRL(8870.4), 'R$ 8.870');
assert.equal(NUM(1234), '1.234');
assert.equal(PCT(71.1), '71,1%');
assert.equal(SIGNPCT(3.4), '+3,4%');
assert.equal(SIGNPCT(-8), '−8,0%');
console.log('format ok');
