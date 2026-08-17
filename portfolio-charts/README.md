# portfolio-charts

포트폴리오에 얹는 차트·다이어그램 컴포넌트. **자체 호스팅 파인튜닝 모델에서 상용 API 로
갈아탄 판단**을 세 축으로 보여준다 — 도구를 누가 고르는가, 말투를 어디서 만드는가,
비용이 무엇에 붙는가.

이 레포에는 빌드 설정이 없다. 파일을 그대로 복사해서 쓰는 것을 전제로 만들었다.

## 쓰는 법

`react` 만 있으면 된다. 폴더를 통째로 복사한 뒤:

```tsx
import LlmBackendCharts from './portfolio-charts/LlmBackendCharts'

<LlmBackendCharts tone="light" />   // tone="dark" 도 된다
```

차트를 따로 쓰려면:

```tsx
import {
  LatencySpreadChart,    // 긴 대화에서 응답이 늘어지는 정도
  ServingCostChart,      // 호출당 서빙 비용
  GroundingEffectChart,  // 자료를 주면 점수가 오르는 정도
} from './portfolio-charts'
```

다이어그램은 `mermaid` 를 따로 설치해야 한다(`npm i mermaid`). 안 쓸 거면
`MermaidDiagram.tsx` 만 빼면 나머지는 그대로 빌드된다.

```tsx
import MermaidDiagram from './portfolio-charts/MermaidDiagram'
import { LOCAL_LANGGRAPH, API_TOOL_CALLING } from './portfolio-charts/diagrams'

<MermaidDiagram chart={LOCAL_LANGGRAPH} tone="light" />
```

빈 차트 껍데기가 필요하면 `ChartFrame` 에 `DumbbellChart` / `BarChart` 를 직접 넣어도 된다.

## 미리보기

빌드 도구 없이 열린다. `react` 와 `mermaid` 는 CDN 에서 받는다.

```bash
cd portfolio-charts/preview
python3 -m http.server 8931
# http://127.0.0.1:8931
```

컴포넌트를 고친 뒤에는 번들을 다시 만든다.

```bash
cd portfolio-charts
npx esbuild preview/preview.tsx --bundle --format=esm --jsx=automatic \
  --external:react --external:react/jsx-runtime \
  --external:react-dom --external:react-dom/client --external:mermaid \
  --outfile=preview/preview.js
```

## 파일

| 파일 | 역할 |
|---|---|
| `evalData.ts` | 실측 데이터 SSoT. 응답 520개 채점 결과를 집계한 값 |
| `diagrams.ts` | 머메이드 문자열 5종 |
| `LlmBackendCharts.tsx` | 세 차트를 데이터에 물려 놓은 완성 섹션 |
| `ChartFrame.tsx` | 제목·부제·범례·표 보기·각주를 감싸는 껍데기 |
| `DumbbellChart.tsx` | "이전 → 이후" 두 값을 한 줄에 놓는 차트 |
| `BarChart.tsx` | 항목별 값 비교 |
| `MermaidDiagram.tsx` | 머메이드 렌더 (mermaid 필요) |
| `chartTokens.ts` | 색·마크 규격. 검증 근거가 주석에 있다 |

## 데이터를 고쳐야 할 때

`evalData.ts` 는 **손으로 쓰지 않았다.** 채점 원본(`graded_*.jsonl`)을 집계하는
스크립트로 생성한 파일이다. 수치를 바꿔야 하면 원본을 다시 집계해서 이 파일을 교체한다.
직접 숫자를 고치면 원본과 어긋나고, 어긋난 건 아무도 눈치채지 못한다.

## 지켜야 할 것 두 가지

**하나. 비용 값은 성격이 다르다.** 상용 API 는 토큰 과금 실측이고, 자체 호스팅은 GPU
시간을 호출당으로 환산한 값이고, 로컬 추론은 전기료를 넣지 않아 0 으로 계상돼 있다.
그래서 `ServingCostChart` 는 각주로 이 차이를 반드시 밝힌다 — 각주를 지우면 "로컬이
가장 싸다"는 잘못된 결론을 만든다.

**둘. 색을 늘리지 마라.** 모델이 네 종이지만 네 가지 색으로 칠하지 않았다. 액센트 한
색에서 뽑은 명도 단계이고, 그 단계는 색각 이상·대비 검증을 통과한 값이다. 계열을
색으로 구분하고 싶으면 강조 하나 + 나머지 회색이 맞다. 연한 단계는 배경 대비가
3:1 을 못 넘기므로 **직접 라벨과 표 보기를 항상 함께 낸다** — 색만으로 값을 읽게 두지 않는다.
