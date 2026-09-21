import os from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Every test file boots its own in-memory PGlite, and PGlite is a WebAssembly
 * PostgreSQL: instantiating it is the single most expensive thing the suite
 * does, and its cost is set by how many workers are instantiating one at the
 * same moment, not by how many test files there are. Measured on a 14-core
 * machine with 30 test files, worst first-query time per file:
 *
 *     default (unbounded)   11.1 s   13 files fail the 10 s hook timeout
 *     maxWorkers 10          4.2 s   pass, 10.8 s wall clock
 *     maxWorkers 8           2.9 s   pass,  9.9 s
 *     maxWorkers 6           2.1 s   pass,  8.6 s
 *     maxWorkers 4           1.0 s   pass,  8.8 s
 *
 * Oversubscription does not buy throughput here, it only starves the boots, so
 * the cap is both the fix and the faster option. Half the cores, at most six,
 * keeps roughly 5x headroom under the hook timeout.
 */
const maxWorkers = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2)));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    // Pins DATABASE_URL to an in-memory PGlite before any module can open the
    // developer's local database. See test/db.ts for the harness itself.
    setupFiles: ["./test/setup.ts"],
    maxWorkers,
    // A guard, not the fix: the cap above puts the worst measured boot at
    // ~2 s. A machine under other load can be slower than anything measured
    // here, and the failure mode — an unrelated test file timing out in
    // `beforeEach` — costs more to diagnose than the wait costs to allow.
    hookTimeout: 30_000,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.react-router/**",
    ],
  },
});
