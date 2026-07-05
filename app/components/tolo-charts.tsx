// Dependency-free, SSR-safe SVG charts for Tolo. Colors are validated against
// the dataviz skill's checks (light + dark); every mark is directly labeled so
// identity never rests on color alone. Theme handled via CSS custom properties
// with a prefers-color-scheme dark override injected once.
import { toloFormatCents, toloFormatBps } from "../services/profit/tolo-format";

const TOLO_CHART_STYLE = `
.tolo-chart { --tolo-cost: #B54708; --tolo-pos: #087443; --tolo-neg: #B42318;
  --tolo-total: #354052; --tolo-grid: #E3E3E3; --tolo-ink: #303030;
  --tolo-muted: #616161; font: inherit; width: 100%; }
.tolo-chart text { fill: var(--tolo-ink); }
.tolo-chart .tolo-muted { fill: var(--tolo-muted); }
.tolo-chart .tolo-grid { stroke: var(--tolo-grid); stroke-width: 1; }
@media (prefers-color-scheme: dark) {
  .tolo-chart { --tolo-cost: #C0761F; --tolo-pos: #1F9268; --tolo-neg: #E85049;
    --tolo-total: #C9D1DC; --tolo-grid: #333; --tolo-ink: #E3E3E3;
    --tolo-muted: #A0A0A0; }
}
:root[data-theme="dark"] .tolo-chart { --tolo-cost: #C0761F; --tolo-pos: #1F9268;
  --tolo-neg: #E85049; --tolo-total: #C9D1DC; --tolo-grid: #333;
  --tolo-ink: #E3E3E3; --tolo-muted: #A0A0A0; }
`;

function ToloChartStyle() {
  return <style dangerouslySetInnerHTML={{ __html: TOLO_CHART_STYLE }} />;
}

export interface ToloWaterfallStep {
  label: string;
  /** Signed delta in cents: revenue positive, costs negative. */
  deltaCents: number;
  kind: "total" | "cost" | "result";
}

/**
 * Build waterfall steps from profit totals: revenue → −discounts → −refunds →
 * −COGS → −shipping → −fees → −ads → net profit.
 */
export function toloWaterfallSteps(t: {
  grossCents: number;
  discountCents: number;
  refundCents: number;
  cogsCents: number;
  shippingCostCents: number;
  feeCents: number;
  adSpendCents: number;
  netProfitCents: number;
}): ToloWaterfallStep[] {
  return [
    { label: "Revenue", deltaCents: t.grossCents, kind: "total" },
    { label: "Discounts", deltaCents: -t.discountCents, kind: "cost" },
    { label: "Refunds", deltaCents: -t.refundCents, kind: "cost" },
    { label: "COGS", deltaCents: -t.cogsCents, kind: "cost" },
    { label: "Shipping", deltaCents: -t.shippingCostCents, kind: "cost" },
    { label: "Fees", deltaCents: -t.feeCents, kind: "cost" },
    { label: "Ad spend", deltaCents: -t.adSpendCents, kind: "cost" },
    { label: "Net profit", deltaCents: t.netProfitCents, kind: "result" },
  ];
}

interface ToloWaterfallBar {
  step: ToloWaterfallStep;
  base: number;
  top: number;
}

/** Pure layout: place each floating bar against the running total. */
export function toloWaterfallBars(
  steps: ToloWaterfallStep[],
): ToloWaterfallBar[] {
  const bars: ToloWaterfallBar[] = [];
  let running = 0;
  for (const step of steps) {
    if (step.kind === "total" || step.kind === "result") {
      running = step.deltaCents;
      bars.push({ step, base: 0, top: step.deltaCents });
    } else {
      const start = running;
      const end = running + step.deltaCents; // delta is negative for costs
      running = end;
      bars.push({ step, base: Math.min(start, end), top: Math.max(start, end) });
    }
  }
  return bars;
}

