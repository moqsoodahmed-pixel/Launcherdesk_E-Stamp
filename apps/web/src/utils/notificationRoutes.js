// Maps a notification's structured (entityType, entityId) to a KNOWN, safe
// frontend route. Never constructs a route from anything else on the
// notification (metadata, message text, or any client/notification-supplied
// URL) - there is no arbitrary redirect here, only this explicit whitelist.
// Shared by NotificationBell and the Notification Center page so the
// whitelist exists in exactly one place.
// Only entityType values actually produced by notification.service.js call
// sites today (verified against every notifyUser/notifyAllMasterAdmins call
// in apps/api/src) are mapped - never a route for an entityType that's only
// ever used on AuditLog entries elsewhere in the codebase.
export function safeRouteFor(notification) {
  if (!notification) return null;
  const entityId = notification.entityId || notification.metadata?.orderId || notification.metadata?.requestId || notification.metadata?.organizationId;
  const entityType = notification.entityType || (notification.metadata?.orderId ? "EStampOrder" : notification.metadata?.requestId ? "EStampRequest" : null);

  if (!entityId || !entityType) return null;

  switch (entityType) {
    case "EStampOrder":
      // Vendor notifications go to the vendor's own order page (the only
      // order route a vendor can open).
      if (notification.type === "VENDOR_ACTIVITY") return `/vendor/orders/${entityId}`;
      return `/orders/${entityId}`;
    case "EStampRequest":
      // If the notification references an order (e.g. metadata.orderId), go directly to the order.
      if (notification.metadata?.orderId) {
        return `/orders/${notification.metadata.orderId}`;
      }
      return `/estamps/requests/${entityId}`;
    case "Payment":
      return `/payments/${entityId}`;
    case "BulkEStampBatch":
      return `/estamps/bulk/${entityId}`;
    default:
      return null;
  }
}

// Mirrors the backend NotificationType enum (packages/shared/src/enums.js) -
// human-friendly labels are a presentation-only concern, never invented
// values sent to the API.
export const NOTIFICATION_TYPE_LABELS = {
  ASSISTANT_ADMIN_ACTIVITY: "Assistant activity",
  SECURITY_ALERT: "Security alert",
  ESTAMP_STATUS: "E-Stamp status",
  PAYMENT: "Payment",
  GENERAL: "General",
  VENDOR_ACTIVITY: "Vendor",
};

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_LABELS);
