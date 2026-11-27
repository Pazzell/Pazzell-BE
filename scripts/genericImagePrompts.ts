import "dotenv/config";
import mongoose from "mongoose";
import { makeImagePromptsGeneric } from "../services/trivia/imagePromptMigration";

// Makes every existing picture question generic: "Who is this?" or "What is this?".
//
//   npm run migrate:image-prompts            (dry run: lists what would change)
//   npm run migrate:image-prompts -- --apply (writes the changes)

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.DB_URI;
  if (!uri) throw new Error("DB_URI is not set");
  await mongoose.connect(uri);
  console.log(`Database "${mongoose.connection.name}" on ${mongoose.connection.host}`);
  const report = await makeImagePromptsGeneric(apply);
  for (const [collection, changes] of Object.entries(report)) {
    console.log(`\n${collection}: ${changes.length ? "" : "nothing to change"}`);
    for (const c of changes) console.log(`  ${c.count} x "${c.from}" -> "${c.to}"`);
  }
  console.log(apply ? "\nApplied." : "\nDry run. Run again with --apply to write the changes.");
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
