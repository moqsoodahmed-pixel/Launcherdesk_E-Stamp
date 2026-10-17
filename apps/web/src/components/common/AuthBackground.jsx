// Decorative, auth-pages-only background: a handful of slow-floating
// blurred depth layers plus a genuine CSS 3D rotating glass cube (real
// rotateX/rotateY/translateZ faces, not an image or canvas). Everything
// animates only `transform`/`opacity` - compositor-only properties the GPU
// handles for free, no layout/paint cost - so it stays smooth even on a
// low-end phone, and respects prefers-reduced-motion (see index.css).
// Fixed + inset-0 + -z-10 + pointer-events-none: it can be dropped into any
// page without affecting that page's own layout or interactivity.
export default function AuthBackground() {
  return (
    <div className="auth-bg" aria-hidden="true">
      <div className="auth-bg__shape auth-bg__shape--1" />
      <div className="auth-bg__shape auth-bg__shape--2" />
      <div className="auth-bg__shape auth-bg__shape--3" />
      <div className="auth-bg__cube-scene">
        <div className="auth-bg__cube">
          <div className="auth-bg__face auth-bg__face--front" />
          <div className="auth-bg__face auth-bg__face--back" />
          <div className="auth-bg__face auth-bg__face--right" />
          <div className="auth-bg__face auth-bg__face--left" />
          <div className="auth-bg__face auth-bg__face--top" />
          <div className="auth-bg__face auth-bg__face--bottom" />
        </div>
      </div>
    </div>
  );
}
