/**
 * LLM 백엔드 비교 실측 데이터 — SSoT
 *
 * 자체 호스팅 파인튜닝 모델에서 상용 API 로 갈아탄 판단의 근거다.
 * 응답 520개를 채점한 결과를 집계했고, 손으로 옮기지 않고 스크립트로 생성했다.
 *
 * 측정: 모델 4종에 같은 질문을 던져 GPT-4o-mini 가 1~5점으로 채점.
 *   closed    = 참고 자료 없이 답하게 한 경우 (모델이 아는 것만으로)
 *   open      = 참고 자료를 함께 준 경우 (검색 결과를 붙여줌)
 *   multiturn = 여러 턴 이어지는 대화
 *
 * 비용 주의 — 성격이 다른 값이다. 한 축에 놓고 단순 비교하면 오해를 만든다.
 *   상용 API   : 토큰 과금 실측
 *   자체 호스팅: GPU 시간을 호출당으로 환산 (A10G 시간당 $1.10 기준)
 *   로컬 추론  : 인프라 비용 0 으로 계상 (전기료는 계산에 없다)
 */

export type Backend = "selfhost" | "local" | "api"
export type Segment = "closed" | "open" | "multiturn"

export type EvalRow = {
  segment: Segment
  model: string
  label: string
  backend: Backend
  backendNote: string
  n: number
  /** 1~5점 평균 */
  score: number
  /** 사실과 다른 내용을 말한 응답 비율 (%) */
  hallucinationPct: number
  latencyP50: number
  latencyP95: number
  /** 호출당 비용(USD). 산정 방식이 백엔드마다 다르다 — 위 주석 참고 */
  costUsd: number
}

export const SEGMENT_LABEL: Record<Segment, string> = {
  closed: "자료 없이 답하기",
  open: "자료를 함께 주고 답하기",
  multiturn: "여러 턴 이어지는 대화",
}

export const EVAL_ROWS: readonly EvalRow[] = [
  {
    segment: "closed", model: "gemma-4-e4b-lora-modal",
    label: "Gemma 4 E4B + LoRA", backend: "selfhost", backendNote: "Modal A10G 자체 호스팅",
    n: 60, score: 1.78,
    hallucinationPct: 28.3,
    latencyP50: 5187, latencyP95: 8823, costUsd: 0.001200,
  },
  {
    segment: "closed", model: "exaone-3.5-2.4b-ollama",
    label: "EXAONE 3.5 2.4B", backend: "local", backendNote: "Ollama 로컬 추론",
    n: 60, score: 1.52,
    hallucinationPct: 75.0,
    latencyP50: 738, latencyP95: 1188, costUsd: 0.000000,
  },
  {
    segment: "closed", model: "gpt-5.4-mini",
    label: "GPT-5.4 mini", backend: "api", backendNote: "상용 API",
    n: 60, score: 2.13,
    hallucinationPct: 48.3,
    latencyP50: 1237, latencyP95: 1950, costUsd: 0.000411,
  },
  {
    segment: "closed", model: "haiku-4.5",
    label: "Claude Haiku 4.5", backend: "api", backendNote: "상용 API · 채택",
    n: 60, score: 1.82,
    hallucinationPct: 31.7,
    latencyP50: 1474, latencyP95: 2100, costUsd: 0.000801,
  },
  {
    segment: "open", model: "gemma-4-e4b-lora-modal",
    label: "Gemma 4 E4B + LoRA", backend: "selfhost", backendNote: "Modal A10G 자체 호스팅",
    n: 60, score: 4.78,
    hallucinationPct: 3.3,
    latencyP50: 6097, latencyP95: 9026, costUsd: 0.001200,
  },
  {
    segment: "open", model: "exaone-3.5-2.4b-ollama",
    label: "EXAONE 3.5 2.4B", backend: "local", backendNote: "Ollama 로컬 추론",
    n: 60, score: 4.22,
    hallucinationPct: 13.3,
    latencyP50: 663, latencyP95: 1094, costUsd: 0.000000,
  },
  {
    segment: "open", model: "gpt-5.4-mini",
    label: "GPT-5.4 mini", backend: "api", backendNote: "상용 API",
    n: 60, score: 4.80,
    hallucinationPct: 5.0,
    latencyP50: 1106, latencyP95: 1532, costUsd: 0.000406,
  },
  {
    segment: "open", model: "haiku-4.5",
    label: "Claude Haiku 4.5", backend: "api", backendNote: "상용 API · 채택",
    n: 60, score: 4.73,
    hallucinationPct: 6.7,
    latencyP50: 1186, latencyP95: 2063, costUsd: 0.000795,
  },
  {
    segment: "multiturn", model: "gemma-4-e4b-lora-modal",
    label: "Gemma 4 E4B + LoRA", backend: "selfhost", backendNote: "Modal A10G 자체 호스팅",
    n: 10, score: 1.30,
    hallucinationPct: 30.0,
    latencyP50: 4262, latencyP95: 24720, costUsd: 0.001200,
  },
  {
    segment: "multiturn", model: "exaone-3.5-2.4b-ollama",
    label: "EXAONE 3.5 2.4B", backend: "local", backendNote: "Ollama 로컬 추론",
    n: 10, score: 2.40,
    hallucinationPct: 50.0,
    latencyP50: 1030, latencyP95: 1660, costUsd: 0.000000,
  },
  {
    segment: "multiturn", model: "gpt-5.4-mini",
    label: "GPT-5.4 mini", backend: "api", backendNote: "상용 API",
    n: 10, score: 2.60,
    hallucinationPct: 40.0,
    latencyP50: 1447, latencyP95: 2161, costUsd: 0.000438,
  },
  {
    segment: "multiturn", model: "haiku-4.5",
    label: "Claude Haiku 4.5", backend: "api", backendNote: "상용 API · 채택",
    n: 10, score: 1.80,
    hallucinationPct: 30.0,
    latencyP50: 1326, latencyP95: 2255, costUsd: 0.000823,
  },
]

export const TOTAL_RESPONSES = EVAL_ROWS.reduce((s, r) => s + r.n, 0)

/** 이관 전(자체 호스팅)과 후(채택한 API) 한 쌍 */
export const MIGRATION = {
  from: "gemma-4-e4b-lora-modal",
  to: "haiku-4.5",
} as const

export function bySegment(segment: Segment): readonly EvalRow[] {
  return EVAL_ROWS.filter((r) => r.segment === segment)
}

export function row(segment: Segment, model: string): EvalRow {
  const found = EVAL_ROWS.find((r) => r.segment === segment && r.model === model)
  if (!found) throw new Error(`no row: ${segment}/${model}`)
  return found
}
