/* Menyimpan tampilan aplikasi supaya tetap terbuka saat sinyal jelek. Data tetap diambil dari server.
   Simpanan cache dipakai bersama oleh semua aplikasi di alamat induk yang sama, jadi file ini hanya
   membuat dan menghapus cache miliknya sendiri (nama berawalan pk-produksi-app-). */
var AWALAN = 'pk-produksi-app-';
var CACHE = AWALAN + '202610080908';
var FILES = ['./', './index.html', './manifest.webmanifest', './manifest-potong.webmanifest', './manifest-jahit.webmanifest', './manifest-qc.webmanifest', './logo-192.png', './logo-512.png'];
function milikSendiri(k) { return k.indexOf(AWALAN) === 0 || /^soldier-produksi-\d{12}$/.test(k); }
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && milikSendiri(k); }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return res;
  }).catch(function () {
    return caches.open(CACHE).then(function (c) {
      return c.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || c.match('./index.html'); });
    });
  }));
});