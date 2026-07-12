# EnStudy

EnStudy 是一个本地优先的英语学习软件，目标是让学生通过“听音频、看中文、拼写英文、理解句子成分”的方式学习单词、短语和完整句子。

当前项目包含两套学习入口：

- 新版混合练习：`index.html`，按课程包和单元学习，单词、短语、句子混合出现。
- 旧版精品单词练习：`primary.html`、`junior.html`，保留原来的小学/初中单词拼写体验、用户和学习记录。

项目第一阶段定位为本地运行，不依赖登录系统和远程数据库。用户进度可以保存在浏览器本地，也可以通过 `server.mjs` 保存到本机 JSON 文件。

## 当前能力

### 学习体验

- 首页按课程分组展示所有课程包。
- 点击课程后展示该课程下的所有单元。
- 点击单元后按单元混合学习单词、短语、句子、缩写。
- 学习页展示中文释义，进入题目后自动播放英文。
- 支持上一题、下一题、重做、重置单元、题单、错题练习。
- 支持已学、未学、错题和按天学习记录。
- 旧版单词练习和新版混合练习共用学习者体系，并可相互跳转。

### 拼写方式

所有题型都支持两种输入方式：

- 词块模式：选择正确词块填空，并混入干扰词块。
- 键盘模式：页面显示每个单词的字母占位，支持点击字母块或键盘输入。

键盘模式中：

- 每个英文单词单独显示横线占位。
- 撇号缩写保留原样，例如 `I'm` 需要输入撇号。
- 标点、数字、时间、日期、价格等默认不需要填写。
- `Space` 跳到下一个词。
- `Backspace` 删除当前词字母；当前词为空时回到上一个词。
- `Enter` 尝试下一题。
- `Shift + Enter` 上一题。

### 提示和答案

- 页面只保留一个提示按钮。
- 点击提示后显示当前正在输入的词的提示信息。
- 提示包含中文、音标、词性、句子成分或短语成分。
- 点击答案或全部答对后，在同一区块展示完整英文。
- 句子和可分析短语会在原文上直接标注成分，使用彩色划线块展示。

### 句子和短语分析

- 句子使用 Stanza 依存句法分析生成教学化成分树。
- 短语也进入分析流程；如果能分析出结构，会在完成后像句子一样显示。
- 程序会把依存关系转换为面向学生的中文成分标签，例如主语、谓语、宾语、地点状语、介词宾语、限定词等。
- 对少量 NLP 无法覆盖的短语组成词，会使用保底角色，例如介词、连接词、短语组成部分，避免提示为空。

## 技术栈

- TypeScript
- Vite
- 原生 DOM 渲染
- 本地 JSON 数据
- `xlsx` 解析 Excel
- Python + Stanza 生成句子/短语成分分析
- Node `server.mjs` 提供本地用户和学习记录 API

当前刻意保持轻量：

- 没有 React/Vue 等大型框架。
- 没有数据库。
- 没有账号系统。
- 没有服务端渲染。
- 数据在构建前预处理，前端直接读取 JSON 分片。

## 运行环境

建议环境：

- Node.js 20 或更高版本
- npm 10 或更高版本
- Python 3.9，用于 Stanza NLP 分析
- uv，用于创建 `.venv-nlp`

安装依赖：

```bash
npm install
```

首次使用 NLP 分析前安装 Python 依赖和 Stanza 英文模型：

```bash
npm run setup:nlp
```

如果只开发前端 UI、运行已有数据，可以暂时不跑 `setup:nlp`。

## 启动方式

### 只启动前端开发服务

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

这种方式下，学习记录会优先保存在浏览器 `localStorage`。

### 启动带本地用户记录的服务

```bash
node server.mjs
```

服务会提供静态页面和用户记录 API，并把记录保存到：

```text
storage/users/<用户id>.json
```

生产或长期自用时推荐这种方式，因为可以保留不同学习者的记录文件。

## 常用命令

```bash
npm run dev              # 启动 Vite 开发服务
npm run build            # TypeScript 校验并构建
npm run preview          # 预览构建产物
npm test                 # 运行核心数据转换测试
npm run import:study-data # 从默认 study_data 目录导入 Excel
npm run import:excel     # 从命令参数指定目录导入 Excel
npm run repair:data      # 修复和标准化已生成课程数据
npm run setup:nlp        # 安装 Stanza 环境和模型
npm run analyze:data     # 生成句子/短语成分分析
npm run audit:data -- --all # 全量审计 runtime 数据
```

