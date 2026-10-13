export default function ContactSupportModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-slate-200">
        <div className="flex justify-between items-start border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">LauncherDesk Support</h3>
            <p className="text-xs text-slate-500">Dedicated assistance for E-Stamp subscribers</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-sm text-slate-700">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">✉️</span>
              <div>
                <p className="text-xs text-slate-500">Email Support</p>
                <a href="mailto:contact@launcherdesk.com" className="font-semibold text-brand-600 hover:underline">
                  contact@launcherdesk.com
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
              <span className="text-lg">📞</span>
              <div>
                <p className="text-xs text-slate-500">Super Admin Priority Line</p>
                <a href="tel:+918000123456" className="font-semibold text-slate-800 hover:underline">
                  +91 (800) 012-3456
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-800">
            <p className="font-semibold mb-0.5">⚡ Priority SLA Active</p>
            <p>Super Admin inquiries receive guaranteed responses within 2 business hours.</p>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
