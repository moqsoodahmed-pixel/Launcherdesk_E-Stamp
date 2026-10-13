import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { actionErrorMessage } from "../../utils/format";

export const AUTO_HIDE_MS = 30000;

// Master Admin only. Shows a user's SYSTEM-GENERATED temporary password on
// demand (GET /users/:id/temporary-password). Nothing is fetched until Show
// or Copy is clicked; a shown password hides itself after 30 seconds and is
// dropped from memory when the row unmounts (navigation). Never written to
// storage or the URL. A password the user chose is never revealable.
export default function TemporaryPasswordCell({ userId, passwordState, setByLabel = "Set by user", label = "password" }) {
  const [value, setValue] = useState(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    []
  );

  if (passwordState !== "TEMPORARY") return <span className="text-xs text-slate-500">{setByLabel}</span>;

  async function load() {
    if (value) return value;
    setBusy(true);
    setError("");
    try {
      const res = await apiClient.get(`/users/${userId}/temporary-password`);
      const pw = res.data?.data?.tempPassword || "";
      setValue(pw);
      return pw;
    } catch (err) {
      setError(err?.response?.status === 404 ? err.response.data?.message || "No temporary password available." : actionErrorMessage(err, "Could not load the password."));
      return null;
    } finally {
      setBusy(false);
    }
  }
  function hideAndForget() {
    clearTimeout(timer.current);
    setVisible(false);
    setValue(null);
  }
  async function toggle() {
    if (visible) return hideAndForget();
    const pw = await load();
    if (!pw) return;
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(hideAndForget, AUTO_HIDE_MS);
  }
  async function copy() {
    const pw = await load();
    if (!pw) return;
    try {
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy to the clipboard.");
    }
    // Copy without Show keeps nothing in memory.
    if (!visible) setValue(null);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <code className="font-mono text-xs text-slate-800" aria-label={`Temporary ${label}`}>
        {visible && value ? value : "••••••••"}
      </code>
      <button type="button" onClick={toggle} disabled={busy} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 disabled:opacity-50" aria-label={`${visible ? "Hide" : "Show"} ${label}`}>
        {visible ? "Hide" : "Show"}
      </button>
      <button type="button" onClick={copy} disabled={busy} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 disabled:opacity-50" aria-label={`Copy ${label}`}>
        {copied ? "Copied" : "Copy"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 w-full">
          {error}
        </span>
      )}
    </span>
  );
}
