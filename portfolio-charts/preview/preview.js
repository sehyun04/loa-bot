// preview/preview.tsx
import { useState as useState5 } from "react";
import { createRoot } from "react-dom/client";

// BarChart.tsx
import { useState } from "react";

// chartTokens.ts
var THEME = {
  light: {
    surface: "#F7F9FC",
    ink: "#0A1224",
    inkSoft: "#3F4A5F",
    inkMuted: "#8A95A6",
    grid: "rgba(10, 18, 36, 0.10)",
    rampLow: "#5BC0E5",
    rampMid: "#0091CC",
    rampHigh: "#0062DF",
    muted: "#8A95A6"
  },
  dark: {
    surface: "#070B14",
    ink: "#F2F5FA",
    inkSoft: "#C3CCDA",
    inkMuted: "#8A95A6",
    grid: "rgba(242, 245, 250, 0.12)",
    rampLow: "#0091CC",
    rampMid: "#5BC0E5",
    rampHigh: "#A8DEF2",
    muted: "#8A95A6"
  }
};
var FONT_MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';
var FONT_BODY = "Paperlogy, system-ui, sans-serif";
var MARK = {
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
  hitSize: 24
};

// BarChart.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function BarChart({ rows, max, format, tone = "light" }) {
  const t = THEME[tone];
  const [hover, setHover] = useState(null);
  const ceiling = max ?? Math.max(...rows.map((r) => r.value));
  const fmt = format ?? ((v) => String(v));
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: MARK.surfaceGap }, children: rows.map((row, i) => {
    const isHover = hover === i;
    const pct = ceiling > 0 ? row.value / ceiling * 100 : 0;
    const color = row.emphasis ? t.rampHigh : t.muted;
    return /* @__PURE__ */ jsxs(
      "div",
      {
        onPointerEnter: () => setHover(i),
        onPointerLeave: () => setHover(null),
        onFocus: () => setHover(i),
        onBlur: () => setHover(null),
        tabIndex: 0,
        style: {
          position: "relative",
          display: "grid",
          gridTemplateColumns: "minmax(96px, 27%) minmax(0, 1fr)",
          alignItems: "center",
          columnGap: 14,
          minHeight: MARK.hitSize + 12,
          padding: "2px 4px",
          borderRadius: 8,
          background: isHover ? tone === "light" ? "rgba(0, 98, 223, 0.05)" : "rgba(168, 222, 242, 0.08)" : "transparent",
          outline: "none",
          transition: "background 140ms ease"
        },
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: row.emphasis ? 700 : 500,
                color: row.emphasis ? t.ink : t.inkSoft,
                lineHeight: 1.35,
                wordBreak: "keep-all",
                // 라벨에 넣은 줄바꿈을 그대로 살린다. 안 주면 폭에 따라 붙어버린다
                whiteSpace: "pre-line"
              },
              children: row.label
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
            /* @__PURE__ */ jsx("div", { style: { position: "relative", flex: 1, minWidth: 0 }, children: /* @__PURE__ */ jsx(
              "div",
              {
                "aria-hidden": true,
                style: {
                  width: `${pct}%`,
                  // 슬롯을 다 채우지 않는다. 남는 높이가 여백 역할을 한다
                  height: Math.min(MARK.barMaxThickness, 14),
                  background: color,
                  // 데이터가 끝나는 쪽만 둥글게, 기준선 쪽은 각지게
                  borderRadius: `0 ${MARK.barEndRadius}px ${MARK.barEndRadius}px 0`,
                  opacity: row.emphasis || isHover ? 1 : 0.75,
                  transition: "opacity 140ms ease"
                }
              }
            ) }),
            /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  fontFamily: FONT_MONO,
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: t.ink,
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 64,
                  textAlign: "right"
                },
                children: fmt(row.value)
              }
            )
          ] }),
          isHover && row.note && /* @__PURE__ */ jsxs(
            "div",
            {
              role: "tooltip",
              style: {
                position: "absolute",
                right: 6,
                bottom: "100%",
                zIndex: 5,
                padding: "8px 11px",
                borderRadius: 10,
                background: tone === "light" ? "#0A1224" : "#F2F5FA",
                color: tone === "light" ? "#FFFFFF" : "#0A1224",
                fontFamily: FONT_MONO,
                fontSize: 11,
                lineHeight: 1.5,
                maxWidth: 280,
                boxShadow: "0 10px 30px -8px rgba(10, 18, 36, 0.4)",
                pointerEvents: "none",
                wordBreak: "keep-all"
              },
              children: [
                /* @__PURE__ */ jsx("div", { style: { fontWeight: 800, marginBottom: 3 }, children: fmt(row.value) }),
                /* @__PURE__ */ jsx("div", { style: { opacity: 0.75 }, children: row.note })
              ]
            }
          )
        ]
      },
      row.label
    );
  }) });
}

