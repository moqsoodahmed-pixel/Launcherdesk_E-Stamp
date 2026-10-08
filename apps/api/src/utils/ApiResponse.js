"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.created = created;
function ok(res, data, message, status = 200) {
    return res.status(status).json({ success: true, data, message });
}
function created(res, data, message) {
    return ok(res, data, message, 201);
}
