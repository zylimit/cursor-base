#!/usr/bin/env node
// scripts/lib/link-manager.mjs — Cross-platform OS directory link manager for cursor-base.
// Manages `<target>/.cursor/skills -> <target>/.claude/skills`:
// - Windows (win32): Privilege-free NTFS Junction (`fs.symlinkSync(absTarget, linkPath, 'junction')`)
// - POSIX (Linux / WSL / macOS): Relative directory symlink (`fs.symlinkSync('../.claude/skills', linkPath, 'dir')`)
// - NEVER recursively deletes target directories; `unlinkSymlinkOrJunctionSafe` / `removeDirLink` only detaches the link entry itself!
// Zero npm dependencies (Node >= 20 built-ins only).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './path-guard.mjs';

/**
 * Non-traversing `lstatSync` wrapper returning `null` when absent.
 * @param {string} p
 * @returns {fs.Stats | null}
 */
export function safeLstat(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return null;
  }
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function resolveRealPathOrNull(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  }
}

function normRealKey(realPath) {
  if (!realPath) return '';
  const posix = toPosix(realPath).replace(/\/+$/, '') || '/';
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

function makeMigrationStamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

/**
 * Safely detach ONLY a symbolic link / Windows NTFS Junction entry without EVER recursing into its target.
 * Asserts `lstatSync(absLink).isSymbolicLink()` first — refuses non-symlink paths by throwing.
 * @param {string} absLink
 * @returns {boolean}
 */
export function unlinkSymlinkOrJunctionSafe(absLink) {
  let lst;
  try {
    lst = fs.lstatSync(absLink);
  } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw e;
  }
  if (!lst.isSymbolicLink()) {
    throw new Error(`拒绝拆除物理非链接路径：${absLink}`);
  }
  if (process.platform === 'win32') {
    try {
      fs.rmdirSync(absLink);
      return true;
    } catch {
      try {
        fs.unlinkSync(absLink);
        return true;
      } catch (e2) {
        if (e2 && e2.code === 'ENOENT') return false;
        throw e2;
      }
    }
  } else {
    try {
      fs.unlinkSync(absLink);
      return true;
    } catch (e) {
      if (e && e.code === 'ENOENT') return false;
      throw e;
    }
  }
}

function createOsDirLink(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(absTarget, absLink, 'junction');
  } else {
    const relTarget = toPosix(path.relative(path.dirname(absLink), absTarget));
    fs.symlinkSync(relTarget, absLink, 'dir');
  }
}

