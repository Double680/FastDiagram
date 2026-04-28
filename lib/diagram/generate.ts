import type {
  DiagramEdge,
  DiagramLayoutConstraint,
  DiagramLayoutConstraintDraft,
  DiagramNode,
  DiagramPlan,
  DiagramPlanConnection,
  DiagramPlanModule,
  DiagramSpec,
  DiagramType,
  GenerateInput,
  GenerateOutput,
  GenerationContext,
  PlanIntentType,
  PlanSource
} from "./types.ts";
import { layoutDiagram } from "./layout.ts";
import { createLlmDiagramPlan, getLlmStatus } from "./llm.ts";
import { normalizeDiagramSpec, sanitizeId } from "./normalize.ts";
import { renderSvg } from "./render-svg.ts";

export async function generateDiagram(input: GenerateInput): Promise<GenerateOutput> {
  const prompt = input.prompt.trim();
  const context = createGenerationContext(prompt, input.diagramType);
  const llmStatus = getLlmStatus();
  const llmResult = await createLlmDiagramPlan(context);
  let planner: GenerateOutput["planner"];
  let plan: DiagramPlan;

  if (llmResult.ok) {
    planner = {
      source: "llm",
      model: llmResult.model
    };
    plan = selectLlmPlan(llmResult.plan);
  } else {
    if (llmStatus.configured) {
      throw new Error(`LLM planner failed: ${llmResult.reason}`);
    }
    planner = {
      source: "rule_based",
      fallbackReason: llmResult.reason
    };
    plan = createRuleBasedPlan(context);
  }
  const rawSpec = planToDiagramSpec(plan, context);
  const diagram = normalizeDiagramSpec(rawSpec);
  const layout = layoutDiagram(diagram);
  const svg = renderSvg(diagram, layout);

  return {
    context,
    planner,
    plan,
    diagram,
    layout,
    svg
  };
}

function selectLlmPlan(llmPlan: DiagramPlan): DiagramPlan {
  return llmPlan;
}

export function createGenerationContext(
  rawPrompt: string,
  forcedType?: DiagramType
): GenerationContext {
  const diagramType = forcedType ?? inferDiagramType(rawPrompt);
  return {
    rawPrompt,
    diagramType,
    language: "zh",
    nodeLimit: 40,
    stylePreset: "academic_bw",
    canvas: {
      aspectRatio: "16:9"
    },
    layoutPreference: {
      direction: diagramType === "model_architecture" ? "top_to_bottom" : "left_to_right",
      pattern:
        diagramType === "technical_route"
          ? "stage"
          : diagramType === "research_framework"
            ? "three_column"
            : diagramType === "model_architecture"
              ? inferModelPattern(rawPrompt)
              : "flow"
    },
    explicitConstraints: extractConstraints(rawPrompt)
  };
}

type PlanModuleDraft = Omit<DiagramPlanModule, "source"> & {
  source?: PlanSource;
};

type PlanConnectionDraft = Omit<DiagramPlanConnection, "source"> & {
  source?: PlanSource;
};

type PlanDraft = Omit<DiagramPlan, "modules" | "connections" | "layoutConstraints"> & {
  modules: PlanModuleDraft[];
  connections: PlanConnectionDraft[];
  layoutConstraints?: DiagramLayoutConstraintDraft[];
};

function makePlan(plan: PlanDraft, defaultSource: PlanSource): DiagramPlan {
  return {
    ...plan,
    modules: plan.modules.map((module) => ({
      ...module,
      source: module.source ?? defaultSource
    })),
    connections: plan.connections.map((connection) => ({
      ...connection,
      source: connection.source ?? defaultSource
    })),
    layoutConstraints: plan.layoutConstraints?.map((constraint) => ({
      ...constraint,
      source: constraint.source ?? defaultSource
    })) as DiagramLayoutConstraint[] | undefined
  };
}