推荐完整数据更新流程：

```bash
npm run import:study-data
npm run repair:data
npm run analyze:data
npm run audit:data -- --all
npm test
npm run build
```

## 数据导入

默认读取目录：

```text
/Users/ripflowers/Downloads/study_data
```

目录约定：

```text
study_data/
  七年级英语上/
    starter_unit1_key_info_structured_v5_final_raw_structure.xlsx
    unit1_you_and_me_final_raw_structure.xlsx
  七年级英语下/
    g7b_unit1_animal_friends_key_info_structured.xlsx
```

第一级目录是课程包名称。第二级是该课程包下的 Excel 文件。

也可以指定目录：

```bash
npx tsx scripts/import-excel.ts /path/to/study_data
```

Excel 读取规则：

- 优先读取名字包含 `学习内容` 的 sheet。
- 如果没有，则读取第一个 sheet。
- 类型兼容中文和英文：`单词`、`短语`、`句子`、`缩写`、`word`、`phrase`、`sentence`、`abbreviation`。
- 类型为空或无法识别时，会按英文内容自动推断。
- 句子和短语的前端练习数据不会写回原始字段，而是在导入时动态生成 runtime 数据。

详细数据格式见：

```text
docs/course-data-format.md
```

## 输入字段

Excel 主要字段：

| 字段 | 说明 |
| --- | --- |
| 课程包ID | 可选，课程包稳定标识 |
| 年级 | 例如七年级上册、七年级下册 |
| 单元ID | 例如 Unit 1、Starter Unit 1 |
| 单元标题 | 单元名称 |
| Section | 教材 section |
| 来源页码 | 教材页码 |
| 来源类型 | 单词表、对话、阅读等 |
| 重要性等级 | 用于后续筛选 |
| 内容ID | 推荐提供，必须唯一 |
| 类型 | 单词、短语、句子、缩写 |
| 英文内容 | 练习答案 |
| 中文释义 | 页面提示 |
| 音频文本 | 播放文本，空时使用英文内容 |
| 音标 | 提示使用 |
| 词性 | 提示使用 |
| 句型结构 | 元数据 |
| 句子拆分分析JSON（原始v2） | 可选，人工句子成分分析 |
| 备注 | 原始备注 |
| 质量状态 | 原始质量信息 |

## 生成数据

导入后会生成聚合数据：

```text
data/raw-items.json
data/lexicon.json
data/runtime-items.json
```

也会生成按课程和单元拆分的数据：

```text
data/legacy/<课程包>/lexicon.json
data/legacy/<课程包>/courses/<单元>/raw-items.json
data/legacy/<课程包>/courses/<单元>/runtime-items.json
data/legacy/<课程包>/courses/<单元>/source.json
```

首页使用：

```text
data/learning-manifest.json
```

manifest 只保存课程包、单元、题量、类型数量、分片路径等索引信息。实际题目按单元懒加载。

## 数据分层

项目严格区分三层数据。

### 原始数据层

来自 Excel，保存教材内容、中文释义、音标、词性、句型结构、人工 JSON、备注和质量状态。

对应类型：

```text
RawLearningItem
SentenceAnalysisRaw
SentenceComponent
PracticePolicy
```

### 派生数据层

由程序生成，前端可直接使用：

- 英文 token
- 拼写单元
- 横线占位
- 可填写和不可填写标记
- 答案校验数据
- 词块干扰项
- 句子/短语成分映射
- 词级提示

对应类型：

```text
RuntimeLearningItem
SpellingUnit
LexiconEntry
WordHint
```

### 前端状态层

只保存练习时的输入、当前题号、提示状态、已学、错题、学习记录等。

这些状态不会写回原始数据。

## 核心目录

