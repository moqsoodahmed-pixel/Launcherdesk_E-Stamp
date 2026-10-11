import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errors";

// Loading / error / data / refetch for one async request, with the in-flight
// request aborted on unmount or when `deps` change (so a slow stale response
// can never overwrite a newer one).
//
//   const { data, loading, error, refetch } = useApi(
//     (signal) => apiClient.get("/articles", { params, signal }).then((r) => r.data.data),
//     [params.page], { errorMessage: "Failed to load articles." });
//
// Pass `{ enabled: false }` to skip fetching until ready.
export function useApi(fetcher, deps = [], { errorMessage = "Failed to load data.", enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const controllerRef = useRef(null);

  const run = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    return Promise.resolve()
      .then(() => fetcherRef.current(controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError(getErrorMessage(err, errorMessage));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorMessage, ...deps]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    run();
    return () => controllerRef.current?.abort();
  }, [run, enabled]);

  return { data, loading, error, refetch: run, setData };
}
