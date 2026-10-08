#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--check', '--server-only', '--help']);
const unknown = [...args].filter((arg) => !allowed.has(arg));

if (unknown.length) {
  console.error('Argumen tidak dikenal: ' + unknown.join(', '));
  process.exitCode = 1;
} else if (args.has('--help')) {
  console.log('node scripts/build-core.cjs [--check] [--server-only]');
  console.log('--check: periksa output tanpa menulis file.');
  console.log('--server-only: buat/periksa apps-script/Core.gs dan Index.html tanpa menulis index.html PWA.');
} else {
  try {
    build();
  } catch (error) {
    console.error('Build gagal: ' + error.message);
    process.exitCode = 1;
  }
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function source(relative) {
  return read(relative).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd();
}

function uniqueMarker(html, pattern, label) {
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error('Harus ada tepat satu penanda ' + label + ' di index.html; ditemukan ' + matches.length + '.');
  }
  return matches[0].index;
}

function browserOutput(html, core) {
  const start = uniqueMarker(html, /^\/\* =+\r?\n[ \t]+CORE\b/gm, 'CORE');
  const end = uniqueMarker(html, /^\/\* =+\r?\n[ \t]+UI bagian 1\b/gm, 'UI bagian 1');
  if (end <= start) throw new Error('Penanda UI harus berada setelah CORE.');
  // Browser HTML tetap satu file; hanya blok core dan konverter yang diganti.
  const newline = html.includes('\r\n') ? '\r\n' : '\n';
  return html.slice(0, start) + core.replace(/\n/g, newline) + html.slice(end);
}

function appsScriptHtml(html) {
  const hosted = 'window.PK_HOSTED = true;';
  if (html.split(hosted).length !== 2) throw new Error('Penanda PK_HOSTED untuk paket Apps Script tidak unik.');
  let output = html.replace(hosted, "window.PK_HOSTED = false; window.PK_DIV = '__PK_DIV__';");
  output = output.replace('<head>', '<head>\n<base target="_top">');
  // Asset PWA disajikan GitHub Pages, bukan endpoint HtmlService di iframe Apps Script.
  output = output.replace(/^<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*>\r?\n/gm, '');
  output = output.replace(/^<script>[^\r\n]*document\.getElementById\('pk-manifest'\)[^\r\n]*<\/script>\r?\n/gm, '');
  output = output.replace(/^<script>[^\r\n]*navigator\.serviceWorker\.register\('sw\.js'\)[^\r\n]*<\/script>\r?\n/gm, '');
  return output;
}

function build() {
  const sources = ['src/core.js', 'src/import-legacy-v1.js', 'src/import-backup.js', 'src/reconcile-legacy.js', 'src/migration-actions.js', 'src/history-corrections.js', 'src/auto-completion.js', 'src/slip-models.js', 'src/bahan-invoice.js', 'src/cutting-plans.js', 'src/legacy-cutting.js'];
  const core = sources.map(source).join('\n\n') + '\n\n';
  // Parse saja, jangan menjalankan kode aplikasi saat build/check.
  new vm.Script(core, { filename: 'combined-core.js' });
  // Kontrak global Apps Script terdiri dari core dan adaptor asli, masing-masing satu salinan.
  new vm.Script(core + '\n' + source('apps-script/Server.gs'), { filename: 'apps-script-server.js' });
  if (/<\/script\b/i.test(core)) throw new Error('Core memuat penutup script literal yang tidak aman untuk HTML inline.');

  const header = '// Dibuat oleh scripts/build-core.cjs dari modul logika dalam src/.\n' +
    '// Jangan edit output ini; lihat README untuk memperbarui project Apps Script yang sudah ada.\n' +
    '// Berisi logika murni saja, bukan adaptor Google Sheets atau endpoint web app.\n\n';
  const browser = browserOutput(read('index.html'), core);
  const outputs = [
    { file: 'apps-script/Core.gs', content: header + core },
    { file: 'apps-script/Index.html', content: appsScriptHtml(browser) }
  ];
  if (!args.has('--server-only')) {
    outputs.push({ file: 'index.html', content: browser });
  }

  // Susun dan validasi semua output sebelum menulis satu pun.
  const stale = outputs.filter((output) => {
    // Checkout Git di Windows dapat memakai CRLF; isi core harus tetap sama.
    try { return read(output.file).replace(/\r\n/g, '\n') !== output.content.replace(/\r\n/g, '\n'); }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  });
  if (args.has('--check')) {
    if (stale.length) {
      console.error('Output belum sesuai sumber: ' + stale.map((output) => output.file).join(', '));
      console.error('Jalankan npm run build, lalu commit output bersama sumbernya.');
      process.exitCode = 1;
    } else {
      console.log('Core browser/server sesuai sumber. Tidak ada file yang ditulis.');
    }
    return;
  }
  for (const output of stale) {
    const target = path.join(root, output.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output.content, 'utf8');
    console.log('Dibuat: ' + output.file);
  }
  if (!stale.length) console.log('Output sudah sesuai sumber.');
}
