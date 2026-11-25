// publish.mjs —— 把出好的页面落到磁盘（契约 docs/readable-spec/phase1-db-contract.md C 节「原子落盘」：落盘这一步归 render 模块，入口只调用它）。
// 出页面的函数只返回「路径 → 内容」、不碰磁盘，核对器要拿它们在内存里重出一遍来比；碰磁盘的只有这里。
// 测试注入点：READABLE_FAIL_AT=render 时，在写完一半页面时模拟失败。
import { existsSync, writeFileSync, mkdirSync, statSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

export const OUT = 'docs/readable';
const LEFTOVER = /^\.readable-(tmp|old)-\d+$/;

// 上一次落盘被杀（kill -9、断电）留下的残留（契约 H 节末段）：同级的 .readable-tmp-<pid> 是没写完或没换上的新页面，
// .readable-old-<pid> 是挪开了还没删的旧页面。页面目录不在而旧目录还在，说明死在两次改名之间——先把旧目录挪回来
// （有几个就挪最新的那个），读者手里至少还是上一版；其余的删掉。做了什么都在标准错误上说一声，不悄悄动。
function sweep(out, parent) {
  const names = readdirSync(parent).filter((n) => LEFTOVER.test(n)).sort();
  const olds = names.filter((n) => n.startsWith('.readable-old-'))
    .map((n) => ({ n, t: statSync(join(parent, n)).mtimeMs })).sort((a, b) => b.t - a.t || (a.n < b.n ? -1 : 1));
  let back = null;
  if (!existsSync(out) && olds.length) {
    back = olds[0].n;
    renameSync(join(parent, back), out);
    console.error(`readable-docs: ${OUT}/ 不在、上一次落盘留下的旧目录 ${back} 还在，先挪回成 ${OUT}/`);
  }
  for (const n of names) {
    if (n === back) continue;
    rmSync(join(parent, n), { recursive: true, force: true });
    console.error(`readable-docs: 删掉了上一次落盘被打断留下的 ${n}`);
  }
}

// 原子落盘（契约 C 节）：先写到与 docs/readable/ 同级的临时目录，写完从磁盘逐个核对字节数，再整目录换上；
// 任何一步失败，临时目录删掉、原有的 docs/readable/ 一个字节不动，错误往上抛，入口报成退出码 3。
// 换上那一步是两次改名：旧目录先挪开，新目录改名进位，进位失败就把旧目录挪回来。
// files：[{path, html}]，path 相对 docs/readable/。
// verify（可不给）：临时目录写完、核对过字节数、换上之前调一次 verify(临时目录)——入口拿它跑核对的第 2 项（契约 H 节）；
// 它抛错就同落盘失败：临时目录删掉、原有页面不动，错误往上抛。
export function publish(root, files, verify) {
  const out = join(root, OUT), parent = dirname(out);
  const tmp = join(parent, `.readable-tmp-${process.pid}`), old = join(parent, `.readable-old-${process.pid}`);
  const failAt = process.env.READABLE_FAIL_AT === 'render' ? Math.floor(files.length / 2) : -1;
  mkdirSync(parent, { recursive: true });
  sweep(out, parent);
  try {
    files.forEach((f, i) => {
      if (i === failAt) throw new Error(`READABLE_FAIL_AT=render：写完 ${i} / ${files.length} 个页面时按要求模拟失败`);
      const p = join(tmp, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.html);
    });
    for (const f of files) {
      if (statSync(join(tmp, f.path)).size !== Buffer.byteLength(f.html)) throw new Error(`落盘核对不过：${f.path} 的字节数与生成的不同`);
    }
    if (verify) verify(tmp);
    const had = existsSync(out);
    if (had) renameSync(out, old);
    try { renameSync(tmp, out); } catch (e) { if (had) renameSync(old, out); throw e; }
    if (had) {
      // 新目录已经换上，旧目录删不掉不算失败，但要让人看见那个残留。
      try { rmSync(old, { recursive: true, force: true }); } catch (e) { console.error(`readable-docs: 新页面已换上，旧目录没删掉，请手动删：${join(OUT, '..', basename(old))}：${e.message}`); }
    }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
