import { useState } from 'react'
import { FONT_BODY, FONT_MONO, MARK, THEME, type Tone } from './chartTokens'

export type BarRow = {
  label: string
  value: number
  /** 이야기의 주인공만 강조색을 쓴다. 나머지는 물러난 회색 */
  emphasis?: boolean
  /** 막대 옆에 붙일 문구. 값의 성격이 항목마다 다를 때 쓴다 */
  note?: string
}

interface Props {
  rows: readonly BarRow[]
  /** 축 최대값. 데이터 최대에 맞춰 자동으로 늘리면 막대 길이 비교가 왜곡된다 */
  max?: number
  /** 값 표시 형식 */
  format?: (v: number) => string
  tone?: Tone
}

/**
 * 항목별 값 비교. 막대 길이만으로 크기가 읽히므로 색은 강조에만 쓴다.
 *
 * 값을 색으로 다시 칠하지 않는다 - 길이가 이미 크기를 말하고 있어서,
 * 색까지 값을 따라가면 구분해야 할 다른 정보에 쓸 채널이 없어진다.
 */
export default function BarChart({ rows, max, format, tone = 'light' }: Props) {
  const t = THEME[tone]
  const [hover, setHover] = useState<number | null>(null)
  const ceiling = max ?? Math.max(...rows.map((r) => r.value))
  const fmt = format ?? ((v: number) => String(v))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: MARK.surfaceGap }}>
      {rows.map((row, i) => {
        const isHover = hover === i
        const pct = ceiling > 0 ? (row.value / ceiling) * 100 : 0
        const color = row.emphasis ? t.rampHigh : t.muted

        return (
          <div
            key={row.label}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: 'minmax(96px, 27%) minmax(0, 1fr)',
              alignItems: 'center',
              columnGap: 14,
              minHeight: MARK.hitSize + 12,
              padding: '2px 4px',
              borderRadius: 8,
              background: isHover
                ? tone === 'light'
                  ? 'rgba(0, 98, 223, 0.05)'
                  : 'rgba(168, 222, 242, 0.08)'
                : 'transparent',
              outline: 'none',
              transition: 'background 140ms ease',
            }}
          >
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: row.emphasis ? 700 : 500,
                color: row.emphasis ? t.ink : t.inkSoft,
                lineHeight: 1.35,
                wordBreak: 'keep-all',
                // 라벨에 넣은 줄바꿈을 그대로 살린다. 안 주면 폭에 따라 붙어버린다
                whiteSpace: 'pre-line',
              }}
            >
              {row.label}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                <div
                  aria-hidden
                  style={{
                    width: `${pct}%`,
                    // 슬롯을 다 채우지 않는다. 남는 높이가 여백 역할을 한다
                    height: Math.min(MARK.barMaxThickness, 14),
                    background: color,
                    // 데이터가 끝나는 쪽만 둥글게, 기준선 쪽은 각지게
                    borderRadius: `0 ${MARK.barEndRadius}px ${MARK.barEndRadius}px 0`,
                    opacity: row.emphasis || isHover ? 1 : 0.75,
                    transition: 'opacity 140ms ease',
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: t.ink,
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 64,
                  textAlign: 'right',
                }}
              >
                {fmt(row.value)}
              </span>
            </div>

            {isHover && row.note && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute',
                  right: 6,
                  bottom: '100%',
                  zIndex: 5,
                  padding: '8px 11px',
                  borderRadius: 10,
                  background: tone === 'light' ? '#0A1224' : '#F2F5FA',
                  color: tone === 'light' ? '#FFFFFF' : '#0A1224',
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  lineHeight: 1.5,
                  maxWidth: 280,
                  boxShadow: '0 10px 30px -8px rgba(10, 18, 36, 0.4)',
                  pointerEvents: 'none',
                  wordBreak: 'keep-all',
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 3 }}>{fmt(row.value)}</div>
                <div style={{ opacity: 0.75 }}>{row.note}</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
