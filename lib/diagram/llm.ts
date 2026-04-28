import type {
  DiagramLayoutConstraint,
  DiagramLayoutConstraintDraft,
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
  layoutConstraints?: DiagramLayoutConstraintDraft[];
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

    const parsedJson = coercePlannerJson(parseJsonObject(content), createPlanningPolicy(context.rawPrompt));
    const validated = diagramPlanSchema.safeParse(parsedJson);
    if (!validated.success) {
      return {
        ok: false,
        reason: `LLM JSON validation failed: ${formatValidationIssues(validated.error.issues)}`
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

export function getLlmStatus():
  | {
      configured: true;
      model: string;
      endpoint: string;
    }
  | {
      configured: false;
    } {
  const config = getLlmConfig();
  if (!config) return { configured: false };
  return {
    configured: true,
    model: config.model,
    endpoint: config.endpoint
  };
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

  if (!strict && isKnownArchitecture && !hasConcreteRelation && !hasModuleList) {
    return {
      intentType: "conceptual",
      allowInference: true,
      defaultSource: "model_inferred",
      instruction:
        "用户只给出经典架构主题。可以补全一个合理初稿，但补全内容必须标记为 model_inferred，并在 assumptions 中说明。",
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
    "你是一个通用 Diagram 结构解析器。",
    "你的任务不是设计最终视觉效果，而是把中文绘图描述解析为严格 JSON 的 DiagramPlan。",
    "不要输出 Markdown，不要输出解释，只输出一个 JSON object。",
    "JSON 必须符合：",
    "{ subject, diagramType, intentType, mainIdea, groups?, modules, connections, layoutConstraints?, layoutNotes?, simplificationNotes?, assumptions?, unresolvedQuestions? }。",
    "diagramType 只能是 technical_route、research_framework、model_architecture、general。",
    "diagramType 必须等于用户消息中的 context.diagramType。",
    "intentType 只能是 explicit、conceptual、mixed，并应等于用户消息中的 planningPolicy.intentType。",
    "module.id、group.id 必须使用简短稳定的 snake_case ASCII 标识。",
    "module.label 使用用户语言，优先中文；必要时保留通用英文术语。",
    "每个 module 必须包含 source，取值只能是 user_explicit 或 model_inferred。",
    "每个 connection 必须包含 source，取值只能是 user_explicit 或 model_inferred。",
    "connection.from 和 connection.to 必须引用 modules 中存在的 id。",
    "connection.role 可使用 main、auxiliary、branch、feedback、residual、merge、reference。",
    "shapeKey 只能从 availableShapeKeys 中选择；不确定时使用 basic.round_rect。",
    "如果用户提到 Add、相加、残差汇合，可使用 operator.add 作为真实 module；如果用户提到 Concat、Concatenate、拼接、融合，可使用 operator.concat 作为真实 module。",
    "如果用户提到包含、放在、框起来、属于、整体包在，应生成 groups 或 inside 布局约束。",
    "如果用户提到左边、右边、上方、下方、并列、同一行、同一列、上下三层、左右结构，应生成 layoutConstraints。",
    "如果用户提到 A 指向 B、A 连接 B、A 后面接 B，应生成 connections；主流程还应生成 main_flow 布局约束。",
    "layoutConstraints 支持 main_flow、left_of、right_of、above、below、same_row、same_column、inside、branch。",
    "layoutConstraints 中 main_flow、same_row、same_column 必须使用 nodes 字段，不要使用 modules。",
    "layoutConstraints 中 left_of、right_of、above、below 必须使用 subject 和 object 字段，不要使用 source 和 target 表示节点。",
    "layoutConstraints 中 inside 必须使用 subject 和 container 字段；如果多个节点在同一容器内，输出多个 inside 约束。",
    "如果要表达输入层、方法层、输出层三列，请用 groups + 多个 inside 约束，不要把 group id 放进 left_of/right_of。",
    "所有 layoutConstraints 的 source 字段只能是 user_explicit 或 model_inferred，用来表示来源，不要填节点 id。",
    "connection.style 只能是 solid 或 dashed；不要使用 lineStyle 字段。",
    "group 必须使用 title 字段，不要使用 label 字段。",
    "layoutConstraints 只表达相对位置和逻辑，不要输出具体坐标。",
    "当 planningPolicy.allowInference 为 false 时，不得新增用户没有明确提到的业务模块，不得补全常识模块。",
    "当 planningPolicy.allowInference 为 false 且连接关系不明确时，把问题写入 unresolvedQuestions，不要臆造连接。",
    "当 planningPolicy.allowInference 为 true 时，允许合理补全，但必须把补全内容标记为 model_inferred，并在 assumptions 中说明。",
    "layoutNotes、simplificationNotes、assumptions、unresolvedQuestions 必须是字符串数组；没有内容时输出空数组或省略。",
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
    })),
    availableLayoutConstraintTypes: [
      "main_flow",
      "left_of",
      "right_of",
      "above",
      "below",
      "same_row",
      "same_column",
      "inside",
      "branch"
    ]
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

function formatValidationIssues(
  issues: Array<{ path: Array<string | number>; message: string }>
): string {
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function coercePlannerJson(value: unknown, policy: PlanningPolicy): unknown {
  if (!isRecord(value)) return value;
  const plan = { ...value };

  if (Array.isArray(plan.groups)) {
    plan.groups = plan.groups.map((group) => {
      if (!isRecord(group)) return group;
      return {
        ...group,
        title: group.title ?? group.label ?? group.name
      };
    });
  }

  if (Array.isArray(plan.connections)) {
    plan.connections = plan.connections.map((connection) => {
      if (!isRecord(connection)) return connection;
      return {
        ...connection,
        style: connection.style ?? connection.lineStyle
      };
    });
  }

  if (Array.isArray(plan.layoutConstraints)) {
    plan.layoutConstraints = plan.layoutConstraints.flatMap((constraint) =>
      coerceLayoutConstraint(constraint, policy.defaultSource)
    );
  }

  for (const key of [
    "layoutNotes",
    "simplificationNotes",
    "assumptions",
    "unresolvedQuestions"
  ]) {
    const noteValue = plan[key];
    if (typeof noteValue === "string") {
      plan[key] = [noteValue];
    }
  }

  return plan;
}

function coerceLayoutConstraint(value: unknown, defaultSource: PlanSource): unknown[] {
  if (!isRecord(value)) return [value];
  const type = value.type;
  const provenance =
    value.source === "user_explicit" || value.source === "model_inferred"
      ? value.source
      : defaultSource;

  if (type === "main_flow" || type === "same_row" || type === "same_column") {
    const nodes =
      value.nodes ??
      value.modules ??
      value.nodeIds ??
      value.items ??
      value.children ??
      value.members;
    if (!Array.isArray(nodes)) return [];
    return [
      {
        ...value,
        nodes,
        source: provenance
      }
    ];
  }

  if (type === "left_of" || type === "right_of" || type === "above" || type === "below") {
    const subject = value.subject ?? value.source ?? value.from;
    const object = value.object ?? value.target ?? value.to ?? value.reference;
    if (typeof subject !== "string" || typeof object !== "string") return [];
    return [
      {
        ...value,
        subject,
        object,
        source: provenance
      }
    ];
  }

  if (type === "inside") {
    const container = value.container ?? value.group ?? value.groupId ?? value.parent ?? value.target;
    const subjects = firstArray(
      value.modules,
      value.nodes,
      value.nodeIds,
      value.items,
      value.children,
      value.members
    ) ?? [value.subject ?? value.source ?? value.node].filter(Boolean);
    if (typeof container !== "string" || subjects.length === 0) return [];
    return subjects
      .filter((subject): subject is string => typeof subject === "string")
      .map((subject) => ({
        ...value,
        subject,
        container,
        source: provenance
      }));
  }

  if (type === "branch") {
    const from = value.from ?? value.source ?? value.subject;
    if (typeof from !== "string") return [];
    const targets =
      firstArray(value.targets, value.outputs, value.to) ??
      [value.to ?? value.target ?? value.object].filter(Boolean);
    return targets
      .filter((target): target is string => typeof target === "string")
      .map((to) => ({
        ...value,
        from,
        to,
        through: firstArray(value.through, value.via, value.nodes, value.modules),
        source: provenance
      }));
  }

  return [
    {
      ...value,
      source: provenance
    }
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstArray(...values: unknown[]): unknown[] | undefined {
  return values.find((value): value is unknown[] => Array.isArray(value));
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
    diagramType: context.diagramType,
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
      ),
    layoutConstraints: repairLayoutConstraints(
      plan.layoutConstraints ?? [],
      idMap,
      groupIdMap,
      moduleIds,
      groupIds,
      policy.defaultSource
    )
  };
}

function repairLayoutConstraints(
  constraints: DiagramPlanDraft["layoutConstraints"],
  idMap: Map<string, string>,
  groupIdMap: Map<string, string>,
  moduleIds: Set<string>,
  groupIds: Set<string>,
  defaultSource: PlanSource
): DiagramLayoutConstraint[] {
  const repaired: DiagramLayoutConstraint[] = [];

  for (const constraint of constraints ?? []) {
    switch (constraint.type) {
      case "main_flow": {
        const nodes = constraint.nodes
          .map((id) => idMap.get(id) ?? id)
          .filter((id) => moduleIds.has(id));
        if (nodes.length >= 2) {
          repaired.push({
            ...constraint,
            nodes: Array.from(new Set(nodes)),
            source: constraint.source ?? defaultSource
          });
        }
        break;
      }
      case "same_row":
      case "same_column": {
        const nodes = constraint.nodes
          .map((id) => idMap.get(id) ?? id)
          .filter((id) => moduleIds.has(id));
        if (nodes.length >= 2) {
          repaired.push({
            ...constraint,
            nodes: Array.from(new Set(nodes)),
            source: constraint.source ?? defaultSource
          });
        }
        break;
      }
      case "left_of":
      case "right_of":
      case "above":
      case "below": {
        const subject = idMap.get(constraint.subject) ?? constraint.subject;
        const object = idMap.get(constraint.object) ?? constraint.object;
        if (moduleIds.has(subject) && moduleIds.has(object) && subject !== object) {
          repaired.push({
            ...constraint,
            subject,
            object,
            source: constraint.source ?? defaultSource
          });
        }
        break;
      }
      case "inside": {
        const subject = idMap.get(constraint.subject) ?? constraint.subject;
        const container = groupIdMap.get(constraint.container) ?? constraint.container;
        if (moduleIds.has(subject) && groupIds.has(container)) {
          repaired.push({
            ...constraint,
            subject,
            container,
            source: constraint.source ?? defaultSource
          });
        }
        break;
      }
      case "branch": {
        const from = idMap.get(constraint.from) ?? constraint.from;
        const to = idMap.get(constraint.to) ?? constraint.to;
        const through = constraint.through
          ?.map((id) => idMap.get(id) ?? id)
          .filter((id) => moduleIds.has(id));
        if (moduleIds.has(from) && moduleIds.has(to) && from !== to) {
          repaired.push({
            ...constraint,
            from,
            to,
            through,
            source: constraint.source ?? defaultSource
          });
        }
        break;
      }
    }
  }

  return repaired;
}

function uniqueId(baseId: string, seen: Set<string>): string {
  if (!seen.has(baseId)) return baseId;
  let index = 2;
  while (seen.has(`${baseId}_${index}`)) index += 1;
  return `${baseId}_${index}`;
}
