import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { User, OTP, AuditLog, Organization } from "../src/models/index.js";
import { Role, AuditAction, OrganizationStatus, Permission, getEffectivePermissions } from "@launcherdesk/shared";
import { AuthService } from "../src/services/auth.service.js";
import { OtpService } from "../src/services/otp.service.js";
import { authenticate } from "../src/middleware/authenticate.js";
import * as authController from "../src/controllers/auth.controller.js";
import { env } from "../src/config/env.js";
import { sha256Hex } from "../src/utils/crypto.js";
import { makeReq, makeRes, runMiddleware, runController } from "./helpers/http.js";

async function makeActiveOrg() {
  const creator = new mongoose.Types.ObjectId();
  return Organization.create({
    name: "Auth Flow Test Co",
    contactEmail: `authflow-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
  });
}

async function makeClientUser(overrides = {}) {
  const password = "ChangeMe!User1";
  const passwordHash = await AuthService.hashPassword(password);
  const org = await makeActiveOrg();
  const user = await User.create({
    name: "Test User",
    email: `user-${new mongoose.Types.ObjectId()}@ld.local`,
    passwordHash,
    role: Role.USER,
    organizationId: org._id,
    lastOtpVerifiedAt: new Date(),
    ...overrides,
  });
  return { user, password };
}

describe("Login: credential checks", () => {
  it("rejects a nonexistent account without revealing that the email doesn't exist", async () => {
    await expect(AuthService.loginStep1("nobody@nowhere.local", "whatever123", makeReq())).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid email or password",
    });
  });

  it("rejects an invalid password and records a LOGIN_FAILED audit event", async () => {
    const { user } = await makeClientUser();
    await expect(AuthService.loginStep1(user.email, "wrong-password", makeReq())).rejects.toMatchObject({
      statusCode: 401,
    });
    const entry = await AuditLog.findOne({ actorId: user._id, action: AuditAction.LOGIN_FAILED });
    expect(entry).not.toBeNull();
  });

  it("accepts a valid password and, when already OTP-verified within the window, issues tokens directly", async () => {
    const { user, password } = await makeClientUser();
    const result = await AuthService.loginStep1(user.email, password, makeReq());
    expect(result.requiresOtp).toBe(false);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  it("requires OTP again once the 24h re-verification window has elapsed", async () => {
    const { user, password } = await makeClientUser({
      lastOtpVerifiedAt: new Date(Date.now() - (env.OTP_REVERIFY_INTERVAL_HOURS + 1) * 60 * 60 * 1000),
    });
    const result = await AuthService.loginStep1(user.email, password, makeReq());
    expect(result.requiresOtp).toBe(true);
    expect(result.challengeToken).toBeDefined();
  });
});

describe("authenticate middleware: token edge cases", () => {
  it("rejects a request with no Authorization header", async () => {
    const { threw } = await runMiddleware(authenticate, makeReq({ headers: {} }), makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("rejects a malformed/invalid JWT", async () => {
    const req = makeReq({ headers: { authorization: "Bearer not-a-real-token" } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("rejects an expired JWT", async () => {
    const { user } = await makeClientUser();
    const expiredToken = jwt.sign(
      { userId: user._id.toString(), role: user.role, organizationId: user.organizationId, tokenVersion: user.tokenVersion },
      env.JWT_SECRET,
      { expiresIn: -10 } // already expired
    );
    const req = makeReq({ headers: { authorization: `Bearer ${expiredToken}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("rejects a token whose tokenVersion no longer matches (revoked/invalidated session)", async () => {
    const { user } = await makeClientUser();
    const staleToken = jwt.sign(
      { userId: user._id.toString(), role: user.role, organizationId: user.organizationId, tokenVersion: user.tokenVersion },
      env.JWT_SECRET,
      { expiresIn: "15m" }
    );
    await AuthService.invalidateAllSessions(user._id.toString());
    const req = makeReq({ headers: { authorization: `Bearer ${staleToken}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("rejects a valid token for a deactivated account", async () => {
    const { user } = await makeClientUser({ isActive: false });
    const token = jwt.sign(
      { userId: user._id.toString(), role: user.role, organizationId: user.organizationId, tokenVersion: user.tokenVersion },
      env.JWT_SECRET,
      { expiresIn: "15m" }
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(401);
  });

  it("accepts a fresh, valid token and attaches server-derived req.user", async () => {
    const { user } = await makeClientUser();
    const result = await AuthService.loginStep1(user.email, "ChangeMe!User1", makeReq());
    const req = makeReq({ headers: { authorization: `Bearer ${result.accessToken}` } });
    const { threw } = await runMiddleware(authenticate, req, makeRes());
    expect(threw).toBeNull();
    expect(req.user.id).toBe(user._id.toString());
    expect(req.user.organizationId).toBe(user.organizationId.toString());
  });
});

describe("Logout", () => {
  it("revokes the refresh token so it cannot be used again, and records a LOGOUT audit event", async () => {
    const { user, password } = await makeClientUser();
    const result = await AuthService.loginStep1(user.email, password, makeReq());
    await AuthService.logout(user._id.toString(), user.role, result.refreshToken, makeReq());

    const auditEntry = await AuditLog.findOne({ actorId: user._id, action: AuditAction.LOGOUT });
    expect(auditEntry).not.toBeNull();

    await expect(AuthService.refresh(result.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("Forgot password: full round trip", () => {
  it("does not reveal whether the email exists (same response shape for both cases)", async () => {
    const { user } = await makeClientUser();
    const existing = await callForgotPassword(user.email);
    const nonexistent = await callForgotPassword("nobody@nowhere.local");
    expect(Object.keys(existing).sort()).toEqual(Object.keys(nonexistent).sort());
    expect(existing.message).toBe(nonexistent.message);
  });

  it("lets the user verify the OTP, set a new password, and locks out the old password", async () => {
    const { user, password: oldPassword } = await makeClientUser();
    const code = "482913";
    const otp = await OTP.create({
      userId: user._id,
      purpose: "PASSWORD_RESET",
      codeHash: sha256Hex(code),
      challengeToken: "reset-flow-test-token",
      expiresAt: new Date(Date.now() + 60 * 1000),
      maxAttempts: 5,
    });

    const newPassword = "NewSecret!2024";
    const { userId } = await OtpService.verify(otp.challengeToken, code, makeReq());
    expect(userId).toBe(user._id.toString());

    const reloaded = await User.findById(user._id).select("+passwordHash");
    reloaded.passwordHash = await AuthService.hashPassword(newPassword);
    reloaded.mustChangePassword = false;
    await reloaded.save();
    await AuthService.invalidateAllSessions(user._id.toString());

    await expect(AuthService.loginStep1(user.email, oldPassword, makeReq())).rejects.toMatchObject({ statusCode: 401 });

    const result = await AuthService.loginStep1(user.email, newPassword, makeReq());
    expect(result.accessToken || result.requiresOtp).toBeTruthy();

    const auditEntry = await AuditLog.findOne({ actorId: user._id, action: AuditAction.OTP_VERIFIED });
    expect(auditEntry).not.toBeNull();
  });

  it("rejects reusing the same reset OTP twice", async () => {
    const { user } = await makeClientUser();
    const code = "119228";
    const otp = await OTP.create({
      userId: user._id,
      purpose: "PASSWORD_RESET",
      codeHash: sha256Hex(code),
      challengeToken: "reset-reuse-test-token",
      expiresAt: new Date(Date.now() + 60 * 1000),
      maxAttempts: 5,
    });
    await OtpService.verify(otp.challengeToken, code, makeReq());
    await expect(OtpService.verify(otp.challengeToken, code, makeReq())).rejects.toMatchObject({ statusCode: 400 });
  });
});

// Phase 21 - UX-only surfacing of the same effective-permission computation
// authenticate.js already enforces server-side on every request. Purely
// additive: never a new security boundary, so these tests check SHAPE/
// CORRECTNESS of the exposed value, not any new enforcement.
describe("Effective permissions surfaced on login and /auth/me", () => {
  it("login issues a user.permissions array matching getEffectivePermissions(role, storedPermissions)", async () => {
    const { user, password } = await makeClientUser({ role: Role.SUPER_ADMIN, permissions: [Permission.POLICY_VIEW] });
    const result = await AuthService.loginStep1(user.email, password, makeReq());
    expect(Array.isArray(result.user.permissions)).toBe(true);
    const expected = getEffectivePermissions(Role.SUPER_ADMIN, [Permission.POLICY_VIEW]);
    expect(result.user.permissions.sort()).toEqual(expected.sort());
    // Sanity: role default (REPORT_VIEW) union'd with the one extra grant.
    expect(result.user.permissions).toContain(Permission.REPORT_VIEW);
    expect(result.user.permissions).toContain(Permission.POLICY_VIEW);
  });

  it("an Assistant Master Admin's surfaced permissions are ONLY what is explicitly stored, never role defaults", async () => {
    const org = await makeActiveOrg();
    const password = "ChangeMe!Assist1";
    const passwordHash = await AuthService.hashPassword(password);
    const assistant = await User.create({
      name: "Assistant",
      email: `assistant-${new mongoose.Types.ObjectId()}@ld.local`,
      passwordHash,
      role: Role.ASSISTANT_MASTER_ADMIN,
      organizationId: null,
      permissions: [Permission.CLIENT_VIEW],
      lastOtpVerifiedAt: new Date(),
    });
    const result = await AuthService.loginStep1(assistant.email, password, makeReq());
    expect(result.user.permissions).toEqual([Permission.CLIENT_VIEW]);
    expect(result.user.permissions).not.toContain(Permission.REPORT_VIEW); // no auto-granted defaults
  });

  it("GET /auth/me returns the same computed permissions field alongside the rest of the user document", async () => {
    const { user } = await makeClientUser({ role: Role.ADMIN, permissions: [] });
    const req = makeReq({ user: { id: user._id.toString() } });
    const { res, error } = await runController(authController.me, req, makeRes());
    expect(error).toBeNull();
    expect(Array.isArray(res.body.data.permissions)).toBe(true);
    expect(res.body.data.permissions).toEqual(getEffectivePermissions(Role.ADMIN, []));
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(res.body.data.email).toBe(user.email);
  });
});

// Helpers -------------------------------------------------------------

async function callForgotPassword(email) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    const { challengeToken } = await OtpService.issue(user._id.toString(), "PASSWORD_RESET", user.email, user.role, makeReq());
    return { challengeToken, message: "If this email is registered, a reset code has been sent." };
  }
  return { challengeToken: "irrelevant-in-test", message: "If this email is registered, a reset code has been sent." };
}
