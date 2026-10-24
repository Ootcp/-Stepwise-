# 拾级(Shiji)


读英文原文时点单词看词性和中文释义,点句子练翻译;读过的词会攒成"卡住的词",可以一键导出成 A4 单词表去打印。浏览器 + 一个只监听本机的 Node 服务,没有框架,没有数据库服务。

## 快速开始

```
npm install
cp -r data.sample data      # 可选:放一篇示例文章,首次打开就有的读
npm run dev                 # http://localhost:5173/
```

不开发、只想当桌面应用用:`npm run build && npm run serve`(独立服务器,127.0.0.1:45173 起),或者 `npm run package:win` 出安装包(见第 10 节)。

检查:`npm run typecheck`、`npm run test`(vitest)、`npm run build`。

## 数据与隐私

文章、生词、练习记录和设置全部写在**本机**:开发态在 `data/`,安装态在 `%LOCALAPPDATA%\english-app\data`。这两个位置都在 `.gitignore` 里,不会被提交。仓库里的 `data.sample/` 只是一篇原创示例文章,给新克隆的人看效果用。

模型能力来自上游 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi)(MIT);密钥只从环境变量 `SENSENOVA_API_KEY`、`~/.pi/agent/models.json` 或应用内"设置"页读取,不落仓库。第三方授权与来源见 [`NOTICE`](./NOTICE)。

---

## 1. 服务调用顺序(翻译 / 查词 / 批改)

