/*!
 * routeCalculator.js — 고도(Z축) 가중치 기반 워프 경로 추천
 *
 * 하이랄의 좌표는 게임 내 표시 좌표 [X, Y, Z]를 그대로 사용한다.
 *   X : 동(+) / 서(-)      Y : 북(+) / 남(-)      Z : 고도
 *
 * 비용 함수는 "링크가 실제로 움직이는 데 걸리는 시간(초)"을 추정한다.
 * 순수 함수만 노출하므로 UI 없이도 단독으로 테스트할 수 있다.
 */
(function (global) {
  'use strict';

  /** 이동 모델 상수 (초/미터 단위, 게임 내 실측값 기준의 근사치) */
  var MOVE = {
    PARAGLIDE_H: 12.0,      // 패러세일 수평 활강 속도 (m/s)
    PARAGLIDE_V: 4.5,       // 패러세일 하강 속도 (m/s)
    RUN: 5.5,               // 지상 달리기 속도 (m/s)
    CLIMB: 2.0,             // 벽 등반 상승 속도 (m/s)
    CLIMB_WEIGHT: 3.0,      // 상승 이동 패널티 가중치 (요구사항 4-5)
    DESCENT_WEIGHT: 0.9,    // 강하 이동 우대 가중치 (요구사항 4-4)
    TOWER_BOOST: 800,       // 조망대 사출 고도 (m)
    TOWER_LAUNCH_TIME: 12,  // 사출 연출 + 상승에 걸리는 시간 (s)
    WARP_TIME: 15,          // 워프 선택 + 로딩 시간 (s)
    CAVE_ENTRY: 45          // 동굴 내부 보스 진입 추가 시간 (s)
  };

  /** 활강비: 1m 강하할 때마다 벌 수 있는 수평 거리 (약 2.67m) */
  var GLIDE_RATIO = MOVE.PARAGLIDE_H / MOVE.PARAGLIDE_V;

  /**
   * 계층 간 이동 패널티 (초).
   * 하늘 → 지상은 그대로 낙하하면 되므로 0, 지상 ↔ 지하는 직접 이동이
   * 불가능하므로(구멍/상승기류를 찾아야 함) 큰 패널티를 준다.
   */
  var LAYER_PENALTY = {
    'Sky>Sky': 0,
    'Sky>Surface': 0,
    'Sky>Depths': 260,
    'Surface>Sky': 240,
    'Surface>Surface': 0,
    'Surface>Depths': 200,
    'Depths>Sky': 420,
    'Depths>Surface': 300,
    'Depths>Depths': 0
  };

  var LAYER_KO = { Sky: '하늘', Surface: '지상', Depths: '지하' };

  function layerPenalty(from, to) {
    var key = from + '>' + to;
    return Object.prototype.hasOwnProperty.call(LAYER_PENALTY, key) ? LAYER_PENALTY[key] : 300;
  }

  /** 워프 지점의 표시 이름 (예: "Lookout Landing 조망대") */
  function waypointLabel(w) {
    if (w.type === 'Tower') {
      return w.name.replace(/ Skyview Tower$/, '') + ' 조망대';
    }
    return w.name.replace(/ Shrine$/, '') + ' 사당';
  }

  /**
   * 워프 지점 W에서 보스 B까지의 접근 경로를 추정한다.
   *
   * @param {object} w 워프 포인트 { type, layer, coords:[X,Y,Z] }
   * @param {object} b 보스       { layer, cave, coords:[X,Y,Z] }
   * @returns {object} 추정 결과
   */
  function estimateRoute(w, b) {
    var wx = w.coords[0], wy = w.coords[1], wz = w.coords[2];
    var bx = b.coords[0], by = b.coords[1], bz = b.coords[2];

    // 1) 수평 거리
    var hDist = Math.sqrt((wx - bx) * (wx - bx) + (wy - by) * (wy - by));
    // 2) 고도차 (양수 = 워프 지점이 보스보다 높음)
    var zDiff = wz - bz;

    var isTower = w.type === 'Tower';
    // 3) 조망대는 사출 고도까지 올라간 뒤 활강을 시작한다
    var startZ = isTower ? wz + MOVE.TOWER_BOOST : wz;
    var drop = startZ - bz;

    var legs = [];
    var seconds = MOVE.WARP_TIME;
    legs.push({ kind: 'warp', seconds: MOVE.WARP_TIME, text: '워프' });

    if (isTower) {
      seconds += MOVE.TOWER_LAUNCH_TIME;
      legs.push({
        kind: 'launch',
        seconds: MOVE.TOWER_LAUNCH_TIME,
        text: '사출 +' + MOVE.TOWER_BOOST + 'm'
      });
    }

    var mode;
    if (drop > 0) {
      // 높은 곳 → 낮은 곳: 패러세일 강하 (우대 가중치)
      var reach = drop * GLIDE_RATIO;              // 활강으로 커버 가능한 수평 거리
      var glideH = Math.min(hDist, reach);
      var glideTime = (glideH / MOVE.PARAGLIDE_H) * MOVE.DESCENT_WEIGHT;
      seconds += glideTime;
      legs.push({ kind: 'glide', seconds: glideTime, text: '활강 ' + Math.round(glideH) + 'm' });

      var rest = hDist - glideH;
      if (rest > 1) {
        var runTime = rest / MOVE.RUN;
        seconds += runTime;
        legs.push({ kind: 'run', seconds: runTime, text: '도보 ' + Math.round(rest) + 'm' });
        mode = isTower ? 'launch-glide-run' : 'glide-run';
      } else {
        mode = isTower ? 'launch-glide' : 'glide';
      }
    } else {
      // 낮은 곳 → 높은 곳: 등반/상승 패널티 (3배 가중치)
      var climb = -drop;
      var runTime2 = hDist / MOVE.RUN;
      var climbTime = (climb / MOVE.CLIMB) * MOVE.CLIMB_WEIGHT;
      seconds += runTime2 + climbTime;
      legs.push({ kind: 'run', seconds: runTime2, text: '도보 ' + Math.round(hDist) + 'm' });
      legs.push({ kind: 'climb', seconds: climbTime, text: '등반 +' + Math.round(climb) + 'm' });
      mode = 'climb';
    }

    // 5) 계층 체크
    var penalty = layerPenalty(w.layer, b.layer);
    if (penalty > 0) {
      seconds += penalty;
      legs.push({
        kind: 'layer',
        seconds: penalty,
        text: LAYER_KO[w.layer] + '→' + LAYER_KO[b.layer] + ' 이동'
      });
    }

    if (b.cave) {
      seconds += MOVE.CAVE_ENTRY;
      legs.push({ kind: 'cave', seconds: MOVE.CAVE_ENTRY, text: '동굴 진입' });
    }

    return {
      waypoint: w,
      label: waypointLabel(w),
      hDist: hDist,
      zDiff: zDiff,
      drop: drop,
      mode: mode,
      legs: legs,
      layerPenalty: penalty,
      seconds: seconds
    };
  }

  /** "약 1분 12초" 형태의 문자열 */
  function formatDuration(seconds) {
    var s = Math.round(seconds);
    if (s < 60) return '약 ' + s + '초';
    var m = Math.floor(s / 60);
    var r = s % 60;
    return r === 0 ? '약 ' + m + '분' : '약 ' + m + '분 ' + r + '초';
  }

  /** 보스 카드에 그대로 넣을 수 있는 한 줄 가이드 */
  function describe(route) {
    var how;
    switch (route.mode) {
      case 'launch-glide': how = '사출 후 활강'; break;
      case 'launch-glide-run': how = '사출·활강 후 도보'; break;
      case 'glide': how = '패러세일 강하'; break;
      case 'glide-run': how = '강하 후 도보'; break;
      default: how = '도보·등반'; break;
    }
    return '🚀 추천: [' + route.label + '] (' + how + ' ' + formatDuration(route.seconds) + ')';
  }

  /**
   * 해금된 워프 포인트 중 보스에 가장 빨리 접근할 수 있는 상위 N개를 반환한다.
   *
   * @param {object} boss
   * @param {object[]} unlockedWaypoints
   * @param {number} [limit=3]
   */
  function recommendRoutes(boss, unlockedWaypoints, limit) {
    var top = typeof limit === 'number' ? limit : 3;
    var routes = [];
    for (var i = 0; i < unlockedWaypoints.length; i++) {
      routes.push(estimateRoute(unlockedWaypoints[i], boss));
    }
    routes.sort(function (a, b) { return a.seconds - b.seconds; });
    return routes.slice(0, top);
  }

  global.RouteCalculator = {
    MOVE: MOVE,
    GLIDE_RATIO: GLIDE_RATIO,
    LAYER_PENALTY: LAYER_PENALTY,
    LAYER_KO: LAYER_KO,
    estimateRoute: estimateRoute,
    recommendRoutes: recommendRoutes,
    waypointLabel: waypointLabel,
    formatDuration: formatDuration,
    describe: describe
  };

  if (typeof module === 'object' && module.exports) module.exports = global.RouteCalculator;
})(typeof self !== 'undefined' ? self : this);
