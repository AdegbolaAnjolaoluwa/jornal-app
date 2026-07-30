#!/bin/bash
# Run via `npm run start:local` (or directly). Deliberately NOT wired up as
# package.json's "dev" script.
#
# Root cause (confirmed by reading vercel's own source, not just inferred
# from behavior): commands/dev/index.js's DevServer.start() runs
#   if (!vercelConfig.experimentalServices && !hasResolvedServices &&
#       (!vercelConfig.builds || vercelConfig.builds.length === 0)) { ... detectBuilders(...) }
# Since this project's vercel.json has no `builds` array (uses `rewrites`
# instead - the modern, recommended config), that condition is always true,
# so detectBuilders() always runs and always matches package.json against
# @vercel/static-build as the fallback builder (there's no framework to
# detect otherwise). @vercel/static-build's own build() function then does:
#   if (meta.isDev && pkg.scripts[devScript]) { spawn(pkg.scripts[devScript] as a companion process) }
# `vercel dev` sets meta.isDev, so any package.json script literally named
# "dev" gets spawned as a companion dev server - regardless of the Vercel
# project dashboard's Framework/Dev Command settings (a separate, earlier
# code path, confirmed independently null via the Projects API and not the
# cause). If that spawned script itself runs `vercel dev`, this recurses
# forever ("must not recursively invoke itself").
#
# The only way to skip detectBuilders() entirely is an explicit `builds`
# array in vercel.json, which is the older, more manual config style and
# would need `rewrites`/`headers` reworked alongside it (getTransformedRoutes
# handles the conversion automatically, but that's still a real-deploy
# config change worth testing carefully, not a local-only tweak) - not worth
# the risk for what's otherwise a cosmetic naming choice. Renaming the
# script is the correct, low-risk fix: it doesn't stop package.json from
# matching @vercel/static-build, it just leaves that builder with no "dev"
# script to spawn, so the companion-process step (and the recursion) never
# happens.

# vercel dev doesn't run vercel.json's buildCommand (that's deploy-only), so
# generate sw.js explicitly here - otherwise local dev would run against
# whatever cache version happened to be last committed, not the current
# app.html.
node "$(dirname "$0")/build-sw.mjs"
exec vercel dev --listen 3000
