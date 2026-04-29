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
import type { DiagramLayoutConstraint, LayoutNode } from "../lib/diagram/types.ts";

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

test("grouped research framework layout avoids overlaps for multi-input multi-output diagrams", () => {
  const diagram = normalizeDiagramSpec({
    title: "多模态智能诊断研究框架图",
    type: "research_framework",
    nodes: [
      { id: "clinical", label: "临床表型数据" },
      { id: "image", label: "医学影像数据" },
      { id: "omics", label: "组学数据" },
      { id: "emr", label: "电子病历文本" },
      { id: "preprocess", label: "数据预处理" },
      { id: "feature", label: "特征提取" },
      { id: "fusion", label: "多模态特征融合", shapeKey: "operator.concat" },
      { id: "knowledge", label: "知识增强模块" },
      { id: "model", label: "预测模型", shapeKey: "model.block" },
      { id: "risk", label: "疾病风险评分" },
      { id: "classification", label: "诊断分类结果" },
      { id: "report", label: "可解释性报告" }
    ],
    edges: [
      { id: "e1", from: "clinical", to: "preprocess" },
      { id: "e2", from: "image", to: "preprocess" },
      { id: "e3", from: "omics", to: "preprocess" },
      { id: "e4", from: "emr", to: "preprocess" },
      { id: "e5", from: "preprocess", to: "feature" },
      { id: "e6", from: "feature", to: "fusion" },
      { id: "e7", from: "fusion", to: "model" },
      { id: "e8", from: "model", to: "risk" },
      { id: "e9", from: "model", to: "classification" },
      { id: "e10", from: "model", to: "report" }
    ],
    groups: [
      { id: "input_layer", title: "输入层", nodeIds: ["clinical", "image", "omics", "emr"] },
      {
        id: "method_layer",
        title: "方法层",
        nodeIds: ["preprocess", "feature", "fusion", "knowledge", "model"]
      },
      { id: "output_layer", title: "输出层", nodeIds: ["risk", "classification", "report"] }
    ],
    layoutConstraints: [
      { type: "same_column", nodes: ["clinical", "image", "omics", "emr"], source: "user_explicit" },
      {
        type: "same_column",
        nodes: ["preprocess", "feature", "fusion", "knowledge", "model"],
        source: "user_explicit"
      },
      { type: "same_column", nodes: ["risk", "classification", "report"], source: "user_explicit" },
      { type: "inside", subject: "clinical", container: "input_layer", source: "user_explicit" }
    ]
  });
  const layout = layoutDiagram(diagram);

  assert.deepEqual(overlappingNodePairs(layout.nodes), []);
});

test("horizontal layered research framework layout keeps rows separated", () => {
  const diagram = normalizeDiagramSpec({
    title: "自下而上递进式研究框架图",
    type: "research_framework",
    nodes: [
      { id: "background", label: "多模态理解模型在知识、感知、思考等多个维度分别呈现认知幻觉", groupId: "background_layer" },
      { id: "knowledge", label: "底层知识", groupId: "cognitive_layer" },
      { id: "perception", label: "表层感知", groupId: "cognitive_layer" },
      { id: "reasoning", label: "深层思考", groupId: "cognitive_layer" },
      { id: "challenge_k", label: "领域实体知识迁移弱", groupId: "challenge_layer" },
      { id: "challenge_p", label: "跨模信号感知融合弱", groupId: "challenge_layer" },
      { id: "challenge_r", label: "结构思考逻辑泛化弱", groupId: "challenge_layer" },
      { id: "content_k", label: "跨模态语义双向互补的知识迁移增强方法", groupId: "content_layer" },
      { id: "content_p", label: "层级信号自适应融合的跨模感知增强方法", groupId: "content_layer" },
      { id: "content_r", label: "阶段性顶层策略引导的思维泛化增强方法", groupId: "content_layer" },
      { id: "significance", label: "构建知识、感知、思考等认知维度自底向上的多模态模型能力增强体系，为科技文献挖掘等复杂场景可信理解提供全新思路", groupId: "significance_layer" }
    ],
    edges: [
      { id: "e1", from: "knowledge", to: "perception" },
      { id: "e2", from: "perception", to: "reasoning" },
      { id: "e3", from: "background", to: "knowledge" },
      { id: "e4", from: "challenge_k", to: "content_k" },
      { id: "e5", from: "challenge_p", to: "content_p" },
      { id: "e6", from: "challenge_r", to: "content_r" },
      { id: "e7", from: "content_k", to: "content_p", label: "支撑 / 扩展" },
      { id: "e8", from: "content_p", to: "content_r", label: "支撑 / 扩展" },
      { id: "e9", from: "content_p", to: "significance" }
    ],
    groups: [
      { id: "background_layer", title: "研究背景层", nodeIds: ["background"] },
      { id: "cognitive_layer", title: "认知维度层", nodeIds: ["knowledge", "perception", "reasoning"] },
      { id: "challenge_layer", title: "研究挑战层", nodeIds: ["challenge_k", "challenge_p", "challenge_r"] },
      { id: "content_layer", title: "研究内容层", nodeIds: ["content_k", "content_p", "content_r"] },
      { id: "significance_layer", title: "研究意义层", nodeIds: ["significance"] }
    ],
    layoutConstraints: [
      { type: "main_flow", nodes: ["background", "knowledge", "challenge_k", "content_k", "significance"], direction: "bottom_to_top", source: "user_explicit" },
      { type: "same_row", nodes: ["knowledge", "perception", "reasoning"], source: "user_explicit" },
      { type: "same_row", nodes: ["challenge_k", "challenge_p", "challenge_r"], source: "user_explicit" },
      { type: "same_row", nodes: ["content_k", "content_p", "content_r"], source: "user_explicit" }
    ]
  });
  const layout = layoutDiagram(diagram);
  const background = layout.nodes.find((node) => node.id === "background");
  const significance = layout.nodes.find((node) => node.id === "significance");

  assert.deepEqual(overlappingNodePairs(layout.nodes), []);
  assert.ok(background && significance && background.y > significance.y);
  assert.ok(layout.groups?.every((group) => group.y >= 0 && group.y + group.height <= layout.canvas.height));
});

