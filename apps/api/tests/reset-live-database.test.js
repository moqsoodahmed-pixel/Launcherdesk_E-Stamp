import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  User,
  Wallet,
  Payment,
  EStampRequest,
  Article,
  State,
  EstampPackage,
  Counter,
} from "../src/models/index.js";
import { performReset } from "../src/scripts/reset-live-database.js";

async function makeOrg() {
  return Organization.create({
    name: "Reset Test Co",
    contactEmail: `reset-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: "ACTIVE",
  });
}

describe("reset-live-database performReset", () => {
  it("deletes transactional data but preserves Master Admin / Assistant Master Admin users and reference/config collections", async () => {
    const org = await makeOrg();
    await Wallet.create({ organizationId: org._id, balance: 1000 });
    await Payment.create({
      organizationId: org._id,
      amount: 500,
      status: "SUCCESS",
      razorpayOrderId: `order_${new mongoose.Types.ObjectId()}`,
      createdBy: new mongoose.Types.ObjectId(),
    });
    await EStampRequest.create({
      organizationId: org._id,
      createdBy: new mongoose.Types.ObjectId(),
      stateId: new mongoose.Types.ObjectId(),
      articleId: new mongoose.Types.ObjectId(),
      status: "DRAFT",
    }).catch(() => {});

    const masterAdmin = await User.create({
      name: "Master Admin",
      email: `master-${new mongoose.Types.ObjectId()}@example.com`,
      phone: "9000000001",
      role: "MASTER_ADMIN",
      passwordHash: "x",
    });
    const assistantAdmin = await User.create({
      name: "Assistant Master Admin",
      email: `assistant-${new mongoose.Types.ObjectId()}@example.com`,
      phone: "9000000002",
      role: "ASSISTANT_MASTER_ADMIN",
      passwordHash: "x",
    });
    const regularUser = await User.create({
      name: "Regular User",
      email: `user-${new mongoose.Types.ObjectId()}@example.com`,
      phone: "9000000003",
      role: "USER",
      organizationId: org._id,
      passwordHash: "x",
    });

    const article = await Article.create({ name: "Test Article", code: "TST-1" }).catch(() => null);
    const state = await State.create({ name: "Test State" }).catch(() => null);
    const pkg = await EstampPackage.create({
      key: "test-pkg",
      name: "Test Package",
      stampsCount: 10,
      price: 100,
    }).catch(() => null);

    await Counter.findByIdAndUpdate("LDE-REQ", { $inc: { seq: 1 } }, { upsert: true });

    const db = mongoose.connection.db;
    const { summary, preservedUsers } = await performReset(db);

    expect(await Organization.countDocuments({})).toBe(0);
    expect(await Wallet.countDocuments({})).toBe(0);
    expect(await Payment.countDocuments({})).toBe(0);
    expect(summary.payments).toBe(1);

    const remainingUsers = await User.find({}).lean();
    expect(remainingUsers.map((u) => u._id.toString()).sort()).toEqual(
      [masterAdmin._id.toString(), assistantAdmin._id.toString()].sort()
    );
    expect(remainingUsers.some((u) => u._id.toString() === regularUser._id.toString())).toBe(false);

    expect(preservedUsers.map((u) => u.role).sort()).toEqual(["ASSISTANT_MASTER_ADMIN", "MASTER_ADMIN"]);

    expect(await Counter.countDocuments({})).toBe(0);

    if (article) expect(await Article.countDocuments({})).toBe(1);
    if (state) expect(await State.countDocuments({})).toBe(1);
    if (pkg) expect(await EstampPackage.countDocuments({})).toBe(1);
  });
});