// ChartFrame.tsx
import { useId, useState as useState2 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  footnote,
  tone = "light",
  children
}) {
  const t = THEME[tone];
  const [showTable, setShowTable] = useState2(false);
  const tableId = useId();
  return /* @__PURE__ */ jsxs2(
    "figure",
    {
      style: {
        margin: 0,
        padding: "clamp(18px, 2.4vw, 28px)",
        background: tone === "light" ? "#FFFFFF" : "#0F1729",
        border: `1px solid ${t.grid}`,
        borderRadius: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16
      },
      children: [
        /* @__PURE__ */ jsxs2("header", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
          /* @__PURE__ */ jsx2(
            "h3",
            {
              style: {
                margin: 0,
                fontFamily: FONT_BODY,
                fontSize: "clamp(15px, 1.5vw, 17px)",
                fontWeight: 700,
                color: t.ink,
                letterSpacing: "-0.01em",
                wordBreak: "keep-all"
              },
              children: title
            }
          ),
          subtitle && /* @__PURE__ */ jsx2(
            "p",
            {
              style: {
                margin: 0,
                fontFamily: FONT_BODY,
                fontSize: 13,
                lineHeight: 1.6,
                color: t.inkSoft,
                fontWeight: 500,
                wordBreak: "keep-all"
              },
              children: subtitle
            }
          )
        ] }),
        legend && legend.length >= 2 && /* @__PURE__ */ jsx2(
          "ul",
          {
            style: {
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 18px"
            },
            children: legend.map((item) => /* @__PURE__ */ jsxs2(
              "li",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: t.inkSoft
                },
                children: [
                  /* @__PURE__ */ jsx2(
                    "span",
                    {
                      "aria-hidden": true,
                      style: item.kind === "line" ? { width: 14, height: 2, borderRadius: 1, background: item.color } : { width: 10, height: 10, borderRadius: 2, background: item.color }
                    }
                  ),
                  item.label
                ]
              },
              item.label
            ))
          }
        ),
        /* @__PURE__ */ jsx2("div", { children }),
        /* @__PURE__ */ jsxs2("footer", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
          footnote && /* @__PURE__ */ jsx2(
            "figcaption",
            {
              style: {
                fontFamily: FONT_BODY,
                fontSize: 11.5,
                lineHeight: 1.6,
                color: t.inkMuted,
                fontWeight: 500,
                wordBreak: "keep-all"
              },
              children: footnote
            }
          ),
          /* @__PURE__ */ jsx2(
            "button",
            {
              type: "button",
              onClick: () => setShowTable((v) => !v),
              "aria-expanded": showTable,
              "aria-controls": tableId,
              style: {
                alignSelf: "flex-start",
                appearance: "none",
                background: "transparent",
                border: `1px solid ${t.grid}`,
                borderRadius: 999,
                padding: "5px 12px",
                cursor: "pointer",
                fontFamily: FONT_MONO,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: t.inkSoft,
                textTransform: "uppercase"
              },
              children: showTable ? "\uD45C \uB2EB\uAE30" : "\uAC12\uC744 \uD45C\uB85C \uBCF4\uAE30"
            }
          ),
          showTable && /* @__PURE__ */ jsx2("div", { id: tableId, style: { overflowX: "auto" }, children: /* @__PURE__ */ jsxs2(
            "table",
            {
              style: {
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                color: t.inkSoft,
                fontVariantNumeric: "tabular-nums"
              },
              children: [
                /* @__PURE__ */ jsx2("thead", { children: /* @__PURE__ */ jsx2("tr", { children: table.columns.map((c) => /* @__PURE__ */ jsx2(
                  "th",
                  {
                    scope: "col",
                    style: {
                      textAlign: "left",
                      padding: "7px 10px",
                      borderBottom: `1px solid ${t.grid}`,
                      color: t.ink,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      whiteSpace: "nowrap"
                    },
                    children: c
                  },
                  c
                )) }) }),
                /* @__PURE__ */ jsx2("tbody", { children: table.rows.map((row, i) => /* @__PURE__ */ jsx2("tr", { children: row.map((cell, j) => /* @__PURE__ */ jsx2(
                  "td",
                  {
                    style: {
                      padding: "7px 10px",
                      borderBottom: `1px solid ${t.grid}`,
                      whiteSpace: "nowrap"
                    },
                    children: cell
                  },
                  j
                )) }, i)) })
              ]
            }
          ) })
        ] })
      ]
    }
  );
}

// DumbbellChart.tsx
import { useState as useState3 } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function DumbbellChart({
  rows,
  domain,
  fromLabel,
  toLabel,
  unit = "",
  ticks,
  tone = "light",
  digits = 2
}) {
  const t = THEME[tone];
  const [hover, setHover] = useState3(null);
  const [min, max] = domain;
  const span = max - min || 1;
  const pos = (v) => (v - min) / span * 100;
  const fmt = (v) => `${v.toFixed(digits)}${unit}`;
  return /* @__PURE__ */ jsxs3("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
    rows.map((row, i) => {
      const isHover = hover === i;
      const lo = Math.min(row.from, row.to);
      const hi = Math.max(row.from, row.to);
      const fromColor = t.rampLow;
      const toColor = t.rampHigh;
      return /* @__PURE__ */ jsxs3(
        "div",
        {
          onPointerEnter: () => setHover(i),
          onPointerLeave: () => setHover(null),
          onFocus: () => setHover(i),
          onBlur: () => setHover(null),
          tabIndex: 0,
          style: {
            position: "relative",
            display: "grid",
            gridTemplateColumns: "minmax(96px, 27%) minmax(0, 1fr)",
            alignItems: "center",
            columnGap: 14,
            // 히트 영역을 점보다 넉넉하게 - 점만 노리면 아무도 못 맞춘다
            minHeight: MARK.hitSize + 16,
            padding: "2px 4px",
            borderRadius: 8,
            background: isHover ? tone === "light" ? "rgba(0, 98, 223, 0.05)" : "rgba(168, 222, 242, 0.08)" : "transparent",
            outline: "none",
            transition: "background 140ms ease"
          },
          children: [
            /* @__PURE__ */ jsx3(
              "div",
              {
                style: {
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  fontWeight: row.emphasis ? 700 : 500,
                  color: row.emphasis ? t.ink : t.inkSoft,
                  lineHeight: 1.35,
                  wordBreak: "keep-all",
                  // 라벨에 넣은 줄바꿈을 그대로 살린다. 안 주면 폭에 따라 붙어버린다
                  whiteSpace: "pre-line"
                },
                children: row.label
              }
            ),
            /* @__PURE__ */ jsxs3("div", { style: { position: "relative", height: 26 }, children: [
              /* @__PURE__ */ jsx3(
                "div",
                {
                  "aria-hidden": true,
                  style: {
                    position: "absolute",
                    inset: "50% 0 auto 0",
                    height: 1,
                    transform: "translateY(-50%)",
                    background: t.grid
                  }
                }
              ),
              /* @__PURE__ */ jsx3(
                "div",
                {
                  "aria-hidden": true,
                  style: {
                    position: "absolute",
                    top: "50%",
                    left: `${pos(lo)}%`,
                    width: `${pos(hi) - pos(lo)}%`,
                    height: MARK.lineWidth,
                    transform: "translateY(-50%)",
                    borderRadius: MARK.lineWidth / 2,
                    background: row.emphasis ? t.rampMid : t.muted,
                    opacity: row.emphasis ? 0.55 : 0.35
                  }
                }
              ),
              /* @__PURE__ */ jsx3(Dot, { left: pos(row.from), color: fromColor, surface: t.surface }),
              /* @__PURE__ */ jsx3(Dot, { left: pos(row.to), color: toColor, surface: t.surface }),
              /* @__PURE__ */ jsx3(
                "span",
                {
                  style: {
                    position: "absolute",
                    top: "50%",
                    left: `${pos(row.to)}%`,
                    transform: `translate(${pos(row.to) > 82 ? "calc(-100% - 12px)" : "12px"}, -50%)`,
                    fontFamily: FONT_MONO,
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: t.ink,
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums"
                  },
                  children: fmt(row.to)
                }
              )
            ] }),
            isHover && /* @__PURE__ */ jsxs3(
              "div",
              {
                role: "tooltip",
                style: {
                  position: "absolute",
                  right: 6,
                  bottom: "100%",
                  zIndex: 5,
                  padding: "8px 11px",
                  borderRadius: 10,
                  background: tone === "light" ? "#0A1224" : "#F2F5FA",
                  color: tone === "light" ? "#FFFFFF" : "#0A1224",
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  lineHeight: 1.5,
                  whiteSpace: "nowrap",
                  boxShadow: "0 10px 30px -8px rgba(10, 18, 36, 0.4)",
                  pointerEvents: "none"
                },
                children: [
                  /* @__PURE__ */ jsxs3("div", { style: { fontWeight: 800, marginBottom: 3 }, children: [
                    fmt(row.from),
                    " ",
                    /* @__PURE__ */ jsx3("span", { style: { opacity: 0.6 }, children: "\u2192" }),
                    " ",
                    fmt(row.to)
                  ] }),
                  /* @__PURE__ */ jsxs3("div", { style: { opacity: 0.75 }, children: [
                    fromLabel,
                    " \u2192 ",
                    toLabel
                  ] }),
                  row.note && /* @__PURE__ */ jsx3("div", { style: { opacity: 0.75, marginTop: 3 }, children: row.note })
                ]
              }
            )
          ]
        },
        row.label
      );
    }),
    ticks && ticks.length > 0 && /* @__PURE__ */ jsxs3(
      "div",
      {
        "aria-hidden": true,
        style: {
          display: "grid",
          gridTemplateColumns: "minmax(96px, 27%) minmax(0, 1fr)",
          columnGap: 14,
          marginTop: 4
        },
        children: [
          /* @__PURE__ */ jsx3("div", {}),
          /* @__PURE__ */ jsx3("div", { style: { position: "relative", height: 16 }, children: ticks.map((v) => /* @__PURE__ */ jsx3(
            "span",
            {
              style: {
                position: "absolute",
                left: `${pos(v)}%`,
                transform: "translateX(-50%)",
                fontFamily: FONT_MONO,
                fontSize: 10,
                fontWeight: 700,
                color: t.inkMuted,
                fontVariantNumeric: "tabular-nums"
              },
              children: v
            },
            v
          )) })
        ]
      }
    )
  ] });
}
function Dot({ left, color, surface }) {
  return /* @__PURE__ */ jsx3(
    "span",
    {
      "aria-hidden": true,
      style: {
        position: "absolute",
        top: "50%",
        left: `${left}%`,
        width: MARK.dotRadius * 2,
        height: MARK.dotRadius * 2,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        background: color,
        // 겹칠 때 서로 먹지 않도록 서피스 색으로 두른다. 선을 그리는 게 아니다
        boxShadow: `0 0 0 ${MARK.ringWidth}px ${surface}`
      }
    }
  );
}

