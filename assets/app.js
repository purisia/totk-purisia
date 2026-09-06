/*!
 * app.js — 보스 트래커 UI
 *
 * 상태는 전부 localStorage에 저장한다. 서버도, 외부 DB도 없다.
 *   totk-tracker:kills    처치한 보스 id 목록
 *   totk-tracker:unlocked 해금한 워프 포인트 id 목록
 *   totk-tracker:seen     최초 실행 여부 (기본 해금 세팅용)
 */
(function () {
  'use strict';

  var RC = window.RouteCalculator;
  var KEY = {
    kills: 'totk-tracker:kills',
    unlocked: 'totk-tracker:unlocked',
    seen: 'totk-tracker:seen',
    seeded: 'totk-tracker:allwarps'   // 사당까지 기본 해금으로 맞춘 시점 표시
  };

  var TYPE_KO = { Lynel: '라이넬', Hinox: '히녹스', Talus: '바위록' };
  var LAYER_KO = RC.LAYER_KO;

  var state = {
    bosses: [],
    waypoints: [],
    kills: new Set(),
    unlocked: new Set(),
    routes: new Map(),      // bossId -> 추천 경로 배열
    filter: { type: 'all', layer: 'all', state: 'all', q: '' },
    wpFilter: { wpType: 'all', q: '' },
    sort: 'time',
    map: null,           // data/map.json (좌표 → 픽셀 기준값)
    view: null,          // 지도 viewBox {x, y, w, h}
    mapLayer: 'Surface',
    cats: { Lynel: true, Hinox: true, Talus: true, Tower: true, Shrine: true },
    hideDone: false,
    sel: null            // 지도에서 선택한 대상 { kind: 'boss'|'wp', id }
  };

  /** 지도 카테고리 정의 — 토글 버튼과 마커가 같은 표를 쓴다 */
  var CATS = [
    { key: 'Lynel', ko: '라이넬', icon: '#i-lynel', color: '#e0503c', kind: 'boss' },
    { key: 'Hinox', ko: '히녹스', icon: '#i-hinox', color: '#c98adb', kind: 'boss' },
    { key: 'Talus', ko: '바위록', icon: '#i-talus', color: '#e0b44a', kind: 'boss' },
    { key: 'Tower', ko: '조망대', icon: '#i-tower', color: '#46d5e8', kind: 'wp' },
    { key: 'Shrine', ko: '사당', icon: '#i-shrine', color: '#8fa6c4', kind: 'wp' }
  ];

  function selected(kind, id) {
    return !!state.sel && state.sel.kind === kind && state.sel.id === id;
  }

  function findBoss(id) {
    return state.bosses.find(function (b) { return b.id === id; });
  }

  function findWaypoint(id) {
    return state.waypoints.find(function (w) { return w.id === id; });
  }

  /* ───────────────────────────── 저장소 ───────────────────────────── */

  function readSet(key) {
    try {
      var raw = localStorage.getItem(key);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }

  function writeSet(key, set) {
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(set)));
    } catch (e) {
      toast('저장 공간에 쓸 수 없습니다 (시크릿 모드일 수 있음)');
    }
  }

  /* ───────────────────────────── 유틸 ───────────────────────────── */

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }

  function coordText(c) {
    return '(' + Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2]) + ')';
  }

  /* ───────────────────────────── 경로 계산 ───────────────────────────── */

  function unlockedWaypoints() {
    return state.waypoints.filter(function (w) { return state.unlocked.has(w.id); });
  }

  function recomputeRoutes() {
    var open = unlockedWaypoints();
    state.routes = new Map();
    if (!open.length) return;
    state.bosses.forEach(function (b) {
      state.routes.set(b.id, RC.recommendRoutes(b, open, 3));
    });
  }

  /* ───────────────────────────── 렌더링 ───────────────────────────── */

  function updateProgress() {
    var total = state.bosses.length;
    var done = state.bosses.filter(function (b) { return state.kills.has(b.id); }).length;
    $('#progressFill').style.width = total ? (done / total * 100) + '%' : '0';
    $('#progressText').textContent = done + ' / ' + total + ' 처치';
    $('#unlockText').textContent = '워프 ' + state.unlocked.size + '곳 해금';
  }

  function matchesBoss(b) {
    var f = state.filter;
    if (f.type !== 'all' && b.type !== f.type) return false;
    if (f.layer !== 'all' && b.layer !== f.layer) return false;
    if (f.state === 'alive' && state.kills.has(b.id)) return false;
    if (f.state === 'killed' && !state.kills.has(b.id)) return false;
    if (f.q) {
      var hay = (b.name + ' ' + b.nameKo + ' ' + b.region + ' ' + b.regionKo + ' ' +
                 b.id + ' ' + TYPE_KO[b.type] + ' ' + LAYER_KO[b.layer]).toLowerCase();
      if (hay.indexOf(f.q) === -1) return false;
    }
    return true;
  }

  /** 지도에 이 보스를 그릴지 */
  function mapShowsBoss(b) {
    if (b.layer !== state.mapLayer || !state.cats[b.type]) return false;
    return !(state.hideDone && state.kills.has(b.id));
  }

  /** 지도에 이 워프 지점을 그릴지 */
  function mapShowsWaypoint(w) {
    if (w.layer !== state.mapLayer || !state.cats[w.type]) return false;
    return !(state.hideDone && state.unlocked.has(w.id));
  }

  function bestSeconds(b) {
    var r = state.routes.get(b.id);
    return r && r.length ? r[0].seconds : Infinity;
  }

  function sortBosses(list) {
    var by = state.sort;
    return list.slice().sort(function (a, b) {
      if (by === 'time') {
        var d = bestSeconds(a) - bestSeconds(b);
        if (d) return d;
      } else if (by === 'region') {
        var r = a.regionKo.localeCompare(b.regionKo, 'ko');
        if (r) return r;
      } else if (by === 'altitude') {
        var z = b.coords[2] - a.coords[2];
        if (z) return z;
      }
      return a.nameKo.localeCompare(b.nameKo, 'ko') || a.id.localeCompare(b.id);
    });
  }

  function routeHtml(b) {
    var routes = state.routes.get(b.id);
    if (!routes || !routes.length) {
      return '<div class="card__route"><span class="route__none">⚠ 해금된 워프 포인트가 없습니다 — ' +
             '“워프 포인트” 탭에서 먼저 해금하세요.</span></div>';
    }
    var best = routes[0];
    var legs = best.legs.map(function (l) {
      return esc(l.text) + ' ' + Math.round(l.seconds) + 's';
    }).join(' · ');

    var alt = routes.slice(1).map(function (r, i) {
      return '<div>' + (i + 2) + '. <b>' + esc(r.label) + '</b> — ' +
             esc(RC.formatDuration(r.seconds)) +
             ' <span class="coords">· 수평 ' + Math.round(r.hDist) + 'm · 고도차 ' +
             (r.zDiff >= 0 ? '+' : '') + Math.round(r.zDiff) + 'm</span></div>';
    }).join('');

    return '<div class="card__route">' +
      '<div class="route__best">' + esc(RC.describe(best)) + '</div>' +
      '<div class="route__legs">' + legs + '</div>' +
      (alt ? '<div class="route__alt">' + alt + '</div>' : '') +
      '</div>';
  }

  function bossCard(b) {
    var killed = state.kills.has(b.id);
    return '<article class="card' + (killed ? ' is-killed' : '') + '" data-type="' + b.type + '" data-id="' + b.id + '">' +
      '<div class="card__head">' +
        '<button class="card__check" type="button" data-kill="' + b.id + '" ' +
          'aria-pressed="' + killed + '" aria-label="처치 여부">✔</button>' +
        '<svg class="card__icon ico--' + b.type + '" aria-hidden="true"><use href="' +
          TYPE_ICON[b.type] + '"/></svg>' +
        '<div class="card__body">' +
          '<h3 class="card__name">' + esc(b.nameKo) + ' <span class="en">' + esc(b.name) + '</span></h3>' +
          '<div class="card__meta">' +
            '<span class="badge badge--' + b.layer + '">' + LAYER_KO[b.layer] + '</span>' +
            (b.cave ? '<span class="badge badge--cave">동굴</span>' : '') +
            '<span>' + esc(b.regionKo) + '</span>' +
            '<span class="coords">' + coordText(b.coords) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="card__map" type="button" data-focus="' + b.id + '" ' +
          'aria-label="지도에서 보기">🗺</button>' +
      '</div>' +
      routeHtml(b) +
    '</article>';
  }

  function renderBosses() {
    var list = sortBosses(state.bosses.filter(matchesBoss));
    $('#bossCount').textContent = list.length + '기 표시 · 전체 ' + state.bosses.length + '기';
    $('#bossList').innerHTML = list.length
      ? list.map(bossCard).join('')
      : '<p class="empty">조건에 맞는 보스가 없습니다.</p>';
  }

  function renderWaypoints() {
    var f = state.wpFilter;
    var list = state.waypoints.filter(function (w) {
      if (f.wpType !== 'all' && w.type !== f.wpType) return false;
      if (f.q) {
        var hay = (w.name + ' ' + w.nameKo + ' ' + w.region + ' ' + w.regionKo + ' ' +
                 LAYER_KO[w.layer]).toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'Tower' ? -1 : 1;
      return a.nameKo.localeCompare(b.nameKo, 'ko');
    });

    var towers = state.waypoints.filter(function (w) { return w.type === 'Tower' && state.unlocked.has(w.id); }).length;
    var shrines = state.unlocked.size - towers;
    $('#wpCount').textContent = '조망대 ' + towers + '/15 · 사당 ' + shrines + '/152 해금';

    $('#wpList').innerHTML = list.map(function (w) {
      var on = state.unlocked.has(w.id);
      return '<div class="wp' + (on ? ' is-on' : '') + '" data-wp="' + w.id + '" role="button" tabindex="0">' +
        '<span class="wp__mark">✔</span>' +
        '<svg class="ico ico--' + (w.type === 'Tower' ? 'tower' : 'shrine') + '" aria-hidden="true">' +
          '<use href="' + (w.type === 'Tower' ? '#i-tower' : '#i-shrine') + '"/></svg>' +
        '<span class="wp__name">' + esc(RC.waypointLabel(w)) +
          '<span>' + esc(w.regionKo) + ' · ' + LAYER_KO[w.layer] + ' · ' + coordText(w.coords) +
          ' · ' + esc(w.name) + '</span>' +
        '</span>' +
      '</div>';
    }).join('') || '<p class="empty">검색 결과가 없습니다.</p>';
  }

  /* ───────────────────────────── 지도 ───────────────────────────── */
  /*
   * 배경은 data/map-{surface,sky,depths}.webp 이고, data/map.json 이
   * 게임 좌표 → 이미지 픽셀 변환에 필요한 기준점을 담고 있다.
   * 화면 표시는 SVG viewBox 를 움직여서 이동·확대한다.
   */

  var TYPE_COLOR = { Lynel: '#e0503c', Hinox: '#c98adb', Talus: '#e0b44a' };
  var TYPE_ICON = { Lynel: '#i-lynel', Hinox: '#i-hinox', Talus: '#i-talus' };

  function toMapX(x) { return (x - state.map.originX) / state.map.metersPerPixel; }
  function toMapY(y) { return (state.map.originY - y) / state.map.metersPerPixel; }

  /** 화면에서 보고 싶은 마커 크기(px) — 축소했을 때는 작게, 확대하면 크게 */
  function markerScale() {
    var zoom = fitWidth() / state.view.w;                  // 1 = 전체 보기
    var px = Math.max(11, Math.min(26, 11 * Math.pow(zoom, 0.45)));
    var rect = $('#mapSvg').getBoundingClientRect();
    var perPx = (rect.width || 360) / state.view.w;         // 화면 px / 지도 단위
    return px / perPx / 24;                                 // 심볼 viewBox 가 24
  }

  /** 지도 영역의 화면 비율 (세로/가로) */
  function stageRatio() {
    var r = $('#mapSvg').getBoundingClientRect();
    return r.width > 0 ? r.height / r.width : state.map.height / state.map.width;
  }

  /** 지도 전체가 들어오는 뷰 폭 (가장 많이 축소한 상태) */
  function fitWidth() {
    var m = state.map;
    return Math.max(m.width, m.height / stageRatio());
  }

  /** 화면을 빈틈없이 채우는 뷰 폭 — 세로 화면에서 검은 여백을 없앤다 */
  function coverWidth() {
    var m = state.map;
    return Math.min(m.width, m.height / stageRatio());
  }

  /**
   * 지도는 화면을 꽉 채우므로 viewBox 의 비율을 화면 비율에 맞춘다
   * (preserveAspectRatio="none" + 이미지가 지도 좌표 그대로라 왜곡은 없다).
   */
  function clampView() {
    var v = state.view;
    var m = state.map;
    var fit = fitWidth();
    v.w = Math.max(fit / 14, Math.min(fit, v.w));
    v.h = v.w * stageRatio();
    var padX = Math.max(0, (v.w - m.width) / 2);
    var padY = Math.max(0, (v.h - m.height) / 2);
    v.x = Math.max(-padX - v.w * 0.1, Math.min(m.width - v.w + padX + v.w * 0.1, v.x));
    v.y = Math.max(-padY - v.h * 0.1, Math.min(m.height - v.h + padY + v.h * 0.1, v.y));
  }

  function applyView() {
    var v = state.view;
    var svg = $('#mapSvg');
    svg.setAttribute('viewBox', v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ' ' +
                                v.w.toFixed(1) + ' ' + v.h.toFixed(1));
    var s = markerScale();
    Array.prototype.forEach.call(svg.querySelectorAll('.mk'), function (g) {
      g.setAttribute('transform', 'translate(' + g.dataset.mx + ',' + g.dataset.my +
                                  ') scale(' + s.toFixed(3) + ')');
    });
    var routes = svg.querySelector('#mapRoutes');
    if (routes) routes.setAttribute('stroke-width', (v.w / 260).toFixed(2));

    var c = viewCenterGame();
    $('#coordBox').textContent = Math.round(c[0]) + ' | ' + Math.round(c[1]);
    syncUrl();
  }

  /**
   * mode 'fit' 이면 지도 전체가 보이게, 그 밖에는 화면을 채우게 맞춘다.
   * 세로로 긴 화면에서 지도 전체를 넣으면 위아래가 대부분 빈 공간이라
   * 처음 화면은 '채우기'로 두고, 전체 보기는 ⤢ 버튼에 맡긴다.
   */
  function resetView(mode) {
    var m = state.map;
    state.view = { x: 0, y: 0, w: mode === 'fit' ? fitWidth() : coverWidth(), h: 0 };
    clampView();
    state.view.x = (m.width - state.view.w) / 2;
    state.view.y = (m.height - state.view.h) / 2;
    clampView();
  }

  function zoomAt(factor, mx, my) {
    var v = state.view;
    var before = v.w;
    v.w = v.w / factor;
    clampView();
    var ratio = v.w / before;
    v.x = mx - (mx - v.x) * ratio;
    v.y = my - (my - v.y) * ratio;
    clampView();
    applyView();
  }

  /**
   * 지도 마커 한 개. 색 원 안에 흰 글리프를 넣은 핀 모양이라
   * 밝은 지저 지도에서도 어두운 지상 지도에서도 똑같이 읽힌다.
   */
  function marker(id, kind, x, y, opts) {
    var done = opts.done;
    return '<g class="mk' + (opts.extra || '') + '" data-mx="' + x.toFixed(1) +
      '" data-my="' + y.toFixed(1) + '" data-kind="' + kind + '" data-id="' + id + '">' +
      '<circle class="mk__pin" r="12" fill="' + opts.color +
        '" opacity="' + (opts.dim ? 0.5 : 1) + '"/>' +
      '<use class="mk__ico" href="' + opts.icon + '" x="-8" y="-8" width="16" height="16" ' +
        'fill="' + (opts.dark ? '#cfd8e6' : '#0d141f') + '" opacity="' + (opts.dim ? 0.85 : 1) + '"/>' +
      '<title>' + esc(opts.title) + '</title></g>';
  }

  function renderMap() {
    if (!state.map) return;
    var layer = state.mapLayer;
    var m = state.map;
    var parts = [
      '<image class="mapimg mapimg--' + layer + '" href="./data/' + m.layers[layer] +
      '" x="0" y="0" width="' + m.width + '" height="' + m.height +
      '" preserveAspectRatio="none"/>',
      '<defs><marker id="arrowEnd" viewBox="0 0 10 10" refX="9" refY="5" ' +
        'markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">' +
        '<path d="M0 0 L10 5 L0 10 Z" fill="#7ef0ff"/></marker></defs>',
      '<g id="mapRoutes" fill="none" stroke="#7ef0ff" stroke-linecap="round"></g>',
      '<g id="mapMarkers">'
    ];

    // 워프 포인트 (지저에는 워프 지점이 없다). 아직 해금하지 않은 곳도
    // 흐리게 같이 그려서, 어디를 열면 되는지 지도에서 바로 보이게 한다.
    state.waypoints.forEach(function (w) {
      if (!mapShowsWaypoint(w)) return;
      var on = state.unlocked.has(w.id);
      parts.push(marker(w.id, 'wp', toMapX(w.coords[0]), toMapY(w.coords[1]), {
        icon: w.type === 'Tower' ? '#i-tower' : '#i-shrine',
        color: on ? (w.type === 'Tower' ? '#46d5e8' : '#a8bcd6') : '#3d4859',
        dark: !on,          // 미해금 핀은 어두우니 글리프를 밝게
        dim: !on,
        title: RC.waypointLabel(w) + (on ? '' : ' (미해금)'),
        extra: ' mk--wp' + (selected('wp', w.id) ? ' is-sel' : '') + (on ? '' : ' is-locked')
      }));
    });

    // 보스
    state.bosses.forEach(function (b) {
      if (!mapShowsBoss(b)) return;
      var killed = state.kills.has(b.id);
      parts.push(marker(b.id, 'boss', toMapX(b.coords[0]), toMapY(b.coords[1]), {
        icon: TYPE_ICON[b.type],
        color: killed ? '#4d5a6d' : TYPE_COLOR[b.type],
        dark: killed,
        dim: killed,
        title: b.nameKo + ' · ' + b.regionKo,
        extra: (selected('boss', b.id) ? ' is-sel' : '') + (killed ? ' is-dead' : '')
      }));
    });

    parts.push('</g>');
    $('#mapSvg').innerHTML = parts.join('');
    drawRoutes();
    applyView();
  }

  /** 선택한 대상 기준으로 경로선과 방향 화살표를 그린다. */
  function drawRoutes() {
    var g = $('#mapSvg').querySelector('#mapRoutes');
    if (!g) return;
    var lines = [];

    if (state.sel && state.sel.kind === 'boss') {
      var boss = findBoss(state.sel.id);
      var routes = state.routes.get(state.sel.id) || [];
      if (boss) {
        routes.forEach(function (r, i) {
          lines.push(routeLine(r.waypoint.coords, boss.coords, i));
        });
      }
    } else if (state.sel && state.sel.kind === 'wp') {
      // 워프 지점을 고르면 그곳에서 가장 빨리 닿는 보스 쪽으로 선을 뻗는다
      var w = findWaypoint(state.sel.id);
      if (w) {
        nearestBosses(w, 3).forEach(function (r, i) {
          lines.push(routeLine(w.coords, r.boss.coords, i));
        });
      }
    }
    g.innerHTML = lines.join('');
  }

  function routeLine(from, to, i) {
    return '<line x1="' + toMapX(from[0]).toFixed(1) + '" y1="' + toMapY(from[1]).toFixed(1) +
           '" x2="' + toMapX(to[0]).toFixed(1) + '" y2="' + toMapY(to[1]).toFixed(1) + '" ' +
           'marker-end="url(#arrowEnd)" ' +
           'stroke-dasharray="' + (i === 0 ? 'none' : '7 6') +
           '" opacity="' + (i === 0 ? 0.95 : 0.4) + '"/>';
  }

  /** 워프 지점 하나에서 가장 빨리 닿는 미처치 보스들 */
  function nearestBosses(w, limit) {
    var out = [];
    state.bosses.forEach(function (b) {
      if (state.kills.has(b.id) || !state.cats[b.type]) return;
      out.push({ boss: b, route: RC.estimateRoute(w, b) });
    });
    out.sort(function (a, b) { return a.route.seconds - b.route.seconds; });
    return out.slice(0, limit);
  }

  /** 대상을 지도에서 열어 화면 가운데로 가져온다. */
  function focusOnMap(kind, id, zoom) {
    var o = kind === 'boss' ? findBoss(id) : findWaypoint(id);
    if (!o || !state.map) return;

    openScreen(null);
    openSearch(false);

    if (state.mapLayer !== o.layer) {
      state.mapLayer = o.layer;
      $$('#mapLayerChips .chip').forEach(function (c) {
        c.classList.toggle('is-active', c.dataset.value === o.layer);
      });
    }
    // 카테고리가 꺼져 있으면 켜 줘야 마커가 보인다
    if (!state.cats[o.type]) {
      state.cats[o.type] = true;
      renderCats();
    }
    state.sel = { kind: kind, id: id };
    state.view.w = fitWidth() / (zoom || 6);
    clampView();
    state.view.x = toMapX(o.coords[0]) - state.view.w / 2;
    state.view.y = toMapY(o.coords[1]) - state.view.h / 2;
    clampView();
    renderMap();
    renderMapInfo();
  }

  /* ─────────────────── 선택 패널 — 지도에서 하는 모든 조작 ─────────────────── */

  function bearingLine(route) {
    return '<span class="dir">' + esc(RC.bearingText(route.bearing)) + '</span> ' +
           Math.round(route.hDist) + 'm · ' +
           (route.zDiff >= 0 ? '강하 ' : '상승 ') + Math.abs(Math.round(route.zDiff)) + 'm';
  }

  function bossPanel(b) {
    var routes = state.routes.get(b.id) || [];
    var killed = state.kills.has(b.id);
    return '<div class="panel__head">' +
        '<svg class="panel__icon ico--' + b.type + '"><use href="' + TYPE_ICON[b.type] + '"/></svg>' +
        '<div class="panel__title"><b>' + esc(b.nameKo) + '</b> ' +
          '<span class="en">' + esc(b.name) + '</span>' +
          '<div class="panel__meta">' +
            '<span class="badge badge--' + b.layer + '">' + LAYER_KO[b.layer] + '</span>' +
            (b.cave ? '<span class="badge badge--cave">동굴</span>' : '') +
            esc(b.regionKo) + ' <span class="coords">' + coordText(b.coords) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="panel__close" type="button" data-close aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="panel__actions">' +
        '<button class="btn' + (killed ? ' btn--on' : '') + '" type="button" data-kill="' + b.id + '">' +
          (killed ? '✔ 처치함 — 취소' : '처치 체크') + '</button>' +
        '<button class="btn btn--ghost" type="button" data-center="boss:' + b.id + '">이 위치로 확대</button>' +
      '</div>' +
      (routes.length
        ? '<div class="panel__label">추천 워프 · 방향</div><ol class="routes">' +
            routes.map(function (r) {
              return '<li>' +
                '<div class="rt__top"><b>' + esc(r.label) + '</b>' +
                '<span class="rt__time">' + esc(RC.formatDuration(r.seconds)) + '</span></div>' +
                '<div class="rt__dir">' + bearingLine(r) + '</div>' +
                '<button class="rt__go" type="button" data-center="wp:' + r.waypoint.id + '">위치</button>' +
                '</li>';
            }).join('') + '</ol>'
        : '<p class="panel__warn">해금한 워프 포인트가 없습니다. 지도의 흐린 아이콘을 눌러 해금하세요.</p>');
  }

  function waypointPanel(w) {
    var on = state.unlocked.has(w.id);
    var near = on ? nearestBosses(w, 3) : [];
    return '<div class="panel__head">' +
        '<svg class="panel__icon ico--' + (w.type === 'Tower' ? 'tower' : 'shrine') + '">' +
          '<use href="' + (w.type === 'Tower' ? '#i-tower' : '#i-shrine') + '"/></svg>' +
        '<div class="panel__title"><b>' + esc(w.nameKo) + '</b> ' +
          '<span class="en">' + esc(w.name) + '</span>' +
          '<div class="panel__meta">' +
            '<span class="badge badge--' + w.layer + '">' + LAYER_KO[w.layer] + '</span>' +
            esc(w.regionKo) + ' <span class="coords">' + coordText(w.coords) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="panel__close" type="button" data-close aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="panel__actions">' +
        '<button class="btn' + (on ? ' btn--on' : '') + '" type="button" data-unlock="' + w.id + '">' +
          (on ? '✔ 해금함 — 취소' : '해금 체크') + '</button>' +
        '<button class="btn btn--ghost" type="button" data-center="wp:' + w.id + '">이 위치로 확대</button>' +
      '</div>' +
      (on
        ? (near.length
            ? '<div class="panel__label">여기서 가까운 미처치 보스 · 방향</div><ol class="routes">' +
                near.map(function (n) {
                  return '<li>' +
                    '<div class="rt__top"><b>' + esc(n.boss.nameKo) + '</b>' +
                    '<span class="rt__time">' + esc(RC.formatDuration(n.route.seconds)) + '</span></div>' +
                    '<div class="rt__dir">' + bearingLine(n.route) + ' · ' + esc(n.boss.regionKo) + '</div>' +
                    '<button class="rt__go" type="button" data-focus="' + n.boss.id + '">보기</button>' +
                    '</li>';
                }).join('') + '</ol>'
            : '<p class="panel__warn">조건에 맞는 미처치 보스가 없습니다.</p>')
        : '<p class="panel__warn">아직 해금하지 않은 곳입니다. 해금하면 추천 경로 계산에 포함됩니다.</p>');
  }

  /** 서랍의 카테고리 토글 (켜기/끄기 + 진행도) */
  function renderCats() {
    $('#mapCats').innerHTML = CATS.map(function (c) {
      var total, done;
      if (c.kind === 'boss') {
        var list = state.bosses.filter(function (b) { return b.type === c.key; });
        total = list.length;
        done = list.filter(function (b) { return state.kills.has(b.id); }).length;
      } else {
        var wps = state.waypoints.filter(function (w) { return w.type === c.key; });
        total = wps.length;
        done = wps.filter(function (w) { return state.unlocked.has(w.id); }).length;
      }
      return '<button class="cat' + (state.cats[c.key] ? ' is-on' : '') + '" type="button" ' +
        'data-cat="' + c.key + '" aria-pressed="' + !!state.cats[c.key] + '">' +
        '<span class="cat__pin" style="background:' + c.color + '">' +
          '<svg><use href="' + c.icon + '"/></svg></span>' +
        '<span class="cat__name">' + c.ko + '</span>' +
        '<span class="cat__num">' + done + '/' + total + '</span>' +
        '</button>';
    }).join('');
    var hd = $('#hideDoneBtn');
    hd.classList.toggle('btn--on', state.hideDone);
    hd.textContent = state.hideDone ? '완료 항목 표시' : '처치 완료 숨기기';
  }

  function renderMapInfo() {
    var el = $('#mapInfo');
    if (!state.sel) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    var o = state.sel.kind === 'boss' ? findBoss(state.sel.id) : findWaypoint(state.sel.id);
    if (!o) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = state.sel.kind === 'boss' ? bossPanel(o) : waypointPanel(o);
  }

  function renderAll() {
    updateProgress();
    renderBosses();
    renderWaypoints();
    renderCats();
    renderMap();
    renderMapInfo();
  }

  /* ─────────────────────── 지도 상태를 주소창에 반영 ─────────────────────── */

  var urlTimer;
  function syncUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      if (!state.map || !state.view) return;
      var c = viewCenterGame();
      var q = new URLSearchParams();
      q.set('layer', state.mapLayer);
      q.set('x', Math.round(c[0]));
      q.set('y', Math.round(c[1]));
      q.set('z', (fitWidth() / state.view.w).toFixed(2));
      if (state.sel) q.set('sel', state.sel.kind + ':' + state.sel.id);
      try {
        history.replaceState(null, '', location.pathname + '?' + q.toString());
      } catch (e) { /* file:// 등에서는 무시 */ }
    }, 400);
  }

  /** 현재 화면 중심의 게임 좌표 */
  function viewCenterGame() {
    var m = state.map, v = state.view;
    return [m.originX + (v.x + v.w / 2) * m.metersPerPixel,
            m.originY - (v.y + v.h / 2) * m.metersPerPixel];
  }

  /** 지도 픽셀 → 게임 좌표 */
  function toGame(px, py) {
    return [state.map.originX + px * state.map.metersPerPixel,
            state.map.originY - py * state.map.metersPerPixel];
  }

  function showCoords(px, py) {
    var g = toGame(px, py);
    $('#coordBox').textContent = Math.round(g[0]) + ' | ' + Math.round(g[1]);
  }

  /* ─────────────────────────── 지도 검색 ─────────────────────────── */

  function renderSearch(q) {
    var box = $('#mapSearchResults');
    q = (q || '').trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }

    var hits = [];
    state.bosses.forEach(function (b) {
      if ((b.nameKo + ' ' + b.name + ' ' + b.regionKo + ' ' + b.region).toLowerCase().indexOf(q) >= 0) {
        hits.push({ kind: 'boss', id: b.id, name: b.nameKo, sub: b.regionKo + ' · ' + LAYER_KO[b.layer],
                    icon: TYPE_ICON[b.type], color: TYPE_COLOR[b.type] });
      }
    });
    state.waypoints.forEach(function (w) {
      if ((w.nameKo + ' ' + w.name + ' ' + w.regionKo + ' ' + w.region).toLowerCase().indexOf(q) >= 0) {
        hits.push({ kind: 'wp', id: w.id, name: w.nameKo, sub: w.regionKo + ' · ' + LAYER_KO[w.layer],
                    icon: w.type === 'Tower' ? '#i-tower' : '#i-shrine',
                    color: w.type === 'Tower' ? '#46d5e8' : '#a8bcd6' });
      }
    });

    box.innerHTML = hits.length
      ? hits.slice(0, 30).map(function (h) {
          return '<button class="sr" type="button" data-goto="' + h.kind + ':' + h.id + '">' +
            '<span class="sr__pin" style="background:' + h.color + '">' +
              '<svg><use href="' + h.icon + '"/></svg></span>' +
            '<span class="sr__txt"><b>' + esc(h.name) + '</b><span>' + esc(h.sub) + '</span></span>' +
            '</button>';
        }).join('') + (hits.length > 30 ? '<p class="sr__more">외 ' + (hits.length - 30) + '건</p>' : '')
      : '<p class="sr__more">검색 결과가 없습니다.</p>';
  }

  /* ───────────────────────────── 조작 ───────────────────────────── */

  function toggleKill(id) {
    if (state.kills.has(id)) state.kills.delete(id); else state.kills.add(id);
    writeSet(KEY.kills, state.kills);
    updateProgress();
  }

  function toggleWaypoint(id) {
    if (state.unlocked.has(id)) state.unlocked.delete(id); else state.unlocked.add(id);
    writeSet(KEY.unlocked, state.unlocked);
    recomputeRoutes();
    renderAll();
  }

  /* ─────────────────────── 서랍과 전체 화면 ─────────────────────── */

  function openDrawer(on) {
    $('#drawer').hidden = !on;
    $('#scrim').hidden = !on;
    $('#menuBtn').setAttribute('aria-expanded', String(on));
  }

  function openScreen(name) {
    $$('.screen').forEach(function (v) { v.hidden = true; });
    if (name) {
      $('#view-' + name).hidden = false;
      $('#view-' + name).querySelector('.screen__body').scrollTop = 0;
    }
    openDrawer(false);
  }

  function openSearch(on) {
    $('#searchPane').hidden = !on;
    if (on) $('#mapSearch').focus();
    else { $('#mapSearch').value = ''; renderSearch(''); }
  }

  /* ───────────────────────────── 이벤트 ───────────────────────────── */

  /** 끌어서 이동 · 휠/핀치로 확대. viewBox 를 직접 움직인다. */
  function bindMapGestures() {
    var svg = $('#mapSvg');
    var pointers = new Map();
    var dragged = 0;
    var pinch = 0;
    // setPointerCapture 를 걸면 이후 pointerup 의 target 이 캡처 대상(svg)으로
    // 바뀐다. 그래서 어떤 마커를 눌렀는지는 pointerdown 시점에 기억해 둔다.
    var downMarker = null;

    function toMapUnits(dx, dy) {
      var rect = svg.getBoundingClientRect();
      return [dx * state.view.w / rect.width, dy * state.view.h / rect.height];
    }

    function eventToMap(clientX, clientY) {
      var rect = svg.getBoundingClientRect();
      return [state.view.x + (clientX - rect.left) / rect.width * state.view.w,
              state.view.y + (clientY - rect.top) / rect.height * state.view.h];
    }

    svg.addEventListener('pointerdown', function (e) {
      downMarker = e.target.closest ? e.target.closest('.mk') : null;
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = 0;
      pinch = 0;
    });

    svg.addEventListener('pointermove', function (e) {
      var prev = pointers.get(e.pointerId);
      if (!prev) return;
      var pts = Array.from(pointers.values());

      if (pointers.size >= 2) {
        var before = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        pts = Array.from(pointers.values());
        var after = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (before > 8 && after > 8) {
          var mid = eventToMap((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
          pinch = 1;
          zoomAt(after / before, mid[0], mid[1]);
        }
        return;
      }

      var d = toMapUnits(prev.x - e.clientX, prev.y - e.clientY);
      state.view.x += d[0];
      state.view.y += d[1];
      dragged += Math.abs(prev.x - e.clientX) + Math.abs(prev.y - e.clientY);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clampView();
      applyView();
    });

    function release(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && dragged < 6 && !pinch) {
        var hit = downMarker;
        state.sel = hit ? { kind: hit.dataset.kind, id: hit.dataset.id } : null;
        $$('#mapSvg .mk').forEach(function (g) {
          g.classList.toggle('is-sel', !!hit && g === hit);
        });
        drawRoutes();
        renderMapInfo();
        applyView();
      }
      if (pointers.size === 0) downMarker = null;
    }

    svg.addEventListener('pointermove', function (e) {
      if (pointers.size) return;                   // 드래그 중에는 중심 좌표를 유지
      var rect = svg.getBoundingClientRect();
      showCoords(state.view.x + (e.clientX - rect.left) / rect.width * state.view.w,
                 state.view.y + (e.clientY - rect.top) / rect.height * state.view.h);
    });

    svg.addEventListener('pointerleave', function () {
      var c = viewCenterGame();
      $('#coordBox').textContent = Math.round(c[0]) + ' | ' + Math.round(c[1]);
    });

    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var at = eventToMap(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, at[0], at[1]);
    }, { passive: false });

    svg.addEventListener('dblclick', function () { resetView('fit'); applyView(); });
  }

  function bindChips(container, group, onChange) {
    container.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      Array.prototype.forEach.call(container.children, function (c) { c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      onChange(chip.dataset.value);
    });
  }

  function bindEvents() {
    $('#menuBtn').addEventListener('click', function () { openDrawer($('#drawer').hidden); });
    $('#drawerClose').addEventListener('click', function () { openDrawer(false); });
    $('#scrim').addEventListener('click', function () { openDrawer(false); });

    $$('[data-screen]').forEach(function (b) {
      b.addEventListener('click', function () { openScreen(b.dataset.screen); });
    });
    $$('[data-screen-close]').forEach(function (b) {
      b.addEventListener('click', function () { openScreen(null); });
    });

    $('#searchBtn').addEventListener('click', function () { openSearch($('#searchPane').hidden); });
    $('#searchClose').addEventListener('click', function () { openSearch(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#searchPane').hidden) openSearch(false);
      else if ($$('.screen').some(function (v) { return !v.hidden; })) openScreen(null);
      else if (!$('#drawer').hidden) openDrawer(false);
      else if (state.sel) { state.sel = null; renderMap(); renderMapInfo(); }
    });

    bindChips($('#typeChips'), 'type', function (v) { state.filter.type = v; renderBosses(); });
    bindChips($('#layerChips'), 'layer', function (v) { state.filter.layer = v; renderBosses(); });
    bindChips($('#stateChips'), 'state', function (v) { state.filter.state = v; renderBosses(); });
    bindChips($('#wpTypeChips'), 'wpType', function (v) { state.wpFilter.wpType = v; renderWaypoints(); });
    bindChips($('#mapLayerChips'), 'mapLayer', function (v) {
      state.mapLayer = v;
      state.sel = null;
      renderMap();
      renderMapInfo();
    });

    $('#search').addEventListener('input', function (e) {
      state.filter.q = e.target.value.trim().toLowerCase();
      renderBosses();
    });

    $('#wpSearch').addEventListener('input', function (e) {
      state.wpFilter.q = e.target.value.trim().toLowerCase();
      renderWaypoints();
    });

    $('#sortSelect').addEventListener('change', function (e) {
      state.sort = e.target.value;
      renderBosses();
    });

    // 처치 체크 (목록 탭)
    $('#bossList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-kill]');
      if (!btn) return;
      var id = btn.dataset.kill;
      toggleKill(id);
      var card = btn.closest('.card');
      var on = state.kills.has(id);
      btn.setAttribute('aria-pressed', String(on));
      card.classList.toggle('is-killed', on);
      renderCats();
      renderMap();
      if (state.sel && state.sel.kind === 'boss' && state.sel.id === id) renderMapInfo();
    });

    $('#wpList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-wp]');
      if (row) toggleWaypoint(row.dataset.wp);
    });

    $('#wpList').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('[data-wp]');
      if (row) { e.preventDefault(); toggleWaypoint(row.dataset.wp); }
    });

    // 일괄 해금
    $$('[data-bulk]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.dataset.bulk;
        if (mode === 'none') state.unlocked = new Set();
        else state.unlocked = new Set(state.waypoints
          .filter(function (w) { return mode === 'all' || w.type === 'Tower'; })
          .map(function (w) { return w.id; }));
        writeSet(KEY.unlocked, state.unlocked);
        recomputeRoutes();
        renderAll();
        toast('워프 ' + state.unlocked.size + '곳 해금 상태로 변경');
      });
    });

    // 붉은 달
    $('#bloodMoonBtn').addEventListener('click', function () {
      var n = state.kills.size;
      if (!n) { toast('초기화할 처치 기록이 없습니다'); return; }
      if (!confirm('붉은 달이 떴습니다.\n처치 기록 ' + n + '건을 모두 초기화할까요?\n(워프 해금 상태는 유지됩니다)')) return;
      state.kills = new Set();
      writeSet(KEY.kills, state.kills);
      renderAll();
      toast('🌑 붉은 달 — 처치 기록 ' + n + '건 초기화');
    });

    bindMapGestures();

    $('#zoomIn').addEventListener('click', function () {
      zoomAt(1.6, state.view.x + state.view.w / 2, state.view.y + state.view.h / 2);
    });
    $('#zoomOut').addEventListener('click', function () {
      zoomAt(1 / 1.6, state.view.x + state.view.w / 2, state.view.y + state.view.h / 2);
    });
    $('#zoomReset').addEventListener('click', function () { resetView('fit'); applyView(); });

    // 카드에서 지도로 보내기
    $('#bossList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-focus]');
      if (btn) focusOnMap('boss', btn.dataset.focus);
    });

    // 카테고리 켜기/끄기
    $('#mapCats').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cat]');
      if (!btn) return;
      var key = btn.dataset.cat;
      state.cats[key] = !state.cats[key];
      if (state.sel) {
        var o = state.sel.kind === 'boss' ? findBoss(state.sel.id) : findWaypoint(state.sel.id);
        if (o && !state.cats[o.type]) state.sel = null;
      }
      renderCats();
      renderMap();
      renderMapInfo();
    });

    $('#hideDoneBtn').addEventListener('click', function () {
      state.hideDone = !state.hideDone;
      renderCats();
      renderMap();
      renderMapInfo();
    });

    $('#mapSearch').addEventListener('input', function (e) { renderSearch(e.target.value); });

    $('#mapSearchResults').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-goto]');
      if (!btn) return;
      var parts = btn.dataset.goto.split(':');
      openSearch(false);
      focusOnMap(parts[0], parts[1], 8);
    });

    // 선택 패널 — 지도에서 처치 체크 · 해금 · 이동을 모두 처리한다
    $('#mapInfo').addEventListener('click', function (e) {
      var el = e.target.closest('[data-kill],[data-unlock],[data-center],[data-focus],[data-close]');
      if (!el) return;

      if (el.hasAttribute('data-close')) {
        state.sel = null;
        renderMap();
        renderMapInfo();
        return;
      }
      if (el.dataset.kill) {
        toggleKill(el.dataset.kill);
        renderCats();
        renderMap();
        renderMapInfo();
        return;
      }
      if (el.dataset.unlock) {
        toggleWaypoint(el.dataset.unlock);
        return;
      }
      if (el.dataset.focus) {
        focusOnMap('boss', el.dataset.focus);
        return;
      }
      if (el.dataset.center) {
        var parts = el.dataset.center.split(':');
        focusOnMap(parts[0], parts[1], 8);
      }
    });

    window.addEventListener('resize', function () {
      if (!state.map) return;
      clampView();
      applyView();
    });

    // 내보내기 / 불러오기 / 초기화
    $('#exportBtn').addEventListener('click', function () {
      var payload = {
        app: 'totk-field-boss-tracker',
        savedAt: new Date().toISOString(),
        kills: Array.from(state.kills),
        unlocked: Array.from(state.unlocked)
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'totk-boss-tracker.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      $('#ioMsg').textContent = '기록 ' + payload.kills.length + '건, 해금 ' + payload.unlocked.length + '곳을 내보냈습니다.';
    });

    $('#importInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          state.kills = new Set(data.kills || []);
          state.unlocked = new Set(data.unlocked || []);
          writeSet(KEY.kills, state.kills);
          writeSet(KEY.unlocked, state.unlocked);
          recomputeRoutes();
          renderAll();
          $('#ioMsg').textContent = '기록 ' + state.kills.size + '건, 해금 ' + state.unlocked.size + '곳을 불러왔습니다.';
          toast('기록을 불러왔습니다');
        } catch (err) {
          $('#ioMsg').textContent = '불러오기 실패: 올바른 JSON 파일이 아닙니다.';
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#resetAllBtn').addEventListener('click', function () {
      if (!confirm('처치 기록과 워프 해금 상태를 모두 지웁니다. 계속할까요?')) return;
      state.kills = new Set();
      state.unlocked = new Set();
      writeSet(KEY.kills, state.kills);
      writeSet(KEY.unlocked, state.unlocked);
      recomputeRoutes();
      renderAll();
      toast('전체 초기화 완료');
    });
  }

  /* ───────────────────────────── 시작 ───────────────────────────── */

  /**
   * 주소창의 상태를 복원한다. 지도를 움직이면 layer/x/y/z/sel 이 주소에
   * 반영되므로, 링크를 그대로 공유하거나 새로고침해도 같은 화면이 뜬다.
   *   ?layer=Surface&x=-2432&y=368&z=6&sel=boss:lynel-003
   * manifest.json 의 바로가기(?view=, ?filter=)도 여기서 처리한다.
   */
  function applyLaunchParams() {
    var params = new URLSearchParams(location.search);

    var view = params.get('view');
    if (view && $('#view-' + view)) openScreen(view);

    var filter = params.get('filter');
    if (filter === 'alive' || filter === 'killed') {
      var chip = document.querySelector('#stateChips .chip[data-value="' + filter + '"]');
      if (chip) chip.click();
    }

    var layer = params.get('layer');
    if (layer && ['Sky', 'Surface', 'Depths'].indexOf(layer) >= 0) {
      state.mapLayer = layer;
      $$('#mapLayerChips .chip').forEach(function (c) {
        c.classList.toggle('is-active', c.dataset.value === layer);
      });
    }

    var sel = params.get('sel');
    if (sel) {
      var parts = sel.split(':');
      var found = parts[0] === 'boss' ? findBoss(parts[1]) : findWaypoint(parts[1]);
      if (found) state.sel = { kind: parts[0], id: parts[1] };
    }

    var x = parseFloat(params.get('x'));
    var y = parseFloat(params.get('y'));
    var z = parseFloat(params.get('z'));
    if (isFinite(z) && z > 0) {
      state.view.w = fitWidth() / Math.min(14, Math.max(1, z));
      clampView();
    }
    if (isFinite(x) && isFinite(y)) {
      state.view.x = toMapX(x) - state.view.w / 2;
      state.view.y = toMapY(y) - state.view.h / 2;
      clampView();
    }
  }

  function load() {
    return Promise.all([
      fetch('./data/bosses.json').then(function (r) { return r.json(); }),
      fetch('./data/waypoints.json').then(function (r) { return r.json(); }),
      fetch('./data/map.json').then(function (r) { return r.json(); })
    ]);
  }

  load().then(function (res) {
    state.bosses = res[0];
    state.waypoints = res[1];
    state.map = res[2];
    resetView();
    state.kills = readSet(KEY.kills);
    state.unlocked = readSet(KEY.unlocked);

    // 기본값은 "전부 해금". 사당·조망대를 다 연 상태를 가정해야 추천 경로가
    // 곧바로 쓸모 있고, 잠그고 싶은 곳만 워프 포인트 화면에서 끄면 된다.
    if (!localStorage.getItem(KEY.seeded)) {
      state.unlocked = new Set(state.waypoints.map(function (w) { return w.id; }));
      writeSet(KEY.unlocked, state.unlocked);
      try {
        localStorage.setItem(KEY.seeded, '1');
        localStorage.setItem(KEY.seen, '1');
      } catch (e) { /* 무시 */ }
    }

    $('#buildInfo').textContent =
      '보스 ' + state.bosses.length + '기 · 워프 포인트 ' + state.waypoints.length + '곳 수록';

    recomputeRoutes();
    bindEvents();
    applyLaunchParams();
    renderAll();
  }).catch(function (err) {
    $('#bossList').innerHTML = '<p class="empty">데이터를 불러오지 못했습니다.<br>' + esc(err.message) + '</p>';
  });

  // PWA. 서비스 워커가 캐시 우선이라, 새 버전이 활성화되면 한 번 새로고침해
  // 그 방문에서 바로 최신 코드가 뜨게 한다 (묵은 캐시로 계속 도는 것 방지).
  if ('serviceWorker' in navigator) {
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading || !navigator.serviceWorker.controller) return;
      reloading = true;
      location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 오프라인 지원만 실패 */ });
    });
  }
})();