test("grouped model architecture layout handles nested groups and orphan branch nodes", () => {
  const diagram = normalizeDiagramSpec({
    title: "Train / Inference 模型架构图",
    type: "model_architecture",
    nodes: [
      { id: "base_model", label: "基础模型" },
      { id: "stage1_cpt", label: "Stage1 CPT" },
      { id: "m2t_doc_variants", label: "M2T Doc variants" },
      { id: "t2t_doc_variants", label: "T2T Doc variants" },
      { id: "stage2_sft", label: "Stage2 SFT" },
      { id: "m2t_qa_variants", label: "M2T QA variants" },
      { id: "t2t_qa_variants", label: "T2T QA variants" },
      { id: "stage3_rl", label: "Stage3 RL" },
      { id: "rollout", label: "Rollout" },
      { id: "m2t_trajectories", label: "M2T Trajectories" },
      { id: "t2t_trajectories", label: "T2T Trajectories" },
      { id: "ebpo_policy_update", label: "EBPO Policy Update" },
      { id: "prompt_block", label: "Prompt Block（Fixed Context）" },
      { id: "decoding_block", label: "Decoding Block（Parallel Processing at Step t）" },
      { id: "input_mask", label: "输入：[MASK]" },
      { id: "action1_unmasking", label: "Action1 Unmasking" },
      { id: "fill_highest_prob_token", label: "按最高概率填充 token" },
      { id: "input_token_low_confidence", label: "输入：token（低置信度）" },
      { id: "action2_correction_low", label: "Action2 Correction（低置信度）" },
      { id: "keep_original_token", label: "保持原 token" },
      { id: "input_token_high_confidence", label: "输入：token（高置信度且新 argmax 不同）" },
      { id: "action2_correction_high", label: "Action2 Correction（高置信度且新 argmax 不同）" },
      { id: "replace_token", label: "替换 token" }
    ],
    edges: [
      { id: "e1", from: "base_model", to: "stage1_cpt" },
      { id: "e2", from: "stage1_cpt", to: "stage2_sft" },
      { id: "e3", from: "stage2_sft", to: "stage3_rl" },
      { id: "e4", from: "stage3_rl", to: "rollout" },
      { id: "e5", from: "rollout", to: "ebpo_policy_update" },
      { id: "e6", from: "ebpo_policy_update", to: "stage3_rl", style: "dashed" },
      { id: "e7", from: "input_mask", to: "action1_unmasking" },
      { id: "e8", from: "action1_unmasking", to: "fill_highest_prob_token" },
      { id: "e9", from: "input_token_low_confidence", to: "action2_correction_low" },
      { id: "e10", from: "action2_correction_low", to: "keep_original_token" },
      { id: "e11", from: "input_token_high_confidence", to: "action2_correction_high" },
      { id: "e12", from: "action2_correction_high", to: "replace_token" }
    ],
    groups: [
      {
        id: "train_group",
        title: "Train",
        nodeIds: ["base_model", "stage1_cpt", "stage2_sft", "stage3_rl", "rollout", "ebpo_policy_update"]
      },
      {
        id: "inference_group",
        title: "Inference",
        nodeIds: [
          "prompt_block",
          "decoding_block",
          "input_mask",
          "action1_unmasking",
          "fill_highest_prob_token",
          "input_token_low_confidence",
          "action2_correction_low",
          "keep_original_token",
          "input_token_high_confidence",
          "action2_correction_high",
          "replace_token"
        ]
      },
      { id: "rl_loop", title: "RL Rollout / Policy Update", nodeIds: ["rollout", "ebpo_policy_update"] }
    ],
    layoutConstraints: [
      { type: "main_flow", nodes: ["base_model", "stage1_cpt", "stage2_sft", "stage3_rl"], direction: "top_to_bottom", source: "user_explicit" },
      { type: "same_row", nodes: ["m2t_doc_variants", "t2t_doc_variants"], source: "user_explicit" },
      { type: "same_row", nodes: ["m2t_qa_variants", "t2t_qa_variants"], source: "user_explicit" },
      { type: "same_row", nodes: ["m2t_trajectories", "t2t_trajectories"], source: "user_explicit" },
      { type: "inside", subject: "rollout", container: "rl_loop", source: "user_explicit" },
      { type: "inside", subject: "ebpo_policy_update", container: "rl_loop", source: "user_explicit" }
    ]
  });
  const layout = layoutDiagram(diagram);
  const trainGroup = layout.groups?.find((group) => group.id === "train_group");
  const branchNodes = [
    "m2t_doc_variants",
    "t2t_doc_variants",
    "m2t_qa_variants",
    "t2t_qa_variants",
    "m2t_trajectories",
    "t2t_trajectories"
  ]
    .map((id) => layout.nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));

  assert.equal(new Set(layout.nodes.map((node) => node.id)).size, diagram.nodes.length);
  assert.deepEqual(overlappingNodePairs(layout.nodes), []);
  assert.ok(trainGroup);
  assert.ok(branchNodes.every((node) => rectContains(trainGroup, node)));
});

