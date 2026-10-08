export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return "N/A";
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

export function formatRate(rate) {
  if (rate === null || rate === undefined) return "N/A";
  return `${(rate * 100).toFixed(1)}%`;
}

export function errorMessage(err, fallback) {
  if (err?.response?.status === 403) return "You do not have permission to view this.";
  return err?.response?.data?.message || fallback;
}

// Status-aware message for operational actions (process/sync/download) and
// order loading. 403 and 429 get fixed, honest wording; everything else (409
// conflicts, provider-not-configured, 5xx) surfaces the backend's own message
// where it sent one, rather than a generic rewrite.
export function actionErrorMessage(err, fallback) {
  const status = err?.response?.status;
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 429) return "Too many requests. Please wait and try again.";
  return err?.response?.data?.message || fallback;
}
