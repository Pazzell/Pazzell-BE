import "dotenv/config";
import mongoose from "mongoose";

const OLD = "pazzell-backend-storage-644724502006-eu-north-1-an.amazonaws.com";
const NEW = "pazzell-backend-storage-644724502006-eu-north-1-an.s3.eu-north-1.amazonaws.com";

async function run() {
  const uri = process.env.DB_URI;
  if (!uri) throw new Error("DB_URI is not set in .env");

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected.\n");

  const db = mongoose.connection.db!;

  // --- puzzlecampaigns ---
  const campResult = await db.collection("puzzlecampaigns").updateMany(
    {
      $or: [
        { puzzleImageUrl: { $regex: OLD } },
        { originalImageUrl: { $regex: OLD } },
      ],
    },
    [
      {
        $set: {
          puzzleImageUrl: {
            $replaceOne: { input: "$puzzleImageUrl", find: OLD, replacement: NEW },
          },
          originalImageUrl: {
            $replaceOne: { input: "$originalImageUrl", find: OLD, replacement: NEW },
          },
        },
      },
    ]
  );
  console.log(`puzzlecampaigns — matched: ${campResult.matchedCount}, updated: ${campResult.modifiedCount}`);

  // --- users (avatars) ---
  const userResult = await db.collection("users").updateMany(
    { avatar: { $regex: OLD } },
    [
      {
        $set: {
          avatar: {
            $replaceOne: { input: "$avatar", find: OLD, replacement: NEW },
          },
        },
      },
    ]
  );
  console.log(`users          — matched: ${userResult.matchedCount}, updated: ${userResult.modifiedCount}`);

  await mongoose.disconnect();
  console.log("\nDone. Connection closed.");
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
