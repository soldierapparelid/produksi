# Soldier Produksi

Aplikasi produksi untuk owner/admin, tukang potong, maklon jahit, dan QC. Alur produksinya: PO → potong → penugasan jahit → setor → hitung/terima → QC → perbaikan bila perlu → stok gudang. Upah mengikuti jumlah yang berhak dibayar dari hitungan/QC; pencatatan BigSeller adalah administrasi terpisah. Stok bahan, gaji harian, kasbon, dan impor backup aplikasi lama berada di aplikasi yang sama.

## Struktur dan build

- `src/core.js`: skema, perhitungan, otorisasi, dan aksi data bersama.
- `src/import-backup.js`: konverter backup aplikasi lama menjadi struktur PO.
- `src/import-legacy-v1.js`: pengulangan konverter historis untuk membuktikan bahwa backup cocok dengan impor yang sudah tersimpan; tidak dipakai untuk impor baru.
- `src/reconcile-legacy.js`: pratinjau pemulihan hubungan sumber dan jembatan bukti pembayaran lama, dengan sidik SHA-256.
- `src/migration-actions.js`: aksi owner untuk pratinjau, penerapan, dan pemulihan cadangan jurnal.
- `src/history-corrections.js`: koreksi jumlah fisik riwayat oleh owner dengan jejak perubahan; sumber pembayaran tetap utuh.
- `src/auto-completion.js`: penutupan otomatis PO setelah tujuh hari sejak produksi terverifikasi tuntas.
- `src/bahan-invoice.js`: pembelian beberapa bahan dalam satu invoice dan pengaman penyimpanan ulang.
- `src/cutting-plans.js`: persiapan kain oleh owner, pencadangan stok, dan validasi hasil potong.
- `src/legacy-cutting.js`: rencana pemulihan tambahan untuk ukuran dan jatah potong yang terbukti cocok dengan sumber impor sebelumnya; tidak mengganti buku produksi atau pembayaran.
- `src/slip-models.js`: rincian slip mingguan dan cetakan/PDF yang sama untuk browser dan server.
- `src/commerce.js`: supplier, produk pembelian, order, nota, buku pembayaran/penerimaan, dan model cetaknya.
- `src/commerce-hpp.js`: biaya per produk dan simulasi harga jual menurut basis biaya aplikasi lama.
- `src/commerce-migration.js`: pratinjau serta pemindahan data perdagangan/HPP lama dengan bukti sumber dan pemulihan pengiriman ulang.
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
- Antrean QC terbuka setelah **seluruh PO** selesai dijahit dan dihitung fisik, tanpa sisa penugasan, laporan tertunda, atau persiapan potong yang belum dipakai. Setoran parsial tetap menghasilkan slip hitung fisik dan tetap terlihat di tahap hitung fisik. Pemeriksaan QC kemudian dicatat per slip dan ukuran supaya hubungan sumbernya tetap tepat.
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

## Invoice bahan, persiapan potong, dan slip tim

