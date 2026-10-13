import { Mail, Phone, Zap } from "lucide-react";
import Modal from "../ui/Modal";

export default function ContactSupportModal({ onClose }) {
  return (
    <Modal title="LauncherDesk Support" description="Dedicated assistance for E-Stamp subscribers" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-700">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <Mail size={20} className="shrink-0 text-brand-700" aria-hidden="true" />
            <div>
              <p className="text-xs text-slate-500">Email Support</p>
              <a href="mailto:support@launcherdesk.com" className="font-semibold text-brand-700 hover:underline">
                support@launcherdesk.com
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-slate-200 pt-3">
            <Phone size={20} className="shrink-0 text-brand-700" aria-hidden="true" />
            <div>
              <p className="text-xs text-slate-500">Super Admin Priority Line</p>
              <a href="tel:+918000123456" className="font-semibold text-slate-800 hover:underline">
                +91 (800) 012-3456
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p className="mb-0.5 flex items-center gap-1.5 font-semibold">
            <Zap size={14} aria-hidden="true" /> Priority SLA Active
          </p>
          <p>Super Admin inquiries receive guaranteed responses within 2 business hours.</p>
        </div>
      </div>
    </Modal>
  );
}
