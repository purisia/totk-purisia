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
      var hay = (b.name + ' ' + b.nameKo + ' ' + b.region + ' ' + b.id + ' ' +
                 TYPE_KO[b.type] + ' ' + LAYER_KO[b.layer]).toLowerCase();
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
        var r = a.region.localeCompare(b.region);
        if (r) return r;
      } else if (by === 'altitude') {
        var z = b.coords[2] - a.coords[2];
        if (z) return z;
      }
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
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
        '<div class="card__body">' +
          '<h3 class="card__name">' + esc(b.nameKo) + ' <span class="en">' + esc(b.name) + '</span></h3>' +
          '<div class="card__meta">' +
            '<span class="badge badge--' + b.layer + '">' + LAYER_KO[b.layer] + '</span>' +
            (b.cave ? '<span class="badge badge--cave">동굴</span>' : '') +
            '<span>' + esc(b.region) + '</span>' +
            '<span class="coords">' + coordText(b.coords) + '</span>' +
          '</div>' +
        '</div>' +
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
        var hay = (w.name + ' ' + w.region + ' ' + LAYER_KO[w.layer]).toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'Tower' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    var towers = state.waypoints.filter(function (w) { return w.type === 'Tower' && state.unlocked.has(w.id); }).length;
    var shrines = state.unlocked.size - towers;
    $('#wpCount').textContent = '조망대 ' + towers + '/15 · 사당 ' + shrines + '/152 해금';

    $('#wpList').innerHTML = list.map(function (w) {
      var on = state.unlocked.has(w.id);
      return '<div class="wp' + (on ? ' is-on' : '') + '" data-wp="' + w.id + '" role="button" tabindex="0">' +
        '<span class="wp__mark">✔</span>' +
        '<span class="wp__name">' + esc(RC.waypointLabel(w)) +
          '<span>' + esc(w.region) + ' · ' + LAYER_KO[w.layer] + ' · ' + coordText(w.coords) + '</span>' +
        '</span>' +
      '</div>';
    }).join('') || '<p class="empty">검색 결과가 없습니다.</p>';
  }

  /* ───────────────────────────── 지도 ───────────────────────────── */

  var MAP = { x0: -5000, x1: 5000, y0: -4500, y1: 4500, size: 1000 };

  function mapX(x) { return (x - MAP.x0) / (MAP.x1 - MAP.x0) * MAP.size; }
  function mapY(y) { return (MAP.y1 - y) / (MAP.y1 - MAP.y0) * MAP.size; }

  function renderMap() {
    var parts = [];
    // 1000m 간격 격자
    for (var v = -4000; v <= 4000; v += 1000) {
      parts.push('<line x1="' + mapX(v).toFixed(1) + '" y1="0" x2="' + mapX(v).toFixed(1) +
                 '" y2="1000" stroke="#1a2431" stroke-width="1"/>');
      parts.push('<line x1="0" y1="' + mapY(v).toFixed(1) + '" x2="1000" y2="' + mapY(v).toFixed(1) +
                 '" stroke="#1a2431" stroke-width="1"/>');
    }

    var layer = state.mapLayer;
    // 해금된 워프 포인트
    state.waypoints.forEach(function (w) {
      if (!state.unlocked.has(w.id)) return;
      if (layer === 'Depths') return;                 // 지하에는 워프 지점이 없다
      if (layer === 'Sky' && w.type !== 'Tower' && w.layer !== 'Sky') return;
      var fill = w.type === 'Tower' ? '#46d5e8' : '#7f96b8';
      var r = w.type === 'Tower' ? 5 : 2.6;
      parts.push('<circle cx="' + mapX(w.coords[0]).toFixed(1) + '" cy="' + mapY(w.coords[1]).toFixed(1) +
                 '" r="' + r + '" fill="' + fill + '" opacity="' + (w.type === 'Tower' ? .95 : .5) + '">' +
                 '<title>' + esc(RC.waypointLabel(w)) + '</title></circle>');
    });

    // 보스
    var colors = { Lynel: '#e0503c', Hinox: '#c98adb', Talus: '#e0b44a' };
    state.bosses.forEach(function (b) {
      if (b.layer !== layer) return;
      if (!matchesBoss(b)) return;
      var killed = state.kills.has(b.id);
      parts.push('<circle cx="' + mapX(b.coords[0]).toFixed(1) + '" cy="' + mapY(b.coords[1]).toFixed(1) +
                 '" r="' + (state.selected === b.id ? 9 : 4.5) + '" ' +
                 'fill="' + (killed ? '#3a4658' : colors[b.type]) + '" ' +
                 'stroke="' + (state.selected === b.id ? '#fff' : 'none') + '" stroke-width="1.5" ' +
                 'data-boss="' + b.id + '"><title>' + esc(b.nameKo + ' · ' + b.region) + '</title></circle>');
    });

    // 선택한 보스의 추천 경로
    if (state.selected) {
      var boss = state.bosses.find(function (b) { return b.id === state.selected; });
      var routes = state.routes.get(state.selected) || [];
      if (boss) {
        routes.forEach(function (r, i) {
          parts.push('<line x1="' + mapX(r.waypoint.coords[0]).toFixed(1) + '" y1="' + mapY(r.waypoint.coords[1]).toFixed(1) +
                     '" x2="' + mapX(boss.coords[0]).toFixed(1) + '" y2="' + mapY(boss.coords[1]).toFixed(1) +
                     '" stroke="#46d5e8" stroke-width="' + (i === 0 ? 2 : 1) + '" ' +
                     'stroke-dasharray="' + (i === 0 ? '0' : '6 5') + '" opacity="' + (i === 0 ? .9 : .4) + '"/>');
        });
      }
    }

    $('#mapSvg').innerHTML = parts.join('');
  }

  function renderMapInfo() {
    var el = $('#mapInfo');
    if (!state.selected) {
      el.textContent = '지도의 점을 누르면 해당 보스의 추천 경로가 표시됩니다.';
      return;
    }
    var b = state.bosses.find(function (x) { return x.id === state.selected; });
    var routes = state.routes.get(state.selected) || [];
    if (!b) return;
    el.innerHTML = '<b>' + esc(b.nameKo) + '</b> · ' + esc(b.region) + ' · ' + LAYER_KO[b.layer] +
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
      });
    });

    bindChips($('#typeChips'), 'type', function (v) { state.filter.type = v; renderBosses(); renderMap(); });
    bindChips($('#layerChips'), 'layer', function (v) { state.filter.layer = v; renderBosses(); renderMap(); });
    bindChips($('#stateChips'), 'state', function (v) { state.filter.state = v; renderBosses(); renderMap(); });
    bindChips($('#wpTypeChips'), 'wpType', function (v) { state.wpFilter.wpType = v; renderWaypoints(); });
    bindChips($('#mapLayerChips'), 'mapLayer', function (v) { state.mapLayer = v; state.selected = null; renderMap(); renderMapInfo(); });

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

    // 지도 선택
    $('#mapSvg').addEventListener('click', function (e) {
      var c = e.target.closest('[data-boss]');
      state.selected = c ? c.dataset.boss : null;
      renderMap();
      renderMapInfo();
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
  }

  function load() {
    return Promise.all([
      fetch('./data/bosses.json').then(function (r) { return r.json(); }),
      fetch('./data/waypoints.json').then(function (r) { return r.json(); })
    ]);
  }

  load().then(function (res) {
    state.bosses = res[0];
    state.waypoints = res[1];
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
