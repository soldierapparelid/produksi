# Soldier Produksi

Aplikasi produksi untuk owner/admin, tukang potong, maklon jahit, dan QC. Alur produksinya: PO → potong → penugasan jahit → setor → hitung/terima → QC → perbaikan bila perlu → stok gudang. Upah mengikuti jumlah yang berhak dibayar dari hitungan/QC; pencatatan BigSeller adalah administrasi terpisah. Stok bahan, gaji harian, kasbon, dan impor backup aplikasi lama berada di aplikasi yang sama.

## Struktur dan build

- `src/core.js`: skema, perhitungan, otorisasi, dan aksi data bersama.
- `src/import-backup.js`: konverter backup aplikasi lama menjadi struktur PO.
- `src/import-legacy-v1.js`: pengulangan konverter historis untuk membuktikan bahwa backup cocok dengan impor yang sudah tersimpan; tidak dipakai untuk impor baru.
- `src/reconcile-legacy.js`: pratinjau pemulihan hubungan sumber dan jembatan bukti pembayaran lama, dengan sidik SHA-256.
- `src/migration-actions.js`: aksi owner untuk pratinjau, penerapan, dan pemulihan cadangan jurnal.
- `src/history-corrections.js`: koreksi jumlah fisik riwayat oleh owner dengan jejak perubahan; sumber pembayaran tetap utuh.
- `index.html`: aplikasi browser, termasuk salinan hasil build core dan konverter. UI tetap diedit di file ini, di luar blok `CORE` sampai sebelum `UI bagian 1`.
- `apps-script/Core.gs`: hasil build core dan konverter yang sama untuk project Google Apps Script.
- `apps-script/Server.gs`: adaptor Google Sheets dari project Apps Script Soldier Produksi yang dibaca pada 8 Oktober 2026; memuat endpoint, pemetaan kolom, lock, cache, dan PDF. Tidak memuat ID spreadsheet, deployment, atau kredensial.
- `apps-script/Index.html`: hasil build UI untuk file `Index.html` pada Apps Script, memakai `PK_DIV`, `<base target="_top">`, dan transport `google.script.run`. Aset PWA tetap dilayani oleh GitHub Pages.
- `sw.js` dan `manifest*.webmanifest`: tampilan PWA dan pintasan per divisi.
- `scripts/build-core.cjs`: menyatukan sumber dan memeriksa kesesuaian output tanpa dependency tambahan.

Gunakan Node.js 22 atau lebih baru. Tidak perlu `npm install`; build dan pengujian hanya memakai modul bawaan Node.

```sh
npm run build
npm run check
npm test
```

`build` memperbarui **file lokal** `index.html`, `apps-script/Core.gs`, dan `apps-script/Index.html`. Build tidak menjalankan aplikasi, tidak menghubungi server, tidak menulis Google Sheets, dan tidak melakukan deployment. Commit hasil build bersama perubahan sumber. Jangan mengedit salinan core atau UI langsung di output Apps Script karena build berikutnya akan menggantinya.

`check` hanya membaca dan memeriksa sintaks/kesesuaian output; perintah keluar dengan status gagal jika output hilang atau tertinggal. `node scripts/build-core.cjs --server-only` membuat `Core.gs` dan `Index.html` di folder `apps-script` tanpa mengubah `index.html` PWA; tambahkan `--check` untuk memeriksa output server saja tanpa menulis. Workflow GitHub Actions menjalankan `check` dan pengujian pada push dan pull request, tanpa melakukan deployment Apps Script.

## Aturan alur produksi

