// The one decorative motif: a perforated stamp edge. Used on the balance
// card, the login brand panel and certificate cards.
// tone: "light" (white card) or "brand" (deep ultramarine).
export default function StampCard({ children, tone = "light", className = "", innerClassName = "", as: Tag = "div", ...rest }) {
  const surface = tone === "brand" ? "bg-brand-800 text-white" : "bg-white text-slate-900";
  const inner = tone === "brand" ? "border-white/25" : "border-slate-200";
  return (
    <Tag className={`perforated rounded-card ${surface} ${className}`} {...rest}>
      <div className={`h-full rounded-[8px] border ${inner} p-5 sm:p-6 ${innerClassName}`}>{children}</div>
    </Tag>
  );
}
