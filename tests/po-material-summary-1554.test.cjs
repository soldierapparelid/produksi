'use strict';
/* A presentation summary must not merge or modify the material ledger.
   Exercise the pure helper separately from stock and preparation mutations. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = html.indexOf('function poMaterialTotals(');
assert.ok(start >= 0, 'the PO material summary helper must exist');
const end = html.indexOf('\nfunction ', start + 1);
assert.ok(end > start, 'the helper must end before another function');

function ui() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), context);
  vm.runInContext(html.slice(start, end), context);
  return {
    context,
    run(plans) {
      context.fixturePlans = plans;
      return JSON.parse(JSON.stringify(vm.runInContext('poMaterialTotals(fixturePlans)', context)));
    }
  };
}
const material = (nama, qty, satuan = 'kg') => ({ nama, qty, satuan });
const plan = (id, status, materials, extra = {}) => ({ id, status, bahanList: materials, ...extra });
const expected = (nama, satuan, buckets = {}) => {
  const row = { nama, satuan, total: 0, siap: 0, terpakai: 0, menyiapkan: 0, perluDiperiksa: 0, ...buckets };
  row.total = Math.round((row.siap + row.terpakai + row.menyiapkan + row.perluDiperiksa) * 1000) / 1000;
  return row;
};

test('the old 150.8 kg and added 99.1 kg show one material with a clear used/ready split', () => {
  const result = ui().run([
    plan('old-scuba', 'terpakai', [material('Scuba Hitam', 150.8)]),
    plan('added-scuba', 'siap', [material('Scuba Hitam', 99.1)])
  ]);
  assert.deepEqual(result, [expected('Scuba Hitam', 'kg', { terpakai: 150.8, siap: 99.1 })]);
  assert.equal(result[0].total, 249.9);
});

test('same material spacing and case combine, while different fabrics and different units remain separate', () => {
  const result = ui().run([
    plan('material-1', 'terpakai', [material('Scuba Hitam', 10), material('Scuba Embos Hitam', 20)]),
    plan('material-2', 'siap', [material('  scuba   HITAM ', 5), material('SCUBA HITAM', 60, 'yard'), material('Scuba Hitam', 3, 'meter')]),
    plan('material-3', 'siap', [material('scuba hitam', 2, ' KG '), material('scuba hitam', 0.5, ' YARD ')])
  ]);
  assert.deepEqual(result, [
    expected('Scuba Hitam', 'kg', { terpakai: 10, siap: 7 }),
    expected('Scuba Embos Hitam', 'kg', { terpakai: 20 }),
    expected('SCUBA HITAM', 'yard', { siap: 60.5 }),
    expected('Scuba Hitam', 'meter', { siap: 3 })
  ]);
});

test('canceled plans are excluded and blocked or unfinished preparations never appear ready or consumed', () => {
  const result = ui().run([
    plan('used', 'terpakai', [material('Katun', 5)]),
    plan('ready', 'siap', [material('Katun', 7)]),
    plan('blocked', 'siap', [material('Katun', 11)], { legacyBlocked: 'Ukuran perlu diperiksa' }),
    plan('pending', 'menyiapkan', [material('Katun', 13)]),
    plan('canceled', 'batal', [material('Katun', 101), material('Kain batal', 9)]),
    plan('unknown', 'selesai', [material('Katun', 103)])
  ]);
  assert.deepEqual(result, [expected('Katun', 'kg', { terpakai: 5, siap: 7, perluDiperiksa: 11, menyiapkan: 13 })]);
  assert.equal(result[0].total, 36);
});

test('the authoritative material list is counted once even when roll and aggregate details repeat its quantities', () => {
  const materials = [material('Katun', 5), material('Kemeja', 60, 'yard')];
  const result = ui().run([
    plan('mixed-used', 'terpakai', JSON.stringify(materials), {
      alokasiBahan: [{ stokId: 'katun-roll', qty: 5 }],
      rincianRol: [{ bahan: 'Katun', qty: 5, satuan: 'kg' }],
      legacyBahanList: [material('Kemeja', 60, 'yard')],
      kg: 65
    }),
    plan('legacy-ready', 'siap', [{ nama: 'Katun', qty: 1 }])
  ]);
  assert.deepEqual(result, [
    expected('Katun', 'kg', { terpakai: 5, siap: 1 }),
    expected('Kemeja', 'yard', { terpakai: 60 })
  ]);
});

test('repeated plan IDs are counted once, but distinct plans and ID-less legacy records retain their amounts', () => {
  const original = plan('same-plan', 'terpakai', [material('Katun', 5)]);
  assert.deepEqual(ui().run([
    original, { ...original },
    plan('new-plan', 'siap', [material('Katun', 5)]),
    plan('', 'siap', [material('Katun', 2)]),
    plan('', 'siap', [material('Katun', 3)])
  ]), [expected('Katun', 'kg', { terpakai: 5, siap: 10 })]);
});

test('decimal quantities stay accurate and invalid or empty material entries do not create phantom totals', () => {
  assert.deepEqual(ui().run([
    plan('first', 'terpakai', [material('Kemeja', 0.1, 'yard'), material('', 100), material('Zero', 0)]),
    plan('second', 'terpakai', [material('Kemeja', 0.2, 'yard'), material('Negative', -5), material('Invalid', 'NaN')]),
    plan('third', 'siap', [material('Kemeja', '60.125', 'yard'), material('Infinite', Infinity)]),
    plan('fourth', 'siap', [])
  ]), [expected('Kemeja', 'yard', { terpakai: 0.3, siap: 60.125 })]);
});

test('building the summary does not alter source plans, statuses, material names, or stock quantities', () => {
  const plans = [
    plan('old', 'terpakai', [material('Scuba Hitam', 150.8)]),
    plan('new', 'siap', [material(' SCUBA HITAM ', 99.1)], { revision: 'revision-unchanged' }),
    plan('canceled', 'batal', [material('Scuba Hitam', 200)])
  ];
  const before = JSON.stringify(plans), session = ui();
  for (const p of plans) {
    p.bahanList.forEach(Object.freeze); Object.freeze(p.bahanList); Object.freeze(p);
  }
  Object.freeze(plans);
  const once = session.run(plans), twice = session.run(plans);
  assert.deepEqual(twice, once); assert.equal(JSON.stringify(plans), before);
  assert.deepEqual(session.run([]), []);
  assert.deepEqual(session.run(undefined), []);
});
