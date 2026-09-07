#!/usr/bin/env node
/*
 * 데이터 파일과 경로 계산기를 검증한다. CI(deploy.yml)에서 배포 전에 실행된다.
 *
 *   node tools/verify.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const RC = require(path.join(root, 'assets', 'routeCalculator.js'));

let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

/* ────────────────────────────── 데이터 ────────────────────────────── */

const bosses = readJson('data/bosses.json');
const waypoints = readJson('data/waypoints.json');

console.log('data/bosses.json');
check('190기 수록', bosses.length === 190, bosses.length + '기');

const byType = bosses.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
check('라이넬 / 히녹스 / 바위록 세 종류만 존재',
  Object.keys(byType).sort().join(',') === 'Hinox,Lynel,Talus',
  JSON.stringify(byType));

const bossIds = new Set(bosses.map(b => b.id));
check('id 중복 없음', bossIds.size === bosses.length);

check('모든 보스에 필수 필드가 있음', bosses.every(b =>
  b.id && b.type && b.name && b.nameKo && b.region && b.regionKo &&
  ['Sky', 'Surface', 'Depths'].includes(b.layer) &&
  Array.isArray(b.coords) && b.coords.length === 3 &&
  b.coords.every(n => typeof n === 'number' && Number.isFinite(n))));

check('지저 보스는 고도가 음수', bosses
  .filter(b => b.layer === 'Depths')
  .every(b => b.coords[2] < 0));

console.log('data/waypoints.json');
check('사당 152곳', waypoints.filter(w => w.type === 'Shrine').length === 152);
check('조망대 15곳', waypoints.filter(w => w.type === 'Tower').length === 15);

const wpIds = new Set(waypoints.map(w => w.id));
check('id 중복 없음', wpIds.size === waypoints.length);

check('모든 워프 포인트에 필수 필드가 있음', waypoints.every(w =>
  w.id && ['Shrine', 'Tower'].includes(w.type) && w.name && w.nameKo &&
  w.region && w.regionKo &&
  ['Sky', 'Surface'].includes(w.layer) &&
  Array.isArray(w.coords) && w.coords.length === 3 &&
  w.coords.every(n => typeof n === 'number' && Number.isFinite(n))));

check('하늘 사당 32곳 / 지상 사당 120곳',
  waypoints.filter(w => w.type === 'Shrine' && w.layer === 'Sky').length === 32 &&
  waypoints.filter(w => w.type === 'Shrine' && w.layer === 'Surface').length === 120);

const hangul = s => /[가-힣]/.test(s);
check('보스 이름·지역이 모두 한글', bosses.every(b => hangul(b.nameKo) && hangul(b.regionKo)),
  (bosses.find(b => !hangul(b.nameKo) || !hangul(b.regionKo)) || {}).id);
check('워프 이름·지역이 모두 한글',
  waypoints.every(w => hangul(w.nameKo) && hangul(w.regionKo)),
  (waypoints.find(w => !hangul(w.nameKo) || !hangul(w.regionKo)) || {}).id);
check('조망대 15곳 이름이 서로 다름',
  new Set(waypoints.filter(w => w.type === 'Tower').map(w => w.nameKo)).size === 15);
check('사당 152곳 이름이 서로 다름',
  new Set(waypoints.filter(w => w.type === 'Shrine').map(w => w.nameKo)).size === 152);

console.log('data/map.json');
const map = readJson('data/map.json');
check('지도 기준값이 갖춰짐',
  map.width > 0 && map.height > 0 && map.metersPerPixel > 0 &&
  Number.isFinite(map.originX) && Number.isFinite(map.originY));
check('세 계층의 지도 이미지가 존재',
  ['Sky', 'Surface', 'Depths'].every(l => map.layers[l] &&
    fs.existsSync(path.join(root, 'data', map.layers[l]))));
