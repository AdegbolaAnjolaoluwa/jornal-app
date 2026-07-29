#!/usr/bin/env node
// Generates sw.js from sw.template.js, substituting __CACHE_VERSION__ with a
// short hash of the actual shell assets it caches (app.html, manifest.json,
// icons). Run automatically as part of the Vercel build (see vercel.json's
// buildCommand) so the cache name - and therefore whether an installed PWA
// notices a new deploy - always tracks real content changes, with no manual
// version bump to forget.
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import path from "path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SHELL_FILES = [
  "app.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/icon-maskable-512.png",
];

const hash = createHash("sha256");
for (const file of SHELL_FILES) {
  hash.update(readFileSync(path.join(rootDir, file)));
}
const cacheVersion = hash.digest("hex").slice(0, 12);

const template = readFileSync(path.join(rootDir, "sw.template.js"), "utf8");
const occurrences = template.split("__CACHE_VERSION__").length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected exactly one __CACHE_VERSION__ placeholder in sw.template.js, found ${occurrences}. ` +
      "A stray extra occurrence (e.g. in a comment) would get silently substituted too."
  );
}
const output = template.replaceAll("__CACHE_VERSION__", cacheVersion);
writeFileSync(path.join(rootDir, "sw.js"), output);

console.log(`Generated sw.js with cache version ${cacheVersion}`);
