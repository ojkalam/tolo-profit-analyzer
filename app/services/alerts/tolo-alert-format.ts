// Client-safe alert formatting (used by the alerts route UI). No server deps.

export function toloAlertHeadline(view: {
  kind: string;
  detail: Record<string, unknown>;
}): string {
  const d = view.detail;
  switch (view.kind) {
    case "negative":
      return `Losing money — reason: ${d.reason ?? "unknown"}`;
    case "margin_drop":
      return `Margin ${((Number(d.marginBps) || 0) / 100).toFixed(1)}% below floor ${((Number(d.floorBps) || 0) / 100).toFixed(1)}% — ${d.reason ?? ""}`;
    case "returns_spike":
      return `Returns spiked to ${d.refundRatePct ?? "?"}% of revenue (was ${d.priorRefundRatePct ?? "?"}%)`;
    default:
      return view.kind;
  }
}