function createRuleBasedPlan(context: GenerationContext): DiagramPlan {
  const prompt = context.rawPrompt;
  const explicitPlan = createExplicitPlan(context);
  if (explicitPlan) return explicitPlan;

  if (/残差|residual|skip connection|add/i.test(prompt)) {
    return residualPlan();
  }

  if (/concat|concatenate|拼接|融合/i.test(prompt)) {
    return concatPlan();
  }

  if (/transformer|encoder|decoder|编码器|解码器/i.test(prompt)) {
    return transformerPlan();
  }

  const listed = extractListedModules(prompt);
  if (listed.length >= 2) {
    return sequentialPlan(context, listed);
  }

  switch (context.diagramType) {
    case "technical_route":
      return makePlan(
        {
          subject: "技术路线",
          diagramType: "technical_route",
          intentType: "conceptual",
          mainIdea: "围绕研究任务形成阶段式技术路线。",
          groups: [
            { id: "stage_1", title: "阶段一", role: "问题与数据准备" },
            { id: "stage_2", title: "阶段二", role: "方法构建" },
            { id: "stage_3", title: "阶段三", role: "验证与应用" }
          ],
          modules: [
            { id: "need", label: "需求分析", groupId: "stage_1" },
            { id: "data", label: "数据获取与整理", groupId: "stage_1" },
            { id: "method", label: "核心方法构建", groupId: "stage_2" },
            { id: "experiment", label: "实验验证", groupId: "stage_3" },
            { id: "output", label: "成果输出", groupId: "stage_3" }
          ],
          connections: [
            { from: "need", to: "data" },
            { from: "data", to: "method" },
            { from: "method", to: "experiment" },
            { from: "experiment", to: "output" }
          ],
          layoutConstraints: [
            {
              type: "main_flow",
              nodes: ["need", "data", "method", "experiment", "output"],
              direction: "left_to_right"
            }
          ],
          layoutNotes: ["阶段式横向布局"],
          simplificationNotes: ["MVP 规则生成，后续可由 LLM 补全专业模块"]
        },
        "model_inferred"
      );
    case "model_architecture":
      return makePlan(
        {
          subject: "模型结构",
          diagramType: "model_architecture",
          intentType: "conceptual",
          mainIdea: "从输入、特征编码、核心模型到输出结果的模型结构。",
          groups: [
            { id: "input_layer", title: "输入层" },
            { id: "model_layer", title: "模型层" },
            { id: "output_layer", title: "输出层" }
          ],
          modules: [
            { id: "input", label: "输入数据", groupId: "input_layer" },
            { id: "feature", label: "特征表示", groupId: "model_layer" },
            { id: "model", label: "核心模型", groupId: "model_layer", shapeKey: "model.block" },
            { id: "head", label: "预测头", groupId: "model_layer" },
            { id: "output", label: "输出结果", groupId: "output_layer" }
          ],
          connections: [
            { from: "input", to: "feature" },
            { from: "feature", to: "model" },
            { from: "model", to: "head" },
            { from: "head", to: "output" }
          ],
          layoutConstraints: [
            {
              type: "main_flow",
              nodes: ["input", "feature", "model", "head", "output"],
              direction: "top_to_bottom"
            }
          ],
          layoutNotes: ["上下分层布局"]
        },
        "model_inferred"
      );
    case "research_framework":
    case "general":
    default:
      return makePlan(
        {
          subject: "研究框架",
          diagramType: context.diagramType,
          intentType: "conceptual",
          mainIdea: "构建输入、方法与输出之间的整体研究逻辑。",
          groups: [
            { id: "input_group", title: "输入层" },
            { id: "method_group", title: "方法层" },
            { id: "output_group", title: "输出层" }
          ],
          modules: [
            { id: "object", label: "研究对象", groupId: "input_group" },
            { id: "data", label: "多源数据", groupId: "input_group" },
            { id: "analysis", label: "分析方法", groupId: "method_group" },
            { id: "model", label: "模型构建", groupId: "method_group" },
            { id: "result", label: "结果解释", groupId: "output_group" },
            { id: "application", label: "应用验证", groupId: "output_group" }
          ],
          connections: [
            { from: "object", to: "analysis" },
            { from: "data", to: "analysis" },
            { from: "analysis", to: "model" },
            { from: "model", to: "result" },
            { from: "result", to: "application" }
          ],
          layoutConstraints: [
            {
              type: "main_flow",
              nodes: ["object", "analysis", "model", "result", "application"],
              direction: "left_to_right"
            },
            { type: "same_column", nodes: ["object", "data"] },
            { type: "same_column", nodes: ["analysis", "model"] },
            { type: "same_column", nodes: ["result", "application"] }
          ],
          layoutNotes: ["输入-方法-输出三栏布局"]
        },
        "model_inferred"
      );
  }
}

