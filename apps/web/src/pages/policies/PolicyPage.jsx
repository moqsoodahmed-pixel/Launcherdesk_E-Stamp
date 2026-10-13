import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";

// Phase 16 - user-facing Terms/Privacy/Refund policy view + explicit
// acceptance. This is a SOFTWARE MECHANISM only: no approved legal content
// has been supplied anywhere in this repository - whatever `content` the
// API returns is rendered verbatim (plain text, see the note below), never
// edited or embellished here.
const POLICY_TYPES = [
  { value: "TERMS", label: "Terms of Service" },
  { value: "PRIVACY", label: "Privacy Policy" },
  { value: "REFUND", label: "Refund Policy" },
];

export default function PolicyPage() {
  const { user } = useAuth();
  const [type, setType] = useState("TERMS");
  const [current, setCurrent] = useState(undefined); // undefined = loading, null = not yet published
  const [myAcks, setMyAcks] = useState([]);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setCurrent(undefined);
    setAgreed(false);
    setError(null);
    apiClient
      .get(`/policies/${type}/current`)
      .then((res) => setCurrent(res.data.data))
      .catch((err) => {
        setError(getErrorMessage(err, "Failed to load this policy."));
        setCurrent(null);
      });
    if (user) {
      apiClient
        .get("/policies/acknowledgements/mine")
        .then((res) => setMyAcks(res.data.data.items))
        .catch(() => setMyAcks([]));
    }
  }, [type, user]);

  useEffect(() => {
    load();
  }, [load]);

  const myAckForType = myAcks.find((a) => a.policyType === type);
  const hasAcceptedCurrent = !!current && !!myAckForType && myAckForType.policyVersion === current.version;

  async function handleAccept() {
    if (!current || !agreed) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/policies/acknowledge", { policyType: type, acknowledgedVersion: current.version, context: "GENERAL" });
      setNotice(`You have accepted ${current.title} v${current.version}.`);
      load();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to record your acceptance."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Policies</h1>

      <div className="flex flex-wrap gap-2 mb-4">
        {POLICY_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${type === t.value ? "bg-brand-600 text-white" : "bg-white border border-slate-300 text-slate-600"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">{notice}</div>}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="card p-6">
        {current === undefined && <p className="text-slate-400 text-sm">Loading...</p>}
        {current === null && !error && (
          <p className="text-slate-500 text-sm">
            There is no published {POLICY_TYPES.find((t) => t.value === type)?.label} yet - it has not been finalized/published on this platform.
          </p>
        )}
        {current && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-slate-900">{current.title}</h2>
              <span className="text-xs text-slate-500">
                Version {current.version} &middot; effective {current.effectiveAt ? new Date(current.effectiveAt).toLocaleDateString() : "-"}
              </span>
            </div>
            {/* Plain text content only - rendered as ordinary text, never
                dangerouslySetInnerHTML. white-space:pre-wrap preserves the
                author's line breaks without any HTML/Markdown parsing. */}
            <p className="text-sm text-slate-700 whitespace-pre-wrap max-h-96 overflow-y-auto border border-slate-100 rounded-lg p-4 bg-slate-50">{current.content}</p>

            {hasAcceptedCurrent ? (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
                You accepted this version ({myAckForType.policyVersion}) on {new Date(myAckForType.acceptedAt).toLocaleString()}.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {myAckForType && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    A newer version has been published since you last accepted version {myAckForType.policyVersion}. Please review and accept the current version above.
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="rounded border-slate-300" />
                  I have read and agree to this {POLICY_TYPES.find((t) => t.value === type)?.label} (v{current.version}).
                </label>
                <button
                  onClick={handleAccept}
                  disabled={!agreed || submitting}
                  className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {submitting ? "Recording..." : "I Agree"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {user && myAcks.length > 0 && (
        <div className="card overflow-hidden mt-6">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-900">Your acceptance history</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Policy</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Version</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Accepted at</th>
              </tr>
            </thead>
            <tbody>
              {myAcks.map((a) => (
                <tr key={a._id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{a.policyType}</td>
                  <td className="px-4 py-3">{a.policyVersion}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(a.acceptedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
