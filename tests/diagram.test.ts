import test from "node:test";
import assert from "node:assert/strict";
import { createGenerationContext, generateDiagram } from "../lib/diagram/generate.ts";
import {
  buildPlannerUserPayload,
  createLlmDiagramPlan,
  createPlanningPolicy
} from "../lib/diagram/llm.ts";
import { layoutDiagram } from "../lib/diagram/layout.ts";
import { normalizeDiagramSpec } from "../lib/diagram/normalize.ts";
import { renderPptx } from "../lib/diagram/render-pptx.ts";
import { renderSvg } from "../lib/diagram/render-svg.ts";
import { getShapeDefinition } from "../lib/diagram/shape-library/registry.ts";

process.env.BASE_URL = "";
process.env.API_KEY = "";

test("generates transformer diagram with encoder-decoder structure", async () => {
  const result = await generateDiagram({
    prompt: "绘制一个 Transformer Encoder-Decoder 架构图"
  });

  assert.equal(result.diagram.type, "model_architecture");
  assert.ok(result.diagram.nodes.length >= 20);
  assert.ok(result.diagram.groups.some((group) => group.title.includes("Encoder")));
  assert.ok(result.diagram.groups.some((group) => group.title.includes("Decoder")));
  assert.ok(result.diagram.nodes.some((node) => node.shapeKey === "operator.add"));
  assert.ok(result.diagram.nodes.some((node) => node.shapeKey === "operator.concat"));
  assert.ok(result.diagram.nodes.some((node) => /LayerNorm/.test(node.label)));
  assert.ok(result.diagram.nodes.some((node) => /Cross-Attention/.test(node.label)));
  assert.ok(result.diagram.edges.some((edge) => edge.style === "dashed"));
  assert.match(result.svg, /Transformer Encoder-Decoder/);
});

test("normalizes invalid edges and duplicate node ids", () => {
  const diagram = normalizeDiagramSpec({
    title: "测试图",
    type: "general",
    nodes: [
      { id: "a", label: "输入" },
      { id: "a", label: "处理" }
    ],
    edges: [
      { id: "e", from: "a", to: "missing" },
      { id: "e", from: "a", to: "a_2" }
    ]
  });

  assert.deepEqual(
    diagram.nodes.map((node) => node.id),
    ["a", "a_2"]
  );
  assert.equal(diagram.edges.length, 1);
});

test("layout keeps nodes inside 16:9 canvas", () => {
  const diagram = normalizeDiagramSpec({
    title: "研究框架",
    type: "research_framework",
    nodes: [
      { id: "input", label: "输入层", groupId: "g1" },
      { id: "method", label: "方法层", groupId: "g2" },
      { id: "output", label: "输出层", groupId: "g3" }
    ],
    edges: [
      { id: "e1", from: "input", to: "method" },
      { id: "e2", from: "method", to: "output" }
    ],
    groups: [
      { id: "g1", title: "输入", nodeIds: ["input"] },
      { id: "g2", title: "方法", nodeIds: ["method"] },
      { id: "g3", title: "输出", nodeIds: ["output"] }
    ]
  });

  const layout = layoutDiagram(diagram);
  assert.equal(layout.canvas.width, 1280);
  assert.equal(layout.canvas.height, 720);
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0);
    assert.ok(node.y >= 0);
    assert.ok(node.x + node.width <= layout.canvas.width);
    assert.ok(node.y + node.height <= layout.canvas.height);
  }
});

test("svg renderer emits editable preview primitives", () => {
  const diagram = normalizeDiagramSpec({
    title: "简单流程",
    type: "general",
    nodes: [
      { id: "a", label: "数据输入" },
      { id: "b", label: "模型分析" }
    ],
    edges: [{ id: "e1", from: "a", to: "b" }]
  });
  const layout = layoutDiagram(diagram);
  const svg = renderSvg(diagram, layout);

  assert.match(svg, /^<svg/);
  assert.match(svg, /<rect/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /数据输入/);
});

test("shape library resolves operator definitions", () => {
  const add = getShapeDefinition("operator.add");
  const concat = getShapeDefinition("operator.concat");

  assert.equal(add.defaultLabel, "+");
  assert.equal(add.defaultSize.width, 44);
  assert.equal(add.connectionPolicy.preferredFlow, "merge");
  assert.equal(concat.defaultLabel, "Concat");
});

test("generates residual diagram with editable add operator node", async () => {
  const result = await generateDiagram({
    prompt: "绘制一个带残差连接的模块"
  });
  const addNode = result.diagram.nodes.find((node) => node.id === "add");
  const addLayout = result.layout.nodes.find((node) => node.id === "add");

  assert.equal(addNode?.kind, "operator");
  assert.equal(addNode?.shapeKey, "operator.add");
  assert.equal(addLayout?.width, 44);
  assert.equal(addLayout?.height, 44);
  assert.ok(result.diagram.edges.some((edge) => edge.from === "input" && edge.to === "add"));
  assert.match(result.svg, /<ellipse/);
  assert.match(result.svg, />\+<\/text>/);
});