function createExplicitPlan(context: GenerationContext): DiagramPlan | null {
  const prompt = context.rawPrompt;
  const sequentialLabels = extractSequentialLabels(prompt);
  const labels = extractExplicitModuleLabels(prompt);
  const branchConnections = extractExplicitBranchConnections(prompt);
  const hasExplicitSignal =
    /严格按照|不要增加|不要新增|只按|仅按|输入是|输入为|输出是|输出为|后面接|再接|接着|然后|之后|最后|连接到|连到|->|→|=>|包含|包括|模块[:：]|步骤[:：]/.test(
      prompt
    );

  if (!hasExplicitSignal || labels.length < 2) return null;

  const intentType: PlanIntentType = /完善|补全|合理扩展|帮我扩展|丰富一下|自动补充/.test(
    prompt
  )
    ? "mixed"
    : "explicit";
  const modules = labels.slice(0, context.nodeLimit).map((label, index) => ({
    id: sanitizeId(`n_${index + 1}_${label}`),
    label,
    shapeKey: inferShapeKey(label),
    source: "user_explicit" as const
  }));
  const moduleByLabel = new Map(modules.map((module) => [normalizeLabel(module.label), module]));
  const relationConnections: PlanConnectionDraft[] = [];
  if (hasSequentialRelation(prompt) && sequentialLabels.length >= 2) {
    for (let index = 1; index < sequentialLabels.length; index += 1) {
      const from = findModuleByLabel(moduleByLabel, sequentialLabels[index - 1]);
      const to = findModuleByLabel(moduleByLabel, sequentialLabels[index]);
      if (!from || !to || from.id === to.id) continue;
      relationConnections.push({
        from: from.id,
        to: to.id,
        source: "user_explicit"
      });
    }
  }
  const dashedConnections: PlanConnectionDraft[] = [];
  for (const connection of branchConnections) {
    const from = findModuleByLabel(moduleByLabel, connection.from);
    const to = findModuleByLabel(moduleByLabel, connection.to);
    if (!from || !to || from.id === to.id) continue;
    dashedConnections.push({
      from: from.id,
      to: to.id,
      meaning: connection.meaning,
      style: connection.style,
      role: connection.style === "dashed" ? "reference" : "branch",
      source: "user_explicit"
    });
  }

  const connections = dedupeConnections([...relationConnections, ...dashedConnections]);
  const layoutConstraints = buildExplicitLayoutConstraints(
    sequentialLabels,
    moduleByLabel,
    branchConnections,
    context
  );
  const unresolvedQuestions =
    connections.length === 0 && modules.length > 1
      ? ["用户列出了模块，但没有明确模块之间的连接关系。"]
      : undefined;

  return makePlan(
    {
      subject: inferSubjectFromPrompt(prompt, context.diagramType),
      diagramType: context.diagramType,
      intentType,
      mainIdea: "根据用户明确描述整理 Diagram 模块与连接，不额外补充业务模块。",
      modules,
      connections,
      layoutConstraints,
      layoutNotes: layoutNotesFromContext(context),
      unresolvedQuestions
    },
    "user_explicit"
  );
}

function hasSequentialRelation(prompt: string): boolean {
  return /后面接|再接|接着|然后|之后|最后|->|→|=>/.test(prompt);
}

function extractExplicitModuleLabels(prompt: string): string[] {
  const relationLabels = extractSequentialLabels(prompt);
  const listedLabels = extractContainedLabels(prompt);
  const branchLabels = extractExplicitBranchConnections(prompt).flatMap((connection) => [
    connection.from,
    connection.to
  ]);
  return dedupe([...relationLabels, ...listedLabels, ...branchLabels].map(cleanModuleLabel)).filter(
    Boolean
  );
}

