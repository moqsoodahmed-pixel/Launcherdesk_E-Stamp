import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { OTP } from "../src/models/index.js";
import { OtpService } from "../src/services/otp.service.js";
import { sha256Hex } from "../src/utils/crypto.js";

describe("OTP service", () => {
  it("rejects an already-consumed OTP (cannot be reused)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const codeHash = sha256Hex("123456");
    const otp = await OTP.create({
      userId,
      purpose: "LOGIN",
      codeHash,
      challengeToken: "tok-reuse-test",
      expiresAt: new Date(Date.now() + 60 * 1000),
      maxAttempts: 5,
      consumedAt: new Date(),
    });

    await expect(OtpService.verify(otp.challengeToken, "123456")).rejects.toThrow();
  });

  it("rejects an expired OTP", async () => {
    const userId = new mongoose.Types.ObjectId();
    const codeHash = sha256Hex("654321");
    const otp = await OTP.create({
      userId,
      purpose: "LOGIN",
      codeHash,
      challengeToken: "tok-expired-test",
      expiresAt: new Date(Date.now() - 1000),
      maxAttempts: 5,
    });

    await expect(OtpService.verify(otp.challengeToken, "654321")).rejects.toThrow();
  });

  it("accepts a correct, unexpired, unused OTP exactly once", async () => {
    const userId = new mongoose.Types.ObjectId();
    const codeHash = sha256Hex("111222");
    const otp = await OTP.create({
      userId,
      purpose: "LOGIN",
      codeHash,
      challengeToken: "tok-valid-test",
      expiresAt: new Date(Date.now() + 60 * 1000),
      maxAttempts: 5,
    });

    const result = await OtpService.verify(otp.challengeToken, "111222");
    expect(result.userId).toBe(userId.toString());

    await expect(OtpService.verify(otp.challengeToken, "111222")).rejects.toThrow();
  });
});
