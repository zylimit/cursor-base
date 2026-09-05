// Entry point. Hooks invoke this file directly; scripts/harness.mjs imports `main`.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./cli.mjs";

export { main };

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invoked) {
  main().catch((error) => {
    process.stderr.write(`harness: ${error.message}\n`);
    process.exitCode = 1;
  });
}