// evalData.ts
var EVAL_ROWS = [
  {
    segment: "closed",
    model: "gemma-4-e4b-lora-modal",
    label: "Gemma 4 E4B + LoRA",
    backend: "selfhost",
    backendNote: "Modal A10G \uC790\uCCB4 \uD638\uC2A4\uD305",
    n: 60,
    score: 1.78,
    hallucinationPct: 28.3,
    latencyP50: 5187,
    latencyP95: 8823,
    costUsd: 12e-4
  },
  {
    segment: "closed",
    model: "exaone-3.5-2.4b-ollama",
    label: "EXAONE 3.5 2.4B",
    backend: "local",
    backendNote: "Ollama \uB85C\uCEEC \uCD94\uB860",
    n: 60,
    score: 1.52,
    hallucinationPct: 75,
    latencyP50: 738,
    latencyP95: 1188,
    costUsd: 0
  },
  {
    segment: "closed",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    backend: "api",
    backendNote: "\uC0C1\uC6A9 API",
    n: 60,
    score: 2.13,
    hallucinationPct: 48.3,
    latencyP50: 1237,
    latencyP95: 1950,
    costUsd: 411e-6
  },
  {
    segment: "closed",
    model: "haiku-4.5",
    label: "Claude Haiku 4.5",
    backend: "api",
    backendNote: "\uC0C1\uC6A9 API \xB7 \uCC44\uD0DD",
    n: 60,
    score: 1.82,
    hallucinationPct: 31.7,
    latencyP50: 1474,
    latencyP95: 2100,
    costUsd: 801e-6
  },
  {
    segment: "open",
    model: "gemma-4-e4b-lora-modal",
    label: "Gemma 4 E4B + LoRA",
    backend: "selfhost",
    backendNote: "Modal A10G \uC790\uCCB4 \uD638\uC2A4\uD305",
    n: 60,
    score: 4.78,
    hallucinationPct: 3.3,
    latencyP50: 6097,
    latencyP95: 9026,
    costUsd: 12e-4
  },
  {
    segment: "open",
    model: "exaone-3.5-2.4b-ollama",
    label: "EXAONE 3.5 2.4B",
    backend: "local",
    backendNote: "Ollama \uB85C\uCEEC \uCD94\uB860",
    n: 60,
    score: 4.22,
    hallucinationPct: 13.3,
    latencyP50: 663,
    latencyP95: 1094,
    costUsd: 0
  },
  {
    segment: "open",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    backend: "api",
    backendNote: "\uC0C1\uC6A9 API",
    n: 60,
    score: 4.8,
    hallucinationPct: 5,
    latencyP50: 1106,
    latencyP95: 1532,
    costUsd: 406e-6
  },
  {
    segment: "open",
    model: "haiku-4.5",
    label: "Claude Haiku 4.5",
    backend: "api",
    backendNote: "\uC0C1\uC6A9 API \xB7 \uCC44\uD0DD",
    n: 60,
    score: 4.73,
    hallucinationPct: 6.7,
    latencyP50: 1186,
    latencyP95: 2063,
    costUsd: 795e-6
  },
  {
    segment: "multiturn",
    model: "gemma-4-e4b-lora-modal",
    label: "Gemma 4 E4B + LoRA",
    backend: "selfhost",
    backendNote: "Modal A10G \uC790\uCCB4 \uD638\uC2A4\uD305",
    n: 10,
    score: 1.3,
    hallucinationPct: 30,
    latencyP50: 4262,
    latencyP95: 24720,
    costUsd: 12e-4
  },
  {
    segment: "multiturn",
    model: "exaone-3.5-2.4b-ollama",
    label: "EXAONE 3.5 2.4B",
    backend: "local",
    backendNote: "Ollama \uB85C\uCEEC \uCD94\uB860",
    n: 10,
    score: 2.4,
    hallucinationPct: 50,
    latencyP50: 1030,
    latencyP95: 1660,
    costUsd: 0
  },
  {
    segment: "multiturn",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    backend: "api",
    backendNote: "\uC0C1\uC6A9 API",
    n: 10,
    score: 2.6,
    hallucinationPct: 40,
    latencyP50: 1447,
    latencyP95: 2161,
    costUsd: 438e-6
  },
  {
    segment: "multiturn",
    model: "haiku-4.5",
    label: "Claude Haiku 4.5",
    backend: "api",
    backendNote: "\uC0C1\uC6A9 API \xB7 \uCC44\uD0DD",
    n: 10,
    score: 1.8,
    hallucinationPct: 30,
    latencyP50: 1326,
    latencyP95: 2255,
    costUsd: 823e-6
  }
];
var TOTAL_RESPONSES = EVAL_ROWS.reduce((s, r) => s + r.n, 0);
var MIGRATION = {
  from: "gemma-4-e4b-lora-modal",
  to: "haiku-4.5"
};
function bySegment(segment) {
  return EVAL_ROWS.filter((r) => r.segment === segment);
}

