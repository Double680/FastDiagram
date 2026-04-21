# 自动化科学 Diagram 绘图应用

这是一个面向学术 PPT 场景的 Diagram 自动绘图 MVP。用户输入中文自然语言描述后，系统会生成结构化 Diagram，自动布局，并输出 SVG 预览和可编辑 `.pptx` 文件。

当前版本重点跑通：

```text
Prompt -> GenerationContext -> DiagramPlan -> DiagramSpec -> LayoutSpec -> SVG/PPTX
```

其中大模型负责生成结构化 `DiagramPlan`，本地代码负责结构规范化、布局、SVG 预览和 PPTX 原生对象导出。

## 功能概览

- 中文自然语言生成学术 Diagram 初稿。
- 支持技术路线图、研究框架图、方法/模型结构图和通用 Diagram。
- 支持 OpenAI-compatible 大模型 API。
- 大模型不可用或未配置时自动回退到本地规则生成。
- 支持内置形状库 `shapeKey`。
- 支持残差连接中的 `operator.add` 圆形加号节点。
- 支持特征拼接中的 `operator.concat` 节点。
- 支持 SVG 页面预览。
- 支持导出 PowerPoint 原生可编辑对象。
- 点击重新生成时会清空旧图，避免新旧内容混杂。

## 技术栈

- Next.js
- React
- TypeScript
- Zod
- PptxGenJS

## 目录结构

```text
app/
  page.tsx
  api/
    generate/route.ts
    export/route.ts

lib/
  diagram/
    generate.ts
    llm.ts
    schema.ts
    normalize.ts
    layout.ts
    render-svg.ts
    render-pptx.ts
    types.ts
    shape-library/
      registry.ts
      types.ts
      basic-shapes.ts
      operator-shapes.ts
      model-shapes.ts

tests/
  diagram.test.ts
```

## 环境变量

项目使用 `.env` 配置大模型 API。

```env
BASE_URL=
API_KEY=
MODEL=gemini-3-pro-all
```

也可以参考 `.env.example`：

```env
BASE_URL=https://api.openai.com/v1
API_KEY=replace_with_your_api_key
MODEL=gemini-3-pro-all
```

`BASE_URL` 支持两种形式。

第一种是 API 根路径：

```env
BASE_URL=https://api.openai.com/v1
```

系统会自动拼接为：

```text
https://api.openai.com/v1/chat/completions
```

第二种是完整 chat completions endpoint：

```env
BASE_URL=https://your-provider.example.com/v1/chat/completions
```

如果 `BASE_URL` 或 `API_KEY` 为空，系统不会请求大模型，会自动使用本地规则生成器兜底。

## 安装依赖

```bash
npm install
```

## 本地开发

```bash
npm run dev -- -H 127.0.0.1
```

默认访问：

```text
http://127.0.0.1:3000
```

如果 `3000` 端口被占用，Next.js 会自动使用其它可用端口，例如：

```text
http://127.0.0.1:3001
```

## 测试

```bash
npm test
```

测试覆盖：

- 基础 Diagram 生成。
- 结构规范化。
- 自动布局边界。
- SVG 渲染。
- Shape Library。
- `operator.add` 和 `operator.concat`。
- PPTX 导出冒烟测试。
- 大模型 API 调用参数的 mock 测试。

## 类型检查

```bash
npx tsc --noEmit
```

## 生产构建

```bash
npm run build
```

## API 说明

### 生成 Diagram

```text
POST /api/generate
```

请求：

```json
{
  "prompt": "绘制一个带残差连接的模块，输入旁路连接到 Add 加号节点",
  "diagramType": "model_architecture"
}
```

`diagramType` 可选：

```text
technical_route
research_framework
model_architecture
general
```

响应：

```json
{
  "diagram": {},
  "layout": {},
  "svg": "<svg>...</svg>",
  "plan": {},
  "context": {}
}
```

### 导出 PPTX

```text
POST /api/export
```

请求：

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

## Shape Library

节点通过 `shapeKey` 引用内置形状库。

示例：

```json
{
  "id": "add",
  "label": "+",
  "kind": "operator",
  "shapeKey": "operator.add"
}
```

当前内置形状：

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

形状库定义内容包括：

- 默认尺寸。
- 形状类别。
- 默认文字。
- 连接锚点策略。
- SVG/PPTX 渲染所需的 primitive 和样式信息。

## 大模型生成策略

生成入口在：

```text
lib/diagram/generate.ts
```

实际流程：

```text
用户 prompt
-> createGenerationContext
-> createLlmDiagramPlan
-> planToDiagramSpec
-> normalizeDiagramSpec
-> layoutDiagram
-> renderSvg
```

如果大模型不可用：

```text
用户 prompt
-> createGenerationContext
-> createRuleBasedPlan
-> planToDiagramSpec
-> normalizeDiagramSpec
-> layoutDiagram
-> renderSvg
```

大模型调用在：

```text
lib/diagram/llm.ts
```

系统会要求模型只输出严格 JSON 的 `DiagramPlan`，不允许输出 Markdown、解释文本、坐标、颜色、SVG 或 PPTX 字段。

## 示例 Prompt

```text
绘制一个 Transformer Encoder-Decoder 架构图，包含输入嵌入、位置编码、编码器堆叠、解码器堆叠、Linear、Softmax 和输出概率，编码器输出用虚线连接到解码器。
```

```text
绘制一个带残差连接的模块，输入旁路连接到 Add 加号节点。
```

```text
绘制两个分支特征拼接融合，通过 Concatenate 输出融合特征。
```

```text
绘制一个项目申请书技术路线图，包括需求分析、数据采集、模型构建、实验验证和成果输出。
```

## 当前限制

- 当前还不是完整可视化编辑器。
- 自然语言局部修改尚未接入 `PatchSpec`。
- 布局算法仍是轻量自定义布局，复杂大型图可能需要继续优化。
- Shape Library 目前是代码内置，不支持用户上传自定义形状模板。
- PPTX 导出重点保证可编辑对象，不追求期刊终稿级视觉效果。

## 后续方向

- 接入 `PatchSpec` 支持局部修改。
- 增加历史版本与恢复能力。
- 扩展更多学术模型结构图形状。
- 优化多分支、残差、跨层连接的自动布局。
- 增加可视化编辑器，用于拖动模块、修改文字和手动调整连线。
