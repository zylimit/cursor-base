// PreToolUse(Bash)：密钥读取/拷贝/外传闸——把「密钥隐私是安全护栏」做成机器拦截。
// 判据是「参数里有没有密钥路径」，不是「动词是不是读取器」：读取器那张表列不完（tac / paste /
//   jq -R / base64 / sort 都能把 .env 整份吐出来，换个形态就绕过），放行表列得完——所以判据翻过来，
//   任何动词只要参数里有一个密钥路径就拦，只对一张封闭的「只碰元数据、不读内容」表放行。
// 判定顺序：样例名剔除（.env.example/.sample/.template/.dist 属合法）→ wrapper 剥壳 →
//   按 shell 分隔符切成简单命令 → 逐条取动词与参数判。
// 另留两条整命令级规则（形态横跨简单命令，切开就看不见了）：
//   R3 环境变量外传：env/printenv/set 输出管进 curl/wget/nc
//   R3b 网络命令携带密钥文件：curl/wget/nc + 密钥文件名（-F f=@id_rsa 这类粘连形态切词看不出）
// 判据翻面之后又照出两处绕过（TODO #76 二轮 review）：一是动词位本身可以是命令替换——按 $( 与
//   反引号切段后密钥路径会自己坐到动词位上，动词位一向只用来查放行表、没人判它是不是密钥路径，
//   于是漏过去；契约补一句：简单命令的动词位本身就是密钥路径（或整段只剩这一个 token）同样算
//   命中。二是参数 token 带 glob 元字符（* ? [）时不能只按字面比对——.en* / .??v / .* 一律
//   放行、*.pem 却拦得住，命中全看模式串碰巧长得像不像路径；契约补一句：这类 token 当模式看，
//   去试一组列得完的典型密钥名（TYPICAL_SECRET_NAMES），模式命中就算命中。两条都仍是
//   命令行里**字面写出来**的东西，跟下面「代码里拼路径」那条边界不是一回事。
// 三轮 review 又照出 glob 判据本身的两个坑（TODO #76 三轮）：① 原实现用 new RegExp() 把用户写的
//   模式串直接编译成正则，字符类倒序范围（.env[z-a]）会让 RegExp 构造函数抛 SyntaxError，闸没接
//   住，异常冒到最外层 runFailOpen，把整条命令（连同后面真正的 .env）一起静默放行——异常穿透到
//   fail-open 正是这类安全闸最危险的失败模式，兄弟仓 ccb-base 同款「认不出就放行」的闸吃过这个亏
//   （AGY 载荷全放行）。② 拼出来的 [^/]*[^/]*… 形态在长输入上灾难性回溯，一条命令能把 PreToolUse
//   拖死几秒到几十秒。两条根子都是「拿正则引擎当 glob 匹配器用」，所以不再用 RegExp 做 glob：改成
//   线性时间的双指针通配匹配（globMatch，思路同经典 wildcard-matching 题解，* 靠记录回溯点而非枚
//   举展开，复杂度有界为「模式长度 × 候选名长度」，候选名清单里最长的也只有 16 字符，怎么拼都跑
//   不出灾难性回溯）。契约三条：字符类未闭合或范围倒序（[z-a] 这种 from > to）一律把 `[` 当字面
//   字符处理，不构造正则、永不抛异常；单个 token 判不出来就当它未命中、继续判后面的 token
//   （.env[z-a] 判不出不影响它后面那个真 .env 照样被拦）；模式串长度超过 512 不进 glob 分支，按
//   字面判据处理，防止病态输入拖慢 token 化本身。另外，没有任何字面字符的纯通配（*、**、?、*? 这
//   类只由通配符组成的模式）不算命中——它没有指向任何具体密钥名，`for f in *; do …; done` 是常见
//   shell 写法，拦了只会逼人绕开这道闸；`cat *` 读到当前目录里恰好有的密钥属于「目录内容」问题，
//   不归这道判据管，边界在这里声明清楚。
// 四轮 review 又照出判据翻面之后的两处过度拦截（progress.md TODO #78 / #79，SE-62…SE-73）：
//   #78 嵌套引号子串判定原先对所有动词一视同仁，是为了抓解释器载荷（python3 -c "print(open('.env')
//   .read())"），却连 git commit -m "see '.env' later" 这种只是引号里提到文件名的场景也一起拦了。
//   #79 一批只读元数据 / 过滤输出的操作（git ls-files、git check-ignore、git status、git log、
//   管道里的 grep 模式参数）与真正读内容的操作一视同仁，同样被拦。契约收窄三条：① 嵌套引号子串
//   判定只对解释器/求值类动词做（python 系 / node 系 / ruby / perl / php / deno / bun / eval，以及
//   剥壳后仍带 -c 的 sh/bash/zsh/dash），其余动词只判整 token 与 key=value 右值；② 放行表新增
//   「动词+子命令」二级项，目前只有 git（ls-files/check-ignore/status/log 放行，diff/add/show/grep
//   等其余子命令不受影响，照旧按普通 token 判）；③ grep 一族（grep/egrep/fgrep/rg）第一个非选项
//   参数是匹配模式不是路径，跳过它（-e/--regexp 显式给了模式时，后面的位置参数不再被当模式跳过；
//   -f/--file 给的是要读的文件，仍照判）。三条都只收窄「何时判」，不改判据本身，已有拦截用例
//   （SE-19/20 解释器、SE-24 git add、SE-25 diff）一条不受影响。
// 五轮扩：token 形如 X:Y（冒号分隔）时，冒号之后的部分也按密钥路径判——git show HEAD:.env、
//   scp host:.env .、docker cp ctr:/app/.env . 这类形态密钥路径不带斜杠前缀、跟在冒号后面，原先
//   的 SECRET_PATH 只认斜杠收尾的前缀，冒号形态漏判。这条同样只在动词没被放行表放过时才会走到
//   （放行表已经过滤掉的命令，参数里出现冒号也无所谓）。URL 例外：冒号后紧跟 // 的不算（http://
//   这类 scheme 分隔符，不是「冒号后跟文件名」的形态），否则每一条 curl/wget 的 URL 参数都会被
//   误判。
// 六轮扩（progress.md TODO #83，#78/#79 收口之后又一轮 review 照出的六条，三条本轮回归、
//   两条预存在、一条潜伏，探针实测非猜测）：
//   H1 git log 的放行是无条件的，没看参数——`git log -p .env` 照样连内容一起打印，却因为
//   子命令名是 log 被二级放行表直接放过。契约收窄：`git log` 放行附加条件，参数里出现
//   -p / --patch / -u / -L… / -G… / -S… / --full-diff 任一个（带内容的选项）就不算只读元数据，
//   退回普通 token 判据；纯 `-- pathspec` 形态（SE-67/75 已锁）不受影响。
//   H2 #79 把 git ls-files / status 等放进放行表后，管道下游用 xargs 把这条「只读元数据」的
//   输出转发给读内容的命令，两段各自独立判定，都不认识对方——`git ls-files -z .env |
//   xargs -0 cat` 前段摸不到 .env 之外的东西、后段 xargs -0 cat 里没有任何一个 token 字面是
//   密钥路径，rc 0。契约新增管道级规则：`|`（非 `||`）连出的一条链里，前面某段出现过密钥路径
//   token 之后，后面任一段的动词若是 xargs / parallel，且它转发的内嵌命令词（非选项 token）
//   有一个不在放行表里，整条按拦；纯读 stdin、段内没有别的命令词的（`| wc -l`）不触发——拦的
//   是「转发/夹带别的命令」，不是见管道就拦。`;` / `&&` 不算管道，不做这层「前后」判断。
//   H3 grep 一族「第一个非选项参数是模式」的规则没认 `--`（选项终止符）：`grep -- -x .env`
//   里 `-x` 本该是 `--` 之后的第一个位置参数（模式本身），却先被当成「以 - 开头的选项」塞进
//   待判列表，真正吃掉「首个非选项参数」名额的变成 `.env`，等于把要判的文件参数错当模式放过。
//   契约：遇到 `--`（且此前没有已经由 -e/--regexp 显式给出模式）时，其后第一个 token 才是
//   模式（跳过不判），其余全部当文件按路径判；`--` 之前的 -e/--regexp/-f/--file 规则不变。
//   H4 stripWrappers 的收尾引号剥离（`/["']$/`）原来对每一轮都无条件跑一次，跟这一轮到底有
//   没有剥掉开头的 `sh -c "` 完全脱钩——`node app.js --config "x '.env'"` 这种参数里本来就带
//   一对收尾引号的普通命令，收尾会被裸剥掉，剥完内层引号残缺不闭合，#78 嵌套引号配对判据找不到
//   收尾引号而失手，等于把解释器载荷那道防线也一起带崩了。契约：收尾引号只在同一轮刚剥掉了
//   开头 `sh -c "`（或 `'`）时才剥，且只剥与开头同一种引号字符的那一个；没剥开头就不动收尾。
//   H5 ssh / su -c / sudo / timeout / watch / nohup / xargs，以及 docker exec / docker run /
//   kubectl exec / podman exec 这类「把一整段引号参数当另一条命令去执行」的载体，原来没有
//   任何专门处理——载体的引号参数被当成一个不透明字符串 token 判字面/glob/冒号，`ssh host
//   'cat .env'` 去引号后是带空格的「cat .env」，对不上任何判据，rc 0。契约：这些动词（含
//   两级子命令）的引号参数整段去引号后当一条完整命令递归判（走 scanSegments，含放行表判定、
//   深度上限照旧封顶 3 层）——`ssh host 'ls -la .env'` 里内层动词 ls 在放行表里，重扫后仍放行，
//   不是「见引号就无脑拦」。不带引号、`--` 之后直接跟命令的形态（`kubectl exec pod -- cat
//   .env`）本来就会撞上既有的裸 token 判据，不需要这条载体逻辑额外处理。
//   M1 SHELL_C_VERBS 判「有没有 -c」原来是整条命令任意位置扫一遍，`bash deploy.sh -c "see
//   '.env'"` 里 `-c` 是 deploy.sh 自己的位置参数，不是 bash 的求值标志，却被当成后者点亮嵌套
//   引号扫描（这条本身因 H4 的收尾裸剥连带失手才现状放行，H4 单独修好会翻红）。契约：`-c`
//   必须紧跟在 sh/bash/zsh/dash 动词之后，中间只许 -l/-e/-x 这类单字母选项簇（含合并写法
//   -lc），一旦遇到看起来不是单字母簇的 token（如脚本名 deploy.sh）就不再算数。
//   六条都只收窄/补齐「什么时候判、判多深」，不改判据本身；已有拦截用例（SE-14…SE-73 等）一条
//   不许变绿，SE-74…SE-87 锁住这六条的新行为与对应控制组。
// 七轮扩（H6/H7，reviewer 探针实测六条 H6 形态 + 两条 H7 形态全部 rc=0）：
//   H6 shell 的 -c 求值形态中间夹了别的选项就漏判——stripWrappers 的 SHELL_C_PREFIX 只认 -c/-lc
//   紧跟在 sh/bash/zsh/dash 之后，`bash -x -c "cat .env"` 里 -x 单独占一个 token，剥不动这层壳；
//   isNestedQuoteVerb 虽然已经把它判成求值形态，但喂给的是「token 内还嵌一层引号」的扫描——
//   `"cat .env"` 只有外层这一层引号，.env 是这层引号内的裸词，不是被内层引号包住的子串，扫描永远
//   找不到。eval 在 INTERPRETER_VERBS 里，`eval "cat .env"` 撞的是同一个结构性缺口。契约：shell
//   -c（sh/bash/zsh/dash/ksh）与 eval 不再指望嵌套引号扫描，改走 H5 那套「载体：引号参数当命令
//   递归重扫」——shellCPayloadIndex 认 -c 是否紧跟在动词之后（中间只许 - 开头的短选项串如 -x/-xe，
//   或 -o 接一个值），认到了才把 -c 后面那个 token 交给 carrierHits 递归重扫；认不到（如 `bash
//   deploy.sh -c "…"`，deploy.sh 先占住了「第一个非选项 token」的位置，-c 判给脚本自己）就不算数，
//   M1 的控制组仍放行——这条判据只收窄「shell -c 算不算求值形态」，不碰 M1 本身。eval 的参数就是
//   待求值的命令本身，不需要判 -c 位置，直接并进 SINGLE_CARRIER_VERBS，跟 ssh/sudo 同一套。
//   H7 parallel 只进了 H2 管道洗白判据（laterSegmentTriggersBlock）里，没进 SINGLE_CARRIER_VERBS，
//   `parallel 'cat .env'` 这种「密钥只出现在被引号包住的单一参数里」的形态两张表都够不着。契约：
//   parallel 补进 SINGLE_CARRIER_VERBS（同 xargs 早就两头都占一样），走引号参数递归重扫；H2 那条
//   判据不动，两条规则各管各的形态。
// 边界：只对命令行里**字面出现**的密钥路径负责。把路径在代码里拼出来的读法（chr() 拼、变量拼接、
//   $(printf …) 现生成）hook 层原理上拦不住——那一层的防线在人不在闸，别以为这里绿了就没漏。
// wrapper 剥壳：剥 sudo/nohup/nice/timeout/env 前缀与 bash -c 引号壳再判——套壳绕闸是已知逃逸
//   路径（借鉴 codex-base v3），剥出新形态就按新形态重切一遍。
// 本闸属安全护栏，是地板闸（profile.floor）：任何档位都放行不了（放水不放安全），所以这里根本不问档位。
// 输入解析不出命令时降级放行（与 dangerous-pkill-guard 同一取舍——无解析能力时不误伤正常命令）。
import { readStdinJson, say, runFailOpen } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';