// LlmBackendCharts.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var MODEL_ORDER = ["gemma-4-e4b-lora-modal", "exaone-3.5-2.4b-ollama", "gpt-5.4-mini", "haiku-4.5"];
function ordered(rows) {
  return MODEL_ORDER.map((m) => rows.find((r) => r.model === m)).filter((r) => !!r);
}
var isPick = (r) => r.model === MIGRATION.to;
var sec = (ms) => `${(ms / 1e3).toFixed(1)}\uCD08`;
function LatencySpreadChart({ tone = "light" }) {
  const rows = ordered(bySegment("multiturn"));
  const dumbbell = rows.map((r) => ({
    label: `${r.label}
${r.backendNote}`,
    from: r.latencyP50 / 1e3,
    to: r.latencyP95 / 1e3,
    emphasis: isPick(r),
    note: `\uC808\uBC18\uC740 ${sec(r.latencyP50)} \uC548\uC5D0, \uB290\uB9B0 5%\uB294 ${sec(r.latencyP95)}`
  }));
  return /* @__PURE__ */ jsx4(
    ChartFrame,
    {
      tone,
      title: "\uC5EC\uB7EC \uD134 \uC774\uC5B4\uC9C0\uB294 \uB300\uD654\uC5D0\uC11C \uC751\uB2F5\uC774 \uC5BC\uB9C8\uB098 \uB298\uC5B4\uC9C0\uB294\uAC00",
      subtitle: "\uC810 \uB450 \uAC1C\uB294 \uAC19\uC740 \uBAA8\uB378\uC758 \uBCF4\uD1B5 \uC751\uB2F5(\uC808\uBC18\uC774 \uC774 \uC548\uC5D0 \uB4E4\uC5B4\uC634)\uACFC \uB290\uB9B0 \uCABD 5%\uB2E4. \uC790\uCCB4 \uD638\uC2A4\uD305\uC740 \uB300\uD654\uAC00 \uAE38\uC5B4\uC9C8\uC218\uB85D \uAF2C\uB9AC\uAC00 \uD06C\uAC8C \uBC8C\uC5B4\uC9C4\uB2E4.",
      legend: [
        { label: "\uBCF4\uD1B5 \uC751\uB2F5", color: tone === "dark" ? "#0091CC" : "#5BC0E5" },
        { label: "\uB290\uB9B0 5%", color: tone === "dark" ? "#A8DEF2" : "#0062DF" }
      ],
      table: {
        columns: ["\uBAA8\uB378", "\uC11C\uBE59 \uBC29\uC2DD", "\uBCF4\uD1B5 \uC751\uB2F5", "\uB290\uB9B0 5%", "\uD45C\uBCF8"],
        rows: rows.map((r) => [r.label, r.backendNote, sec(r.latencyP50), sec(r.latencyP95), `${r.n}\uAC74`])
      },
      footnote: "\uAC19\uC740 \uC9C8\uBB38 \uBB36\uC74C\uC744 \uB124 \uBC31\uC5D4\uB4DC\uC5D0 \uB3D9\uC77C\uD558\uAC8C \uBCF4\uB0B4 \uCE21\uC815\uD588\uB2E4. \uB290\uB9B0 5%\uB294 95\uBC88\uC9F8 \uBC31\uBD84\uC704\uC218.",
      children: /* @__PURE__ */ jsx4(
        DumbbellChart,
        {
          tone,
          rows: dumbbell,
          domain: [0, 25],
          ticks: [0, 5, 10, 15, 20, 25],
          fromLabel: "\uBCF4\uD1B5 \uC751\uB2F5",
          toLabel: "\uB290\uB9B0 5%",
          unit: "\uCD08",
          digits: 1
        }
      )
    }
  );
}
function ServingCostChart({ tone = "light" }) {
  const rows = ordered(bySegment("open"));
  return /* @__PURE__ */ jsx4(
    ChartFrame,
    {
      tone,
      title: "\uD638\uCD9C \uD55C \uBC88\uC5D0 \uB4DC\uB294 \uC11C\uBE59 \uBE44\uC6A9",
      subtitle: "\uC790\uCCB4 \uD638\uC2A4\uD305\uC740 GPU \uB97C \uC2DC\uAC04 \uB2E8\uC704\uB85C \uBE4C\uB9AC\uAE30 \uB54C\uBB38\uC5D0, \uD638\uCD9C\uC774 \uC801\uC740 \uC2DC\uAC04\uB300\uC5D0\uB3C4 \uBE44\uC6A9\uC774 \uACC4\uC18D \uB098\uAC04\uB2E4.",
      table: {
        columns: ["\uBAA8\uB378", "\uC11C\uBE59 \uBC29\uC2DD", "\uD638\uCD9C\uB2F9 \uBE44\uC6A9", "\uC0B0\uC815 \uBC29\uC2DD"],
        rows: rows.map((r) => [
          r.label,
          r.backendNote,
          r.costUsd === 0 ? "\uACC4\uC0C1 \uC5C6\uC74C" : `$${r.costUsd.toFixed(6)}`,
          r.backend === "api" ? "\uD1A0\uD070 \uACFC\uAE08 \uC2E4\uCE21" : r.backend === "selfhost" ? "GPU \uC2DC\uAC04\uC744 \uD638\uCD9C\uB2F9\uC73C\uB85C \uD658\uC0B0" : "\uC778\uD504\uB77C \uBE44\uC6A9 0 \uC73C\uB85C \uACC4\uC0C1"
        ])
      },
      footnote: "\uC8FC\uC758 - \uAC12\uC758 \uC131\uACA9\uC774 \uC11C\uB85C \uB2E4\uB974\uB2E4. \uC0C1\uC6A9 API \uB294 \uD1A0\uD070 \uACFC\uAE08 \uC2E4\uCE21, \uC790\uCCB4 \uD638\uC2A4\uD305\uC740 GPU \uC2DC\uAC04(A10G \uC2DC\uAC04\uB2F9 $1.10)\uC744 \uD638\uCD9C\uB2F9\uC73C\uB85C \uD658\uC0B0\uD55C \uAC12, \uB85C\uCEEC \uCD94\uB860\uC740 \uC804\uAE30\uB8CC\uB97C \uB123\uC9C0 \uC54A\uACE0 0 \uC73C\uB85C \uACC4\uC0C1\uD588\uB2E4. \uB85C\uCEEC\uC774 \uAC00\uC7A5 \uC2F8\uB2E4\uB294 \uB73B\uC774 \uC544\uB2C8\uB2E4.",
      children: /* @__PURE__ */ jsx4(
        BarChart,
        {
          tone,
          rows: rows.map((r) => ({
            label: `${r.label}
${r.backendNote}`,
            value: r.costUsd,
            emphasis: isPick(r),
            note: r.backend === "api" ? "\uD1A0\uD070 \uACFC\uAE08 \uC2E4\uCE21" : r.backend === "selfhost" ? "GPU \uC2DC\uAC04\uC744 \uD638\uCD9C\uB2F9\uC73C\uB85C \uD658\uC0B0 \u2014 \uD2B8\uB798\uD53D\uC774 \uC5C6\uC5B4\uB3C4 \uB098\uAC04\uB2E4" : "\uC778\uD504\uB77C \uBE44\uC6A9 0 \uC73C\uB85C \uACC4\uC0C1 (\uC804\uAE30\uB8CC \uC81C\uC678)"
          })),
          format: (v) => v === 0 ? "\uACC4\uC0C1 \uC5C6\uC74C" : `$${v.toFixed(6)}`
        }
      )
    }
  );
}
function GroundingEffectChart({ tone = "light" }) {
  const closed = ordered(bySegment("closed"));
  const open = ordered(bySegment("open"));
  const dumbbell = closed.map((c) => {
    const o = open.find((r) => r.model === c.model);
    return {
      label: `${c.label}
${c.backendNote}`,
      from: c.score,
      to: o.score,
      emphasis: isPick(c),
      note: `\uC790\uB8CC\uB97C \uC8FC\uBA74 ${(o.score - c.score).toFixed(2)}\uC810 \uC62C\uB77C\uAC04\uB2E4`
    };
  });
  return /* @__PURE__ */ jsx4(
    ChartFrame,
    {
      tone,
      title: "\uC790\uB8CC\uB97C \uD568\uAED8 \uC8FC\uBA74 \uC810\uC218\uAC00 \uC5BC\uB9C8\uB098 \uC624\uB974\uB294\uAC00",
      subtitle: "\uBAA8\uB378\uC744 \uBB34\uC5C7\uC73C\uB85C \uBC14\uAFB8\uB4E0 \uC790\uB8CC\uB97C \uBD99\uC5EC\uC8FC\uB294 \uCABD\uC774 \uD6E8\uC52C \uD06C\uAC8C \uC791\uC6A9\uD588\uB2E4. \uB124 \uBC31\uC564\uB4DC\uC758 \uB3C4\uCC29\uC810\uC774 \uAC70\uC758 \uAC19\uC544\uC11C, \uD488\uC9C8\uB9CC\uC73C\uB85C\uB294 \uC5B4\uB290 \uD558\uB098\uB97C \uACE0\uB97C \uADFC\uAC70\uAC00 \uC5C6\uC5C8\uB2E4.",
      legend: [
        { label: "\uC790\uB8CC \uC5C6\uC774", color: tone === "dark" ? "#0091CC" : "#5BC0E5" },
        { label: "\uC790\uB8CC\uB97C \uC8FC\uACE0", color: tone === "dark" ? "#A8DEF2" : "#0062DF" }
      ],
      table: {
        columns: ["\uBAA8\uB378", "\uC790\uB8CC \uC5C6\uC774", "\uC790\uB8CC\uB97C \uC8FC\uACE0", "\uCC28\uC774", "\uD45C\uBCF8"],
        rows: closed.map((c) => {
          const o = open.find((r) => r.model === c.model);
          return [c.label, c.score.toFixed(2), o.score.toFixed(2), `+${(o.score - c.score).toFixed(2)}`, `${c.n * 2}\uAC74`];
        })
      },
      footnote: `1~5\uC810 \uCC99\uB3C4\uB85C \uCC44\uC810\uD588\uB2E4. \uD45C\uBCF8 ${TOTAL_RESPONSES}\uAC1C \uC751\uB2F5 \uC804\uCCB4\uB97C \uAC19\uC740 \uAE30\uC900\uC73C\uB85C \uCC44\uC810\uD588\uACE0, \uC810\uC218\uB294 \uC870\uAC74\uBCC4 \uD3C9\uADE0\uC774\uB2E4.`,
      children: /* @__PURE__ */ jsx4(
        DumbbellChart,
        {
          tone,
          rows: dumbbell,
          domain: [1, 5],
          ticks: [1, 2, 3, 4, 5],
          fromLabel: "\uC790\uB8CC \uC5C6\uC774",
          toLabel: "\uC790\uB8CC\uB97C \uC8FC\uACE0",
          digits: 2
        }
      )
    }
  );
}
function LlmBackendCharts({ tone = "light" }) {
  return /* @__PURE__ */ jsxs4("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [
    /* @__PURE__ */ jsx4(LatencySpreadChart, { tone }),
    /* @__PURE__ */ jsx4(ServingCostChart, { tone }),
    /* @__PURE__ */ jsx4(GroundingEffectChart, { tone })
  ] });
}