function extractSequentialLabels(prompt: string): string[] {
  const clauses = prompt
    .split(/[，,；;。]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const flowText = clauses
    .filter((clause) => {
      const isSideConnection = /虚线|旁路|分支|从.*侧|从.*连接到/.test(clause);
      const hasFlowCue =
        /输入是|输入为|后面接|再接|接着|然后|之后|最后|->|→|=>/.test(clause) ||
        /^输出(?:是|为)?/.test(clause);
      return hasFlowCue && !isSideConnection;
    })
    .join("，");

  if (!flowText) return [];

  const normalized = flowText
    .replace(/输入(?:是|为)?/g, "")
    .replace(/^输出(?:是|为)?/g, "->")
    .replace(/后面接|再接|接着|然后|之后|最后(?:得到|输出)?/g, "->")
    .replace(/->+/g, "->");

  return normalized
    .split(/->|→|=>/)
    .flatMap(splitCompoundLabel)
    .map(cleanModuleLabel)
    .filter((label) => label.length >= 2 && label.length <= 28);
}

function extractContainedLabels(prompt: string): string[] {
  const match = prompt.match(/(?:包含|包括|模块[:：]|步骤[:：]|节点[:：])(.+)/);
  if (!match) return [];
  const listText = match[1]
    .split(/[。；;]/)[0]
    .replace(/，?(?:并且|其中)?.*?(?:连接到|连到).*/, "");
  return listText
    .split(/[，,、]/)
    .flatMap(splitCompoundLabel)
    .map(cleanModuleLabel)
    .filter((label) => label.length >= 2 && label.length <= 32);
}

function splitCompoundLabel(label: string): string[] {
  const cleaned = cleanModuleLabel(label);
  if (!/和|与|及/.test(cleaned)) return [cleaned];
  return cleaned
    .split(/和|与|及/)
    .map(cleanModuleLabel)
    .filter((item) => item.length >= 2);
}

function extractExplicitBranchConnections(prompt: string): Array<{
  from: string;
  to: string;
  meaning?: string;
  placement?: "top" | "bottom" | "left" | "right";
  style?: "solid" | "dashed";
}> {
  const connections: Array<{
    from: string;
    to: string;
    meaning?: string;
    placement?: "top" | "bottom" | "left" | "right";
    style?: "solid" | "dashed";
  }> = [];
  const pattern =
    /([^，,；;。]+?)(?:模块)?(?:从[^，,；;。]*?侧)?(?:用)?(虚线)?(?:连接到|连到)([^，,；;。]+)/g;
  for (const match of prompt.matchAll(pattern)) {
    const from = cleanModuleLabel(match[1]);
    const to = cleanModuleLabel(match[3]);
    if (!from || !to) continue;
    connections.push({
      from,
      to,
      meaning: match[2] ? "虚线连接" : undefined,
      placement: inferPlacement(match[0]),
      style: match[2] ? "dashed" : "solid"
    });
  }
  return connections;
}

function buildExplicitLayoutConstraints(
  sequentialLabels: string[],
  moduleByLabel: Map<string, PlanModuleDraft>,
  branchConnections: Array<{
    from: string;
    to: string;
    placement?: "top" | "bottom" | "left" | "right";
  }>,
  context: GenerationContext
): DiagramLayoutConstraintDraft[] {
  const constraints: DiagramLayoutConstraintDraft[] = [];
  const mainFlowNodes = sequentialLabels
    .map((label) => findModuleByLabel(moduleByLabel, label)?.id)
    .filter((id): id is string => Boolean(id));

  if (mainFlowNodes.length >= 2) {
    constraints.push({
      type: "main_flow",
      nodes: Array.from(new Set(mainFlowNodes)),
      direction:
        context.layoutPreference?.direction === "top_to_bottom"
          ? "top_to_bottom"
          : "left_to_right",
      source: "user_explicit"
    });
  }

  for (const connection of branchConnections) {
    const from = findModuleByLabel(moduleByLabel, connection.from);
    const to = findModuleByLabel(moduleByLabel, connection.to);
    if (!from || !to || from.id === to.id) continue;

    constraints.push({
      type: "branch",
      from: from.id,
      to: to.id,
      placement: connection.placement,
      source: "user_explicit"
    });

    if (connection.placement === "left") {
      constraints.push({ type: "left_of", subject: from.id, object: to.id, source: "user_explicit" });
    } else if (connection.placement === "right") {
      constraints.push({ type: "right_of", subject: from.id, object: to.id, source: "user_explicit" });
    } else if (connection.placement === "top") {
      constraints.push({ type: "above", subject: from.id, object: to.id, source: "user_explicit" });
    } else if (connection.placement === "bottom") {
      constraints.push({ type: "below", subject: from.id, object: to.id, source: "user_explicit" });
    }
  }

  return constraints;
}

function inferPlacement(text: string): "top" | "bottom" | "left" | "right" | undefined {
  if (/左侧|左边|左方|从左/.test(text)) return "left";
  if (/右侧|右边|右方|从右/.test(text)) return "right";
  if (/上方|上侧|上面|从上/.test(text)) return "top";
  if (/下方|下侧|下面|从下/.test(text)) return "bottom";
  return undefined;
}

function findModuleByLabel(
  moduleByLabel: Map<string, PlanModuleDraft>,
  label: string
): PlanModuleDraft | undefined {
  const normalized = normalizeLabel(label);
  const exact = moduleByLabel.get(normalized);
  if (exact) return exact;

  for (const [key, module] of moduleByLabel.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) return module;
  }
  return undefined;
}