- **Stok bahan → Pembelian** mencatat satu invoice yang berisi beberapa bahan dan berat setiap rol. Contohnya lima rol bahan A dan tiga rol bahan B dengan berat berbeda-beda: delapan rincian rol tetap terhubung ke satu invoice. Total berat dan nilai dihitung dari rinciannya; bahan dengan nama yang sama menurut kapital/spasi masuk ke stok bahan terdaftar yang sama. Satuan bahan tidak dicampur. Nomor invoice, supplier, tanggal, dan sumber bon berlaku untuk seluruh invoice.
- Rincian rol baru mempunyai identitas sumber yang tetap. Persiapan potong menyimpan rol sumber dan jumlah yang dialokasikan, sehingga rol yang sama tidak bisa dicadangkan melebihi sisa. Catatan lama tanpa rincian berat per rol tetap menjadi saldo lama; aplikasi tidak membagi rata atau menebak berat rol lama.
- Filter dan pencarian stok memakai kumpulan baris yang sama untuk kartu serta ringkasan. Saldo fisik dibedakan dari bahan yang dicadangkan untuk PO dan sisa yang tersedia dipakai. Perubahan filter memakai data yang sudah dimuat tanpa mengambil ulang seluruh data server.
- **Cocokkan fisik** dapat memilih satu rol sumber. Koreksi menyimpan saldo sebelum/sesudah dan alasan tanpa mengubah invoice asli atau membagikan selisih ke rol lain. Server memeriksa revisi sumber, riwayat koreksi, dan bahan yang sudah dicadangkan; formulir kedaluwarsa ditolak. Saldo lama tanpa identitas rol dicocokkan terpisah.
- Saat membuat PO, owner memilih barang/seri dan ukuran aktif, lalu menyiapkan bahan dari rol terdaftar atau saldo lama yang jumlahnya diketahui. PO baru tidak meminta target pcs: jumlah produksi berasal dari hasil potong. Pilihan M/L, misalnya, tetap menunggu ukuran L bila baru M yang dipotong; ukuran yang tidak dipilih tidak menambah antrean. Target historis pada PO lama tetap disimpan utuh. Satu persiapan dapat menggabungkan rol terdaftar dan bahan lama, misalnya kain badan dan kerah. Bahan tambahan untuk PO yang sudah ada tetap disiapkan melalui **Siapkan bahan potong** pada detail PO. Persiapan menahan ketersediaan; saldo fisik baru berkurang ketika hasil potong disimpan. Persiapan belum dipakai dapat diubah/dibatalkan, dengan pemeriksaan revisi agar formulir lama tidak menimpa perubahan baru.
- Pembuatan PO beserta persiapannya memakai ID tetap dan memvalidasi keduanya sebelum penulisan pertama. Jika layanan terputus setelah bahan dicadangkan tetapi sebelum PO tersimpan, owner melihat **Persiapan PO belum selesai** untuk melanjutkan atau membatalkan. Persiapan tersebut belum dapat dipotong. Ini pemulihan dua penulisan Sheets, bukan klaim transaksi atomik lintas tabel.
- Tukang potong hanya memilih pekerjaan siap dan mengisi hasil pcs per ukuran. Server mengambil bahan/kiloan/rol dari persiapan owner. Satu persiapan hanya dapat dipakai sekali, termasuk pengiriman ulang setelah respons terputus. Riwayat lama tetap disimpan.
- Admin membagi hasil potong ke maklon beserta jumlah dan target seperti sebelumnya. Form penugasan menampilkan jumlah dipotong, sudah ditugaskan, dan sisa per ukuran; isian awal mengikuti seluruh sisa dan dapat dikurangi untuk pembagian ke beberapa maklon. Antre jahit, sebagian selesai, menunggu hitung fisik, dan selesai memiliki label/warna. Semua setoran pekerja harus diterima melalui hitung fisik sebelum slip terbit dan upah tersedia.
- Tab **Sudah dipotong** memakai catatan potong pekerja, termasuk riwayat sebelum persiapan bahan diperkenalkan. PO yang belum dipotong tetapi belum mempunyai bahan siap tetap terlihat dengan keterangan menunggu owner. Bukti ukuran/rencana lama hanya dipulihkan dari backup yang cocok dengan sumber impor dan data saat ini; rujukan hilang atau pembagian bahan yang belum pasti ditampilkan untuk pemeriksaan, tanpa menebak konsumsi bahan atau menulis ulang pembayaran.
- Slip jahit dan potong mingguan memakai periode Senin–Minggu dengan rincian tanggal, PO, jumlah, tarif, dan hasil perbaikan. Pratinjau dan PDF menggunakan model yang sama; pembayaran historis tetap memakai snapshot. Cetak membuka pratinjau yang dapat dicoba kembali; unduhan PDF menyediakan tautan manual jika unduhan otomatis dibatasi browser.
- PO baru dapat menyertakan desain tersendiri dengan pratinjau. Gambar dikompresi di perangkat dan disimpan khusus pada PO tersebut.
- Koneksi yang terputus saat menyimpan ditampilkan sebagai hasil belum pasti. Aplikasi tidak mengulang perubahan otomatis. Invoice memakai ID baris yang stabil dan pemeriksaan data terbaru sebelum retry, sehingga respons hilang tidak menambah stok lagi.

## HPP, pembelian produk, dan nota penjualan

Owner/admin membuka tiga kartu **Produk dan penjualan** di bagian bawah Beranda, atau melalui menu Lainnya. Setiap halaman mengambil datanya ketika dibuka; data perdagangan tidak ditambahkan ke proses login. Setelah transaksi, hanya modul terkait dimuat ulang. Respons dari akun/sesi sebelumnya diabaikan. Pencarian dan filter memakai data yang sudah dimuat.

