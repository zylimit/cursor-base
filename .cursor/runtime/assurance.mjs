// Assurance profiles: how much evidence a change must carry before it may be called done.
//
// One axis, four built-in strengths, floors that only raise. A profile is a bundle of
// controls (verification breadth, review mode, attribute enforcement, memory sync, budget,
// context depth, deferral, completion) ordered so that every stronger profile is at least
// as demanding on every control. The effective profile of a change is the strongest of the
// requested profile and every floor the change triggers: task risk, unmapped or shared
// impact, protected quality attributes on affected modules, and governance paths.
//
// Two things a profile never does: it never changes what the safety hooks deny or ask (that
// is the capability axis, owned by hooks, cli.json, and the sandbox), and it never changes the
// model. Speed is bought by deferring evidence under a dated, repayable loan, not by pretending
// the evidence exists.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { catalog, normalizeRequirement } from "./catalog.mjs";
import { EXIT, STATE_REL, boolOption, canonicalJson, matchesPath, printJson, readJson, sha256, targetFrom, withStateLock, writeJson, } from "./core.mjs";
import { affectedModules, requestedPaths } from "./graph.mjs";
import { activeTask } from "./state.mjs";
// ---------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------
export const PROFILE_ORDER = ["explore", "rapid", "balanced", "strict"];
/** Attributes that no profile, loan, or waiver may weaken. */
export const PROTECTED_ATTRIBUTES = ["security", "safety", "privacy"];
/** Review lenses, each owning one failure mode, grouped by the stage that pays for it. */
export const REVIEW_LENSES = Object.freeze({
    correctness: { stage: 1, attribute: null },
    architecture: { stage: 1, attribute: "maintainability" },
    maintainability: { stage: 1, attribute: "maintainability" },
    testing: { stage: 2, attribute: "reliability" },
    performance: { stage: 2, attribute: "performance" },
    reliability: { stage: 3, attribute: "reliability" },
    resilience: { stage: 3, attribute: "resilience" },
    security: { stage: 3, attribute: "security" },
    privacy: { stage: 3, attribute: "privacy" },
});
export const REVIEW_STAGES = Object.freeze({ 1: "code", 2: "functional", 3: "trust" });
/** Ordered control scales: later values are stronger. */
export const CONTROL_SCALES = Object.freeze({
    /** Which modules' checks the gate runs: changed modules, their dependents, or everything. */
    verificationBreadth: ["none", "direct", "affected", "all"],
    /** Whether an open fast loan may defer `allowFastSkip` checks. */
    deferral: ["loan", "none"],
    /** What closing a task requires: nothing, an ACCEPT receipt, or lens-covered structured review. */
    reviewMode: ["none", "receipt", "structured"],
    /** Whether uncovered critical/high attribute gaps block completion or are only reported. */
    attributeGaps: ["advisory", "blocking"],
    /** Whether governed code changing without progress.md is ignored, reported, or blocks stop. */
    memorySync: ["off", "warn", "block"],
    /** Whether exceeding the blast-radius budget is ignored, reported, or blocks completion. */
    budget: ["off", "warn", "block"],
    /** How much of the repository a context pack pulls in. */
    contextDepth: ["changed", "affected", "conservative"],
    /** The strongest kind of work a passing gate under this profile may close. */
    completion: ["forbidden", "low-risk", "delivery", "release-capable"],
});
const CONTROL_NAMES = Object.keys(CONTROL_SCALES);
export const BUILTIN_PROFILES = Object.freeze({
    explore: {
        verificationBreadth: "none",
        deferral: "loan",
        reviewMode: "none",
        attributeGaps: "advisory",
        memorySync: "off",
        budget: "off",
        contextDepth: "changed",
        completion: "forbidden",
        reviewLenses: [],
    },
    rapid: {
        verificationBreadth: "direct",
        deferral: "loan",
        reviewMode: "none",
        attributeGaps: "advisory",
        memorySync: "warn",
        budget: "warn",
        contextDepth: "changed",
        completion: "low-risk",
        reviewLenses: ["correctness"],
    },
    balanced: {
        verificationBreadth: "affected",
        deferral: "loan",
        reviewMode: "receipt",
        attributeGaps: "blocking",
        memorySync: "warn",
        budget: "warn",
        contextDepth: "affected",
        completion: "delivery",
        reviewLenses: ["correctness", "testing", "architecture"],
    },
    strict: {
        verificationBreadth: "all",
        deferral: "none",
        reviewMode: "structured",
        attributeGaps: "blocking",
        memorySync: "block",
        budget: "block",
        contextDepth: "conservative",
        completion: "release-capable",
        reviewLenses: Object.keys(REVIEW_LENSES),
    },
});
export const POLICY_REL = "harness/assurance-policy.json";
export const DEFAULT_POLICY = Object.freeze({
    version: 1,
    default: "balanced",
    maxLoanMinutes: 480,
    profiles: {},
    floors: {
        risk: { low: "rapid", medium: "balanced", high: "strict" },
        // An untrustworthy mapping already fans verification out to every module; the floor adds
        // that such a change can never run under `rapid` without forcing a nine-lens review on a
        // stray unmapped file.
        impact: "balanced",
        protectedAttributes: "strict",
        criticalHighAttributes: "balanced",
        paths: [
            {
                id: "governance",
                patterns: [
                    ".cursor/**",
                    "AGENTS.md",
                    "harness/**",
                    "scripts/**",
                    "setup.sh",
                    "setup.ps1",
                    ".github/**",
                    "package.json",
                    "package-lock.json",
                    "pnpm-lock.yaml",
                    "yarn.lock",
                ],
                profile: "strict",
                reason: "the governance or delivery surface changed",
            },
            {
                id: "trust-boundary",
                patterns: ["**/auth/**", "**/security/**", "**/secrets/**", "**/privacy/**"],
                profile: "strict",
                reason: "an authentication, secret, security, or privacy path changed",
            },
        ],
    },
});
// Floors the policy may raise but never lower. A policy that let a high-risk task run at
// `rapid` would make the risk field decorative.
const HARD_MINIMA = {
    riskLow: "rapid",
    riskMedium: "balanced",
    riskHigh: "strict",
    impact: "balanced",
    protectedAttributes: "strict",
    criticalHighAttributes: "balanced",
};
export const MAX_LOAN_MINUTES = 24 * 60;
function rank(name, scale) {
    const index = scale.indexOf(name);
    if (index < 0)
        throw new Error(`Unknown value ${name}; expected one of ${scale.join(", ")}.`);
    return index;
}
/** Control names on which `candidate` is weaker than `baseline`. */
export function weakerControls(candidate, baseline) {
    const weaker = [];
    for (const name of CONTROL_NAMES) {
        const scale = CONTROL_SCALES[name];
        if (rank(candidate[name], scale) < rank(baseline[name], scale))
            weaker.push(name);
    }
    if (baseline.reviewLenses.some((lens) => !candidate.reviewLenses.includes(lens))) {
        weaker.push("reviewLenses");
    }
    return weaker;
}
function strongerOf(left, right) {
    const merged = {};
    for (const name of CONTROL_NAMES) {
        const scale = CONTROL_SCALES[name];
        merged[name] = rank(left[name], scale) >= rank(right[name], scale) ? left[name] : right[name];
    }
    merged.reviewLenses = [...new Set([...left.reviewLenses, ...right.reviewLenses])].sort();
    return merged;
}
function validateControls(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    const controls = value;
    for (const [name, raw] of Object.entries(controls)) {
        if (name === "reviewLenses") {
            if (!Array.isArray(raw) || raw.some((lens) => !(lens in REVIEW_LENSES))) {
                throw new Error(`${label}.reviewLenses must list known lenses (${Object.keys(REVIEW_LENSES).join(", ")}).`);
            }
            continue;
        }
        if (!(name in CONTROL_SCALES))
            throw new Error(`${label} has an unknown control: ${name}.`);
        const scale = CONTROL_SCALES[name];
        if (!scale.includes(String(raw))) {
            throw new Error(`${label}.${name} must be one of ${scale.join(", ")}.`);
        }
    }
    return controls;
}
export function compilePolicy(raw, source) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("The assurance policy must be a JSON object.");
    }
    const policy = { ...DEFAULT_POLICY, ...raw };
    policy.floors = { ...DEFAULT_POLICY.floors, ...(raw.floors || {}) };
    policy.floors.risk = { ...DEFAULT_POLICY.floors.risk, ...(policy.floors.risk || {}) };
    policy.profiles = policy.profiles || {};
    const known = new Set(["$schema", "version", "default", "maxLoanMinutes", "profiles", "floors"]);
    for (const key of Object.keys(raw)) {
        if (!known.has(key))
            throw new Error(`Unknown assurance policy field: ${key}.`);
    }
    if (policy.version !== 1)
        throw new Error("The assurance policy version must be 1.");
    if (!Number.isInteger(policy.maxLoanMinutes) || policy.maxLoanMinutes < 1 || policy.maxLoanMinutes > MAX_LOAN_MINUTES) {
        throw new Error(`maxLoanMinutes must be an integer between 1 and ${MAX_LOAN_MINUTES}.`);
    }
    const profiles = new Map();
    const ranks = new Map();
    for (const name of PROFILE_ORDER) {
        profiles.set(name, { ...BUILTIN_PROFILES[name], reviewLenses: [...BUILTIN_PROFILES[name].reviewLenses] });
        ranks.set(name, PROFILE_ORDER.indexOf(name));
    }
    // Built-ins are a fixed lattice; assert it so a future edit cannot quietly break monotonicity.
    for (let index = 1; index < PROFILE_ORDER.length; index += 1) {
        const weaker = weakerControls(BUILTIN_PROFILES[PROFILE_ORDER[index]], BUILTIN_PROFILES[PROFILE_ORDER[index - 1]]);
        if (weaker.length > 0) {
            throw new Error(`Built-in profile ${PROFILE_ORDER[index]} weakens ${PROFILE_ORDER[index - 1]}: ${weaker.join(", ")}.`);
        }
    }
    const resolving = new Set();
    const resolveProfile = (name) => {
        const existing = profiles.get(name);
        if (existing)
            return existing;
        const definition = policy.profiles[name];
        if (!definition)
            throw new Error(`Unknown assurance profile: ${name}.`);
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(name))
            throw new Error(`Invalid profile name: ${name}.`);
        if (resolving.has(name))
            throw new Error(`Assurance profile inheritance cycle at ${name}.`);
        resolving.add(name);
        if (typeof definition.extends !== "string")
            throw new Error(`Profile ${name} must declare which profile it extends.`);
        const parent = resolveProfile(definition.extends);
        const overrides = validateControls(definition.controls ?? {}, `profiles.${name}.controls`);
        const controls = {
            ...parent,
            ...overrides,
            reviewLenses: [...new Set([...parent.reviewLenses, ...(overrides.reviewLenses ?? [])])].sort(),
        };
        const weaker = weakerControls(controls, parent);
        if (weaker.length > 0) {
            throw new Error(`Profile ${name} weakens ${definition.extends}: ${weaker.join(", ")}. A named profile may only tighten its parent.`);
        }
        profiles.set(name, controls);
        ranks.set(name, ranks.get(definition.extends) ?? 0);
        resolving.delete(name);
        return controls;
    };
    for (const name of Object.keys(policy.profiles))
        resolveProfile(name);
    const requireProfile = (name, label) => {
        if (!profiles.has(name))
            throw new Error(`${label} references an unknown profile: ${name}.`);
    };
    const requireAtLeast = (name, minimum, label) => {
        requireProfile(name, label);
        const weaker = weakerControls(profiles.get(name), profiles.get(minimum));
        if (weaker.length > 0)
            throw new Error(`${label} must be at least ${minimum}; ${name} is weaker on ${weaker.join(", ")}.`);
    };
    requireProfile(policy.default, "default");
    requireAtLeast(policy.floors.risk.low, HARD_MINIMA.riskLow, "floors.risk.low");
    requireAtLeast(policy.floors.risk.medium, HARD_MINIMA.riskMedium, "floors.risk.medium");
    requireAtLeast(policy.floors.risk.high, HARD_MINIMA.riskHigh, "floors.risk.high");
    requireAtLeast(policy.floors.impact, HARD_MINIMA.impact, "floors.impact");
    requireAtLeast(policy.floors.protectedAttributes, HARD_MINIMA.protectedAttributes, "floors.protectedAttributes");
    requireAtLeast(policy.floors.criticalHighAttributes, HARD_MINIMA.criticalHighAttributes, "floors.criticalHighAttributes");
    if (!Array.isArray(policy.floors.paths))
        throw new Error("floors.paths must be an array.");
    const ids = new Set();
    for (const floor of policy.floors.paths) {
        if (!floor || typeof floor.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(floor.id) || ids.has(floor.id)) {
            throw new Error(`Invalid or duplicate path floor id: ${String(floor?.id)}.`);
        }
        ids.add(floor.id);
        if (!Array.isArray(floor.patterns) || floor.patterns.length === 0) {
            throw new Error(`Path floor ${floor.id} must list at least one pattern.`);
        }
        if (typeof floor.reason !== "string" || !floor.reason.trim()) {
            throw new Error(`Path floor ${floor.id} needs a reason.`);
        }
        requireProfile(floor.profile, `path floor ${floor.id}`);
    }
    return {
        policy,
        profiles,
        ranks,
        definition_sha256: sha256(canonicalJson(policy)),
        source,
    };
}
export function loadPolicy(root) {
    const local = resolve(root, POLICY_REL);
    if (existsSync(local))
        return compilePolicy(readJson(local), POLICY_REL);
    return compilePolicy({ version: 1 }, "built-in defaults");
}
// ---------------------------------------------------------------------------------------
// Selection state
// ---------------------------------------------------------------------------------------
export const ASSURANCE_STATE_REL = `${STATE_REL}/assurance.json`;
export function readSelection(root) {
    const path = resolve(root, ASSURANCE_STATE_REL);
    if (!existsSync(path))
        return { version: 1, project: null, tasks: {} };
    const value = readJson(path);
    return {
        version: 1,
        project: value?.project && typeof value.project.selection === "string" ? value.project : null,
        tasks: value?.tasks && typeof value.tasks === "object" ? value.tasks : {},
    };
}
export function effectiveSelection(root, taskId) {
    const state = readSelection(root);
    return (taskId && state.tasks[taskId]?.selection) || state.project?.selection || "adaptive";
}
export function writeSelection(root, selection, taskId) {
    return withStateLock(root, "assurance", () => {
        const state = readSelection(root);
        const entry = { selection, updated_at: new Date().toISOString() };
        if (taskId)
            state.tasks[taskId] = entry;
        else
            state.project = entry;
        writeJson(resolve(root, ASSURANCE_STATE_REL), state);
        return state;
    });
}
export function resolveAssurance(compiled, input) {
    const selection = input.selection ?? "adaptive";
    const requested = selection === "adaptive" ? compiled.policy.default : selection;
    if (!compiled.profiles.has(requested))
        throw new Error(`Unknown assurance profile: ${requested}.`);
    const floors = [];
    const apply = (profile, source, reason) => floors.push({ source, profile, reason });
    if (input.risk)
        apply(compiled.policy.floors.risk[input.risk], "risk", `task risk is ${input.risk}`);
    for (const kind of [...new Set(input.impactKinds ?? [])].sort()) {
        apply(compiled.policy.floors.impact, `impact:${kind}`, `impact is ${kind}, so the module mapping cannot be trusted`);
    }
    for (const entry of input.moduleAttributes ?? []) {
        if (entry.tier !== "critical" && entry.tier !== "high")
            continue;
        const isProtected = PROTECTED_ATTRIBUTES.includes(entry.attribute);
        apply(isProtected ? compiled.policy.floors.protectedAttributes : compiled.policy.floors.criticalHighAttributes, `attribute:${entry.module}/${entry.attribute}`, `${entry.module} declares ${entry.attribute} at ${entry.tier}`);
    }
    for (const floor of compiled.policy.floors.paths) {
        const hits = (input.changedPaths ?? []).filter((path) => matchesPath(path, floor.patterns));
        if (hits.length === 0)
            continue;
        const sample = hits.slice(0, 3).join(", ") + (hits.length > 3 ? ` (+${hits.length - 3} more)` : "");
        apply(floor.profile, `path:${floor.id}`, `${floor.reason}: ${sample}`);
    }
    let controls = compiled.profiles.get(requested);
    let effective = requested;
    let effectiveRank = compiled.ranks.get(requested) ?? 0;
    for (const floor of floors) {
        const floorControls = compiled.profiles.get(floor.profile);
        controls = strongerOf(controls, floorControls);
        const floorRank = compiled.ranks.get(floor.profile) ?? 0;
        if (floorRank > effectiveRank) {
            effectiveRank = floorRank;
            effective = floor.profile;
        }
    }
    // Floors from named profiles may tighten individual controls beyond the effective built-in
    // rank; the controls object is the truth, the profile name is the summary.
    return {
        selection,
        requested,
        effective,
        rank: PROFILE_ORDER[effectiveRank],
        controls,
        floors,
        policy_sha256: compiled.definition_sha256,
        policy_source: compiled.source,
        assurance_sha256: sha256(canonicalJson({ effective, controls: controls })),
    };
}
/** Adapter from a computed impact to resolver input, so every consumer derives floors the same way. */
export function assuranceForImpact(root, impact, taskRisk, options = {}) {
    const compiled = loadPolicy(root);
    const impactKinds = new Set();
    for (const entry of impact.classifications) {
        if (entry.classification === "unmapped" || entry.classification === "global" || entry.classification === "overlap") {
            impactKinds.add(entry.classification);
        }
    }
    const definition = catalog(root);
    const affectedIds = new Set(impact.affected.map((module) => module.id));
    if (definition.modules.some((module) => module.shared && impact.direct.includes(module.id)))
        impactKinds.add("shared");
    if (impact.expansion_reasons.some((reason) => /Git is unavailable/.test(reason)))
        impactKinds.add("no-git");
    const moduleAttributes = [];
    for (const module of definition.modules) {
        if (!affectedIds.has(module.id))
            continue;
        for (const [attribute, requirement] of Object.entries(module.attributes || {})) {
            moduleAttributes.push({
                module: module.id,
                attribute: attribute,
                tier: normalizeRequirement(requirement).tier,
            });
        }
    }
    const taskId = options.taskId === undefined ? activeTask(root)?.id ?? null : options.taskId;
    return resolveAssurance(compiled, {
        selection: options.selection ?? effectiveSelection(root, taskId),
        risk: taskRisk,
        changedPaths: impact.paths,
        impactKinds: [...impactKinds],
        moduleAttributes,
    });
}
/**
 * Which lenses a review of these modules convenes. The profile sets the team; a lens is then
 * left out when no affected module declares its attribute above `minimal`, because a privacy
 * reviewer convened for a module that stores nothing produces nitpicks, and nitpicks are how a
 * review loop stops being believed. Attributes only ever shrink the team; risk and impact have
 * already raised the profile before this runs. Correctness is never excluded.
 */
