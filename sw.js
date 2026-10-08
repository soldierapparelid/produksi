/* Menyimpan tampilan aplikasi di perangkat supaya aplikasi langsung terbuka, juga saat sinyal jelek.
   Cara kerjanya: tampilan diambil dari simpanan perangkat dulu (seketika), lalu versi terbaru diperiksa
   di belakang layar. Kalau ada versi baru, simpanan diganti dan aplikasi diberi tahu. Data tetap diambil dari server.
   Simpanan cache dipakai bersama oleh semua aplikasi di alamat induk yang sama, jadi file ini hanya
   membuat dan menghapus cache miliknya sendiri (nama berawalan pk-produksi-app-). */
var AWALAN = 'pk-produksi-app-';
var RAKITAN = '20261008-admin-commerce3';
var CACHE = AWALAN + RAKITAN;
var HALAMAN = './index.html';
var FILES = [HALAMAN, './manifest.webmanifest', './manifest-potong.webmanifest', './manifest-jahit.webmanifest', './manifest-qc.webmanifest', './logo-192.png', './logo-512.png'];
var DASAR = new URL('./', self.location.href).pathname;
function milikSendiri(k) { return k.indexOf(AWALAN) === 0 || /^soldier-produksi-\d{12}$/.test(k); }
self.addEventListener('install', function (e) {
  /* diunduh langsung dari server, bukan dari simpanan sementara browser, supaya yang disimpan pasti versi terbaru */
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (res) { if (!res || !res.ok) throw new Error('gagal mengambil ' + u); return c.put(u, res); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && milikSendiri(k); }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); })
    /* jendela yang masih memakai halaman rakitan lama diberi tahu; yang sudah rakitan ini mengabaikannya */
    .then(function () { return kabari(RAKITAN); }));
});
function tanda(res) { return res ? String(res.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '').replace(/-gzip$/, '') : ''; }
function kabari(rakitan) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage({ pk: 'versi-baru', rakitan: rakitan || '' }); }); }).catch(function () {});
}
/* periksa versi terbaru sebuah file; kalau isinya berubah, simpanan diganti, dan untuk halaman aplikasi, jendela yang terbuka diberi tahu */
function perbarui(c, kunci, lama) {
  return fetch(new Request(kunci, { cache: 'no-cache' })).then(function (res) {
    if (!res || !res.ok) return null;
    var a = tanda(lama), b = tanda(res);
    if (a && a === b) return null;
    if (kunci !== HALAMAN) return c.put(kunci, res);
    return Promise.all([lama.text(), res.clone().text()]).then(function (t) {
      return c.put(kunci, res).then(function () { return t[0] !== t[1] ? kabari() : null; });
    });
  }).catch(function () { return null; });
}
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf(DASAR) !== 0) return;
  var sisa = url.pathname.slice(DASAR.length);
  if (sisa === 'sw.js') return;
  /* semua alamat halaman (./, ./?d=qc, ./index.html) memakai satu simpanan halaman */
  var kunci = (e.request.mode === 'navigate' || sisa === '' || sisa === 'index.html') ? HALAMAN : './' + sisa;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(kunci).then(function (hit) {
      if (hit) { e.waitUntil(perbarui(c, kunci, hit.clone())); return hit; }
      /* belum tersimpan: ambil dari server dan simpan untuk berikutnya */
      return fetch(e.request).then(function (res) {
        if (res && res.ok) { var salinan = res.clone(); e.waitUntil(c.put(kunci, salinan).catch(function () {})); }
        return res;
      });
    });
  }).catch(function () {
    /* simpanan perangkat bermasalah (mis. penuh): aplikasi tetap dibuka langsung dari server */
    return fetch(e.request);
  }));
});