- Setiap PO adalah satu siklus produksi. Ukuran/SKU dihitung terpisah; target kerja bersumber dari hasil potong, atau penugasan untuk data lama yang memenuhi validasi.
- Laporan penjahit berstatus menunggu sampai hitung fisik diterima. Jumlah bagus dan reject harus dirinci per ukuran dan tidak boleh melebihi sisa penugasan pekerja, termasuk laporan yang masih menunggu.
- QC untuk suatu ukuran terbuka setelah seluruh penugasan ukuran itu sudah dihitung: jumlah bagus sama dengan target dikurangi reject jahit, tanpa sisa penugasan atau laporan tertunda. Ukuran lain boleh masih berjalan.
- Satu pemeriksaan menghabiskan seluruh hitungan pada ukuran slip yang dipilih: **OK + offline + perbaikan + reject** harus tepat jumlah sumber. Catatan QC selalu menunjuk slip hitung fisik asal; reject seluruhnya berarti nol hasil OK.
- Sebelum QC, hitungan yang diterima menjadi dasar upah. Sesudah QC, hanya hasil OK yang layak diupah. Hasil perbaikan OK menambah hak upah pada tanggal penyelesaiannya dengan tarif sumber. Snapshot slip pembayaran tetap tersimpan; selisih lebih bayar ditandai untuk diperiksa, bukan dihapus atau dibayar ulang.
- Gudang terbentuk sebagai proyeksi hasil QC dan hasil perbaikan, sehingga pengiriman ulang transaksi tidak menggandakan penerimaan. Pencatatan BigSeller adalah langkah pembukuan berikutnya dan dibatasi stok OK yang belum dicatat. PO dapat selesai ketika produksi/QC/perbaikan tuntas meskipun pencatatan BigSeller belum selesai.
- Riwayat legacy dapat berisi QC manual tanpa tautan hitung fisik dan gudang manual. Keduanya dipertahankan sebagai bukti legacy, tanpa membuat hitungan fisik palsu. Input baru mengikuti kontrak versi 2. Hubungan batch lama hanya dipulihkan bila memenuhi aturan unik dua arah dari aplikasi sumber.
- Catatan BigSeller lama yang melebihi bukti stok ditandai untuk pemeriksaan pembukuan; masalah pembukuan tersebut tidak memblokir hitung fisik atau QC yang sah. Input BigSeller baru tetap dibatasi barang OK yang belum dicatat.
- Data lama yang jumlah atau hubungan sumbernya belum pasti ditahan untuk diperiksa. Pemeriksaan QC ulang atas hitungan baseline yang ambigu tidak dibuka; sumber baru yang berbeda tetap diproses menurut aturan versi 2.

## Memulihkan impor v1 yang sudah dipakai

Owner membuka **Lainnya → Pulihkan hubungan riwayat produksi** dan memilih backup JSON asli. Pratinjau membuktikan hasil pengulangan konverter v1 cocok dengan baris produksi saat ini; gambar, PIN, konfigurasi perangkat, dan modul yang tidak diperlukan tidak dikirim. Pratinjau tidak menulis data.

Nomor PO aktif dipertahankan. Catatan potong tetap sama. Laporan jahit lama yang sudah ditandai lunas disimpan sebagai snapshot dalam `LegacySettlement`, sedangkan `SlipSetor` yang dipulihkan berasal dari bukti hitung fisik asli. `SlipUpah` tidak ditulis ulang; cetakan lama memakai sumber snapshot aslinya. Kredit lunas hanya berlaku pada daftar sumber baseline yang dibekukan. Pemetaan yang belum pasti menahan pembayaran sumber terkait tanpa menganggapnya sudah lunas; input baru dengan identitas lain tidak mewarisi kredit tersebut. Penerimaan kemudian atas laporan pending baseline tetap terikat pada pemeriksaan pembayaran lamanya.

PO aktif yang belum dapat dipulihkan disimpan utuh dengan keterangan pemeriksaan. Arsip selesai dipertahankan sebagai riwayat baca saja. Pemulihan tidak mengarang jumlah, menciptakan pembayaran baru, atau menghapus ketidaksesuaian historis.

Penerapan menghitung ulang rencana di server dan menolak pratinjau kedaluwarsa. Semua tabel divalidasi sebelum penulisan produksi pertama. `MigrasiJournal` menyimpan seluruh baris sebelum perubahan beserta sidiknya. Bila layanan terputus di tengah penerapan, penyimpanan transaksi ditahan sampai owner memilih **Pulihkan data sebelum proses**. Pemulihan jurnal dapat diulang jika layanan kembali terputus. Salinan spreadsheet sebelum rilis tetap diperlukan: jurnal bukan transaksi atomik Google Sheets dan tidak mencegah pengeditan manual langsung pada spreadsheet.

## Koreksi jumlah riwayat oleh owner

Pada PO aktif yang masih ditandai perlu pemeriksaan, owner dapat memilih **Koreksi jumlah lama** di detail PO. Pilih catatan potong atau penugasan jahit, isi jumlah per ukuran berdasarkan catatan asli, lalu jelaskan alasan koreksi. Jumlah awal tetap terlihat dan perubahan disimpan dalam `KoreksiRiwayat` bersama waktu, pengguna, serta nilai sebelum dan sesudah. Penyimpanan menolak isian yang telah kedaluwarsa.

Koreksi mengubah jumlah fisik yang ditampilkan dan diperiksa pada alur produksi. Baris potong/penugasan asli, slip pembayaran, tarif, dan perhitungan upah historis tidak ditulis ulang. Koreksi tidak membuat upah tambahan dan tidak menandai pemeriksaan PO selesai; hubungan hitung fisik atau QC yang masih hilang tetap memerlukan bukti sumber. Jumlah yang belum diketahui dibiarkan seperti semula sampai owner mengisinya.

## Sambungan ke data pusat

