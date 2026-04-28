import type {
  LayoutEdge,
  LayoutGroup,
  LayoutNode,
  LayoutPattern,
  LayoutPoint,
  LayoutSpec,
  NormalizedDiagramSpec
} from "./types.ts";
import { getShapeDefinition } from "./shape-library/registry.ts";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const TITLE_HEIGHT = 54;
const MARGIN_X = 70;
const MARGIN_TOP = 92;
const MARGIN_BOTTOM = 58;
const GROUP_PADDING = 24;

export function layoutDiagram(diagram: NormalizedDiagramSpec): LayoutSpec {
  const pattern = diagram.layout.pattern ?? "flow";
  const nodes =
    diagram.layoutConstraints.length > 0
      ? constraintAwareLayout(diagram)
      : pattern === "three_column" || pattern === "stage" || pattern === "encoder_decoder"
      ? groupedColumnsLayout(diagram)
      : diagram.layout.direction === "top_to_bottom"
        ? verticalFlowLayout(diagram)
        : horizontalFlowLayout(diagram);

  const groups = layoutGroups(diagram, nodes);
  const edges = layoutEdges(diagram, nodes);

  return {
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      unit: "px"
    },
    title: {
      x: MARGIN_X,
      y: 24,
      width: CANVAS_WIDTH - MARGIN_X * 2,
      height: TITLE_HEIGHT
    },
    nodes,
    edges,
    groups
  };
}

function constraintAwareLayout(diagram: NormalizedDiagramSpec): LayoutNode[] {
  const mainFlow = diagram.layoutConstraints.find((constraint) => constraint.type === "main_flow");
  if (!mainFlow) return horizontalFlowLayout(diagram);

  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const mainNodes = mainFlow.nodes
    .map((id) => nodeById.get(id))
    .filter((node): node is NormalizedDiagramSpec["nodes"][number] => Boolean(node));
  if (mainNodes.length < 2) return horizontalFlowLayout(diagram);

  const direction =
    mainFlow.direction ??
    (diagram.layout.direction === "top_to_bottom" ? "top_to_bottom" : "left_to_right");
  const positioned =
    direction === "top_to_bottom" || direction === "bottom_to_top"
      ? constrainedVerticalMainFlow(mainNodes, direction)
      : constrainedHorizontalMainFlow(mainNodes, direction);

  const placed = new Map(positioned.map((node) => [node.id, node]));
  const remaining = diagram.nodes.filter((node) => !placed.has(node.id));

  for (const node of remaining) {
    const relative = findRelativeConstraint(diagram, node.id, placed);
    const size = nodeSize(node, 190);
    const layoutNode = relative
      ? placeRelativeNode(size, relative.anchor, relative.placement)
      : placeLooseNode(size, placed.size);
    placed.set(node.id, {
      id: node.id,
      ...layoutNode
    });
  }

  return diagram.nodes
    .map((node) => placed.get(node.id))
    .filter((node): node is LayoutNode => Boolean(node));
}

