/**
 * Vitest setup file. Runs before every test file, ahead of any module that
 * could open a database, and pins the whole suite to an in-memory PGlite
 * instance so a test can never reach the developer's local `data/pglite`.
 */

/** PGlite's in-memory data directory. One instance per test process. */
export const IN_MEMORY_DATABASE_URL = "pglite://memory";

const appPrefix = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
if (appPrefix) delete process.env[`${appPrefix}_DATABASE_URL`];
delete process.env.DATABASE_URL_UNPOOLED;
delete process.env.NETLIFY_DATABASE_URL;

process.env.DATABASE_URL = IN_MEMORY_DATABASE_URL;
