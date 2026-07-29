#!/usr/bin/env node
import { main } from "../.cursor/runtime/harness.mjs";

main().catch((error) => {
  process.stderr.write(`harness: ${error.message}\n`);
  process.exitCode = 1;
});
