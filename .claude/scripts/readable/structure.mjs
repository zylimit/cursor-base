// structure.mjs —— 从一张架构首页读回结构的五样（契约 docs/readable-spec/phase1-db-contract.md I 节第 14 条「取结构」，2026-11-24 加）。
// 为什么有它：首页上循环依赖、越层引用、未归属的文件本来就照实列着，可数从 3 变成 4 没有人会去翻页面；
// 提交前那一段拿上一个提交里的首页与刚重出的一张各取一次、比条目，哪次提交把结构弄坏了当场点名。
// 读法与核对器读回页面是同一套：check-read.mjs 的 parse 与 sectionRows（第三期契约 D 节末尾那张表——data-section 里一行一条的 data-row，
// 要读的格子 data-k），不另写一套解析；同核对器一样不 import render/，页面上显示的是什么就读回什么。
// 五样：循环依赖（一组一条，键是 data-row 上的成员 id，空格隔开，照页面上的先后）、越层引用（一对模块一条，键「从 到」），这两样都带文件对数 data-k="pairs"、
// 未归属的文件、超过 1000 行的文件（键是路径）、项目判断里对不上的（只要条数）。各清单按 cmp 排好序。
// 首页上每张清单为空时容器照样在，所以模块清单与这几段缺了、重了都当「读不回」——旧格式的页面、不是架构首页的文件都落在这里，
// 抛 StructureUnreadable，由入口报退出码 2，不猜；越层引用例外：项目判断里没有层时这一段本就不出，没有它就是没有越层引用。
import { cmp } from './model.mjs';
import { parse, sectionRows } from './check-read.mjs';

/** 这一页读不回结构（没有读回标记、段缺了或重了、文件对数不是数）：入口报退出码 2 并带上这句原因。 */
export class StructureUnreadable extends Error {}

const SECTIONS = { modules: '模块清单', cycles: '循环依赖', unassigned: '未归属的文件', big: '超过 1000 行的文件', problems: '项目判断里对不上的', upward: '越层引用' };

/** 一页 HTML 的原文 → { cycles: [{ key, pairs }], upward: [{ key, pairs }], unassigned, big, problems }。 */
export function readStructure(src) {
  const tree = parse(src);
  const rows = (name, optional = false) => {
    const s = sectionRows(tree, name), what = `「${SECTIONS[name]}」这一段（data-section="${name}"）`;
    if (s.sections > 1) throw new StructureUnreadable(`${what}出现了 ${s.sections} 处，读不回`);
    if (!s.sections && !optional) {
      throw new StructureUnreadable(name === 'modules' ? `没有读回标记（${what}不在）：是旧格式的页面，或不是架构首页` : `${what}不在：页面的格式与这个生成器不同，读不回`);
    }
    return s.rows;
  };
  rows('modules');
  const keys = (name) => rows(name).map((r) => r.key).sort(cmp);
  // 循环依赖与越层引用一行带一个文件对数（data-k="pairs"，核对器读回比的也是它），读法相同：读不出数就是读不回，不当 0。
  const paired = (name, optional) => rows(name, optional).map((r) => {
    if (!/^\d+$/.test(r.k.pairs ?? '')) throw new StructureUnreadable(`${SECTIONS[name]}「${r.key}」的文件对数读不出（data-k="pairs" 是「${r.k.pairs ?? '（没有这一格）'}」）`);
    return { key: r.key, pairs: Number(r.k.pairs) };
  }).sort((a, b) => cmp(a.key, b.key));
  return { cycles: paired('cycles'), upward: paired('upward', true), unassigned: keys('unassigned'), big: keys('big'), problems: rows('problems').length };
}

/** 人读的一行；越层引用的数是各对的文件对数之和，与 build 报数行里架构那一行同口径。 */
export const structureLine = (s) => `结构：循环依赖 ${s.cycles.length} 组、越层引用 ${s.upward.reduce((n, u) => n + u.pairs, 0)} 处、未归属的文件 ${s.unassigned.length} 个`
  + `、超过 1000 行的文件 ${s.big.length} 个、项目判断里对不上的 ${s.problems} 条`;
