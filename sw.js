/*!
 * sw.js — 오프라인 지원 서비스 워커
 *
 * 앱 셸과 데이터 JSON을 설치 시점에 통째로 캐시한다. 전부 정적 파일이므로
 * 한 번 설치되면 네트워크 없이도 완전히 동작한다.
 * 데이터가 바뀌면 CACHE 버전을 올려서 배포한다.
 */
var CACHE = 'totk-boss-tracker-v11';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/app.css',
  './assets/app.js',
  './assets/routeCalculator.js',
  './data/bosses.json',
  './data/waypoints.json',
  './data/map.json',
  './data/labels.json',
  './data/scaling.json',
  './data/map-surface.webp',
  './data/map-sky.webp',
  './data/map-depths.webp',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // 캐시 우선 + 백그라운드 갱신: 오프라인에서도 즉시 뜨고,
  // 온라인이면 다음 실행 때 최신 데이터가 반영된다.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached || caches.match('./index.html');
      });
      return cached || network;
    })
  );
});
