import { LogoMark, StampIllustration } from "./Brand";

function BrandPanel({ compact = false }) {
  return (
    <div className={`relative flex flex-col justify-between bg-brand-800 text-white ${compact ? "rounded-t-card p-6 md:rounded-l-card md:rounded-tr-none" : "p-10 xl:p-14"}`}>
      <div className="flex items-center gap-3">
        <LogoMark className="h-10 w-10" />
        <div>
          <p className="font-display text-lg font-semibold leading-tight">LauncherDesk</p>
          <p className="text-sm text-white/75">E-stamping</p>
        </div>
      </div>
      <div className={`flex justify-center ${compact ? "py-6" : "py-10"}`}>
        <StampIllustration className={compact ? "w-40" : "w-full max-w-[300px]"} />
      </div>
      {!compact && (
        <div className="max-w-sm">
          <p className="font-display text-2xl font-semibold leading-snug">E-stamp paper for every agreement, requested and tracked in one place.</p>
          <p className="mt-3 text-sm text-white/75">Check the details, pay from your balance and download the certificate when it is issued.</p>
        </div>
      )}
    </div>
  );
}

// Two-panel auth screen: brand panel with the perforated stamp illustration,
// form beside it. Below lg the brand panel collapses to a logo row.
// `inline` renders the same two panels as a card inside the app shell (403).
export default function AuthLayout({ title, subtitle, children, inline = false, role }) {
  if (inline) {
    return (
      <div className="card grid overflow-hidden md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" role={role}>
        <BrandPanel compact />
        <div className="p-6 sm:p-10">
          {title && <h1 className="font-display text-2xl font-semibold text-slate-900">{title}</h1>}
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className={title || subtitle ? "mt-6" : ""}>{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="hidden lg:flex lg:flex-col [&>div]:flex-1">
        <BrandPanel />
      </div>
      <main className="flex min-w-0 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-8 flex items-center gap-3 self-start sm:self-center lg:hidden">
          <LogoMark className="h-9 w-9" />
          <span className="font-display text-lg font-semibold text-slate-900">LauncherDesk</span>
        </div>
        <div className="w-full max-w-md" role={role}>
          {title && <h1 className="font-display text-3xl font-semibold text-slate-900">{title}</h1>}
          {subtitle && <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>}
          <div className={title || subtitle ? "mt-8" : ""}>{children}</div>
        </div>
      </main>
    </div>
  );
}
