/**
 * 차트 전용 토큰.
 *
 * 색을 눈으로 고르지 않았다. 포폴 액센트(nexonBlue) 한 색에서 뽑은 명도 단계를
 * ordinal 램프로 검증해 통과한 값만 남겼다 - 모델 4종을 4색으로 칠하면 포폴의
 * "액센트 1색" 원칙이 깨지고, 카테고리컬 팔레트는 CVD 검증도 통과하지 못했다.
 *
 * 검증값 (OKLab 기반, 2026-08-17):
 *   라이트 램프 #5BC0E5 → #0091CC → #0062DF : 명도 단조 PASS · 인접 ΔL PASS · 단일 색조 34도
 *   다크  램프 #A8DEF2 → #5BC0E5 → #0091CC : 명도 단조 PASS · 인접 ΔL PASS · 단일 색조 14도
 *
 * 서피스 대비 (마크 기준 3:1):
 *   라이트(#F7F9FC) — #0062DF 5.22 · #0091CC 3.36 · #5BC0E5 1.97 · #8A95A6 2.87
 *   다크(#070B14)  — #A8DEF2 13.49 · #5BC0E5 9.48 · #0091CC 5.55 · #8A95A6 6.50
 *
 * 라이트의 #5BC0E5 와 #8A95A6 은 3:1 미달이다. 그래서 이 램프를 쓰는 차트는
 * 직접 라벨과 표 보기를 반드시 함께 낸다 - 색만으로 값을 읽게 두지 않는다.
 */

export type Tone = 'light' | 'dark'

export type ChartTheme = {
  surface: string
  ink: string
  inkSoft: string
  inkMuted: string
  grid: string
  /** 비교의 "이전"/약한 쪽 */
  rampLow: string
  /** 기본 마크 */
  rampMid: string
  /** 강조 = 이야기의 주인공 */
  rampHigh: string
  /** 주인공이 아닌 계열 */
  muted: string
}

export const THEME: Record<Tone, ChartTheme> = {
  light: {
    surface: '#F7F9FC',
    ink: '#0A1224',
    inkSoft: '#3F4A5F',
    inkMuted: '#8A95A6',
    grid: 'rgba(10, 18, 36, 0.10)',
    rampLow: '#5BC0E5',
    rampMid: '#0091CC',
    rampHigh: '#0062DF',
    muted: '#8A95A6',
  },
  dark: {
    surface: '#070B14',
    ink: '#F2F5FA',
    inkSoft: '#C3CCDA',
    inkMuted: '#8A95A6',
    grid: 'rgba(242, 245, 250, 0.12)',
    rampLow: '#0091CC',
    rampMid: '#5BC0E5',
    rampHigh: '#A8DEF2',
    muted: '#8A95A6',
  },
}

export const FONT_MONO =
  '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
export const FONT_BODY = 'Paperlogy, system-ui, sans-serif'

/** 마크 규격 - 차트 사이에서 흔들리면 안 되는 값 */
export const MARK = {
  /** 막대는 슬롯을 다 채우지 않는다. 남는 폭이 여백 역할을 한다 */
  barMaxThickness: 24,
  /** 데이터가 끝나는 쪽만 둥글게, 기준선 쪽은 각지게 */
  barEndRadius: 4,
  lineWidth: 2,
  /** 점은 8px 이상이어야 눈에 걸린다 */
  dotRadius: 5,
  /** 겹치는 점이 서로 먹지 않도록 서피스 색으로 두르는 두께 */
  ringWidth: 2,
  /** 맞닿은 마크를 가르는 것은 선이 아니라 서피스 색 틈이다 */
  surfaceGap: 2,
  /** 점보다 넉넉해야 포인터가 잡힌다 */
  hitSize: 24,
} as const
