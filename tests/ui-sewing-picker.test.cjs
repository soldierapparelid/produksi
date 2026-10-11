'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('A.kirimPick = function');
const end = html.indexOf('A.setorPick = function', start);
function fixture(rows) {
  let picked, callback, message;
  const c = vm.createContext({ A: {}, poAktif: () => rows,
    T: p => ({ siapKirim: p.remaining }), pos: n => Math.max(0, Number(n) || 0),
    workflowFor: p => ({ complete: !!p.complete }),
    pickPO: (title, list, cb, empty) => { picked = list; callback = cb; message = empty; },
    openKirim: (po, worker) => { c.opened = { po, worker }; } });
  vm.runInContext(html.slice(start, end), c);
  c.A.kirimPick({ getAttribute: () => 'worker-a' });
  return { c, picked, callback, message };
}
test('sewing picker excludes zero, negative, completed and missing balances', () => {
  const rows = [{id:'empty',remaining:0},{id:'partial',remaining:30},{id:'done',remaining:20,complete:true},{id:'inconsistent',remaining:-10},{id:'missing'},{id:'ready',remaining:100}];
  const f = fixture(rows);
  assert.deepEqual(Array.from(f.picked, p => [p.id,p._n]), [['ready',100],['partial',30]]);
  assert.equal(rows.some(p => Object.hasOwn(p,'_n')), false);
  f.callback('partial');
  assert.deepEqual(f.c.opened, {po:'partial',worker:'worker-a'});
});
test('empty sewing queue explains that no cut pieces remain unassigned', () => {
  const f = fixture([{id:'done',remaining:0},{id:'uncut'}]);
  assert.equal(f.picked.length, 0);
  assert.match(f.message,/hasil potong.*ditugaskan ke jahit/);
});
