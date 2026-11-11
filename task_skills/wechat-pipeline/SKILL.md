---
name: wechat-pipeline
description: 公众号自动发文流水线：给一个主题 → 自动写文 → 排版 → 配图 → 封面 → 转HTML → 发布草稿。Use when user asks "发公众号", "写一篇公众号文章", "自动发文", or "/wechat-pipeline <topic>".
version: 1.0.0
---

# 公众号自动发文 Pipeline

一条命令完成：写文 → 排版 → 封面 → 配图 → 转 HTML → 发布到公众号草稿箱。

## 用法

```
/wechat-pipeline <主题或简要描述>
/wechat-pipeline 用 AI 做公众号内容的 3 种姿势
/wechat-pipeline --skip-images <主题>    # 跳过配图，只写+排+发
/wechat-pipeline --draft-only <主题>     # 只生成本地 markdown，不发布
/wechat-pipeline --file article.md       # 跳过写作，直接从已有文章开始排版+配图+发布
```

## 依赖 Skills

| 顺序 | Skill | 作用 |
|------|-------|------|
| — | `prompts/writer.md` | 写作系统提示词（内置） |
| ② | `baoyu-format-markdown` | 格式化排版 + 标题优化 + 摘要生成 |
| ③ | `baoyu-cover-image` | 生成封面图 |
| ④ | `baoyu-article-illustrator` | 文章内配图 |
| ⑤ | `baoyu-markdown-to-html` | 转微信兼容 HTML |
| ⑥ | `baoyu-post-to-wechat` | 推送草稿到公众号 |

图像生成后端：`baoyu-imagine`（由 ③④ 内部调用）

## 完整工作流

```
Pipeline Progress:
- [ ] Step 0: 检查脚本依赖
- [ ] Step 1: 确定主题 + 生成文章草稿
- [ ] Step 2: 格式化排版（baoyu-format-markdown）
- [ ] Step 3: 生成封面图（baoyu-cover-image）
- [ ] Step 4: 文章配图（baoyu-article-illustrator）
- [ ] Step 5: 转 HTML（baoyu-markdown-to-html）
- [ ] Step 6: 发布到公众号（baoyu-post-to-wechat）
- [ ] Step 7: 完成报告
```

### Step 0: 检查脚本依赖

Pipeline 依赖的 skill 脚本需要 node_modules。首次运行或依赖缺失时自动安装。

**检查并安装**（静默执行，无需用户确认）：

```bash
# 需要检查的 skill 脚本目录（通过 ~/.claude/skills/ 符号链接定位）
SKILLS_BASE="$HOME/.claude/skills"
for skill in baoyu-format-markdown baoyu-markdown-to-html baoyu-post-to-wechat; do
  SCRIPTS_DIR="$SKILLS_BASE/$skill/scripts"
  if [ -f "$SCRIPTS_DIR/package.json" ] && [ ! -d "$SCRIPTS_DIR/node_modules" ]; then
    echo "Installing dependencies for $skill..."
    (cd "$SCRIPTS_DIR" && bun install)
  fi
done
```

如果所有 `node_modules` 都存在，此步骤秒过。只有缺失时才安装。

### Step 1: 生成文章草稿

**输入判断**：

| 输入 | 处理 |
|------|------|
| `--file <path>` | 跳过写作，读取已有文件，进入 Step 2 |
| 主题文字 | 使用写作提示词生成文章 |

**写作流程**：

1. 读取 `{baseDir}/prompts/writer.md` 作为写作指导
2. 基于用户给的主题，生成完整文章（markdown + frontmatter）
3. 创建工作目录（每篇文章独立子目录，避免同日多篇文章互相干扰）：

```bash
WORK_DIR="$(pwd)/pipeline-output/$(date +%Y-%m-%d)/{slug}"
mkdir -p "$WORK_DIR"
```

4. 保存草稿到 `$WORK_DIR/{slug}.md`
5. **展示草稿给用户确认**，使用 AskUserQuestion：

```
文章草稿已生成（约 XXXX 字）。

1. 满意，继续下一步（Recommended）
2. 需要修改，告诉我哪里要改
3. 重新生成
```

