export const RATE_LIMIT_MESSAGE = "Too many requests, try again shortly.";
export const NETWORK_ERROR_MESSAGE = "Network error, check your connection.";
export const TIMEOUT_MESSAGE = "Request timed out. Please try again.";

// One place that turns an axios error into a user-facing sentence, replacing
// the copy-pasted `err?.response?.data?.message || "Failed to..."` pattern.
export function getErrorMessage(err, fallback = "Something went wrong.") {
  if (!err) return fallback;
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") return TIMEOUT_MESSAGE;
  const response = err.response;
  if (!response) return err.isAxiosError || err.request ? NETWORK_ERROR_MESSAGE : fallback;
  if (response.status === 429) return RATE_LIMIT_MESSAGE;
  const serverMessage = response.data?.message;
  return typeof serverMessage === "string" && serverMessage.trim() ? serverMessage : fallback;
}
