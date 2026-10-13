// Client-safe timelines. SUPER_ADMIN / ADMIN / USER only ever see these
// stages, in manual and provider mode alike:
//   Submitted -> Being prepared -> Issued   (or Failed / Cancelled)
// Internal steps (window end, queued, in progress, locked, submitted to the
// provider, status syncs, vendor work) all fold into "Being prepared".
//
// Each step: { label, at, done, pending, tone?, note? } - the shape the
// request timeline already renders.

const ISSUED = ["COMPLETED", "DOWNLOAD_AVAILABLE"];

function earliest(...dates) {
  const times = dates.filter(Boolean).map((d) => new Date(d).getTime()).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

// From an E-Stamp request plus its order payload ({ order }) as the request
// detail page loads them.
export function clientRequestSteps(request, orderPayload) {
  const o = orderPayload?.order;
  const steps = [{ label: "Submitted", at: request.createdAt, done: true }];
  if (request.status === "CANCELLED") {
    steps.push({ label: "Cancelled", at: request.cancelledAt || request.updatedAt, done: true, tone: "red" });
    return steps;
  }
  const failed = request.status === "FAILED" || o?.eStampStatus === "FAILED";
  const issued = o?.eStampStatus === "ISSUED" || ISSUED.includes(request.status);
  const inWindow = request.status === "MODIFICATION_WINDOW";
  const preparedAt = earliest(request.lockedAt, o?.startedAt, o?.submittedAt);
  if (inWindow) {
    // Not started yet: preparation begins when the edit window ends.
    steps.push({ label: "Being prepared", at: null, done: false, pending: false, note: "after the edit window" });
    return steps;
  }
  steps.push({ label: "Being prepared", at: preparedAt, done: issued || failed || !!preparedAt, pending: !issued && !failed });
  if (issued) steps.push({ label: "Issued", at: o?.issuedAt || null, done: true });
  else if (failed) steps.push({ label: "Failed", at: o?.updatedAt || null, done: true, tone: "red", note: o?.failureReason });
  return steps;
}

// From the order detail API's `timeline` (manual steps carry a `key`;
// provider steps only a `label`). Returns steps in the order detail shape:
// { label, at, upcoming?, inProgress?, downloadable?, reason? }.
const SUBMITTED = new Set(["submitted", "Submitted", "Request created"]);
const ISSUED_STEP = new Set(["issued", "Issued"]);
const FAILED_STEP = new Set(["failed", "Failed"]);
const DROP = new Set(["Certificate document attached"]);

export function clientOrderTimeline(timeline = []) {
  let submitted = null;
  let issued = null;
  let failed = null;
  const preparing = [];
  let upcomingWindow = null;
  for (const step of timeline) {
    const id = step.key || step.label;
    if (DROP.has(id)) continue;
    if (SUBMITTED.has(id)) submitted = submitted || step;
    else if (ISSUED_STEP.has(id)) issued = step;
    else if (FAILED_STEP.has(id)) failed = step;
    else if (step.upcoming) upcomingWindow = step;
    else preparing.push(step);
  }
  const out = [];
  if (submitted) out.push({ label: "Submitted", at: submitted.at });
  if (upcomingWindow && !preparing.length && !issued && !failed) {
    out.push({ label: "Being prepared", at: upcomingWindow.at, upcoming: true });
  } else if (preparing.length || issued || failed) {
    const at = earliest(...preparing.filter((s) => s.key !== "window").map((s) => s.at)) || earliest(...preparing.map((s) => s.at));
    out.push({ label: "Being prepared", at, inProgress: !issued && !failed });
  }
  if (issued) out.push({ label: "Issued", at: issued.at, downloadable: issued.downloadable });
  else if (failed) out.push({ label: "Failed", at: failed.at, reason: failed.reason });
  return out;
}
