// One status vocabulary for the whole app. Every status enum the API returns
// maps to a tone (colour) and two labels:
// - client: what SUPER_ADMIN / ADMIN / USER see. Every internal fulfilment
//   stage (locked, submitted, assistant or vendor work) reads "Being
//   prepared"; clients never see a stage name.
// - staff: what LauncherDesk staff and vendors see - the enum itself, as the
//   app has always shown it.
// Colour is always paired with text, never colour alone.

export const CLIENT_ROLES = ["SUPER_ADMIN", "ADMIN", "USER"];

export const TONES = {
  blue: "bg-brand-50 text-brand-700 ring-brand-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  vermilion: "bg-vermilion-50 text-vermilion-700 ring-vermilion-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
  marigold: "bg-marigold-50 text-marigold-700 ring-marigold-200",
  magenta: "bg-magenta-50 text-magenta-700 ring-magenta-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
};

export const DOT = {
  blue: "bg-brand-600",
  violet: "bg-violet-600",
  emerald: "bg-emerald-500",
  vermilion: "bg-vermilion-500",
  grey: "bg-slate-400",
  marigold: "bg-marigold-400",
  magenta: "bg-magenta-500",
  teal: "bg-teal-500",
};

const PREPARING = { tone: "violet", client: "Being prepared" };

// E-stamp request, order, order-processing and bulk vocabularies (their
// shared keys mean the same thing in each).
const REQUEST = {
  DRAFT: { tone: "grey", client: "Draft" },
  PAYMENT_PENDING: { tone: "marigold", client: "Awaiting payment" },
  PAYMENT_SUCCESS: { tone: "blue", client: "Submitted" },
  REQUEST_CREATED: { tone: "blue", client: "Submitted" },
  MODIFICATION_WINDOW: { tone: "blue", client: "Open to edit" },
  LOCKED: PREPARING,
  PROCESSING: PREPARING,
  SUBMITTING: PREPARING,
  SUBMITTED: PREPARING,
  ONGOING: PREPARING,
  COMPLETED: { tone: "emerald", client: "Issued" },
  DOWNLOAD_AVAILABLE: { tone: "emerald", client: "Issued" },
  ISSUED: { tone: "emerald", client: "Issued" },
  CANCELLED: { tone: "grey", client: "Cancelled" },
  FAILED: { tone: "vermilion", client: "Failed" },
  // Bulk batch
  UPLOADED: { tone: "grey", client: "Uploaded" },
  VALIDATING: { tone: "violet", client: "Checking" },
  PREVIEW_READY: { tone: "blue", client: "Ready to review" },
  CONFIRMED: PREPARING,
  PARTIALLY_FAILED: { tone: "vermilion", client: "Partly failed" },
  // Bulk batch item
  PENDING: { tone: "grey", client: "Pending" },
  VALID: { tone: "emerald", client: "Valid" },
  INVALID: { tone: "vermilion", client: "Invalid" },
  CREATED: { tone: "emerald", client: "Created" },
};

const BATCH = {
  ...REQUEST,
  COMPLETED: { tone: "emerald", client: "Completed" },
};

// Payment records. CREATED means "awaiting payment" here. Every audience
// sees the enum value itself (screens and tests refer to it by name).
const PAYMENT = {
  CREATED: { tone: "marigold" },
  SUCCESS: { tone: "emerald" },
  FAILED: { tone: "vermilion" },
  REFUNDED: { tone: "grey" },
};

// Whether a successful payment has reached the balance.
const BALANCE = {
  PENDING_CREDIT: { tone: "marigold", client: "Awaiting balance update", staff: "Awaiting balance update" },
  CREDITED: { tone: "emerald", client: "Credited", staff: "Credited" },
};

const ACCOUNT = {
  ACTIVE: { tone: "emerald", client: "Active" },
  INACTIVE: { tone: "grey", client: "Inactive" },
  SUSPENDED: { tone: "vermilion", client: "Suspended" },
  true: { tone: "emerald", client: "Active", staff: "Active" },
  false: { tone: "grey", client: "Inactive", staff: "Inactive" },
};

// Vendor stages: staff and vendor screens only. A client never sees these
// names - mapped to "Being prepared" if one ever reaches a client screen.
const VENDOR = {
  NOT_SENT: { tone: "grey", staff: "Not sent" },
  SENT: { tone: "magenta", staff: "To do" },
  ACCEPTED: { tone: "violet", staff: "In progress" },
  UPLOADED: { tone: "marigold", staff: "Awaiting review" },
  REJECTED: { tone: "vermilion", staff: "Needs re-upload" },
  APPROVED: { tone: "emerald", staff: "Approved" },
};

const VOCABULARIES = { request: REQUEST, batch: BATCH, payment: PAYMENT, balance: BALANCE, account: ACCOUNT, vendor: VENDOR };

export function isClientRole(role) {
  return CLIENT_ROLES.includes(role);
}

// statusMeta("LOCKED", { client: true }) -> { tone: "violet", label: "Being prepared" }
export function statusMeta(status, { kind = "request", client = false } = {}) {
  const vocab = VOCABULARIES[kind] || REQUEST;
  const key = String(status ?? "");
  const entry = vocab[key];
  const raw = key.replace(/_/g, " ");
  if (client) {
    if (kind === "vendor") return { tone: PREPARING.tone, label: PREPARING.client };
    return { tone: entry?.tone || "grey", label: entry?.client || raw };
  }
  return { tone: entry?.tone || "grey", label: entry?.staff || raw };
}