```text
src/
  main.ts                 # 新版混合练习主界面
  styles.css              # 新版混合练习样式
  lib/
    learning.ts           # 英文切分、词典、runtime 派生、成分映射
    types.ts              # TypeScript 类型
    view.ts               # HTML 转义等视图工具
  components/
    SentenceAnalysis.ts   # 句子成分树组件，保留扩展位
    WordHint.ts           # 单词提示组件，保留扩展位

scripts/
  import-excel.ts                 # Excel 导入、分片输出、manifest 生成
  repair-learning-data.ts         # 数据修复、类型提升、不完整内容处理
  enhance-sentence-analysis.py    # Stanza 成分分析
  setup-nlp.py                    # Stanza 模型准备
  audit-learning-data.ts          # 数据质量审计
  import-julebu-course-pack.ts    # 在线课程抓取导入脚本
  merge-beijing-units.ts          # 北京版课程按单元合并
  split-legacy-runtime-data.ts    # 旧 runtime 数据拆分

simple/
  simple-app.js       # 旧版单词练习逻辑
  simple.css          # 旧版单词练习样式
  data/
    primary_words.json
    junior_words.json
  sounds/             # 正确、错误、点击音效

data/
  learning-manifest.json
  raw-items.json
  lexicon.json
  runtime-items.json
  legacy/
  course-packs/

tests/
  learning-runtime.test.ts

docs/
  course-data-format.md
```

## 核心函数

### `tokenizeEnglish(text)`

位置：

```text
src/lib/learning.ts
```

职责：

- 英文单词切成 `word`。
- 大写缩写切成 `abbreviation`。
- 标点切成 `punctuation`。
- 时间如 `7:00` 切成 `time`，默认不填写。
- 数字切成 `number`，默认不填写。
- 价格、日期、符号做简单识别。
- 撇号缩写保持原样，例如 `What's`、`I'm`。

### `buildLexicon(items)`

从单词、短语、缩写数据里构建词典。

key 使用小写英文内容。

句子和短语里的词如果能查到词典，就优先使用词典里的音标、词性、释义。

### `buildLearningRuntimeItem(rawItem, lexicon)`

把原始学习项转换成前端 runtime 学习项。

输出包括：

- `displayChinese`
- `audioText`
- `fullEnglish`
- `spellingUnits`
- `shuffledBlocks`
- `componentTree`
- `wordHints`

### `mapWordsToComponents(tokens, sentenceAnalysis)`

把短语级或句子级成分映射到逐词 spelling units。

优先匹配最细 children 节点，再回退到父级 component。

## 质量校验

导入和审计覆盖以下问题：

- 句子类型但 JSON 为空。
- JSON 解析失败。
- 内容 ID 重复。
- component text 在英文句子中找不到。
- spelling units 没有可填写单词。
- 时间 token 被错误设为可填写。
- 句子或短语单词缺失成分映射。
- 不完整英文，例如省略号、孤立问号、坏尾巴。
- 单词、短语、句子类型明显错误。
- 中文释义缺失。

全量审计：

```bash
npm run audit:data -- --all
```

当前数据审计结果：

```text
coursePacks: 18
manifestUnits: 322
runtimeFiles: 816
runtimeItems: 88408
errors: 0
warnings: 0
```

## 测试

核心测试：

```bash
npm test
```

覆盖内容：

- token 切分。
- `7:00` 等时间不可填写。
- 撇号缩写 `I'm` 保留撇号占位。
- 短语 `each other` 拆成两个词分别填写。
- 句子成分映射到逐词提示。
- 短语也能使用 component tree。

构建验证：

```bash
npm run build
```

当前构建会出现 Vite 大分片提示，这是课程数据量较大导致的 warning，不是构建失败。

## 用户进度

前端本地模式：

- 用户、进度、错题和记录保存在浏览器 `localStorage`。

Node 服务模式：

- `server.mjs` 提供 `/api/users`、`/api/users/:id/progress` 等接口。
- 记录保存到 `storage/users/`。

新版混合练习使用独立 scope：

```text
junior:sentence-mixed
```

旧版单词练习保留原来的模式进度，并通过迁移逻辑兼容旧用户记录。

## 部署建议

本地或内网部署推荐：

```bash
npm install
npm run build
node server.mjs
```

需要持久化的目录：

```text
storage/users/
data/
simple/data/
simple/sounds/
assets/
```

如果只托管静态文件，可以部署 `dist/`，但用户记录只能保存在浏览器本地，无法跨设备保存。

