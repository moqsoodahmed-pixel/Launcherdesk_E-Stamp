// Phase 21 - honest empty state used everywhere a widget has zero data.
// Never rendered alongside a fabricated 0/N/A value - callers show EITHER
// this OR the real content, never both.
export default function EmptyState({ text = "Nothing here yet." }) {
  return <p className="text-sm text-slate-400 py-10 text-center">{text}</p>;
}
