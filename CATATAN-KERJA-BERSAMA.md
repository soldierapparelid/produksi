# Catatan kerja bersama — Soldier Produksi

Untuk ChatGPT/Codex dan Claude yang bergantian mengerjakan aplikasi ini. **Baca seluruh berkas ini sebelum mengubah apa pun**, dan perbarui bagian "Keadaan sekarang" serta "Riwayat pekerjaan" setiap selesai.

Diperbarui: 31 Oktober 2026 oleh ChatGPT/Codex. Perbaikan acuan potong dan ongkos jahit HPP pada cabang `codex/hpp-cut-sewing-sync` dari `main` `cd44a96`; server 1.5.66 Versi 80 sudah terpasang.

## 1. Keadaan sekarang

- **Rilis 1.5.66 — hasil potong dan ongkos jahit HPP:** baris katalog impor tanpa riwayat potong tidak lagi menghalangi acuan produksi yang lengkap. Riwayat rusak atau hasil potong tanpa bahan tetap memerlukan pemeriksaan. Ongkos jahit otomatis tidak menganggap tarif kosong/nol sebagai jahit gratis; hanya mengikuti tarif positif yang seragam dari penugasan lain pada PO dan maklon yang sama. Tarif kosong dengan acuan berbeda, sumber tidak lengkap, atau identitas ganda tetap menahan perhitungan otomatis. Pilihan biaya manual nol tetap tersedia.
- **Tampilan dan validasi 1.5.66:** tarif otomatis tampil sebagai rupiah yang dibulatkan untuk dibaca, disertai sumber dan dasar rata-rata; perhitungan tetap memakai nilai tepat. Isian manual hanya muncul pada mode manual dan drafnya tetap ada saat berpindah mode. Build, pemeriksaan hasil build, dan **1.503 tes lulus**; alur otomatis/manual diuji di browser dengan data contoh. Tidak menulis perubahan ke data produksi, stok, upah, pembayaran, atau pengaturan usaha.
- **Pemasangan 1.5.66:** sebelum pemasangan, seluruh Kode/Core/Index cocok penuh dengan `main` `cd44a96`. Setelah disimpan dan dimuat ulang, seluruh sumber cocok dengan hasil build rilis; Kode/Maintenance tetap. Deployment yang sama diperbarui ke **Versi 80**, **31 Oktober 2026, 18.59 WIB**. Bootstrap **18.59 WIB** menjawab HTTP 200, `ok: true`, `appVersion: 1.5.66`, `needSetup: false`. Rakitan `20261031-hpp-cut-sewing-1566`; peluncuran tampilan melalui [PR #98](https://github.com/soldierapparelid/produksi/pull/98).

- **Rilis 1.5.65 — hingga 100 kelompok HPP:** batas saat simpan dan saat membaca konfigurasi sama-sama dinaikkan dari 20 menjadi 100. Kelompok ke-21 dan ke-100 tetap terbaca setelah disimpan/dimuat ulang; kelompok ke-101 ditolak tanpa menulis. Edit/bubarkan tetap tersedia saat mencapai batas. Pengaman ukuran sel konfigurasi 49.000 karakter tetap berlaku, sehingga konfigurasi yang sangat besar ditolak utuh sebelum menulis. Build, pemeriksaan hasil build, dan **1.485 tes lulus**; empat regresi tambahan terbukti gagal dengan batas lama. Tidak mengubah data usaha atau rumus biaya.
- **Pemasangan 1.5.65:** Core/Index tersimpan dimuat ulang dan cocok penuh dengan rilis. Kode/Maintenance tetap. Deployment yang sama diperbarui ke **Versi 79**, **31 Oktober 2026, 10.48 WIB**. Bootstrap **10.48 WIB** menjawab HTTP 200, `ok: true`, `appVersion: 1.5.65`, `needSetup: false`. Peluncuran tampilan melalui [PR #97](https://github.com/soldierapparelid/produksi/pull/97), rakitan `20261031-hpp-100-groups-1565`.
- **Pilihan anggota HPP:** model dengan series OFFLINE / OFFLINE- tidak ditawarkan sebagai anggota baru. Model reguler tetap tersedia termasuk riwayat PO. Anggota OFFLINE yang sudah tersimpan tetap terlihat saat mengatur kelompok agar dapat dilepas secara sengaja, tanpa hilang ketika hanya mengganti nama. Tidak menghapus PO, stok, atau data HPP. Build, pemeriksaan hasil build, dan **1.481 tes lulus**; pemeriksaan formulir memastikan filter series dan keutuhan anggota lama. Versi tetap **1.5.64**, rakitan `20261031-hpp-hide-offline-1564`; tidak perlu pemasangan server.

- **Pembaruan tampilan HPP:** klik kelompok, atur anggota, atau tentukan kain XL saat data diperbarui menunggu permintaan yang sedang berjalan lalu membuka formulir sekali. Klik berulang tidak menambah permintaan/formulir; perpindahan halaman, modal, sesi, atau peran membatalkan pembukaan tertunda. Versi cache yang rusak dapat diganti jawaban server sah, sedangkan data server terbaru tidak ditimpa versi lebih lama. Penjagaan revisi saat menyimpan tetap berlaku.
- **Validasi pembaruan tampilan:** build, pemeriksaan hasil build, dan **1.481 tes lulus** (8 regresi baru). Kasus muat ulang lalu klik kelompok berhasil direproduksi di aplikasi; perbaikan diuji di browser memakai data contoh dan pemuatan tertunda. Tidak mengubah perhitungan HPP maupun data usaha. Versi tetap **1.5.64**, rakitan `20261031-hpp-refresh-ready-1564`; server tidak perlu dipasang ulang.

- **Perbaikan 1.5.64:** label XL saja tidak lagi cukup sebagai acuan kelompok. Hanya pasangan kain dan ongkos potong XL yang lengkap, jumlah pcs sama dan positif, biaya sah, serta tanpa masalah sumber masuk ke pembilang dan pembagi. Anggota XL yang belum lengkap mengikuti acuan sah; tidak menghalangi biaya kelompok. Beberapa acuan lengkap tetap dirata-rata tertimbang. Nama dan pcs acuan aktif tampil langsung; catatan anggota pengikut dilipat dan tetap disertakan dalam ekspor. Pengaturan kelompok dan data produksi/stok/upah tidak diubah.
- **Validasi 1.5.64:** build, pemeriksaan hasil build, dan **1.473 tes lulus**. Server Kode/Core/Index sebelum pemasangan cocok penuh dengan `main` `ca44d15` (1.5.63). Core/Index rilis dimuat ulang dan cocok penuh setelah disimpan. Deployment yang sama diperbarui ke **Versi 78** pada **31 Oktober 2026, 09.02 WIB**, tanpa mengubah URL/akun/akses. Bootstrap **09.03 WIB** menjawab HTTP 200, `ok: true`, `appVersion: 1.5.64`, `needSetup: false`.
- **Koreksi catatan sebelumnya:** pemilihan rol acuan XL untuk catatan campuran sudah dilakukan melalui formulir setelah konfirmasi pemilik pada 30 Oktober. Masalah lanjutan pada kelompok berasal dari acuan XL anggota lain yang belum lengkap; diperbaiki pada 1.5.64.

- **Rilis sebelumnya 1.5.63; GitHub Pages melalui PR #93:** cabang `codex/hpp-acuan-xl-siap` dari `main` `107c8a9`, rakitan `20261030-hpp-retur-1563`. HPP kelompok memakai satu atau lebih acuan XL lengkap tanpa menunggu anggota lain; biaya anggota yang belum lengkap tidak mencemari rata-rata. Owner dapat menetapkan rol XL untuk catatan lama yang mencampur beberapa ukuran melalui **Tentukan kain XL**, dengan pilihan dan konfirmasi eksplisit. Aksi `saveCommerceHppXLReference` hanya mengubah konfigurasi HPP dan memeriksa revisi sumber; PO, stok, potong, upah, dan pembayaran tidak diubah. Status saat PR #93 dibuat: pemilihan rol asli masih menunggu konfirmasi; sudah ditindaklanjuti sebelum perbaikan 1.5.64.
- **Kecepatan HPP:** prefetch tabel secara berkelompok, tanpa lookup pembelian pada halaman HPP, serta respons simpan `withState` memakai hasil hitungan yang sama. Pengujian cache menurunkan pembacaan dari 26 menjadi paling banyak 4; penyimpanan tidak lagi membutuhkan permintaan pemuatan halaman kedua. Angka ini jumlah panggilan pada pengujian, bukan pengukuran waktu jaringan produksi.
- **Retur admin:** owner dan admin dapat membuka menu/aksi retur; pekerja produksi tetap ditolak. Alur utama menjadi terima paket (cari/scan), impor, dan laporan belum kembali. Kondisi, jumlah fisik, dan bukti berada pada formulir penerimaan; klaim diringkas dalam bagian opsional. Cache 30 detik terikat sesi/endpoint, respons lama diabaikan setelah sesi berubah, dan unggahan mengunci isian serta hanya memperbarui modal pemiliknya.
- **Validasi rilis sebelumnya 1.5.63:** build, pemeriksaan hasil build, dan **1.465 tes lulus**. Sebelum pemasangan, seluruh sumber Kode/Core/Index server dibandingkan setelah normalisasi LF dan cocok dengan `main` `107c8a9` (1.5.62). Setelah pemasangan Versi 77, seluruh sumber tersimpan dimuat ulang dan cocok dengan rilis 1.5.63, termasuk penjagaan sesi sesudah pembacaan/kompresi file bukti. Kedua regresi perpindahan sesi/endpoint terbukti gagal sebelum perbaikan dan lulus sesudahnya. Tidak ada perubahan pada data produksi atau pilihan rol asli.

- **Rilis terpasang sebelumnya; peluncuran tampilan melalui [PR #92](https://github.com/soldierapparelid/produksi/pull/92):** cabang `codex/kelompok-hpp` dari `main` `0777ad1` menambahkan kelompok HPP pilihan owner. Kain/potong memakai total biaya XL dibagi total hasil XL anggota; anggota tanpa acuan XL mengikuti kelompok. Jahit, biaya lain, dan margin diatur sekali. Bahan tebal/pengerjaan berbeda tetap dipilih terpisah. Satu baris kelompok pada daftar dan Excel/PNG, pencarian nama anggota, edit/bubarkan, serta pengamanan perubahan sesi/revisi tersedia. Pengaturan individual dan data produksi tetap utuh. Versi **1.5.62**, rakitan `20261030-kelompok-hpp-1562`. Build dan **1.424 tes lulus** (30 tes baru); alur browser dengan data contoh termasuk HP, ekspor, perubahan anggota, pembubaran, dan keutuhan PO/stok/upah lulus. Pemilik menyetujui pemasangan dan pengaktifan pada 30 Oktober 2026. Server sudah dipasang sebagai deployment **Versi 75** pukul **20.29 WIB** dan diverifikasi setelah muat ulang. Peluncuran tampilan melalui [PR #92](https://github.com/soldierapparelid/produksi/pull/92) atas izin pemilik.

- Cabang `codex/invoice-dp` dari `main` `aba01da` menambahkan **Nota penjualan → Invoice DP / Invoice pelunasan → Cetak / Simpan PDF**. Dokumen A4 memuat nominal DP yang diisi atau seluruh sisa tagihan pelunasan secara otomatis, pelanggan, referensi nota, dan barang/ukuran tanpa harga. Total pesanan, harga satuan, catatan nota asli, dan riwayat pembayaran tidak dicetak. Mencetak tidak menulis pembayaran atau mengubah total/status nota; LUNAS mengikuti pembayaran yang benar-benar dicatat. Versi **1.5.61**, rakitan `20261030-invoice-dp-pelunasan-1561`. Build dan **1.394 tes lulus** (17 tes baru); contoh A4 dan tampilan HP diperiksa lewat browser terpisah. Pemilik mengizinkan penambahan dan pemasangan pada 30 Oktober 2026. Peluncuran tampilan melalui [PR #91](https://github.com/soldierapparelid/produksi/pull/91), sesuai izin pemasangan dari pemilik. Tidak perlu memasang server Apps Script.

- [PR #90](https://github.com/soldierapparelid/produksi/pull/90), cabang `codex/unduh-ringkasan-hpp`, menambahkan **Unduh ringkasan** pada HPP: Excel (.xlsx) seluruh hasil pencarian dan PNG per 6 model. Biaya kosong, perkiraan, acuan XL, dan status pemeriksaan dipertahankan. Rakitan tampilan `20261029-ringkasan-hpp-1561`; versi aplikasi tetap **1.5.61**, tanpa perubahan server atau data. Build dan **1.377 tes lulus**; pemeriksaan GitHub lulus. Pemilik menyetujui penggabungan dan pengaktifan melalui PR #90 pada 29 Oktober 2026.

- Rilis sebelumnya: server **1.5.61** dipasang pada 24 Oktober dengan izin pemilik. Cabang `codex/pulihkan-ukuran-riwayat` berasal dari `main` `35110db`; peluncuran tampilan GitHub Pages **1.5.61** dilakukan melalui [PR #89](https://github.com/soldierapparelid/produksi/pull/89). Build dan **1.366 tes lulus**, termasuk pengujian alur tampilan dengan data contoh.

- Versi server dan cabang rilis: **1.5.66**. `APP_VERSION` di `src/core.js` sama dengan `UI_VERSION` di `index.html`; server deployment **Versi 80** sudah diverifikasi.
- Rakitan tampilan terbaru: `20261031-hpp-cut-sewing-1566`. `window.PK_BUILD` di `index.html` sama dengan `RAKITAN` di `sw.js`.
- Dasar cabang: `main` `cd44a96` (31 Oktober 2026), cabang `codex/hpp-cut-sewing-sync`. Sebelum pemasangan, Kode/Core/Index dibandingkan seluruhnya setelah normalisasi LF dan cocok penuh dengan `main`. Setelah muat ulang, seluruh sumber cocok dengan hasil build 1.5.66; Kode/Maintenance tidak berubah.
- Server Apps Script: deployment yang sama diperbarui ke **Versi 80** (31 Okt 2026, **18.59 WIB**). Bootstrap **18.59 WIB** mengonfirmasi server 1.5.66. Salinan pemeriksaan privat di luar repo; jangan dipublikasikan.

Sidik berikut adalah **server 1.5.66 pada Versi 80** yang sudah dimuat ulang dan dibandingkan seluruhnya dengan sumber rilis cabang `codex/hpp-cut-sewing-sync`. Index server memakai rakitan `20261031-hpp-cut-sewing-1566`.

| Berkas di editor | Sumber di repo | Sidik (panjang + 16 huruf awal sha256, akhir baris LF) |
|---|---|---|
| Kode.gs | `apps-script/Server.gs` | 38162 d72ab735e5f1a288 |
| Core.gs | `apps-script/Core.gs` | 742243 81f0189ae9aeccf9 |
| Index.html | `apps-script/Index.html` | 1808686 4c49e55fabd2aca9 |
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
6. **Uji sebelum PR:** jalankan `node --test`. Semua harus lulus; rilis 1.5.63 sudah melewati 1.465 uji. Pakai Node 22 atau lebih baru.
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
- `src/commerce*.js`: Pembelian produk, Nota penjualan, HPP. `src/commerce-hpp.js` menyusun acuan XL/kelompok; `src/commerce.js` memvalidasi dan menyimpan pilihan rol HPP.
- `src/retur.js`: Retur paket; rilis 1.5.63 mengizinkan owner/admin dan tetap menolak akun pekerja.
- `apps-script/Server.gs`: adaptor Sheets, cache, kunci, `doPost`/`doGet`, jembatan, dan `env` (`makePdf`, bukti Drive).
- `sw.js`: cache halaman.
- `README.md`: catatan setiap rilis.

## 5. Retur paket, untuk melanjutkan rilis 1.5.63

- **Menu:** Lainnya > Admin > Retur paket. Rilis 1.5.63 memberi akses owner dan admin pada tampilan maupun semua aksi server; akun pekerja tetap ditolak. Dibuka lewat `A.returMenu`, dengan `S.sub.lain = 'retur'` lalu `returView()`.
- **Tampilan:** blok Retur paket di `index.html`, tepat sebelum "UI bagian 5". Tiga tindakan utama: **Terima paket**, **Impor Shopee / TikTok**, dan **Laporan belum kembali**. Penerimaan diawali pencarian/scan resi atau nomor pesanan; kondisi, jumlah fisik, dan unggah bukti tersedia dalam satu formulir. Rincian klaim bersifat opsional. Fungsi utama: `returView`, `returCariTerimaHtml`, `returBarisHtml`, `returImporHtml`, `returDetailHtml`, `returTerimaHtml`, `returBuktiHtml`, `returLaporanHtml`, `returCsvSel`, `returXlsx`.
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
- **Pemuatan dan unggah:** cache daftar dipakai 30 detik pada sesi/endpoint yang sama, dengan muat ulang manual. Cache tidak menyeberang sesi. Form penerimaan dikunci selama unggah; jawaban lama tidak mengganti modal lain setelah pengguna menutupnya. Jumlah awal dapat mengikuti rincian pesanan; pengguna tetap harus memeriksa dan menyesuaikannya dengan barang fisik sebelum menyimpan.
- **Status:** perubahan diuji dengan data contoh; server 1.5.63 Versi 77 terpasang dan terverifikasi, termasuk penjagaan sesi unggah terakhir. Belum ada pengujian penerimaan dengan data asli.

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

- Acuan kain XL pada catatan lama gabungan ukuran: tunggu pemilik memilih/menegaskan rol yang benar. Jangan menebak pembagian kain atau mengubah produksi/stok untuk memenuhi HPP.
- Paket tiga etalase (folder Codex `2026-10-14\bu\outputs\SOLDIER-3-ETALASE-UNTUK-CLAUDE-20261019`): belum dikerjakan.
- Cetak resi di website toko (WooCommerce) belum menampilkan jasa kirim: belum diperiksa.
- Database aplikasi lama: aturan aksesnya perlu dikunci, atau dihapus sendiri oleh pemilik setelah ekspor cadangan.
- Retur paket: uji pertama dengan data asli dilakukan oleh pemilik.

## 8. Riwayat pekerjaan (entri terbaru di atas)

- 2026-10-31 · ChatGPT/Codex · 1.5.66 · Perbaiki katalog impor kosong yang menahan acuan potong sah, pertahankan pemeriksaan riwayat rusak, dan cegah tarif jahit kosong/nol menurunkan rata-rata. Tarif kosong hanya mengikuti tarif positif seragam pada PO/maklon yang sama; sumber ambigu tetap menahan HPP otomatis. Tampilan otomatis dibulatkan tanpa mengubah hitungan, draf manual tetap tersimpan saat berganti mode. Build, pemeriksaan hasil build, dan **1.503 tes lulus**; alur browser memakai data contoh lulus. Kode/Core/Index sebelum pemasangan cocok penuh dengan `main` `cd44a96`, dan sumber rilis cocok penuh setelah muat ulang; Kode/Maintenance tetap. Server **Versi 80**, **18.59 WIB**; bootstrap **18.59 WIB** mengonfirmasi HTTP 200, `ok: true`, `appVersion: 1.5.66`, `needSetup: false`. Cabang `codex/hpp-cut-sewing-sync`, rakitan `20261031-hpp-cut-sewing-1566`; peluncuran tampilan melalui [PR #98](https://github.com/soldierapparelid/produksi/pull/98). Tidak mengubah data usaha.

- 2026-10-31 · ChatGPT/Codex · 1.5.65 · Naikkan batas kelompok HPP 20 → 100 pada simpan dan baca sesuai permintaan pemilik. Regresi 21/100 tersimpan dan dibuka ulang, penolakan 101 tanpa perubahan, edit/bubarkan saat penuh, serta batas sel konfigurasi diuji. Build, pemeriksaan hasil build, dan **1.485 tes lulus**. Core/Index tersimpan cocok penuh setelah muat ulang, Kode/Maintenance tetap. Server **Versi 79**, 10.48 WIB; bootstrap mengonfirmasi 1.5.65. Cabang `codex/hpp-100-groups` dari `bff025f`, rakitan `20261031-hpp-100-groups-1565`; peluncuran melalui [PR #97](https://github.com/soldierapparelid/produksi/pull/97). Tidak mengubah data usaha.

- 2026-10-31 · ChatGPT/Codex · 1.5.64 (tampilan) · Sembunyikan model series OFFLINE dari pilihan anggota baru kelompok HPP sesuai permintaan pemilik. Anggota lama tetap bisa dilepas tanpa penghapusan diam-diam saat edit. Build, pemeriksaan hasil build, dan **1.481 tes lulus**; pemeriksaan formulir dengan data contoh lulus. Cabang `codex/hpp-hide-offline` dari `c4e561d`, rakitan `20261031-hpp-hide-offline-1564`; peluncuran melalui [PR #96](https://github.com/soldierapparelid/produksi/pull/96) sesuai permintaan pemilik. Server tetap Versi 78 dan data usaha tidak berubah.

- 2026-10-31 · ChatGPT/Codex · 1.5.64 (tampilan) · Hilangkan siklus permintaan muat ulang ketika tombol kelompok diklik saat pemuatan berjalan. Formulir menunggu satu permintaan bersama; klik berulang, navigasi, sesi/peran, versi cache rusak, dan penolakan versi mundur diuji. Build, pemeriksaan hasil build, dan **1.481 tes lulus**. Uji browser dengan pemuatan tertunda berhasil membuka kelompok dan kelompok baru. Cabang `codex/hpp-refresh-ready` dari `783f2c2`, rakitan `20261031-hpp-refresh-ready-1564`; peluncuran melalui PR cabang tersebut atas izin pemasangan yang sudah diberikan pemilik. Server tetap Versi 78; data usaha tidak diubah.

- 2026-10-31 · ChatGPT/Codex · 1.5.64 · Perbaiki kelompok HPP yang masih kosong saat anggota berlabel XL mempunyai kain/potong belum lengkap: hanya pasangan acuan lengkap dan cocok yang masuk rata-rata. Anggota lain mengikuti, catatan tetap tersedia, dan nama/pcs acuan aktif tampil langsung. Delapan regresi tambahan; build, pemeriksaan hasil build, dan **1.473 tes lulus**. Baseline server cocok dengan `main` `ca44d15`; sumber rilis tersimpan cocok penuh setelah muat ulang. Server **Versi 78**, 09.02 WIB; bootstrap 09.03 WIB mengonfirmasi 1.5.64. Cabang `codex/hpp-hanya-acuan-lengkap`, rakitan `20261031-hpp-acuan-lengkap-1564`; peluncuran tampilan melalui PR cabang tersebut. Tidak mengubah data produksi, stok, upah, atau pengaturan kelompok.
- 2026-10-30 · ChatGPT/Codex · 1.5.63 · HPP kelompok cukup satu acuan XL lengkap; pilihan rol XL eksplisit untuk catatan lama, khusus HPP tanpa mengubah produksi/stok/upah. Pembacaan cache diuji turun 26 → paling banyak 4 panggilan dan simpan mengembalikan halaman terbaru dari hitungan yang sama. Retur owner/admin disederhanakan menjadi cari/scan, kondisi/jumlah, bukti dalam formulir, impor, serta laporan; cache sesi dan penjagaan unggah/modal dipertahankan. Build, pemeriksaan hasil build, dan **1.465 tes lulus**. Cabang `codex/hpp-acuan-xl-siap` dari `107c8a9`, rakitan `20261030-hpp-retur-1563`. Baseline server 1.5.62 cocok dengan `main` sebelum pemasangan. Server final dipasang pada deployment **Versi 77**, **22.25 WIB**, dengan URL/akun/akses tetap; seluruh sumber penuh cocok setelah muat ulang, termasuk penjagaan sesi unggah terakhir. Bootstrap **22.26 WIB** mengonfirmasi HTTP 200, `ok: true`, `appVersion: 1.5.63`, `needSetup: false`. **Peluncuran tampilan GitHub Pages melalui [PR #93](https://github.com/soldierapparelid/produksi/pull/93) atas izin pemilik.** Pemilihan rol pada data asli belum dilakukan.

- 2026-10-30 · ChatGPT/Codex · 1.5.62 · Kelompok HPP dengan rata-rata tertimbang XL dan biaya bersama pilihan owner; pencarian anggota, ekspor satu baris per kelompok, serta pembubaran yang mempertahankan pengaturan individual. Build, pemeriksaan hasil build, dan **1.424 tes lulus**; QA browser dengan data contoh lulus. Cabang `codex/kelompok-hpp` dari `0777ad1`. Server dipasang ke deployment **Versi 75** pukul **20.29 WIB** atas izin pemilik, termasuk persetujuan khusus menyelaraskan Index lama dari merge PR #89 setelah selisih diperiksa. Core/Index tersimpan cocok seluruhnya dengan kandidat setelah muat ulang; Kode/Maintenance tetap. Bootstrap pukul **20.32 WIB** mengonfirmasi HTTP 200, `ok: true`, versi **1.5.62**, dan `needSetup: false`. Peluncuran tampilan melalui [PR #92](https://github.com/soldierapparelid/produksi/pull/92) atas izin pemilik.

- 2026-10-30 · ChatGPT/Codex · 1.5.61 (tampilan) · Invoice DP dan invoice pelunasan dari nota yang sama, cetak A4 / Simpan PDF hanya nominal tagihan tanpa total pesanan. Pelunasan otomatis sama dengan sisa terbaru; nominal terkunci. Validasi sesi/data sebelum cetak; tidak mencatat pembayaran. Build dan **1.394 tes lulus** (17 tes baru). Contoh cetak dan HP sudah diperiksa; pemilik meminta fitur ditambahkan dan dipasang. Cabang `codex/invoice-dp`; peluncuran melalui [PR #91](https://github.com/soldierapparelid/produksi/pull/91) atas izin pemilik. Server tetap.

- 2026-10-29 · ChatGPT/Codex · 1.5.61 (tampilan) · Unduh ringkasan HPP ke Excel (.xlsx) dan PNG dengan pencarian/cakupan yang sama, status biaya dan acuan produksi, serta pemeriksaan sesi/data sebelum unduh. Berkas Excel dibaca kembali dengan pembaca independen; unduhan dan PNG diuji di browser dengan data contoh. Build dan **1.377 tes lulus** (11 tes baru). [PR #90](https://github.com/soldierapparelid/produksi/pull/90), cabang `codex/unduh-ringkasan-hpp`, disetujui pemilik untuk digabung dan diaktifkan pada 29 Oktober 2026; pemeriksaan GitHub lulus. Tidak memerlukan pemasangan server.

- 2026-10-24 · ChatGPT/Codex · 1.5.61 · Koreksi owner untuk ukuran PO lama yang tertinggal: riwayat pembuka terpisah, antrean hitung, pemulihan penyimpanan, hitung sebagian/ulang, perlindungan stok/upah/HPP. Build dan 1.366 tes lulus; alur tampilan diuji dengan data contoh. Server Versi 74 dipasang pukul 15.35 WIB atas izin pemilik; sidik sebelum/sesudah pemasangan dan jawaban bootstrap sudah diverifikasi. Peluncuran tampilan GitHub Pages melalui [PR #89](https://github.com/soldierapparelid/produksi/pull/89).

- 2026-10-24 · Claude · 1.5.60 · Retur paket (owner) di dalam aplikasi, bukti di Google Drive; server Versi 73; PR #86 di-merge.
- 2026-10-16 s.d. 23 · ChatGPT/Codex · 1.5.45–1.5.59 · lihat README.
- 2026-10-12 s.d. 16 · Claude · 1.5.40–1.5.44 · lihat README.
