import BarChart from './BarChart'
import ChartFrame from './ChartFrame'
import DumbbellChart, { type DumbbellRow } from './DumbbellChart'
import { type Tone } from './chartTokens'
import { EVAL_ROWS, MIGRATION, TOTAL_RESPONSES, bySegment, type EvalRow } from './evalData'

const MODEL_ORDER = ['gemma-4-e4b-lora-modal', 'exaone-3.5-2.4b-ollama', 'gpt-5.4-mini', 'haiku-4.5']

function ordered(rows: readonly EvalRow[]): EvalRow[] {
  return MODEL_ORDER.map((m) => rows.find((r) => r.model === m)).filter((r): r is EvalRow => !!r)
}

/** 채택한 백엔드만 강조하고 나머지는 물러나게 한다 */
const isPick = (r: EvalRow) => r.model === MIGRATION.to

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`

/**
 * 여러 턴 이어지는 대화에서의 응답 지연.
 *
 * 이 차트가 교체 판단의 핵심이다. 평균만 보면 견딜 만해 보이지만, 대화가
 * 길어지면 자체 호스팅은 꼬리가 크게 늘어진다 - 사용자가 실제로 체감하는 건
 * 평균이 아니라 이 꼬리다.
 */
export function LatencySpreadChart({ tone = 'light' }: { tone?: Tone }) {
  const rows = ordered(bySegment('multiturn'))
  const dumbbell: DumbbellRow[] = rows.map((r) => ({
    label: `${r.label}\n${r.backendNote}`,
    from: r.latencyP50 / 1000,
    to: r.latencyP95 / 1000,
    emphasis: isPick(r),
    note: `절반은 ${sec(r.latencyP50)} 안에, 느린 5%는 ${sec(r.latencyP95)}`,
  }))

  return (
    <ChartFrame
      tone={tone}
      title="여러 턴 이어지는 대화에서 응답이 얼마나 늘어지는가"
      subtitle="점 두 개는 같은 모델의 보통 응답(절반이 이 안에 들어옴)과 느린 쪽 5%다. 자체 호스팅은 대화가 길어질수록 꼬리가 크게 벌어진다."
      legend={[
        { label: '보통 응답', color: tone === 'dark' ? '#0091CC' : '#5BC0E5' },
        { label: '느린 5%', color: tone === 'dark' ? '#A8DEF2' : '#0062DF' },
      ]}
      table={{
        columns: ['모델', '서빙 방식', '보통 응답', '느린 5%', '표본'],
        rows: rows.map((r) => [r.label, r.backendNote, sec(r.latencyP50), sec(r.latencyP95), `${r.n}건`]),
      }}
      footnote="같은 질문 묶음을 네 백엔드에 동일하게 보내 측정했다. 느린 5%는 95번째 백분위수."
    >
      <DumbbellChart
        tone={tone}
        rows={dumbbell}
        domain={[0, 25]}
        ticks={[0, 5, 10, 15, 20, 25]}
        fromLabel="보통 응답"
        toLabel="느린 5%"
        unit="초"
        digits={1}
      />
    </ChartFrame>
  )
}

/**
 * 호출당 서빙 비용.
 *
 * 산정 방식이 백엔드마다 다르다는 걸 반드시 밝힌다 - 로컬이 0 으로 보이는 건
 * 공짜라서가 아니라 전기료를 계산에 넣지 않았기 때문이다. 이걸 안 적으면
 * 차트가 거짓말을 한다.
 */
export function ServingCostChart({ tone = 'light' }: { tone?: Tone }) {
  const rows = ordered(bySegment('open'))
  return (
    <ChartFrame
      tone={tone}
      title="호출 한 번에 드는 서빙 비용"
      subtitle="자체 호스팅은 GPU 를 시간 단위로 빌리기 때문에, 호출이 적은 시간대에도 비용이 계속 나간다."
      table={{
        columns: ['모델', '서빙 방식', '호출당 비용', '산정 방식'],
        rows: rows.map((r) => [
          r.label,
          r.backendNote,
          r.costUsd === 0 ? '계상 없음' : `$${r.costUsd.toFixed(6)}`,
          r.backend === 'api' ? '토큰 과금 실측' : r.backend === 'selfhost' ? 'GPU 시간을 호출당으로 환산' : '인프라 비용 0 으로 계상',
        ]),
      }}
      footnote="주의 - 값의 성격이 서로 다르다. 상용 API 는 토큰 과금 실측, 자체 호스팅은 GPU 시간(A10G 시간당 $1.10)을 호출당으로 환산한 값, 로컬 추론은 전기료를 넣지 않고 0 으로 계상했다. 로컬이 가장 싸다는 뜻이 아니다."
    >
      <BarChart
        tone={tone}
        rows={rows.map((r) => ({
          label: `${r.label}\n${r.backendNote}`,
          value: r.costUsd,
          emphasis: isPick(r),
          note:
            r.backend === 'api'
              ? '토큰 과금 실측'
              : r.backend === 'selfhost'
                ? 'GPU 시간을 호출당으로 환산 — 트래픽이 없어도 나간다'
                : '인프라 비용 0 으로 계상 (전기료 제외)',
        }))}
        format={(v) => (v === 0 ? '계상 없음' : `$${v.toFixed(6)}`)}
      />
    </ChartFrame>
  )
}

/**
 * 자료를 함께 주면 점수가 어떻게 변하는가.
 *
 * 교체를 정당화하는 두 번째 축이다. 품질이 대등하다는 걸 먼저 보여야
 * "그래서 지연과 비용으로 골랐다"는 말이 성립한다.
 */
export function GroundingEffectChart({ tone = 'light' }: { tone?: Tone }) {
  const closed = ordered(bySegment('closed'))
  const open = ordered(bySegment('open'))
  const dumbbell: DumbbellRow[] = closed.map((c) => {
    const o = open.find((r) => r.model === c.model)!
    return {
      label: `${c.label}\n${c.backendNote}`,
      from: c.score,
      to: o.score,
      emphasis: isPick(c),
      note: `자료를 주면 ${(o.score - c.score).toFixed(2)}점 올라간다`,
    }
  })

  return (
    <ChartFrame
      tone={tone}
      title="자료를 함께 주면 점수가 얼마나 오르는가"
      subtitle="모델을 무엇으로 바꾸든 자료를 붙여주는 쪽이 훨씬 크게 작용했다. 네 백앤드의 도착점이 거의 같아서, 품질만으로는 어느 하나를 고를 근거가 없었다."
      legend={[
        { label: '자료 없이', color: tone === 'dark' ? '#0091CC' : '#5BC0E5' },
        { label: '자료를 주고', color: tone === 'dark' ? '#A8DEF2' : '#0062DF' },
      ]}
      table={{
        columns: ['모델', '자료 없이', '자료를 주고', '차이', '표본'],
        rows: closed.map((c) => {
          const o = open.find((r) => r.model === c.model)!
          return [c.label, c.score.toFixed(2), o.score.toFixed(2), `+${(o.score - c.score).toFixed(2)}`, `${c.n * 2}건`]
        }),
      }}
      footnote={`1~5점 척도로 채점했다. 표본 ${TOTAL_RESPONSES}개 응답 전체를 같은 기준으로 채점했고, 점수는 조건별 평균이다.`}
    >
      <DumbbellChart
        tone={tone}
        rows={dumbbell}
        domain={[1, 5]}
        ticks={[1, 2, 3, 4, 5]}
        fromLabel="자료 없이"
        toLabel="자료를 주고"
        digits={2}
      />
    </ChartFrame>
  )
}

/** 세 차트를 한 번에 - 포폴 섹션에 그대로 얹는 용도 */
export default function LlmBackendCharts({ tone = 'light' }: { tone?: Tone }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <LatencySpreadChart tone={tone} />
      <ServingCostChart tone={tone} />
      <GroundingEffectChart tone={tone} />
    </div>
  )
}

export { EVAL_ROWS }
