"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
exports.notifyUser = notifyUser;
exports.notifyAllMasterAdmins = notifyAllMasterAdmins;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const logger_1 = require("../utils/logger");
// Low-level create. Idempotent when params.eventKey is supplied: a business
// event that gets retried (payment webhook, provider status sync, etc.)
// must not fan out a second in-app notification to the same recipient for
// the same event - enforced by Notification's unique-sparse index on
// eventKey, not by an in-memory check (safe under real concurrency/retries).
async function notify(params) {
    if (!params.eventKey) {
        return models_1.Notification.create(params);
    }
    try {
        return await models_1.Notification.create(params);
    }
    catch (err) {
        if (err?.code === 11000) {
            // Someone already created this exact (eventKey) notification -
            // return it rather than erroring or duplicating.
            return models_1.Notification.findOne({ eventKey: params.eventKey });
        }
        throw err;
    }
}
// The single entry point business services should call: creates the in-app
// notification and, if `email` is supplied, best-effort dispatches the
// corresponding email through EmailService - never scattering direct
// Notification.create calls or ad-hoc email sends through controllers.
// Notification/email failures here are never allowed to propagate and
// break the caller's business operation (see email.service.js's own
// swallow-all-errors dispatch()).
async function notifyUser(params) {
    const { email, ...notificationParams } = params;
    let notification;
    try {
        notification = await notify({ ...notificationParams, channel: email ? "BOTH" : "IN_APP" });
    }
    catch (err) {
        logger_1.logger.error("Failed to create in-app notification", { type: params.type, error: err?.message });
        notification = null;
    }
    if (email?.to) {
        // Lazy require to avoid a require cycle (email.service doesn't import
        // notification.service, but keeping this local makes the dependency
        // direction explicit: notification -> email, never the reverse).
        const { EmailService } = require("./email.service");
        const method = email.method;
        if (typeof EmailService[method] === "function") {
            const extraArgs = email.attachments ? [params.eventKey, email.attachments] : [params.eventKey];
            await EmailService[method](email.to, ...(email.args || []), ...extraArgs).catch(() => { });
        }
    }
    return notification;
}
// Fans an activity notification out to every active Master Admin.
// This is how Assistant Master Admin actions become visible, per the
// "no silent administrative powers" requirement. When params.eventKey is
// supplied, each Master Admin's own copy gets its own per-recipient key
// (see notify()'s idempotency above) so a retried caller can't double-notify
// any single Master Admin, while still reaching every one of them once.
async function notifyAllMasterAdmins(params) {
    const masterAdmins = await models_1.User.find({ role: shared_1.Role.MASTER_ADMIN, isActive: true }).select("_id role email");
    await Promise.all(masterAdmins.map((admin) => fanOutTo(admin, params)));
}
// Fans a notification out to all active Admins/Super Admins in a specific organization.
async function notifyOrgAdmins(organizationId, params) {
    const orgAdmins = await models_1.User.find({
        organizationId,
        role: { $in: [shared_1.Role.SUPER_ADMIN, shared_1.Role.ADMIN] },
        isActive: true,
    }).select("_id role email");
    await Promise.all(orgAdmins.map((admin) => fanOutTo(admin, params)));
}
exports.notifyOrgAdmins = notifyOrgAdmins;
// Notifies the one Assistant Master Admin who handles this client. Returns
// false when the organization has no assistant assigned, so callers can fall
// back to the Master Admins rather than silently telling nobody.
async function notifyAssignedAssistant(organizationId, params) {
    const org = await models_1.Organization.findById(organizationId).select("assignedAssistantId");
    if (!org?.assignedAssistantId)
        return false;
    const assistant = await models_1.User.findOne({ _id: org.assignedAssistantId, isActive: true }).select("_id role email");
    if (!assistant)
        return false;
    await fanOutTo(assistant, params);
    return true;
}
exports.notifyAssignedAssistant = notifyAssignedAssistant;
// Shared tail of every fan-out: routes one recipient through notifyUser so
// a caller that supplies an `email` descriptor reaches each person on BOTH
// channels. Callers that omit `email` behave exactly as before (in-app
// only). The per-recipient eventKey suffix keeps a retried caller from
// double-notifying any single person while still reaching everyone once.
function fanOutTo(recipient, params) {
    const { email, ...rest } = params;
    return notifyUser({
        recipientId: recipient._id.toString(),
        recipientRole: recipient.role,
        ...rest,
        eventKey: params.eventKey ? `${params.eventKey}:${recipient._id.toString()}` : undefined,
        email: email && recipient.email ? { ...email, to: recipient.email } : undefined,
    });
}
