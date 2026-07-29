#!/bin/bash
# Run via `npm run start:local` (or directly). Deliberately NOT wired up as
# package.json's "dev" script: @vercel/static-build auto-detects a
# package.json script literally named "dev" and spawns it as a companion
# process whenever `vercel dev` runs - even with framework:null and no
# explicit `builds` in vercel.json - which recurses forever since this
# script itself runs `vercel dev`. Confirmed by testing: renaming the
# script away from "dev" is what actually stops the auto-detection: no
# other config change (vercel.json's framework/builds, project dashboard
# settings) affected it.

# vercel dev doesn't run vercel.json's buildCommand (that's deploy-only), so
# generate sw.js explicitly here - otherwise local dev would run against
# whatever cache version happened to be last committed, not the current
# app.html.
node "$(dirname "$0")/build-sw.mjs"
exec vercel dev --listen 3000