## 当前限制

- 没有正式账号体系。
- 没有远程数据库。
- 没有教师后台。
- 没有课程编辑器。
- 没有完整的学习统计看板。
- Stanza 成分分析不是人工语法标注，复杂句仍需要人工复核。
- `xlsx` 包当前维护状态有限，后续开源化应评估替代方案或隔离导入进程。
- 数据体积较大，构建产物中存在较大的动态分片。

# 开源化设计方案

本节是设计方案，不代表当前已经全部实现。

目标是把 EnStudy 设计成一个轻量、可本地运行、可扩展课程数据的开源英语学习软件。

## 开源定位

建议定位：

```text
Local-first English learning app for word, phrase and sentence spelling practice.
```

中文定位：

```text
本地优先、数据可扩展的英语单词/短语/句子拼写与语法理解练习软件。
```

核心原则：

- 本地优先：默认不需要服务器和账号。
- 数据开放：课程数据格式清晰，允许用户自建数据。
- 轻量实现：保留原生 TypeScript + JSON 的简单架构。
- 可审计：数据导入、修复、分析、审计流程全部可运行。
- 可替换：NLP 分析、语音、课程导入都应是可替换模块。

## 开源前需要优化的用户体验

### 1. 安装体验

当前问题：

- 默认导入路径写死为 `/Users/ripflowers/Downloads/study_data`。
- `setup:nlp` 依赖 `uv` 和 Python 3.9，新用户可能不知道如何安装。
- 数据导入、修复、分析、审计需要多条命令。

建议设计：

- 增加 `.env.example`：

```text
STUDY_DATA_DIR=./study_data
ENSTUDY_DATA_DIR=./data
ENSTUDY_STORAGE_DIR=./storage/users
STANZA_MODEL_DIR=.stanza-resources
```

- 增加交互式初始化命令：

```bash
npm run init
```

职责：

- 检查 Node 版本。
- 检查 Python/uv 是否存在。
- 创建 `study_data/`、`data/`、`storage/users/`。
- 提示是否安装 NLP 模型。
- 生成本地 `.env`。

- 增加一键数据更新命令：

```bash
npm run data:update
```

等价于：

```bash
npm run import:study-data
npm run repair:data
npm run analyze:data
npm run audit:data -- --all
```

### 2. 首次无数据体验

当前问题：

- 如果没有课程数据，页面只提示运行导入命令。

建议设计：

- 提供一个极小示例课程包：

```text
examples/study_data/Starter Pack/demo_unit1.xlsx
```

- 首次运行可以选择：

```bash
npm run import:example
```

- README 中提供 5 分钟快速体验路径：

```bash
npm install
npm run import:example
npm run dev
```

### 3. 数据扩展体验

当前问题：

- 数据格式说明已有 `docs/course-data-format.md`，但还缺少模板文件和校验报告样例。

建议设计：

- 提供空白模板：

```text
templates/course-unit-template.xlsx
templates/course-pack-template/
```

- 提供 JSON Schema：

```text
schemas/raw-learning-item.schema.json
schemas/runtime-learning-item.schema.json
schemas/learning-manifest.schema.json
```

- 提供数据导入报告：

```text
reports/import-report.json
reports/audit-report.json
```

报告包含：

- 导入文件列表。
- 行数。
- 类型统计。
- 自动修复统计。
- 被删除或跳过内容。
- 需要人工复核的句子。

### 4. 用户学习记录体验

当前问题：

- 浏览器本地和 Node 文件存储都可用，但导出/导入用户记录不明显。

建议设计：

- 增加“导出学习记录”按钮。
- 增加“导入学习记录”按钮。
- 导出格式：

```text
enstudy-progress-<user>-<date>.json
```

- 服务端增加备份命令：

```bash
npm run backup:users
```

### 5. 离线和 PWA

当前已有：

- `manifest.webmanifest`
- `sw.js`
- `pwa.js`
- PWA 图标

建议设计：

- 明确支持“离线练习已导入课程”。
- Service Worker 缓存策略区分：
  - 应用壳：强缓存。
  - 课程 runtime 分片：版本化缓存。
  - 用户数据 API：不缓存。

## 技术架构优化设计

