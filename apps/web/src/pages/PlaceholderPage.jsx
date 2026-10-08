// Extension point: this module's data model, API routes and services already
// exist on the backend (see docs/api.md). This page is intentionally a thin
// shell so the next iteration (e.g. via Claude Code) can wire up the UI
// against the existing endpoints without re-deriving the architecture.
export default function PlaceholderPage({ title }) {
    return (<div>
      <h1 className="text-xl font-semibold text-slate-900 mb-2">{title}</h1>
      <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 text-sm">
        This module's backend API is implemented. UI build-out is a documented Phase 1 extension point.
      </div>
    </div>);
}
