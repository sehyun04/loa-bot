import { useEffect, useState } from 'react'
import mermaid from 'mermaid'
import { THEME, type Tone } from './chartTokens'

interface Props {
  chart: string
  tone?: Tone
  className?: string
}

let seq = 0

/**
 * 머메이드 문자열을 SVG 로 그린다.
 *
 * 색은 차트와 같은 토큰에서 가져온다 - 다이어그램만 다른 파랑을 쓰면
 * 같은 페이지에서 두 개의 브랜드처럼 보인다.
 *
 * mermaid 를 별도로 설치해야 하는 유일한 컴포넌트다. 없으면 이 파일만
 * 빼고 나머지 차트는 그대로 쓸 수 있다.
 */
export default function MermaidDiagram({ chart, tone = 'light', className = '' }: Props) {
  const t = THEME[tone]
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    mermaid.initialize({
      startOnLoad: false,
      theme: tone === 'dark' ? 'dark' : 'base',
      themeVariables: {
        primaryColor: tone === 'dark' ? '#0F1729' : '#EAF6FC',
        primaryTextColor: t.ink,
        primaryBorderColor: t.rampMid,
        lineColor: t.rampMid,
        secondaryColor: tone === 'dark' ? '#111A2E' : '#F7F9FC',
        tertiaryColor: tone === 'dark' ? '#0B1120' : '#FFFFFF',
        background: 'transparent',
        fontFamily: 'Paperlogy, system-ui, sans-serif',
        fontSize: '13px',
      },
      flowchart: { curve: 'basis', padding: 18, htmlLabels: true },
    })

    mermaid
      .render(`pc-mermaid-${++seq}`, chart)
      .then(({ svg: out }) => {
        if (!cancelled) {
          setSvg(out)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '다이어그램을 그리지 못했어요')
      })

    return () => {
      cancelled = true
    }
  }, [chart, tone, t.ink, t.rampMid])

  if (error) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: `1px solid ${t.grid}`,
          fontFamily: 'monospace',
          fontSize: 12,
          color: t.inkSoft,
        }}
      >
        {error}
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{ width: '100%', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