test("grouped model architecture layout honors relative constraints inside dense groups", () => {
  const diagram = normalizeDiagramSpec({
    title: "Train / Inference 复杂模型架构图",
    type: "model_architecture",
    nodes: [
      { id: "base_model", label: "Base Model" },
      { id: "stage1_cpt", label: "Stage1: CPT Multi-Turn Forward w/" },
      { id: "stage2_sft", label: "Stage2: SFT Multi-Turn Forward w/" },
      { id: "stage3_rl", label: "Stage3: RL Mixture of M2T & T2T" },
      { id: "rollout", label: "Rollout (SGLang Dual Mode)" },
      { id: "ebpo_update", label: "EBPO Policy Update" },
      { id: "m2t_doc_variants", label: "M2T Doc variants" },
      { id: "t2t_doc_variants", label: "T2T Doc variants" },
      { id: "m2t_qa_variants", label: "M2T QA variants" },
      { id: "t2t_qa_variants", label: "T2T QA variants" },
      { id: "prompt_block", label: "Prompt Block (Fixed Context)" },
      { id: "decoding_block", label: "Decoding Block (Parallel Processing at Step t)" },
      { id: "action1", label: "Action 1: Unmasking" },
      { id: "action2_over", label: "Action 2: Correction" },
      { id: "action2_lazy", label: "Action 2: Correction" },
      { id: "input_mask", label: "x_t^i = [MASK]" },
      { id: "unmask", label: "UNMASK" },
      { id: "output_jumps", label: "x_{t-1}^i = jumps" },
      { id: "input_over", label: "x_t^j = over" },
      { id: "keep", label: "KEEP" },
      { id: "output_over", label: "x_{t-1}^j = over" },
      { id: "input_lazy", label: "x_t^k = lazy" },
      { id: "replace", label: "REPLACE" },
      { id: "output_dog", label: "x_{t-1}^k = dog" }
    ],
    edges: [
      { id: "e1", from: "base_model", to: "stage1_cpt" },
      { id: "e2", from: "stage1_cpt", to: "stage2_sft" },
      { id: "e3", from: "stage2_sft", to: "stage3_rl" },
      { id: "e4", from: "stage3_rl", to: "rollout" },
      { id: "e5", from: "rollout", to: "ebpo_update" },
      { id: "e6", from: "input_mask", to: "unmask" },
      { id: "e7", from: "unmask", to: "output_jumps" },
      { id: "e8", from: "input_over", to: "keep" },
      { id: "e9", from: "keep", to: "output_over" },
      { id: "e10", from: "input_lazy", to: "replace" },
      { id: "e11", from: "replace", to: "output_dog" }
    ],
    groups: [
      {
        id: "train",
        title: "Train",
        nodeIds: ["base_model", "stage1_cpt", "stage2_sft", "stage3_rl", "rollout", "ebpo_update"]
      },
      {
        id: "inference",
        title: "Inference",
        nodeIds: ["prompt_block", "decoding_block", "action1", "action2_over", "action2_lazy"]
      }
    ],
    layoutConstraints: [
      { type: "main_flow", nodes: ["base_model", "stage1_cpt", "stage2_sft", "stage3_rl"], direction: "top_to_bottom", source: "user_explicit" },
      { type: "same_column", nodes: ["base_model", "stage1_cpt", "stage2_sft"], source: "user_explicit" },
      { type: "right_of", subject: "stage3_rl", object: "stage2_sft", source: "user_explicit" },
      { type: "below", subject: "rollout", object: "stage3_rl", source: "user_explicit" },
      { type: "below", subject: "ebpo_update", object: "stage3_rl", source: "user_explicit" },
      { type: "same_row", nodes: ["rollout", "ebpo_update"], source: "user_explicit" },
      { type: "same_row", nodes: ["m2t_doc_variants", "t2t_doc_variants"], source: "user_explicit" },
      { type: "same_row", nodes: ["m2t_qa_variants", "t2t_qa_variants"], source: "user_explicit" },
      { type: "same_row", nodes: ["prompt_block", "decoding_block"], source: "user_explicit" },
      { type: "left_of", subject: "prompt_block", object: "decoding_block", source: "user_explicit" },
      { type: "same_row", nodes: ["action1", "action2_over", "action2_lazy"], source: "user_explicit" },
      { type: "below", subject: "action1", object: "prompt_block", source: "user_explicit" },
      { type: "below", subject: "action2_over", object: "decoding_block", source: "user_explicit" },
      { type: "below", subject: "action2_lazy", object: "decoding_block", source: "user_explicit" },
      { type: "main_flow", nodes: ["input_mask", "unmask", "output_jumps"], direction: "top_to_bottom", source: "user_explicit" },
      { type: "main_flow", nodes: ["input_over", "keep", "output_over"], direction: "top_to_bottom", source: "user_explicit" },
      { type: "main_flow", nodes: ["input_lazy", "replace", "output_dog"], direction: "top_to_bottom", source: "user_explicit" }
    ]
  });
  const layout = layoutDiagram(diagram);

  assert.deepEqual(overlappingNodePairs(layout.nodes), []);
  assert.deepEqual(relativeConstraintViolations(diagram.layoutConstraints, layout.nodes), []);
});