function migratePhysicalPath(srcPath, preferredBackupDir) {
  let finalDest = path.resolve(preferredBackupDir);
  if (fs.existsSync(finalDest)) {
    let seq = 1;
    while (fs.existsSync(`${finalDest}-${seq}`)) seq++;
    finalDest = `${finalDest}-${seq}`;
  }
  fs.mkdirSync(path.dirname(finalDest), { recursive: true });
  try {
    fs.renameSync(srcPath, finalDest);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      fs.cpSync(srcPath, finalDest, { recursive: true });
      fs.rmSync(srcPath, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
  return finalDest;
}

/**
 * Inspect the current state of `linkPath` relative to `expectedTargetPath`.
 * @param {string} linkPath
 * @param {string} [expectedTargetPath]
 */
export function inspectDirLink(linkPath, expectedTargetPath) {
  const absLink = path.resolve(linkPath);
  const lst = safeLstat(absLink);
  if (!lst) {
    return { exists: false, isLink: false, valid: false, matchesTarget: false, realPath: null };
  }
  if (!lst.isSymbolicLink()) {
    return {
      exists: true,
      isLink: false,
      isPhysicalDir: lst.isDirectory(),
      valid: false,
      matchesTarget: false,
      realPath: resolveRealPathOrNull(absLink),
    };
  }
  const st = statOrNull(absLink);
  const realLink = st && st.isDirectory() ? resolveRealPathOrNull(absLink) : null;
  if (!realLink) {
    return { exists: true, isLink: true, broken: true, valid: false, matchesTarget: false, realPath: null };
  }
  if (!expectedTargetPath) {
    return { exists: true, isLink: true, broken: false, valid: true, matchesTarget: true, realPath: realLink };
  }
  const realExpected = resolveRealPathOrNull(path.resolve(expectedTargetPath));
  const matchesTarget = Boolean(realExpected && normRealKey(realLink) === normRealKey(realExpected));
  return {
    exists: true,
    isLink: true,
    broken: false,
    valid: matchesTarget,
    matchesTarget,
    realPath: realLink,
    expectedRealPath: realExpected,
  };
}

/**
 * Ensure `linkPath` is a valid OS directory link (Windows NTFS Junction / POSIX relative symlink) pointing to `targetPath`.
 * @param {string} linkPath
 * @param {string} targetPath
 * @param {{
 *   migrate?: boolean,
 *   force?: boolean,
 *   backupDir?: string,
 *   requireTarget?: boolean
 * }} [opts]
 */
export function ensureDirLink(linkPath, targetPath, opts = {}) {
  const absLink = path.resolve(linkPath);
  const absTarget = path.resolve(targetPath);
  const allowMigrate = Boolean(opts.migrate || opts.force || opts.backupDir);

  if (safeLstat(path.dirname(absLink))?.isSymbolicLink()) {
    return {
      ok: false,
      status: 'blocked',
      action: 'blocked',
      reason: 'parent-is-symlink',
      linkPath: absLink,
      targetPath: absTarget,
      message: `拒绝迁移或建链：父目录本身是符号链接/联接点（${path.dirname(absLink)}），防止穿透搬空目标目录`,
    };
  }

  const targetStat = statOrNull(absTarget);
  const targetExists = Boolean(targetStat && targetStat.isDirectory());

  if (!targetExists) {
    const lst = safeLstat(absLink);
    let backupPath = null;
    if (lst) {
      if (lst.isSymbolicLink()) {
        unlinkSymlinkOrJunctionSafe(absLink);
      } else {
        const realLink = resolveRealPathOrNull(absLink);
        const realTarget = resolveRealPathOrNull(absTarget);
        if (realLink && realTarget && normRealKey(realLink) === normRealKey(realTarget)) {
          return {
            ok: false,
            status: 'blocked',
            action: 'blocked',
            reason: 'same-realpath-as-target',
            linkPath: absLink,
            targetPath: absTarget,
            message: `拒绝迁移：源路径与目标路径解析为同一真实目录（${realLink}）`,
          };
        }
        if (allowMigrate) {
          const defaultBackup = path.join(
            path.dirname(absLink),
            '.runtime',
            `migrated-standalone-${makeMigrationStamp()}`,
            path.basename(absLink),
          );
          backupPath = migratePhysicalPath(absLink, opts.backupDir || defaultBackup);
        } else {
          return {
            ok: false,
            status: 'blocked',
            action: 'blocked',
            reason: 'physical-dir-exists',
            linkPath: absLink,
            targetPath: absTarget,
            message: `路径已是实体目录而非链接：${absLink}（请传 --force 或先迁移实体目录）`,
          };
        }
      }
    }
    if (opts.requireTarget) {
      return {
        ok: false,
        status: 'missing-target',
        action: 'missing-target',
        reason: 'missing-target',
        linkPath: absLink,
        targetPath: absTarget,
        backupPath,
        message: `桥接目标目录不存在：${absTarget}`,
      };
    }
    return {
      ok: true,
      status: 'missing-target',
      action: 'missing-target',
      reason: 'missing-target',
      linkPath: absLink,
      targetPath: absTarget,
      backupPath,
    };
  }

  const realTarget = resolveRealPathOrNull(absTarget) || absTarget;
  const lst = safeLstat(absLink);

  if (!lst) {
    createOsDirLink(absLink, absTarget);
    return {
      ok: true,
      status: 'created',
      action: 'created',
      linkPath: absLink,
      targetPath: absTarget,
    };
  }

  if (lst.isSymbolicLink()) {
    const st = statOrNull(absLink);
    const realCurrent = st && st.isDirectory() ? resolveRealPathOrNull(absLink) : null;
    if (realCurrent && normRealKey(realCurrent) === normRealKey(realTarget)) {
      return {
        ok: true,
        status: 'unchanged',
        action: 'unchanged',
        linkPath: absLink,
        targetPath: absTarget,
      };
    }
    unlinkSymlinkOrJunctionSafe(absLink);
    createOsDirLink(absLink, absTarget);
    return {
      ok: true,
      status: 'repaired',
      action: 'repaired',
      linkPath: absLink,
      targetPath: absTarget,
    };
  }

  if (safeLstat(path.dirname(absLink))?.isSymbolicLink()) {
    return {
      ok: false,
      status: 'blocked',
      action: 'blocked',
      reason: 'parent-is-symlink',
      linkPath: absLink,
      targetPath: absTarget,
      message: `拒绝迁移：父目录本身是符号链接/联接点（${path.dirname(absLink)}）`,
    };
  }
  const realLink = resolveRealPathOrNull(absLink);
  const realTargetCheck = resolveRealPathOrNull(absTarget);
  if (realLink && realTargetCheck && normRealKey(realLink) === normRealKey(realTargetCheck)) {
    return {
      ok: false,
      status: 'blocked',
      action: 'blocked',
      reason: 'same-realpath-as-target',
      linkPath: absLink,
      targetPath: absTarget,
      message: `拒绝迁移：源路径与目标路径指向同一真实目录（${realLink}），防止搬空同源目录`,
    };
  }

  if (!allowMigrate) {
    return {
      ok: false,
      status: 'blocked',
      action: 'blocked',
      reason: 'physical-dir-exists',
      linkPath: absLink,
      targetPath: absTarget,
      message: `路径已是实体目录而非链接：${absLink}（请传 --force 或使用安装器自动备份迁移）`,
    };
  }

  const defaultBackup = path.join(
    path.dirname(absLink),
    '.runtime',
    `migrated-standalone-${makeMigrationStamp()}`,
    path.basename(absLink),
  );
  const backupPath = migratePhysicalPath(absLink, opts.backupDir || defaultBackup);
  createOsDirLink(absLink, absTarget);
  return {
    ok: true,
    status: 'migrated',
    action: 'migrated',
    linkPath: absLink,
    targetPath: absTarget,
    backupPath,
  };
}

/**
 * Safely remove ONLY an OS symbolic link / NTFS Junction at `linkPath`.
 * NEVER deletes physical directories or recurses into linked `.claude/skills` contents!
 * @param {string} linkPath
 */
export function removeDirLink(linkPath) {
  const absLink = path.resolve(linkPath);
  const lst = safeLstat(absLink);
  if (!lst) {
    return { ok: true, status: 'absent', removed: false, linkPath: absLink };
  }
  if (!lst.isSymbolicLink()) {
    return {
      ok: false,
      status: 'skipped-physical',
      reason: 'physical-dir-exists',
      removed: false,
      linkPath: absLink,
      message: `拒绝删除非符号链接/非联接点的实体路径：${absLink}`,
    };
  }
  unlinkSymlinkOrJunctionSafe(absLink);
  return { ok: true, status: 'removed', removed: true, linkPath: absLink };
}

/**
 * Ensure `<projectRoot>/.cursor/skills -> <projectRoot>/.claude/skills` OS directory link.
 * @param {string} projectRoot
 * @param {{ migrate?: boolean, force?: boolean, migrationStamp?: string }} [opts]
 */
export function ensureSkillsLink(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot);
  const stamp = opts.migrationStamp || makeMigrationStamp();
  const migrateBase = path.join(root, '.cursor', '.runtime', `migrated-standalone-${stamp}`);
  const migrate = opts.migrate !== undefined ? Boolean(opts.migrate) : true;

  const skillsRes = ensureDirLink(
    path.join(root, '.cursor', 'skills'),
    path.join(root, '.claude', 'skills'),
    {
      migrate,
      force: Boolean(opts.force),
      backupDir: migrate ? path.join(migrateBase, 'skills') : undefined,
    },
  );

  return {
    ok: skillsRes.ok,
    skills: skillsRes,
    pendingCcBase: skillsRes.status === 'missing-target',
  };
}

/**
 * Safely remove `<projectRoot>/.cursor/skills` link without touching `.claude/`.
 * @param {string} projectRoot
 */
export function removeSkillsLink(projectRoot) {
  const root = path.resolve(projectRoot);
  return {
    skills: removeDirLink(path.join(root, '.cursor', 'skills')),
  };
}

function runSelftest() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-link-mgr-test-'));
  try {
    const proj = path.join(tmpBase, 'proj');
    const claudeSkills = path.join(proj, '.claude', 'skills');
    const skillAlphaDir = path.join(claudeSkills, 'alpha-skill');
    const skillAlphaFile = path.join(skillAlphaDir, 'SKILL.md');
    const nestedRefFile = path.join(skillAlphaDir, 'references', 'guide.md');
    const cursorSkills = path.join(proj, '.cursor', 'skills');

    fs.mkdirSync(path.dirname(nestedRefFile), { recursive: true });
    fs.writeFileSync(skillAlphaFile, '# Alpha Skill\nCritical target content.\n', 'utf8');
    fs.writeFileSync(nestedRefFile, '# Reference Guide\nMust never be deleted by removeDirLink!\n', 'utf8');

    // 1. Fresh creation
    const r1 = ensureDirLink(cursorSkills, claudeSkills);
    if (!r1.ok || r1.status !== 'created') {
      throw new Error(`step 1 expected created, got ${JSON.stringify(r1)}`);
    }
    if (!fs.lstatSync(cursorSkills).isSymbolicLink()) {
      throw new Error('step 1 linkPath must be a symbolic link / NTFS Junction');
    }
    if (process.platform !== 'win32') {
      const rawTarget = fs.readlinkSync(cursorSkills);
      if (path.isAbsolute(rawTarget) || rawTarget !== '../.claude/skills') {
        throw new Error(`step 1 POSIX symlink must be relative '../.claude/skills', got ${rawTarget}`);
      }
    }
    if (fs.readFileSync(path.join(cursorSkills, 'alpha-skill', 'SKILL.md'), 'utf8') !== '# Alpha Skill\nCritical target content.\n') {
      throw new Error('step 1 reading through link failed');
    }

    // 2. Idempotent repeat -> unchanged
    const r2 = ensureDirLink(cursorSkills, claudeSkills);
    if (!r2.ok || r2.status !== 'unchanged') {
      throw new Error(`step 2 expected unchanged, got ${JSON.stringify(r2)}`);
    }

    // 3. Broken / dangling link -> repaired
    unlinkSymlinkOrJunctionSafe(cursorSkills);
    const deadTarget = path.join(tmpBase, 'nonexistent-target');
    if (process.platform === 'win32') {
      fs.symlinkSync(deadTarget, cursorSkills, 'junction');
    } else {
      fs.symlinkSync('../nonexistent-target', cursorSkills, 'dir');
    }
    const r3 = ensureDirLink(cursorSkills, claudeSkills);
    if (!r3.ok || r3.status !== 'repaired') {
      throw new Error(`step 3 expected repaired on dangling link, got ${JSON.stringify(r3)}`);
    }

    // 4. Stale link pointing to a different existing directory -> repaired
    const oldProjSkills = path.join(tmpBase, 'old-proj', '.claude', 'skills');
    fs.mkdirSync(oldProjSkills, { recursive: true });
    fs.writeFileSync(path.join(oldProjSkills, 'old.txt'), 'old-data', 'utf8');
    unlinkSymlinkOrJunctionSafe(cursorSkills);
    createOsDirLink(cursorSkills, oldProjSkills);
    const r4 = ensureDirLink(cursorSkills, claudeSkills);
    if (!r4.ok || r4.status !== 'repaired') {
      throw new Error(`step 4 expected repaired on moved target, got ${JSON.stringify(r4)}`);
    }
    if (!fs.existsSync(path.join(oldProjSkills, 'old.txt'))) {
      throw new Error('step 4 old target files must remain completely intact');
    }

    // 5. CRITICAL SAFETY LOCK: removeDirLink removes ONLY the link; target files in .claude/skills 100% intact!
    const rem = removeDirLink(cursorSkills);
    if (!rem.ok || !rem.removed) {
      throw new Error(`step 5 expected removed=true, got ${JSON.stringify(rem)}`);
    }
    if (safeLstat(cursorSkills) !== null) {
      throw new Error('step 5 link entry should be gone after removeDirLink');
    }
    if (!fs.existsSync(skillAlphaFile) || !fs.existsSync(nestedRefFile)) {
      throw new Error('CRITICAL FAILURE: removeDirLink deleted files inside target .claude/skills!');
    }
    if (fs.readFileSync(nestedRefFile, 'utf8') !== '# Reference Guide\nMust never be deleted by removeDirLink!\n') {
      throw new Error('CRITICAL FAILURE: target nested file content corrupted!');
    }

    // 6. Physical directory protection without migrate/force -> blocked ('physical-dir-exists') + never deleted by removeDirLink
    fs.mkdirSync(path.join(cursorSkills, 'standalone-skill'), { recursive: true });
    const standaloneMarker = path.join(cursorSkills, 'standalone-skill', 'SKILL.md');
    fs.writeFileSync(standaloneMarker, '# Standalone Skill\n', 'utf8');

    const r6Block = ensureDirLink(cursorSkills, claudeSkills);
    if (r6Block.ok || r6Block.reason !== 'physical-dir-exists') {
      throw new Error(`step 6 expected physical-dir-exists block, got ${JSON.stringify(r6Block)}`);
    }
    const remPhys = removeDirLink(cursorSkills);
    if (remPhys.ok || remPhys.removed || !fs.existsSync(standaloneMarker)) {
      throw new Error('step 6 removeDirLink must refuse to delete physical directory');
    }

    // 7. Smooth migration with { migrate: true } -> backs up standalone dir and creates link!
    const r7Migrate = ensureDirLink(cursorSkills, claudeSkills, { migrate: true });
    if (!r7Migrate.ok || r7Migrate.status !== 'migrated' || !r7Migrate.backupPath) {
      throw new Error(`step 7 expected migrated with backupPath, got ${JSON.stringify(r7Migrate)}`);
    }
    if (!fs.existsSync(path.join(r7Migrate.backupPath, 'standalone-skill', 'SKILL.md'))) {
      throw new Error('step 7 migrated standalone skill must be preserved in backupPath');
    }
    if (!fs.existsSync(path.join(cursorSkills, 'alpha-skill', 'SKILL.md'))) {
      throw new Error('step 7 migrated link must resolve to .claude/skills');
    }

    // 8. Parent-is-symlink guard (F-01: `.cursor -> .claude` symlink must NEVER migrate `.claude/skills`!)
    const projParentSym = path.join(tmpBase, 'proj-parent-sym');
    const pSymClaudeSkills = path.join(projParentSym, '.claude', 'skills');
    const pSymMarker = path.join(pSymClaudeSkills, 'keep', 'SKILL.md');
    fs.mkdirSync(path.dirname(pSymMarker), { recursive: true });
    fs.writeFileSync(pSymMarker, '# Keep Me\n', 'utf8');
    createOsDirLink(path.join(projParentSym, '.cursor'), path.join(projParentSym, '.claude'));
    const r8ParentSym = ensureDirLink(
      path.join(projParentSym, '.cursor', 'skills'),
      pSymClaudeSkills,
      { migrate: true, force: true },
    );
    if (r8ParentSym.ok || r8ParentSym.status !== 'blocked' || r8ParentSym.reason !== 'parent-is-symlink') {
      throw new Error(`step 8 expected parent-is-symlink block, got ${JSON.stringify(r8ParentSym)}`);
    }
    if (!fs.existsSync(pSymMarker) || fs.lstatSync(pSymClaudeSkills).isSymbolicLink()) {
      throw new Error('step 8 CRITICAL: .claude/skills was modified through parent symlink!');
    }

    // 9. Reverse-symlink / same-realpath guard (F-01: `.claude/skills -> ../.cursor/skills` must NEVER vacate `.cursor/skills`!)
    const projRev = path.join(tmpBase, 'proj-rev-sym');
    const revCursorSkills = path.join(projRev, '.cursor', 'skills');
    const revClaudeSkills = path.join(projRev, '.claude', 'skills');
    const revMarker = path.join(revCursorSkills, 'rev-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(revMarker), { recursive: true });
    fs.writeFileSync(revMarker, '# Reverse Skill\n', 'utf8');
    createOsDirLink(revClaudeSkills, revCursorSkills);
    const r9SameReal = ensureDirLink(revCursorSkills, revClaudeSkills, { migrate: true, force: true });
    if (r9SameReal.ok || r9SameReal.status !== 'blocked' || r9SameReal.reason !== 'same-realpath-as-target') {
      throw new Error(`step 9 expected same-realpath-as-target block, got ${JSON.stringify(r9SameReal)}`);
    }
    if (!fs.existsSync(revMarker) || fs.lstatSync(revCursorSkills).isSymbolicLink()) {
      throw new Error('step 9 CRITICAL: same-realpath directory was vacated!');
    }

    // 10. unlinkSymlinkOrJunctionSafe refuses non-symlink physical directories
    let threwOnPhysical = false;
    try {
      unlinkSymlinkOrJunctionSafe(revCursorSkills);
    } catch {
      threwOnPhysical = true;
    }
    if (!threwOnPhysical || !fs.existsSync(revMarker)) {
      throw new Error('step 10 unlinkSymlinkOrJunctionSafe must throw on physical directory without touching it');
    }

    process.stdout.write(JSON.stringify({ ok: true, tests: 10, platform: process.platform }) + '\n');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
    process.exit(0);
  }
  process.stderr.write('usage: node scripts/lib/link-manager.mjs --selftest\n');
  process.exit(2);
}