export function convenedLenses(controls, modules) {
    const declared = new Map();
    const order = ["none", "minimal", "low", "medium", "high", "critical"];
    for (const module of modules) {
        for (const [attribute, requirement] of Object.entries(module.attributes || {})) {
            const tier = normalizeRequirement(requirement).tier;
            const previous = declared.get(attribute);
            if (!previous || order.indexOf(tier) > order.indexOf(previous))
                declared.set(attribute, tier);
        }
    }
    const convened = [];
    const excluded = [];
    for (const lens of controls.reviewLenses) {
        const attribute = REVIEW_LENSES[lens].attribute;
        if (!attribute) {
            convened.push(lens);
            continue;
        }
        const tier = declared.get(attribute) ?? "none";
        if (order.indexOf(tier) >= order.indexOf("low"))
            convened.push(lens);
        else
            excluded.push({ lens, reason: `no affected module declares ${attribute} above minimal` });
    }
    return { convened: convened.sort(), excluded };
}
/**
 * The single entry point review and completion share: lenses convened for the modules a change
 * actually reaches (the impact closure, never the plan's widened module set).
 */
export function convenedForModules(root, moduleIds, controls) {
    const wanted = new Set(moduleIds);
    return convenedLenses(controls, catalog(root).modules.filter((module) => wanted.has(module.id)));
}
// ---------------------------------------------------------------------------------------
// Fast loan and evidence debt
// ---------------------------------------------------------------------------------------
export const LOAN_REL = `${STATE_REL}/fast-loan.json`;
export const DEBT_REL = `${STATE_REL}/evidence-debt.json`;
export function readLoan(root) {
    const path = resolve(root, LOAN_REL);
    if (!existsSync(path))
        return { active: false, expired: false, loan: null };
    const loan = readJson(path);
    const expiresAt = Date.parse(String(loan?.expires_at));
    if (!Number.isFinite(expiresAt))
        return { active: false, expired: true, loan };
    const expired = expiresAt <= Date.now();
    return { active: !expired, expired, loan };
}
export function openLoan(root, request) {
    const compiled = loadPolicy(root);
    const reason = String(request.reason || "").trim();
    if (!reason) {
        throw new Error("A fast loan requires --reason: it is a dated loan against evidence, and an undated loan is never repaid.");
    }
    // The profile in force for the current change decides whether a loan may open at all. A loan
    // that opens under strict and then defers nothing would read as speed and deliver confusion.
    const task = activeTask(root);
    const change = requestedPaths(root, [], {});
    const impact = affectedModules(root, change.paths, !change.explicit);
    const resolved = assuranceForImpact(root, impact, task?.risk ?? null);
    if (resolved.controls.deferral === "none") {
        const floors = resolved.floors.map((floor) => floor.source).join(", ");
        throw new Error(`The effective assurance profile is ${resolved.effective}${floors ? ` (raised by ${floors})` : ""}, which forbids deferral; a fast loan cannot open under it.`);
    }
    const requested = Number(request.minutes);
    if (!Number.isInteger(requested) || requested < 1)
        throw new Error("--minutes must be a positive integer.");
    const minutes = Math.min(requested, compiled.policy.maxLoanMinutes);
    const now = Date.now();
    const loan = {
        version: 1,
        reason,
        by: String(request.by || process.env.USERNAME || process.env.USER || "unknown"),
        minutes,
        opened_at: new Date(now).toISOString(),
        expires_at: new Date(now + minutes * 60_000).toISOString(),
        task: activeTask(root)?.id ?? null,
    };
    writeJson(resolve(root, LOAN_REL), loan);
    return loan;
}
export function closeLoan(root) {
    const path = resolve(root, LOAN_REL);
    if (!existsSync(path))
        return false;
    writeJson(path, { ...readJson(path), expires_at: new Date(0).toISOString(), closed_at: new Date().toISOString() });
    return true;
}
export function readDebts(root) {
    const path = resolve(root, DEBT_REL);
    if (!existsSync(path))
        return { version: 1, entries: [] };
    const value = readJson(path);
    return { version: 1, entries: Array.isArray(value?.entries) ? value.entries : [] };
}
export function openDebts(root) {
    return readDebts(root).entries.filter((entry) => !entry.paid_at);
}
/** Records one debt per deferred check. Deferral is a loan, and a loan has a ledger. */
export function recordDebts(root, entries) {
    if (entries.length === 0)
        return [];
    return withStateLock(root, "evidence-debt", () => {
        const file = readDebts(root);
        const created = entries.map((entry) => ({
            ...entry,
            id: `debt-${sha256(canonicalJson({ ...entry, at: Date.now(), n: file.entries.length })).slice(0, 12)}`,
            opened_at: new Date().toISOString(),
            paid_at: null,
            paid_by: null,
        }));
        file.entries.push(...created);
        writeJson(resolve(root, DEBT_REL), file);
        return created;
    });
}
/**
 * A debt is repaid only by a PASS of the same check produced after the debt was opened. Closing
 * the window, letting it expire, or re-opening it never clears anything.
 */