Browser dapat memakai `google.script.run.api(...)` saat disajikan oleh Apps Script, atau mengirim aksi ke web app Google Apps Script berakhiran `/exec`. Data pusat dirancang disimpan di Google Sheets oleh adaptor server yang sudah ada. Mode coba memakai penyimpanan perangkat.

`Server.gs` mempertahankan adaptor yang diamati pada project asli. Perubahan penyimpanan yang ditambahkan: nilai lebih dari 49.000 karakter ditolak sebelum penulisan baris (JSON snapshot tidak dipotong), patch divalidasi sebelum mengubah cache, dan cache dipisahkan menurut versi aplikasi serta fingerprint nama/tipe kolom. Impor memvalidasi kapasitas seluruh tabel dan pengaturan yang akan ditulis sebelum perubahan pertama, termasuk saat pratinjau. Kolom dibaca berdasarkan header; kolom baru ditambahkan di kanan tanpa memindahkan kolom lama, dan nilai pada kolom tambahan pengguna dipertahankan saat update/replace baris yang ID-nya sama.

Tes integrasi memakai adaptor asli dengan mock Sheets yang meniru rentang fisik, header yang berpindah, kolom tambahan, properties, cache, dan lock. Tes mencakup round-trip JSON, penolakan snapshot terlalu panjang, impor yang gagal validasi tanpa perubahan sebagian, siklus hitung/QC/pembayaran, serta baca ulang antar-request. Ini bukan bukti bahwa deployment aktif sudah diperbarui atau seluruh perilaku layanan Google telah diuji langsung; preflight juga bukan transaksi atomik untuk gangguan layanan di tengah penulisan beberapa tabel.

## Memperbarui project Apps Script yang sudah ada

1. Simpan salinan project Apps Script, konfigurasi/deployment, dan spreadsheet yang sedang dipakai. Catat deployment aktif agar versi sebelumnya dapat dipulihkan. Gunakan salinan spreadsheet dan project uji untuk validasi awal.
2. Jalankan `npm run build`, `npm run check`, dan `npm test`. Periksa tiga file dalam `apps-script` yang akan dipasang. Bandingkan dengan project tujuan bila kode server di sana telah berubah sejak source dibaca.
3. Pada project uji yang sebelumnya menaruh core dan adaptor sekaligus dalam `Kode.gs`, **ganti seluruh isi `Kode.gs` dengan isi `apps-script/Server.gs`**. Nama file di editor boleh tetap `Kode.gs`. Tambahkan satu file `Core.gs` berisi hasil `apps-script/Core.gs`, lalu ganti isi file HTML `Index.html` dengan `apps-script/Index.html`. Jangan menyisakan core lama atau membuat `Server.gs` kedua di samping `Kode.gs` yang sudah memuat fungsi adaptor yang sama: semua `.gs` berbagi namespace. Hasil akhirnya satu adaptor, satu core, dan satu UI.
4. Pertahankan binding spreadsheet, properties, izin akses, serta konfigurasi deployment yang sudah sesuai. Adaptor menggunakan spreadsheet terikat melalui `getActiveSpreadsheet()`, bukan spreadsheet ID baru. Pada request pertama, `pkSetup_` menambahkan tab/kolom schema yang belum ada; uji terlebih dahulu pada salinan data.
5. Uji round-trip baca/tulis pada **salinan data**, login/otorisasi tiap divisi, hitung fisik parsial, QC per ukuran, reject penuh, perbaikan, pembayaran sebelum/sesudah QC, dan pengiriman ulang transaksi. Pastikan slip pembayaran lama tetap terbaca serta BigSeller tidak menggandakan gudang.
6. Periksa pratinjau konverter terhadap backup yang hendak dipindahkan. Tidak ada impor otomatis saat build atau deployment. Bila ada hubungan sumber yang ambigu, selesaikan pemeriksaan data sebelum menerapkan impor.
7. Setelah validasi project uji selesai, pasang tiga file yang sama ke project tujuan menggunakan prosedur deployment yang berlaku. Perbarui versi deployment Apps Script yang memang dipakai link `/exec`; menyimpan kode editor saja belum memperbarui deployment versi tetap. Pastikan respons state memuat `workflowVersion: 2` dan UI/PWA memakai versi yang sesuai. Publikasi GitHub Pages hanya memperbarui halaman/PWA; publikasi itu tidak memperbarui project Apps Script.

Pemasangan kode tidak menjalankan impor atau memindahkan catatan aplikasi lama secara otomatis. Penyesuaian schema saat aplikasi diakses dapat menambahkan tab/kolom; karena itu backup dan pengujian salinan dilakukan lebih dahulu. Jangan mengasumsikan data aplikasi lama tersinkron langsung dengan aplikasi ini.
