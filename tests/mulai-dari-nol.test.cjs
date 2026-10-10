'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* "Mulai dari nol": the owner empties the material stock before entering the real warehouse stock.
   Real Sheets adapter, cold request objects, invented fixtures only. */
const KATA = 'MULAI DARI NOL';
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, cutter = 'fixture-nol-cutter-token', admin = 'fixture-nol-admin-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'nolcutter0001',nama:'Fixture Cutter',divisi:'potong',aktif:true,token:'${cutter}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'noladmin00001',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('StokBahan',{id:'nol-stock-0001',jenis:'beli',tanggal:'2026-09-01',bahan:'Scuba Hitam',qty:228.05,satuan:'kg',rol:10,harga:78000,total:17787900,asal:'lama'});
    pkStore_().append('StokBahan',{id:'nol-stock-0002',jenis:'beli',tanggal:'2026-09-01',bahan:'Furing',qty:40,satuan:'meter',rol:1,harga:10000,total:400000,asal:'lama'});
    pkStore_().append('StokBahan',{id:'nol-stock-0003',jenis:'koreksi',tanggal:'2026-09-05',bahan:'Furing',qty:-45,satuan:'meter',alasan:'hilang',asal:'lama'});
  });`);
  function call(action, payload = {}, token = owner) { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, true, result.error);
    return result.data && result.data.data !== undefined ? result.data.data : result.data;
  }
  function bad(action, payload, pattern, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, false, 'operation must reject');
    if (pattern) assert.match(result.error, pattern); return result;
  }
  function raw(table) { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`); }
  const material = name => good('getState').stokRingkas.find(m => m.kunci === name);
  /* two itemised rolls and one bought roll; PO A is cut from a roll, PO B only has fabric set aside, PO C has nothing yet */
  const rolls = good('rinciStokRol', { id: 'nol-rinci-0001', bahan: 'Scuba Hitam', rolls: [{ qty: 25 }, { qty: 24 }] }).rows;
  good('saveInvoiceBahan', { invoice: { id: 'nol-invoice-001', invoice: 'FIXTURE-BON-1', tanggal: '2026-10-01', supplier: 'Fixture Store', items: [{ bahan: 'Katun Putih', satuan: 'kg', harga: 60000, rolls: [{ qty: 20, rollLabel: 'K1' }, { qty: 18.5, rollLabel: 'K2' }] }] } });
  good('savePOWithRencana', { po: { newId: 'nol-po-a-0001', nama: 'Fixture Dipotong', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['M'] }, rencana: { id: 'nol-plan-a-001', alokasiBahan: [{ stokId: rolls[0].id, qty: 25 }], catatan: '' } });
  const planA = good('getState').rencanaPotong.find(r => r.id === 'nol-plan-a-001');
  good('createPotong', { potong: { id: 'nol-cut-a-0001', rencanaId: planA.id, expectedRencanaRevision: planA.revision, ukuran: { M: 40 }, tanggal: '2026-10-09' } });
  good('savePOWithRencana', { po: { newId: 'nol-po-b-0001', nama: 'Fixture Siap Potong', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['L'] }, rencana: { id: 'nol-plan-b-001', alokasiBahan: [{ stokId: rolls[1].id, qty: 10 }], catatan: 'jatah' } });
  h.run(`pkStore_().lock(function(){
    pkStore_().append('PO',{id:'nol-po-c-0001',noPO:'PO-C',jenis:'stok',nama:'Fixture Belum Apa-apa',ukuran:'{"M":10}',total:10,status:'aktif',dibuat:'2026-10-01T00:00:00.000Z'});
    pkStore_().append('PO',{id:'nol-po-d-0001',noPO:'PO-D',jenis:'stok',nama:'Fixture Sudah Selesai',ukuran:'{"M":10}',total:10,status:'selesai',dibuat:'2026-09-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'nol-cut-old-01',poId:'nol-po-a-0001',userId:'nolcutter0001',tanggal:'2026-09-10',ukuran:'{"M":30}',total:30,bahan:'Scuba Hitam',kg:30,tarif:1000,dibuat:'2026-09-10T00:00:00.000Z',asal:'lama'});
  });`);
  return { h, owner, cutter, admin, call, good, bad, raw, material, rolls };
}