function constrainedHorizontalMainFlow(
  nodes: NormalizedDiagramSpec["nodes"],
  direction: "left_to_right" | "right_to_left"
): LayoutNode[] {
  const ordered = direction === "right_to_left" ? [...nodes].reverse() : nodes;
  const sizes = ordered.map((node) => nodeSize(node, ordered.length > 6 ? 150 : 190));
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const totalNodeWidth = sizes.reduce((sum, size) => sum + size.width, 0);
  const gap = ordered.length <= 1 ? 0 : Math.max(36, (usableWidth - totalNodeWidth) / (ordered.length - 1));
  const totalWidth = totalNodeWidth + gap * Math.max(0, ordered.length - 1);
  const centerY = MARGIN_TOP + (CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / 2;
  let x = MARGIN_X + Math.max(0, (usableWidth - totalWidth) / 2);

  const laidOut = ordered.map((node, index) => {
    const size = sizes[index];
    const layoutNode = {
      id: node.id,
      x,
      y: centerY - size.height / 2,
      width: size.width,
      height: size.height
    };
    x += size.width + gap;
    return layoutNode;
  });

  return direction === "right_to_left" ? laidOut.reverse() : laidOut;
}

function constrainedVerticalMainFlow(
  nodes: NormalizedDiagramSpec["nodes"],
  direction: "top_to_bottom" | "bottom_to_top"
): LayoutNode[] {
  const ordered = direction === "bottom_to_top" ? [...nodes].reverse() : nodes;
  const sizes = ordered.map((node) => nodeSize(node, 230, ordered.length >= 8));
  const usableHeight = CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const totalNodeHeight = sizes.reduce((sum, size) => sum + size.height, 0);
  const gap = ordered.length <= 1 ? 0 : Math.max(14, (usableHeight - totalNodeHeight) / (ordered.length - 1));
  const totalHeight = totalNodeHeight + gap * Math.max(0, ordered.length - 1);
  let y = MARGIN_TOP + Math.max(0, (usableHeight - totalHeight) / 2);

  const laidOut = ordered.map((node, index) => {
    const size = sizes[index];
    const layoutNode = {
      id: node.id,
      x: (CANVAS_WIDTH - size.width) / 2,
      y,
      width: size.width,
      height: size.height
    };
    y += size.height + gap;
    return layoutNode;
  });

  return direction === "bottom_to_top" ? laidOut.reverse() : laidOut;
}

function findRelativeConstraint(
  diagram: NormalizedDiagramSpec,
  nodeId: string,
  placed: Map<string, LayoutNode>
): { anchor: LayoutNode; placement: "top" | "bottom" | "left" | "right" } | null {
  for (const constraint of diagram.layoutConstraints) {
    if (
      (constraint.type === "left_of" ||
        constraint.type === "right_of" ||
        constraint.type === "above" ||
        constraint.type === "below") &&
      constraint.subject === nodeId
    ) {
      const anchor = placed.get(constraint.object);
      if (!anchor) continue;
      return {
        anchor,
        placement:
          constraint.type === "left_of"
            ? "left"
            : constraint.type === "right_of"
              ? "right"
              : constraint.type === "above"
                ? "top"
                : "bottom"
      };
    }

    if (constraint.type === "branch" && constraint.from === nodeId) {
      const anchor = placed.get(constraint.to);
      if (!anchor) continue;
      return {
        anchor,
        placement: constraint.placement ?? "bottom"
      };
    }
  }

  return null;
}

function placeRelativeNode(
  size: { width: number; height: number },
  anchor: LayoutNode,
  placement: "top" | "bottom" | "left" | "right"
) {
  const gap = 70;
  const anchorCenter = center(anchor);
  if (placement === "left") {
    return clampNodeBox({
      x: anchor.x - size.width - gap,
      y: anchorCenter.y - size.height / 2,
      width: size.width,
      height: size.height
    });
  }
  if (placement === "right") {
    return clampNodeBox({
      x: anchor.x + anchor.width + gap,
      y: anchorCenter.y - size.height / 2,
      width: size.width,
      height: size.height
    });
  }
  if (placement === "top") {
    return clampNodeBox({
      x: anchorCenter.x - size.width / 2,
      y: anchor.y - size.height - gap,
      width: size.width,
      height: size.height
    });
  }
  return clampNodeBox({
    x: anchorCenter.x - size.width / 2,
    y: anchor.y + anchor.height + gap,
    width: size.width,
    height: size.height
  });
}

function placeLooseNode(size: { width: number; height: number }, index: number) {
  const x = MARGIN_X + (index % 4) * 230;
  const y = CANVAS_HEIGHT - MARGIN_BOTTOM - size.height - Math.floor(index / 4) * 86;
  return clampNodeBox({ x, y, width: size.width, height: size.height });
}

function clampNodeBox(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: clamp(rect.x, MARGIN_X / 2, CANVAS_WIDTH - MARGIN_X / 2 - rect.width),
    y: clamp(rect.y, MARGIN_TOP, CANVAS_HEIGHT - MARGIN_BOTTOM - rect.height),
    width: rect.width,
    height: rect.height
  };
}