export function ToloWaterfallChart({
  steps,
  currency,
  height = 280,
}: {
  steps: ToloWaterfallStep[];
  currency: string;
  height?: number;
}) {
  const width = 720;
  const padTop = 24;
  const padBottom = 56;
  const padX = 8;
  const plotH = height - padTop - padBottom;
  const n = steps.length;
  const slot = (width - padX * 2) / n;
  const barW = Math.min(64, slot * 0.6);

  const bars = toloWaterfallBars(steps);

  const maxVal = Math.max(
    1,
    ...bars.map((b) => Math.max(Math.abs(b.top), Math.abs(b.base))),
  );
  const y = (cents: number) => padTop + plotH - (cents / maxVal) * plotH;
  const zeroY = y(0);

  const colorFor = (step: ToloWaterfallStep) => {
    if (step.kind === "cost") return "var(--tolo-cost)";
    if (step.kind === "result")
      return step.deltaCents >= 0 ? "var(--tolo-pos)" : "var(--tolo-neg)";
    return "var(--tolo-total)";
  };

  return (
    <div className="tolo-chart">
      <ToloChartStyle />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Profit waterfall from revenue to net profit"
        style={{ width: "100%", height: "auto" }}
      >
        <line
          className="tolo-grid"
          x1={padX}
          x2={width - padX}
          y1={zeroY}
          y2={zeroY}
        />
        {bars.map(({ step, base, top }, i) => {
          const x = padX + i * slot + (slot - barW) / 2;
          const yTop = y(top);
          const barH = Math.max(2, Math.abs(y(base) - y(top)));
          const labelY = yTop - 6 < padTop ? y(base) + 14 : yTop - 6;
          return (
            <g key={step.label}>
              <title>{`${step.label}: ${toloFormatCents(step.deltaCents, currency)}`}</title>
              <rect
                x={x}
                y={yTop}
                width={barW}
                height={barH}
                rx={4}
                fill={colorFor(step)}
              />
              <text
                x={x + barW / 2}
                y={labelY}
                textAnchor="middle"
                fontSize={11}
              >
                {toloFormatCents(step.deltaCents, currency)}
              </text>
              <text
                className="tolo-muted"
                x={x + barW / 2}
                y={height - padBottom + 18}
                textAnchor="middle"
                fontSize={11}
              >
                {step.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface ToloTrendDatum {
  date: string;
  netProfitCents: number;
  marginBps: number;
}

/**
 * Two stacked single-series charts (never a dual axis): net profit ($) as an
 * area+line, and margin (%) as a line below it. End points are direct-labeled.
 */
export function ToloTrendChart({
  data,
  currency,
  height = 200,
}: {
  data: ToloTrendDatum[];
  currency: string;
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div className="tolo-chart">
        <ToloChartStyle />
        <s-paragraph>No data in this range yet.</s-paragraph>
      </div>
    );
  }
  const width = 720;
  const padX = 40;
  const padTop = 16;
  const padBottom = 28;
  const plotH = height - padTop - padBottom;

  const xs = (i: number) =>
    data.length === 1
      ? width / 2
      : padX + (i / (data.length - 1)) * (width - padX * 2);

  const profits = data.map((d) => d.netProfitCents);
  const maxP = Math.max(1, ...profits.map((p) => Math.abs(p)));
  const yP = (cents: number) =>
    padTop + plotH / 2 - (cents / maxP) * (plotH / 2);

  const line = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${yP(d.netProfitCents)}`)
    .join(" ");
  const area = `${line} L ${xs(data.length - 1)} ${yP(0)} L ${xs(0)} ${yP(0)} Z`;
  const last = data[data.length - 1];

  return (
    <div className="tolo-chart">
      <ToloChartStyle />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily net profit trend"
        style={{ width: "100%", height: "auto" }}
      >
        <line
          className="tolo-grid"
          x1={padX}
          x2={width - padX}
          y1={yP(0)}
          y2={yP(0)}
        />
        <path d={area} fill="var(--tolo-pos)" opacity={0.12} />
        <path
          d={line}
          fill="none"
          stroke="var(--tolo-pos)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle key={d.date} cx={xs(i)} cy={yP(d.netProfitCents)} r={2.5}
            fill="var(--tolo-pos)">
            <title>{`${d.date}: ${toloFormatCents(d.netProfitCents, currency)} · margin ${toloFormatBps(d.marginBps)}`}</title>
          </circle>
        ))}
        <text
          x={width - padX + 4}
          y={yP(last.netProfitCents)}
          fontSize={11}
          dominantBaseline="middle"
        >
          {toloFormatCents(last.netProfitCents, currency)}
        </text>
        <text className="tolo-muted" x={padX} y={height - 8} fontSize={10}>
          {data[0].date}
        </text>
        <text
          className="tolo-muted"
          x={width - padX}
          y={height - 8}
          fontSize={10}
          textAnchor="end"
        >
          {last.date}
        </text>
      </svg>
    </div>
  );
}

/** A KPI stat tile — hero number with a delta caption. */
export function ToloStat({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "neutral" | "success" | "critical";
}) {
  const color =
    tone === "success"
      ? "var(--tolo-pos, #087443)"
      : tone === "critical"
        ? "var(--tolo-neg, #B42318)"
        : "inherit";
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-500">
        <span style={{ fontSize: 13, color: "var(--tolo-muted, #616161)" }}>
          {label}
        </span>
        <div style={{ fontSize: 28, fontWeight: 650, color }}>{value}</div>
        {caption && <s-text>{caption}</s-text>}
      </s-stack>
    </s-box>
  );
}
