# 英语单词学习项目

当前主版本改为“简单单词学习版”。之前的复杂游戏版已备份到 `legacy-game/`。

## 新版入口

启动带服务端记录的本地服务：

```bash
cd /Users/ripflowers/Documents/enstudy
node server.mjs
```

服务端会把学习者记录保存到：

```text
storage/users/<用户id>.json
```

如果只想临时预览，也可以启动静态服务；静态服务下不会保存到服务端文件，只会保存到浏览器 localStorage：

```bash
cd /Users/ripflowers/Documents/enstudy
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/primary.html
http://127.0.0.1:4173/junior.html
```

## 新版功能

- 小学版和中学版分成两个独立页面。
- 支持输入学习者名字；Node 服务端模式下会检查重名，并把学习记录保存为本地 JSON 文件。
- 每次只展示一个单词。
- 展示多个中文释义。
- 展示一张较小的关键词图片，主学习区域尽量一屏展示。
- 支持播放单词读音。
- 展示例句和例句中文释义。
- 拼对前例句里的目标词和相关词形会遮罩，避免照抄；拼对后动态显示完整例句。
- 词性显示中文名称。
- 根据词性展示关联记忆：
  - 动词：第三人称单数、过去式、过去分词、现在分词。
  - 名词：单数、复数。
  - 形容词：比较级、最高级。
  - 其他词性：展示词性和记忆提示。
- 已融合 `vxiaozhi/vocabulary-book-by-deepseek` 的增强数据：
  - 多释义和词性释义。
  - 更完整的例句和中文翻译。
  - 常用搭配。
  - 词根、词缀、图像记忆提示。
  - 词形变化仍使用本项目本地校验规则。
  - 优先使用 `result/word_imgs` 中已生成的图片，并缓存到本地。
  - 基于 `draw_prompt` 的免密钥图片 URL，并保留原关键词图片兜底。
- 字母卡片拼写：
  - 目标单词字母 + 混淆字母。
  - 卡片展示小写字母。
  - 点击卡片组合单词。
- 点击已选中的卡片可以取消选择。
- 撤回会取消上一个字母；清空会重置当前拼写。已学单词点击撤回/清空会重新进入遮罩练习。
  - 拼对播放夸奖音效。
  - 拼错播放错误音效。
- 拼对后可以上一个/下一个。
- 用 `localStorage` 记录当前学到第几个词，并记录每个词是否已学。
- Node 服务端模式下会同步保存当前进度、已学、错词、按天学习记录。
- 增加选择题练习模式：
  - 英文选中文。
  - 中文选英文。
  - 中文释义只取前三个。
  - 每个模式按“小学/中学 + 类型 + 模式”单独记录练习结果。
- 右侧词表已移除，改为“查看全部词表”按钮，分页展示所有词、释义、中文词性、例句和例句释义。

## 数据文件

新词源由现有 compact 词库生成，并融合 `vendor/vocabulary-book-by-deepseek/` 下的 Apache-2.0 开源增强数据：

```text
simple/data/primary_words.json
simple/data/junior_words.json
```

更新远程增强详情：

```bash
node tools/download_vxiaozhi_details.mjs
```

下载或生成单词图片缓存：

```bash
node tools/download_vxiaozhi_images.mjs
```

重新生成前端词库：

```bash
node tools/build_simple_sources.mjs
```

当前图片字段优先级：

1. 本地图片缓存：`simple/images/words/<word>.jpg`。
2. 远程 `result/word_imgs` 已生成图片，下载后写入本地缓存。
3. 如果远程没有图片但有 `draw_prompt`，使用免密钥图片生成接口生成并缓存。
4. 如果都没有，使用关键词图片 URL 兜底。

免密钥生成接口：

```text
https://image.pollinations.ai/prompt/<draw_prompt>
```

如果没有增强图片提示，则使用免密钥关键词图片 URL：

```text
https://loremflickr.com/640/420/<word>
```

注意：外部项目的 AI 详情中可能存在词形错误，本项目不会直接导入外部词形结论；复数、动词变形、形容词比较级仍由本地保守规则生成。

## 旧版备份

复杂游戏版已复制到：

```text
legacy-game/
```

包含旧版 `index.html`、`src/`、`styles/` 和旧 README。

## 测试

1. 打开小学版，确认能加载 515 个小学词。
2. 打开中学版，确认能加载 2000 个中学词。
3. 检查单词是否展示多个中文释义。
4. 检查图片是否能加载；如果在线图片服务短暂失败，刷新即可。
5. 点击“播放单词读音”，确认能朗读。
6. 检查例句是否同时展示英文和中文释义。
7. 对动词 `go` 检查是否展示中文词性“动词”，并在拼对后展示 `goes / went / gone / going`、常用搭配和词根说明。
8. 点击字母卡片拼写单词，点击已选卡片应能取消选择；正确和错误都应有不同音效。
9. 拼对后测试“上一个”和“下一个”。
10. 点击“查看全部词表”，确认分页词表展示释义、中文词性、例句和例句释义。
11. 刷新页面，确认进度能保存。
12. 检查 `air` 不显示复数，`afternoon` 显示 `afternoons`，`homework` 不显示 `homeworks`。
