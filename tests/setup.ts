import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongo: MongoMemoryServer | null = null;

export const connectTestDB = async () => {
  process.env.NODE_ENV = "test";
  process.env.ACCESS_TOKEN = process.env.ACCESS_TOKEN || "testaccesssecret";
  process.env.REFRESH_TOKEN = process.env.REFRESH_TOKEN || "testrefreshsecret";

  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  await mongoose.connect(uri);

  // Mongoose builds indexes in the background after a model is first
  // registered — without waiting for them, tests that exercise a unique
  // index (e.g. race-condition/duplicate guards) can flake because the
  // index isn't ready yet when the first writes land. Wait for every
  // currently-registered model's indexes to finish building.
  await Promise.all(
    Object.values(mongoose.connection.models).map((model) => model.init())
  );
};

export const clearTestDB = async () => {
  if (!mongoose.connection.readyState) return;
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};

export const closeTestDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
};
