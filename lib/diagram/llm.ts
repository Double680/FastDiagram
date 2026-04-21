import type {
  DiagramPlan,
  DiagramPlanConnection,
  DiagramPlanGroup,
  DiagramPlanModule,
  DiagramType,
  GenerationContext,
  PlanIntentType,
  PlanSource
} from "./types.ts";
import { diagramPlanSchema } from "./schema.ts";
import {
  hasShapeDefinition,
  listShapeDefinitions,
  normalizeShapeKey
} from "./shape-library/registry.ts";
import { sanitizeId } from "./normalize.ts";

const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 45_000;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type DiagramPlanDraft = {
  subject: string;
  diagramType: DiagramType;
  intentType?: PlanIntentType;
  mainIdea: string;
  groups?: DiagramPlanGroup[];
  modules: Array<Omit<DiagramPlanModule, "source"> & { source?: PlanSource }>;
  connections: Array<Omit<DiagramPlanConnection, "source"> & { source?: PlanSource }>;
  layoutNotes?: string[];
  simplificationNotes?: string[];
  assumptions?: string[];
  unresolvedQuestions?: string[];
};

export type LlmPlanResult =
  | {
      ok: true;
      plan: DiagramPlan;
      model: string;
    }
  | {
      ok: false;
      reason: string;
    };

