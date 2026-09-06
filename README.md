# 하이랄 필드 보스 트래커

젤다의 전설 티어스 오브 더 킹덤의 **필드 보스 190기**(라이넬 · 히녹스 · 바위록)를
추적하고, 해금한 워프 포인트에서 각 보스까지 **가장 빠른 접근 경로 Top 3**를
고도(Z축)와 이동 수단까지 반영해 추천하는 PWA입니다.

외부 데이터베이스가 없습니다. 데이터는 저장소 안의 정적 JSON, 사용자 기록은
브라우저 localStorage에만 저장되며, GitHub Pages에 그대로 올라갑니다.

## 기능

- **보스 트래커** — 190기의 처치 여부 체크, 종류 · 계층 · 처치 상태 · 지역 검색 필터
- **붉은 달** — 버튼 한 번으로 처치 기록만 일괄 초기화(워프 해금 상태는 유지)
- **워프 경로 추천** — 보스 카드마다 `🚀 추천: [Lookout Landing 조망대] (사출 후 활강 약 1분 12초)` 형태의 가이드와 2·3순위 대안
- **워프 포인트 관리** — 사당 152곳 + 조망대 15곳의 해금 상태 개별/일괄 토글
- **지도** — 하늘 · 지상 · 지저 3계층 지도 위에 보스와 워프 포인트를 표시. 끌어서 이동, 휠·핀치 확대, 아이콘을 누르면 추천 경로가 선으로 그려집니다. 보스 카드의 🗺 버튼을 누르면 지도가 해당 위치로 이동합니다.
- **한국어 표기** — 사당 152곳, 조망대 15곳, 보스 종류, 지역 190곳 모두 게임의 한국어 명칭을 사용합니다
- **오프라인 / 홈 화면 추가** — 서비스 워커가 앱 셸과 데이터를 전부 캐시
- **기록 내보내기 / 불러오기** — JSON 파일로 백업·이전

## 구조

```
index.html                  앱 셸
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
| `data/map.json` + `data/map-*.webp` | 계층별 지도 배경과 좌표 → 픽셀 변환 기준값 |

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

지도 이미지는 1500×1500 이고 게임 좌표 −6000..6000 을 덮는다(1픽셀 = 8m,
이미지 중심 = 원점). `tools/make_maps.py` 가 여백을 잘라 1470×1230 WebP 로
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