// 密钥文件名集合（.pem/.ppk 任意路径命中；.env 尾界防误伤 .env2/.envoy 之类）
const SECRET_NAMES = "\\.env(\\.[A-Za-z0-9_-]+)?|id_rsa[A-Za-z0-9_.-]*|id_ed25519[A-Za-z0-9_.-]*|\\S*\\.(pem|ppk)|credentials\\.json|\\.aws/credentials|\\.ssh/\\S+";
// 整命令级规则用：命中后以空白/引号/行尾收边
const SECRET_CORE = `(${SECRET_NAMES})([\\s"']|$)`;
// 单个 token 用：整段就是一个密钥路径，可带任意目录前缀与 ~（./config/.env.production、~/.aws/credentials）
const SECRET_PATH = new RegExp(`^([^\\s"']*/)?(${SECRET_NAMES})$`);
// glob 判据用：典型密钥名固定清单——像放行表一样列得完，不像「还有哪些命令能读文件」那张表。
// token 里带 * ? [ 时当模式看，用线性时间的 globMatch（见下）逐个试这份清单，match 到一个就算命中。
// credentials.json 不进这份候选：*.json 是开发里最常见的通配（grep --include=*.json、jq . *.json、
// prettier 这类工具链天天用），把它放进候选会让 --include=*.json 的 = 右值被当模式碰上、逼人绕闸；
// key.pem / key.ppk 留着是因为 pem / ppk 几乎只用于密钥证书，没有这种高频误伤。字面 credentials.json
// 不受影响，仍由 SECRET_PATH（SECRET_NAMES）按原样拦。
const TYPICAL_SECRET_NAMES = [
  '.env', '.env.local', 'id_rsa', 'id_ed25519', 'key.pem', 'key.ppk',
  '.aws/credentials', '.ssh/id_rsa',
];
// 参数区前缀：动词后紧跟（空格即边界）或经任意参数后以空格/斜杠/引号/=/@ 为前界——两种都算命中
const ARGPFX = "\\s+([^|;&]*[\\s/\"'=@])?";
// 命令锚定（起始或 ; && || ` $( 之后）
const ANCHOR = '(^|;|&&|\\|\\||`|\\$\\()\\s*';

