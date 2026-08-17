import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import LlmBackendCharts from '../LlmBackendCharts'
import MermaidDiagram from '../MermaidDiagram'
import { FONT_BODY, FONT_MONO, THEME, type Tone } from '../chartTokens'
import { API_TOOL_CALLING, BACKEND_SWITCH, LOCAL_LANGGRAPH, MODEL_JOURNEY, TRADEOFF_TABLE } from '../diagrams'

function Section({
  title,
  desc,
  tone,
  children,
}: {
  title: string
  desc?: string
  tone: Tone
  children: React.ReactNode
}) {
  const t = THEME[tone]
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: FONT_BODY,
            fontSize: 'clamp(18px, 2vw, 22px)',
            fontWeight: 800,
            color: t.ink,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h2>
        {desc && (
          <p
            style={{
              margin: 0,
              fontFamily: FONT_BODY,
              fontSize: 13.5,
              lineHeight: 1.7,
              color: t.inkSoft,
              maxWidth: 760,
              wordBreak: 'keep-all',
            }}
          >
            {desc}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function DiagramCard({ title, chart, tone }: { title: string; chart: string; tone: Tone }) {
  const t = THEME[tone]
  return (
    <figure
      style={{
        margin: 0,
        padding: 'clamp(16px, 2vw, 24px)',
        background: tone === 'light' ? '#FFFFFF' : '#0F1729',
        border: `1px solid ${t.grid}`,
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <figcaption
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.1em',
          color: t.inkSoft,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </figcaption>
      <MermaidDiagram chart={chart} tone={tone} />
    </figure>
  )
}

function App() {
  const [tone, setTone] = useState<Tone>('light')
  const t = THEME[tone]

  return (
    <div
      style={{
        minHeight: '100vh',
        background: t.surface,
        padding: 'clamp(24px, 4vw, 56px) clamp(16px, 4vw, 48px)',
        transition: 'background 200ms ease',
      }}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 44 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h1
              style={{
                margin: 0,
                fontFamily: FONT_BODY,
                fontSize: 'clamp(22px, 3vw, 30px)',
                fontWeight: 800,
                color: t.ink,
                letterSpacing: '-0.03em',
              }}
            >
              파인튜닝에서 상용 API 로 — 무엇을 보고 갈아탔나
            </h1>
            <button
              type="button"
              onClick={() => setTone((v) => (v === 'light' ? 'dark' : 'light'))}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: `1px solid ${t.grid}`,
                borderRadius: 999,
                padding: '7px 14px',
                cursor: 'pointer',
                fontFamily: FONT_MONO,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: t.inkSoft,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {tone === 'light' ? '다크로 보기' : '라이트로 보기'}
            </button>
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: FONT_BODY,
              fontSize: 14,
              lineHeight: 1.75,
              color: t.inkSoft,
              maxWidth: 820,
              wordBreak: 'keep-all',
            }}
          >
            같은 질문 묶음을 네 백엔드에 보내 응답 520개를 같은 기준으로 채점했다. 갈린 지점은 세 곳이다 —
            도구를 누가 고르는가, 말투를 어디서 만드는가, 비용이 무엇에 붙는가.
          </p>
        </header>

        <Section
          tone={tone}
          title="도구를 누가 고르는가"
          desc="같은 요청을 두 백엔드가 다르게 처리한다. 작은 자체 호스팅 모델은 도구 선택을 맡길 수 없어서 입력을 갈라주는 그래프를 사람이 짜야 한다 — 규칙에 없는 표현은 그냥 일상 대화로 흘러가고, 도구를 하나 붙일 때마다 분기와 키워드가 함께 늘어난다. 상용 API 는 도구 목록만 넘기면 어느 것을 어떤 인자로 부를지 스스로 판단하므로 분류기 자체가 사라진다."
        >
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <DiagramCard tone={tone} title="자체 호스팅 — 분류기를 사람이 짠다" chart={LOCAL_LANGGRAPH} />
            <DiagramCard tone={tone} title="상용 API — 모델이 스스로 고른다" chart={API_TOOL_CALLING} />
          </div>
        </Section>

        <Section
          tone={tone}
          title="세 축에서 무엇이 달라졌나"
          desc="도구 선택, 말투, 비용 세 가지가 함께 움직였다. 말투는 학습으로 주입하던 것을 지시문과 예시로 옮겼고, 비용은 GPU 시간에서 쓴 토큰으로 옮겼다."
        >
          <DiagramCard tone={tone} title="교체로 바뀐 세 축" chart={TRADEOFF_TABLE} />
        </Section>

        <Section
          tone={tone}
          title="측정한 값"
          desc="품질이 대등하다는 걸 먼저 확인한 다음, 지연과 비용으로 골랐다. 순서가 중요하다 — 품질 차이가 있었다면 느리고 비싸도 남겨야 했다."
        >
          <LlmBackendCharts tone={tone} />
        </Section>

        <Section
          tone={tone}
          title="교체를 정하기까지"
          desc="접은 시도를 지우지 않았다. 무엇을 왜 접었는지가 판단의 근거이고, 성공만 남기면 운이 좋았던 것과 구별되지 않는다."
        >
          <DiagramCard tone={tone} title="거쳐온 순서" chart={MODEL_JOURNEY} />
          <DiagramCard tone={tone} title="양쪽을 바꿔 끼워 비교한 구조" chart={BACKEND_SWITCH} />
        </Section>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