### 1. 数据管线模块化

当前数据管线：

```text
Excel -> RawLearningItem -> Lexicon -> RuntimeLearningItem -> 分片 JSON -> 前端加载
```

建议拆成清晰模块：

```text
scripts/data/
  read-excel.ts
  normalize-raw-item.ts
  build-lexicon.ts
  build-runtime-item.ts
  split-course-data.ts
  write-manifest.ts
  validate-runtime.ts
```

收益：

- 单元测试更容易写。
- 外部贡献者更容易理解。
- 后续支持 CSV、JSON、Google Sheet 导入更容易。

保持轻量方式：

- 不引入任务编排框架。
- 仍用 npm scripts 串联。

### 2. 配置系统

建议新增：

```text
enstudy.config.ts
```

示例：

```ts
export default {
  studyDataDir: "./study_data",
  dataDir: "./data",
  storageDir: "./storage/users",
  nlp: {
    enabled: true,
    engine: "stanza",
  },
};
```

读取优先级：

```text
CLI 参数 > 环境变量 > enstudy.config.ts > 默认值
```

### 3. NLP 引擎抽象

当前：

- `scripts/enhance-sentence-analysis.py` 直接用 Stanza。

建议抽象：

```text
scripts/nlp/
  engines/
    stanza.py
    heuristic.ts
  analyze.ts
```

设计接口：

```ts
interface SentenceAnalyzer {
  analyze(text: string, units: SpellingUnit[]): SentenceAnalysisResult;
}
```

保留 Stanza 作为默认高质量方案，同时提供轻量 heuristic fallback。

### 4. 前端状态管理

当前：

- `src/main.ts` 是集中式原生 DOM 状态管理。

优点：

- 简单、无框架、可读。

问题：

- 文件会继续变大。

建议拆分但不引入框架：

```text
src/app/
  state.ts
  router.ts
  render-shell.ts
  render-course-list.ts
  render-practice.ts
  practice-events.ts
  progress.ts
```

保持方式：

- 仍然使用原生 DOM。
- 不引入 Redux、Pinia 等状态库。
- 每个文件只处理一个界面或一类事件。

### 5. 数据加载优化

当前：

- Vite 动态 import 所有 `runtime-items.json`，构建时会产生大量分片。

问题：

- 构建时分片很多。
- 大课程分片会触发 chunk size warning。

建议轻量优化：

- 继续使用 manifest。
- 将 runtime JSON 放到 `public/data/` 或服务端静态目录。
- 前端用 `fetch(runtimeModulePath)` 加载 JSON，而不是把所有 JSON 打进 JS bundle。

收益：

- 构建产物更小。
- 课程数据可以不重新构建前端。
- 用户自己扩展数据更自然。

迁移策略：

1. manifest 中保留 `runtimeFilePath`。
2. 前端优先 `fetch`。
3. 本地开发保留 import fallback。

### 6. 服务端轻量化

当前：

- `server.mjs` 提供本地用户记录。

建议保持：

- 不上数据库。
- 不引入 Express，除非 API 明显变复杂。

可扩展设计：

```text
src/server/
  storage-json.ts
  users-api.ts
  static-server.ts
```

未来可选：

- SQLite adapter。
- WebDAV/云盘同步 adapter。
- 纯本地文件 adapter 仍为默认。

## 开源工程化设计

### 1. 项目信息

需要补齐：

- `LICENSE`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `.env.example`
- `.github/ISSUE_TEMPLATE/`
- `.github/PULL_REQUEST_TEMPLATE.md`
- GitHub Actions CI

推荐许可证：

- 代码：MIT 或 Apache-2.0。
- 示例课程数据：CC BY 4.0 或单独说明。
- 不建议把来源不清晰的教材数据直接作为开源仓库默认数据发布。

### 2. 数据版权边界

开源时必须明确：

- 项目代码可以开源。
- 用户自行导入的数据归用户所有。
- 仓库不应默认携带未确认版权的教材 Excel、PDF 或在线抓取数据。
- 示例数据必须使用自制或可授权内容。

建议仓库结构：

```text
examples/
  study_data/
    Demo Course/
      demo_unit1.xlsx

data/
  .gitkeep
```

并在 `.gitignore` 中忽略真实数据：

