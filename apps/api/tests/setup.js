import { beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod;

beforeAll(async () => {
  process.env.JWT_SECRET = "test_secret";
  process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Each test FILE gets a brand-new, empty MongoMemoryServer instance, but
  // Mongoose's per-model index-build promise (Model.init()) only resolves
  // once, the first time each model is ever touched in this process. Reusing
  // the same models (via the require cache) against a fresh, index-less
  // database would silently skip index creation - so unique constraints
  // (e.g. Organization.contactEmail, User.email) would not actually be
  // enforced in every test file but the first. Explicitly (re)sync indexes
  // against THIS file's database every time.
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.syncIndexes()));
}, 60000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});
