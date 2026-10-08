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
  if (!notification?.entityId) return null;
  switch (notification.entityType) {
    case "EStampOrder":
      return `/orders/${notification.entityId}`;
    case "Payment":
      return `/payments/${notification.entityId}`;
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
};

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_LABELS);