**CRITICAL**：必须等用户确认后再继续。这是唯一需要人工确认的环节。

### Step 2: 格式化排版

调用 `baoyu-format-markdown` 处理 Step 1 输出的 markdown 文件。

此 skill 会：
- 分析内容结构
- 优化标题（提供候选标题让用户选择）
- 生成 summary 和 description
- 加粗关键句、添加标题层级
- 运行 CJK 排版脚本（中英文间距、全角引号等）

输出文件：`{slug}-formatted.md`

### Step 3: 生成封面图

调用 `baoyu-cover-image` 处理格式化后的文件。

```bash
# 使用 EXTEND.md 默认配置：conceptual + elegant + flat-vector + 3:4
/baoyu-cover-image {slug}-formatted.md --quick
```

如果 EXTEND.md 设置了 `quick_mode: false`，skill 会让用户选择封面参数。

输出：`imgs/cover.png`

封面生成后，更新 frontmatter 的 `coverImage` 字段。

### Step 4: 文章配图

调用 `baoyu-article-illustrator` 处理格式化后的文件。

此 skill 会：
- 分析文章，识别需要配图的位置
- 确认配图设置（类型、风格、密度）
- 生成插图并嵌入文章

输出：`imgs/` 目录下的配图文件 + 更新后的 markdown

**`--skip-images` 模式**：跳过 Step 3 和 Step 4。

### Step 5: 转 HTML

调用 `baoyu-markdown-to-html` 转换最终 markdown。

```bash
# 主题和配色从 EXTEND.md 自动读取（grace + blue）
baoyu-markdown-to-html {slug}-formatted.md
```

输出：`{slug}-formatted.html`

### Step 6: 发布到公众号

调用 `baoyu-post-to-wechat` 发布。

**CRITICAL**：传入原始 markdown 文件（不是 HTML），让 wechat-api.ts 内部处理转换和图片上传。

```bash
# API 方式，主题/配色从 EXTEND.md 读取
baoyu-post-to-wechat {slug}-formatted.md
```

发布方式和参数从 EXTEND.md 自动读取（api + grace + blue + 派小芯）。

**`--draft-only` 模式**：跳过 Step 6，只在本地生成完整的 markdown + HTML。

### Step 7: 完成报告

```
🎉 公众号发文完成！

主题：[topic]
标题：[title]
字数：[word count]

文件：
• 草稿：pipeline-output/yyyy-MM-dd/{slug}/{slug}.md
• 排版：pipeline-output/yyyy-MM-dd/{slug}/{slug}-formatted.md
• 封面：pipeline-output/yyyy-MM-dd/{slug}/imgs/cover.png
• 配图：pipeline-output/yyyy-MM-dd/{slug}/imgs/01-*.png ...
• HTML：pipeline-output/yyyy-MM-dd/{slug}/{slug}-formatted.html

发布：
✓ 已推送到公众号草稿箱
→ 管理草稿：https://mp.weixin.qq.com（登录后进入「内容管理」→「草稿箱」）
```

## 工作目录结构

```
pipeline-output/
└── yyyy-MM-dd/
    └── {slug}/                      # 每篇文章独立目录
        ├── {slug}.md                    # 原始草稿
        ├── {slug}-analysis.md           # 内容分析（format-markdown 产出）
        ├── {slug}-formatted.md          # 格式化后的文章
        ├── {slug}-formatted.html        # 微信 HTML
        └── imgs/
            ├── cover.png                # 封面图
            ├── outline.md               # 配图大纲
            ├── prompts/                 # 配图提示词
            │   └── NN-{type}-{slug}.md
            └── NN-{type}-{slug}.png     # 配图文件
```

## 快捷模式

| 标志 | 效果 |
|------|------|
| `--skip-images` | 跳过封面 + 配图（Step 3、4），适合纯文字文章 |
| `--draft-only` | 只在本地生成，不发布到公众号（跳过 Step 6）|
| `--file <path>` | 跳过写作（Step 1），从已有文章开始 |
| `--quick` | 所有 skill 跳过交互确认，全部使用默认配置 |
