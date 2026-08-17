import { useId, useState, type ReactNode } from 'react'
import { FONT_BODY, FONT_MONO, THEME, type Tone } from './chartTokens'

export type LegendItem = {
  label: string
  color: string
  /** 막대·영역은 사각, 선은 짧은 선으로 - 범례가 마크 모양을 따라간다 */
  kind?: 'rect' | 'line'
}

export type TableData = {
  columns: readonly string[]
  rows: readonly (readonly (string | number)[])[]
}

interface Props {
  title: string
  subtitle?: string
  /** 두 계열 이상이면 범례를 낸다. 색만으로 구분하게 두지 않는다 */
  legend?: readonly LegendItem[]
  /** 표는 선택이 아니다 - 연한 색 마크가 서피스 대비 3:1 을 못 넘기므로 값을 읽을 다른 길을 항상 남긴다 */
  table: TableData
  footnote?: string
  tone?: Tone
  children: ReactNode
}

export default function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  footnote,
  tone = 'light',
  children,
}: Props) {
  const t = THEME[tone]
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  return (
    <figure
      style={{
        margin: 0,
        padding: 'clamp(18px, 2.4vw, 28px)',
        background: tone === 'light' ? '#FFFFFF' : '#0F1729',
        border: `1px solid ${t.grid}`,
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: FONT_BODY,
            fontSize: 'clamp(15px, 1.5vw, 17px)',
            fontWeight: 700,
            color: t.ink,
            letterSpacing: '-0.01em',
            wordBreak: 'keep-all',
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            style={{
              margin: 0,
              fontFamily: FONT_BODY,
              fontSize: 13,
              lineHeight: 1.6,
              color: t.inkSoft,
              fontWeight: 500,
              wordBreak: 'keep-all',
            }}
          >
            {subtitle}
          </p>
        )}
      </header>

      {legend && legend.length >= 2 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 18px',
          }}
        >
          {legend.map((item) => (
            <li
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontFamily: FONT_MONO,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: t.inkSoft,
              }}
            >
              <span
                aria-hidden
                style={
                  item.kind === 'line'
                    ? { width: 14, height: 2, borderRadius: 1, background: item.color }
                    : { width: 10, height: 10, borderRadius: 2, background: item.color }
                }
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div>{children}</div>

      <footer style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {footnote && (
          <figcaption
            style={{
              fontFamily: FONT_BODY,
              fontSize: 11.5,
              lineHeight: 1.6,
              color: t.inkMuted,
              fontWeight: 500,
              wordBreak: 'keep-all',
            }}
          >
            {footnote}
          </figcaption>
        )}

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls={tableId}
          style={{
            alignSelf: 'flex-start',
            appearance: 'none',
            background: 'transparent',
            border: `1px solid ${t.grid}`,
            borderRadius: 999,
            padding: '5px 12px',
            cursor: 'pointer',
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: t.inkSoft,
            textTransform: 'uppercase',
          }}
        >
          {showTable ? '표 닫기' : '값을 표로 보기'}
        </button>

        {showTable && (
          <div id={tableId} style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                color: t.inkSoft,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      style={{
                        textAlign: 'left',
                        padding: '7px 10px',
                        borderBottom: `1px solid ${t.grid}`,
                        color: t.ink,
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        style={{
                          padding: '7px 10px',
                          borderBottom: `1px solid ${t.grid}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </footer>
    </figure>
  )
}
