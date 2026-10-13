// Lucide icon wrapper: consistent size and stroke, hidden from assistive tech
// unless given a `label`.
export default function Icon({ icon: IconCmp, size = 18, label, className = "", strokeWidth = 1.75 }) {
  if (!IconCmp) return null;
  return label ? (
    <IconCmp size={size} strokeWidth={strokeWidth} className={className} role="img" aria-label={label} />
  ) : (
    <IconCmp size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" focusable="false" />
  );
}