// 一律带 m：底本 grep 是逐行判定，命令换行后的第二条同样要被 ^ 锚到（少了它多行命令能绕过）。
const RULES = [
  { re: new RegExp(`${ANCHOR}(env|printenv|set)\\b[^|]*\\|\\s*(curl|wget|nc)\\b`, 'm'),
    reason: '检测到环境变量整包管道外传（env/printenv | curl/wget/nc）' },
  { re: new RegExp(`${ANCHOR}(curl|wget|nc)${ARGPFX}${SECRET_CORE}`, 'm'),
    reason: '检测到网络命令携带密钥文件（curl/wget/nc + 密钥文件名）' },
];

const ARG_REASON = '检测到命令参数是密钥文件路径（.env/id_rsa/*.pem/credentials），动词又不在只碰元数据的放行表里';

// 只碰元数据、不读内容的动词——放行表是封闭集合、列得完，这是判据翻面的前提。
// echo / printf 敢进来是因为它们从不打开路径：`echo $(tac .env)` 里真读密钥的那条由 $( 自己切出来受判。
// find 只列文件名、不读内容，敢进来同理；`find -exec cat {}` 本来就在「路径拼出来」那条免责
// 边界外（{} 是 find 求值时现生成的参数，不是命令行里字面写出来的密钥路径），加不加 find 都拦不住
// 那种写法，所以加它不新开口子。
const METADATA_VERBS = new Set([
  'ls', 'stat', 'test', '[', '[[', 'file', 'du', 'chmod', 'chown', 'chgrp',
  'rm', 'unlink', 'touch', 'mkdir', 'rmdir', 'cd', 'pushd', 'popd',
  'basename', 'dirname', 'realpath', 'readlink', 'which', 'echo', 'printf', 'find',
]);

// 「动词+子命令」二级放行表（TODO #79）：git 的这几个子命令只读元数据/索引/历史，不读工作区文件
// 内容——ls-files 读索引、check-ignore 只判是否被忽略、status/log 读提交与状态摘要。diff / add /
// show / grep 等其余子命令会把文件内容摆上台面（diff 打印内容、add 暂存内容、show 能打印任意版本
// 的文件），不放行，仍按下面的普通 token 判据走。只放 git 一家：其余版本控制/工具的子命令表现不
// 一样，没有实测依据前不类推。
const GIT_METADATA_SUBCOMMANDS = new Set(['ls-files', 'check-ignore', 'status', 'log']);