function overlappingNodePairs(nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>) {
  const pairs: string[][] = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const a = nodes[leftIndex];
      const b = nodes[rightIndex];
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      ) {
        pairs.push([a.id, b.id]);
      }
    }
  }
  return pairs;
}

function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }
) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function relativeConstraintViolations(
  constraints: DiagramLayoutConstraint[],
  nodes: LayoutNode[]
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const violations: string[] = [];

  for (const constraint of constraints) {
    if (constraint.type === "right_of") {
      const subject = nodeById.get(constraint.subject);
      const object = nodeById.get(constraint.object);
      if (subject && object && subject.x <= object.x) {
        violations.push(`${constraint.subject} should be right of ${constraint.object}`);
      }
    } else if (constraint.type === "left_of") {
      const subject = nodeById.get(constraint.subject);
      const object = nodeById.get(constraint.object);
      if (subject && object && subject.x >= object.x) {
        violations.push(`${constraint.subject} should be left of ${constraint.object}`);
      }
    } else if (constraint.type === "below") {
      const subject = nodeById.get(constraint.subject);
      const object = nodeById.get(constraint.object);
      if (subject && object && subject.y <= object.y) {
        violations.push(`${constraint.subject} should be below ${constraint.object}`);
      }
    } else if (constraint.type === "same_row") {
      const rowNodes = constraint.nodes
        .map((id) => nodeById.get(id))
        .filter((node): node is LayoutNode => Boolean(node));
      if (rowNodes.length >= 2) {
        const rowSpread = Math.max(...rowNodes.map((node) => node.y)) - Math.min(...rowNodes.map((node) => node.y));
        if (rowSpread >= 40) violations.push(`${constraint.nodes.join(",")} should share row`);
      }
    }
  }

  return violations;
}

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
                  { from: "input", to: "add", role: "main", source: "model_inferred" },
                  { from: "add", to: "output", role: "main", source: "model_inferred" }
                ],
                layoutConstraints: [
                  {
                    type: "main_flow",
                    modules: ["input", "add", "output"],
                    direction: "left_to_right",
                    source: "model_inferred"
                  }
                ],
                layoutNotes: "使用主流程从左到右布局"
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
    assert.match(body.messages[0]?.content ?? "", /layoutConstraints/);
    assert.match(body.messages[1]?.content ?? "", /planningPolicy/);
    assert.equal(result.ok && result.plan.modules[1].shapeKey, "operator.add");
    assert.equal(
      result.ok && result.plan.layoutConstraints?.some((constraint) => constraint.type === "main_flow"),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.BASE_URL = "";
    process.env.API_KEY = "";
    process.env.MODEL = "";
  }
});

