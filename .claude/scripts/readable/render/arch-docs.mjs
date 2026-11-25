// arch-docs.mjs —— 现有的架构文档：项目里原有的架构文档与决策记录（配置的 archDocs），照人读版需求规格的办法逐块换排成网页
// （第三期契约 docs/readable-spec/phase3-arch-contract.md D 节末段；规格 REQ-DOC-002）。
// 为什么有它：「为什么这么分层、为什么拒了那个方案」代码里读不出来，只在这些 Markdown 里；接手的人手上只有浏览器，打开 Markdown 是一堆记号。
// 可它们是旧文档：写的时候对应的代码可能已经变了。所以每一页顶上一条横条说明这一点、链回架构首页，不让人把它与首页上从代码里取的事实混起来；
// 它也不是 AI 的说明——页面上一个字不加、一个字不少。
// 分章、块、地址、图、隐去都是需求规格那一套（spec.mjs 的 renderSpec），这里只给这一份特有的：放在 arch/doc-<两位序号>/、
// 文档名（第一个一级标题，没有就取文件名）、从架构首页过来的面包屑、顶上的横条、清单页上称呼它的字、第一份认的注入点 arch-doc-render，
// 以及块的锚点前面那一截 archdoc:<两位序号>/：旧文档里的条目也可能以 [REQ-…] 开头，不接这一截就与需求规格那一份的锚点撞名——
// 往后按锚点把需求关联到页面时，同一个锚点只许指一处（契约 D 节末段）。事实里的锚点不接，页面上的才接。
// 只在有架构这一份时出（入口判断）；架构首页第 7 段的那几行由 renderArch 照这里交回的 row 列出。
import { renderSpec } from './spec.mjs';
import { code } from './layout.mjs';
import { ARCH } from './arch-kit.mjs';
import { redact } from '../sensitive.mjs';

// 第 i 份（照配置里的先后，从 0 起）的两位序号与目录（相对 docs/readable/）。
const nn = (i) => String(i + 1).padStart(2, '0');
export const docDir = (i) => `arch/doc-${nn(i)}`;
// 横条（D 节末段的原话）：不带 data-block，读回页面时不算任何一块的字。页面在 arch/doc-NN/ 下，架构首页是上一级的 index.html。
const banner = (file) => `<div class="notice" role="note"><p>这是 ${code(file)} 的原文，写的时候对应的代码以它自己标的版本为准；现行的结构以<a href="../index.html">架构首页</a>为准。</p></div>`;

// docs：facts.archDocs（每一项与 spec 同一个形状）；title：配置的标题（这里过隐去，同数据库设计那一份的口径）。
// 每一份交回 renderSpec 的结果，外加 row：架构首页第 7 段的一行（文档名、链接、来源的路径、几章、几块，都是隐去过的）。
export function renderArchDocs(docs, { title }) {
  const shown = redact(title).text;
  return docs.map((d, i) => {
    const dir = docDir(i);
    const r = renderSpec(d, { title: shown, doc: { dir, depth: 2, name: null, up: [[ARCH, 'arch/index.html']], what: '文档', banner, inject: i === 0 ? 'arch-doc-render' : null, anchor: `archdoc:${nn(i)}/` } });
    return { ...r, row: { file: r.file, name: r.name, href: `${dir.slice('arch/'.length)}/index.html`, chapters: r.stats.pages, blocks: r.stats.blocks } };
  });
}
