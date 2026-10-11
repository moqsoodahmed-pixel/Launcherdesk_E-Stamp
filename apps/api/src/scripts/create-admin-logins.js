const mongoose = require("mongoose");
const argon2 = require("argon2");

async function main() {
  await mongoose.connect("mongodb://127.0.0.1:27017/launcherdesk_estamping");
  const db = mongoose.connection.db;
  const users = db.collection("users");
  const orgs = db.collection("organizations");

  let org = await orgs.findOne({ name: "Demo Client Pvt Ltd" });
  if (!org) {
    const orgRes = await orgs.insertOne({
      name: "Demo Client Pvt Ltd",
      contactEmail: "contact@democlient.local",
      contactPhone: "9999999999",
      status: "ACTIVE",
      isEstampServiceEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    org = { _id: orgRes.insertedId };
    await db.collection("wallets").insertOne({
      organizationId: org._id,
      balance: 5000,
      reservedBalance: 0,
      currency: "INR",
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Passwords:
  const masterPassword = "Password@123";
  const superAdminPassword = "Or10n#Vault92";

  const masterHash = await argon2.hash(masterPassword, { type: argon2.argon2id });
  const superHash = await argon2.hash(superAdminPassword, { type: argon2.argon2id });

  // 1. Master Admin
  await users.updateOne(
    { email: "master@launcherdesk.com" },
    {
      $set: {
        name: "Master Admin",
        email: "master@launcherdesk.com",
        passwordHash: masterHash,
        role: "MASTER_ADMIN",
        organizationId: null,
        isActive: true,
        mustChangePassword: false,
        lastOtpVerifiedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await users.updateOne(
    { email: "master@launcherdesk.local" },
    {
      $set: {
        passwordHash: masterHash,
        mustChangePassword: false,
        lastOtpVerifiedAt: new Date(),
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
    }
  );

  // 2. Super Admin
  await users.updateOne(
    { email: "superadmin@launcherdesk.com" },
    {
      $set: {
        name: "Super Admin",
        email: "superadmin@launcherdesk.com",
        passwordHash: superHash,
        role: "SUPER_ADMIN",
        organizationId: org._id,
        isActive: true,
        mustChangePassword: false,
        lastOtpVerifiedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await users.updateOne(
    { email: "superadmin@democlient.local" },
    {
      $set: {
        passwordHash: superHash,
        mustChangePassword: false,
        lastOtpVerifiedAt: new Date(),
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
    }
  );

  console.log("Successfully created/updated Master Admin and Super Admin logins!");
  console.log("Master Admin: master@launcherdesk.com / " + masterPassword);
  console.log("Super Admin:  superadmin@launcherdesk.com / " + superAdminPassword);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