```text
data/**/*.json
study_data/
storage/users/
.stanza-resources/
.venv-nlp/
```

### 3. CI 设计

GitHub Actions 建议：

```text
CI:
  npm ci
  npm test
  npm run build

Data CI:
  npm run import:example
  npm run repair:data
  npm run audit:data -- --all
```

NLP CI 可选：

- 默认不跑 Stanza，避免 CI 慢。
- 单独提供手动 workflow。
- 或缓存 `.stanza-resources`。

### 4. Release 设计

发布形式：

- Source release。
- Desktop-free web app zip。
- Optional Docker image。

轻量 Docker 设计：

```Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4173
CMD ["node", "server.mjs"]
```

注意：

- NLP 分析不建议放进默认运行镜像。
- 数据导入镜像可以单独设计。

### 5. 文档体系

建议文档拆分：

```text
README.md                 # 快速开始、功能、架构总览
docs/course-data-format.md # 数据格式
docs/data-pipeline.md      # 数据导入、修复、分析、审计
docs/deployment.md         # 本地、内网、Docker 部署
docs/architecture.md       # 技术架构
docs/contributing.md       # 贡献指南
docs/roadmap.md            # 路线图
```

当前这份 README 先作为完整总览，后续开源时可以再拆分。

## 建议路线图

### Phase 1：开源可运行

- 提供示例数据。
- 改默认路径为项目内 `./study_data`。
- 增加 `.env.example`。
- 增加一键初始化和一键数据更新命令。
- 增加 LICENSE、CONTRIBUTING、SECURITY。
- CI 跑测试和构建。

### Phase 2：数据扩展友好

- 提供 Excel 模板。
- 提供 JSON Schema。
- 生成导入报告和审计报告。
- 支持 CSV/JSON 导入。
- 课程数据改为运行时 fetch，不进入 JS bundle。

### Phase 3：学习体验增强

- 学习记录导入导出。
- 单元学习统计。
- 错题薄独立页面。
- 教师或家长查看报告。
- 更多快捷键说明。
- 更精细的语法标注审核状态。

### Phase 4：生态扩展

- 插件化 NLP 引擎。
- 插件化发音服务。
- 插件化课程导入器。
- 社区课程包规范。
- 可选 Docker 部署。

## 轻量化边界

为了保持项目简单，近期不建议引入：

- 大型前端框架迁移。
- 数据库默认依赖。
- 后端账号系统。
- 微服务。
- 复杂权限系统。
- 在线课程市场。

更合适的方向是：

- 配置更清楚。
- 数据格式更稳定。
- 文档和模板更完善。
- 构建数据和运行数据解耦。
- 核心逻辑测试更充分。

## 贡献者优先任务

适合新贡献者的任务：

- 改进 README 和 docs。
- 增加示例课程。
- 增加数据格式校验测试。
- 增加更多 tokenization 测试。
- 优化移动端样式。
- 改善导入报告输出。

适合熟悉项目后的任务：

- 拆分 `src/main.ts`。
- 拆分数据管线脚本。
- 设计 JSON Schema。
- 运行时 fetch 课程分片。
- 设计 NLP adapter。

## 故障排查

### 页面提示课程数据未生成

运行：

```bash
npm run import:study-data
```

然后重新启动：

```bash
npm run dev
```

### NLP 分析提示模型缺失

运行：

```bash
npm run setup:nlp
```

### 审计出现错误

先运行修复：

```bash
npm run repair:data
```

再运行：

```bash
npm run analyze:data
npm run audit:data -- --all
```

### 构建出现 chunk size warning

这是数据分片较大导致的警告。当前不影响运行。开源化后建议把课程 runtime JSON 改为运行时 fetch，减少 JS bundle 体积。

## 当前状态

当前项目已经具备本地运行、Excel 导入、课程分片、混合练习、用户进度、错题练习、句子/短语成分分析和数据审计能力。

下一步如果要开源，优先完成：

1. 清理真实教材和在线抓取数据，只保留示例数据。
2. 增加 LICENSE 和贡献文档。
3. 改默认数据路径为项目内相对路径。
4. 增加一键初始化和数据更新脚本。
5. 把课程 JSON 从构建 bundle 中移到运行时加载。