function groupedColumnsLayout(diagram: NormalizedDiagramSpec): LayoutNode[] {
  const groups = diagram.groups.length > 0 ? diagram.groups : fallbackGroups(diagram);
  const columnCount = Math.max(groups.length, 1);
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const columnGap = columnCount > 1 ? 34 : 0;
  const columnWidth = (usableWidth - columnGap * (columnCount - 1)) / columnCount;

  const positioned: LayoutNode[] = [];

  for (const [columnIndex, group] of groups.entries()) {
    const groupNodes = group.nodeIds
      .map((id) => diagram.nodes.find((node) => node.id === id))
      .filter((node): node is NormalizedDiagramSpec["nodes"][number] => Boolean(node));
    const count = Math.max(groupNodes.length, 1);
    const maxNodeWidth = clamp(columnWidth - GROUP_PADDING * 2, 130, 210);
    const compact = groupNodes.length >= 7;
    const sizes = groupNodes.map((node) => nodeSize(node, maxNodeWidth, compact));
    const areaHeight = CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
    const availableHeight = areaHeight - GROUP_PADDING * 2 - 26;
    const totalNodeHeight = sizes.reduce((sum, size) => sum + size.height, 0);
    const minGap = compact ? 7 : 22;
    const gap = count === 1 ? 0 : Math.max(minGap, (availableHeight - totalNodeHeight) / (count - 1));
    const blockHeight = totalNodeHeight + gap * (count - 1);
    const startY = MARGIN_TOP + 42 + Math.max(0, (availableHeight - blockHeight) / 2);
    const columnX = MARGIN_X + columnIndex * (columnWidth + columnGap);
    let y = startY;

    for (const [rowIndex, node] of groupNodes.entries()) {
      const size = sizes[rowIndex];
      const x = columnX + (columnWidth - size.width) / 2;
      positioned.push({
        id: node.id,
        x,
        y,
        width: size.width,
        height: size.height
      });
      y += size.height + gap;
    }
  }

  const placed = new Set(positioned.map((node) => node.id));
  const orphanNodes = diagram.nodes.filter((node) => !placed.has(node.id));
  if (orphanNodes.length > 0) {
    const orphanLayout = horizontalFlowLayout({
      ...diagram,
      nodes: orphanNodes,
      layout: { ...diagram.layout, pattern: "flow" as LayoutPattern }
    });
    positioned.push(...orphanLayout);
  }

  return positioned;
}

