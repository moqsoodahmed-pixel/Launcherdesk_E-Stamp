"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyOrderIssued = notifyOrderIssued;
exports.notifyCertificateAvailable = notifyCertificateAvailable;
exports.notifyOrderFailed = notifyOrderFailed;
exports.notifyOrderToFulfil = notifyOrderToFulfil;
const models_1 = require("../models");
const shared_1 = require("@launcherdesk/shared");
const notification_service_1 = require("./notification.service");
// The client-facing order notifications, shared by the provider flow
// (estamp-request.service applyProviderResult), the certificate-attach
// upload (file.controller) and manual fulfilment (fulfilment.service).
// Every one is eventKey-gated per order, so it reaches the requester at
// most once no matter which path - or how many retries - triggered it.
async function requesterOf(request) {
    return request ? models_1.User.findById(request.createdBy).select("role email") : null;
}
async function notifyOrderIssued(order, request, actorId) {
    const requester = await requesterOf(request);
    if (!requester)
        return;
    await (0, notification_service_1.notifyUser)({
        recipientId: request.createdBy.toString(),
        recipientRole: requester.role,
        type: shared_1.NotificationType.ESTAMP_STATUS,
        title: "E-Stamp issued",
        message: `Your E-Stamp request ${request.requestNumber} has been issued.`,
        organizationId: order.organizationId.toString(),
        relatedActorId: actorId,
        entityType: "EStampOrder",
        entityId: order._id,
        eventKey: `estamp-order:${order._id.toString()}:issued`,
        email: requester.email ? { to: requester.email, method: "sendOrderIssuedEmail", args: [order.orderNumber] } : undefined,
    });
}
async function notifyCertificateAvailable(order, actorId) {
    const request = await models_1.EStampRequest.findById(order.requestId);
    const requester = await requesterOf(request);
    if (!request || !requester)
        return;
    await (0, notification_service_1.notifyUser)({
        recipientId: request.createdBy.toString(),
        recipientRole: requester.role,
        type: shared_1.NotificationType.ESTAMP_STATUS,
        title: "E-Stamp certificate available",
        message: `Your E-Stamp certificate for order ${order.orderNumber} is ready to download.`,
        organizationId: order.organizationId.toString(),
        relatedActorId: actorId,
        entityType: "EStampOrder",
        entityId: order._id,
        eventKey: `estamp-order:${order._id.toString()}:certificate_available`,
        email: requester.email ? { to: requester.email, method: "sendEStampReadyEmail", args: [order.orderNumber] } : undefined,
    });
}
async function notifyOrderFailed(order, request, actorId, messageOverride) {
    const requester = await requesterOf(request);
    if (!requester)
        return;
    await (0, notification_service_1.notifyUser)({
        recipientId: request.createdBy.toString(),
        recipientRole: requester.role,
        type: shared_1.NotificationType.ESTAMP_STATUS,
        title: "E-Stamp processing failed",
        message: messageOverride || `E-Stamp processing for your request ${request.requestNumber} failed.`,
        organizationId: order.organizationId.toString(),
        relatedActorId: actorId,
        entityType: "EStampOrder",
        entityId: order._id,
        eventKey: `estamp-order:${order._id.toString()}:failed`,
        email: requester.email ? { to: requester.email, method: "sendOrderFailedEmail", args: [order.orderNumber, order.failureReason] } : undefined,
    });
}
// Manual fulfilment: tell whoever stamps this client's orders that one is
// ready - the assigned assistant, or every Master Admin if none. Once per order.
async function notifyOrderToFulfil(order) {
    const org = await models_1.Organization.findById(order.organizationId).select("name assignedAssistantId");
    const base = {
        type: shared_1.NotificationType.ESTAMP_STATUS,
        title: "New order to fulfil",
        message: `New order to fulfil ${order.orderNumber}${org ? ` (${org.name})` : ""}.`,
        organizationId: order.organizationId.toString(),
        entityType: "EStampOrder",
        entityId: order._id,
        eventKey: `estamp-order:${order._id.toString()}:to-fulfil`,
    };
    if (org?.assignedAssistantId) {
        await (0, notification_service_1.notifyUser)({ ...base, recipientId: org.assignedAssistantId.toString(), recipientRole: shared_1.Role.ASSISTANT_MASTER_ADMIN });
    }
    else {
        await (0, notification_service_1.notifyAllMasterAdmins)(base);
    }
}
