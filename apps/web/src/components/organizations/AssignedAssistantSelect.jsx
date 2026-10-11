import { useEffect, useId, useState } from "react";
import { apiClient } from "../../api/client";

// Dropdown of active Assistant Master Admins (Master Admin only - the
// server re-checks that the chosen user is an active assistant). "" means
// "No assistant" (only Master Admins handle the client).
export default function AssignedAssistantSelect({ value, onChange, disabled, label = "Assigned assistant" }) {
  const id = useId();
  const [assistants, setAssistants] = useState([]);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    apiClient
      .get("/users", { params: { role: "ASSISTANT_MASTER_ADMIN", status: "active", limit: 100 } })
      .then((res) => setAssistants(res.data.data.items || []))
      .catch(() => setLoadError("Could not load assistants."));
  }, []);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      <select
        id={id}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <option value="">No assistant (Master Admins only)</option>
        {assistants.map((a) => (
          <option key={a._id} value={a._id}>
            {a.name} ({a.email})
          </option>
        ))}
      </select>
      {loadError && <p className="text-xs text-red-600 mt-1">{loadError}</p>}
      <p className="text-xs text-slate-500 mt-1">The assigned assistant credits this client's payments and manages its balance.</p>
    </div>
  );
}
