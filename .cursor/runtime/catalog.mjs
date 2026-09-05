// Module catalog: loading, validation, path classification, coverage lint, quality-attribute
// vocabulary, and the verification matrix.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { git, gitAvailable, matchesPath, posix, printJson, readJson, splitNulPaths, targetFrom, templatePath, } from "./core.mjs";
export const CATCH_ALL_PATTERNS = new Set(["", ".", "*", "**", "**/*", "./**"]);
export function moduleSpecificity(pattern) {
    return pattern.replace(/[*?]/g, "").length;
}
export function moduleEffectivePaths(module) {
    const root = (module.root || "").replace(/\/+$/, "");
    if (!root || root === ".")
        return module.paths || [];
    return (module.paths || []).map((pattern) => pattern.startsWith(`${root}/`) || pattern === root ? pattern : `${root}/${pattern}`);
}
// Ordering is deliberate: an explicit repo-wide declaration outranks a module claim, a module
// claim outranks an exclusion, and anything left over is treated as unknown rather than safe.
export function classifyPath(definition, path) {
    const candidate = posix(path);
    if (matchesPath(candidate, definition.globalPaths || [])) {
        return { path: candidate, classification: "global", module: null };
    }
    let best = null;
    let bestScore = -1;
    let tied = false;
    for (const module of definition.modules) {
        for (const pattern of moduleEffectivePaths(module)) {
            if (!matchesPath(candidate, [pattern]))
                continue;
            const score = moduleSpecificity(pattern);
            if (score > bestScore) {
                best = module;
                bestScore = score;
                tied = false;
            }
            else if (score === bestScore && best && best.id !== module.id) {
                tied = true;
            }
        }
    }
    if (best && tied)
        return { path: candidate, classification: "overlap", module: best.id };
    if (best)
        return { path: candidate, classification: "mapped", module: best.id };
    for (const entry of definition.ignored || []) {
        if (matchesPath(candidate, entry.paths || [])) {
            return { path: candidate, classification: "ignored", module: null, reason: entry.reason };
        }
    }
    return { path: candidate, classification: "unmapped", module: null };
}
export function trackedPaths(root) {
    if (!gitAvailable(root))
        return { paths: [], truncated: false, isGit: false };
    const result = git(root, ["ls-files", "-z"], true);
    if (!result.ok)
        return { paths: [], truncated: false, isGit: false };
    const all = splitNulPaths(result.stdout);
    const limit = Number(catalog(root).maxTrackedPaths) > 0 ? Number(catalog(root).maxTrackedPaths) : 100_000;
    return { paths: all.slice(0, limit), truncated: all.length > limit, isGit: true };
}
export function catalogLint(options) {
    const root = targetFrom(options);
    const definition = catalog(root);
    const failures = [];
    const warnings = [];
    const ids = new Set();
    for (const module of definition.modules) {
        if (!module.id || ids.has(module.id)) {
            failures.push({ code: "DUPLICATE_ID", detail: `Module IDs must be unique: ${module.id || "<empty>"}` });
        }
        ids.add(module.id);
        if (!Array.isArray(module.paths) || module.paths.length === 0) {
            failures.push({ code: "NO_PATHS", detail: `Module ${module.id} declares no paths.` });
        }
        for (const [attribute, requirement] of Object.entries(module.attributes || {})) {
            if (!QUALITY_ATTRIBUTES.includes(attribute)) {
                failures.push({
                    code: "UNKNOWN_ATTRIBUTE",
                    detail: `Module ${module.id} declares unknown quality attribute ${attribute}.`,
                });
                continue;
            }
            const { tier, reason } = normalizeRequirement(requirement);
            if (!ATTRIBUTE_TIERS.includes(tier)) {
                failures.push({
                    code: "UNKNOWN_TIER",
                    detail: `Module ${module.id} sets ${attribute} to unknown tier ${tier}. Use one of: ${ATTRIBUTE_TIERS.join(", ")}.`,
                });
                continue;
            }
            // Opting out is allowed and often correct, but it has to be a recorded decision rather
            // than the quiet default that every attribute drifts toward.
            if ((tier === "none" || tier === "minimal") && !reason.trim()) {
                failures.push({
                    code: "UNJUSTIFIED_TIER",
                    detail: `Module ${module.id} sets ${attribute} to "${tier}" without a reason. Use {"tier":"${tier}","reason":"..."}.`,
                });
            }
        }
        for (const forbidden of module.forbiddenDependencies || []) {
            if (forbidden === module.id) {
                failures.push({
                    code: "SELF_FORBIDDEN",
                    detail: `Module ${module.id} forbids depending on itself.`,
                });
            }
        }
        if (module.layer && definition.layers && !definition.layers.includes(module.layer)) {
            failures.push({
                code: "UNKNOWN_LAYER",
                detail: `Module ${module.id} is in layer ${module.layer}, which the catalog does not declare.`,
            });
        }
        for (const pattern of module.paths || []) {
            if (CATCH_ALL_PATTERNS.has(pattern.trim())) {
                failures.push({
                    code: "CATCH_ALL",
                    // A module that claims the whole tree makes coverage look complete while hiding
                    // every path nobody actually assigned an owner or a check to.
                    detail: `Module ${module.id} uses the catch-all pattern "${pattern}", which masks coverage gaps.`,
                });
            }
        }
    }
    for (const module of definition.modules) {
        for (const dependency of module.dependsOn || []) {
            if (!ids.has(dependency)) {
                failures.push({ code: "DANGLING_DEP", detail: `Module ${module.id} depends on unknown module ${dependency}.` });
            }
        }
    }
    for (const entry of definition.ignored || []) {
        if (!entry.reason || !String(entry.reason).trim()) {
            failures.push({ code: "IGNORED_WITHOUT_REASON", detail: `Ignored paths ${JSON.stringify(entry.paths)} need a reason.` });
        }
    }
    const declaredGraph = new Map(definition.modules.map((module) => [module.id, new Set(module.dependsOn || [])]));
    for (const cycle of detectCycles(declaredGraph)) {
        warnings.push(`Declared dependency cycle: ${cycle.join(" -> ")}`);
    }
    const tracked = trackedPaths(root);
    const explicit = String(options.paths || "").split(",").filter(Boolean);
    const subjects = [...new Set([...tracked.paths, ...explicit])];
    const entries = subjects.map((path) => classifyPath(definition, path));
    const counts = { mapped: 0, global: 0, ignored: 0, unmapped: 0, overlap: 0 };
    for (const entry of entries)
        counts[entry.classification] += 1;
    const unmappedPaths = entries.filter((item) => item.classification === "unmapped").map((item) => item.path);
    const overlapPaths = entries.filter((item) => item.classification === "overlap").map((item) => item.path);
    for (const path of unmappedPaths.slice(0, 50)) {
        failures.push({ code: "UNMAPPED", detail: `No module, global path, or ignore rule covers ${path}.` });
    }
    for (const path of overlapPaths.slice(0, 50)) {
        failures.push({ code: "OVERLAP", detail: `More than one module claims ${path} at the same specificity.` });
    }
    // Truncating the detail list is fine; truncating it silently would understate the gap.
    if (unmappedPaths.length > 50) {
        warnings.push(`${unmappedPaths.length - 50} further unmapped paths are not listed individually.`);
    }
    if (overlapPaths.length > 50) {
        warnings.push(`${overlapPaths.length - 50} further overlapping paths are not listed individually.`);
    }
    if (!tracked.isGit)
        warnings.push("Git is unavailable; coverage was checked only for explicitly supplied paths.");
    if (tracked.truncated)
        warnings.push("Tracked path list was truncated; coverage is incomplete.");
    const ok = failures.length === 0;
    printJson({
        command: "catalog lint",
        target: root,
        ok,
        total: entries.length,
        counts,
        unmapped_paths: unmappedPaths.slice(0, 500),
        overlapping_paths: overlapPaths.slice(0, 500),
        failures,
        warnings,
    });
    if (!ok)
        process.exitCode = 1;
}
// ISO/IEC 25010 sub-characteristics, narrowed to the ones a repository can hold evidence for.
export const QUALITY_ATTRIBUTES = [
    "security",
    "resilience",
    "privacy",
    "safety",
    "reliability",
    "availability",
    "performance",
    "maintainability",
];
// Six strengths so a module can be held to the standard it actually warrants. Uniform strictness
// is its own defect: it makes prototypes expensive and pushes teams to disable checks wholesale.
export const ATTRIBUTE_TIERS = ["critical", "high", "medium", "low", "minimal", "none"];
export const TIER_ENFORCEMENT = {
    critical: "block",
    high: "block",
    medium: "warn",
    low: "record",
    minimal: "listed",
    none: "opted-out",
};
export function normalizeRequirement(value) {
    if (typeof value === "string")
        return { tier: value, reason: "" };
    return { tier: value.tier, reason: String(value.reason || "") };
}
/** Only `critical` is beyond waiver; every other tier can be deferred with an owned waiver. */
export function tierIsWaivable(tier) {
    return tier !== "critical";
}
export const RISK_LEVELS = ["low", "medium", "high"];
/** The live contract when the repository has one, else its template. */
function liveOrTemplate(root, live) {
    const local = resolve(root, live);
    if (existsSync(local))
        return local;
    const template = templatePath(root, live);
    if (!template)
        throw new Error(`Neither ${live} nor its template exists.`);
    return template;
}
export function catalog(root) {
    return readJson(liveOrTemplate(root, "harness/module-catalog.json"));
}
export function matrix(root) {
    return readJson(liveOrTemplate(root, "harness/verification-matrix.json"));
}
export function moduleForPath(definition, path) {
    let best = null;
    let bestScore = -1;
    for (const module of definition.modules) {
        for (const pattern of moduleEffectivePaths(module)) {
            if (!matchesPath(path, [pattern]))
                continue;
            // The most specific declaration wins so a broad module cannot silently swallow a nested one.
            const score = pattern.replace(/[*?]/g, "").length;
            if (score > bestScore) {
                best = module;
                bestScore = score;
            }
        }
    }
    return best;
}
export function detectCycles(edges) {
    const cycles = [];
    const state = new Map();
    const stack = [];
    const visit = (node) => {
        state.set(node, 1);
        stack.push(node);
        for (const next of edges.get(node) || []) {
            if (state.get(next) === 1) {
                const start = stack.indexOf(next);
                if (start !== -1)
                    cycles.push([...stack.slice(start), next]);
            }
            else if (!state.has(next)) {
                visit(next);
            }
        }
        stack.pop();
        state.set(node, 2);
    };
    for (const node of edges.keys())
        if (!state.has(node))
            visit(node);
    return cycles;
}
export const TIER_RANK = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    minimal: 1,
    none: 0,
};
export function validateCatalog(value, label, errors) {
    if (value?.version !== 1 || !Array.isArray(value.modules)) {
        errors.push(`${label}: expected version 1 and a modules array.`);
        return;
    }
    const ids = new Set();
    for (const module of value.modules) {
        if (!module.id || ids.has(module.id))
            errors.push(`${label}: module IDs must be unique and non-empty.`);
        ids.add(module.id);
        if (!Array.isArray(module.paths) || module.paths.length === 0) {
            errors.push(`${label}: module ${module.id || "<unknown>"} needs paths.`);
        }
    }
    for (const module of value.modules) {
        for (const dependency of module.dependsOn || []) {
            if (!ids.has(dependency))
                errors.push(`${label}: module ${module.id} has unknown dependency ${dependency}.`);
        }
    }
}
/**
 * Directories a module contract could live in: the literal prefix of each path pattern before
 * its first wildcard, root-level files excluded. A module confined to one directory has one
 * candidate; a module spanning several has several, and any one of them holding an AGENTS.md
 * counts, because Cursor loads the nested file wherever the work happens.
 */
export function moduleDirectories(module) {
    const prefixes = module.paths.map((pattern) => {
        const solid = [];
        for (const segment of (module.root ? `${module.root}/${pattern}` : pattern).split("/")) {
            if (/[*?{]/.test(segment))
                break;
            solid.push(segment);
        }
        if (solid.length && /\.[A-Za-z0-9]{1,8}$/.test(solid[solid.length - 1]))
            solid.pop();
        return solid.join("/");
    });
    return [...new Set(prefixes.filter(Boolean))];
}
/** The single directory a module contract would live in, or null when the module spans several. */
export function moduleDirectory(module) {
    const unique = moduleDirectories(module);
    return unique.length === 1 ? unique[0] : null;
}