test('the preview counts what would change and writes nothing; only the owner may look or run', () => {
  const f = fixture(), stok = f.raw('StokBahan').length;
  f.bad('getPratinjauNol', {}, /owner/, f.admin); f.bad('mulaiDariNol', { yakin: KATA }, /owner/, f.admin); f.bad('mulaiDariNol', { yakin: KATA }, /owner/, f.cutter);
  f.bad('mulaiDariNol', {}, /Ketik MULAI DARI NOL/); f.bad('mulaiDariNol', { yakin: 'mulai dari nol' }, /Ketik MULAI DARI NOL/);
  const lihat = f.good('getPratinjauNol');
  assert.equal(lihat.pratinjau, true); assert.equal(lihat.rencana, 1, 'the fabric set aside for PO B'); assert.equal(lihat.rol, 3, 'one Scuba roll is already used up'); assert.equal(lihat.bahan, 3);
  assert.deepEqual(lihat.daftarPO.map(r => r.id).sort(), ['nol-po-b-0001', 'nol-po-c-0001']); assert.equal(lihat.po, 2);
  assert.deepEqual(lihat.daftarBahan.map(b => [b.nama, b.satuan, b.rol]).sort(), [['Furing', 'meter', 0], ['Katun Putih', 'kg', 2], ['Scuba Hitam', 'kg', 1]]);
  assert.equal(f.raw('StokBahan').length, stok); assert.equal(f.raw('RencanaPotong').find(r => r.id === 'nol-plan-b-001').status, 'siap');
  assert.equal(f.raw('PO').filter(r => r.status === 'aktif').length, 3); assert.equal(f.good('getState').settings.stokMulai, '');
});

test('every material and roll becomes zero, the list is clean, uncut POs leave the active list, and no history row is lost', () => {
  const f = fixture(), sebelum = { stok: f.raw('StokBahan'), potong: f.raw('Potong'), po: f.raw('PO').length, rencana: f.raw('RencanaPotong').length };
  const hasil = f.good('mulaiDariNol', { yakin: KATA });
  assert.equal(hasil.selesai, true); assert.equal(hasil.pratinjau, false); assert.equal(hasil.rencana, 1); assert.equal(hasil.rol, 3); assert.equal(hasil.bahan, 3); assert.equal(hasil.po, 2);
  const state = f.good('getState');
  assert.deepEqual(state.stokRingkas.map(m => [m.nama, m.saldo, m.sembunyi]).sort(), [['Furing', 0, true], ['Katun Putih', 0, true], ['Scuba Hitam', 0, true]]);
  assert.ok(state.stokRol.every(r => r.saldo === 0 && r.dicadangkan === 0), 'every roll is empty and nothing is set aside');
  assert.match(state.settings.stokMulai, /^\d{4}-\d{2}-\d{2}$/); assert.deepEqual(state.settings.poSembunyi.slice().sort(), ['nol-po-b-0001', 'nol-po-c-0001']);
  const po = f.raw('PO'); assert.equal(po.length, sebelum.po);
  assert.deepEqual(po.map(r => [r.id, r.status]).sort(), [['nol-po-a-0001', 'aktif'], ['nol-po-b-0001', 'batal'], ['nol-po-c-0001', 'batal'], ['nol-po-d-0001', 'selesai']]);
  const rencana = f.raw('RencanaPotong'); assert.equal(rencana.length, sebelum.rencana);
  assert.equal(rencana.find(r => r.id === 'nol-plan-b-001').status, 'batal'); assert.equal(rencana.find(r => r.id === 'nol-plan-b-001').catatan, 'jatah'); assert.equal(rencana.find(r => r.id === 'nol-plan-a-001').status, 'siap', 'a used preparation is left as it is');
  /* purchases, itemised rolls and cut records are exactly as before; only correction rows were added */
  const stok = f.raw('StokBahan'), lama = stok.filter(r => sebelum.stok.some(x => x.id === r.id));
  assert.deepEqual(lama, sebelum.stok); assert.deepEqual(f.raw('Potong'), sebelum.potong);
  const baru = stok.filter(r => !sebelum.stok.some(x => x.id === r.id));
  assert.ok(baru.length >= 5 && baru.every(r => r.jenis === 'koreksi' && r.alasan === 'stok_opname' && /^Mulai dari nol \d\d\/\d\d\/\d{4}/.test(r.catatan)));
  assert.equal(baru.filter(r => r.sourceStockId).length, 3); assert.ok(baru.filter(r => r.sourceStockId).every(r => r.saldoAfter === 0 && r.saldoBefore === -r.qty && r.sourceRevision));
  assert.equal(baru.find(r => r.bahan === 'Furing').qty, 5, 'a minus balance is brought up to zero');
  /* running it again finds nothing left to do */
  const lagi = f.good('mulaiDariNol', { yakin: KATA });
  assert.deepEqual([lagi.selesai, lagi.rencana, lagi.rol, lagi.bahan, lagi.po], [true, 0, 0, 0, 0]); assert.equal(f.raw('StokBahan').length, stok.length);
});

