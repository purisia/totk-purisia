# 하이랄 필드 보스 트래커

젤다의 전설 티어스 오브 더 킹덤의 **필드 보스 190기**(라이넬 · 히녹스 · 바위록)를
추적하고, 해금한 워프 포인트에서 각 보스까지 **가장 빠른 접근 경로 Top 3**를
고도(Z축)와 이동 수단까지 반영해 추천하는 PWA입니다.

외부 데이터베이스가 없습니다. 데이터는 저장소 안의 정적 JSON, 사용자 기록은
브라우저 localStorage에만 저장되며, GitHub Pages에 그대로 올라갑니다.

## 기능

**화면 전체가 지도입니다.** 지도 위에 보이는 것은 왼쪽 위 햄버거(☰) 하나뿐이고,
나머지 조작은 전부 그 안에 들어 있습니다.

### 지도

- 끌어서 이동, 휠 · 두 손가락으로 확대, 더블클릭으로 지도 전체 보기.
- **3계층** — 하늘 · 지상 · 지저 전환은 서랍의 "계층"에서.
- **지역 이름** — 294곳의 지명을 한국어로 지도에 얹습니다. 확대할수록 촘촘한 지명이
  드러나고, 화면에서 일정 간격 이상 떨어진 것만 남겨 겹치지 않게 합니다.
- **마커** — 뾰족한 끝이 실제 좌표를 가리키는 물방울 핀. 종류별 색과 흰 글리프
  (라이넬=화살, 히녹스=외눈, 바위록=수정, 조망대=탑, 사당=사당 입구).
- **아이콘을 누르면 어디서 출발할지** — 보스를 고르면 추천 워프 3곳이 화살표 선으로 그려지고,
  경로마다 `↗ 북동 1457m · 강하 321m` 처럼 **방위 · 수평 거리 · 고도 변화**가 나옵니다.
  사당 · 조망대를 고르면 반대로 "여기서 가까운 미처치 보스"를 방향과 함께 보여줍니다.
- **바로 체크** — 올라온 시트에서 보스 처치 체크, 사당 · 조망대 해금 체크를 그 자리에서.
- **주소창 딥링크** — `?layer=Surface&x=-3378&y=30&z=5&sel=boss:lynel-020` 이 주소에 남아
  링크를 공유하거나 새로고침해도 같은 화면이 뜹니다.
