// POST /auth/change-password, exercised over real HTTP so the authenticate
// middleware, the per-user rate limiter, Zod validation and the controller
// run exactly as wired in auth.routes.js.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { User, Organization, RefreshToken, AuditLog } from "../src/models/index.js";
import { Role, OrganizationStatus, AuditAction } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { createApp } from "../src/app.js";

const PASSWORD = "ChangeMe!User1";
let server;
let base;

beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());

async function makeUser(overrides = {}) {
  const org = await Organization.create({
    name: "Change Pw Co",
    contactEmail: `cp-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
  });
  const user = await User.create({
    name: "Temp User",
    email: `cp-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash: await AuthService.hashPassword(PASSWORD),
    role: Role.USER,
    organizationId: org._id,
    lastOtpVerifiedAt: new Date(),
    mustChangePassword: true,
    ...overrides,
  });
  const session = await AuthService.issueTokens(user);
  return { user, session };
}

function changePassword(accessToken, body) {
  return fetch(`${base}/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

describe("POST /auth/change-password", () => {
  it("changes the password, clears mustChangePassword, ends other sessions and returns a fresh session", async () => {
    const { user, session } = await makeUser();
    const other = await AuthService.issueTokens(await User.findById(user._id)); // a second device
    const res = await changePassword(session.accessToken, { currentPassword: PASSWORD, newPassword: "BrandNew!Pass9" });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.mustChangePassword).toBe(false);

    const updated = await User.findById(user._id).select("+passwordHash");
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.tokenVersion).toBe(user.tokenVersion + 1);
    expect(await AuthService.verifyPassword(updated.passwordHash, "BrandNew!Pass9")).toBe(true);
    // The other device's refresh token is revoked; the old access token no longer works.
    await expect(AuthService.refresh(other.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    expect(me.status).toBe(401);
    // The fresh token pair works.
    const meFresh = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${res.body.data.accessToken}` } });
    expect(meFresh.status).toBe(200);
    expect(await AuditLog.countDocuments({ actorId: user._id, action: AuditAction.PASSWORD_CHANGED })).toBe(1);
    expect(await RefreshToken.countDocuments({ userId: user._id, revokedAt: null })).toBe(1);
  });

  it("rejects a wrong current password with 400 (not 401) and changes nothing", async () => {
    const { user, session } = await makeUser();
    const res = await changePassword(session.accessToken, { currentPassword: "wrong-password", newPassword: "BrandNew!Pass9" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Current password is incorrect");
    const same = await User.findById(user._id);
    expect(same.mustChangePassword).toBe(true);
    expect(same.tokenVersion).toBe(user.tokenVersion);
  });

  it("rejects a weak new password, and reusing the current one", async () => {
    const { session } = await makeUser();
    const weak = await changePassword(session.accessToken, { currentPassword: PASSWORD, newPassword: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe("VALIDATION_ERROR");
    const same = await changePassword(session.accessToken, { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await fetch(`${base}/auth/change-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("rate-limits attempts per user (5 per 15 minutes)", async () => {
    const { session } = await makeUser();
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await changePassword(session.accessToken, { currentPassword: "wrong-password", newPassword: "BrandNew!Pass9" })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
    // A different user is not affected by the first user's bucket.
    const { session: otherSession } = await makeUser();
    const other = await changePassword(otherSession.accessToken, { currentPassword: "wrong-password", newPassword: "BrandNew!Pass9" });
    expect(other.status).toBe(400);
  });
});