- **HPP produk** menampilkan bukti bahan, biaya potong, dan jahit per model. Biaya yang hilang diberi keterangan, bukan dianggap nol. Owner/admin memeriksa biaya, memilih tarif jahit otomatis/manual, biaya lain, serta margin sebelum menyimpan konfigurasi. HPP final dan simulator harga baru tersedia bila konfigurasi lengkap. Fee marketplace, biaya tetap per pcs, dan pajak dapat diatur; rekomendasi harga merupakan perhitungan dari konfigurasi tersebut. Potongan historis yang dikecualikan dari basis biaya tetap terlihat untuk ditinjau.
- **Pembelian produk** memiliki supplier, produk, order dengan variasi, DP awal, cicilan, dan penerimaan per item. DP awal disimpan bersama order; pembayaran dan penerimaan berikutnya menjadi catatan terpisah yang tidak ditimpa. Owner dapat membatalkan peristiwa melalui jejak koreksi; order yang mempunyai peristiwa aktif tidak langsung dibatalkan. Riwayat sumber yang tidak dapat dipetakan tetap berstatus **Perlu diperiksa**, dan penerimaan baru yang memerlukan pemetaan tersebut ditahan. Pembelian produk terpisah dari invoice stok bahan.
- **Nota penjualan** memuat pelanggan, barang, warna/ukuran, diskon item, diskon nota, ongkir, pembayaran, dan pelunasan. Nomor nota diterbitkan server dengan penghitung berurutan yang dipertahankan saat impor. Uang tunai yang diterima dan kembalian ditampilkan terpisah dari nilai pelunasan. Nota tidak otomatis mengurangi stok produksi atau menambahkan transaksi Kas.
- Detail order dan nota menyediakan cetak serta PDF dengan isi dari model yang sama. **Cetak gabungan** memilih paling banyak 20 order dari identitas supplier yang sama. Dokumen berisi halaman masing-masing order beserta nomor dan riwayat pembayarannya; tidak menggabungkan atau membagi ulang pembukuan uang. PDF memeriksa revisi order agar pilihan lama tidak mencetak data yang telah berubah.

Jika respons penyimpanan terputus, formulir mempertahankan ID permintaan dan menawarkan pemeriksaan data. Aplikasi tidak mengirim ulang pembayaran otomatis. Periksa hasil lebih dahulu, lalu ulangi permintaan yang sama hanya bila pemeriksaan membolehkannya.

### Memindahkan data perdagangan lama

Owner membuka **Periksa cadangan lama** pada halaman perdagangan, memilih backup utama, dan bila diperlukan backup Firebase sebagai referensi HPP/gambar. Jalankan pratinjau, tinjau jumlah dan peringatannya, baru terapkan. Server memeriksa sidik sumber/rencana dan mempertahankan ID pembayaran serta penerimaan. Proses ini tidak mengganti data produksi. Bila penerapan terputus, gunakan file dan pratinjau yang sama untuk melanjutkan melalui menu impor.

Backup Firebase saja belum tentu memuat semua data lama. Nota aplikasi asal berada pada penyimpanan browser (`notaPenjualan_v1`); foto produk juga dapat berada di IndexedDB perangkat. Ekspor perangkat format `soldier-device-backup-v1` didukung untuk nota. Simpan backup database, ekspor perangkat, gambar, konfigurasi, dan salinan kode sebelum menghentikan aplikasi lama. Data yang tidak terdapat dalam backup tidak dibuat secara perkiraan.

Alur Pesanan Offline yang membuat/menghapus produksi, pembagian pembayaran lintas order, dan modul ROAS belum dipindahkan sebagai transaksi otomatis. Catatan yang sebelumnya dikecualikan dari produksi tidak diaktifkan kembali oleh impor perdagangan. Aplikasi/repository lama baru boleh dihapus setelah hasil impor, angka, gambar, cetakan, dan pemulihan backup diverifikasi; keberhasilan build atau publikasi saja belum membuktikan kelengkapan data.

## Sambungan ke data pusat

### PO tuntas otomatis selesai setelah tujuh hari

PO aktif yang seluruh produksi, QC, dan perbaikannya sudah tuntas mendapat waktu `tuntasPada` dari server. Setelah **7 × 24 jam**, PO pindah ke **Selesai** saat aplikasi mengambil atau menyinkronkan data. Riwayat potong, jahit, QC, gudang, dan pembayaran tetap tersimpan. Pemeriksaan dilakukan kembali dengan data terbaru di dalam lock sebelum status diubah; PO yang tertahan atau sedang dalam pemulihan riwayat tidak ditutup otomatis.

