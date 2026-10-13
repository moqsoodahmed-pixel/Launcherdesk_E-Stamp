import { Link } from "react-router-dom";
import PageHeader from "../../components/common/PageHeader";

// Edit these two values to change the About page.
const SUPPORT_EMAIL = "support@launcherdesk.com";
const PRODUCT_DESCRIPTION =
  "LauncherDesk E-Stamping lets organisations create, track and download E-Stamp requests, " +
  "fund a wallet, and manage their team in one place.";

export default function AboutPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="About" />
      <div className="card p-6 space-y-4 text-sm text-slate-700">
        <div>
          <p className="text-lg font-semibold text-slate-900">LauncherDesk E-Stamping</p>
          <p className="mt-1">{PRODUCT_DESCRIPTION}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Support</p>
          <a className="font-medium text-brand-700 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </div>
        <div>
          <p className="text-xs text-slate-500">Legal</p>
          <Link className="font-medium text-brand-700 hover:underline" to="/policies">
            Terms of Service, Privacy Policy and Refund Policy
          </Link>
        </div>
      </div>
    </div>
  );
}