check('모든 좌표가 지도 안에 들어감', [...bosses, ...waypoints].every(o => {
  const px = (o.coords[0] - map.originX) / map.metersPerPixel;
  const py = (map.originY - o.coords[1]) / map.metersPerPixel;
  return px >= 0 && px <= map.width && py >= 0 && py <= map.height;
}));

/* ─────────────────────────── 경로 계산기 ─────────────────────────── */

console.log('assets/routeCalculator.js');

const towerBelow = { type: 'Tower', name: 'Test Skyview Tower', layer: 'Surface', coords: [0, 0, 0] };
const shrineAbove = { type: 'Shrine', name: 'High Shrine', layer: 'Surface', coords: [0, 0, 400] };
const shrineBelow = { type: 'Shrine', name: 'Low Shrine', layer: 'Surface', coords: [0, 0, -200] };
const target = { layer: 'Surface', cave: false, coords: [1000, 0, 100] };

const tRoute = RC.estimateRoute(towerBelow, target);
const upRoute = RC.estimateRoute(shrineBelow, target);
const downRoute = RC.estimateRoute(shrineAbove, target);

check('수평 거리를 X·Y 평면에서 계산', Math.abs(tRoute.hDist - 1000) < 0.001,
  String(tRoute.hDist));
check('고도차 = W.z − B.z', downRoute.zDiff === 300, String(downRoute.zDiff));

check('조망대는 사출 고도(+800m)로 활강 거리를 확보',
  tRoute.mode === 'launch-glide' && tRoute.legs.some(l => l.kind === 'launch'),
  tRoute.mode);

check('높은 사당 → 강하 이동이 낮은 사당 → 등반보다 빠름',
  downRoute.seconds < upRoute.seconds,
  Math.round(downRoute.seconds) + 's vs ' + Math.round(upRoute.seconds) + 's');

check('상승 이동에 3배 가중치가 적용됨', (() => {
  const climbLeg = upRoute.legs.find(l => l.kind === 'climb');
  const expected = 300 / RC.MOVE.CLIMB * RC.MOVE.CLIMB_WEIGHT;
  return climbLeg && Math.abs(climbLeg.seconds - expected) < 0.001;
})());

const depthsBoss = { layer: 'Depths', cave: false, coords: [1000, 0, -600] };
check('지상 → 지저 계층 패널티가 붙음',
  RC.estimateRoute(shrineAbove, depthsBoss).layerPenalty === RC.LAYER_PENALTY['Surface>Depths']);

check('하늘 → 지상은 계층 패널티 없음',
  RC.estimateRoute({ type: 'Shrine', name: 'Sky Shrine', layer: 'Sky', coords: [0, 0, 1200] }, target).layerPenalty === 0);

check('추천 결과는 최대 3개이며 시간 오름차순', (() => {
  const top = RC.recommendRoutes(bosses[0], waypoints, 3);
  return top.length === 3 && top[0].seconds <= top[1].seconds && top[1].seconds <= top[2].seconds;
})());

check('모든 보스가 유한한 추천 시간을 가짐', bosses.every(b => {
  const top = RC.recommendRoutes(b, waypoints, 1);
  return top.length === 1 && Number.isFinite(top[0].seconds) && top[0].seconds > 0;
}));

check('가이드 문구 형식', /^🚀 추천: \[.+\] \(.+\)$/.test(RC.describe(tRoute)), RC.describe(tRoute));

check('방위 계산: 북 / 동 / 남 / 서', (() => {
  const b = (dx, dy) => RC.bearingText(RC.bearing([0, 0], [dx, dy]));
  return b(0, 100) === '↑ 북' && b(100, 0) === '→ 동' &&
         b(0, -100) === '↓ 남' && b(-100, 0) === '← 서';
})(), ['북', '동', '남', '서'].map((_, i) =>
  RC.bearingText(RC.bearing([0, 0], [[0, 100], [100, 0], [0, -100], [-100, 0]][i]))).join(' '));