test("specific prompt is parsed as explicit plan without inferred modules", async () => {
  const result = await generateDiagram({
    prompt:
      "输入是多模态数据，后面接数据预处理，再接特征提取和预测模型，知识图谱模块从左侧虚线连接到预测模型，最后输出诊断结果。"
  });
  const labels = result.plan.modules.map((module) => module.label);

  assert.equal(result.plan.intentType, "explicit");
  assert.ok(result.plan.modules.every((module) => module.source === "user_explicit"));
  assert.ok(result.plan.connections.every((connection) => connection.source === "user_explicit"));
  assert.deepEqual(labels, [
    "多模态数据",
    "数据预处理",
    "特征提取",
    "预测模型",
    "诊断结果",
    "知识图谱"
  ]);
  assert.ok(!labels.includes("实验验证"));
  assert.ok(!labels.includes("应用验证"));
  assert.ok(
    result.plan.connections.some((connection) => {
      const from = result.plan.modules.find((module) => module.id === connection.from);
      const to = result.plan.modules.find((module) => module.id === connection.to);
      return from?.label === "知识图谱" && to?.label === "预测模型" && connection.style === "dashed";
    })
  );
  assert.ok(
    !result.plan.connections.some((connection) => {
      const from = result.plan.modules.find((module) => module.id === connection.from);
      const to = result.plan.modules.find((module) => module.id === connection.to);
      return from?.label === "诊断结果" && to?.label === "知识图谱";
    })
  );
});

test("generates concat diagram with concat operator shape", async () => {
  const result = await generateDiagram({
    prompt: "绘制两个分支特征拼接融合，通过 Concatenate 输出融合特征"
  });
  const concatNode = result.diagram.nodes.find((node) => node.id === "concat");
  const concatLayout = result.layout.nodes.find((node) => node.id === "concat");

  assert.equal(concatNode?.shapeKey, "operator.concat");
  assert.equal(concatLayout?.width, 64);
  assert.equal(concatLayout?.height, 44);
  assert.match(result.svg, /Concat/);
});

test("pptx renderer exports operator shapes as editable ppt objects", async () => {
  const result = await generateDiagram({
    prompt: "绘制一个带残差连接的模块"
  });
  const buffer = await renderPptx(result.diagram, result.layout);

  assert.ok(buffer.byteLength > 10000);
});

test("llm planner uses BASE_URL and API_KEY with chat completions format", async () => {
  const originalFetch = globalThis.fetch;
  process.env.BASE_URL = "https://llm.example.test/v1";
  process.env.API_KEY = "test-key";
  process.env.MODEL = "test-model";

  type RequestBody = {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: { type: string };
  };
  let requestedUrl = "";
  let requestedAuth = "";
  let requestedModel = "";
  const requestedBodies: RequestBody[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedAuth = String((init?.headers as Record<string, string>).Authorization);
    const parsedBody = JSON.parse(String(init?.body)) as RequestBody;
    requestedBodies.push(parsedBody);
    requestedModel = parsedBody.model;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subject: "测试图",
                diagramType: "general",
                intentType: "conceptual",
                mainIdea: "测试 LLM 结构化输出",
                modules: [
                  {
                    id: "input",
                    label: "输入",
                    shapeKey: "basic.round_rect",
                    source: "model_inferred"
                  },
                  { id: "add", label: "+", shapeKey: "operator.add", source: "model_inferred" },
                  {
                    id: "output",
                    label: "输出",
                    shapeKey: "basic.round_rect",
                    source: "model_inferred"
                  }
                ],
                connections: [
                  { from: "input", to: "add", source: "model_inferred" },
                  { from: "add", to: "output", source: "model_inferred" }
                ]
              })
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }) as typeof fetch;

  try {
    const result = await createLlmDiagramPlan(createGenerationContext("测试 LLM 调用"));

    assert.equal(result.ok, true);
    assert.equal(requestedUrl, "https://llm.example.test/v1/chat/completions");
    assert.equal(requestedAuth, "Bearer test-key");
    assert.equal(requestedModel, "test-model");
    assert.equal(requestedBodies.length, 1);
    const body = requestedBodies[0];
    assert.equal(body.response_format.type, "json_object");
    assert.match(body.messages[0]?.content ?? "", /DiagramPlan/);
    assert.match(body.messages[1]?.content ?? "", /planningPolicy/);
    assert.equal(result.ok && result.plan.modules[1].shapeKey, "operator.add");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.BASE_URL = "";
    process.env.API_KEY = "";
    process.env.MODEL = "";
  }
});

test("planning policy disables inference for concrete instructions", () => {
  const context = createGenerationContext(
    "输入是多模态数据，后面接数据预处理，最后输出诊断结果"
  );
  const policy = createPlanningPolicy(context.rawPrompt);
  const payload = buildPlannerUserPayload(context, policy);

  assert.equal(policy.intentType, "explicit");
  assert.equal(policy.allowInference, false);
  assert.equal(payload.planningPolicy.defaultSource, "user_explicit");
});

test("planning policy treats transformer module lists as mixed architecture requests", () => {
  const context = createGenerationContext(
    "绘制一个 Transformer Encoder-Decoder 架构图，包含输入嵌入、位置编码、编码器堆叠、解码器堆叠、Linear、Softmax 和输出概率"
  );
  const policy = createPlanningPolicy(context.rawPrompt);

  assert.equal(policy.intentType, "mixed");
  assert.equal(policy.allowInference, true);
});
