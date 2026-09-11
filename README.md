# AI Key Vault

一个更适合自己长期用的 AI API Key 管理小工具。

它不是那种花里胡哨的大平台，核心思路就一件事: 把手上的 Key、地址、模型先收整齐，再用最省事的方式判断它现在到底还能不能用、能看到哪些模型、哪个模型更适合拿来当默认模型。

如果你手里经常有多套 OpenAI 兼容渠道，或者总在不同平台之间来回复制 Key，这个项目基本就是为这种场景准备的。

## 现在已经支持什么

### 🔐 配置管理

- 本地保存多组配置，包含名称、Base URL、API Key、默认模型
- 自动兼容旧版本本地数据，打开页面后会尽量把历史配置接回来
- 支持复制单条配置，也支持复制全部配置
- 支持导出 `.txt` 和 `.md`

### 📥 导入解析

- 支持粘贴解析，能识别 `curl`、JSON、环境变量风格文本、结构化文本块、`ccswitch://` 链接
- 支持导入 `cc-switch` 导出的 `.sql` 文件，也支持直接粘贴 SQL 文本
- 支持一次粘贴多个配置，解析后可批量直接新增
- 支持把解析结果先回填到表单，再决定要不要保存

### ✅ 多协议可用性测试

- 支持单条测试，也支持一键测试全部配置
- 自动探测 OpenAI Chat Completions（流式/普通）、OpenAI Responses 和 Claude Messages
- 成功结果会明确显示实际命中的 `chat`、`response` 或 `message` 协议
- Claude 模型优先使用官方 Messages 请求格式测试
- 测试结果会记录状态、错误详情、协议、回复内容和最近测试时间
- 遇到 429、TPM、RPM 或分钟额度限制时自动等待重试；优先采用 `Retry-After`，缺失时按 5、15、30、65 秒退避

### 🧠 模型识别

- 支持使用 Bearer 和 Claude `x-api-key` 两种鉴权方式读取模型列表
- 识别完成后会给出推荐模型，并支持复制模型列表
- 自动从模型名称识别 GPT Image、DALL·E、Flux、Stable Diffusion、Imagen、Ideogram、Recraft、Seedream、CogView、Qwen Image 等主流图像生成模型
- 支持在识别结果里直接切换当前模型


### 🖼️ 图像模型测试

- 使用 OpenAI 兼容的 `POST /v1/images/generations` 接口进行真实生图测试
- 可以从自动识别的图像模型中选择，也可以手工填写模型名称
- 同时兼容返回 Base64 图片和临时图片 URL 的渠道
- 测试成功后展示生成图片、协议、耗时和修订后的提示词
- 生图会产生真实模型费用，必须由用户主动点击触发

### ⚡ 性能评测

- 支持按模型做 1 到 3 轮测速
- 会展示平均耗时、中位耗时、首字时间、成功率、稳定性
- 支持按模型名或 tag 搜索模型，方便从长列表里筛选
- 会自动汇总最快模型、首字最快模型、最稳模型，并给出一个默认推荐模型
- 会自动跳过明显不适合做对话测速的模型，比如 embedding、rerank、部分图像类模型
- 测速请求同样使用自适应限流退避，等待期间不会启动下一轮请求

### 🔗 CC Switch 联动

- 支持导出到 CC Switch，也支持直接唤起 CC Switch 导入
- 当前已适配的目标 App 包括 `Claude`、`Codex`、`Gemini`、`OpenCode`、`OpenClaw`

## 这个项目适合谁

- 手上有多套 AI API Key，想统一收纳的人
- 经常会忘记某个渠道地址、模型名、Key 放哪了的人
- 想快速判断某个 Key 还能不能打通的人
- 想先识别模型，再挑一个更稳、更快默认模型的人
- 想要一个轻量、自己部署、自己掌控数据的小工具的人

## 隐私和数据说明

配置和测试结果默认保存在浏览器本地的 `localStorage`，项目不接数据库。

- 默认静态构建由浏览器直连目标 API，目标地址必须允许跨域访问（CORS）；
- 自托管时可通过同源服务端代理执行测试，具体生产目录、凭据和 Tunnel 配置不纳入仓库；
- 页面脚本或浏览器扩展如果被恶意控制，仍可能读取 `localStorage` 中的 Key，不要在不可信环境中使用；
- HTTP 上游会明文传输 Key，仅应用于明确可信的测试地址。

## 快速开始

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 就能开始用。

## 打包与本地预览

```bash
npm run build
npm run start
```

`npm run build` 会生成纯静态 `out/` 目录，`npm run start` 使用项目内置的零依赖静态服务器预览。

## 部署状态

GitHub Pages 和 Cloudflare Workers 均已停用。仓库不包含实际生产运行目录、访问凭据或 Tunnel 配置；部署信息仅记录在本地忽略文件中，不随 Git 同步。

## Docker 一键部署

项目已经带好 `Dockerfile` 和 `docker-compose.yml`，本机装好 Docker 后，直接执行:

```bash
npm run docker:deploy
```

默认会自动构建镜像并在后台启动容器，然后访问 [http://localhost:3000](http://localhost:3000)。

常用命令:

```bash
npm run docker:logs
npm run docker:down
```

如果你不想走 `npm` 脚本，也可以直接用:

```bash
docker compose up -d --build
```

## 使用方式很简单

1. 填一条配置，或者直接把现成的 `curl` / JSON / 文本块粘进来
2. 点“保存配置”或者“粘贴并直接新增”
3. 先做连通性测试，确认地址、Key、模型以及实际命中的协议
4. 再做模型识别，查看文本模型和自动识别出的图像模型
5. 图像模型使用“图像测试”生成测试图；文本模型可以进入性能评测
6. 如果文本模型很多，跑几轮后挑一个更适合日常使用的默认模型

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- ECharts

## 友链

- [LinuxDo 社区](https://linux.do/)
