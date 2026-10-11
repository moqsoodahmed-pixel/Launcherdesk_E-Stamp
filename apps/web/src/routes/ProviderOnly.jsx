import { useAuth } from "../context/AuthContext";
import { isManualFulfilment } from "../utils/fulfilment";

// Provider screens only exist in provider mode. In manual mode the server
// refuses the provider endpoints too (409); this just explains why.
export default function ProviderOnly({ children }) {
  const { user } = useAuth();
  if (!isManualFulfilment(user)) return children;
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-2">E-Stamp Provider</h1>
      <div role="status" className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-600">
        Manual fulfilment is enabled. Orders are stamped by LauncherDesk staff and fulfilled from <span className="font-medium">Orders to fulfil</span>, so there is no E-Stamp provider account to show.
      </div>
    </div>
  );
}
