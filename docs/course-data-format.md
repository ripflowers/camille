# Course Data Update Format

This project can import Excel workbooks from `/Users/ripflowers/Downloads/study_data`.

## Folder Layout

```text
study_data/
  七年级英语上/
    starter_unit1_key_info_structured_v5_final_raw_structure.xlsx
    unit1_you_and_me_final_raw_structure.xlsx
  七年级英语下/
    g7b_unit1_animal_friends_key_info_structured.xlsx
```

The first folder level is the course pack name. Each Excel file under it is treated as one unit or part of one unit.

## Required Sheet

Use the first sheet, or a sheet whose name contains `学习内容`.

## Required Columns

| Column | Required | Notes |
| --- | --- | --- |
| 课程包ID | No | Stable pack id if you have one. |
| 年级 | Recommended | Example: `七年级下册`. |
| 单元ID | Recommended | Example: `Unit 1`, `Starter Unit 1`. |
| 单元标题 | Recommended | Example: `Animal Friends`. |
| Section | No | Used as secondary location text. |
| 来源页码 | No | Kept in raw data. |
| 来源类型 | No | Kept in raw data. |
| 重要性等级 | No | Kept in raw data. |
| 内容ID | Recommended | Must be unique. If missing or duplicated, importer creates a stable fallback id and logs it. |
| 类型 | Yes | Supports `单词`, `短语`, `句子`, `缩写`, `word`, `phrase`, `sentence`, `abbreviation`. |
| 英文内容 | Yes | The answer text. Keep contractions complete, such as `I'm`, `It's`. |
| 中文释义 | Recommended | Main prompt shown to students. |
| 音频文本 | No | Uses `英文内容` if empty. |
| 音标 | No | Used for hints. |
| 词性 | No | Used for hints. |
| 句型结构 | No | Kept as metadata. |
| 句子拆分分析JSON（原始v2） | No | Optional. Stanza analysis can regenerate component data for sentences and phrases. |
| 备注 | No | Kept in raw data. |
| 质量状态 | No | Kept in raw data. |

## Generated Files

After importing, the app uses:

```text
data/raw-items.json
data/lexicon.json
data/runtime-items.json
data/legacy/<课程包>/lexicon.json
data/legacy/<课程包>/courses/<单元>/raw-items.json
data/legacy/<课程包>/courses/<单元>/runtime-items.json
data/legacy/<课程包>/courses/<单元>/source.json
data/learning-manifest.json
```

## Update Commands

```bash
npm run import:study-data
npm run repair:data
npm run analyze:data
npm run audit:data -- --all
npm test
npm run build
```

`analyze:data` uses Stanza to generate concise sentence and phrase component annotations. Run `npm run setup:nlp` once before the first analysis.