test('after the reset new stock shows its name again and can be set aside, and a backdated old cut does not pull the stock below zero', () => {
  const f = fixture(); f.good('mulaiDariNol', { yakin: KATA });
  f.good('saveInvoiceBahan', { invoice: { id: 'nol-invoice-002', invoice: 'STOK-AWAL', tanggal: f.good('getState').settings.stokMulai, supplier: '', items: [{ bahan: 'scuba hitam', satuan: 'kg', harga: 0, rolls: [{ qty: 30, rollLabel: 'Gudang 1' }] }] } });
  const scuba = f.material('scuba hitam'); assert.equal(scuba.saldo, 30); assert.equal(scuba.sembunyi, false); assert.equal(f.material('katun putih').sembunyi, true, 'other names stay hidden');
  const rol = f.good('getState').stokRol.find(r => r.rollLabel === 'Gudang 1'); assert.deepEqual([rol.saldo, rol.tersedia, rol.status], [30, 30, 'tersedia']);
  f.good('savePOWithRencana', { po: { newId: 'nol-po-e-0001', nama: 'Fixture PO Baru', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['M'] }, rencana: { id: 'nol-plan-e-001', alokasiBahan: [{ stokId: rol.id, qty: 12 }], catatan: '' } });
  assert.equal(f.good('getState').stokRol.find(r => r.id === rol.id).dicadangkan, 12);
  f.good('cocokkanStok', { id: 'nol-cocok-0001', bahan: 'Furing', fisik: 12 }); assert.deepEqual([f.material('furing').saldo, f.material('furing').sembunyi], [12, false]);
  f.good('saveStok', { stok: { id: 'nol-awal-00001', jenis: 'koreksi', bahan: 'Katun Putih', qty: 7.5, alasan: 'stok_awal' } }); assert.deepEqual([f.material('katun putih').saldo, f.material('katun putih').sembunyi], [7.5, false]);
  f.h.run(`pkStore_().lock(function(){pkStore_().append('Potong',{id:'nol-cut-old-02',poId:'nol-po-a-0001',userId:'nolcutter0001',tanggal:'2026-09-20',ukuran:'{"M":5}',total:5,bahan:'Katun Putih',kg:5,tarif:1000,dibuat:'2026-09-20T00:00:00.000Z'});});`);
  assert.equal(f.material('katun putih').saldo, 7.5, 'a cut dated before the reset no longer counts');
});

test('a long list of uncut POs is finished over several calls', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){ for (var i = 0; i < 30; i++) pkStore_().append('PO',{id:'nol-banyak-'+(100+i),noPO:'PO-B'+i,jenis:'stok',nama:'Fixture Banyak '+i,ukuran:'{"M":1}',total:1,status:'aktif',dibuat:'2026-10-02T00:00:00.000Z'}); });`);
  assert.equal(f.good('getPratinjauNol').po, 32);
  const satu = f.good('mulaiDariNol', { yakin: KATA }); assert.equal(satu.selesai, false);
  assert.equal(f.raw('PO').filter(r => r.status === 'batal').length, 25); assert.ok(f.good('getState').stokRingkas.every(m => m.saldo === 0), 'the stock is already empty after the first call');
  const dua = f.good('mulaiDariNol', { yakin: KATA }); assert.equal(dua.selesai, true); assert.equal(dua.po, 7);
  assert.equal(f.raw('PO').filter(r => r.status === 'aktif').length, 1); assert.equal(f.good('getState').settings.poSembunyi.length, 32);
});
