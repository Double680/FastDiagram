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
  const layeredGroupLayout = shouldUseLayeredGroupLayout(diagram);
  const groupedConstraintLayout = !layeredGroupLayout && shouldUseGroupedConstraintLayout(diagram);
  const placementGroups = groupedConstraintLayout ? groupedPlacementGroups(diagram) : undefined;
  const nodes =
    layeredGroupLayout
      ? horizontalLayersLayout(diagram)
      : groupedConstraintLayout
      ? groupedColumnsLayout(diagram, placementGroups)
      : diagram.layoutConstraints.length > 0
      ? constraintAwareLayout(diagram)
      : pattern === "three_column" || pattern === "stage" || pattern === "encoder_decoder"
      ? groupedColumnsLayout(diagram)
      : diagram.layout.direction === "top_to_bottom"
        ? verticalFlowLayout(diagram)
        : horizontalFlowLayout(diagram);

  const groups = layeredGroupLayout
    ? layoutLayerGroups(diagram, nodes)
    : groupedConstraintLayout && placementGroups
      ? layoutGroups({ ...diagram, groups: placementGroups }, nodes)
      : layoutGroups(diagram, nodes);
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

function shouldUseLayeredGroupLayout(diagram: NormalizedDiagramSpec): boolean {
  if (diagram.groups.length < 4) return false;
  const groupedNodeIds = new Set(diagram.groups.flatMap((group) => group.nodeIds));
  const groupedRatio = groupedNodeIds.size / Math.max(diagram.nodes.length, 1);
  if (groupedRatio < 0.7) return false;

  const hasRowSignal = diagram.layoutConstraints.some((constraint) => {
    if (constraint.type !== "same_row") return false;
    return diagram.groups.some((group) => overlapCount(group.nodeIds, constraint.nodes) >= 2);
  });
  const hasLayerTitleSignal = diagram.groups.some((group) => /层|layer|level/i.test(group.title));
  const hasVerticalMainFlow = diagram.layoutConstraints.some(
    (constraint) =>
      constraint.type === "main_flow" &&
      (constraint.direction === "bottom_to_top" || constraint.direction === "top_to_bottom")
  );

  return hasRowSignal || (hasLayerTitleSignal && hasVerticalMainFlow) || hasLayerTitleSignal;
}

function shouldUseGroupedConstraintLayout(diagram: NormalizedDiagramSpec): boolean {
  const groups = groupedPlacementGroups(diagram);
  if (groups.length < 2) return false;
  const groupedNodeIds = new Set(groups.flatMap((group) => group.nodeIds));
  const groupedRatio = groupedNodeIds.size / Math.max(diagram.nodes.length, 1);
  const hasColumnSignal = diagram.layoutConstraints.some(
    (constraint) =>
      constraint.type === "same_column" ||
      (constraint.type === "inside" && groupedNodeIds.has(constraint.subject))
  );
  const hasRelativeSignal = diagram.layoutConstraints.some((constraint) =>
    constraint.type === "left_of" ||
    constraint.type === "right_of" ||
    constraint.type === "above" ||
    constraint.type === "below" ||
    constraint.type === "same_row" ||
    constraint.type === "same_column"
  );
  return groupedRatio >= 0.6 && (hasColumnSignal || hasRelativeSignal);
}