function dedupeConnections(connections: PlanConnectionDraft[]): PlanConnectionDraft[] {
  const seen = new Set<string>();
  const result: PlanConnectionDraft[] = [];
  for (const connection of connections) {
    const key = `${connection.from}->${connection.to}:${connection.style ?? "solid"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(connection);
  }
  return result;
}

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, "").toLowerCase();
}

function inferSubjectFromPrompt(prompt: string, type: DiagramType): string {
  const cleaned = prompt
    .replace(/^(请|请你)?(绘制|画|生成|做)/, "")
    .split(/[，,；;。]/)[0]
    .replace(/(一个|一张)/g, "")
    .trim();
  if (cleaned.length >= 2 && cleaned.length <= 32) return cleaned;
  if (type === "technical_route") return "技术路线";
  if (type === "research_framework") return "研究框架";
  if (type === "model_architecture") return "模型结构";
  return "Diagram 初稿";
}

function layoutNotesFromContext(context: GenerationContext): string[] {
  const notes: string[] = [];
  if (context.layoutPreference?.direction === "left_to_right") notes.push("按从左到右方向布局");
  if (context.layoutPreference?.direction === "top_to_bottom") notes.push("按从上到下方向布局");
  if (context.layoutPreference?.pattern) notes.push(`布局模式：${context.layoutPreference.pattern}`);
  return notes;
}

function planToDiagramSpec(plan: DiagramPlan, context: GenerationContext): DiagramSpec {
  const nodes: DiagramNode[] = plan.modules.map((module, index) => ({
    id: module.id,
    label: module.label,
    groupId: module.groupId,
    kind: inferNodeKind(module.label, module.groupId, module.shapeKey),
    shapeKey: module.shapeKey ?? inferShapeKey(module.label, module.groupId),
    order: index
  }));

  const edges: DiagramEdge[] = plan.connections.map((connection, index) => ({
    id: `edge_${index + 1}`,
    from: connection.from,
    to: connection.to,
    label: connection.meaning,
    style: connection.style ?? "solid",
    kind: connection.role ?? (connection.style === "dashed" ? "auxiliary" : "main")
  }));

  return {
    title: plan.subject,
    type: plan.diagramType,
    nodes,
    edges,
    groups:
      plan.groups?.map((group) => ({
        id: group.id,
        title: group.title,
        nodeIds: groupNodeIdsFromPlan(plan, group.id),
        kind: context.diagramType === "technical_route" ? "stage" : "container"
      })) ?? [],
    layoutConstraints: plan.layoutConstraints ?? [],
    layout: context.layoutPreference,
    style: {
      preset: context.stylePreset
    }
  };
}

function sequentialPlan(context: GenerationContext, labels: string[]): DiagramPlan {
  const modules = labels.slice(0, context.nodeLimit).map((label, index) => ({
    id: sanitizeId(`n_${index + 1}_${label}`),
    label,
    source: "user_explicit" as const
  }));

  return {
    subject: context.diagramType === "technical_route" ? "技术路线" : "Diagram 初稿",
    diagramType: context.diagramType,
    intentType: "explicit",
    mainIdea: "根据用户列出的模块生成顺序流程。",
    modules,
    connections: modules.slice(1).map((module, index) => ({
      from: modules[index].id,
      to: module.id,
      source: "user_explicit" as const
    })),
    layoutNotes: ["按描述顺序排列模块"]
  };
}

function transformerPlan(intentType: PlanIntentType = "conceptual"): DiagramPlan {
  return makePlan(
    {
      subject: "Transformer Encoder-Decoder 架构",
      diagramType: "model_architecture",
      intentType,
      mainIdea:
        "展示 Transformer Encoder-Decoder 的层级结构：输入嵌入进入 Encoder，Decoder 通过 Cross-Attention 接收 Encoder 上下文，并输出预测概率。",
      groups: [
        { id: "source_input", title: "Source Input" },
        { id: "encoder", title: "Encoder Layer x N" },
        { id: "decoder", title: "Decoder Layer x N" },
        { id: "output", title: "Output" }
      ],
      modules: [
        { id: "src_tokens", label: "源序列输入", groupId: "source_input" },
        { id: "src_embed", label: "Input Embedding", groupId: "source_input" },
        { id: "src_pos", label: "Positional Encoding", groupId: "source_input" },

        {
          id: "enc_self_attn",
          label: "Multi-Head\nSelf-Attention",
          groupId: "encoder",
          shapeKey: "model.attention"
        },
        {
          id: "enc_concat",
          label: "Concat\nHeads",
          groupId: "encoder",
          role: "多头注意力拼接",
          shapeKey: "operator.concat"
        },
        {
          id: "enc_add_1",
          label: "+",
          groupId: "encoder",
          role: "Residual Add",
          shapeKey: "operator.add"
        },
        { id: "enc_norm_1", label: "LayerNorm", groupId: "encoder", shapeKey: "model.block" },
        { id: "enc_ffn", label: "Feed Forward", groupId: "encoder", shapeKey: "model.block" },
        {
          id: "enc_add_2",
          label: "+",
          groupId: "encoder",
          role: "Residual Add",
          shapeKey: "operator.add"
        },
        { id: "enc_norm_2", label: "LayerNorm", groupId: "encoder", shapeKey: "model.block" },
        { id: "memory", label: "Encoder\nMemory", groupId: "encoder", shapeKey: "model.block" },

        { id: "tgt_tokens", label: "目标序列输入", groupId: "decoder" },
        { id: "tgt_embed", label: "Output Embedding", groupId: "decoder" },
        { id: "tgt_pos", label: "Positional Encoding", groupId: "decoder" },
        {
          id: "dec_masked_attn",
          label: "Masked\nSelf-Attention",
          groupId: "decoder",
          shapeKey: "model.attention"
        },
        {
          id: "dec_add_1",
          label: "+",
          groupId: "decoder",
          role: "Residual Add",
          shapeKey: "operator.add"
        },
        { id: "dec_norm_1", label: "LayerNorm", groupId: "decoder", shapeKey: "model.block" },
        {
          id: "dec_cross_attn",
          label: "Cross-Attention\nQ from Decoder",
          groupId: "decoder",
          shapeKey: "model.attention"
        },
        {
          id: "dec_concat",
          label: "Concat\nHeads",
          groupId: "decoder",
          role: "多头注意力拼接",
          shapeKey: "operator.concat"
        },
        {
          id: "dec_add_2",
          label: "+",
          groupId: "decoder",
          role: "Residual Add",
          shapeKey: "operator.add"
        },
        { id: "dec_norm_2", label: "LayerNorm", groupId: "decoder", shapeKey: "model.block" },
        { id: "dec_ffn", label: "Feed Forward", groupId: "decoder", shapeKey: "model.block" },
        {
          id: "dec_add_3",
          label: "+",
          groupId: "decoder",
          role: "Residual Add",
          shapeKey: "operator.add"
        },
        { id: "dec_norm_3", label: "LayerNorm", groupId: "decoder", shapeKey: "model.block" },

        { id: "linear", label: "Linear", groupId: "output" },
        { id: "softmax", label: "Softmax", groupId: "output" },
        { id: "prob", label: "输出概率", groupId: "output" }
      ],
          connections: [
        { from: "src_tokens", to: "src_embed" },
        { from: "src_embed", to: "src_pos" },
        { from: "src_pos", to: "enc_self_attn" },
        { from: "enc_self_attn", to: "enc_concat" },
        { from: "enc_concat", to: "enc_add_1" },
        { from: "src_pos", to: "enc_add_1", meaning: "Residual", style: "dashed" },
        { from: "enc_add_1", to: "enc_norm_1" },
        { from: "enc_norm_1", to: "enc_ffn" },
        { from: "enc_ffn", to: "enc_add_2" },
        { from: "enc_norm_1", to: "enc_add_2", meaning: "Residual", style: "dashed" },
        { from: "enc_add_2", to: "enc_norm_2" },
        { from: "enc_norm_2", to: "memory" },

        { from: "tgt_tokens", to: "tgt_embed" },
        { from: "tgt_embed", to: "tgt_pos" },
        { from: "tgt_pos", to: "dec_masked_attn" },
        { from: "dec_masked_attn", to: "dec_add_1" },
        { from: "tgt_pos", to: "dec_add_1", meaning: "Residual", style: "dashed" },
        { from: "dec_add_1", to: "dec_norm_1" },
        { from: "dec_norm_1", to: "dec_cross_attn" },
        { from: "memory", to: "dec_cross_attn", meaning: "K,V", style: "dashed" },
        { from: "dec_cross_attn", to: "dec_concat" },
        { from: "dec_concat", to: "dec_add_2" },
        { from: "dec_norm_1", to: "dec_add_2", meaning: "Residual", style: "dashed" },
        { from: "dec_add_2", to: "dec_norm_2" },
        { from: "dec_norm_2", to: "dec_ffn" },
        { from: "dec_ffn", to: "dec_add_3" },
        { from: "dec_norm_2", to: "dec_add_3", meaning: "Residual", style: "dashed" },
        { from: "dec_add_3", to: "dec_norm_3" },
        { from: "dec_norm_3", to: "linear" },
        { from: "linear", to: "softmax" },
        { from: "softmax", to: "prob" }
      ],
      layoutConstraints: [
        {
          type: "main_flow",
          nodes: ["src_tokens", "src_embed", "src_pos", "enc_self_attn", "memory"],
          direction: "top_to_bottom"
        },
        {
          type: "main_flow",
          nodes: [
            "tgt_tokens",
            "tgt_embed",
            "tgt_pos",
            "dec_masked_attn",
            "dec_cross_attn",
            "dec_ffn",
            "dec_norm_3",
            "linear",
            "softmax",
            "prob"
          ],
          direction: "top_to_bottom"
        },
        { type: "left_of", subject: "encoder", object: "decoder" },
        { type: "branch", from: "memory", to: "dec_cross_attn", placement: "left" }
      ],
      layoutNotes: ["Source Input、Encoder、Decoder、Output 四栏分组，Encoder/Decoder 内部自上而下展开"],
      assumptions: [
        "采用经典 Transformer Encoder-Decoder 架构",
        "用单个 Encoder Layer x N 和 Decoder Layer x N 表达重复堆叠",
        "将多头注意力的 heads 拼接表达为 Concat Heads 节点"
      ],
      simplificationNotes: ["省略每个 Attention head 的内部 Q/K/V 线性投影细节"]
    },
    "model_inferred"
  );
}

function residualPlan(): DiagramPlan {
  return makePlan(
    {
    subject: "残差连接结构",
    diagramType: "model_architecture",
    intentType: "conceptual",
    mainIdea: "将主分支输出与旁路输入在 Add 算子处汇合，表达残差连接。",
    groups: [{ id: "residual", title: "Residual Block" }],
    modules: [
      { id: "input", label: "输入特征", groupId: "residual" },
      { id: "block", label: "主分支模块", groupId: "residual", shapeKey: "model.block" },
      {
        id: "add",
        label: "+",
        groupId: "residual",
        role: "残差相加算子",
        shapeKey: "operator.add"
      },
      { id: "output", label: "输出特征", groupId: "residual" }
    ],
    connections: [
      { from: "input", to: "block" },
      { from: "block", to: "add" },
      { from: "input", to: "add", meaning: "Skip", style: "dashed" },
      { from: "add", to: "output" }
    ],
    layoutNotes: ["Add 是真实 operator 节点，旁路边从输入直接连接到 Add"],
    simplificationNotes: ["MVP 中先使用规则生成残差结构"]
    },
    "model_inferred"
  );
}

function concatPlan(): DiagramPlan {
  return makePlan(
    {
    subject: "特征拼接结构",
    diagramType: "model_architecture",
    intentType: "conceptual",
    mainIdea: "多路特征在 Concatenate 算子处拼接后进入后续模块。",
    groups: [{ id: "fusion", title: "Feature Fusion" }],
    modules: [
      { id: "branch_a", label: "分支特征 A", groupId: "fusion" },
      { id: "branch_b", label: "分支特征 B", groupId: "fusion" },
      {
        id: "concat",
        label: "Concat",
        groupId: "fusion",
        role: "特征拼接算子",
        shapeKey: "operator.concat"
      },
      { id: "output", label: "融合特征", groupId: "fusion" }
    ],
    connections: [
      { from: "branch_a", to: "concat" },
      { from: "branch_b", to: "concat" },
      { from: "concat", to: "output" }
    ],
    layoutNotes: ["Concat 是真实 operator 节点，用于表达多输入融合"]
    },
    "model_inferred"
  );
}

function inferDiagramType(prompt: string): DiagramType {
  if (/技术路线|路线图|阶段|任务[一二三四五六七八九十]/.test(prompt)) {
    return "technical_route";
  }
  if (/研究框架|框架图|项目申请|研究内容|总体框架/.test(prompt)) {
    return "research_framework";
  }
  if (/模型|架构|网络|transformer|encoder|decoder|算法/i.test(prompt)) {
    return "model_architecture";
  }
  return "general";
}

function groupNodeIdsFromPlan(plan: DiagramPlan, groupId: string): string[] {
  const fromModuleGroup = plan.modules
    .filter((module) => module.groupId === groupId)
    .map((module) => module.id);
  const fromInsideConstraints = (plan.layoutConstraints ?? [])
    .filter(
      (constraint): constraint is Extract<DiagramLayoutConstraint, { type: "inside" }> =>
        constraint.type === "inside" && constraint.container === groupId
    )
    .map((constraint) => constraint.subject);
  return Array.from(new Set([...fromModuleGroup, ...fromInsideConstraints]));
}

function inferModelPattern(prompt: string) {
  return /transformer|encoder|decoder|编码器|解码器/i.test(prompt)
    ? "encoder_decoder"
    : "layered";
}

function inferNodeKind(label: string, groupId?: string, shapeKey?: string): DiagramNode["kind"] {
  if (shapeKey?.startsWith("operator.")) return "operator";
  if (shapeKey?.startsWith("model.")) return "model";
  const text = `${label} ${groupId ?? ""}`;
  if (/^\+$|concat|concatenate|拼接|融合|add/i.test(text)) return "operator";
  if (/输入|input|数据|序列/i.test(text)) return "input";
  if (/输出|结果|概率|softmax/i.test(text)) return "output";
  if (/模型|网络|encoder|decoder|attention|ffn|linear/i.test(text)) return "model";
  return "process";
}

function inferShapeKey(label: string, groupId?: string): string {
  const text = `${label} ${groupId ?? ""}`;
  if (/^\+$|add|相加|残差/i.test(text)) return "operator.add";
  if (/concat|concatenate|拼接|融合/i.test(text)) return "operator.concat";
  if (/attention|encoder|decoder|模型|网络|block|ffn|linear/i.test(text)) {
    return "model.block";
  }
  return "basic.round_rect";
}

function extractConstraints(prompt: string): string[] {
  const constraints: string[] = [];
  if (/黑白|灰阶|学术风/.test(prompt)) constraints.push("academic_bw");
  if (/从左到右|左到右|横向/.test(prompt)) constraints.push("left_to_right");
  if (/从上到下|上到下|纵向/.test(prompt)) constraints.push("top_to_bottom");
  if (/虚线/.test(prompt)) constraints.push("dashed_edge");
  return constraints;
}

function extractListedModules(prompt: string): string[] {
  const arrowParts = prompt
    .split(/->|→|=>|接着|然后|最后|之后|到|连接到/)
    .map(cleanModuleLabel)
    .filter(Boolean);
  if (arrowParts.length >= 2 && arrowParts.every((item) => item.length <= 24)) {
    return dedupe(arrowParts);
  }

  const listParts = prompt
    .split(/[，,；;、\n]/)
    .map(cleanModuleLabel)
    .filter((item) => item.length >= 2 && item.length <= 24);

  return listParts.length >= 3 ? dedupe(listParts) : [];
}

function cleanModuleLabel(value: string): string {
  return value
    .replace(/^(绘制|画|生成|做|一个|一张|请|请你|输入是|输入为|输出是|输出为)/g, "")
    .replace(/^(后面接|再接|接着|然后|之后|最后得到|最后输出|最后)/g, "")
    .replace(/(模块)?从[^，,；;。]*$/, "")
    .replace(/(模块)?(?:用)?虚线$/, "")
    .replace(/^通过/g, "")
    .replace(/(的)?(流程图|框架图|结构图|架构图|技术路线图)$/g, "")
    .replace(/[。；;，,]+$/g, "")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
