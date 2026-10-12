const mongoose = require("mongoose");
const argon2 = require("argon2");

const ATLAS_URI = "mongodb+srv://moqsoodahmed_db_user:6x4fo2KfVIAyUucQ@cluster0.wwjbx7h.mongodb.net/launcherdesk_estamping?appName=Cluster0";

async function main() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(ATLAS_URI);
  const db = mongoose.connection.db;
  const users = db.collection("users");
  const orgs = db.collection("organizations");
  const wallets = db.collection("wallets");

  // Find or verify org
  let org = await orgs.findOne({ name: "LauncherDesk Client Company 1" });
  if (!org) {
    org = await orgs.findOne({ status: "ACTIVE" });
  }
  if (!org) {
    const orgRes = await orgs.insertOne({
      name: "LauncherDesk Client Company 1",
      contactEmail: "contact@launcherdesk.com",
      contactPhone: "9999999999",
      status: "ACTIVE",
      isEstampServiceEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    org = { _id: orgRes.insertedId, name: "LauncherDesk Client Company 1" };
  }

  // Ensure wallet has funds for testing wallet purchase and 20-minute deduction
  await wallets.updateOne(
    { organizationId: org._id },
    {
      $set: {
        balance: 10000,
        reservedBalance: 0,
        currency: "INR",
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
        version: 0,
      },
    },
    { upsert: true }
  );

  const defaultPassword = "Password@123";
  const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

  // 1. Master Admin (both moqsood@launcherdesk.com and master@launcherdesk.com)
  const masterEmails = ["moqsood@launcherdesk.com", "master@launcherdesk.com"];
  for (const email of masterEmails) {
    await users.updateOne(
      { email },
      {
        $set: {
          name: email === "moqsood@launcherdesk.com" ? "Moqsood (Master Admin)" : "Master Admin",
          email,
          passwordHash,
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
  }

  // 2. Super Admin (both jeevan@launcherdesk.com and superadmin@launcherdesk.com)
  const superAdminEmails = ["jeevan@launcherdesk.com", "superadmin@launcherdesk.com"];
  for (const email of superAdminEmails) {
    await users.updateOne(
      { email },
      {
        $set: {
          name: email === "jeevan@launcherdesk.com" ? "Jeevan (Super Admin)" : "Super Admin",
          email,
          passwordHash,
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
  }

  console.log("Successfully provisioned live Atlas credentials!");
  console.log("--------------------------------------------------");
  console.log("MASTER ADMIN CREDENTIALS:");
  console.log("  Email:    moqsood@launcherdesk.com (or master@launcherdesk.com)");
  console.log("  Password: " + defaultPassword);
  console.log("  Role:     MASTER_ADMIN");
  console.log("");
  console.log("SUPER ADMIN CREDENTIALS:");
  console.log("  Email:    jeevan@launcherdesk.com (or superadmin@launcherdesk.com)");
  console.log("  Password: " + defaultPassword);
  console.log("  Role:     SUPER_ADMIN (Org: " + org.name + ")");
  console.log("  Wallet:   INR 10,000 pre-loaded for testing");
  console.log("--------------------------------------------------");

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Error provisioning Atlas logins:", err);
  process.exit(1);
});