PO lama tanpa waktu tuntas yang dapat dipercaya mulai dihitung saat pertama kali dikenali oleh versi ini. Membuka kembali PO mengulang masa tujuh hari; pekerjaan yang belum tuntas atau masalah sumber membatalkan hitungan sebelumnya. Owner tetap dapat menutup PO secara manual seperti sebelumnya. Kartu dan detail PO memperlihatkan status dengan warna serta tulisan, termasuk tanggal nonaktif otomatis dalam WIB.

### Pemuatan aplikasi

Mulai 1.4.7, pemuatan seluruh riwayat memeriksa bahwa server benar-benar mengirim data lengkap. Respons terlambat tidak boleh menimpa versi yang lebih baru, mengganti kembali peran akun, atau mengganti riwayat lengkap dengan respons ringkas versi yang sama. Jika transaksi baru mengembalikan data ringkas, sinkron berikutnya mengambil riwayat lengkap kembali. Pratinjau dan proses cetak yang tertunda dibersihkan saat keluar atau berganti akun.

Pembelian saldo lama yang sudah dipakai atau dicadangkan untuk PO dilindungi saat edit, hapus, dan impor. Validasi dilakukan terhadap keseluruhan saldo yang diusulkan sebelum penulisan, termasuk perubahan satuan; saldo rol beridentitas tidak dapat dipakai untuk menutup kekurangan saldo lama. Kekurangan historis boleh tetap atau membaik, tetapi tidak boleh diperburuk. Pengiriman ulang setoran memeriksa peran dan kepemilikan sebelum mengembalikan catatan yang sudah ada.

Mulai 1.4.6, perubahan versi kode yang tidak mengubah kolom tidak memeriksa ulang seluruh header Sheets pada jalur masuk. Perubahan sesi, penghitung PIN salah, dan kunci akun tetap tersimpan serta memperbarui cache akun, tetapi tidak memaksa perangkat lain mengunduh ulang seluruh data produksi. Penggantian PIN, peran, status aktif, profil, dan perubahan produksi tetap memperbarui versi sinkronisasi. Pembacaan akun terbaru dan pemeriksaan token tetap diwajibkan.

Mulai 1.4.4, UI meminta login bertahap (`deferState: true`). Server memeriksa akun/PIN dari Sheets dan menyimpan sesi sebelum mengembalikan identitas terverifikasi, tanpa membaca tabel produksi di jalur login. Pemulihan sesi juga dapat memakai respons ringan yang memeriksa akun terbaru. Browser lalu meminta data satu kali dengan token tersebut; saat menunggu, halaman menunjukkan akun yang sudah masuk tanpa angka stok/upah kosong atau tombol transaksi. Jika pembacaan gagal, pengguna mencoba memuat data kembali tanpa mengirim PIN ulang. Respons yang terlambat setelah keluar/ganti akun diabaikan. Klien lama yang tidak meminta tahap ini tetap mendapatkan respons login lengkap.

Cache tabel produksi yang memakai versi data dipertahankan hingga enam jam agar jeda kerja tidak selalu memicu pembacaan ulang semua Sheets; umur cache akun tetap 30 menit. Perubahan melalui aplikasi, pengeditan Sheets yang memicu `onEdit`, dan checkpoint pemulihan tetap membatalkan versi lama. Cache dapat dibuang lebih awal oleh Google, sehingga pembacaan pertama dan latensi jaringan tetap memerlukan waktu. Pengujian hitungan panggilan atau akun sintetis tidak menjamin waktu masuk tertentu pada perangkat pengguna.

Proses masuk tidak lagi membaca ulang pengaturan dan cache tabel yang sama berkali-kali. PIN dan status akun dibaca langsung sekali dari Sheets; pengisian cache beberapa tabel digabung setelah permintaan selesai. Cache transaksi tetap mengikuti versi data yang berhasil disimpan. Perhitungan workflow dipakai bersama oleh ringkasan PO. Salinan sesi lokal juga dipakai saat membuka ulang aplikasi Apps Script, dengan pemeriksaan sesi/versi/divisi dan sinkronisasi ke server. Pembacaan penyimpanan lokal mempunyai batas waktu agar aplikasi tetap membuka layar masuk bila penyimpanan perangkat macet. PIN tetap diperiksa di server sebelum sesi baru dapat membuka data.

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
