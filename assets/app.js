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
    seen: 'totk-tracker:seen'
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
    selected: null
  };

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
    var zoom = state.map.width / state.view.w;             // 1 = 전체 보기
    var px = Math.max(11, Math.min(26, 11 * Math.pow(zoom, 0.45)));
    var rect = $('#mapSvg').getBoundingClientRect();
    var perPx = (rect.width || 360) / state.view.w;         // 화면 px / 지도 단위
    return px / perPx / 24;                                 // 심볼 viewBox 가 24
  }

  function clampView() {
    var v = state.view;
    var m = state.map;
    v.w = Math.max(m.width / 14, Math.min(m.width, v.w));
    v.h = v.w * (m.height / m.width);
    v.x = Math.max(-v.w * 0.15, Math.min(m.width - v.w * 0.85, v.x));
    v.y = Math.max(-v.h * 0.15, Math.min(m.height - v.h * 0.85, v.y));
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
  }

  function resetView() {
    state.view = { x: 0, y: 0, w: state.map.width, h: state.map.height };
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

  function marker(id, kind, x, y, href, color, opacity, title, extra) {
    return '<g class="mk' + (extra || '') + '" data-mx="' + x.toFixed(1) + '" data-my="' + y.toFixed(1) + '"' +
      (kind === 'boss' ? ' data-boss="' + id + '"' : '') + '>' +
      '<circle r="13" fill="transparent"/>' +
      '<use href="' + href + '" x="-12" y="-12" width="24" height="24" fill="' + color +
      '" opacity="' + opacity + '"/>' +
      '<title>' + esc(title) + '</title></g>';
  }

  function renderMap() {
    if (!state.map) return;
    var layer = state.mapLayer;
    var m = state.map;
    var parts = [
      '<image class="mapimg mapimg--' + layer + '" href="./data/' + m.layers[layer] +
      '" x="0" y="0" width="' + m.width + '" height="' + m.height +
      '" preserveAspectRatio="none"/>',
      '<g id="mapRoutes" fill="none" stroke="#7ef0ff" stroke-linecap="round"></g>',
      '<g id="mapMarkers">'
    ];

    // 워프 포인트 (지저에는 워프 지점이 없다). 아직 해금하지 않은 곳도
    // 흐리게 같이 그려서, 어디를 열면 되는지 지도에서 바로 보이게 한다.
    if (layer !== 'Depths') {
      state.waypoints.forEach(function (w) {
        if (w.layer !== layer) return;
        var on = state.unlocked.has(w.id);
        parts.push(marker(w.id, 'wp', toMapX(w.coords[0]), toMapY(w.coords[1]),
          w.type === 'Tower' ? '#i-tower' : '#i-shrine',
          on ? (w.type === 'Tower' ? '#46d5e8' : '#9fb4cc') : '#8896a8',
          on ? (w.type === 'Tower' ? 0.95 : 0.8) : 0.55,
          RC.waypointLabel(w) + (on ? '' : ' (미해금)'), ' mk--wp'));
      });
    }

    // 보스
    state.bosses.forEach(function (b) {
      if (b.layer !== layer || !matchesBoss(b)) return;
      var killed = state.kills.has(b.id);
      parts.push(marker(b.id, 'boss', toMapX(b.coords[0]), toMapY(b.coords[1]),
        TYPE_ICON[b.type], killed ? '#68788d' : TYPE_COLOR[b.type], killed ? 0.45 : 1,
        b.nameKo + ' · ' + b.regionKo,
        (state.selected === b.id ? ' is-sel' : '') + (killed ? ' is-dead' : '')));
    });

    parts.push('</g>');
    $('#mapSvg').innerHTML = parts.join('');
    drawRoutes();
    applyView();
  }

  function drawRoutes() {
    var g = $('#mapSvg').querySelector('#mapRoutes');
    if (!g) return;
    if (!state.selected) { g.innerHTML = ''; return; }
    var boss = state.bosses.find(function (b) { return b.id === state.selected; });
    var routes = state.routes.get(state.selected) || [];
    if (!boss) { g.innerHTML = ''; return; }
    g.innerHTML = routes.map(function (r, i) {
      return '<line x1="' + toMapX(r.waypoint.coords[0]).toFixed(1) +
             '" y1="' + toMapY(r.waypoint.coords[1]).toFixed(1) +
             '" x2="' + toMapX(boss.coords[0]).toFixed(1) +
             '" y2="' + toMapY(boss.coords[1]).toFixed(1) + '" ' +
             'stroke-dasharray="' + (i === 0 ? 'none' : '7 6') +
             '" opacity="' + (i === 0 ? 0.95 : 0.4) + '"/>';
    }).join('');
  }

  /** 보스 하나를 지도에서 열어 화면 가운데로 가져온다. */
  function focusOnMap(id) {
    var b = state.bosses.find(function (x) { return x.id === id; });
    if (!b || !state.map) return;
    var tab = document.querySelector('.tab[data-view="map"]');
    if (tab) tab.click();

    if (state.mapLayer !== b.layer) {
      state.mapLayer = b.layer;
      $$('#mapLayerChips .chip').forEach(function (c) {
        c.classList.toggle('is-active', c.dataset.value === b.layer);
      });
    }
    state.selected = id;
    state.view.w = state.map.width / 6;
    clampView();
    state.view.x = toMapX(b.coords[0]) - state.view.w / 2;
    state.view.y = toMapY(b.coords[1]) - state.view.h / 2;
    clampView();
    renderMap();
    renderMapInfo();
  }

  function renderMapInfo() {
    var el = $('#mapInfo');
    if (!state.selected) {
      var n = state.bosses.filter(function (b) {
        return b.layer === state.mapLayer && matchesBoss(b);
      }).length;
      if (state.mapLayer === 'Sky') {
        var open = state.waypoints.filter(function (w) {
          return w.layer === 'Sky' && state.unlocked.has(w.id);
        }).length;
        el.textContent = '하늘에는 필드 보스가 없습니다. 하늘 사당 ' + open + '/32곳 해금 — ' +
          '높은 곳에서 강하하면 지상 보스에 빠르게 닿습니다.';
        return;
      }
      el.textContent = LAYER_KO[state.mapLayer] + ' 보스 ' + n + '기 표시 중. ' +
        '아이콘을 누르면 추천 경로가 나타납니다. 끌어서 이동, 휠·손가락으로 확대.';
      return;
    }
    var b = state.bosses.find(function (x) { return x.id === state.selected; });
    var routes = state.routes.get(state.selected) || [];
    if (!b) return;
    el.innerHTML = '<b>' + esc(b.nameKo) + '</b> · ' + esc(b.regionKo) + ' · ' + LAYER_KO[b.layer] +
      ' <span class="coords">' + coordText(b.coords) + '</span><br>' +
      (routes.length
        ? routes.map(function (r, i) {
            return (i + 1) + '. ' + esc(r.label) + ' — ' + esc(RC.formatDuration(r.seconds));
          }).join('<br>')
        : '해금된 워프 포인트가 없습니다.');
  }

  function renderAll() {
    updateProgress();
    renderBosses();
    renderWaypoints();
    renderMap();
    renderMapInfo();
  }

  /* ───────────────────────────── 이벤트 ───────────────────────────── */

  /** 끌어서 이동 · 휠/핀치로 확대. viewBox 를 직접 움직인다. */
  function bindMapGestures() {
    var svg = $('#mapSvg');
    var pointers = new Map();
    var dragged = 0;
    var pinch = 0;

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
        var hit = e.target.closest('[data-boss]');
        state.selected = hit ? hit.dataset.boss : null;
        $$('#mapSvg .mk').forEach(function (g) {
          g.classList.toggle('is-sel', !!hit && g.dataset.boss === hit.dataset.boss);
        });
        drawRoutes();
        renderMapInfo();
        applyView();
      }
    }

    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var at = eventToMap(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, at[0], at[1]);
    }, { passive: false });

    svg.addEventListener('dblclick', function () { resetView(); applyView(); });
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
    // 탭
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        $$('.view').forEach(function (v) { v.hidden = true; });
        $('#view-' + tab.dataset.view).hidden = false;
        if (tab.dataset.view === 'map' && state.map) applyView();
      });
    });

    bindChips($('#typeChips'), 'type', function (v) { state.filter.type = v; renderBosses(); renderMap(); });
    bindChips($('#layerChips'), 'layer', function (v) { state.filter.layer = v; renderBosses(); renderMap(); });
    bindChips($('#stateChips'), 'state', function (v) { state.filter.state = v; renderBosses(); renderMap(); });
    bindChips($('#wpTypeChips'), 'wpType', function (v) { state.wpFilter.wpType = v; renderWaypoints(); });
    bindChips($('#mapLayerChips'), 'mapLayer', function (v) {
      state.mapLayer = v;
      state.selected = null;
      renderMap();
      renderMapInfo();
    });

    $('#search').addEventListener('input', function (e) {
      state.filter.q = e.target.value.trim().toLowerCase();
      renderBosses();
      renderMap();
    });

    $('#wpSearch').addEventListener('input', function (e) {
      state.wpFilter.q = e.target.value.trim().toLowerCase();
      renderWaypoints();
    });

    $('#sortSelect').addEventListener('change', function (e) {
      state.sort = e.target.value;
      renderBosses();
    });

    // 처치 체크
    $('#bossList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-kill]');
      if (!btn) return;
      var id = btn.dataset.kill;
      if (state.kills.has(id)) state.kills.delete(id); else state.kills.add(id);
      writeSet(KEY.kills, state.kills);
      var card = btn.closest('.card');
      var on = state.kills.has(id);
      btn.setAttribute('aria-pressed', String(on));
      card.classList.toggle('is-killed', on);
      updateProgress();
      renderMap();
    });

    // 워프 해금
    function toggleWaypoint(id) {
      if (state.unlocked.has(id)) state.unlocked.delete(id); else state.unlocked.add(id);
      writeSet(KEY.unlocked, state.unlocked);
      recomputeRoutes();
      renderAll();
    }

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
    $('#zoomReset').addEventListener('click', function () { resetView(); applyView(); });

    // 카드에서 지도로 보내기
    $('#bossList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-focus]');
      if (btn) focusOnMap(btn.dataset.focus);
    });

    window.addEventListener('resize', function () {
      if (state.map && !$('#view-map').hidden) applyView();
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

  /** manifest.json 의 바로가기(?view= / ?filter=)를 반영한다. */
  function applyLaunchParams() {
    var params = new URLSearchParams(location.search);
    var view = params.get('view');
    var filter = params.get('filter');

    if (view && $('#view-' + view)) {
      var tab = document.querySelector('.tab[data-view="' + view + '"]');
      if (tab) tab.click();
    }
    if (filter === 'alive' || filter === 'killed') {
      var chip = document.querySelector('#stateChips .chip[data-value="' + filter + '"]');
      if (chip) chip.click();
    }
    var layer = params.get('layer');
    if (layer) {
      var lchip = document.querySelector('#mapLayerChips .chip[data-value="' + layer + '"]');
      if (lchip) lchip.click();
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

    // 최초 실행: 조망대 15곳을 미리 해금해 두면 바로 추천을 볼 수 있다.
    if (!localStorage.getItem(KEY.seen)) {
      state.unlocked = new Set(state.waypoints
        .filter(function (w) { return w.type === 'Tower'; })
        .map(function (w) { return w.id; }));
      writeSet(KEY.unlocked, state.unlocked);
      try { localStorage.setItem(KEY.seen, '1'); } catch (e) { /* 무시 */ }
      setTimeout(function () { toast('조망대 15곳을 기본 해금했습니다 — 사당은 “워프 포인트” 탭에서'); }, 700);
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

  // PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 오프라인 지원만 실패 */ });
    });
  }
})();
