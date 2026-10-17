// Decorative, auth-pages-only background - inspired by (not copied from)
// a reference "floating glass panels + diagonal grid + soft glow" style:
// a diagonal line mesh, several floating translucent glass panels, a soft
// glow halo behind where the logo sits, a couple of hollow decorative
// rings, two blurred depth-color orbs, and a genuine CSS 3D rotating
// glass cube (real rotateX/rotateY/translateZ faces, not an image or
// canvas). Everything animates only `transform`/`opacity` (the grid pans
// via `background-position`, the one exception, but it's a single cheap
// full-screen layer) - no layout/paint cost, smooth on a low-end phone,
// and respects prefers-reduced-motion (see index.css). Fixed + inset-0 +
// -z-10 + pointer-events-none: drop it into any page without affecting
// that page's own layout, interactivity, or - per the brief - the login
// card itself, which this never touches.
export default function AuthBackground() {
  return (
    <div className="auth-bg" aria-hidden="true">
      <div className="auth-bg__grid" />
      <div className="auth-bg__glow" />
      <div className="auth-bg__shape auth-bg__shape--1" />
      <div className="auth-bg__shape auth-bg__shape--2" />
      <div className="auth-bg__panel auth-bg__panel--1" />
      <div className="auth-bg__panel auth-bg__panel--2" />
      <div className="auth-bg__panel auth-bg__panel--3" />
      <div className="auth-bg__ring auth-bg__ring--1" />
      <div className="auth-bg__ring auth-bg__ring--2" />
      <div className="auth-bg__dot" />
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
