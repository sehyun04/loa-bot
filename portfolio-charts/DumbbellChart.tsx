import { useState } from 'react'
import { FONT_BODY, FONT_MONO, MARK, THEME, type Tone } from './chartTokens'

export type DumbbellRow = {
  label: string
  /** 비교의 "이전" 값 */
  from: number
  /** 비교의 "이후" 값 */
  to: number
  /** 이 행이 이야기의 주인공인지. 주인공만 강조색을 쓴다 */
  emphasis?: boolean
  note?: string
}

interface Props {
  rows: readonly DumbbellRow[]
  /** [최소, 최대] - 축을 데이터에 맞춰 자동으로 자르지 않는다. 0 이 아닌 기준선은 변화폭을 과장한다 */
  domain: readonly [number, number]
  fromLabel: string
  toLabel: string
  unit?: string
  /** 축 눈금 값 */
  ticks?: readonly number[]
  tone?: Tone
  /** 소수 자리 */
  digits?: number
}

/**
 * 항목별 "이전 → 이후" 변화. 두 시점을 한 줄에 놓고 선으로 이어서
 * 값 자체보다 변화의 방향과 폭이 먼저 읽히게 한다.
 *
 * SVG 대신 div 로 그린다 - 퍼센트 배치라 어떤 폭에서도 점이 찌그러지지 않고,
 * 호버 영역과 툴팁을 평범한 DOM 으로 다룰 수 있다.
 */
export default function DumbbellChart({
  rows,
  domain,
  fromLabel,
  toLabel,
  unit = '',
  ticks,
  tone = 'light',
  digits = 2,
}: Props) {
  const t = THEME[tone]
  const [hover, setHover] = useState<number | null>(null)
  const [min, max] = domain
  const span = max - min || 1
  const pos = (v: number) => ((v - min) / span) * 100

  const fmt = (v: number) => `${v.toFixed(digits)}${unit}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((row, i) => {
        const isHover = hover === i
        const lo = Math.min(row.from, row.to)
        const hi = Math.max(row.from, row.to)
        // 색은 "이전/이후"만 뜻한다. 강조를 색으로 주면 범례가 거짓말을 하므로
        // (범례는 두 시점을 설명하는데 행마다 색이 달라진다) 강조는 글자 굵기로만 준다
        const fromColor = t.rampLow
        const toColor = t.rampHigh

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
              // 히트 영역을 점보다 넉넉하게 - 점만 노리면 아무도 못 맞춘다
              minHeight: MARK.hitSize + 16,
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

            <div style={{ position: 'relative', height: 26 }}>
              {/* 기준 트랙 - 있는지 없는지 모를 만큼 옅게 */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: '50% 0 auto 0',
                  height: 1,
                  transform: 'translateY(-50%)',
                  background: t.grid,
                }}
              />
              {/* 변화 구간 */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${pos(lo)}%`,
                  width: `${pos(hi) - pos(lo)}%`,
                  height: MARK.lineWidth,
                  transform: 'translateY(-50%)',
                  borderRadius: MARK.lineWidth / 2,
                  background: row.emphasis ? t.rampMid : t.muted,
                  opacity: row.emphasis ? 0.55 : 0.35,
                }}
              />
              <Dot left={pos(row.from)} color={fromColor} surface={t.surface} />
              <Dot left={pos(row.to)} color={toColor} surface={t.surface} />

              {/* 직접 라벨 - 연한 마크가 대비 3:1 을 못 넘기므로 값은 글자로 남긴다 */}
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${pos(row.to)}%`,
                  transform: `translate(${pos(row.to) > 82 ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
                  fontFamily: FONT_MONO,
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: t.ink,
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmt(row.to)}
              </span>
            </div>

            {isHover && (
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
                  whiteSpace: 'nowrap',
                  boxShadow: '0 10px 30px -8px rgba(10, 18, 36, 0.4)',
                  pointerEvents: 'none',
                }}
              >
                {/* 값이 먼저, 이름이 뒤 - 보는 사람은 이미 어느 항목인지 안다 */}
                <div style={{ fontWeight: 800, marginBottom: 3 }}>
                  {fmt(row.from)} <span style={{ opacity: 0.6 }}>&rarr;</span> {fmt(row.to)}
                </div>
                <div style={{ opacity: 0.75 }}>
                  {fromLabel} &rarr; {toLabel}
                </div>
                {row.note && <div style={{ opacity: 0.75, marginTop: 3 }}>{row.note}</div>}
              </div>
            )}
          </div>
        )
      })}

      {ticks && ticks.length > 0 && (
        <div
          aria-hidden
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(96px, 27%) minmax(0, 1fr)',
            columnGap: 14,
            marginTop: 4,
          }}
        >
          <div />
          <div style={{ position: 'relative', height: 16 }}>
            {ticks.map((v) => (
              <span
                key={v}
                style={{
                  position: 'absolute',
                  left: `${pos(v)}%`,
                  transform: 'translateX(-50%)',
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  fontWeight: 700,
                  color: t.inkMuted,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Dot({ left, color, surface }: { left: number; color: string; surface: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: '50%',
        left: `${left}%`,
        width: MARK.dotRadius * 2,
        height: MARK.dotRadius * 2,
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background: color,
        // 겹칠 때 서로 먹지 않도록 서피스 색으로 두른다. 선을 그리는 게 아니다
        boxShadow: `0 0 0 ${MARK.ringWidth}px ${surface}`,
      }}
    />
  )
}