所有模型能力都经过本地 server(浏览器不直连三方,/api/* 全在 server)。

- **查词** `GET/POST /api/lookup`:ECDICT 离线库(已装时最优先,含音标)→ Bilibili Index-Translate(免费,批量) → MyMemory(免费,单个) → **pi-ai 兜底**。
- **整句翻译** `POST /api/translate`:Bilibili → MyMemory → **pi-ai 兜底**。
- **批改 + 句子成分** `POST /api/analyze`:唯一**必须**走 pi-ai 的路径(默认 SenseNova,可在设置里切换默认 API 或添加其他 OpenAI 兼容 API)。`llm.ts` 默认用 `WORD_MODEL_ID = deepseek-v4-flash`(快模型)。返回 `{ official, analysis, parts }`:
  - `parts`:英文原句的**成分块**数组,`[{ "w": "块原文", "r": "主|谓|宾|定|状|补|表|同|""", "clause"?: true, "sub"?: [...] }]`。`w` 是原句里连续的一段文字(词/短语/从句);`clause` 标记从句;`sub` 是从句内部成分,或名词短语内嵌的从句;标点/无成分词 `r` 为空。
  - `user` 为空(点发送但没填译文)= 只要参考译文 + 成分拆解,不出批改,`analysis` 为空。
  - `deepseek-v4-flash` 是推理模型。查词、句子成分/批改、语法归纳这些结构化请求都会显式关闭 thinking(`thinking: {"type":"disabled"}`);否则长句可能把全部输出预算用在推理上,正文为空,表现为“模型未返回内容”。
  - 模型失败会降级:首次失败时查询 `/v1/models`，过滤非聊天模型，逐个用 32 token 的 JSON 小请求探测；健康结果缓存 10 分钟并合并并发探测。降级顺序为静态优先的健康模型 → 新发现的健康模型 → 探测未验证的模型；探测整体失败则退回静态顺序。当前套餐不可用的模型会被探测标记并跳过，全部失败才报错。首次降级会多等几秒，后续请求走缓存。
  - 翻译本身仍由免费源提供,`llm.ts` 只做批改,避免空跑配额。

- **问书** `POST /api/chat`:唯一带对话的 pi-ai 路径;请求体带 `messages` 与文章上下文(`title / layout / currentIndex / currentSentence / focusSource / sentences / weakWords / attempts`),服务端拼提示词并复用模型 fallback;与查词/翻译/批改共享 LLM 限流。客户端不落盘聊天,换文章即清空。

降级策略写在 `server/services.ts` 顶部注释;每一步失败都会落到下一个源,不会整链失败。

## 2. 句子成分块

批改面板(`web/sentence-panel.ts`)回复区自上而下:参考译文 → **句子成分** → 分析。

- 分析单位是**成分块**,不是词:模型按短语/从句切分整句,同一成分的连续词合成一块;名词短语(含限定词、形容词、介词短语)、状语短语、同位语整体成块。
- 分析正文按**成分点**渲染:`web/analysis.ts` 去掉模型偶尔带回的 Markdown 标题/`**`/列表符号,按换行和编号切段,每点固定 6px 间距;不再用 `pre-wrap` 直接打印,避免有时一整段、有时一行一句。
- 成分体系 8 类:主、谓、宾、定、状、补、表、同。每块一种底色 + 右上角角标,底部图例列出 8 类 + “从句”,不只靠颜色区分。角标整体不拆行(`定从` 不会分成 `定`/`从`);从句行标签与正文在同一行,正文在右侧换行。
- 从句作为一块:顶层从句(主从/宾从/状从/表从/同从)整块上色;嵌在名词短语里的定语从句在块内用虚线边标出,并在句子下方展开一行显示内部成分。颜色不再一层套一层。
- 渲染文字只来自原句:模型返回的 `w` 会被对齐到原句,没覆盖到的词和标点补成无色片段;漏词、缩写、标点单列都不会改变原句。
- 相邻同角色的块自动合并;成分覆盖率过低或 `parts` 为空时显示“成分解析暂不可用”,不渲染空块。
- 空译文提交同一路走 `/api/analyze`(不再单独走 `/api/translate`),所以“只要参考译文”也顺带出成分拆解,但只消耗一次模型调用、一次配额。
- 成分拆解**不参与评分**,只作展示(模型判断可能出错,参照用)。
- `parts` 随 `PanelState` 持久化(`store/articles.ts` 的 `SentenceRecord.parts`),支持 `clause`/`sub` 递归;旧文章的扁平逐词 `parts` 仍可显示,重新分析后升级为成分块。

## 3. 容错解析

`server/parse-syntax.ts` 解析模型回复,抗代码围栏、散文包裹、字段改名、长名归一(宾语→宾、定语从句→定+clause)、递归 `sub`;解析不出就返回空而不是抛错。与 `parse.ts` / `parse-grammar.ts` 同策略。

`web/syntax.ts` 再把成分块对齐回原句:精确匹配失败时按词序列匹配大小写/空格差异,仍未命中时尝试**粘连短语**(把 `these concepts` 对到原文 `theseconcepts`);未覆盖文字补成无色片段,渲染不会直接打印模型给的 `w`。覆盖率低于三分之一时整块降级。

`web/text.ts` 在切句前补回漏掉的句界:小写字母/数字后的 `.!?` 紧跟大写字母或 `(` 时先插入空格,所以 `news.For example` 会分成两句;`Ph.D.` 一类缩写先整体掩码,避免被内部句点切开。只影响解析与显示,不改磁盘上的原文。

## 4. 关键文件

- `server/llm.ts` — 模型客户端;`llmAnalyze` 出结构化 `{analysis, parts}`,`llmChat` 走真实对话
- `server/settings.ts` — 本地 API 服务、默认服务、跨 API/手动选择开关、两组模型选择、Key 掩码与 revision
- `server/chat.ts` — 问书请求裁剪、`<context>` 提示词、当前句/来源、查词与批改上下文
- `server/services.ts` / `server/api.ts` — 服务链、`/api/analyze`、`/api/chat` 路由与限流
- `server/parse-syntax.ts` / `server/store/articles.ts` — 解析器(8 类角色、从句、递归 sub)、`parts` 与文章 title/text 持久化
- `web/reader.css` — 阅读页视觉:三栏纸面、阶梯、文章头、批改面板、双栏小结、问书、响应式
- `web/syntax.ts` — 原句对齐、粘连短语回溯、同角色块合并、从句展开行
- `web/analysis.ts` — 批改分析去 Markdown、按编号/换行切成固定间距的成分点
- `web/sentence-panel.ts` — 面板交互与成分块渲染(`syntaxBlock` 函数)
- `web/article-dialog.ts` — 文章库新建与阅读页编辑共用的标题+正文弹窗
- `web/settings-dialog.ts` — 文章库设置窗口:左菜单、API 服务卡片、模型查询/测试、两个策略开关、两组模型选择
- `web/words-page.ts` — 单词库控制器:读取、搜索、三种排序、空态、点卡片发音
- `web/words.css` — 单词库视觉:卷首数字、搜索/排序、词卡网格、窄屏
- `web/relative-time.ts` — 文章库与单词库共用的“今天 / 3 天前 / 日期”格式
- `server/word-list.ts` — `GET /api/words` 读取时用 ECDICT 补全缺失释义,不写盘、不加点击次数
- `web/spell-page.ts` — 拼写练习控制器:题面、逐字母复核、键位、四档顺序滑块、音节降级
- `web/spell-diff.ts` — 纯函数逐字母比对:分隔符占一列,缺/多各自带文字标注
- `web/word-order.ts` — 单词库与拼写练习共用的一套排序(最近/高频/A–Z/易错)与搜索文本
- `web/spell.css` — 拼写练习视觉:听写纸卡片、两行同列字母、四档滑块、窄屏
- `server/store/practice.ts` — `data/practice.json`:每词作答/拼错次数与最近拼错时间(服务端时间)
- `server/store/syllables.ts` / `server/syllables.ts` — `data/syllables.json` 音节缓存 + 一次批量模型拆分(拼接对不上原词就丢弃)
- `server/parse.ts` — 模型回复的容错解析(查词、音节)
- `web/article-session.ts` — 文章标题/正文、编辑、批改记录与保存
- `web/reader-chat.ts` — 问书 UI、上下文快照、真实 `/api/chat`、移动抽屉
- `web/reader-size.ts` / `web/reader-progress.ts` / `web/reader-focus.ts` — 字号档、阅读进度、最近活动句
- `server/zip.ts` / `server/export-word/` — 最小 ZIP 写入器与 8 张 A4 Word 模板(index/catalog/xml/package/layout/templates)
- `shared/export-catalog.ts` — 模板 id、名称、每页容量、固定内容规则与文件名(浏览器与服务端共用)
- `web/export-dialog.ts` — “卡住的词”导出弹窗:模板、内容、下载
- `server/paths.ts` — 可写目录的唯一来源:开发态 `data/`,安装态 `%LOCALAPPDATA%\english-app\data`(每次调用才解析)
- `server/main.ts` — 独立服务器与命令行入口(`--serve` / `--open` / `--stop` / `--status`,127.0.0.1:45173-45183)
- `server/tray.ts` — 托盘子进程的解析、启动与收尾(只在安装态生效,`ENGLISH_APP_TRAY=0` 可关)
- `installer/icons/shiji.ico` — 产品图标(16~256 七档),安装包、快捷方式、卸载列表与托盘共用
- `installer/tray/{tray.cs,app.manifest}` — 托盘程序源码,打包时用系统自带 csc.exe 编译(C# 5 上限)
- `scripts/win/build.mjs` — 打包流水线:前端 + 单文件服务端 + 便携 Node + 发布目录白名单 + manifest + 冒烟 + ISCC
- `scripts/win/{smoke.mjs,fetch-ecdict.ps1,build-dictionary.mjs,node-runtime.json,ecdict.json}` — 发布目录验收与可选离线词典安装
- `installer/{shiji.iss,languages/ChineseSimplified.isl}` — 安装向导(依赖检查、可选下载、快捷方式、卸载保留数据)
- `web/api.ts` — `AnalyzeResult` / `SentencePart` 类型、`analyzeTranslation`、文章 CRUD
- `web/styles.css` — `--role-*` / `--role-*-edge` 令牌与共享弹窗/按钮
- `web/cover.css` — 首页、文章库、单词库与拼写练习共用的纸面令牌(含 `--right` / `--wrong`);含工具栏“单词库 / 新建文章”按钮

## 5. 测试

- `test/syntax.test.ts` — 原句对齐、短语整块、粘连词、同角色合并、标点、缩写、从句展开、覆盖率兜底
- `test/analysis.test.ts` — Markdown/编号/单段分析统一成分点
- `test/export-word.test.ts` — ZIP/CRC、包内页眉页脚、8 张模板的配色/分页/分组、单边留白、XML 转义与标签配对、文件名
- `browser-tests/export.test.ts` — 导出按钮禁用态、8 张模板与拼写测试锁定、请求体与 `.docx` 下载、失败保留弹窗
- `test/reader-styling.test.ts` — 返回键按钮重置、角标不断行、从句行同排
- `test/text.test.ts` — 句界切分、漏空格句界、`Ph.D.`/缩写/小数保护
- `test/parse-syntax.test.ts` — 8 类角色、从句别名、递归 sub 容错用例
- `browser-tests/bootstrap.test.ts` — 空译文/带译文两条路径 + 成分块 DOM、从句展开、空结果兜底
- `test/article-store.test.ts` — `parts` 递归持久化与坏行过滤
- `test/styling.test.ts` — 8 类底色/边色、从句虚线规则
- `test/llm-sampling.test.ts` — 查词/批改/语法归纳关闭 thinking、备用模型顺序、健康/未验证排序
- `test/model-health.test.ts` — 聊天模型过滤、探测分类、预算、10 分钟健康缓存、60 秒负缓存与 single-flight
- `test/chat.test.ts` — 问书消息/上下文裁剪、焦点来源、提示词里的当前句与学习记录
- `test/settings-store.test.ts` — 设置默认值、内置 provider、CRUD、Key 掩码/保留/清除、校验、0600、revision
- `test/model-selection.test.ts` — auto/pinned、默认服务、跨 API 候选、复合 target、测试分类
- `browser-tests/settings.test.ts` — 设置窗口、tabs、服务新增/查询/测试/保存、两个开关、两组选择、错误/关闭
- `browser-tests/library.test.ts` — 新建文章弹窗、空正文校验、从阅读页编辑标题/正文、设置入口
- `test/word-list.test.ts` — 读取时补全缺失释义、保留已有值、点击/时间戳不变、未收录与词典异常兜底
- `browser-tests/words.test.ts` — 单词库入口/`#/words`、词卡内容与兜底、搜索、三种排序、空态、失败重试、发音、主题
- `test/word-order.test.ts` — 三种排序与词库原行为等价、易错排序与并列兜底、搜索文本
- `test/spell-diff.test.ts` — 逐字母比对:全对/错字母/少写/多写、分隔符占列、拼不回原词时退化
- `test/practice-store.test.ts` — 作答计数、key 归一与拒绝、misses 不超过 attempts、坏数据容忍、原子写
- `test/syllables-store.test.ts` — 段必须拼回原词、只留合法条目、缺失/损坏起步、上限淘汰
- `test/syllables.test.ts` — 已缓存不再请求、并发共用一次调用、去重与批量上限、模型失败静默
- `browser-tests/spell.test.ts` — 拼写页入口/`#/spell`、题面、绿红复核与缺/多、再输入即清空、`1`/`2`/↑/↓/`` ` ``/Enter、输入法回车、拼对再按 Enter 下一题、顺序滑块与持久化、音节失败退化、空词库
- 全量:`npm run test`(vitest)

## 6. 阅读页、文章编辑与问书

阅读页已从 `M:\Ai\project\shiji-reader` 的独立设计稿完整迁入;原型仍保留作静态视觉参考,正式逻辑在应用里。

- **版式**:纸面三栏(阶梯进度 / 正文 / 问书);正文在 1440 下约 636px;顶栏有字标、滚动后文章标题、字号、编辑、主题;`<960px` 时问书变右侧抽屉。返回键是 `<button>`,但已清掉浏览器默认边框/底色,视觉与原型链接、文章库返回键一致。浏览器标签沿用原型的奶白底金色阶梯图标;标题随视图为「拾级」/「拾级 · 文章库」/「拾级 · 单词库」/「拾级 · 拼写练习」/「拾级 · 阅读」(品牌名永远在前,阅读页不显示文章标题,与原型静态页一致)。
- **文章头**:标题、句数/词数/约几分钟、按句/按段、提示;旧文章若首行等于标题,载入时从正文显示中移除该行;超过 60 字的长标题按词边界加省略号并在纸面上限制三行。
- **批改面板**:按句号展开;参考译文 → 8 类成分块 → 分析;新增“参考译文”按钮;成分块使用角标 + 9 项图例,从句在下方展开。分析按固定成分点排版,角标不拆行,从句标签与正文同行。
- **小结**:双栏“卡住的词 / 语法”,行式列表;点击词回到文中,点音标发音。
- **导出**:小结“卡住的词”标题右侧的“导出”打开弹窗,确认后由 `POST /api/export/word` 生成 A4 `.docx` 并直接下载。8 张模板:彩色卡片 8/页(照 `02-color-cards`:FLASHCARDS、四色图例、使用说明、左词右义、例句留空)、经典绿与清新蓝各 50/页(双栏 No./Word/Meaning)、拼写测试 25/页(固定左看词写义、右看义写词,内容选项禁用)、艾宾浩斯 25/页(8 个复习格)、高密度 34/页、经典完整 30/页(例句列留空)、速查表 24/页(按 n./v./adj./adv./其他 分组)。内容可选仅单词 / 仅中文 / 单词 + 中文,未选侧留白;文件名“拾级-卡住的词-模板-文章-日期.docx”,文章名不进正文;不含例句,不写回数据。
- **文章模型**:`title` 与 `text` 分开保存;旧文章在首次保存时会把首行标题规范化。文章库虚线“+”卡和工具栏“新建文章”都打开标题+正文弹窗,正文非空才创建并进入阅读页。
- **编辑**:阅读页顶栏的铅笔按钮打开同一弹窗,保存标题/正文后立即重渲染并持久化;当前句的句子成分、批改记录按句子文本保留。
- **问书**:右栏跟随最近活动句(点词/翻译练习/朗读),无活动时用滚动位置兜底;发送时冻结上下文,带上本篇全文、当前句、查词和最近 3 条批改;真实 `/api/chat` 返回中文答疑,出错可重试。聊天不持久化。
- **字号/主题**:字号 S/M/L 写到 `html[data-size]` 并存 `english-app:reader-size`;主题/排版沿用 `english-app:theme` / `english-app:layout`。暗色下阅读页与首页/文章库同用暖纸 `#14140f`、卡片 `#21201a`;旧应用壳的冷灰蓝令牌不再覆盖阅读页。

## 7. 设置与多 API

文章库右上角齿轮打开设置窗口:左侧「API 设置 / 使用说明」,右侧内容区。API 设置页同时管理服务和模型策略,不再把模型选择藏到别的页面。

- **服务**:内置 SenseNova 永远列出且只读,Key 来自 `SENSENOVA_API_KEY` 或 `~/.pi/agent/models.json`;自定义服务用 `名称 + Base URL + API Key` 添加,可启用/停用、编辑、删除、查询模型、逐个测试。第一版只支持 OpenAI 兼容的 `GET /models` 与 `POST /chat/completions`。
- **测试**:查询模型会读取上游 `/models`;测试是显式动作,不写运行时健康缓存,状态分为可用 / 不可用 / 未验证。自定义服务的高级兼容可切换 JSON 模式与旧 `max_tokens` 字段。
- **默认 API**:自动模式默认使用内置 provider 的 word/sentence 模型;选自定义默认为默认时,两组都用它的 `defaultModelId`(没有则第一个聊天模型,再没有则回退内置)。
- **跨 API 自动降级**:默认开。关闭后失败只在当前 provider 内回退;打开后会先同 provider、再其他启用且有 Key 的 provider,每个 provider 最多 3 个候选。文案会明确提示原文/对话可能发往其他服务商。
- **手动选择模型**:默认关。关闭时两组都自动;打开后分「批改/查词/语法归纳」与「翻译/问书聊天」两组,每组可选自动或固定服务+模型。固定模型失败时仍走同一套降级。
- **持久化**:`data/settings.json`(随 `ENGLISH_APP_DATA_DIR`),原子写入,模式 0600(POSIX)。GET 只返回 `hasKey`/`keyMasked`/`keySource`,原始 Key 只留服务端;内置 Key 不复制进设置文件。Windows 的文件模式只是建议值。
- **失效**:设置变更递增 revision,`llm.ts` 下一次访问重建 provider registry、模型发现和健康缓存;主模型永远先试一次。
- **入口映射**:查词/批改/语法归纳走 structured;整句翻译/问书走 prose。`/api/analyze` 缺参考译文时可能先调用翻译(prose),只 pin structured 不会改变那一步。
- **限制**:没有流式、工具调用;自定义 provider 不发送 `thinking` 参数;自定义默认模型对两组共用;修改环境变量/`models.json` 后内置 Key 需要重启 dev server。

## 8. 单词库

文章库工具栏的“单词库”打开第四个视图(`#/words`),窄屏收成书页图标。页面按最近出现排序,可切到高频或 A–Z,搜索同时匹配单词、中文释义、词性与音标;点整张词卡朗读该词。

- **数据**:`data/words.json` 仍是点击日志,记录 `word / ipa / pos / meanings / clicks / firstSeenAt / lastSeenAt`。`GET /api/words` 在返回前用本地 ECDICT 补全缺失的 ipa/pos/meanings,但**不写回文件、不增加 clicks/lastSeenAt**;打开词库页不会改变学习记录。
- **兜底**:ECDICT 未收录或未安装时,卡片显示“词典暂未收录释义”,点击次数与时间仍然可见;词库文件损坏时页面显示重试。
- **视觉**:卷首是金色眉标 + 大号总数 + 统计行,下面是搜索/排序与 240px 起的纸卡网格;导航、卷首、工具栏固定,只有网格滚动。空库、无匹配、读取失败共用同一空态块,动作分别为去文章库 / 清空搜索 / 重试。
- **主题**:与首页、文章库共用暖纸令牌;暗色仍为 `#14140f` 纸面 / `#21201a` 卡片。
- **范围**:单词库只读,不提供导出,也不记录来源文章;Word 导出仍只在阅读页小结提供。“拼写练习”是它右边的入口(见 §9)。

## 9. 拼写练习

单词库工具栏的“拼写练习”打开第五个视图(`#/spell`),窄屏收成图标。题面只有中文意思、词性和音标,用户在输入区拼写;提交后逐字母对照,错时在正上方显示带音节分隔的正确拼写。

- **键位**:`Enter` 提交(拼对后再按 `Enter` 直接进下一题;拼错后 `Enter` 不跳,必须重拼);`` ` ``/`~` 或单按 `Ctrl` 或点音标朗读;`3` 或「重写」按钮清空输入行重拼当前词(不计分、不写记录);`1`/`↑` 上一题、`2`/`↓` 下一题(输入框里有未提交的内容时,方向键仍归光标使用)。修饰键组合一律放行(`Ctrl+2`、`Ctrl+C` 不夺焦点也不读音),单按 Ctrl 忽略按键重复。输入法候选中的 `Enter` 不会误提交。
- **焦点**:键位绑在视图根上,焦点在导航、滑块或主题键上时一样能用;上一个/下一个/提交/重写/点复核行之后都会把光标送回输入框,不会出现“点了按钮之后键盘不归输入框”。
- **复核**:复核区是**一个网格**(`.spell__stage`),两行单元格用 `grid-row` 分行,列宽由 stage 上的 `--cell: 1.15ch` 算一次 —— 两行各自写 `1.1ch` 会因字号不同而错列。音节分隔符 `·` 自占一列,所以答案比正确拼写长或短时仍然逐字母对齐。对的字母绿、错的字母红(虚线下划线),漏写的字母在原位留一个虚线空位并标「缺」,多写的字母划掉并标「多」;标注统一放在答案行下方。`#spell-result` 同时用文字播报“错 N / M 个字母 + 正确拼写”,颜色不是唯一信号。
- **立刻清空**:提交算分后输入框立即清空并重新聚焦,复核行显示在上方;再敲任意可打印键只收起复核行,不会把新字母接在旧答案后面。
- **顺序**:右上角四档滑块 `最近 / 高频 / A–Z / 易错`(默认最近,存在 `english-app:spell-order`)。切换只重建队列并把游标重新锚在当前词上,所以当前题不动,下一题才按新顺序出。`易错` 按拼错次数降序、再按最近拼错时间降序,没错过的词退回“最近”排在后面。上一题/下一题在两端钳制并禁用,不循环。
- **记录**:`data/practice.json` 记每词 `attempts / misses / lastWrongAt / lastCorrectAt`,时间由服务端盖(客户端时钟不准不会污染排序);`POST /api/practice/record` 一次提交一条,失败重试一次后静默,不影响继续练。拼写不改动 `words.json` 的点击次数。
- **音节分隔符**:本地 ECDICT 没有音节列,所以进页时按队列前 40 个未缓存词调一次 structured 模型(`POST /api/syllables`),结果缓存进 `data/syllables.json`;拼接后与单词逐字母不符的划分一律丢弃。没配 Key、模型不可用或被限流时不报错,只是正确词不加分隔符。并发进入页面共用同一次调用。
- **视觉**:与文章库/单词库同一套暖纸令牌,新增 `--right`(浅色 `#2f7a4d` / 暗色 `#7ac48f`),红色沿用 `--danger` 同族的 `--wrong`。字母行 `clamp(24px, 4.4vw, 34px)`,正确单词 0.86em(不再是小号注脚)。底部按钮居中一排(上一个 / 重写 / 提交 / 下一个),键位说明在其下方。整页锁定视口,只有题面卡内部滚动;空词库、读取失败复用同一空态块。

## 10. 打包成 Windows 安装包

目标:把拾级装到另一台 Windows 10/11 x64 电脑上,那台机器不需要装 Node,也不需要 `npm install`。

```
npm run package:win                                              # 产出 release\拾级-Setup-<版本>.exe(+ .sha256.txt)
npm run package:win -- --out D:\tmp                              # 换输出目录
npm run package:win -- --node-from "C:\Program Files\nodejs\node.exe"   # 镜像下载失败时改用本机 Node(必须同版本)
npm run package:win -- --skip-installer                          # 只出发布目录 staging/,不编译 exe
npm run package:win:smoke                                        # 单独跑发布目录验收
```

流水线做的事:

1. `vite build` 出前端;esbuild 把 `server/main.ts` 连同 `@earendil-works/pi-ai` 全部内联成 `resources/server/index.mjs`(约 1 MB),并用 metafile 断言零外部依赖,所以**不随包发 `node_modules`**。
2. 便携 Node 按 `scripts/win/node-runtime.json` 固定的地址下载、按 SHA-256 校验,只取 `node.exe`;再复制一份把 PE 子系统改成 GUI 的 `拾级.exe`,快捷方式指向它,双击不会闪出黑窗口(`node.exe` 保持原样,签名不被破坏)。
3. 组装 `staging/`:`runtime/`(node.exe、拾级.exe、拾级托盘.exe)、`resources/`(bundle + dist + `icons/shiji.ico` + manifest.json)、`tools/`(词典脚本)。白名单复制 + 禁用名单断言,`data/`、`.review/`、`test/`、`node_modules/` 进不去;图标必须是含 16/24/32 等多档的 ICO,否则构建失败。
4. `installer/tray/tray.cs` 用系统自带的 .NET Framework 编译器(`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`)编成 `拾级托盘.exe`(约 27 KB,`/target:winexe` + 嵌入图标 + dpiAware 清单),不引入任何第三方依赖。语言上限是 C# 5,写了新语法就编译失败。
5. `scripts/win/smoke.mjs` 用包内自带的 node.exe 真跑一遍(34 项):首页与资源、健康检查、文章写入用户目录、Word 导出、`Host` 校验、目录穿越、`--status/--open/--stop`、程序目录零写入、未指定数据目录时落到 `%LOCALAPPDATA%\english-app\data`、图标与托盘的 PE 子系统;加 `--allow-tray` 还会真的把托盘拉起来,并验证服务停止后它自己退出。任何一项失败都不出包。
6. Inno Setup(随 `innosetup` devDependency 发布的 ISCC.exe,不需要往系统里装东西)编译 `installer/shiji.iss`。

### 安装与数据位置

- 默认装到当前用户的 `%LOCALAPPDATA%\Programs\拾级`(普通权限,不弹 UAC;向导里可以改成所有用户)。
- 文章、卡住的词、设置:`%LOCALAPPDATA%\english-app\data`;运行信息与日志:`%LOCALAPPDATA%\english-app\runtime.json`、`...\logs\server.log`。
- 服务只监听 `127.0.0.1`,端口从 45173 起顺序找(避开 dev 5173 / preview 4173);`Host` 不是本机一律 403,关闭接口要带 `runtime.json` 里的一次性 token。
- 开始菜单:拾级(启动并打开浏览器)、停止 拾级、安装离线词典、卸载;桌面图标与登录自启是可选项。
- 产品图标:`installer/icons/shiji.ico`(16~256 七档)随包安装到 `resources/icons/`,安装程序自身(`SetupIconFile`)、所有快捷方式(`IconFilename`)、"程序和功能"条目(`UninstallDisplayIcon`)和托盘都用它;浏览器标签页的 favicon 是同一款实心阶梯(`web/index.html`)。唯一还是 Node 标志的地方,是资源管理器里直接看 `runtime\拾级.exe` 时——改文件图标要重写 PE 资源树,不在这次范围内。
- 系统托盘:服务运行时在通知区域显示拾级图标。**左键单击**在默认浏览器打开;右键菜单 = 打开拾级 / 停止拾级 / 随 Windows 启动(勾选状态实时读注册表)/ 打开日志文件夹。安装向导"附加任务"里默认勾选,取消后会在 `resources/tray.disabled` 留标记,服务端就不拉起托盘。开发环境(`npm run dev`、`npm run serve`)永远不出托盘,测试用 `ENGLISH_APP_TRAY=0` 关掉。
- 登录自启写的是 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的「拾级」值(指向 `拾级.exe … --serve`,GUI 程序不闪窗口),卸载或托盘菜单切换动的都是同一个值。
- 卸载只删程序目录,学习记录与词典保留,并单独问一次是否连记录一起删除。
- 安装包未签名,首次运行可能被 SmartScreen 拦:「更多信息」→「仍要运行」;发布时同时给出 `.sha256.txt`。自编译的 `拾级托盘.exe` 同样没有签名,若被杀软拦下,服务只会少一个托盘图标(日志里记 `tray failed`),其余功能不受影响。

### 离线词典(可选,不打进基础包)

勾选后向导会再确认一次才联网下载:ECDICT `ecdict-sqlite-28.zip`(207 MB,SHA-256 固定校验)→ 解压出 851 MB `stardict.db` → 用包内 node.exe 跑 `build-dictionary.mjs` 投影成 311 MB 的 `words` 表 → 原子改名到 `%LOCALAPPDATA%\english-app\ecdict\english-words.db`,临时文件自动清理。失败不阻断安装,拾级改用在线词典。事后可以从开始菜单「安装离线词典」重试,或:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "<安装目录>\tools\fetch-ecdict.ps1" -Runtime "<安装目录>\runtime\node.exe"
```

### 验收记录

- **0.1.0(2026-10-24)**:静默安装到临时目录 → 28 项冒烟全过 → headless Edge 走通 首页 → 文章库 → 新建文章 → 阅读页点词 → 导出弹窗 → 真实下载 `拾级-卡住的词-彩色卡片-安装包验收-20261024.docx` → 删除文章 → 卸载:程序目录清空、注册表项与快捷方式清除、学习记录与词典保留、端口无残留。词典脚本单独用本地压缩包跑通(首次 exit 0,重复 exit 4 跳过)。
- **0.2.0(2026-10-24)**:`npm run package:win` 出 `拾级-Setup-0.2.0.exe`(44.7 MB)。静默装到临时目录后:快捷方式 `IconLocation` 指向 `resources\icons\shiji.ico`,`--open`/`--stop` 参数正确;从安装包 exe 里提取出的图标就是阶梯;勾选 autostart 时 Run 值写入成功。`smoke --root <安装目录> --allow-tray` **34/34**,其中"托盘随服务启动"和"停止服务后托盘自己退出"两项是真的把 `拾级托盘.exe` 拉起来再等它自己收工。取消勾选托盘重装 → `resources/tray.disabled` 出现,服务照常启动且日志里没有 `tray started`;重新勾选 → 标记被删掉。卸载后程序目录清空、Run 值清除、学习记录与词典保留。左键弹浏览器和右键菜单是桌面交互,留给人工确认(Windows 11 的新图标默认藏在任务栏「显示隐藏的图标」里)。
