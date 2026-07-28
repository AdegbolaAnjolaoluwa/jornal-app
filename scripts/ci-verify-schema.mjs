#!/usr/bin/env node
// Sanity check for the integration-test CI job: confirms the schema was
// actually applied to the ephemeral branch before declaring the DB "ready".
import { sql } from "@vercel/postgres";

const { rows } = await sql`
  SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
`;

console.log("Tables present:", rows[0].n);
if (rows[0].n === 0) {
  console.error("Schema init produced zero tables - failing.");
  process.exit(1);
}
