/* Cache tampilan saja. Navigasi mencoba halaman terbaru terlebih dahulu;
   bila jaringan lambat, salinan perangkat tetap bisa dibuka. Data usaha di
   IndexedDB dan permintaan Apps Script tidak dibaca atau diubah di sini. */
var AWALAN = 'pk-produksi-app-';
var RAKITAN = '20261031-hpp-hide-offline-1564';
var CACHE = AWALAN + RAKITAN;
var HALAMAN = './index.html';
var FILES = [HALAMAN, './manifest.webmanifest', './manifest-potong.webmanifest', './manifest-jahit.webmanifest', './manifest-qc.webmanifest', './logo-192.png', './logo-512.png'];
var DASAR = new URL('./', self.location.href).pathname;
var NAVIGASI_TUNGGU = 2500;
var pembaruan = Object.create(null);
function milikSendiri(k) { return k.indexOf(AWALAN) === 0; }
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (res) { if (!res || !res.ok) throw new Error('gagal mengambil ' + u); return c.put(u, res); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && milikSendiri(k); }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }).then(function () { return kabari(RAKITAN); }));
});
function tanda(res) { return res ? String(res.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '').replace(/-gzip$/, '') : ''; }
function kabari(rakitan) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) {
    var url; try { url = new URL(c.url); } catch (e) { return; }
    if (url.origin === self.location.origin && (url.pathname === DASAR || url.pathname === DASAR + 'index.html')) c.postMessage({ pk: 'versi-baru', rakitan: rakitan || '' });
  }); }).catch(function () {});
}
function cacheBaca(kunci) {
  return caches.open(CACHE).then(function (c) { return c.match(kunci); }).catch(function () { return null; });
}
/* Satu pengambilan per file walau beberapa jendela memintanya bersamaan.
   Setiap pemakai menerima clone, sehingga body tidak habis untuk jendela lain. */
function perbarui(kunci) {
  if (pembaruan[kunci]) return pembaruan[kunci];
  var jalan = fetch(new Request(kunci, { cache: 'no-cache' })).then(function (res) {
    if (!res || !res.ok) throw new Error('gagal mengambil ' + kunci);
    return caches.open(CACHE).then(function (c) {
      return c.match(kunci).then(function (lama) {
        var beda = Promise.resolve(false);
        if (lama && kunci === HALAMAN && !(tanda(lama) && tanda(lama) === tanda(res))) {
          beda = Promise.all([lama.text(), res.clone().text()]).then(function (t) { return t[0] !== t[1]; });
        }
        return Promise.all([c.put(kunci, res.clone()), beda]).then(function (hasil) { if (hasil[1]) return kabari(); });
      });
    }).catch(function () {}).then(function () { return res; }); // gangguan cache tidak menggagalkan jawaban jaringan
  });
  pembaruan[kunci] = jalan.then(function (res) { delete pembaruan[kunci]; return res; }, function (err) { delete pembaruan[kunci]; throw err; });
  return pembaruan[kunci];
}
function navigasi(e, kunci) {
  var simpanan = cacheBaca(kunci), jaringan = perbarui(kunci), timer;
  e.waitUntil(jaringan.then(function () {}, function () {}));
  var batas = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, NAVIGASI_TUNGGU); });
  return Promise.race([jaringan.then(function (res) { return res.clone(); }, function () { return null; }), batas]).then(function (res) {
    clearTimeout(timer);
    if (res) return res;
    return simpanan.then(function (hit) { return hit || jaringan.then(function (baru) { return baru.clone(); }); });
  });
}
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf(DASAR) !== 0) return;
  var sisa = url.pathname.slice(DASAR.length), kunci = sisa === '' || sisa === 'index.html' ? HALAMAN : './' + sisa;
  /* Hanya halaman utama dan aset yang dikenal. URL lain di origin yang sama,
     sw.js, API, unduhan, dan endpoint Apps Script tetap ditangani browser. */
  if (FILES.indexOf(kunci) < 0) return;
  if (kunci === HALAMAN) { e.respondWith(navigasi(e, kunci)); return; }
  var jaringan = perbarui(kunci);
  e.waitUntil(jaringan.then(function () {}, function () {}));
  e.respondWith(cacheBaca(kunci).then(function (hit) { return hit || jaringan.then(function (res) { return res.clone(); }); }));
});
