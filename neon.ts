import { defineConfig } from "@neon/config/v1";

// Neon project policy (D-010, D-062). Postgres only: auth stays JWT, bcrypt and CASL per the
// architecture contract, and no other Neon service has a spec behind it.
export default defineConfig({
  auth: false,
  branch: (branch) => {
    if (branch.isDefault) {
      // production: no overrides, uses project defaults
      return {};
    }
    if (branch.name === "dev") {
      // The team's shared development branch (D-062) must never expire
      return {};
    }
    if (!branch.exists) {
      // Any other new branch is a personal scratch branch and auto-expires
      return { ttl: "7d" };
    }
    return {};
  },
});
