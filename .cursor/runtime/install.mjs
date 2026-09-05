// Distribution: install/upgrade/uninstall with sidecar conflicts, the source manifest, runtime
// parity, structural validation, and doctor.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { POLICY_REL, effectiveSelection, isProtectedCheck, loadPolicy, openDebts, readLoan, resolveAssurance } from "./assurance.mjs";
import { RISK_LEVELS, matrix, validateCatalog } from "./catalog.mjs";
import { EVENTS, HARNESS_ROOT, INSTALL_MANIFEST_REL, SECURITY_EVENTS, SOURCE_MANIFEST_REL, VERSION, boolOption, copyNormalized, errorMessage, fileHash, git, gitAvailable, isHarnessSourceRoot, isWithin, normalizeLf, posix, printJson, readJson, run, sha256, snapshotFiles, targetFrom, walkFiles, writeJson, } from "./core.mjs";
import { feedbackLessons } from "./memory.mjs";
import { verifyLedgerChain } from "./quality.mjs";
import { SERVICES_CONFIG_REL, listServiceStateDirs, readServiceState, servicesConfig, synthesizeServiceStatus, } from "./services.mjs";
export function sourceManifest() {
    const files = snapshotFiles(HARNESS_ROOT, true);
    return {
        version: 1,
        harness_version: VERSION,
        hash: "sha256-lf-v1",
        files,
        digest: manifestDigest(files),
    };
}
export function manifestDigest(files) {
    return sha256(files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""));
}
export function assertSafeTarget(target) {
    const parsedRoot = resolve(target, sep);
    if (resolve(target) === parsedRoot) {
        throw new Error("Refusing to manage a filesystem root.");
    }
    if (resolve(target) === resolve(homedir())) {
        throw new Error("Refusing to manage the user home directory; choose a repository target.");
    }
}
export function safeManagedPath(target, managedPath) {
    if (typeof managedPath !== "string" ||
        !managedPath ||
        isAbsolute(managedPath) ||
        /^[a-zA-Z]:[\\/]/.test(managedPath) ||
        /^[/\\]{2}/.test(managedPath)) {
        throw new Error(`Unsafe managed path: ${String(managedPath)}.`);
    }
    const segments = managedPath.split(/[\\/]/);
    if (segments.some((segment) => segment === ".." || segment === "")) {
        throw new Error(`Unsafe managed path: ${managedPath}.`);
    }
    const root = resolve(target);
    const destination = resolve(root, ...segments);
    if (!isWithin(root, destination) || destination === root) {
        throw new Error(`Managed path escapes target: ${managedPath}.`);
    }
    const physicalRoot = existsSync(root) ? realpathSync(root) : root;
    let current = root;
    for (const segment of segments) {
        current = resolve(current, segment);
        let metadata;
        try {
            metadata = lstatSync(current);
        }
        catch (error) {
            if (error.code === "ENOENT")
                break;
            throw error;
        }
        let physical;
        try {
            physical = realpathSync(current);
        }
        catch (error) {
            if (metadata.isSymbolicLink()) {
                throw new Error(`Managed path contains an unsafe dangling symlink: ${managedPath}.`);
            }
            throw error;
        }
        if (!isWithin(physicalRoot, physical)) {
            throw new Error(`Managed path resolves outside target: ${managedPath}.`);
        }
    }
    return destination;
}
export function validateInstallManifest(target, value) {
    if (value?.version !== 1 ||
        typeof value.harness_version !== "string" ||
        value.hash !== "sha256-lf-v1" ||
        !Array.isArray(value.files) ||
        typeof value.digest !== "string") {
        throw new Error("Install manifest has invalid required fields.");
    }
    const seen = new Set();
    for (const entry of value.files) {
        if (!entry ||
            typeof entry.path !== "string" ||
            !/^[a-f0-9]{64}$/.test(entry.sha256 || "") ||
            !Number.isInteger(entry.bytes) ||
            entry.bytes < 0 ||
            seen.has(entry.path)) {
            throw new Error(`Install manifest has an invalid file entry: ${entry?.path || "<unknown>"}.`);
        }
        safeManagedPath(target, entry.path);
        seen.add(entry.path);
    }
    if (!/^[a-f0-9]{64}$/.test(value.digest) || value.digest !== manifestDigest(value.files)) {
        throw new Error("Install manifest digest is invalid.");
    }
    return value;
}
export function conflictSidecar(target, destination, sourceHash) {
    const preferred = safeManagedPath(target, posix(relative(target, `${destination}.cursor-harness-new`)));
    if (!existsSync(preferred) || fileHash(preferred) === sourceHash)
        return preferred;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let candidate = safeManagedPath(target, posix(relative(target, `${preferred}-${sourceHash.slice(0, 12)}-${timestamp}`)));
    let suffix = 1;
    while (existsSync(candidate)) {
        candidate = safeManagedPath(target, posix(relative(target, `${preferred}-${sourceHash.slice(0, 12)}-${timestamp}-${suffix}`)));
        suffix += 1;
    }
    return candidate;
}
export function installLike(action, options) {
    const target = targetFrom(options);
    const dryRun = boolOption(options, "dry-run");
    assertSafeTarget(target);
    if (resolve(target) === resolve(HARNESS_ROOT) ||
        (existsSync(target) && realpathSync(target) === realpathSync(HARNESS_ROOT))) {
        throw new Error("Refusing to install or upgrade with the harness source as the target.");
    }
    const manifest = sourceManifest();
    const oldPath = safeManagedPath(target, INSTALL_MANIFEST_REL);
    const oldManifest = existsSync(oldPath)
        ? validateInstallManifest(target, readJson(oldPath))
        : null;
    const oldByPath = new Map((oldManifest?.files || []).map((entry) => [entry.path, entry]));
    const operations = [];
    for (const entry of manifest.files) {
        const source = resolve(HARNESS_ROOT, entry.path);
        const destination = safeManagedPath(target, entry.path);
        const currentHash = fileHash(destination);
        const oldHash = oldByPath.get(entry.path)?.sha256;
        if (currentHash === entry.sha256) {
            operations.push({ path: entry.path, action: "unchanged" });
            continue;
        }
        const safeToReplace = currentHash === null || currentHash === oldHash;
        if (safeToReplace) {
            operations.push({ path: entry.path, action: currentHash === null ? "create" : "update" });
            if (!dryRun)
                copyNormalized(source, destination);
        }
        else {
            const sidecar = conflictSidecar(target, destination, entry.sha256);
            operations.push({ path: entry.path, action: "preserve", sidecar: posix(relative(target, sidecar)) });
            if (!dryRun)
                copyNormalized(source, sidecar);
        }
    }
    const sourcePaths = new Set(manifest.files.map((entry) => entry.path));
    if (action === "upgrade" && oldManifest) {
        for (const oldEntry of oldManifest.files || []) {
            if (sourcePaths.has(oldEntry.path))
                continue;
            const destination = safeManagedPath(target, oldEntry.path);
            if (fileHash(destination) === oldEntry.sha256) {
                operations.push({ path: oldEntry.path, action: "remove-obsolete" });
                if (!dryRun)
                    rmSync(destination, { force: true });
            }
            else if (existsSync(destination)) {
                operations.push({ path: oldEntry.path, action: "preserve-obsolete" });
            }
        }
    }
    if (!dryRun) {
        writeJson(oldPath, {
            ...manifest,
            installed_at: new Date().toISOString(),
            source: HARNESS_ROOT,
        });
    }
    printJson({ command: action, target, dry_run: dryRun, operations });
}
export function uninstall(options) {
    const target = targetFrom(options);
    const dryRun = boolOption(options, "dry-run");
    assertSafeTarget(target);
    const manifestPath = safeManagedPath(target, INSTALL_MANIFEST_REL);
    if (!existsSync(manifestPath)) {
        throw new Error(`No install manifest found at ${manifestPath}.`);
    }
    const manifest = readJson(manifestPath);
    validateInstallManifest(target, manifest);
    const operations = [];
    for (const entry of manifest.files || []) {
        const destination = safeManagedPath(target, entry.path);
        if (!existsSync(destination))
            continue;
        if (fileHash(destination) === entry.sha256) {
            operations.push({ path: entry.path, action: "remove" });
            if (!dryRun)
                rmSync(destination, { force: true });
        }
        else {
            operations.push({ path: entry.path, action: "preserve-modified" });
        }
    }
    if (!dryRun)
        rmSync(manifestPath, { force: true });
    printJson({ command: "uninstall", target, dry_run: dryRun, operations });
}
export function compilerPath(root) {
    const candidate = resolve(root, "node_modules/typescript/lib/tsc.js");
    return existsSync(candidate) ? candidate : null;
}
// The checked-in runtime must be exactly what the current TypeScript source compiles to.
// Comparing bytes against a scratch build is the only check that cannot be satisfied by
// editing the runtime directly.
export function compareCompiledRuntime(root, errors) {
    const compiler = compilerPath(root);
    if (!compiler) {
        errors.push("TypeScript compiler is unavailable; run `npm install` before validating runtime parity.");
        return;
    }
    const scratch = mkdtempSync(resolve(tmpdir(), "cursor-harness-build-"));
    try {
        const build = run(process.execPath, [compiler, "-p", resolve(root, "tsconfig.json"), "--outDir", scratch], root, true);
        if (!build.ok) {
            errors.push(`TypeScript build failed: ${(build.stdout || build.stderr).trim()}`);
            return;
        }
        const expected = walkFiles(scratch).map((absolute) => posix(relative(scratch, absolute))).sort();
        for (const rel of expected) {
            const built = resolve(scratch, rel);
            const shipped = resolve(root, ".cursor/runtime", rel);
            if (!existsSync(shipped)) {
                errors.push(`Checked-in runtime is missing a compiled file: .cursor/runtime/${rel}`);
                continue;
            }
            if (normalizeLf(readFileSync(built, "utf8")) !== normalizeLf(readFileSync(shipped, "utf8"))) {
                errors.push(`Checked-in runtime is stale for ${rel}; run \`npm run build\` and commit the result.`);
            }
        }
        const shippedFiles = walkFiles(resolve(root, ".cursor/runtime"))
            .map((absolute) => posix(relative(resolve(root, ".cursor/runtime"), absolute)))
            .sort();
        for (const rel of shippedFiles) {
            if (!expected.includes(rel)) {
                errors.push(`Checked-in runtime has an orphaned file the build does not produce: ${rel}`);
            }
        }
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}
export function validateRuntimeSync(root, errors) {
    const source = resolve(root, "src/harness.mts");
    const runtime = resolve(root, ".cursor/runtime/harness.mjs");
    if (!existsSync(runtime)) {
        errors.push("Missing checked-in runtime: .cursor/runtime/harness.mjs.");
        return;
    }
    if (!existsSync(source)) {
        const manifestPath = resolve(root, INSTALL_MANIFEST_REL);
        if (!existsSync(manifestPath)) {
            errors.push("src/harness.mts is missing and no valid install manifest is available.");
            return;
        }
        try {
            const manifest = validateInstallManifest(root, readJson(manifestPath));
            if (!manifest.files.some((entry) => entry.path === ".cursor/runtime/harness.mjs")) {
                errors.push("Install manifest does not manage .cursor/runtime/harness.mjs.");
            }
        }
        catch (error) {
            errors.push(errorMessage(error));
        }
        return;
    }
    compareCompiledRuntime(root, errors);
}
export function validateManagedJson(root, paths, errors) {
    for (const path of [...new Set(paths)]) {
        const absolute = resolve(root, path);
        if (!existsSync(absolute))
            continue;
        try {
            readJson(absolute);
        }
        catch (error) {
            errors.push(errorMessage(error));
        }
    }
}
export function isDefaultBootstrapConfig(root) {
    const pairs = [
        ["harness/module-catalog.json", "harness/default-module-catalog.json"],
        ["harness/verification-matrix.json", "harness/default-verification-matrix.json"],
    ];
    return pairs.every(([local, fallback]) => {
        const localPath = resolve(root, local);
        const fallbackPath = resolve(root, fallback);
        return (existsSync(localPath) &&
            existsSync(fallbackPath) &&
            normalizeLf(readFileSync(localPath, "utf8")) === normalizeLf(readFileSync(fallbackPath, "utf8")));
    });
}
export function validate(options) {
    const root = targetFrom(options);
    const errors = [];
    const warnings = [];
    const syncOnly = boolOption(options, "sync-only");
    validateRuntimeSync(root, errors);
    if (!syncOnly) {
        const required = [
            "AGENTS.md",
            ".cursor/hooks.json",
            ".cursor/cli.json",
            ".cursor/sandbox.json",
            ".cursor/worktrees.json",
            "harness/default-module-catalog.json",
            "harness/default-verification-matrix.json",
            "harness/module-catalog.json",
            "harness/verification-matrix.json",
            "scripts/harness.mjs",
        ];
        if (isHarnessSourceRoot(root)) {
            required.push("README.md", "docs/ADOPTION.md", "docs/ARCHITECTURE.md", "docs/GOVERNANCE.md", "docs/LARGE-REPO-GUIDE.md", "docs/OPERATIONS.md", "docs/PROJECT-MEMORY.md", "docs/PROTOCOLS.md", "docs/QUALITY-ATTRIBUTES.md");
        }
        for (const path of required) {
            if (!existsSync(resolve(root, path)))
                errors.push(`Missing required asset: ${path}`);
        }
        const managedJson = [
            ".cursor/hooks.json",
            ".cursor/cli.json",
            ".cursor/sandbox.json",
            ".cursor/worktrees.json",
            "harness/default-module-catalog.json",
            "harness/default-verification-matrix.json",
            "harness/module-catalog.json",
            "harness/verification-matrix.json",
            "harness/assurance-policy.json",
            INSTALL_MANIFEST_REL,
        ];
        const schemaDir = resolve(root, "harness/schemas");
        if (existsSync(schemaDir)) {
            managedJson.push(...readdirSync(schemaDir)
                .filter((name) => name.endsWith(".json"))
                .map((name) => `harness/schemas/${name}`));
        }
        validateManagedJson(root, managedJson, errors);
        if (existsSync(resolve(root, ".cursor/hooks.json"))) {
            const config = readJson(resolve(root, ".cursor/hooks.json"));
            if (config.version !== 1)
                errors.push(".cursor/hooks.json must use version 1.");
            for (const event of EVENTS) {
                const definitions = config.hooks?.[event];
                if (!Array.isArray(definitions) || definitions.length !== 1) {
                    errors.push(`.cursor/hooks.json must define exactly one ${event} hook.`);
                    continue;
                }
                if (definitions[0].command !== `node .cursor/runtime/harness.mjs hook ${event}`) {
                    errors.push(`Hook ${event} must call the checked-in runtime.`);
                }
                if (SECURITY_EVENTS.includes(event) && definitions[0].failClosed !== true) {
                    errors.push(`Security hook ${event} must set failClosed: true.`);
                }
            }
        }
        if (existsSync(resolve(root, "harness/default-module-catalog.json"))) {
            validateCatalog(readJson(resolve(root, "harness/default-module-catalog.json")), "default-module-catalog.json", errors);
        }
        if (existsSync(resolve(root, "harness/default-verification-matrix.json"))) {
            const verification = readJson(resolve(root, "harness/default-verification-matrix.json"));
            if (verification.version !== 1 || !verification.checks || Array.isArray(verification.checks)) {
                errors.push("default-verification-matrix.json must define version 1 and a checks object.");
            }
        }
        if (isDefaultBootstrapConfig(root)) {
            warnings.push("Module catalog and verification matrix still use bootstrap defaults; customize them for this repository.");
        }
        // Risk-tier lists select checks, so a dangling reference would silently verify nothing.
        try {
            const activeMatrix = matrix(root);
            for (const [level, ids] of Object.entries(activeMatrix.riskChecks || {})) {
                if (!RISK_LEVELS.includes(level)) {
                    errors.push(`verification matrix riskChecks declares unknown level ${level}.`);
                    continue;
                }
                for (const id of ids || []) {
                    if (!activeMatrix.checks?.[id]) {
                        errors.push(`verification matrix riskChecks.${level} references unknown check ${id}.`);
                    }
                }
            }
        }
        catch (error) {
            errors.push(`Unable to validate the verification matrix: ${errorMessage(error)}`);
        }
        try {
            servicesConfig(root);
        }
        catch (error) {
            errors.push(`Invalid ${SERVICES_CONFIG_REL}: ${errorMessage(error)}`);
        }
        // The policy is what decides how much evidence a change needs; a policy that fails to
        // compile would silently fall back to defaults the project did not choose.
        try {
            loadPolicy(root);
        }
        catch (error) {
            errors.push(`Invalid ${POLICY_REL}: ${errorMessage(error)}`);
        }
        // A check that may be deferred under a loan must not be the one evidencing a protected
        // attribute; the gate refuses such deferrals at run time, but the contradiction belongs in
        // the matrix review, not in a surprise at gate time.
        try {
            for (const [id, check] of Object.entries(matrix(root).checks || {})) {
                if (check.allowFastSkip && isProtectedCheck(check)) {
                    errors.push(`verification matrix check ${id} sets allowFastSkip but evidences a protected attribute or class; protected evidence is never deferrable.`);
                }
            }
        }
        catch {
            // Reported above by the riskChecks validation.
        }
        if (isHarnessSourceRoot(root)) {
            const managedDocs = ["docs/ASSURANCE-PROFILES.md", "docs/REVIEW.md"];
            for (const path of managedDocs)
                if (!existsSync(resolve(root, path)))
                    errors.push(`Missing required asset: ${path}`);
        }
        const integrity = verifyLedgerChain(root);
        if (!integrity.ok) {
            errors.push(`Quality ledger integrity: ${integrity.reason}`);
        }
        else if (integrity.legacy) {
            warnings.push(integrity.reason);
        }
        const feedbackFailures = feedbackLessons(root).filter((lesson) => lesson.errors.length > 0);
        for (const lesson of feedbackFailures.slice(0, 20)) {
            errors.push(`Feedback lesson ${lesson.path}: ${lesson.errors.join(" ")}`);
        }
    }
    if (Number(process.versions.node.split(".")[0]) < 20)
        errors.push("Node.js 20 or newer is required.");
    if (!gitAvailable(root))
        warnings.push("Git is unavailable; receipt bindings use a filesystem snapshot.");
    printJson({
        command: "validate",
        check_type: syncOnly ? "sync-only" : "full",
        target: root,
        ok: errors.length === 0,
        errors,
        warnings,
    });
    if (errors.length)
        process.exitCode = 1;
}
export function doctor(options) {
    const root = targetFrom(options);
    const checks = [];
    const warnings = [];
    const major = Number(process.versions.node.split(".")[0]);
    checks.push({ name: "node", ok: major >= 20, detail: process.version });
    const gitVersion = git(root, ["--version"], true);
    checks.push({
        name: "git",
        ok: gitVersion.ok,
        detail: (gitVersion.stdout || gitVersion.stderr).trim() || "not found",
    });
    checks.push({
        name: "repository-root",
        ok: existsSync(resolve(root, "AGENTS.md")) && existsSync(resolve(root, ".cursor")),
        detail: root,
    });
    for (const path of ["scripts/harness.mjs", ".cursor/hooks.json"]) {
        checks.push({ name: path, ok: existsSync(resolve(root, path)), detail: existsSync(resolve(root, path)) ? "present" : "missing" });
    }
    const syncErrors = [];
    validateRuntimeSync(root, syncErrors);
    checks.push({
        name: "runtime-sync",
        ok: syncErrors.length === 0,
        detail: syncErrors[0] || "source and runtime match",
    });
    const integrity = verifyLedgerChain(root);
    checks.push({
        name: "ledger-chain",
        ok: integrity.ok,
        detail: integrity.reason,
    });
    try {
        const compiled = loadPolicy(root);
        const selection = effectiveSelection(root, null);
        const resolved = resolveAssurance(compiled, { selection });
        checks.push({
            name: "assurance-policy",
            ok: true,
            detail: `${compiled.source}; selection ${selection} resolves to ${resolved.effective} before per-change floors`,
        });
    }
    catch (error) {
        checks.push({ name: "assurance-policy", ok: false, detail: errorMessage(error) });
    }
    const loan = readLoan(root);
    const debts = openDebts(root);
    if (loan.active)
        warnings.push(`A fast loan is open until ${loan.loan?.expires_at}; deferred checks are recorded as debt.`);
    if (debts.length > 0)
        warnings.push(`${debts.length} evidence debt(s) are unpaid; run \`node scripts/harness.mjs gate\` with the loan closed.`);
    if (existsSync(resolve(root, SERVICES_CONFIG_REL))) {
        let detail = "parseable";
        let ok = true;
        try {
            const services = servicesConfig(root);
            detail = `${Object.keys(services).length} service(s) declared`;
        }
        catch (error) {
            ok = false;
            detail = errorMessage(error);
        }
        checks.push({ name: "services-config", ok, detail });
    }
    for (const name of listServiceStateDirs(root)) {
        const synthesized = synthesizeServiceStatus(readServiceState(root, name));
        if (synthesized.status === "crashed" || synthesized.status === "dead") {
            warnings.push(`Service ${name} is ${synthesized.status}; run \`node scripts/harness.mjs service status\`.`);
        }
    }
    if (isDefaultBootstrapConfig(root)) {
        warnings.push("Module catalog and verification matrix still use bootstrap defaults; customize them for this repository.");
    }
    const ok = checks.every((check) => check.ok);
    printJson({ command: "doctor", target: root, ok, checks, warnings });
    if (!ok)
        process.exitCode = 1;
}
export function manifest(options) {
    const root = targetFrom(options);
    if (!isHarnessSourceRoot(root)) {
        const files = snapshotFiles(root, true);
        printJson({
            version: 1,
            harness_version: VERSION,
            hash: "sha256-lf-v1",
            files,
            digest: manifestDigest(files),
            check: boolOption(options, "check"),
        });
        return;
    }
    const value = sourceManifest();
    const manifestPath = resolve(root, SOURCE_MANIFEST_REL);
    if (boolOption(options, "write")) {
        writeJson(manifestPath, value);
        printJson({
            command: "manifest",
            ok: true,
            written: manifestPath,
            digest: value.digest,
            files: value.files.length,
        });
        return;
    }
    if (boolOption(options, "check")) {
        const errors = [];
        validateRuntimeSync(root, errors);
        if (!existsSync(manifestPath)) {
            errors.push(`Missing source manifest: ${SOURCE_MANIFEST_REL}.`);
        }
        else {
            const expected = readJson(manifestPath);
            let savedDigest = null;
            if (Array.isArray(expected.files)) {
                savedDigest = manifestDigest(expected.files);
                if (savedDigest !== expected.digest) {
                    errors.push("Saved source manifest digest does not match its files.");
                }
            }
            else {
                errors.push("Saved source manifest files must be an array.");
            }
            for (const field of ["version", "harness_version", "hash", "files", "digest"]) {
                if (JSON.stringify(expected[field]) !== JSON.stringify(value[field])) {
                    errors.push(`Source manifest ${field} is stale.`);
                }
            }
            if (errors.length > 0) {
                errors.push("Source manifest is stale; run `node scripts/harness.mjs manifest --write`.");
            }
        }
        printJson({
            command: "manifest",
            ok: errors.length === 0,
            digest: value.digest,
            files: value.files.length,
            errors,
        });
        if (errors.length)
            process.exitCode = 1;
    }
    else {
        printJson(value);
    }
}
export function testHarness(options) {
    const root = targetFrom(options);
    const result = spawnSync(process.execPath, ["--test"], {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
    });
    if (result.error)
        throw new Error(`Unable to run Node tests: ${result.error.message}`);
    if (result.status !== 0)
        process.exitCode = result.status || 1;
}
