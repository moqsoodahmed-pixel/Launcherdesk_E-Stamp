// The server's ESTAMP_FULFILMENT mode, delivered on the user object by
// GET /auth/me and the login response (never a build-time constant).
// "manual": LauncherDesk staff stamp outside the app and upload the
// certificate; "provider": automated E-Stamp provider integration.
// Missing (an older API) falls back to the server default, "manual".
// UX only - every route is enforced server-side.
export function fulfilmentModeOf(user) {
  return user?.fulfilmentMode === "provider" ? "provider" : "manual";
}

export function isManualFulfilment(user) {
  return fulfilmentModeOf(user) === "manual";
}
