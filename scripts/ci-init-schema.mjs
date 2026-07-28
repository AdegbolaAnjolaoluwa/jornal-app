#!/usr/bin/env node
// Applies the app's schema to whatever DATABASE_URL points at. Used in CI
// against a fresh, disposable Neon branch before integration tests run -
// initializeSchema() is idempotent (CREATE TABLE IF NOT EXISTS throughout),
// so this is safe to also run against an already-initialized database.
import { initializeSchema } from "../lib/db.js";

await initializeSchema();
console.log("Schema initialized.");