// git log 的放行是有条件的（H1）：-p/--patch/-u 打印全量差异、-L 打印指定行范围的历史演变、
// -G/-S 的 pickaxe 搜索会把命中提交的差异一起打出来、--full-diff 强制带全量 diff——这几个
// 选项一出现，log 就不再是「只读提交摘要」，得退回普通 token 判据（参数里的密钥路径照样按
// SE-74 拦）。只匹配选项本身的前缀：`-L1,10:file` / `-L 1,10:file` 两种写法、`-Gpattern` /
// `-G pattern` 两种写法都命中，`--oneline` `--` 这类不含这几个字母组合的选项不会被误伤。
const GIT_LOG_CONTENT_FLAGS = /^(-p|--patch|-u|-L|-G|-S|--full-diff)/;

function gitLogHasContentFlag(tokens, subIdx) {
  for (let i = subIdx + 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/["']/g, '');
    if (GIT_LOG_CONTENT_FLAGS.test(bare)) return true;
  }
  return false;
}

// 嵌套引号子串判定只对这些「解释器/求值类」动词生效（TODO #78）——它们的参数常常是一整段待求值
// 的代码，密钥路径会被代码自己的字符串字面量包一层引号（python3 -c "print(open('.env').read())"）。
// 其余动词的引号只是自然语言或提交信息的一部分（git commit -m "see '.env' later"），不该被当成
// 代码字面量去扫。
const INTERPRETER_VERBS = new Set([
  'python', 'python2', 'python3', 'node', 'nodejs', 'ruby', 'perl', 'php', 'deno', 'bun', 'eval',
]);
// sh/bash/zsh/dash/ksh 单独出现时不算解释器动词（普通 shell 脚本没有这个问题），只有带 -c 的求值
// 形态才算——这是 wrapper 剥壳没能完全拆开时的兜底（剥壳失败的畸形/嵌套壳层，正常情况下
// stripWrappers 已经把简单的 sh/bash -c 拆成里层命令，动词根本轮不到 sh/bash 自己）。ksh 是 H6
// 补的：契约原文把它跟 sh/bash/zsh/dash 并列成一组。
const SHELL_C_VERBS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

// shell 的 -c 是否紧跟在动词之后（H6，M1 控制组的判据）：中间只许 - 开头的短选项串（-x/-e/-xe
// 这类合并写法）或 -o 接一个值（-o pipefail，bash/sh 里 -o 是取值选项，值单独占一个 token）；
// 一遇到第一个不是这两种形态的 token（脚本名、位置参数……）就不再算数，返回 -1——这正是
// `bash deploy.sh -c "see '.env'"`（M1）该放行的原因：deploy.sh 先占住了「第一个非选项 token」
// 的位置，-c 判给脚本自己，不是 shell 的求值 flag。认到 -c 时返回它后面那个 token 的下标（真正
// 要交给 carrierHits 递归重扫的载体参数）；-c 后面没有 token（`bash -c` 光秃秃收尾）同样返回 -1，
// 不当命中处理，避免对着不存在的参数瞎判。
function shellCPayloadIndex(verb, tokens, vi) {
  if (!SHELL_C_VERBS.has(verb)) return -1;
  let i = vi + 1;
  while (i < tokens.length) {
    const bare = tokens[i].replace(/["']/g, '');
    if (bare === '-c') return i + 1 < tokens.length ? i + 1 : -1;
    if (bare === '-o') { i += 2; continue; }
    if (/^-[A-Za-z]+$/.test(bare)) {
      if (bare.includes('c')) return i + 1 < tokens.length ? i + 1 : -1;
      i += 1;
      continue;
    }
    return -1;
  }
  return -1;
}

// ssh / su -c / sudo / timeout / watch / nohup / xargs / parallel / eval：把一段引号参数当另一条
// 命令去执行的「命令载体」动词（H5，H7 补 parallel，H6 补 eval）。单级——引号参数直接就是要执行的
// 命令；su 只有带 -c 才算（同 SHELL_C_VERBS 的道理，单纯 `su someuser` 不触发）。parallel 只补这
// 一处——H2 管道洗白判据（laterSegmentTriggersBlock）里已有的 parallel 处理不受影响，跟 xargs 一样
// 两张表都占，各管各的形态。eval 的参数就是待求值的命令本身，不像 python -c 那样需要在引号里再嵌
// 一层字符串字面量去扫，直接当载体参数递归重扫最直接；eval 仍留在 INTERPRETER_VERBS 里给嵌套引号
// 扫描兜底，两条路径互不冲突。
const SINGLE_CARRIER_VERBS = new Set(['ssh', 'sudo', 'timeout', 'watch', 'nohup', 'xargs', 'parallel', 'eval']);

// docker exec / docker run / kubectl exec / podman exec：二级命令载体（H5）——动词 + 紧跟的
// 子命令都对上才算，docker build / docker ps 这类不涉及「把参数当命令执行」的子命令不放这里。
const TWO_LEVEL_CARRIER_SUBS = {
  docker: new Set(['exec', 'run']),
  kubectl: new Set(['exec']),
  podman: new Set(['exec']),
};

// grep 一族：第一个非选项参数是匹配模式，不是路径（TODO #79）。
const GREP_VERBS = new Set(['grep', 'egrep', 'fgrep', 'rg']);

// 剔除合法样例文件名，再做密钥判定（.env.example 等不当密钥算）
function stripExamples(s) {
  return s.replace(/\.env\.(example|sample|template|dist)[A-Za-z0-9_.-]*/g, '');
}

// wrapper 剥壳：迭代剥 sudo/nohup/nice/timeout/env 前缀（上限 5 层）。sh -c 引号壳单独处理，
// 见下面的 SHELL_C_PREFIX（H4）。
const PREFIX_WRAPPERS = [
  /^\s+/,
  /^sudo\s+/,
  /^nohup\s+/,
  /^nice(\s+-n\s*[0-9]+)?\s+/,
  /^timeout(\s+--?[A-Za-z-]+(\s+\S+)?)*\s+[0-9]+[smhd]?\s+/,
  /^env(\s+[A-Za-z_][A-Za-z0-9_]*=\S*)*\s+/,
];

// sh -c 引号壳的开头（H4）：捕获用的是哪种引号（第 2 组），好在剥完壳之后只去掉同一种收尾引号。
const SHELL_C_PREFIX = /^(ba|z|da)?sh\s+-l?c\s+(["'])/;

function stripWrappers(cmd) {
  let c = cmd;
  let prev = null;
  for (let i = 0; i < 5 && c !== prev; i += 1) {
    prev = c;
    for (const re of PREFIX_WRAPPERS) c = c.replace(re, '');
    // sh -c 引号壳：原实现把「剥收尾引号」放进上面那张表、每轮无条件跑一次，跟这一轮到底有没有
    // 剥掉开头的 `sh -c "` 完全脱钩——`node app.js --config "x '.env'"` 这种参数里本来就带一对
    // 收尾引号的普通命令，收尾会被裸剥掉，剥完内层引号残缺不闭合，嵌套引号配对判据（tokenHits
    // 的 scanNested 分支）找不到收尾引号而失手（H4，SE-81）。契约：收尾引号只在同一轮刚剥掉了
    // 开头 `sh -c "`（或 `'`）时才剥，且只剥与开头同一种引号字符的那一个；没剥开头就不动收尾。
    const m = SHELL_C_PREFIX.exec(c);
    if (m) {
      const q = m[2];
      c = c.slice(m[0].length);
      if (c.endsWith(q)) c = c.slice(0, -1);
    }
  }
  return c;
}

// 按 shell 分隔符（; & | 换行 反引号 $( ) ）切成简单命令。全程带引号状态：引号里的分隔符不算
// 分隔符，`echo "cat .env"` 切不出第二条命令，照契约该放行。
function splitSimple(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === '$' && cmd[i + 1] === '(') {
      out.push(cur); cur = ''; i += 1;
    } else if (/[;&|\n`()]/.test(ch)) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// 按引号切词。引号原样留在 token 里：嵌套那一层后面还要看（解释器 -c 一族的密钥藏在里层引号）。
function splitTokens(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// glob 模式长度上限：超过这个长度不进 glob 分支，按字面判据处理——候选名清单里最长的都只有
// 16 字符，没有任何一条真实密钥路径需要写这么长的模式，超长多半是病态/恶意输入，直接跳过更安全。
const GLOB_PATTERN_MAX = 512;

/**
 * 解析 `[` 之后的一个字符类：start 指向 `[` 之后的第一个字符。
 * 支持 `!`/`^` 取反、单字符项与 `a-z` 范围项。解析不出合法字符类（未闭合、或范围倒序如
 * `z-a`）一律返回 null，交给调用方把 `[` 当字面字符处理——绝不构造正则、绝不抛异常。
 * @returns {{matcher: (ch: string) => boolean, next: number} | null}
 */
function parseCharClass(pattern, start) {
  let i = start;
  let negate = false;
  if (pattern[i] === '!' || pattern[i] === '^') { negate = true; i += 1; }
  const items = [];
  while (i < pattern.length && pattern[i] !== ']') {
    const ch = pattern[i];
    if (pattern[i + 1] === '-' && i + 2 < pattern.length && pattern[i + 2] !== ']') {
      const from = ch;
      const to = pattern[i + 2];
      if (from.charCodeAt(0) > to.charCodeAt(0)) return null; // 倒序范围，[ 当字面字符
      items.push({ from, to });
      i += 3;
    } else {
      items.push({ from: ch, to: ch });
      i += 1;
    }
  }
  if (i >= pattern.length) return null; // 未闭合
  const matcher = (c) => {
    const hit = items.some((it) => c >= it.from && c <= it.to);
    return negate ? !hit : hit;
  };
  return { matcher, next: i + 1 };
}

// 模式串切成 token 序列：字面字符 lit / 单字符通配 any（?）/ 任意片段 star（*）/ 字符类 class（[...]）。
// 字符类解析失败时把 [ 降级成 lit，紧跟其后的字符从下一轮重新切——不消耗、不报错、不猜。
function tokenizeGlob(pattern) {
  const tokens = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') { tokens.push({ t: 'star' }); i += 1; }
    else if (ch === '?') { tokens.push({ t: 'any' }); i += 1; }
    else if (ch === '[') {
      const cls = parseCharClass(pattern, i + 1);
      if (cls) { tokens.push({ t: 'class', matcher: cls.matcher }); i = cls.next; }
      else { tokens.push({ t: 'lit', ch: '[' }); i += 1; }
    } else { tokens.push({ t: 'lit', ch }); i += 1; }
  }
  return tokens;
}

function tokenMatchesChar(tok, ch) {
  if (tok.t === 'lit') return tok.ch === ch;
  if (tok.t === 'any') return true;
  if (tok.t === 'class') return tok.matcher(ch);
  return false; // star 不在这里判，由 globMatch 单独处理
}

/**
 * 线性时间通配匹配：经典双指针算法（wildcard-matching 题解同款）—— `*` 只记录一个回溯点
 * （starTi/starSi），不枚举展开成多条正则分支，复杂度有界为 O(模式 token 数 × 候选名长度)，
 * 候选名最长 16 字符，无论模式多长都不会出现正则那种指数级回溯。
 */
function globMatch(tokens, text) {
  let ti = 0;
  let si = 0;
  let starTi = -1;
  let starSi = -1;
  const n = tokens.length;
  const m = text.length;
  while (si < m) {
    if (ti < n && tokens[ti].t === 'star') {
      starTi = ti; starSi = si; ti += 1;
    } else if (ti < n && tokenMatchesChar(tokens[ti], text[si])) {
      ti += 1; si += 1;
    } else if (starTi !== -1) {
      ti = starTi + 1; starSi += 1; si = starSi;
    } else {
      return false;
    }
  }
  while (ti < n && tokens[ti].t === 'star') ti += 1;
  return ti === n;
}

// token 含 glob 元字符时才当模式看，试 TYPICAL_SECRET_NAMES 那份列得完的清单——没有元字符的
// 普通字符串不进这条分支，交给上面的字面判据（SECRET_PATH）去管。两道防线都判不出来就是未命中，
// 从不抛异常：解析不出的字符类降级成字面字符、模式串超长直接跳过、纯通配（没有 lit/class token，
// 只有 star/any）不算命中——它没有指向任何具体密钥名（* 单独一个字符会命中放行表里的 ls/echo
// 这类命令，不该被这道判据拦，见文件头「纯通配」边界说明）。整模式匹配之外再补一道文件名部分
// 匹配：带目录前缀的模式（./config/.en*）整模式对不上任何典型名，字面判据 SECRET_PATH 本就带
// 前缀剥离能力，这里让通配判据补齐同样的口径（SE-26 字面已拦、SE-56b 通配翻面不许漏），否则同
// 一个路径换成 glob 写法就能绕过去。
function globHits(bare) {
  if (!/[*?[]/.test(bare)) return false;
  if (bare.length > GLOB_PATTERN_MAX) return false;
  const tokens = tokenizeGlob(bare);
  if (tokens.some((t) => t.t === 'lit' || t.t === 'class') &&
      TYPICAL_SECRET_NAMES.some((name) => globMatch(tokens, name))) return true;
  const slash = bare.lastIndexOf('/');
  if (slash === -1) return false;
  const filename = bare.slice(slash + 1);
  const fnTokens = tokenizeGlob(filename);
  if (!fnTokens.some((t) => t.t === 'lit' || t.t === 'class')) return false;
  return TYPICAL_SECRET_NAMES.some((name) => globMatch(fnTokens, name.slice(name.lastIndexOf('/') + 1)));
}

// 冒号后缀判据（五轮扩，锁 SE-69）：token 形如 X:Y 时，最后一个冒号之后的部分单独再按密钥路径判
// 一次——git show HEAD:.env、scp host:.env .、docker cp ctr:/app/.env . 这类形态密钥路径不带斜杠
// 前缀、跟在冒号后面，SECRET_PATH 的前缀分组只认斜杠收尾，原样测整个 token 测不出来。排除 URL：
// 冒号后紧跟 // 的是 scheme 分隔符（http://…），不是「冒号后跟文件名」的形态，否则每条 curl 的
// URL 参数都会被误判。
function colonSuffixHits(bare) {
  const idx = bare.lastIndexOf(':');
  if (idx === -1) return false;
  if (bare.slice(idx + 1, idx + 3) === '//') return false;
  const suffix = bare.slice(idx + 1);
  if (!suffix) return false;
  return SECRET_PATH.test(suffix) || globHits(suffix);
}

// 一个参数 token 算不算密钥路径：整体去引号后是（cat ".env"）；key=value 的右值是（dd if=.env）；
// 冒号后缀是（git show HEAD:.env）；或整体/右值含 glob 元字符、展开后落得到典型密钥名上（tac .en*、
// cp id_rsa*）；scanNested 为真时再多判一层——token 里嵌着一层引号、被引的子串整个是密钥路径
// （python3 -c "print(open('.env').read())"），只对解释器/求值类动词打开这层（TODO #78：其余
// 动词的嵌套引号只是自然语言，不该被当代码字面量扫）。重定向符号不属于路径，先剥掉——
// `node app.js < .env` 里那个路径同样算参数。
function tokenHits(raw, scanNested) {
  const t = raw.replace(/^<{1,3}/, '');
  const bare = t.replace(/["']/g, '');
  if (SECRET_PATH.test(bare) || globHits(bare) || colonSuffixHits(bare)) return true;
  const eq = bare.indexOf('=');
  if (eq > 0) {
    const val = bare.slice(eq + 1);
    if (SECRET_PATH.test(val) || globHits(val)) return true;
  }
  if (!scanNested) return false;
  const quoted = t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0];
  const inner = quoted ? t.slice(1, -1) : t;
  for (const m of inner.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const s = m[1] === undefined ? m[2] : m[1];
    if (SECRET_PATH.test(s) || globHits(s)) return true;
  }
  return false;
}

// 动词是否属于「解释器/求值类」，决定要不要打开嵌套引号扫描（TODO #78）：INTERPRETER_VERBS 里的
// 动词直接算；sh/bash/zsh/dash/ksh 只有 -c 紧跟在动词之后（求值形态）才算（M1）——不是整条命令
// 任意位置出现 -c 就算，否则 `bash deploy.sh -c "…"` 里 deploy.sh 自己的位置参数 -c 会被误认成
// bash 自己的求值 flag，判据复用 shellCPayloadIndex（H6 与 M1 共用同一套「-c 是否紧跟动词」逻辑，
// 不再各写一份）。这条只是 wrapper 剥壳没能拆开、也没撞上 H6 载体重扫路径时的兜底（正常情况下
// stripWrappers 早就把简单的 -c 壳拆掉了，走不到这里；夹了别的选项的 -c 壳由 isCommandCarrier
// 接住，两条路径都判「未命中」时才轮到这里返回 false）。
function isNestedQuoteVerb(verb, tokens, vi) {
  if (INTERPRETER_VERBS.has(verb)) return true;
  return shellCPayloadIndex(verb, tokens, vi) !== -1;
}

// 取 git 动词之后第一个非选项 token 的位置（TODO #79，H1 扩为返回位置而非值，好接着往后找
// 内容型选项）——选项（以 - 开头，如 --porcelain）跳过，第一个不以 - 开头的 token 位置就是
// 子命令本身；找不到返回 -1。
function gitSubcommandIndex(tokens, vi) {
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/["']/g, '');
    if (!bare.startsWith('-')) return i;
  }
  return -1;
}

// 动词是否整条放行：METADATA_VERBS 原样查表；git 额外查「动词+子命令」二级放行表（TODO #79），
// 只放行只读元数据的那几个子命令，diff/add/show/grep 等其余子命令仍要往下走普通 token 判据；
// log 再多一层条件（H1）——带上内容型选项（-p 等）就不再算只读，退回普通 token 判据。
function isAllowedVerb(verb, tokens, vi) {
  if (METADATA_VERBS.has(verb)) return true;
  if (verb === 'git') {
    const subIdx = gitSubcommandIndex(tokens, vi);
    if (subIdx === -1) return false;
    const sub = tokens[subIdx].replace(/["']/g, '');
    if (!GIT_METADATA_SUBCOMMANDS.has(sub)) return false;
    if (sub === 'log' && gitLogHasContentFlag(tokens, subIdx)) return false;
    return true;
  }
  return false;
}

// grep 一族：把「第一个非选项参数是匹配模式」这条从待判 token 列表里摘掉（TODO #79）。
// -e PAT / --regexp=PAT 显式给了模式，值本身不判、也不再把后面的第一个位置参数当模式跳过；
// -f FILE / --file=FILE 的 FILE 是要读的文件——见到 -f/--file 就把 patternHandled 置真，防止
// 紧跟其后的 FILE 被当成「待跳过的模式」而漏判，FILE 本身仍走正常 token 判据（--file=FILE 形态
// 靠 tokenHits 里的 key=value 右值判据接住，不需要在这里特殊处理）。
function grepTokensToCheck(tokens, vi) {
  const toCheck = [];
  let patternHandled = false;
  let optionsEnded = false;
  let i = vi + 1;
  while (i < tokens.length) {
    const raw = tokens[i];
    const bare = raw.replace(/["']/g, '');
    // grep 认 --（选项终止符，H3）：其后第一个 token 才是模式（若此前没有
    // 已经由 -e/--regexp 显式给出模式），其余全按文件参数走路径判——原实现没认这个符号，
    // `--` 自己先被 startsWith('-') 当成选项塞进待判列表，真正吃掉「首个非选项参数」名额的
    // 变成 `--` 之后的第一个真参数，等于把要判的文件参数错当模式放过（SE-79）。-- 之后不再
    // 识别 -e/-f 这类选项（grep 语义上它们此时也已经是位置参数，不是选项）。
    if (!optionsEnded && bare === '--') {
      optionsEnded = true;
      i += 1;
      if (!patternHandled && i < tokens.length) {
        patternHandled = true; // -- 之后第一个 token 是模式，跳过不判
        i += 1;
      }
      continue;
    }
    if (!optionsEnded && (bare === '-e' || bare === '--regexp')) {
      patternHandled = true;
      i += 2; // 跳过 flag 本身与它的模式值
      continue;
    }
    if (!optionsEnded && /^--regexp=/.test(bare)) {
      patternHandled = true;
      i += 1; // 模式内联在这个 token 里，整个跳过
      continue;
    }
    if (!optionsEnded && (bare === '-f' || bare === '--file')) {
      patternHandled = true; // 防止紧跟的 FILE 被当成待跳过的模式
      toCheck.push(raw);
      i += 1;
      continue;
    }
    if (!optionsEnded && bare.startsWith('-')) {
      toCheck.push(raw);
      i += 1;
      continue;
    }
    if (!patternHandled) {
      patternHandled = true; // 第一个非选项位置参数就是模式，跳过不判
      i += 1;
      continue;
    }
    toCheck.push(raw);
    i += 1;
  }
  return toCheck;
}

// 一条简单命令：动词 = 跳过前导 VAR=val 赋值后的第一个词（带路径的取文件名）。动词在放行表里
// 整条放过（含 git 的二级子命令表，TODO #79），否则按 token 判据逐个判——赋值本身也算参数，
// `X=.env tac y` 不该从赋值那一侧漏出去；动词位自己也要判：命令替换切段后密钥路径会独占一段、
// 自己坐到动词位上（$(which tac) .env 切完是 ".env" 单独一段，这段里唯一的 token 就在 vi 位），
// 不判 vi 就是白留了这个绕过口子。grep 一族额外把模式参数从待判列表里摘掉（TODO #79），赋值与
// 动词位仍照判不受影响；scanNested 只对解释器/求值类动词打开（TODO #78）。
function checkSimple(seg) {
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
  if (vi >= tokens.length) return false;
  const verb = tokens[vi].replace(/["']/g, '').replace(/^.*\//, '');
  if (isAllowedVerb(verb, tokens, vi)) return false;
  const scanNested = isNestedQuoteVerb(verb, tokens, vi);
  const checkTokens = GREP_VERBS.has(verb)
    ? tokens.slice(0, vi + 1).concat(grepTokensToCheck(tokens, vi))
    : tokens;
  return checkTokens.some((t) => tokenHits(t, scanNested));
}

// 一个参数 token 是否整体被一对配对引号包住（首尾同一种引号字符，长度至少 2）——H5 判「这个
// token 是不是一条待重扫的内层命令」复用这条，与 tokenHits 里 scanNested 分支判「是否整体加引号」
// 那条同构，抽出来给两处共用。
function isFullyQuoted(t) {
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0];
}

// 动词是否属于「命令载体」（H5，H6 补 shell -c）：单级表直接查；su 只有带 -c 才算；shell（sh/bash/
// zsh/dash/ksh）只有 -c 紧跟在动词之后才算（shellCPayloadIndex 判，M1 的 `bash deploy.sh -c "…"`
// 在这一步就返回 -1，不算载体，不会走到下面的递归重扫）；docker/kubectl/podman 要再看紧跟的子
// 命令是不是 exec/run。
function isCommandCarrier(verb, tokens, vi) {
  if (SINGLE_CARRIER_VERBS.has(verb)) return true;
  if (verb === 'su') return tokens.some((t) => t.replace(/["']/g, '') === '-c');
  if (shellCPayloadIndex(verb, tokens, vi) !== -1) return true;
  const subs = TWO_LEVEL_CARRIER_SUBS[verb];
  if (!subs) return false;
  const next = tokens[vi + 1] ? tokens[vi + 1].replace(/["']/g, '') : null;
  return next !== null && subs.has(next);
}

// 命令载体的引号参数当一条完整命令递归判（H5）：动词是 isCommandCarrier 认的那几个时，把它
// 参数里每一个整体加引号的 token 去引号后当新的 cmd 走一遍 scanSegments（含放行表判定），深度
// 沿用同一套上限。`ssh host 'ls -la .env'` 重扫后内层动词 ls 在放行表里，不会被拦；`ssh host
// 'cat .env'` 重扫后内层动词 cat 不在放行表、'.env' 撞上普通 token 判据，照拦。不带引号的形态
// （kubectl exec pod -- cat .env）走的是既有裸 token 判据，不需要这里处理。
function carrierHits(seg, depth) {
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
  if (vi >= tokens.length) return false;
  const verb = tokens[vi].replace(/["']/g, '').replace(/^.*\//, '');
  if (!isCommandCarrier(verb, tokens, vi)) return false;
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!isFullyQuoted(t)) continue;
    if (scanSegments(t.slice(1, -1), depth + 1)) return true;
  }
  return false;
}

// 管道段是否含密钥路径 token（H2）：不看动词放不放行，只看这一段里有没有任意 token 命中密钥路径
// ——`git ls-files -z .env` 的 git ls-files 本身是放行的，但段里字面出现的 .env 仍要能被后面的
// 管道级规则看到。
function segmentHasSecretToken(seg) {
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
  const verb = vi < tokens.length ? tokens[vi].replace(/["']/g, '').replace(/^.*\//, '') : '';
  const scanNested = vi < tokens.length && isNestedQuoteVerb(verb, tokens, vi);
  return tokens.some((t) => tokenHits(t, scanNested));
}

// 后面这一段是否把前面的密钥路径转发给了读内容的命令（H2）：动词是 xargs/parallel，且它转发的
// 内嵌命令词（跳过选项）里有一个不在放行表里——`xargs -0 cat` 的 cat、`xargs head` 的 head。
// 纯读 stdin、段内没有别的命令词的（`wc -l` 只有 -l 这个选项）不算，不是见 xargs 就拦，是拦
// 「转发的内嵌命令不在放行表」。
function laterSegmentTriggersBlock(seg) {
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
  if (vi >= tokens.length) return false;
  const verb = tokens[vi].replace(/["']/g, '').replace(/^.*\//, '');
  if (verb !== 'xargs' && verb !== 'parallel') return false;
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/["']/g, '');
    if (bare.startsWith('-')) continue;
    if (!isAllowedVerb(bare, tokens, i)) return true;
  }
  return false;
}

// 按管道分链（H2）：`|`（非 `||`）连出的段算一条链，其余分隔符（; && || & 换行 反引号 $( )）都
// 断链——H2 的「前后」判断只对 | 切出的段生效，`;` / `&&` 不算管道。与 splitSimple 同款的带引号
// 状态扫描，逻辑不合并是因为 splitSimple 不保留「这段是被 | 还是被别的分隔符切出来的」这个信息，
// 而这里恰恰需要它。
function splitChains(cmd) {
  const chains = [];
  let chain = [];
  let cur = '';
  let q = null;
  const endSeg = () => { chain.push(cur); cur = ''; };
  const endChain = () => { endSeg(); chains.push(chain); chain = []; };
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '$' && cmd[i + 1] === '(') { endChain(); i += 1; continue; }
    if (ch === '|' && cmd[i + 1] === '|') { endChain(); i += 1; continue; }
    if (ch === '&' && cmd[i + 1] === '&') { endChain(); i += 1; continue; }
    if (ch === '|') { endSeg(); continue; }
    if (/[;&\n`()]/.test(ch)) { endChain(); continue; }
    cur += ch;
  }
  endChain();
  return chains
    .map((segs) => segs.map((s) => s.trim()).filter(Boolean))
    .filter((segs) => segs.length > 0);
}

// 管道洗白检测（H2）：一条链里，前面某段出现过密钥路径 token 之后，后面任一段触发
// laterSegmentTriggersBlock 就整条拦；单段（没有管道）的链直接跳过。每段先剥一次壳
// （sudo xxx | yyy 这类），与 scanSegments 对单段的处理口径一致。
function pipelineForwardHits(cmd) {
  for (const chain of splitChains(cmd)) {
    if (chain.length < 2) continue;
    const segs = chain.map((seg) => stripWrappers(seg));
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (!segmentHasSecretToken(segs[i])) continue;
      for (let j = i + 1; j < segs.length; j += 1) {
        if (laterSegmentTriggersBlock(segs[j])) return true;
      }
    }
  }
  return false;
}

// 切分与剥壳互为下一轮的输入：`bash -c "tac .env; cat x"` 剥完壳里面还是一串带分隔符的命令，
// 剥出新形态就重切一遍（上限 3 层，免得畸形输入把递归拖垮）。管道洗白检测（H2）与命令载体重扫
// （H5）都挂在这层：前者对整条 cmd 判一次（含递归下沉后的子命令，嵌在载体引号里的管道也照得到），
// 后者对每个已经落到「没有壳可剥」的简单命令段再判一次。
function scanSegments(cmd, depth) {
  if (pipelineForwardHits(cmd)) return true;
  for (const seg of splitSimple(cmd)) {
    const bare = stripWrappers(seg);
    if (bare !== seg && depth < 3) {
      if (scanSegments(bare, depth + 1)) return true;
      continue;
    }
    if (checkSimple(bare)) return true;
    if (depth < 3 && carrierHits(bare, depth)) return true;
  }
  return false;
}

/** 命中则返回理由，没命中返回 null。 */
function checkOne(cmd) {
  const c = stripExamples(cmd);
  for (const r of RULES) {
    if (r.re.test(c)) return r.reason;
  }
  return scanSegments(c, 0) ? ARG_REASON : null;
}

runFailOpen(() => {
  const ev = readStdinJson();
  const cmd = ev ? String((ev.tool_input || {}).command || '') : '';
  if (!cmd) return;

  const stripped = stripWrappers(cmd);
  const reason = checkOne(cmd) || (stripped !== cmd ? checkOne(stripped) : null);
  if (!reason) return;

  // 先落拦停码再写诊断：写 stderr / 账本失败也不该把已经成立的拦停降级成放行
  process.exitCode = 2;
  say(`⛔ [secret-exfil-guard] ${reason}，已拦截。`);
  say('密钥/隐私是安全护栏，Fast Mode 也不豁免。正确做法：');
  say('- 需要了解配置结构 → 读 .env.example / 文档，不读真实密钥文件');
  say('- 只需确认存在/大小/权限 → ls / stat / test / chmod 这类只碰元数据的命令本闸不拦');
  say('- 确需操作密钥（轮换/迁移）→ 停下来向用户说明并由用户亲自执行');
  say('- 需要个别环境变量 → 按名取用（printf \'%s\' "$VAR_NAME"），不整包导出外传');
  gateLog('secret-exfil-guard', reason);
});