test("llm planner coerces common JSON aliases before validation", async () => {
  const originalFetch = globalThis.fetch;
  process.env.BASE_URL = "https://llm.example.test/v1";
  process.env.API_KEY = "test-key";
  process.env.MODEL = "test-model";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "别名测试图",
                type: "research_framework",
                description: "测试兼容不同模型的字段命名",
                groups: [
                  { id: "g1", label: "第一层", modules: ["a"] },
                  { id: "g2", label: "第二层", modules: ["b"] }
                ],
                nodes: [
                  { id: "a", name: "输入模块" },
                  { id: "b", name: "输出模块" }
                ],
                edges: [
                  {
                    source: "a",
                    target: "b",
                    label: "流向",
                    lineStyle: "dotted",
                    role: "unknown-role"
                  }
                ],
                layoutConstraints: [
                  { type: "sameRow", modules: ["a", "b"], source: "a" },
                  { type: "inside", group: "g1", nodes: ["a"] }
                ],
                assumptions: "字段别名应被兼容"
              })
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const result = await createLlmDiagramPlan(createGenerationContext("绘制一个研究框架图"));

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.plan.subject, "别名测试图");
    assert.equal(result.ok && result.plan.modules[0].groupId, "g1");
    assert.equal(result.ok && result.plan.connections[0].from, "a");
    assert.equal(result.ok && result.plan.connections[0].to, "b");
    assert.equal(result.ok && result.plan.connections[0].style, "dashed");
    assert.equal(
      result.ok && result.plan.layoutConstraints?.some((constraint) => constraint.type === "same_row"),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.BASE_URL = "";
    process.env.API_KEY = "";
    process.env.MODEL = "";
  }
});

test("configured llm failure is not silently replaced by rule based generation", async () => {
  const originalFetch = globalThis.fetch;
  process.env.BASE_URL = "https://llm.example.test/v1";
  process.env.API_KEY = "test-key";
  process.env.MODEL = "test-model";

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        generateDiagram({
          prompt: "输入是 A，后面接 B，最后输出 C"
        }),
      /LLM planner failed/
    );
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

test("research framework wording takes priority over model keyword", () => {
  const context = createGenerationContext(
    "绘制一个研究框架图：输入数据后面接预测模型，右侧输出诊断结果"
  );

  assert.equal(context.diagramType, "research_framework");
  assert.equal(context.layoutPreference?.pattern, "three_column");
});

test("planning policy treats concrete transformer module lists as explicit structure requests", () => {
  const context = createGenerationContext(
    "绘制一个 Transformer Encoder-Decoder 架构图，包含输入嵌入、位置编码、编码器堆叠、解码器堆叠、Linear、Softmax 和输出概率"
  );
  const policy = createPlanningPolicy(context.rawPrompt);

  assert.equal(policy.intentType, "explicit");
  assert.equal(policy.allowInference, false);
});

test("explicit parser records main flow and relative branch layout constraints", async () => {
  const result = await generateDiagram({
    prompt:
      "输入是多模态数据，后面接数据预处理，再接预测模型，知识图谱模块从左侧虚线连接到预测模型，最后输出诊断结果。"
  });
  const mainFlow = result.diagram.layoutConstraints.find(
    (constraint) => constraint.type === "main_flow"
  );
  const leftOf = result.diagram.layoutConstraints.find(
    (constraint) => constraint.type === "left_of"
  );
  const kg = result.diagram.nodes.find((node) => node.label === "知识图谱");
  const model = result.diagram.nodes.find((node) => node.label === "预测模型");
  const kgLayout = result.layout.nodes.find((node) => node.id === kg?.id);
  const modelLayout = result.layout.nodes.find((node) => node.id === model?.id);

  assert.equal(mainFlow?.source, "user_explicit");
  assert.equal(leftOf?.source, "user_explicit");
  assert.ok(kgLayout && modelLayout && kgLayout.x < modelLayout.x);
});
