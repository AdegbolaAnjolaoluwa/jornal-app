#!/bin/bash
# vercel dev doesn't run vercel.json's buildCommand (that's deploy-only), so
# generate sw.js explicitly here - otherwise local dev would run against
# whatever cache version happened to be last committed, not the current
# app.html.
node "$(dirname "$0")/build-sw.mjs"
exec vercel dev --listen 3000
