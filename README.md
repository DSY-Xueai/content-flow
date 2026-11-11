<div align="center">

<h1>Content Flow</h1>

<p>AI 驱动的内容创作与发布工作台</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-22.19%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22.19+" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
</p>

</div>

## 核心用途

**从主题、资讯素材或 Markdown 开始，生成文章，完成排版与配图，推送至微信公众号草稿箱。**

在浏览器中完成选题、素材收集和草稿审核；确认后自动生成封面、正文配图及微信 HTML，文章与图片保存在本地。

## 核心功能

- **资讯工作台**：聚合 [AIHOT](https://aihot.news/) 资讯、热点与日报，支持主题浏览、收藏和素材收集。
- **X 动态追踪**：添加指定账号，读取最新动态并翻译为中文。
- **文章创作**：输入主题、选用素材或导入 Markdown，支持修改草稿；英文 Markdown 可自动翻译。
- **排版与发布**：自动排版、生成封面与配图，推送微信草稿箱；任务支持停止和继续。

## 快速上手

### 1. 安装项目

准备 [Node.js](https://nodejs.org/) 22.19+、npm 和 [Bun](https://bun.sh/)。下载或克隆本仓库后，在项目根目录执行以下 PowerShell 命令：

```powershell
cd aihot-frontend
npm ci
Copy-Item .env.example .env
```

### 2. 配置模型与公众号

编辑 `aihot-frontend/.env`。以下以 **DeepSeek 文本 + 火山方舟 Seedream 生图**为例：

```dotenv
# 文本生成
AGENT_TEXT_API_KEY=your_deepseek_api_key
AGENT_TEXT_BASE_URL=https://api.deepseek.com
AGENT_TEXT_MODEL=deepseek-flash

# 图片生成
AGENT_IMAGE_API_KEY=your_ark_api_key
AGENT_IMAGE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AGENT_IMAGE_MODEL=doubao-seedream-5-0-pro-260628
AGENT_IMAGE_PROVIDER=

# 微信公众号
WECHAT_APP_ID=your_wechat_app_id
WECHAT_APP_SECRET=your_wechat_app_secret
```

- **模型凭证**：在 [DeepSeek](https://platform.deepseek.com/) 和[火山方舟](https://console.volcengine.com/ark)获取 API Key，并[开通 Seedream 模型](https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model)。
- **其他模型**：文本支持 OpenAI 兼容接口；生图支持 OpenAI 兼容接口和 Seedream。分别填写服务地址、Key 和模型名，生图接口类型可留空自动识别。
- **公众号凭证**：在[微信公众平台](https://mp.weixin.qq.com/)获取 AppID、AppSecret，确认账号具备草稿箱接口权限，并将运行机器的公网出口 IP 加入 IP 白名单。

只浏览资讯时无需配置模型和公众号。更改 `.env` 后重启服务，真实密钥保留在本地。

### 3. 启动工作台

在 `aihot-frontend/` 中执行：

```powershell
npm run dev
```

打开 **http://127.0.0.1:5177**。使用期间保持终端运行。

可选：在同一目录打开另一个终端，验证模型连接。该命令会调用文本模型并生成一张测试图片：

```powershell
node scripts/test-model-connection.ts
```

### 4. 开始发文

1. 打开 **Agent 接入**，输入主题；也可先在资讯页将内容加入素材篮，选择“基于素材发文”，或导入本地 Markdown。
2. 检查生成的草稿，直接编辑或填写修改要求后重新生成。
3. 点击 **确认继续**，自动执行排版、封面、正文配图和微信草稿推送。
4. 在微信公众平台的草稿箱预览文章，再完成正式发布。

文章、图片及 HTML 保存在项目根目录的 `pipeline-output/agent/`。

## 项目结构

```text
content-flow/
├── aihot-frontend/       # 浏览器工作台与本地 API
│   ├── .env.example     # 配置模板
│   ├── src/             # 页面与交互
│   └── server/          # 资讯同步与发文流程
├── task_skills/         # 排版、生图与微信发布脚本
├── message_skills/      # 信息采集工作流
└── pipeline-output/     # 本地生成产物
```
