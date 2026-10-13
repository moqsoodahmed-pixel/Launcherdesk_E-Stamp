// One chart system for every Recharts chart. The categorical palette is
// assigned in this fixed order, never cycled (validated: lightness band,
// chroma, CVD separation; marigold sits below 3:1 on white, so charts that
// use slot 3 keep a legend or visible labels).
export const CHART_COLORS = ["#2B3FD9", "#0E9AA7", "#F59607", "#C13584", "#12A36B", "#7C52F3"];

// Status series (issued / being prepared / failed) use the status colours,
// always alongside their text label on the axis or legend.
export const STATUS_COLORS = { issued: "#12A36B", preparing: "#7C52F3", failed: "#E5484D" };

const INK_MUTED = "#545C7A";
const GRID = "#E1E4EE";

export const gridProps = { strokeDasharray: "0", stroke: GRID, vertical: false };
export const axisProps = { tick: { fontSize: 12, fill: INK_MUTED }, tickLine: false, axisLine: { stroke: GRID }, tickMargin: 8 };
export const yAxisProps = { ...axisProps, axisLine: false, width: 48 };

export const tooltipProps = {
  cursor: { fill: "rgba(43, 63, 217, 0.06)", stroke: GRID },
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${GRID}`,
    boxShadow: "0 12px 24px -6px rgb(20 25 63 / 0.14)",
    fontSize: 12,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
  },
  labelStyle: { color: "#14182B", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "#333A54" },
};

export const legendProps = { iconType: "circle", iconSize: 8, wrapperStyle: { fontSize: 12, color: INK_MUTED, paddingTop: 8 } };

// Thin bars with 4px rounded data ends.
export const barProps = { radius: [4, 4, 0, 0], maxBarSize: 40 };
export const lineProps = { type: "monotone", strokeWidth: 2, dot: false, activeDot: { r: 4, strokeWidth: 2, stroke: "#fff" } };