// MermaidDiagram.tsx
import { useEffect, useState as useState4 } from "react";
import mermaid from "mermaid";
import { jsx as jsx5 } from "react/jsx-runtime";
var seq = 0;
function MermaidDiagram({ chart, tone = "light", className = "" }) {
  const t = THEME[tone];
  const [svg, setSvg] = useState4("");
  const [error, setError] = useState4(null);
  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: tone === "dark" ? "dark" : "base",
      themeVariables: {
        primaryColor: tone === "dark" ? "#0F1729" : "#EAF6FC",
        primaryTextColor: t.ink,
        primaryBorderColor: t.rampMid,
        lineColor: t.rampMid,
        secondaryColor: tone === "dark" ? "#111A2E" : "#F7F9FC",
        tertiaryColor: tone === "dark" ? "#0B1120" : "#FFFFFF",
        background: "transparent",
        fontFamily: "Paperlogy, system-ui, sans-serif",
        fontSize: "13px"
      },
      flowchart: { curve: "basis", padding: 18, htmlLabels: true }
    });
    mermaid.render(`pc-mermaid-${++seq}`, chart).then(({ svg: out }) => {
      if (!cancelled) {
        setSvg(out);
        setError(null);
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "\uB2E4\uC774\uC5B4\uADF8\uB7A8\uC744 \uADF8\uB9AC\uC9C0 \uBABB\uD588\uC5B4\uC694");
    });
    return () => {
      cancelled = true;
    };
  }, [chart, tone, t.ink, t.rampMid]);
  if (error) {
    return /* @__PURE__ */ jsx5(
      "div",
      {
        style: {
          padding: 14,
          borderRadius: 12,
          border: `1px solid ${t.grid}`,
          fontFamily: "monospace",
          fontSize: 12,
          color: t.inkSoft
        },
        children: error
      }
    );
  }
  return /* @__PURE__ */ jsx5(
    "div",
    {
      className,
      style: { width: "100%", display: "flex", justifyContent: "center", overflowX: "auto" },
      dangerouslySetInnerHTML: { __html: svg }
    }
  );
}

