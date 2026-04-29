# 自动化科学 Diagram 绘图应用

面向学术 PPT 场景的 Diagram 自动绘图 MVP。输入中文描述后，系统会生成结构化图、自动布局，并输出 SVG 预览和可编辑 `.pptx` 文件。

核心流程：

```text
Prompt -> DiagramPlan -> DiagramSpec -> LayoutSpec -> SVG/PPTX
```

其中大模型负责生成结构化 `DiagramPlan`，本地代码负责规范化、布局和导出。

## 功能

- 中文自然语言生成学术 Diagram 初稿
- 支持技术路线图、研究框架图、模型结构图和通用 Diagram
- 支持 OpenAI-compatible API
- 未配置模型时自动回退到本地规则生成
- 支持 SVG 预览与 PowerPoint 原生可编辑导出
- 内置基础形状与算子节点，如 `operator.add`、`operator.concat`

## 技术栈

- Next.js
- React
- TypeScript
- Zod
- PptxGenJS

## 快速开始

安装依赖：

```bash
npm install
```

配置 `.env`：

```env
BASE_URL=https://api.openai.com/v1
API_KEY=replace_with_your_api_key
MODEL=gemini-3-pro-all
LLM_REQUEST_TIMEOUT_MS=120000
```

说明：

- `BASE_URL` 可以是 API 根路径，也可以是完整的 `/chat/completions` 地址
- `BASE_URL` 或 `API_KEY` 为空时，系统会自动使用本地规则生成器
- `LLM_REQUEST_TIMEOUT_MS` 为可选项，复杂模型架构图建议使用 `120000` 或更高，最大会限制为 `300000`

启动开发环境：

```bash
npm run dev -- -H 127.0.0.1
```

默认访问地址：

```text
http://127.0.0.1:3000
```

## 常用命令

```bash
npm run dev -- -H 127.0.0.1
npm test
npx tsc --noEmit
npm run build
```

## API

生成 Diagram：

```text
POST /api/generate
```

请求示例：

```json
{
  "prompt": "绘制一个带残差连接的模块，输入旁路连接到 Add 加号节点",
  "diagramType": "model_architecture"
}
```

`diagramType` 可选值：

```text
technical_route
research_framework
model_architecture
general
```

响应示例：

```json
{
  "diagram": {},
  "layout": {},
  "svg": "<svg>...</svg>",
  "plan": {},
  "context": {}
}
```

导出 PPTX：

```text
POST /api/export
```

请求示例：

```json
{
  "diagram": {},
  "layout": {}
}
```

响应类型：

```text
application/vnd.openxmlformats-officedocument.presentationml.presentation
```

## 目录结构

```text
app/
  api/
    generate/route.ts
    export/route.ts
  page.tsx

lib/diagram/
  generate.ts
  llm.ts
  normalize.ts
  layout.ts
  render-svg.ts
  render-pptx.ts
  schema.ts
  types.ts
  shape-library/

tests/
  diagram.test.ts
```

## 形状库

节点可通过 `shapeKey` 引用内置形状。当前内置形状包括：

```text
basic.round_rect
basic.rect
basic.circle
operator.add
operator.concat
operator.multiply
model.block
model.attention
```

## 当前限制

- 还不是完整的可视化编辑器
- 暂不支持基于 `PatchSpec` 的局部修改
- 复杂大图的自动布局仍有优化空间
- 自定义形状模板仍未开放上传
