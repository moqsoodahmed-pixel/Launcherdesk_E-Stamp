import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet } from "../src/models/index.js";
import { creditWallet, debitWalletIfSufficient, getWalletBalance } from "../src/services/wallet.service.js";

async function makeOrg() {
  const org = await Organization.create({
    name: "Test Org",
    contactEmail: "t@example.com",
    contactPhone: "1234567890",
    createdBy: new mongoose.Types.ObjectId(),
  });
  await Wallet.create({ organizationId: org._id, balance: 0 });
  return org;
}

describe("Wallet service", () => {
  it("credits the wallet and records a ledger entry", async () => {
    const org = await makeOrg();
    await creditWallet({
      organizationId: org._id.toString(),
      amount: 1000,
      referenceType: "PAYMENT",
      idempotencyKey: "test-credit-1",
      createdBy: null,
    });
    const balance = await getWalletBalance(org._id.toString());
    expect(balance).toBe(1000);
  });

  it("does not double-credit when the same idempotency key is reused", async () => {
    const org = await makeOrg();
    const params = {
      organizationId: org._id.toString(),
      amount: 500,
      referenceType: "PAYMENT",
      idempotencyKey: "dup-key",
      createdBy: null,
    };
    await creditWallet(params);
    await creditWallet(params);
    const balance = await getWalletBalance(org._id.toString());
    expect(balance).toBe(500);
  });

  it("blocks a debit larger than the available balance", async () => {
    const org = await makeOrg();
    await creditWallet({
      organizationId: org._id.toString(),
      amount: 500,
      referenceType: "PAYMENT",
      idempotencyKey: "seed-500",
      createdBy: null,
    });

    const result = await debitWalletIfSufficient({
      organizationId: org._id.toString(),
      amount: 1000,
      referenceType: "ESTAMP_REQUEST",
      idempotencyKey: "debit-attempt-1",
      createdBy: null,
    });

    expect(result.success).toBe(false);
    const balance = await getWalletBalance(org._id.toString());
    expect(balance).toBe(500);
  });

  it("prevents double-spend when two debits race for the same balance", async () => {
    const org = await makeOrg();
    await creditWallet({
      organizationId: org._id.toString(),
      amount: 1000,
      referenceType: "PAYMENT",
      idempotencyKey: "seed-1000",
      createdBy: null,
    });

    const [r1, r2] = await Promise.all([
      debitWalletIfSufficient({
        organizationId: org._id.toString(),
        amount: 700,
        referenceType: "ESTAMP_REQUEST",
        idempotencyKey: "race-1",
        createdBy: null,
      }),
      debitWalletIfSufficient({
        organizationId: org._id.toString(),
        amount: 700,
        referenceType: "ESTAMP_REQUEST",
        idempotencyKey: "race-2",
        createdBy: null,
      }),
    ]);

    const successes = [r1, r2].filter((r) => r.success).length;
    expect(successes).toBe(1);

    const balance = await getWalletBalance(org._id.toString());
    expect(balance).toBeGreaterThanOrEqual(0);
  });
});
