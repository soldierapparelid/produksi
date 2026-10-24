# Catatan kerja bersama — Soldier Produksi

Untuk ChatGPT/Codex dan Claude yang bergantian mengerjakan aplikasi ini. **Baca seluruh berkas ini sebelum mengubah apa pun**, dan perbarui bagian "Keadaan sekarang" serta "Riwayat pekerjaan" setiap selesai.

Diperbarui: 24 Oktober 2026 oleh ChatGPT/Codex, setelah pemasangan server 1.5.61.

## 1. Keadaan sekarang

- Server **1.5.61** sudah dipasang dengan izin pemilik. Cabang `codex/pulihkan-ukuran-riwayat` berasal dari `main` `35110db`; PR belum dibuka. Tampilan GitHub Pages masih **1.5.60** sampai cabang ini digabung. Build dan **1.366 tes lulus**, termasuk pengujian alur tampilan dengan data contoh.

- Versi server dan cabang rilis: **1.5.61**. `APP_VERSION` di `src/core.js` sama dengan `UI_VERSION` di `index.html`.
- Rakitan halaman cabang rilis: `20261024-pulihkan-ukuran-1561`. `window.PK_BUILD` di `index.html` sama dengan `RAKITAN` di `sw.js`.
- `main` saat pemasangan: commit `35110db` (merge catatan kerja PR #87); rilis aplikasi sebelumnya `beae3f7` (merge PR #86).
- Server Apps Script: deployment **Versi 74** (24 Okt 2026, 15.35 WIB). Sidik editor awal sudah cocok dengan `main` sebelum perubahan; Core dan Index yang disimpan kembali sudah diperiksa dan cocok dengan cabang rilis di atas. Pemeriksaan `bootstrap` menjawab HTTP 200, `ok: true`, `appVersion: 1.5.61`.

| Berkas di editor | Sumber di repo | Sidik (panjang + 16 huruf awal sha256, akhir baris LF) |
|---|---|---|
| Kode.gs | `apps-script/Server.gs` | 38162 d72ab735e5f1a288 |
| Core.gs | `apps-script/Core.gs` | 715693 d00bb3e435e0dc59 |
| Index.html | `apps-script/Index.html` | 1721244 a83d9641a6d352b1 |
| Maintenance.gs | tidak ada di repo, jangan diubah | 136 373dd791f45fca0e |

- Tampilan: GitHub Pages `https://soldierapparelid.github.io/produksi/`. **Repo ini publik.**
- Data: Google Sheet produksi (nama tab mengikuti `SCHEMA` di `src/core.js`). Bukti retur disimpan di Google Drive pemilik, folder "Soldier Retur - Bukti".

## 2. Aturan supaya tidak saling menimpa (wajib)

1. **Satu pekerjaan, satu alat.** Sebelum mulai, ambil `main` terbaru dan baca "Riwayat pekerjaan". Jangan bekerja dari ZIP atau salinan lama.
2. **Cabang dan PR kecil dari `main` terbaru.** Unggah hanya berkas yang benar-benar berubah, jangan seluruh folder.
3. **Sebelum menempel kode ke editor Apps Script**, cocokkan sidik ketiga berkas editor dengan `apps-script/` di `main`. Kalau berbeda, **berhenti** dan laporkan ke pemilik: ada perubahan yang belum masuk repo.
4. **Nomor versi:**
   - Rilis yang mengubah server: naikkan `APP_VERSION` dan `UI_VERSION` bersama (1.5.61, dan seterusnya). **Pasang server dulu, baru buka PR.** Server menolak penyimpanan bila versi tampilan berbeda dengan versi server, dan pemilik biasanya merge dalam hitungan detik.
   - Perubahan tampilan saja (warna, teks, tata letak): versi **tetap**. Ganti hanya `PK_BUILD` dan `RAKITAN` dengan nilai yang sama. Server tidak perlu dipasang.
5. **Jangan edit `apps-script/Core.gs` atau `apps-script/Index.html` langsung.** Ubah `src/*.js` dan `index.html`, lalu jalankan `node scripts/build-core.cjs`. Pemeriksaannya: `node scripts/build-core.cjs --check`.
6. **Uji sebelum PR:** jalankan `node --test`. Semua harus lulus; saat ini ada 1.366 uji. Pakai Node 22 atau lebih baru.
7. **Akhir baris:** tiap berkas di repo memakai LF atau CRLF (ada yang campuran). Pertahankan akhir baris aslinya supaya diff PR hanya berisi baris yang diubah. Hati-hati dengan salinan dari `git archive` atau autocrlf.
8. **Setelah selesai**, tambahkan satu baris di "Riwayat pekerjaan" (tanggal, alat, versi, ringkasan, PR) dan perbarui "Keadaan sekarang" bila server dipasang.

## 3. Data dan keamanan

- Jangan menaruh PIN, token, ID/URL deployment (yang diawali `AKfyc`), atau angka usaha di repo maupun chat publik.
- Jangan menghapus atau mengganti data Sheet, menjalankan "Mulai dari nol", mengimpor ulang backup, atau menghitung ulang upah dan pembayaran lama tanpa permintaan jelas dari pemilik.
- Uji dengan data contoh: mode coba (`index.html` dengan `PK_HOSTED = false`) atau `tests/helpers/apps-script-harness.cjs`.
- Pemasangan server dan merge PR selalu atas izin atau klik pemilik.

## 4. Peta kode singkat

- `index.html`: aplikasi satu berkas (PWA), berisi:
  - CSS. Warna ada di `:root`: `--bg`, `--surface`, `--ink`, `--accent`, `--ok`, `--warn`, `--bad`, `--info`, dan lain-lain. Tema gelap ada di `@media (prefers-color-scheme: dark)`.
  - Blok CORE, dibangkitkan dari `src/`.
  - "UI bagian 1" sampai "UI bagian 6".
- `src/core.js`: daftar tab (`SCHEMA`), aturan alur produksi, aksi server (`actions.*`), daftar `WRITE`, `NO_STATE`, dan `GLOBAL_VERSION_WRITE`.
- `src/commerce*.js`: Pembelian produk, Nota penjualan, HPP.
- `src/retur.js`: Retur paket (1.5.60).
- `apps-script/Server.gs`: adaptor Sheets, cache, kunci, `doPost`/`doGet`, jembatan, dan `env` (`makePdf`, bukti Drive).
- `sw.js`: cache halaman.
- `README.md`: catatan setiap rilis.

## 5. Retur paket (1.5.60), untuk melanjutkan

- **Menu:** Lainnya > Admin > Retur paket. Khusus owner. Dibuka lewat `A.returMenu`, dengan `S.sub.lain = 'retur'` lalu `returView()`.
- **Tampilan:** blok "Retur paket (1.5.60, owner)" di `index.html`, tepat sebelum "UI bagian 5". Fungsi utamanya: `returView`, `returBarisHtml`, `returImporHtml`, `returDetailHtml`, `returTerimaHtml`, `returBuktiHtml`, `returLaporanHtml`, `returCsvSel`, `returXlsx`.
- **Warna status:** diatur di `returChip()`, memakai kelas `chip ok`, `chip warn`, `chip bad`, `chip info`. Selebihnya memakai kelas yang sudah ada: `card`, `list`, `item`, `seg`, `chip`, `note`, `btn`.
- **Aturan di `src/retur.js`:**
  - Impor: `coreReturPeriksa`. Paket baru: `coreReturKasusBaru`. Syarat diterima: `coreReturCekTerima`. Isian yang boleh diubah: `coreReturPatch`.
  - Aksi baca: `getReturState`, `getReturDetail`, `getReturBukti`.
  - Aksi tulis (`RETUR_WRITE`): `importRetur`, `saveRetur`, `catatReturTanpaResi`, `cocokkanRetur`, `unggahReturBukti`.
- **Tab Sheet:** `ReturKasus` (satu baris per paket, isi rinci di kolom `data` JSON), `ReturImpor`, `ReturEvent`, `ReturBukti` (`fileId` Google Drive).
- **Bukti:**
  - `pkEnv_()` di `Server.gs` menyediakan `simpanBukti`, `ambilBukti`, `buangBukti`, `alamatBukti`, `alamatFolder`.
  - ID folder induk disimpan di properti skrip `returFolder`. Izin Drive sudah diberikan pemilik (fungsi editor `siapkanFolderRetur`).
  - Batas 20 MB per berkas.
- **Uji:** `tests/retur-impor.test.cjs`, `tests/retur-server.test.cjs`, `tests/ui-retur.test.cjs`.
- **Status:** sudah diuji di mode coba, belum dipakai dengan data asli.

## 6. Cara memasang

- **Tampilan saja:** buka PR ke `main`. Setelah merge, GitHub Pages memuat dalam ±1–2 menit. Pengguna menutup aplikasi lalu membukanya lagi.
- **Server:**
  1. Buka editor Apps Script dari Google Sheet produksi (Ekstensi > Apps Script).
  2. Cocokkan sidik (aturan 2.3).
  3. Salin `apps-script/Server.gs` ke Kode.gs, `apps-script/Core.gs` ke Core.gs, dan `apps-script/Index.html` ke Index.html. Simpan setiap berkas.
  4. Pilih Terapkan > Kelola deployment > ikon pensil (Edit) > Versi: **Versi baru** > isi deskripsi > Terapkan.
  5. Pengaturan "Jalankan sebagai: Saya" dan "Yang memiliki akses: Siapa saja" **jangan diubah**. **Jangan membuat deployment baru**, karena alamat aplikasi akan berubah.
  6. Pastikan aksi `bootstrap` menjawab `appVersion` yang baru, lalu buka PR.
- Bila kode memakai layanan Google baru, pemilik harus memberi izin sendiri dan mencentang **semua** kotak izin.

## 7. Pekerjaan yang belum selesai

- Paket tiga etalase (folder Codex `2026-10-14\bu\outputs\SOLDIER-3-ETALASE-UNTUK-CLAUDE-20261019`): belum dikerjakan.
- Cetak resi di website toko (WooCommerce) belum menampilkan jasa kirim: belum diperiksa.
- Database aplikasi lama: aturan aksesnya perlu dikunci, atau dihapus sendiri oleh pemilik setelah ekspor cadangan.
- Retur paket: uji pertama dengan data asli dilakukan oleh pemilik.

## 8. Riwayat pekerjaan (entri terbaru di atas)

- 2026-10-24 · ChatGPT/Codex · 1.5.61 · Koreksi owner untuk ukuran PO lama yang tertinggal: riwayat pembuka terpisah, antrean hitung, pemulihan penyimpanan, hitung sebagian/ulang, perlindungan stok/upah/HPP. Build dan 1.366 tes lulus; alur tampilan diuji dengan data contoh. Server Versi 74 dipasang pukul 15.35 WIB atas izin pemilik; sidik sebelum/sesudah pemasangan dan jawaban bootstrap sudah diverifikasi. PR belum dibuka; GitHub Pages masih 1.5.60 sampai merge.

- 2026-10-24 · Claude · 1.5.60 · Retur paket (owner) di dalam aplikasi, bukti di Google Drive; server Versi 73; PR #86 di-merge.
- 2026-10-16 s.d. 23 · ChatGPT/Codex · 1.5.45–1.5.59 · lihat README.
- 2026-10-12 s.d. 16 · Claude · 1.5.40–1.5.44 · lihat README.