export async function createLlmDiagramPlan(
  context: GenerationContext
): Promise<LlmPlanResult> {
  const config = getLlmConfig();
  if (!config) {
    return {
      ok: false,
      reason: "LLM environment is not configured"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const planningPolicy = createPlanningPolicy(context.rawPrompt);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildPlannerSystemPrompt()
          },
          {
            role: "user",
            content: JSON.stringify(buildPlannerUserPayload(context, planningPolicy), null, 2)
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        reason: `LLM request failed: ${response.status} ${detail.slice(0, 300)}`
      };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        reason: "LLM response has no message content"
      };
    }

    const parsedJson = parseJsonObject(content);
    const validated = diagramPlanSchema.safeParse(parsedJson);
    if (!validated.success) {
      return {
        ok: false,
        reason: `LLM JSON validation failed: ${validated.error.issues
          .slice(0, 3)
          .map((issue) => issue.message)
          .join("; ")}`
      };
    }

    return {
      ok: true,
      plan: repairPlan(validated.data, context),
      model: config.model
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "LLM request timed out"
        : error instanceof Error
          ? error.message
          : "Unknown LLM request error";
    return {
      ok: false,
      reason
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getLlmConfig() {
  const baseUrl = process.env.BASE_URL?.trim();
  const apiKey = process.env.API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  return {
    endpoint: chatCompletionsEndpoint(baseUrl),
    apiKey,
    model: process.env.MODEL?.trim() || DEFAULT_MODEL
  };
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

type PlanningPolicy = {
  intentType: PlanIntentType;
  allowInference: boolean;
  defaultSource: PlanSource;
  instruction: string;
  evidence: string[];
};

export function createPlanningPolicy(prompt: string): PlanningPolicy {
  const strict = /严格按照|不要增加|不要新增|不需要补充|只按|仅按|完全按照/.test(prompt);
  const asksForExpansion = /完善|补全|合理扩展|帮我扩展|丰富一下|自动补充/.test(prompt);
  const isKnownArchitecture = /transformer|encoder[-\s]?decoder|编码器|解码器/i.test(prompt);
  const hasConcreteRelation =
    /输入是|输入为|输出是|输出为|后面接|再接|接着|然后|之后|最后|连接到|连到|->|→|=>|虚线|旁路|分支/.test(
      prompt
    );
  const hasModuleList = /包含|包括|由.*组成|模块[:：]|步骤[:：]|节点[:：]/.test(prompt);
  const evidence = [
    strict ? "strict_no_expansion" : "",
    asksForExpansion ? "asks_for_expansion" : "",
    isKnownArchitecture ? "known_architecture" : "",
    hasConcreteRelation ? "has_concrete_relation" : "",
    hasModuleList ? "has_module_list" : ""
  ].filter(Boolean);

  if (!strict && isKnownArchitecture) {
    return {
      intentType: hasConcreteRelation || hasModuleList ? "mixed" : "conceptual",
      allowInference: true,
      defaultSource: hasConcreteRelation || hasModuleList ? "user_explicit" : "model_inferred",
      instruction:
        "用户在描述经典模型架构。保留用户明确列出的模块，同时允许补全该架构的典型内部模块、残差/归一化/注意力/拼接等结构；补全内容必须标记为 model_inferred，并在 assumptions 中说明。",
      evidence
    };
  }

  if (strict || (hasConcreteRelation && !asksForExpansion)) {
    return {
      intentType: "explicit",
      allowInference: false,
      defaultSource: "user_explicit",
      instruction:
        "用户指令已经给出具体结构。只抽取、归一化和整理用户明确提到的模块与连接，禁止新增业务模块或连接。",
      evidence
    };
  }

  if (hasModuleList && !asksForExpansion) {
    return {
      intentType: "explicit",
      allowInference: false,
      defaultSource: "user_explicit",
      instruction:
        "用户列出了具体模块。只保留用户明确列出的模块；若连接关系不明确，写入 unresolvedQuestions，不要臆造连接。",
      evidence
    };
  }

  if (asksForExpansion) {
    return {
      intentType: "mixed",
      allowInference: true,
      defaultSource: "user_explicit",
      instruction:
        "用户允许补全。用户明确提到的内容标记为 user_explicit，补全内容标记为 model_inferred，并在 assumptions 中说明。",
      evidence
    };
  }

  return {
    intentType: "conceptual",
    allowInference: true,
    defaultSource: "model_inferred",
    instruction:
      "用户只给出主题或宏观需求。可以基于常见学术表达补全关键模块，但所有补全内容必须标记为 model_inferred，并写入 assumptions。",
    evidence
  };
}

export function buildPlannerSystemPrompt(): string {
  return [
    "你是一个学术 Diagram 结构规划器。",
    "你的任务是把中文自然语言绘图需求转换为严格 JSON 的 DiagramPlan。",
    "不要输出 Markdown，不要输出解释，只输出一个 JSON object。",
    "JSON 必须符合：",
    "{ subject, diagramType, intentType, mainIdea, groups?, modules, connections, layoutNotes?, simplificationNotes?, assumptions?, unresolvedQuestions? }。",
    "diagramType 只能是 technical_route、research_framework、model_architecture、general。",
    "intentType 只能是 explicit、conceptual、mixed，并应等于用户消息中的 planningPolicy.intentType。",
    "module.id、group.id 必须使用简短稳定的 snake_case ASCII 标识。",
    "module.label 使用用户语言，优先中文；必要时保留通用英文术语。",
    "每个 module 必须包含 source，取值只能是 user_explicit 或 model_inferred。",
    "每个 connection 必须包含 source，取值只能是 user_explicit 或 model_inferred。",
    "connection.from 和 connection.to 必须引用 modules 中存在的 id。",
    "shapeKey 只能从 availableShapeKeys 中选择；不确定时使用 basic.round_rect。",
    "残差连接、Add、相加节点使用 operator.add，且应作为真实 module。",
    "拼接、Concatenate、Concat、特征融合节点使用 operator.concat，且应作为真实 module。",
    "注意力、Encoder、Decoder、模型块优先使用 model.attention 或 model.block。",
    "当 planningPolicy.allowInference 为 false 时，不得新增用户没有明确提到的业务模块，不得补全常识模块。",
    "当 planningPolicy.allowInference 为 false 且连接关系不明确时，把问题写入 unresolvedQuestions，不要臆造连接。",
    "当 planningPolicy.allowInference 为 true 时，允许合理补全，但必须把补全内容标记为 model_inferred，并在 assumptions 中说明。",
    "节点数量不要超过 context.nodeLimit。",
    "不要生成坐标、尺寸、颜色、SVG 或 PPTX 字段。"
  ].join("\n");
}

export function buildPlannerUserPayload(
  context: GenerationContext,
  planningPolicy: PlanningPolicy = createPlanningPolicy(context.rawPrompt)
) {
  return {
    context,
    planningPolicy,
    availableShapeKeys: listShapeDefinitions().map((shape) => ({
      key: shape.key,
      name: shape.name,
      category: shape.category,
      defaultLabel: shape.defaultLabel,
      preferredFlow: shape.connectionPolicy.preferredFlow
    }))
  };
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("LLM response is not valid JSON");
  }
}

function repairPlan(plan: DiagramPlanDraft, context: GenerationContext): DiagramPlan {
  const policy = createPlanningPolicy(context.rawPrompt);
  const groupSeen = new Set<string>();
  const groupIdMap = new Map<string, string>();
  const groups = (plan.groups ?? []).map((group, index) => {
    const id = uniqueId(sanitizeId(group.id || group.title || `group_${index + 1}`), groupSeen);
    groupSeen.add(id);
    groupIdMap.set(group.id, id);
    return {
      ...group,
      id,
      title: group.title.trim()
    };
  });
  const groupIds = new Set(groups.map((group) => group.id));

  const moduleSeen = new Set<string>();
  const idMap = new Map<string, string>();
  const modules = plan.modules.slice(0, context.nodeLimit).map((module, index) => {
    const id = uniqueId(sanitizeId(module.id || module.label || `node_${index + 1}`), moduleSeen);
    moduleSeen.add(id);
    idMap.set(module.id, id);
    return {
      ...module,
      id,
      label: module.label.trim(),
      groupId:
        module.groupId && groupIds.has(groupIdMap.get(module.groupId) ?? module.groupId)
          ? groupIdMap.get(module.groupId) ?? module.groupId
          : undefined,
      shapeKey: hasShapeDefinition(module.shapeKey)
        ? normalizeShapeKey(module.shapeKey)
        : "basic.round_rect",
      source: module.source ?? policy.defaultSource
    };
  });
  const moduleIds = new Set(modules.map((module) => module.id));

  return {
    ...plan,
    subject: plan.subject.trim(),
    diagramType: plan.diagramType || context.diagramType,
    intentType: plan.intentType ?? policy.intentType,
    groups,
    modules,
    connections: plan.connections
      .map((connection) => ({
        ...connection,
        from: idMap.get(connection.from) ?? connection.from,
        to: idMap.get(connection.to) ?? connection.to,
        source: connection.source ?? policy.defaultSource
      }))
      .filter(
        (connection) =>
          moduleIds.has(connection.from) &&
          moduleIds.has(connection.to) &&
          connection.from !== connection.to
      )
  };
}

function uniqueId(baseId: string, seen: Set<string>): string {
  if (!seen.has(baseId)) return baseId;
  let index = 2;
  while (seen.has(`${baseId}_${index}`)) index += 1;
  return `${baseId}_${index}`;
}
