"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAllRead = exports.markRead = exports.getUnreadCount = exports.listMyNotifications = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const shared_1 = require("@launcherdesk/shared");
// Every query/mutation below is scoped to `recipientId: req.user.id` -
// derived strictly from the authenticated session, never from a client-
// supplied id. A user can only ever see or modify their OWN notifications.
exports.listMyNotifications = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { page = "1", limit = "20", unreadOnly, type, dateFrom, dateTo } = req.query;
    const filter = { recipientId: req.user.id };
    if (unreadOnly === "true")
        filter.isRead = false;
    if (type) {
        if (!Object.values(shared_1.NotificationType).includes(type))
            throw ApiError_1.ApiError.badRequest("Invalid notification type filter", "INVALID_TYPE");
        filter.type = type;
    }
    if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
            throw ApiError_1.ApiError.badRequest("Invalid date range", "INVALID_DATE_RANGE");
        }
        if (from && to && from.getTime() > to.getTime()) {
            throw ApiError_1.ApiError.badRequest("`dateFrom` must not be after `dateTo`", "INVALID_DATE_RANGE");
        }
        filter.createdAt = {};
        if (from)
            filter.createdAt.$gte = from;
        if (to)
            filter.createdAt.$lte = to;
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const [items, total, unreadCount] = await Promise.all([
        models_1.Notification.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        models_1.Notification.countDocuments(filter),
        models_1.Notification.countDocuments({ recipientId: req.user.id, isRead: false }),
    ]);
    return (0, ApiResponse_1.ok)(res, { items, total, page: pageNum, limit: limitNum, unreadCount });
});
// A dedicated, cheap endpoint for a header/bell badge that polls
// periodically - no need to fetch/paginate the full list just for a count.
exports.getUnreadCount = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const unreadCount = await models_1.Notification.countDocuments({ recipientId: req.user.id, isRead: false });
    return (0, ApiResponse_1.ok)(res, { unreadCount });
});
exports.markRead = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const notification = await models_1.Notification.findOneAndUpdate({ _id: req.params.id, recipientId: req.user.id }, { isRead: true, readAt: new Date() }, { new: true });
    // Identical response whether the id doesn't exist at all or belongs to
    // someone else - never confirms another user's notification exists.
    if (!notification)
        throw ApiError_1.ApiError.notFound("Notification not found");
    return (0, ApiResponse_1.ok)(res, notification);
});
exports.markAllRead = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // Scoped strictly to the authenticated user's own unread notifications -
    // never an unscoped updateMany({}).
    const result = await models_1.Notification.updateMany({ recipientId: req.user.id, isRead: false }, { isRead: true, readAt: new Date() });
    return (0, ApiResponse_1.ok)(res, { updated: result.modifiedCount });
});
