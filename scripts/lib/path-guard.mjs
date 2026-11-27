#!/usr/bin/env node
// scripts/lib/path-guard.mjs — Windows + POSIX per-segment target path validator for cursor-base.
// Runs BEFORE any mkdir/write so unsafe or non-portable paths fail cleanly with zero filesystem side effects.
// Zero npm dependencies (Node >= 20 built-ins only).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIN_BAD_CHARS = '<>:"|?*';
export const MAX_SEG_BYTES = 255;
export const MAX_SEGS = 64;

export const WIN_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const POSIX_SYSTEM_ROOTS = new Set([
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/bin',
  '/sbin',
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
]);

const WIN_SYSTEM_DIR_RE = /^[A-Za-z]:\/(?:windows|program files|program files \(x86\)|system volume information)(?:\/|$)/i;

// eslint-disable-next-line no-control-regex
const CTRL_CHAR_RE = /[\x00-\x1f\x7f]/;

/**
 * Normalize backslashes to POSIX forward slashes for cross-platform matching.
 * @param {string} p
 * @returns {string}
 */
export function toPosix(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

/**
 * Validate a target directory path segment-by-segment before any mkdir.
 * @param {string} target
 * @returns {{ ok: true } | { ok: false, code: string, segment?: string, message: string }}
 */
export function validateTargetPath(target) {
  if (typeof target !== 'string' || target.length === 0) {
    return { ok: false, code: 'EMPTY_TARGET', message: 'target 目录不能是空串' };
  }
  if (CTRL_CHAR_RE.test(target)) {
    return { ok: false, code: 'CONTROL_CHAR', message: `target 路径含控制字符（${JSON.stringify(target)}）` };
  }
  if (target === '.') {
    return { ok: true };
  }

  let rest = target;
  const hasWinDrivePrefix = /^[A-Za-z]:(?:[\\/]|$)/.test(rest);
  if (rest.startsWith('./') || rest.startsWith('.\\')) {
    rest = rest.slice(2);
    if (rest.length === 0) {
      return { ok: true };
    }
  }

  const rawSegs = rest.split(/[\\/]+/).filter((s) => s.length > 0);
  if (rawSegs.length === 0) {
    return {
      ok: false,
      code: 'ROOT_TARGET',
      message: `target 路径不能直接指向文件系统根目录（${target}）`,
    };
  }
  if (hasWinDrivePrefix && rawSegs.length === 1) {
    return {
      ok: false,
      code: 'DRIVE_ROOT_TARGET',
      message: `target 路径不能直接指向磁盘根目录（${target}）`,
    };
  }
  if (rawSegs.length > MAX_SEGS) {
    return {
      ok: false,
      code: 'TOO_MANY_SEGMENTS',
      message: `target 路径段数过多：${rawSegs.length} 段（上限 ${MAX_SEGS} 段）：${target}`,
    };
  }

  for (let idx = 0; idx < rawSegs.length; idx++) {
    const seg = rawSegs[idx];
    if (idx === 0 && hasWinDrivePrefix && /^[A-Za-z]:$/.test(seg)) {
      continue;
    }
    if (seg === '..') {
      return {
        ok: false,
        code: 'DOT_DOT_SEGMENT',
        segment: seg,
        message: `target 路径不安全：段 '..' 会越界写入目标之外（${target}）`,
      };
    }
    if (seg === '.') {
      return {
        ok: false,
        code: 'DOT_SEGMENT',
        segment: seg,
        message: `target 路径不合法：路径中间出现 '.' 段（${target}）；相对路径只允许前导 ./`,
      };
    }
    if (CTRL_CHAR_RE.test(seg)) {
      return {
        ok: false,
        code: 'CONTROL_CHAR',
        segment: seg,
        message: `target 路径段含控制字符：段 [${seg}]（${target}）`,
      };
    }
    for (const ch of WIN_BAD_CHARS) {
      if (seg.includes(ch)) {
        return {
          ok: false,
          code: 'WIN_BAD_CHAR',
          segment: seg,
          message: `target 路径段含 Windows 非法字符 [${ch}]（禁带 ${WIN_BAD_CHARS}）：段 [${seg}]（${target}）`,
        };
      }
    }
    if (seg.endsWith('.')) {
      return {
        ok: false,
        code: 'TRAILING_DOT',
        segment: seg,
        message: `target 路径段以点结尾（trailing dot，Windows 会静默截断）：段 [${seg}]（${target}）`,
      };
    }
    if (seg.endsWith(' ')) {
      return {
        ok: false,
        code: 'TRAILING_SPACE',
        segment: seg,
        message: `target 路径段以空格结尾（trailing space，Windows 会静默截断）：段 [${seg}]（${target}）`,
      };
    }
    const stem = seg.split('.')[0].trim().toLowerCase();
    if (WIN_RESERVED.has(stem)) {
      return {
        ok: false,
        code: 'WIN_RESERVED_NAME',
        segment: seg,
        message: `target 路径段命中 Windows 保留设备名 [${seg}]（con/prn/aux/nul/com1-9/lpt1-9，含扩展名前缀）：${target}`,
      };
    }
    const byteLen = Buffer.byteLength(seg, 'utf8');
    if (byteLen > MAX_SEG_BYTES) {
      return {
        ok: false,
        code: 'SEGMENT_TOO_LONG',
        segment: seg,
        message: `target 路径单段超长：${byteLen} 字节 > 上限 ${MAX_SEG_BYTES} 字节：段 [${seg.slice(0, 32)}...]`,
      };
    }
  }

  const normPosix = toPosix(target).replace(/\/+$/, '');
  if (WIN_SYSTEM_DIR_RE.test(normPosix)) {
    return {
      ok: false,
      code: 'SYSTEM_DIR_TARGET',
      message: `target 路径不能指向 Windows 系统保护目录（${target}）`,
    };
  }
  if (normPosix.startsWith('/')) {
    for (const sysRoot of POSIX_SYSTEM_ROOTS) {
      if (normPosix === sysRoot || normPosix.startsWith(`${sysRoot}/`)) {
        return {
          ok: false,
          code: 'SYSTEM_DIR_TARGET',
          message: `target 路径不能指向系统保护目录（${target}）`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Assert that a target path is safe; throws an Error with exitCode=2 on failure.
 * @param {string} target
 */
export function assertSafeTargetPath(target) {
  const res = validateTargetPath(target);
  if (!res.ok) {
    const err = new Error(res.message);
    err.code = res.code;
    err.exitCode = 2;
    throw err;
  }
}

function runSelftest() {
  const shouldPass = [
    '.',
    './',
    '.\\',
    './my-app',
    '.\\my-app\\sub',
    '/tmp/cursor-base-target-test',
    'D:\\projects\\demo_app',
    'C:/Users/demo/workspace/app-1',
    'packages/console-ui',
    'aux-helper/prn_service',
  ];
  const shouldFail = [
    ['', 'EMPTY_TARGET'],
    ['/', 'ROOT_TARGET'],
    ['C:\\', 'DRIVE_ROOT_TARGET'],
    ['C:\\Windows\\System32', 'SYSTEM_DIR_TARGET'],
    ['C:/Program Files/MyApp', 'SYSTEM_DIR_TARGET'],
    ['/etc/nginx', 'SYSTEM_DIR_TARGET'],
    ['/proc/self', 'SYSTEM_DIR_TARGET'],
    ['../escape', 'DOT_DOT_SEGMENT'],
    ['a/../../b', 'DOT_DOT_SEGMENT'],
    ['./../b', 'DOT_DOT_SEGMENT'],
    ['a/./b', 'DOT_SEGMENT'],
    ['./.', 'DOT_SEGMENT'],
    ['a/\x07bell/b', 'CONTROL_CHAR'],
    ['a/bad:name/b', 'WIN_BAD_CHAR'],
    ['a/bad*name/b', 'WIN_BAD_CHAR'],
    ['a/bad?name/b', 'WIN_BAD_CHAR'],
    ['a/bad|name/b', 'WIN_BAD_CHAR'],
    ['a/CON/b', 'WIN_RESERVED_NAME'],
    ['a/nul/b', 'WIN_RESERVED_NAME'],
    ['a/Aux/b', 'WIN_RESERVED_NAME'],
    ['a/con.txt/b', 'WIN_RESERVED_NAME'],
    ['a/LPT1.tar.gz/b', 'WIN_RESERVED_NAME'],
    ['a/com9/b', 'WIN_RESERVED_NAME'],
    ['a/trail./b', 'TRAILING_DOT'],
    ['a/trail ', 'TRAILING_SPACE'],
    ['a/' + 'x'.repeat(256), 'SEGMENT_TOO_LONG'],
    [Array.from({ length: 65 }, (_, i) => `s${i}`).join('/'), 'TOO_MANY_SEGMENTS'],
  ];

  const failures = [];
  for (const p of shouldPass) {
    const r = validateTargetPath(p);
    if (!r.ok) failures.push(`expected PASS for ${JSON.stringify(p)}, got ${r.code}: ${r.message}`);
  }
  for (const [p, expectedCode] of shouldFail) {
    const r = validateTargetPath(p);
    if (r.ok) failures.push(`expected FAIL (${expectedCode}) for ${JSON.stringify(p)}, got PASS`);
    else if (r.code !== expectedCode) {
      failures.push(`expected ${expectedCode} for ${JSON.stringify(p)}, got ${r.code} (${r.message})`);
    }
  }
  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`FAIL: ${f}\n`);
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({ ok: true, passed: shouldPass.length + shouldFail.length }) + '\n',
  );
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const arg = process.argv[2];
  if (arg === '--selftest') {
    runSelftest();
  } else if (arg !== undefined) {
    const r = validateTargetPath(arg);
    if (!r.ok) {
      process.stderr.write(`path-guard: ${r.message}\n`);
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ ok: true, target: arg }) + '\n');
  } else {
    process.stderr.write('usage: node scripts/lib/path-guard.mjs <target-path> | --selftest\n');
    process.exit(2);
  }
}
