"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderPortalPath = orderPortalPath;
exports.notifyOrderIssued = notifyOrderIssued;
exports.notifyCertificateAvailable = notifyCertificateAvailable;
exports.notifyOrderFailed = notifyOrderFailed;
exports.notifyOrderProcessing = notifyOrderProcessing;
exports.notifyOrderToFulfil = notifyOrderToFulfil;
exports.notifyOrderStaff = notifyOrderStaff;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const notification_service_1 = require("./notification.service");
// The client-facing order notifications, shared by the provider flow
// (estamp-request.service applyProviderResult), the certificate-attach
// upload (file.controller) and manual fulfilment (fulfilment.service).
// Every one is eventKey-gated per order and per recipient, so it reaches each
// person at most once no matter which path - or how many retries - triggered it.
//
// Emails only ever link INTO the portal (orderPortalPath). The certificate is
// never attached or linked directly: it is viewed and downloaded after
// signing in, where role and organization checks apply.
function orderPortalPath(order) {
    return `/orders/${order._id.toString()}`;
}
async function requesterOf(request) {
    return request ? models_1.User.findById(request.createdBy).select("role email") : null;
}
// Tells the client side about an order: the person who raised the request
// (under the original eventKey) AND the organization's Super Admin(s), who
// are accountable for the spend even when another member raised it. A Super
// Admin who IS the requester is skipped rather than told twice; every other
// Super Admin gets their own eventKey suffix, so a retry reaches nobody twice.
async function notifyClient(order, request, { title, message, eventKey, actorId, email }) {
    const base = {
        type: shared_1.NotificationType.ESTAMP_STATUS,
        title,
        message,
        organizationId: order.organizationId.toString(),
        relatedActorId: actorId,
        entityType: "EStampOrder",
        entityId: order._id,
    };
    const requesterId = request?.createdBy?.toString();
    const requester = await requesterOf(request);
    if (requester) {
        await (0, notification_service_1.notifyUser)({
            ...base,
            recipientId: requesterId,
            recipientRole: requester.role,
            eventKey,
            email: requester.email && email ? { ...email, to: requester.email } : undefined,
        });
    }
    const superAdmins = await models_1.User.find({ organizationId: order.organizationId, role: shared_1.Role.SUPER_ADMIN, isActive: true }).select("_id role email");
    for (const admin of superAdmins) {
        const id = admin._id.toString();
        if (id === requesterId)
            continue;
        await (0, notification_service_1.notifyUser)({
            ...base,
            recipientId: id,
            recipientRole: admin.role,
            eventKey: `${eventKey}:super-admin:${id}`,
            email: admin.email && email ? { ...email, to: admin.email } : undefined,
        });
    }
}
// SUCCESS - the e-stamp was issued.
async function notifyOrderIssued(order, request, actorId) {
    if (!request)
        return;
    await notifyClient(order, request, {
        title: "E-Stamp issued",
        message: `E-Stamp request ${request.requestNumber} has been issued successfully.`,
        eventKey: `estamp-order:${order._id.toString()}:issued`,
        actorId,
        email: { method: "sendOrderIssuedEmail", args: [order.orderNumber, orderPortalPath(order)] },
    });
}
async function notifyCertificateAvailable(order, actorId) {
    const request = await models_1.EStampRequest.findById(order.requestId);
    if (!request)
        return;
    await notifyClient(order, request, {
        title: "E-Stamp certificate available",
        message: `The E-Stamp certificate for order ${order.orderNumber} is ready. View and download it in the portal.`,
        eventKey: `estamp-order:${order._id.toString()}:certificate_available`,
        actorId,
        email: { method: "sendEStampReadyEmail", args: [order.orderNumber, orderPortalPath(order)] },
    });
}
// FAILURE - processing could not be completed.
async function notifyOrderFailed(order, request, actorId, messageOverride) {
    if (!request)
        return;
    await notifyClient(order, request, {
        title: "E-Stamp processing failed",
        message: messageOverride || `E-Stamp processing for request ${request.requestNumber} failed.`,
        eventKey: `estamp-order:${order._id.toString()}:failed`,
        actorId,
        email: { method: "sendOrderFailedEmail", args: [order.orderNumber, order.failureReason, orderPortalPath(order)] },
    });
}
// The order has left its modification window and is being worked on.
// Deliberately generic: the client never learns whether - or which - vendor
// is involved. Both paths that start processing (the assistant starting it,
// or dispatching it to a vendor) call this; the eventKey makes the second
// call a no-op.
async function notifyOrderProcessing(order, request, actorId) {
    if (!request)
        return;
    const title = "E-Stamp order in processing";
    const message = `E-Stamp request ${request.requestNumber} (order ${order.orderNumber}) is now being processed. You will be notified when it succeeds or if it fails.`;
    await notifyClient(order, request, {
        title,
        message,
        eventKey: `estamp-order:${order._id.toString()}:processing`,
        actorId,
        email: { method: "sendOrderStatusEmail", args: [{ orderNumber: order.orderNumber, title, message, status: "Processing", portalPath: orderPortalPath(order) }] },
    });
}
// Routes a staff-facing order event to whoever handles this client - the
// assigned Assistant Master Admin, or every Master Admin when none is
// assigned (or the assigned one is inactive), so it never reaches nobody.
async function notifyStaff(order, { title, message, eventKey, status }) {
    const params = {
        type: shared_1.NotificationType.ESTAMP_STATUS,
        title,
        message,
        organizationId: order.organizationId.toString(),
        entityType: "EStampOrder",
        entityId: order._id,
        eventKey,
        email: { method: "sendOrderStatusEmail", args: [{ orderNumber: order.orderNumber, title, message, status, portalPath: orderPortalPath(order) }] },
    };
    if (!(await (0, notification_service_1.notifyAssignedAssistant)(order.organizationId, params))) {
        await (0, notification_service_1.notifyAllMasterAdmins)(params);
    }
}
// Manual fulfilment: an order has cleared its window and is ready to work on.
async function notifyOrderToFulfil(order) {
    const org = await models_1.Organization.findById(order.organizationId).select("name");
    await notifyStaff(order, {
        title: "New order to fulfil",
        message: `New order to fulfil ${order.orderNumber}${org ? ` (${org.name})` : ""}.`,
        eventKey: `estamp-order:${order._id.toString()}:to-fulfil`,
        status: "Ready to fulfil",
    });
}
// Vendor workflow events (accepted, uploaded, handed back) for staff review.
async function notifyOrderStaff(order, { title, message, eventKey, status }) {
    await notifyStaff(order, { title, message, eventKey, status });
}
