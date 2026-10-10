'use strict';
/* Kasbon dan cicilannya bisa diubah langsung (jumlah, tanggal, keterangan) tanpa dihapus dulu; aturan sisa dan
   minggu gaji yang sudah dibayar tetap dijaga server. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');

function app(data = {}) {
  const ctx = vm.createContext({});
  vm.runInContext(source + `
    var db={},config={},serial=0,version=1;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',nama:'Owner',divisi:'owner',aktif:true,token:'owner-token-123456789'},{id:'sewer01',nama:'Penjahit',divisi:'jahit',aktif:true,token:'sewer-token-123456789'}];
    db.Karyawan=[{id:'daily01',nama:'Harian',aktif:true}];
    Object.assign(db,JSON.parse(${JSON.stringify(JSON.stringify(data))}));
    var store={read:function(s){return db[s]||[];},append:function(s,r){db[s].push(r);version++;},appendMany:function(s,rs){db[s]=db[s].concat(rs);version++;},update:function(s,id,p){Object.assign(db[s].find(function(r){return r.id===id;}),p);version++;},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},replaceAll:function(s,r){db[s]=r;version++;},getSettings:function(){return config;},setSettings:function(s){config=s;version++;},version:function(){return version;},lock:function(fn){return fn();}};
    var core=createCore(store,{now:function(){return new Date('2026-10-10T08:00:00Z');},id:function(){return 'newid000'+(++serial);}});
  `, ctx);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
  return { run, call: (action, payload = {}, token = 'owner-token-123456789') => run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({ token, workflowVersion: 2, ...payload }))}))`),
    row: id => run(`db.Kasbon.find(function(r){return r.id===${JSON.stringify(id)};})`) };
}
const loan = (extra = {}) => ({ id: 'loan0001', tipe: 'kasbon', kasbonId: '', jenis: 'harian', orangId: 'daily01', nama: 'Harian', tanggal: '2026-07-25', periode: '', jumlah: 1600000, keterangan: 'Keperluan keluarga', asal: 'lama', ...extra });
const repay = (id, tanggal, jumlah, extra = {}) => ({ id, tipe: 'cicilan', kasbonId: 'loan0001', jenis: 'harian', orangId: 'daily01', nama: 'Harian', tanggal, periode: '2026-W41', jumlah, keterangan: '', asal: '', ...extra });
const salary = (periode, tanggal, lunas) => ({ id: 'g' + tanggal, periode, karyawanId: 'daily01', tanggal, status: 'full', gaji: 132000, jumlah: 132000, lunas: !!lunas });

test('a repayment is changed in place: amount, date and note; the remaining loan follows', () => {
  const a = app({ Kasbon: [loan(), repay('repay001', '2026-10-10', 200000)], GajiHarian: [salary('custom-2026-10-05-2026-10-10', '2026-10-05', false)] });
  const out = a.call('ubahKasbon', { id: 'repay001', jumlah: 150000, tanggal: '2026-10-09', keterangan: 'salah ketik', expectedJumlah: 200000 }).data;
  assert.equal(out.jumlah, 150000); assert.equal(out.tanggal, '2026-10-09'); assert.equal(out.keterangan, 'salah ketik'); assert.equal(out.periode, '2026-W41');
  assert.equal(a.run('coreKasbon(db.Kasbon)[0].sisa'), 1450000);
  assert.equal(a.run('db.Kasbon.length'), 2);
});

test('a repayment can never exceed what is left of the loan, and a stale form is refused', () => {
  const a = app({ Kasbon: [loan({ jumlah: 500000 }), repay('repay001', '2026-10-03', 300000), repay('repay002', '2026-10-10', 100000)] });
  assert.throws(() => a.call('ubahKasbon', { id: 'repay002', jumlah: 200001, tanggal: '2026-10-10' }), /melebihi sisa kasbon \(Rp 200\.000\)/);
  assert.equal(a.call('ubahKasbon', { id: 'repay002', jumlah: 200000, tanggal: '2026-10-10' }).data.jumlah, 200000);
  assert.throws(() => a.call('ubahKasbon', { id: 'repay002', jumlah: 50000, tanggal: '2026-10-10', expectedJumlah: 100000 }), /sudah berubah/);
  assert.throws(() => a.call('ubahKasbon', { id: 'repay002', jumlah: 0, tanggal: '2026-10-10' }), /Isi jumlahnya/);
  assert.throws(() => a.call('ubahKasbon', { id: 'repay002', jumlah: 1000, tanggal: '2026-02-31' }), /tanggal yang benar/);
  assert.throws(() => a.call('ubahKasbon', { id: 'tidakada1', jumlah: 1000, tanggal: '2026-10-10' }), /tidak ditemukan/);
});

test('the loan itself can be corrected, but not below what was already repaid', () => {
  const a = app({ Kasbon: [loan({ jumlah: 500000 }), repay('repay001', '2026-10-03', 300000)] });
  assert.throws(() => a.call('ubahKasbon', { id: 'loan0001', jumlah: 299999, tanggal: '2026-07-25' }), /kurang dari yang sudah dicicil \(Rp 300\.000\)/);
  const out = a.call('ubahKasbon', { id: 'loan0001', jumlah: 750000, tanggal: '2026-07-26', keterangan: 'Motor' }).data;
  assert.equal(out.jumlah, 750000); assert.equal(out.tanggal, '2026-07-26'); assert.equal(out.keterangan, 'Motor'); assert.equal(out.asal, 'lama'); assert.equal(out.tipe, 'kasbon');
  assert.equal(a.run('coreKasbon(db.Kasbon)[0].sisa'), 450000);
});

test('a salary week already marked paid is locked: its repayment cannot be changed or moved into it', () => {
  const paid = 'custom-2026-09-28-2026-10-03', open = 'custom-2026-10-05-2026-10-10';
  const a = app({ Kasbon: [loan(), repay('repayold', '2026-10-03', 100000, { periode: paid, asal: 'lama' }), repay('repaynew', '2026-10-10', 200000)], GajiHarian: [salary(paid, '2026-09-28', true), salary(open, '2026-10-05', false)] });
  assert.throws(() => a.call('ubahKasbon', { id: 'repayold', jumlah: 50000, tanggal: '2026-10-03' }), /sudah ditandai dibayar/);
  assert.throws(() => a.call('ubahKasbon', { id: 'repaynew', jumlah: 200000, tanggal: '2026-10-02' }), /minggu tujuan sudah ditandai dibayar/);
  assert.equal(a.row('repayold').jumlah, 100000); assert.equal(a.row('repaynew').tanggal, '2026-10-10');
  assert.equal(a.call('ubahKasbon', { id: 'repaynew', jumlah: 150000, tanggal: '2026-10-08' }).data.jumlah, 150000);
});

test('adjustment rows from the old app stay as they are, and only the owner or an admin may edit', () => {
  const a = app({ Kasbon: [loan(), repay('adjust01', '2026-10-01', 50000, { periode: 'penyesuaian', asal: 'lama' }), repay('repay001', '2026-10-10', 200000)] });
  assert.throws(() => a.call('ubahKasbon', { id: 'adjust01', jumlah: 10000, tanggal: '2026-10-01' }), /penyesuaian/);
  assert.throws(() => a.call('ubahKasbon', { id: 'repay001', jumlah: 10000, tanggal: '2026-10-10' }, 'sewer-token-123456789'), /owner\/admin/);
  assert.equal(a.row('repay001').jumlah, 200000);
});

test('a sewer or cutter loan repayment is edited the same way and follows its date', () => {
  const a = app({ Kasbon: [loan({ jenis: 'maklon', orangId: 'sewer01', nama: 'Penjahit' }), repay('repay001', '2026-10-03', 100000, { jenis: 'maklon', orangId: 'sewer01', periode: '2026-W40' })] });
  const out = a.call('ubahKasbon', { id: 'repay001', jumlah: 120000, tanggal: '2026-10-09' }).data;
  assert.equal(out.jumlah, 120000); assert.equal(out.periode, '2026-W41');
});