- **zeldamaps 링크 호환** — [zeldamaps.com](https://zeldamaps.com) 도 같은 게임 좌표를
  주소에 쓰므로, 그쪽 링크를 서랍의 찾기 칸에 붙여넣거나 파라미터를 그대로 이 앱 주소에
  붙이면 같은 지점이 열립니다.

  | zeldamaps | 뜻 |
  | --- | --- |
  | `map=2101` | 지상 |
  | `map=2102` | 하늘 |
  | `map=2103` | 지저 |
  | `x`, `y` | 게임 좌표 (우리와 동일) |
  | `zoom` | Leaflet 줌 단계 — `scaleP = 0.0117188`(줌 0에서 1px = 85.33유닛)로 환산 |

  map 번호는 zeldamaps 의 `ajax.php?command=get_map&game=21` 응답에서 확인했습니다.

### 햄버거 메뉴

- **찾기** — 보스 · 사당 · 조망대 · 지역을 한글/영문으로 검색해 지도로 이동
- **계층** — 하늘 · 지상 · 지저
- **지도에 표시** — 라이넬 · 히녹스 · 바위록 · 조망대 · 사당 토글(각 버튼에 진행도 `152/152`),
  처치 완료 숨기기, 지도 전체 보기
- **붉은 달** — 처치 기록만 일괄 초기화(워프 해금 상태는 유지)
- **보스 목록** — 190기를 추천 이동 시간 · 지역 · 고도 순으로 정렬, 🗺 로 지도 이동
- **워프 포인트** — 사당 152 + 조망대 15 해금 관리. **처음 실행하면 전부 해금된 상태**이며,
  아직 못 연 곳만 잠그면 됩니다
- **정보 · 데이터** — 계산 방식, 출처, 기록 내보내기 · 불러오기 · 초기화

서비스 워커가 앱 셸과 지도 · 데이터를 모두 캐시해 **오프라인**에서도 그대로 동작합니다.

## 구조

```
index.html                  앱 셸 (지도 화면 + 서랍 + 전체 화면 패널)
assets/app.css              스타일
assets/app.js               UI · localStorage 상태 관리
assets/routeCalculator.js   고도 가중치 경로 계산 (UI 비의존, Node에서도 실행 가능)
data/bosses.json            보스 190기
data/waypoints.json         사당 152 + 조망대 15
manifest.json, sw.js        PWA
icons/                      아이콘 (tools/make_icons.py 로 생성)
tools/build_data.py         공개 덤프 → data/*.json 재생성
tools/verify.js             데이터 · 계산기 검증 (CI에서 실행)
.github/workflows/deploy.yml  main push 시 GitHub Pages 자동 배포
```

## 경로 계산 방식

`assets/routeCalculator.js` 는 워프 지점 W에서 보스 B까지의 **예상 이동 시간(초)**
을 계산하고, 그 값이 작은 순으로 상위 3개를 돌려줍니다.

| 요소 | 값 |
| --- | --- |
| 수평 거리 | `H = √((Wx−Bx)² + (Wy−By)²)` |
| 고도차 | `Z_diff = Wz − Bz` |
| 패러세일 | 수평 12 m/s, 강하 4.5 m/s → **활강비 약 2.67** (1m 강하당 2.67m 전진) |
| 도보 | 5.5 m/s |
| 등반 | 2.0 m/s에 **3배 패널티** |
| 조망대 | 사출 고도 **Wz + 800 m**, 사출 연출 12초 |
| 강하 우대 | 활강 구간에 0.9배 가중치 |
| 워프 로딩 | 15초 |
| 동굴 보스 | 진입 45초 |
| 방위 | `atan2(Bx−Wx, By−Wy)` 를 8방위(북 · 북동 … 북서)로 표시 |

계층 이동 패널티(초):

| | → 하늘 | → 지상 | → 지저 |
| --- | --- | --- | --- |
| **하늘에서** | 0 | 0 (그대로 낙하) | 260 |
| **지상에서** | 240 | 0 | 200 |
| **지저에서** | 420 | 300 | 0 |

계산 흐름은 이렇습니다.

1. 조망대면 `Wz + 800`, 사당이면 `Wz` 를 출발 고도로 잡는다.
2. 출발 고도가 보스보다 높으면(`drop > 0`) 활강비만큼 수평 거리를 커버하고,
   모자란 거리는 도보로 채운다.
3. 출발 고도가 더 낮으면 도보 + 등반이며, 등반 시간에 3배 가중치가 붙는다.
4. 계층이 다르면 위 표의 패널티를 더한다.

지형(절벽 · 용암 · 상승기류)은 반영하지 않는 **순위 매기기용 추정치**입니다.

## 데이터

| 파일 | 내용 |
| --- | --- |
| `data/bosses.json` | 라이넬 34 · 히녹스 69 · 바위록 87 = **190기**. `id, type, name, nameKo, variant, region, regionKo, layer, cave, coords[X,Y,Z]` |
| `data/waypoints.json` | 사당 **152**(지상 120 / 하늘 32) + 조망대 **15**. `id, type, name, nameKo, internalName, region, regionKo, layer, coords[X,Y,Z]` |
| `data/map.json` + `data/map-*.webp` | 계층별 지도 배경(4410×3690, 1픽셀 = 2.67m)과 좌표 → 픽셀 변환 기준값 |
| `data/labels.json` | 지도에 얹는 지명 294곳 (한국어) |

좌표는 게임 내 표시 좌표계입니다. `X` 동(+)/서(−), `Y` 북(+)/남(−), `Z` 고도.

### 출처와 재생성

- [lud99/totk-unexplored](https://github.com/lud99/totk-unexplored) `romfs/map_data.json` — 사당 152, 빛뿌리 120, 히녹스 69, 바위록 87 / `romfs/map/*-small.png` — 계층별 지도 이미지
- [vetyst/TotK-Object-Map](https://github.com/vetyst/TotK-Object-Map) `data/v1.2.0/` — 라이넬 배치, 보스 종류(액터명) 판별, 조망대 15곳, 지역명
- [gamertw.com 한국어판](https://www.gamertw.com/ko/zelda/totk/shrine) — 페이지에 실린 i18n 사전에서 영문 → 한국어 표기 1,856쌍을 받아 `tools/ko-dict.json` 으로 고정. 사당 152/152, 조망대 15/15, 지역 190/190 이 이 사전으로 한글화된다

두 덤프는 좌표계가 서로 다릅니다. 교차 대조로 확인한 변환은 이렇습니다.

- `map_data.json`(엔진 좌표, y가 고도, 마커 오프셋 +105.5) → `(X, Y, Z) = (x, −z, y − 105.5)`
- vetyst 덤프 → `(X, Y, Z) = (y, x, z)`

사당의 계층은 **지상 사당 120곳이 지저의 빛뿌리 120곳과 1:1로 수직 대응한다**는
성질을 이용해 판정합니다. 일대일 매칭 후 남는 32곳이 하늘 사당입니다.

재생성하려면 원본 덤프를 받아 두고:

```bash
mkdir -p /tmp/totk && cd /tmp/totk
curl -LO https://raw.githubusercontent.com/lud99/totk-unexplored/main/romfs/map_data.json
base=https://raw.githubusercontent.com/vetyst/TotK-Object-Map/master/data/v1.2.0
curl -LO $base/locations.json
curl -LO $base/layers/surface.json
curl -LO $base/layers/depths.json
curl -LO $base/layers/sky.json
curl -LO $base/layers/cave.json

# 지도 이미지
curl -LO https://raw.githubusercontent.com/lud99/totk-unexplored/main/romfs/map/surface-small.png
curl -LO https://raw.githubusercontent.com/lud99/totk-unexplored/main/romfs/map/sky-small.png
curl -LO https://raw.githubusercontent.com/lud99/totk-unexplored/main/romfs/map/depths-small.png

cd -                       # 저장소 루트로
python tools/build_data.py /tmp/totk
python tools/make_maps.py /tmp/totk
node tools/verify.js
```

### 지도 좌표 보정

지도 이미지는 4500×4500(medium)이고 게임 좌표 −6000..6000 을 덮는다(1픽셀 = 8/3m,
이미지 중심 = 원점). `tools/make_maps.py` 가 여백을 잘라 4410×3690 WebP 로
다시 인코딩하고, 그때의 기준점을 `data/map.json` 에 적어 둔다. 보정값은
감시 요새 · 고론 시티 · 리토 마을 · 카카리코 · 하테노 · 루렐린 · 타레이 타운의
좌표를 지도 위에 얹어 실제 위치와 일치하는 것을 확인해 정했다.

## 로컬 실행

`fetch()` 를 쓰기 때문에 `file://` 로는 열리지 않습니다. 정적 서버가 필요합니다.

```bash
python -m http.server 8000
# http://localhost:8000
```

검증:

```bash
node tools/verify.js
```

## 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml` 이 `tools/verify.js` 를
실행한 뒤 저장소 루트를 그대로 GitHub Pages에 올립니다. 빌드 단계는 없습니다.

저장소 **Settings → Pages → Build and deployment → Source** 를
**GitHub Actions** 로 한 번 바꿔 두면 됩니다.

모든 경로가 상대 경로이므로 `https://<user>.github.io/<repo>/` 같은 하위 경로에서도
그대로 동작합니다.

## 라이선스

코드는 MIT입니다. 좌표 데이터는 위 오픈소스 프로젝트의 덤프에서 가공했습니다.

`data/map-*.webp` 의 지도 이미지와 게임 내 명칭은 닌텐도의 저작물을 추출·가공한
것이므로 재배포·상업적 이용에는 적합하지 않습니다. 개인 용도로만 사용하세요.
젤다의 전설 및 관련 명칭은 닌텐도의 상표이며, 이 프로젝트는 팬 제작물로
닌텐도와 무관합니다.