export function settleDebts(root, receipts) {
    const passing = receipts.filter((receipt) => receipt.status === "PASS");
    if (passing.length === 0)
        return [];
    return withStateLock(root, "evidence-debt", () => {
        const file = readDebts(root);
        const settled = [];
        for (const entry of file.entries) {
            if (entry.paid_at)
                continue;
            const payment = passing.find((receipt) => receipt.check_id === entry.check && Date.parse(receipt.created_at) > Date.parse(entry.opened_at));
            if (!payment)
                continue;
            entry.paid_at = payment.created_at;
            entry.paid_by = payment.content_sha256 ?? null;
            settled.push(entry);
        }
        if (settled.length > 0)
            writeJson(resolve(root, DEBT_REL), file);
        return settled;
    });
}
/** A check evidencing a protected attribute or classed as security is never deferrable. */
export function isProtectedCheck(check) {
    if (check.class && ["security", "safety", "privacy"].includes(check.class))
        return true;
    return (check.attributes || []).some((attribute) => PROTECTED_ATTRIBUTES.includes(attribute));
}
// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
export function profileCommand(positional, options) {
    const root = targetFrom(options);
    const subcommand = positional[0] || "show";
    const compiled = loadPolicy(root);
    const taskOption = options.task === undefined ? null : String(options.task);
    if (subcommand === "list") {
        printJson({
            command: "profile list",
            target: root,
            policy_source: compiled.source,
            policy_sha256: compiled.definition_sha256,
            default: compiled.policy.default,
            max_loan_minutes: compiled.policy.maxLoanMinutes,
            profiles: [...compiled.profiles.entries()].map(([name, controls]) => ({
                name,
                builtin: PROFILE_ORDER.includes(name),
                rank: PROFILE_ORDER[compiled.ranks.get(name) ?? 0],
                controls,
            })),
            floors: compiled.policy.floors,
        });
        return;
    }
    if (subcommand === "set") {
        const selection = String(positional[1] || "");
        if (!selection)
            throw new Error("profile set requires a profile name or `adaptive`.");
        if (selection !== "adaptive" && !compiled.profiles.has(selection)) {
            throw new Error(`Unknown assurance profile: ${selection}. Known: adaptive, ${[...compiled.profiles.keys()].join(", ")}.`);
        }
        const state = writeSelection(root, selection, taskOption);
        printJson({ command: "profile set", target: root, selection, scope: taskOption ? `task ${taskOption}` : "project", state });
        return;
    }
    if (subcommand === "show" || subcommand === "explain") {
        const task = taskOption ? null : activeTask(root);
        const taskId = taskOption ?? task?.id ?? null;
        const risk = options.risk === undefined ? task?.risk ?? null : String(options.risk);
        const explicitSelection = options.selection === undefined ? undefined : String(options.selection);
        const paths = options.paths === undefined ? [] : String(options.paths).split(",").map((path) => path.trim()).filter(Boolean);
        const resolved = resolveAssurance(compiled, {
            selection: explicitSelection ?? effectiveSelection(root, taskId),
            risk,
            changedPaths: paths,
        });
        const loan = readLoan(root);
        printJson({
            command: `profile ${subcommand}`,
            target: root,
            task: taskId,
            ...resolved,
            loan: loan.active ? loan.loan : null,
            open_debts: openDebts(root).length,
            note: subcommand === "explain"
                ? "Floors from impact and module attributes are computed per change by gate and quality status; this view applies only the risk and path floors it was given."
                : undefined,
        });
        return;
    }
    throw new Error("profile supports show, explain, list, or set <name|adaptive> [--task ID].");
}
export function fastCommand(positional, options) {
    const root = targetFrom(options);
    const subcommand = positional[0] || "status";
    const compiled = loadPolicy(root);
    if (subcommand === "status") {
        const status = readLoan(root);
        const debts = openDebts(root);
        printJson({
            command: "fast status",
            target: root,
            active: status.active,
            expired: status.expired,
            loan: status.loan,
            max_loan_minutes: compiled.policy.maxLoanMinutes,
            open_debts: debts,
            note: debts.length
                ? "Deferred evidence is a loan. Close the window and run `node scripts/harness.mjs gate`; only a later PASS of each check repays it."
                : "Protected checks (security, safety, privacy) always run; only checks marked allowFastSkip can be deferred.",
        });
        return;
    }
    if (subcommand === "on") {
        const loan = openLoan(root, {
            minutes: options.minutes === undefined ? 60 : Number(options.minutes),
            reason: String(options.reason ?? ""),
            by: options.by === undefined ? undefined : String(options.by),
        });
        printJson({
            command: "fast on",
            target: root,
            loan,
            note: "The loan expires by itself. Every deferred check is recorded as SKIPPED (fast-loan) and as open debt; a loaned gate cannot close a task or a release.",
        });
        return;
    }
    if (subcommand === "off") {
        const wasOpen = closeLoan(root);
        printJson({
            command: "fast off",
            target: root,
            closed: wasOpen,
            open_debts: openDebts(root).length,
            note: "Closing the window does not repay debt. Run `node scripts/harness.mjs gate` to produce the deferred evidence.",
        });
        return;
    }
    throw new Error("fast supports on --minutes N --reason TEXT, off, or status.");
}
export function debtCommand(positional, options) {
    const root = targetFrom(options);
    const subcommand = positional[0] || "list";
    if (subcommand !== "list")
        throw new Error("debt supports the list subcommand.");
    const file = readDebts(root);
    const includePaid = boolOption(options, "all");
    const entries = includePaid ? file.entries : file.entries.filter((entry) => !entry.paid_at);
    printJson({ command: "debt list", target: root, open: file.entries.filter((entry) => !entry.paid_at).length, entries });
    if (!includePaid && entries.length > 0)
        process.exitCode = EXIT.VIOLATION;
}
