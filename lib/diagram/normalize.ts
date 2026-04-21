import type {
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  DiagramSpec,
  DiagramType,
  LayoutPattern,
  NormalizedDiagramSpec
} from "./types.ts";
import { normalizeShapeKey } from "./shape-library/registry.ts";

const MAX_NODES = 40;

export function normalizeDiagramSpec(spec: DiagramSpec): NormalizedDiagramSpec {
  const type = spec.type ?? "general";
  const nodes = normalizeNodes(spec.nodes ?? [], MAX_NODES);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeEdges(spec.edges ?? [], nodeIds);
  const groups = normalizeGroups(spec.groups ?? [], nodes);

  return {
    title: spec.title?.trim() || defaultTitle(type),
    type,
    nodes,
    edges,
    groups,
    layout: {
      direction: spec.layout?.direction ?? defaultDirection(type),
      pattern: spec.layout?.pattern ?? defaultPattern(type)
    },
    style: {
      preset: "academic_bw"
    }
  };
}

function normalizeNodes(nodes: DiagramNode[], limit: number): DiagramNode[] {
  const seen = new Set<string>();
  const normalized: DiagramNode[] = [];

  for (const [index, node] of nodes.slice(0, limit).entries()) {
    const label = String(node.label ?? "").trim();
    if (!label) continue;

    const baseId = sanitizeId(node.id || label || `node_${index + 1}`);
    const id = uniqueId(baseId, seen);
    seen.add(id);

    normalized.push({
      ...node,
      id,
      label,
      kind: node.kind ?? inferNodeKind(node),
      shapeKey: normalizeShapeKey(node.shapeKey ?? defaultShapeKey(node)),
      order: node.order ?? index
    });
  }

  if (normalized.length === 0) {
    normalized.push({
      id: "node_1",
      label: "核心模块",
      kind: "process",
      shapeKey: "basic.round_rect",
      order: 0
    });
  }

  return normalized;
}

function inferNodeKind(node: DiagramNode): DiagramNode["kind"] {
  if (node.kind) return node.kind;
  if (node.shapeKey?.startsWith("operator.")) return "operator";
  if (node.shapeKey?.startsWith("model.")) return "model";
  return "process";
}

function defaultShapeKey(node: DiagramNode): string {
  if (node.kind === "operator") {
    if (/concat|concatenate|拼接|融合/i.test(node.label)) return "operator.concat";
    if (/乘|multiply|x|\*/i.test(node.label)) return "operator.multiply";
    return "operator.add";
  }
  if (node.kind === "model") return "model.block";
  return "basic.round_rect";
}

function normalizeEdges(edges: DiagramEdge[], nodeIds: Set<string>): DiagramEdge[] {
  const seen = new Set<string>();
  const normalized: DiagramEdge[] = [];

  for (const [index, edge] of edges.entries()) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) {
      continue;
    }

    const baseId = sanitizeId(edge.id || `edge_${index + 1}`);
    const id = uniqueId(baseId, seen);
    seen.add(id);

    normalized.push({
      ...edge,
      id,
      kind: edge.kind ?? "main",
      style: edge.style ?? "solid"
    });
  }

  return normalized;
}

function normalizeGroups(groups: DiagramGroup[], nodes: DiagramNode[]): DiagramGroup[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const normalized: DiagramGroup[] = [];

  for (const [index, group] of groups.entries()) {
    const id = uniqueId(sanitizeId(group.id || group.title || `group_${index + 1}`), seen);
    const nodeIdsInGroup = group.nodeIds.filter((nodeId) => nodeIds.has(nodeId));
    if (nodeIdsInGroup.length === 0) continue;
    seen.add(id);

    normalized.push({
      id,
      title: group.title.trim() || `分组 ${index + 1}`,
      nodeIds: nodeIdsInGroup,
      kind: group.kind ?? "container"
    });
  }

  const groupedNodeIds = new Set(normalized.flatMap((group) => group.nodeIds));
  const missingGroups = new Map<string, string[]>();

  for (const node of nodes) {
    if (!node.groupId || groupedNodeIds.has(node.id)) continue;
    const ids = missingGroups.get(node.groupId) ?? [];
    ids.push(node.id);
    missingGroups.set(node.groupId, ids);
  }

  for (const [groupId, ids] of missingGroups.entries()) {
    normalized.push({
      id: uniqueId(sanitizeId(groupId), seen),
      title: groupId,
      nodeIds: ids,
      kind: "container"
    });
  }

  return normalized;
}

export function sanitizeId(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "item";
}

function uniqueId(baseId: string, seen: Set<string>): string {
  if (!seen.has(baseId)) return baseId;
  let index = 2;
  while (seen.has(`${baseId}_${index}`)) {
    index += 1;
  }
  return `${baseId}_${index}`;
}

function defaultTitle(type: DiagramType): string {
  switch (type) {
    case "technical_route":
      return "技术路线图";
    case "research_framework":
      return "研究框架图";
    case "model_architecture":
      return "模型结构图";
    default:
      return "科学 Diagram";
  }
}

function defaultDirection(type: DiagramType) {
  return type === "model_architecture" ? "top_to_bottom" : "left_to_right";
}

function defaultPattern(type: DiagramType): LayoutPattern {
  switch (type) {
    case "technical_route":
      return "stage";
    case "research_framework":
      return "three_column";
    case "model_architecture":
      return "layered";
    default:
      return "flow";
  }
}