// diagrams.ts
var LOCAL_LANGGRAPH = `flowchart LR
  U["\uCE74\uB4DC\uC54C\uB9BC \uC124\uC815\uD574\uC918"] --> C["\uBD84\uB958 \uB178\uB4DC<br/>\uD0A4\uC6CC\uB4DC \uADDC\uCE59\uC744 \uC0AC\uB78C\uC774 \uC791\uC131"]
  C -->|"\uADDC\uCE59\uC5D0 \uAC78\uB9BC"| T["\uB3C4\uAD6C \uC2E4\uD589 \uBD84\uAE30<br/>\uBC30\uC120\uB3C4 \uC0AC\uB78C\uC774"]
  C -->|"\uADDC\uCE59\uC5D0 \uC548 \uAC78\uB9BC"| G["\uC77C\uC0C1 \uB300\uD654\uB85C \uCC98\uB9AC"]
  T --> M["\uD30C\uC778\uD29C\uB2DD \uBAA8\uB378<br/>\uB9D0\uD22C\uB294 \uD559\uC2B5\uC73C\uB85C \uC8FC\uC785"]
  G --> M
  M --> R["\uC751\uB2F5"]

  N1["\uD45C\uD604\uC774 \uBC14\uB00C\uBA74 \uBABB \uC7A1\uB294\uB2E4<br/>\uB3C4\uAD6C\uAC00 \uB298\uBA74 \uBD84\uAE30\uB3C4 \uB298\uC5B4\uB09C\uB2E4"] -.-> C
`;
var API_TOOL_CALLING = `flowchart LR
  U["\uCE74\uB4DC\uC54C\uB9BC \uC124\uC815\uD574\uC918"] --> A["\uB3C4\uAD6C \uBAA9\uB85D\uC744 \uD568\uAED8 \uC804\uB2EC"]
  A --> L["\uBAA8\uB378\uC774 \uC2A4\uC2A4\uB85C \uD310\uB2E8<br/>\uC5B4\uB290 \uB3C4\uAD6C\uB97C \uC5B4\uB5A4 \uC778\uC790\uB85C"]
  L --> T["\uB3C4\uAD6C \uC2E4\uD589"]
  T --> R["\uC751\uB2F5"]

  subgraph TONE["\uB9D0\uD22C\uB97C \uC815\uD558\uB294 \uACF3"]
    S1["\uC131\uACA9 \uC9C0\uC2DC\uBB38"]
    S2["\uC608\uC2DC \uB300\uD654"]
    S3["\uAE08\uC9C0 \uADDC\uCE59"]
  end
  TONE --> L

  N1["\uBD84\uB958\uAE30\uAC00 \uD544\uC694 \uC5C6\uB2E4<br/>\uD45C\uD604\uC774 \uB2EC\uB77C\uB3C4 \uC54C\uC544\uC11C \uACE0\uB978\uB2E4"] -.-> L
`;
var BACKEND_SWITCH = `flowchart TB
  Q["\uAC19\uC740 \uC9C8\uBB38 \uBB36\uC74C"] --> SW{"\uBC31\uC5D4\uB4DC \uC804\uD658<br/>\uD658\uACBD\uBCC0\uC218 \uD55C \uC904"}
  SW -->|"\uC790\uCCB4 \uD638\uC2A4\uD305"| A["\uD30C\uC778\uD29C\uB2DD \uBAA8\uB378 \xB7 GPU"]
  SW -->|"\uC0C1\uC6A9 API"| B["\uC0C1\uC6A9 API"]
  A --> AM["\uAE34 \uB300\uD654\uC5D0\uC11C \uB290\uB9B0 5%\uAC00 24.7\uCD08<br/>GPU \uC2DC\uAC04\uB9CC\uD07C \uBE44\uC6A9"]
  B --> BM["\uAE34 \uB300\uD654\uC5D0\uC11C \uB290\uB9B0 5%\uAC00 2.3\uCD08<br/>\uC4F4 \uD1A0\uD070\uB9CC\uD07C \uBE44\uC6A9"]
  AM --> J["\uAC19\uC740 \uAE30\uC900\uC73C\uB85C \uCC44\uC810"]
  BM --> J
  J --> D["\uD488\uC9C8\uC740 \uB300\uB4F1<br/>\uC9C0\uC5F0\uACFC \uBE44\uC6A9\uC5D0\uC11C \uAC08\uB838\uB2E4"]
`;
var TRADEOFF_TABLE = `flowchart LR
  subgraph SELF["\uC790\uCCB4 \uD638\uC2A4\uD305 \uD30C\uC778\uD29C\uB2DD"]
    direction TB
    SA["\uB3C4\uAD6C \uC120\uD0DD<br/>\uC0AC\uB78C\uC774 \uBD84\uB958\uAE30 \uC791\uC131"]
    SB["\uB9D0\uD22C<br/>\uB370\uC774\uD130 \uB9CC\uB4E4\uC5B4 \uD559\uC2B5"]
    SC["\uBE44\uC6A9<br/>GPU \uC2DC\uAC04\uC5D0 \uBD99\uB294\uB2E4"]
  end

  subgraph API["\uC0C1\uC6A9 API"]
    direction TB
    AA["\uB3C4\uAD6C \uC120\uD0DD<br/>\uBAA8\uB378\uC774 \uC2A4\uC2A4\uB85C"]
    AB["\uB9D0\uD22C<br/>\uC9C0\uC2DC\uBB38\uACFC \uC608\uC2DC\uB85C"]
    AC["\uBE44\uC6A9<br/>\uC4F4 \uD1A0\uD070\uC5D0 \uBD99\uB294\uB2E4"]
  end

  SELF --> API
`;
var MODEL_JOURNEY = `flowchart LR
  S1["\uD30C\uC778\uD29C\uB2DD \uC2DC\uB3C4<br/>\uACFC\uC801\uD569"] --> S2["\uB2E4\uB978 \uBAA8\uB378<br/>\uD658\uACBD \uBBF8\uC9C0\uC6D0"]
  S2 --> S3["\uD30C\uC778\uD29C\uB2DD \uC131\uACF5<br/>\uC790\uCCB4 \uD638\uC2A4\uD305 \uC6B4\uC601"]
  S3 --> S4["\uC6B4\uC601\uC5D0\uC11C \uB4DC\uB7EC\uB09C \uBB38\uC81C<br/>\uC9C0\uC5F0 \xB7 GPU \uBE44\uC6A9 \xB7 \uAE34 \uB300\uD654 \uCDE8\uC57D"]
  S4 --> S5["\uC0C1\uC6A9 API \uB85C \uAD50\uCCB4<br/>\uCE21\uC815 \uD6C4 \uCC44\uD0DD"]
`;

