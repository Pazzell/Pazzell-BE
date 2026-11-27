// Preloaded by "npm run dev" only. Loads .env.local (local overrides, git-ignored)
// before the app loads .env; dotenv never overwrites a variable that is already set,
// so values in .env.local win on this machine and everything else comes from .env.
require("dotenv").config({ path: ".env.local" });