check('방위 계산: 대각선 4방위', (() => {
  const b = (dx, dy) => RC.bearingText(RC.bearing([0, 0], [dx, dy]));
  return b(100, 100) === '↗ 북동' && b(100, -100) === '↘ 남동' &&
         b(-100, -100) === '↙ 남서' && b(-100, 100) === '↖ 북서';
})());

check('경로 결과에 방위가 들어 있음', (() => {
  const r = RC.estimateRoute(waypoints[0], bosses[0]);
  return Number.isFinite(r.bearing) && r.bearing >= 0 && r.bearing < 360;
})());

check('워프 지점 이름은 한글 표기를 사용', (() => {
  const tower = waypoints.find(w => w.type === 'Tower');
  return RC.waypointLabel(tower) === tower.nameKo && hangul(RC.waypointLabel(tower));
})(), RC.waypointLabel(waypoints.find(w => w.type === 'Tower')));

/* ─────────────────────────── 배포 파일 ─────────────────────────── */

console.log('배포 파일');
for (const f of ['index.html', 'manifest.json', 'sw.js', 'assets/app.js', 'assets/app.css',
                 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) {
  check(f + ' 존재', fs.existsSync(path.join(root, f)));
}

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const precached = sw.match(/'\.\/[^']*'/g).map(s => s.slice(3, -1)).filter(Boolean);
check('서비스 워커가 캐시하는 파일이 모두 존재',
  precached.every(f => fs.existsSync(path.join(root, f))),
  precached.filter(f => !fs.existsSync(path.join(root, f))).join(', '));

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
// app.js 가 참조하는 #id 셀렉터가 실제로 index.html 에 있는지 (오타 방지)
const wanted = new Set([...appJs.matchAll(/[$(]\('#([\w-]+)'\)/g)].map(m => m[1]));
const missingIds = [...wanted].filter(id => !htmlIds.has(id));
check('app.js 가 참조하는 모든 id 가 index.html 에 존재', missingIds.length === 0,
  missingIds.join(', '));

// 서랍 메뉴와 전체 화면이 짝을 이루는지
const screens = [...html.matchAll(/data-screen="([\w-]+)"/g)].map(m => m[1]);
check('서랍 메뉴마다 대응하는 화면이 존재',
  screens.length === 3 && screens.every(v => htmlIds.has('view-' + v)),
  screens.filter(v => !htmlIds.has('view-' + v)).join(', '));

check('지도가 기본 화면 (전체 화면 패널은 모두 닫힌 채 시작)',
  /<section id="view-\w+" class="screen" hidden>/.test(html) &&
  (html.match(/class="screen" hidden/g) || []).length === screens.length);

check('메뉴가 햄버거 안에 들어감',
  htmlIds.has('menuBtn') && htmlIds.has('drawer') && !html.includes('class="tabs"'));

// 지도 화면에 떠 있는 것은 햄버거와 (숨겨진) 선택 시트뿐이어야 한다
const mapwrap = html.slice(html.indexOf('<div class="mapwrap">'), html.indexOf('</main>'));
const floating = [...mapwrap.matchAll(/<(button|div|svg)[^>]*\sid="([\w-]+)"/g)].map(m => m[2]);
check('지도 위에는 햄버거와 선택 시트만',
  floating.length === 3 && floating.includes('mapSvg') &&
  floating.includes('menuBtn') && floating.includes('mapInfo'),
  floating.join(', '));

check('계층 · 찾기 · 전체 보기는 서랍 안',
  html.indexOf('id="mapLayerChips"') > html.indexOf('<aside id="drawer"') &&
  html.indexOf('id="mapSearch"') > html.indexOf('<aside id="drawer"') &&
  html.indexOf('id="zoomReset"') > html.indexOf('<aside id="drawer"'));

check('첫 실행에 워프 포인트를 전부 해금',
  appJs.includes('KEY.seeded') &&
  /seeded[\s\S]{0,400}state\.waypoints\.map/.test(appJs));

// manifest 의 아이콘·시작 경로가 실제로 존재하는지
const manifest = readJson('manifest.json');
const badIcons = manifest.icons.map(i => i.src).filter(src => !fs.existsSync(path.join(root, src)));
check('manifest 아이콘 파일이 모두 존재', badIcons.length === 0, badIcons.join(', '));
check('manifest 경로가 상대 경로 (하위 경로 배포 대응)',
  manifest.start_url.startsWith('./') && manifest.scope.startsWith('./'));
check('manifest 바로가기의 쿼리를 app.js 가 처리',
  appJs.includes('applyLaunchParams') && appJs.includes('URLSearchParams'));

// 지도 카테고리가 실제 데이터의 종류와 맞는지
const catKeys = [...appJs.matchAll(/\{ key: '(\w+)'/g)].map(m => m[1]);
const realTypes = new Set([...bosses.map(b => b.type), ...waypoints.map(w => w.type)]);
check('지도 카테고리 5종이 데이터의 종류와 일치',
  catKeys.length === 5 && catKeys.every(k => realTypes.has(k)) &&
  realTypes.size === catKeys.length,
  catKeys.join(',') + ' vs ' + [...realTypes].join(','));

// 지도에서 조작하는 버튼들이 실제로 처리되는지
for (const [attr, handler] of [['data-kill', 'toggleKill'], ['data-unlock', 'toggleWaypoint'],
                               ['data-center', 'focusOnMap'], ['data-close', 'state.sel = null']]) {
  check('지도 패널의 ' + attr + ' 를 처리함',
    appJs.includes(attr) && appJs.includes(handler));
}
// setPointerCapture 를 걸면 pointerup 의 target 이 svg 로 바뀌므로,
// 눌린 마커는 pointerdown 시점에 기억해 두어야 한다 (실제로 났던 버그)
check('마커 선택을 pointerdown 시점의 대상으로 판정',
  appJs.includes('downMarker') &&
  /pointerdown[\s\S]{0,200}downMarker = /.test(appJs) &&
  !/function release[\s\S]{0,300}e\.target\.closest\('\.mk'\)/.test(appJs));

check('새 서비스 워커가 뜨면 새로고침해 최신 코드를 씀',
  appJs.includes('controllerchange') && appJs.includes('location.reload'));

// zeldamaps 링크 호환 — map 번호는 그쪽 API 에서 확인한 값이다
check('zeldamaps map 번호가 계층에 대응',
  /'2101': 'Surface'/.test(appJs) && /'2102': 'Sky'/.test(appJs) &&
  /'2103': 'Depths'/.test(appJs));
check('zeldamaps 주소를 열거나 붙여넣으면 이동',
  appJs.includes('parseZeldaMaps') && appJs.includes('data-spot') &&
  appJs.includes('zmViewWidth'));

check('지도 상태가 주소창에 반영됨',
  appJs.includes('syncUrl') && appJs.includes('history.replaceState'));
check('주소창의 layer/x/y/z/sel 을 복원함',
  ['layer', 'sel', 'x', 'y', 'z'].every(k => appJs.includes("params.get('" + k + "')")));

// 아이콘 심볼을 app.js 와 index.html 이 같은 이름으로 쓰는지
const symbols = new Set([...html.matchAll(/<symbol id="([\w-]+)"/g)].map(m => m[1]));
const used = new Set([...(html + appJs).matchAll(/['"]#(i-[\w-]+)['"]?/g)].map(m => m[1]));
check('참조하는 아이콘 심볼이 모두 정의됨',
  [...used].every(u => symbols.has(u)), [...used].filter(u => !symbols.has(u)).join(', '));

// index.html 이 참조하는 로컬 파일이 모두 존재하는지
const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m => m[1]);
const missingRefs = refs.filter(f => !fs.existsSync(path.join(root, f)));
check('index.html 이 참조하는 파일이 모두 존재', missingRefs.length === 0, missingRefs.join(', '));

console.log(failures === 0 ? '\n전체 통과' : '\n실패 ' + failures + '건');
process.exit(failures === 0 ? 0 : 1);