function horizontalLayersLayout(diagram: NormalizedDiagramSpec): LayoutNode[] {
  const groups = orderedLayerGroups(diagram);
  const rowCount = groups.length;
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const usableHeight = CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const rowHeight = usableHeight / Math.max(rowCount, 1);
  const positioned: LayoutNode[] = [];

  for (const [rowIndex, group] of groups.entries()) {
    const groupNodes = group.nodeIds
      .map((id) => diagram.nodes.find((node) => node.id === id))
      .filter((node): node is NormalizedDiagramSpec["nodes"][number] => Boolean(node));
    if (groupNodes.length === 0) continue;

    const count = groupNodes.length;
    const nodeGap = count > 1 ? 26 : 0;
    const maxNodeWidth =
      count === 1
        ? usableWidth - GROUP_PADDING * 2
        : (usableWidth - GROUP_PADDING * 2 - nodeGap * (count - 1)) / count;
    const sizes = groupNodes.map((node) =>
      layeredNodeSize(node, maxNodeWidth, count === 1 ? "single" : "multi")
    );
    const totalNodeWidth = sizes.reduce((sum, size) => sum + size.width, 0);
    const totalWidth = totalNodeWidth + nodeGap * Math.max(0, count - 1);
    const rowTop = MARGIN_TOP + rowIndex * rowHeight;
    const contentTop = rowTop + 34;
    const contentHeight = Math.max(42, rowHeight - 44);
    let x = MARGIN_X + Math.max(0, (usableWidth - totalWidth) / 2);

    for (const [nodeIndex, node] of groupNodes.entries()) {
      const size = sizes[nodeIndex];
      positioned.push({
        id: node.id,
        x,
        y: contentTop + Math.max(0, (contentHeight - size.height) / 2),
        width: size.width,
        height: size.height
      });
      x += size.width + nodeGap;
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

function orderedLayerGroups(diagram: NormalizedDiagramSpec) {
  const bottomToTop =
    diagram.layoutConstraints.some(
      (constraint) => constraint.type === "main_flow" && constraint.direction === "bottom_to_top"
    ) ||
    (diagram.groups.length >= 2 &&
      /底|背景|起点|bottom/i.test(diagram.groups[0].title) &&
      /顶|意义|目标|输出|top/i.test(diagram.groups[diagram.groups.length - 1].title));
  return bottomToTop ? [...diagram.groups].reverse() : diagram.groups;
}

function layoutLayerGroups(diagram: NormalizedDiagramSpec, nodes: LayoutNode[]): LayoutGroup[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = orderedLayerGroups(diagram);
  const rowCount = groups.length;
  const usableHeight = CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const rowHeight = usableHeight / Math.max(rowCount, 1);

  return groups
    .map((group, index) => {
      const hasNodes = group.nodeIds.some((id) => nodeById.has(id));
      if (!hasNodes) return null;
      return {
        id: group.id,
        x: MARGIN_X - 18,
        y: MARGIN_TOP + index * rowHeight + 4,
        width: CANVAS_WIDTH - (MARGIN_X - 18) * 2,
        height: Math.max(72, rowHeight - 8)
      };
    })
    .filter((group): group is LayoutGroup => Boolean(group));
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

function groupedColumnsLayout(
  diagram: NormalizedDiagramSpec,
  placementGroups = groupedPlacementGroups(diagram)
): LayoutNode[] {
  const groups = placementGroups;
  const columnCount = Math.max(groups.length, 1);
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const columnGap = columnCount > 1 ? 34 : 0;
  const columnWidth = (usableWidth - columnGap * (columnCount - 1)) / columnCount;

  const positioned: LayoutNode[] = [];
  const placedNodeIds = new Set<string>();

  for (const [columnIndex, group] of groups.entries()) {
    const groupNodes = group.nodeIds
      .filter((id) => !placedNodeIds.has(id))
      .map((id) => diagram.nodes.find((node) => node.id === id))
      .filter((node): node is NormalizedDiagramSpec["nodes"][number] => Boolean(node));
    const areaHeight = CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
    const availableHeight = areaHeight - GROUP_PADDING * 2 - 26;
    const columnX = MARGIN_X + columnIndex * (columnWidth + columnGap);
    const constrainedLayout = constraintGridGroupLayout(diagram, groupNodes, {
      x: columnX,
      y: MARGIN_TOP + 42,
      width: columnWidth,
      height: availableHeight
    });
    if (constrainedLayout) {
      positioned.push(...constrainedLayout);
      for (const node of constrainedLayout) placedNodeIds.add(node.id);
      continue;
    }

    const lanes = splitGroupIntoLanes(groupNodes);
    const laneGap = lanes.length > 1 ? 26 : 0;
    const laneWidth = (columnWidth - GROUP_PADDING * 2 - laneGap * (lanes.length - 1)) / lanes.length;

    for (const [laneIndex, laneNodes] of lanes.entries()) {
      const compactLevel: "normal" | "compact" | "dense" =
        groupNodes.length >= 16 || laneNodes.length >= 9
          ? "dense"
          : groupNodes.length >= 9 || laneNodes.length >= 6
          ? "compact"
          : "normal";
      const maxNodeWidth = clamp(laneWidth, 118, 210);
      const sizes = laneNodes.map((node) => nodeSize(node, maxNodeWidth, compactLevel));
      const totalNodeHeight = sizes.reduce((sum, size) => sum + size.height, 0);
      const minGap = compactLevel === "dense" ? 5 : compactLevel === "compact" ? 12 : 22;
      const laneCount = Math.max(laneNodes.length, 1);
      const gap =
        laneCount === 1
          ? 0
          : totalNodeHeight + minGap * (laneCount - 1) > availableHeight
            ? Math.max(5, (availableHeight - totalNodeHeight) / (laneCount - 1))
            : Math.max(minGap, (availableHeight - totalNodeHeight) / (laneCount - 1));
      const blockHeight = totalNodeHeight + gap * Math.max(0, laneCount - 1);
      const startY = MARGIN_TOP + 42 + Math.max(0, (availableHeight - blockHeight) / 2);
      const laneX = columnX + GROUP_PADDING + laneIndex * (laneWidth + laneGap);
      let y = startY;

      for (const [rowIndex, node] of laneNodes.entries()) {
        const size = sizes[rowIndex];
        const x = laneX + (laneWidth - size.width) / 2;
        positioned.push({
          id: node.id,
          x,
          y,
          width: size.width,
          height: size.height
        });
        placedNodeIds.add(node.id);
        y += size.height + gap;
      }
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

function groupedPlacementGroups(diagram: NormalizedDiagramSpec): NormalizedDiagramSpec["groups"] {
  return diagram.groups.length > 0
    ? augmentPlacementGroups(diagram, primaryPlacementGroups(diagram))
    : fallbackGroups(diagram);
}

function splitGroupIntoLanes(groupNodes: NormalizedDiagramSpec["nodes"]): NormalizedDiagramSpec["nodes"][] {
  if (groupNodes.length <= 8) return [groupNodes];
  const splitAt = Math.ceil(groupNodes.length / 2);
  return [groupNodes.slice(0, splitAt), groupNodes.slice(splitAt)];
}

type GridPosition = {
  col?: number;
  row?: number;
};

function constraintGridGroupLayout(
  diagram: NormalizedDiagramSpec,
  groupNodes: NormalizedDiagramSpec["nodes"],
  area: { x: number; y: number; width: number; height: number }
): LayoutNode[] | null {
  if (groupNodes.length < 4) return null;
  const nodeIds = new Set(groupNodes.map((node) => node.id));
  const localConstraints = diagram.layoutConstraints.filter((constraint) =>
    constraintTouchesGroup(constraint, nodeIds)
  );
  const relativeConstraints = localConstraints.filter((constraint) =>
    constraint.type === "left_of" ||
    constraint.type === "right_of" ||
    constraint.type === "above" ||
    constraint.type === "below" ||
    constraint.type === "same_row" ||
    constraint.type === "same_column"
  );
  const mainFlows = localConstraints.filter(
    (constraint): constraint is Extract<NormalizedDiagramSpec["layoutConstraints"][number], { type: "main_flow" }> =>
      constraint.type === "main_flow" && constraint.nodes.filter((id) => nodeIds.has(id)).length >= 2
  );
  if (relativeConstraints.length === 0 && mainFlows.length < 2) return null;

  const grid = new Map<string, GridPosition>();
  for (const node of groupNodes) grid.set(node.id, {});
  const localMainFlows = mainFlows.map((flow) => ({
    ...flow,
    nodes: flow.nodes.filter((id) => nodeIds.has(id))
  }));
  const disjointFlowCount = countMostlyDisjointFlows(localMainFlows);

  if (disjointFlowCount < 2) {
    for (const flow of localMainFlows) applyMainFlowToGrid(grid, flow, diagram.layout.direction);
  }
  applyRelativeConstraints(grid, localConstraints, nodeIds);

  if (disjointFlowCount >= 2) {
    const startRow = maxGridValue(grid, "row") + 1;
    localMainFlows.forEach((flow, flowIndex) => {
      flow.nodes.forEach((id, nodeIndex) => {
        const position = ensureGridPosition(grid, id);
        position.col = position.col ?? flowIndex;
        position.row = position.row ?? startRow + nodeIndex;
      });
    });
    applyRelativeConstraints(grid, localConstraints, nodeIds);
  }

  placeUnpositionedByOrder(groupNodes, grid);
  normalizeGrid(grid);
  spreadDuplicateCells(groupNodes, grid);

  const maxCol = maxGridValue(grid, "col");
  const maxRow = maxGridValue(grid, "row");
  const colCount = maxCol + 1;
  const rowCount = maxRow + 1;
  if (colCount <= 0 || rowCount <= 0) return null;

  const cellGapX = colCount > 1 ? 16 : 0;
  const cellGapY = rowCount > 1 ? 14 : 0;
  const cellWidth = (area.width - GROUP_PADDING * 2 - cellGapX * (colCount - 1)) / colCount;
  const cellHeight = (area.height - cellGapY * (rowCount - 1)) / rowCount;
  if (cellWidth < 74 || cellHeight < 30) return null;

  return groupNodes.map((node) => {
    const position = ensureGridPosition(grid, node.id);
    const compactLevel = groupNodes.length >= 16 ? "dense" : groupNodes.length >= 9 ? "compact" : "normal";
    const size = nodeSize(node, clamp(cellWidth - 10, 74, 210), compactLevel);
    const x = area.x + GROUP_PADDING + (position.col ?? 0) * (cellWidth + cellGapX) + (cellWidth - size.width) / 2;
    const y = area.y + (position.row ?? 0) * (cellHeight + cellGapY) + (cellHeight - size.height) / 2;
    return {
      id: node.id,
      x,
      y,
      width: size.width,
      height: size.height
    };
  });
}

function constraintTouchesGroup(
  constraint: NormalizedDiagramSpec["layoutConstraints"][number],
  nodeIds: Set<string>
): boolean {
  switch (constraint.type) {
    case "main_flow":
    case "same_row":
    case "same_column":
      return constraint.nodes.some((id) => nodeIds.has(id));
    case "left_of":
    case "right_of":
    case "above":
    case "below":
      return nodeIds.has(constraint.subject) || nodeIds.has(constraint.object);
    case "inside":
      return nodeIds.has(constraint.subject);
    case "branch":
      return nodeIds.has(constraint.from) || nodeIds.has(constraint.to) || Boolean(constraint.through?.some((id) => nodeIds.has(id)));
  }
}

function applyMainFlowToGrid(
  grid: Map<string, GridPosition>,
  flow: Extract<NormalizedDiagramSpec["layoutConstraints"][number], { type: "main_flow" }>,
  defaultDirection: NormalizedDiagramSpec["layout"]["direction"]
) {
  const direction = flow.direction ?? (defaultDirection === "top_to_bottom" ? "top_to_bottom" : "left_to_right");
  const vertical = direction === "top_to_bottom" || direction === "bottom_to_top";
  const ordered = direction === "right_to_left" || direction === "bottom_to_top" ? [...flow.nodes].reverse() : flow.nodes;
  ordered.forEach((id, index) => {
    const position = ensureGridPosition(grid, id);
    if (vertical) {
      position.col = position.col ?? 0;
      position.row = position.row ?? index;
    } else {
      position.col = position.col ?? index;
      position.row = position.row ?? 0;
    }
  });
}

function applyRelativeConstraints(
  grid: Map<string, GridPosition>,
  constraints: NormalizedDiagramSpec["layoutConstraints"],
  nodeIds: Set<string>
) {
  for (let pass = 0; pass < 4; pass += 1) {
    for (const constraint of constraints) {
      if (constraint.type === "same_row") {
        const ids = constraint.nodes.filter((id) => nodeIds.has(id));
        if (ids.length < 2) continue;
        const row = firstDefinedGridValue(grid, ids, "row") ?? maxGridValue(grid, "row") + 1;
        const startCol = firstDefinedGridValue(grid, ids, "col") ?? 0;
        ids.forEach((id, index) => {
          const position = ensureGridPosition(grid, id);
          position.row = row;
          position.col = Math.max(position.col ?? startCol + index, startCol + index);
        });
      } else if (constraint.type === "same_column") {
        const ids = constraint.nodes.filter((id) => nodeIds.has(id));
        if (ids.length < 2) continue;
        const col = firstDefinedGridValue(grid, ids, "col") ?? maxGridValue(grid, "col") + 1;
        const startRow = firstDefinedGridValue(grid, ids, "row") ?? 0;
        ids.forEach((id, index) => {
          const position = ensureGridPosition(grid, id);
          position.col = col;
          position.row = Math.max(position.row ?? startRow + index, startRow + index);
        });
      } else if (
        constraint.type === "left_of" ||
        constraint.type === "right_of" ||
        constraint.type === "above" ||
        constraint.type === "below"
      ) {
        if (!nodeIds.has(constraint.subject) || !nodeIds.has(constraint.object)) continue;
        const subject = ensureGridPosition(grid, constraint.subject);
        const object = ensureGridPosition(grid, constraint.object);
        object.col = object.col ?? 0;
        object.row = object.row ?? 0;

        if (constraint.type === "left_of") {
          subject.row = object.row;
          subject.col = Math.min(subject.col ?? object.col - 1, object.col - 1);
        } else if (constraint.type === "right_of") {
          subject.row = object.row;
          subject.col = Math.max(subject.col ?? object.col + 1, object.col + 1);
        } else if (constraint.type === "above") {
          subject.col = object.col;
          subject.row = Math.min(subject.row ?? object.row - 1, object.row - 1);
        } else {
          subject.col = object.col;
          subject.row = Math.max(subject.row ?? object.row + 1, object.row + 1);
        }
      }
    }
  }
}

function countMostlyDisjointFlows(
  flows: Array<Extract<NormalizedDiagramSpec["layoutConstraints"][number], { type: "main_flow" }>>
) {
  const substantial = flows.filter((flow) => flow.nodes.length >= 3);
  if (substantial.length < 2) return substantial.length;
  const seen = new Set<string>();
  let disjoint = 0;
  for (const flow of substantial) {
    const overlap = flow.nodes.filter((id) => seen.has(id)).length;
    if (overlap <= 1) disjoint += 1;
    for (const id of flow.nodes) seen.add(id);
  }
  return disjoint;
}

function placeUnpositionedByOrder(
  nodes: NormalizedDiagramSpec["nodes"],
  grid: Map<string, GridPosition>
) {
  const occupied = new Set<string>();
  for (const [id, position] of grid.entries()) {
    if (position.col !== undefined && position.row !== undefined) {
      occupied.add(gridKey(position.col, position.row));
    }
  }

  let cursorRow = 0;
  let cursorCol = 0;
  const preferredColCount = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
  for (const node of nodes) {
    const position = ensureGridPosition(grid, node.id);
    if (position.col !== undefined && position.row !== undefined) continue;
    while (occupied.has(gridKey(cursorCol, cursorRow))) {
      cursorCol += 1;
      if (cursorCol >= preferredColCount) {
        cursorCol = 0;
        cursorRow += 1;
      }
    }
    position.col = cursorCol;
    position.row = cursorRow;
    occupied.add(gridKey(cursorCol, cursorRow));
  }
}

function spreadDuplicateCells(nodes: NormalizedDiagramSpec["nodes"], grid: Map<string, GridPosition>) {
  const occupied = new Set<string>();
  for (const node of nodes) {
    const position = ensureGridPosition(grid, node.id);
    let col = position.col ?? 0;
    let row = position.row ?? 0;
    while (occupied.has(gridKey(col, row))) col += 1;
    position.col = col;
    position.row = row;
    occupied.add(gridKey(col, row));
  }
}

function normalizeGrid(grid: Map<string, GridPosition>) {
  const cols = [...grid.values()].map((position) => position.col ?? 0);
  const rows = [...grid.values()].map((position) => position.row ?? 0);
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);
  for (const position of grid.values()) {
    position.col = (position.col ?? 0) - minCol;
    position.row = (position.row ?? 0) - minRow;
  }
}

function ensureGridPosition(grid: Map<string, GridPosition>, id: string): GridPosition {
  const existing = grid.get(id);
  if (existing) return existing;
  const created: GridPosition = {};
  grid.set(id, created);
  return created;
}

function firstDefinedGridValue(
  grid: Map<string, GridPosition>,
  ids: string[],
  axis: "col" | "row"
): number | undefined {
  for (const id of ids) {
    const value = ensureGridPosition(grid, id)[axis];
    if (value !== undefined) return value;
  }
  return undefined;
}

function maxGridValue(grid: Map<string, GridPosition>, axis: "col" | "row"): number {
  return Math.max(0, ...[...grid.values()].map((position) => position[axis] ?? 0));
}

function gridKey(col: number, row: number): string {
  return `${col}:${row}`;
}

function primaryPlacementGroups(diagram: NormalizedDiagramSpec) {
  return diagram.groups.filter((group, index) => {
    const nodeIds = new Set(group.nodeIds);
    if (nodeIds.size === 0) return false;
    return !diagram.groups.some((other, otherIndex) => {
      if (otherIndex === index || other.nodeIds.length <= group.nodeIds.length) return false;
      const otherIds = new Set(other.nodeIds);
      return group.nodeIds.some((nodeId) => otherIds.has(nodeId));
    });
  });
}

function augmentPlacementGroups(
  diagram: NormalizedDiagramSpec,
  groups: NormalizedDiagramSpec["groups"]
) {
  const augmented = groups.map((group) => ({
    ...group,
    nodeIds: [...group.nodeIds]
  }));
  const assigned = new Set(augmented.flatMap((group) => group.nodeIds));
  const nodeOrder = new Map(diagram.nodes.map((node, index) => [node.id, node.order ?? index]));
  const groupIndexById = new Map(augmented.map((group, index) => [group.id, index]));
  const nodeGroupIndex = new Map<string, number>();

  for (const [groupIndex, group] of augmented.entries()) {
    for (const nodeId of group.nodeIds) nodeGroupIndex.set(nodeId, groupIndex);
  }

  const unassigned = diagram.nodes.filter((node) => !assigned.has(node.id));
  for (const node of unassigned) {
    const targetIndex =
      groupIndexFromRelations(diagram, node.id, nodeGroupIndex) ??
      nearestGroupByOrder(node.id, augmented, nodeOrder) ??
      0;
    augmented[targetIndex]?.nodeIds.push(node.id);
    nodeGroupIndex.set(node.id, targetIndex);
    assigned.add(node.id);
  }

  return augmented.filter((group) => group.nodeIds.length > 0 && groupIndexById.has(group.id));
}

function groupIndexFromRelations(
  diagram: NormalizedDiagramSpec,
  nodeId: string,
  nodeGroupIndex: Map<string, number>
): number | undefined {
  const votes = new Map<number, number>();
  for (const edge of diagram.edges) {
    const relatedId = edge.from === nodeId ? edge.to : edge.to === nodeId ? edge.from : null;
    if (!relatedId) continue;
    const groupIndex = nodeGroupIndex.get(relatedId);
    if (groupIndex === undefined) continue;
    votes.set(groupIndex, (votes.get(groupIndex) ?? 0) + 2);
  }
  for (const constraint of diagram.layoutConstraints) {
    if (constraint.type !== "same_row" && constraint.type !== "same_column") continue;
    if (!constraint.nodes.includes(nodeId)) continue;
    for (const relatedId of constraint.nodes) {
      if (relatedId === nodeId) continue;
      const groupIndex = nodeGroupIndex.get(relatedId);
      if (groupIndex === undefined) continue;
      votes.set(groupIndex, (votes.get(groupIndex) ?? 0) + 1);
    }
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function nearestGroupByOrder(
  nodeId: string,
  groups: NormalizedDiagramSpec["groups"],
  nodeOrder: Map<string, number>
): number | undefined {
  const order = nodeOrder.get(nodeId);
  if (order === undefined) return undefined;
  let best: { index: number; distance: number } | undefined;
  groups.forEach((group, index) => {
    const distances = group.nodeIds
      .map((id) => nodeOrder.get(id))
      .filter((value): value is number => value !== undefined)
      .map((groupOrder) => Math.abs(groupOrder - order));
    const distance = Math.min(...distances);
    if (!Number.isFinite(distance)) return;
    if (!best || distance < best.distance) best = { index, distance };
  });
  return best?.index;
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

function overlapCount(left: string[], right: string[]): number {
  const rightIds = new Set(right);
  return left.filter((id) => rightIds.has(id)).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeSize(
  node: NormalizedDiagramSpec["nodes"][number],
  maxWidth: number,
  compact: boolean | "normal" | "compact" | "dense" = false
) {
  const shape = getShapeDefinition(node.shapeKey);
  const isOperator = shape.category === "operator";
  const compactLevel =
    compact === "dense" || compact === "compact" || compact === "normal"
      ? compact
      : compact
        ? "compact"
        : "normal";
  if (compactLevel !== "normal") {
    const maxHeight = compactLevel === "dense" ? 38 : 46;
    return {
      width: isOperator ? Math.min(shape.defaultSize.width, 54) : Math.min(shape.defaultSize.width, maxWidth),
      height: isOperator ? Math.min(shape.defaultSize.height, 36) : Math.min(shape.defaultSize.height, maxHeight)
    };
  }
  const width = isOperator ? shape.defaultSize.width : Math.min(shape.defaultSize.width, maxWidth);
  return {
    width,
    height: isOperator ? shape.defaultSize.height : Math.max(shape.defaultSize.height, textAwareHeight(node.label, width))
  };
}

function layeredNodeSize(
  node: NormalizedDiagramSpec["nodes"][number],
  maxWidth: number,
  density: "single" | "multi"
) {
  const shape = getShapeDefinition(node.shapeKey);
  const isOperator = shape.category === "operator";
  if (isOperator) return shape.defaultSize;

  const estimated = estimateTextWidth(node.label);
  const width =
    density === "single"
      ? clamp(estimated + 70, Math.min(360, maxWidth), maxWidth)
      : clamp(maxWidth, 210, Math.min(360, maxWidth));
  return {
    width,
    height: clamp(textAwareHeight(node.label, width) + (density === "single" ? 4 : 0), 48, 72)
  };
}

function textAwareHeight(label: string, width: number): number {
  const fontSize = label.length > 24 ? 13 : 15;
  const charsPerLine = Math.max(5, Math.floor((width - 28) / fontSize));
  const explicitLines = label.split(/\n/);
  const lineCount = explicitLines.reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)),
    0
  );
  return Math.min(84, Math.max(44, 24 + Math.min(lineCount, 3) * 18));
}

function estimateTextWidth(label: string): number {
  const longestLine = label.split(/\n/).reduce((max, line) => Math.max(max, line.length), 0);
  return longestLine * 15;
}