function horizontalFlowLayout(diagram: NormalizedDiagramSpec): LayoutNode[] {
  const count = diagram.nodes.length;
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const sizes = diagram.nodes.map((node) => nodeSize(node, count > 6 ? 150 : 190));
  const totalNodeWidth = sizes.reduce((sum, size) => sum + size.width, 0);
  const maxHeight = Math.max(...sizes.map((size) => size.height));
  const gap = count <= 1 ? 0 : Math.max(28, (usableWidth - totalNodeWidth) / (count - 1));
  const totalWidth = totalNodeWidth + gap * Math.max(0, count - 1);
  const startX = MARGIN_X + Math.max(0, (usableWidth - totalWidth) / 2);
  const centerY = MARGIN_TOP + (CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / 2;
  let x = startX;

  return diagram.nodes.map((node, index) => {
    const size = sizes[index];
    const layoutNode = {
      id: node.id,
      x,
      y: centerY - Math.min(size.height, maxHeight) / 2,
      width: size.width,
      height: size.height
    };
    x += size.width + gap;
    return layoutNode;
  });
}

function verticalFlowLayout(diagram: NormalizedDiagramSpec): LayoutNode[] {
  const count = diagram.nodes.length;
  const usableHeight = CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const sizes = diagram.nodes.map((node) => nodeSize(node, 250));
  const totalNodeHeight = sizes.reduce((sum, size) => sum + size.height, 0);
  const gap = count <= 1 ? 0 : Math.max(18, (usableHeight - totalNodeHeight) / (count - 1));
  const totalHeight = totalNodeHeight + gap * Math.max(0, count - 1);
  const startY = MARGIN_TOP + Math.max(0, (usableHeight - totalHeight) / 2);
  let y = startY;

  return diagram.nodes.map((node, index) => {
    const size = sizes[index];
    const layoutNode = {
      id: node.id,
      x: (CANVAS_WIDTH - size.width) / 2,
      y,
      width: size.width,
      height: size.height
    };
    y += size.height + gap;
    return layoutNode;
  });
}

function layoutGroups(diagram: NormalizedDiagramSpec, nodes: LayoutNode[]): LayoutGroup[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return diagram.groups
    .map((group) => {
      const groupNodes = group.nodeIds
        .map((id) => nodeById.get(id))
        .filter((node): node is LayoutNode => Boolean(node));
      if (groupNodes.length === 0) return null;

      const minX = Math.min(...groupNodes.map((node) => node.x));
      const minY = Math.min(...groupNodes.map((node) => node.y));
      const maxX = Math.max(...groupNodes.map((node) => node.x + node.width));
      const maxY = Math.max(...groupNodes.map((node) => node.y + node.height));

      return {
        id: group.id,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - 26,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2 + 26
      };
    })
    .filter((group): group is LayoutGroup => Boolean(group));
}

function layoutEdges(diagram: NormalizedDiagramSpec, nodes: LayoutNode[]): LayoutEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: LayoutEdge[] = [];

  for (const edge of diagram.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;

    const points = edgePoints(from, to);
    const layoutEdge: LayoutEdge = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      points
    };

    if (edge.label && points.length >= 2) {
      layoutEdge.label = labelLayout(
        points[Math.floor(points.length / 2 - 0.5)],
        points[Math.ceil(points.length / 2)]
      );
    }

    edges.push(layoutEdge);
  }

  return edges;
}

function edgePoints(from: LayoutNode, to: LayoutNode): LayoutPoint[] {
  const fromCenter = center(from);
  const toCenter = center(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const start = {
      x: dx >= 0 ? from.x + from.width : from.x,
      y: fromCenter.y
    };
    const end = {
      x: dx >= 0 ? to.x : to.x + to.width,
      y: toCenter.y
    };
    if (Math.abs(start.y - end.y) < 4) return [start, end];
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }

  const start = {
    x: fromCenter.x,
    y: dy >= 0 ? from.y + from.height : from.y
  };
  const end = {
    x: toCenter.x,
    y: dy >= 0 ? to.y : to.y + to.height
  };
  if (Math.abs(start.x - end.x) < 4) return [start, end];
  const midY = (start.y + end.y) / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

function center(node: LayoutNode): LayoutPoint {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
}

function labelLayout(a: LayoutPoint, b: LayoutPoint) {
  return {
    x: (a.x + b.x) / 2 - 42,
    y: (a.y + b.y) / 2 - 12,
    width: 84,
    height: 24
  };
}

function fallbackGroups(diagram: NormalizedDiagramSpec) {
  return [
    {
      id: "main",
      title: diagram.title,
      nodeIds: diagram.nodes.map((node) => node.id),
      kind: "container" as const
    }
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeSize(
  node: NormalizedDiagramSpec["nodes"][number],
  maxWidth: number,
  compact = false
) {
  const shape = getShapeDefinition(node.shapeKey);
  const isOperator = shape.category === "operator";
  if (compact) {
    return {
      width: isOperator ? Math.min(shape.defaultSize.width, 54) : Math.min(shape.defaultSize.width, maxWidth),
      height: isOperator ? Math.min(shape.defaultSize.height, 36) : Math.min(shape.defaultSize.height, 46)
    };
  }
  return {
    width: isOperator ? shape.defaultSize.width : Math.min(shape.defaultSize.width, maxWidth),
    height: shape.defaultSize.height
  };
}