// preview/preview.tsx
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
function Section({
  title,
  desc,
  tone,
  children
}) {
  const t = THEME[tone];
  return /* @__PURE__ */ jsxs5("section", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: [
    /* @__PURE__ */ jsxs5("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
      /* @__PURE__ */ jsx6(
        "h2",
        {
          style: {
            margin: 0,
            fontFamily: FONT_BODY,
            fontSize: "clamp(18px, 2vw, 22px)",
            fontWeight: 800,
            color: t.ink,
            letterSpacing: "-0.02em"
          },
          children: title
        }
      ),
      desc && /* @__PURE__ */ jsx6(
        "p",
        {
          style: {
            margin: 0,
            fontFamily: FONT_BODY,
            fontSize: 13.5,
            lineHeight: 1.7,
            color: t.inkSoft,
            maxWidth: 760,
            wordBreak: "keep-all"
          },
          children: desc
        }
      )
    ] }),
    children
  ] });
}
function DiagramCard({ title, chart, tone }) {
  const t = THEME[tone];
  return /* @__PURE__ */ jsxs5(
    "figure",
    {
      style: {
        margin: 0,
        padding: "clamp(16px, 2vw, 24px)",
        background: tone === "light" ? "#FFFFFF" : "#0F1729",
        border: `1px solid ${t.grid}`,
        borderRadius: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14
      },
      children: [
        /* @__PURE__ */ jsx6(
          "figcaption",
          {
            style: {
              fontFamily: FONT_MONO,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.1em",
              color: t.inkSoft,
              textTransform: "uppercase"
            },
            children: title
          }
        ),
        /* @__PURE__ */ jsx6(MermaidDiagram, { chart, tone })
      ]
    }
  );
}
function App() {
  const [tone, setTone] = useState5("light");
  const t = THEME[tone];
  return /* @__PURE__ */ jsx6(
    "div",
    {
      style: {
        minHeight: "100vh",
        background: t.surface,
        padding: "clamp(24px, 4vw, 56px) clamp(16px, 4vw, 48px)",
        transition: "background 200ms ease"
      },
      children: /* @__PURE__ */ jsxs5("div", { style: { maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 44 }, children: [
        /* @__PURE__ */ jsxs5("header", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: [
          /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsx6(
              "h1",
              {
                style: {
                  margin: 0,
                  fontFamily: FONT_BODY,
                  fontSize: "clamp(22px, 3vw, 30px)",
                  fontWeight: 800,
                  color: t.ink,
                  letterSpacing: "-0.03em"
                },
                children: "\uD30C\uC778\uD29C\uB2DD\uC5D0\uC11C \uC0C1\uC6A9 API \uB85C \u2014 \uBB34\uC5C7\uC744 \uBCF4\uACE0 \uAC08\uC544\uD0D4\uB098"
              }
            ),
            /* @__PURE__ */ jsx6(
              "button",
              {
                type: "button",
                onClick: () => setTone((v) => v === "light" ? "dark" : "light"),
                style: {
                  appearance: "none",
                  background: "transparent",
                  border: `1px solid ${t.grid}`,
                  borderRadius: 999,
                  padding: "7px 14px",
                  cursor: "pointer",
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: t.inkSoft,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap"
                },
                children: tone === "light" ? "\uB2E4\uD06C\uB85C \uBCF4\uAE30" : "\uB77C\uC774\uD2B8\uB85C \uBCF4\uAE30"
              }
            )
          ] }),
          /* @__PURE__ */ jsx6(
            "p",
            {
              style: {
                margin: 0,
                fontFamily: FONT_BODY,
                fontSize: 14,
                lineHeight: 1.75,
                color: t.inkSoft,
                maxWidth: 820,
                wordBreak: "keep-all"
              },
              children: "\uAC19\uC740 \uC9C8\uBB38 \uBB36\uC74C\uC744 \uB124 \uBC31\uC5D4\uB4DC\uC5D0 \uBCF4\uB0B4 \uC751\uB2F5 520\uAC1C\uB97C \uAC19\uC740 \uAE30\uC900\uC73C\uB85C \uCC44\uC810\uD588\uB2E4. \uAC08\uB9B0 \uC9C0\uC810\uC740 \uC138 \uACF3\uC774\uB2E4 \u2014 \uB3C4\uAD6C\uB97C \uB204\uAC00 \uACE0\uB974\uB294\uAC00, \uB9D0\uD22C\uB97C \uC5B4\uB514\uC11C \uB9CC\uB4DC\uB294\uAC00, \uBE44\uC6A9\uC774 \uBB34\uC5C7\uC5D0 \uBD99\uB294\uAC00."
            }
          )
        ] }),
        /* @__PURE__ */ jsx6(
          Section,
          {
            tone,
            title: "\uB3C4\uAD6C\uB97C \uB204\uAC00 \uACE0\uB974\uB294\uAC00",
            desc: "\uAC19\uC740 \uC694\uCCAD\uC744 \uB450 \uBC31\uC5D4\uB4DC\uAC00 \uB2E4\uB974\uAC8C \uCC98\uB9AC\uD55C\uB2E4. \uC791\uC740 \uC790\uCCB4 \uD638\uC2A4\uD305 \uBAA8\uB378\uC740 \uB3C4\uAD6C \uC120\uD0DD\uC744 \uB9E1\uAE38 \uC218 \uC5C6\uC5B4\uC11C \uC785\uB825\uC744 \uAC08\uB77C\uC8FC\uB294 \uADF8\uB798\uD504\uB97C \uC0AC\uB78C\uC774 \uC9DC\uC57C \uD55C\uB2E4 \u2014 \uADDC\uCE59\uC5D0 \uC5C6\uB294 \uD45C\uD604\uC740 \uADF8\uB0E5 \uC77C\uC0C1 \uB300\uD654\uB85C \uD758\uB7EC\uAC00\uACE0, \uB3C4\uAD6C\uB97C \uD558\uB098 \uBD99\uC77C \uB54C\uB9C8\uB2E4 \uBD84\uAE30\uC640 \uD0A4\uC6CC\uB4DC\uAC00 \uD568\uAED8 \uB298\uC5B4\uB09C\uB2E4. \uC0C1\uC6A9 API \uB294 \uB3C4\uAD6C \uBAA9\uB85D\uB9CC \uB118\uAE30\uBA74 \uC5B4\uB290 \uAC83\uC744 \uC5B4\uB5A4 \uC778\uC790\uB85C \uBD80\uB97C\uC9C0 \uC2A4\uC2A4\uB85C \uD310\uB2E8\uD558\uBBC0\uB85C \uBD84\uB958\uAE30 \uC790\uCCB4\uAC00 \uC0AC\uB77C\uC9C4\uB2E4.",
            children: /* @__PURE__ */ jsxs5("div", { style: { display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }, children: [
              /* @__PURE__ */ jsx6(DiagramCard, { tone, title: "\uC790\uCCB4 \uD638\uC2A4\uD305 \u2014 \uBD84\uB958\uAE30\uB97C \uC0AC\uB78C\uC774 \uC9E0\uB2E4", chart: LOCAL_LANGGRAPH }),
              /* @__PURE__ */ jsx6(DiagramCard, { tone, title: "\uC0C1\uC6A9 API \u2014 \uBAA8\uB378\uC774 \uC2A4\uC2A4\uB85C \uACE0\uB978\uB2E4", chart: API_TOOL_CALLING })
            ] })
          }
        ),
        /* @__PURE__ */ jsx6(
          Section,
          {
            tone,
            title: "\uC138 \uCD95\uC5D0\uC11C \uBB34\uC5C7\uC774 \uB2EC\uB77C\uC84C\uB098",
            desc: "\uB3C4\uAD6C \uC120\uD0DD, \uB9D0\uD22C, \uBE44\uC6A9 \uC138 \uAC00\uC9C0\uAC00 \uD568\uAED8 \uC6C0\uC9C1\uC600\uB2E4. \uB9D0\uD22C\uB294 \uD559\uC2B5\uC73C\uB85C \uC8FC\uC785\uD558\uB358 \uAC83\uC744 \uC9C0\uC2DC\uBB38\uACFC \uC608\uC2DC\uB85C \uC62E\uACBC\uACE0, \uBE44\uC6A9\uC740 GPU \uC2DC\uAC04\uC5D0\uC11C \uC4F4 \uD1A0\uD070\uC73C\uB85C \uC62E\uACBC\uB2E4.",
            children: /* @__PURE__ */ jsx6(DiagramCard, { tone, title: "\uAD50\uCCB4\uB85C \uBC14\uB010 \uC138 \uCD95", chart: TRADEOFF_TABLE })
          }
        ),
        /* @__PURE__ */ jsx6(
          Section,
          {
            tone,
            title: "\uCE21\uC815\uD55C \uAC12",
            desc: "\uD488\uC9C8\uC774 \uB300\uB4F1\uD558\uB2E4\uB294 \uAC78 \uBA3C\uC800 \uD655\uC778\uD55C \uB2E4\uC74C, \uC9C0\uC5F0\uACFC \uBE44\uC6A9\uC73C\uB85C \uACE8\uB790\uB2E4. \uC21C\uC11C\uAC00 \uC911\uC694\uD558\uB2E4 \u2014 \uD488\uC9C8 \uCC28\uC774\uAC00 \uC788\uC5C8\uB2E4\uBA74 \uB290\uB9AC\uACE0 \uBE44\uC2F8\uB3C4 \uB0A8\uACA8\uC57C \uD588\uB2E4.",
            children: /* @__PURE__ */ jsx6(LlmBackendCharts, { tone })
          }
        ),
        /* @__PURE__ */ jsxs5(
          Section,
          {
            tone,
            title: "\uAD50\uCCB4\uB97C \uC815\uD558\uAE30\uAE4C\uC9C0",
            desc: "\uC811\uC740 \uC2DC\uB3C4\uB97C \uC9C0\uC6B0\uC9C0 \uC54A\uC558\uB2E4. \uBB34\uC5C7\uC744 \uC65C \uC811\uC5C8\uB294\uC9C0\uAC00 \uD310\uB2E8\uC758 \uADFC\uAC70\uC774\uACE0, \uC131\uACF5\uB9CC \uB0A8\uAE30\uBA74 \uC6B4\uC774 \uC88B\uC558\uB358 \uAC83\uACFC \uAD6C\uBCC4\uB418\uC9C0 \uC54A\uB294\uB2E4.",
            children: [
              /* @__PURE__ */ jsx6(DiagramCard, { tone, title: "\uAC70\uCCD0\uC628 \uC21C\uC11C", chart: MODEL_JOURNEY }),
              /* @__PURE__ */ jsx6(DiagramCard, { tone, title: "\uC591\uCABD\uC744 \uBC14\uAFD4 \uB07C\uC6CC \uBE44\uAD50\uD55C \uAD6C\uC870", chart: BACKEND_SWITCH })
            ]
          }
        )
      ] })
    }
  );
}
createRoot(document.getElementById("root")).render(/* @__PURE__ */ jsx6(App, {}));
