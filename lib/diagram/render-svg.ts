import type { LayoutPoint, LayoutSpec, NormalizedDiagramSpec } from "./types.ts";
import { getShapeDefinition } from "./shape-library/registry.ts";
import type { ShapeDefinition } from "./shape-library/types.ts";

const COLORS = {
  background: "#ffffff",
  text: "#202020",
  muted: "#666666",
  nodeFill: "#f7f7f7",
  nodeStroke: "#6d6d6d",
  groupFill: "#f1f1f1",
  groupStroke: "#a8a8a8",
  edge: "#404040"
};

export function renderSvg(diagram: NormalizedDiagramSpec, layout: LayoutSpec): string {
  const groupById = new Map(diagram.groups.map((group) => [group.id, group]));
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(diagram.edges.map((edge) => [edge.id, edge]));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.canvas.width} ${layout.canvas.height}" role="img" aria-label="${escapeXml(diagram.title)}">`,
    "<defs>",
    `<marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${COLORS.edge}"/></marker>`,
    "</defs>",
    `<rect x="0" y="0" width="${layout.canvas.width}" height="${layout.canvas.height}" fill="${COLORS.background}"/>`,
    layout.title
      ? `<text x="${layout.title.x + layout.title.width / 2}" y="${layout.title.y + 34}" text-anchor="middle" font-size="28" font-weight="700" fill="${COLORS.text}">${escapeXml(diagram.title)}</text>`
      : "",
    ...(layout.groups ?? []).map((groupLayout) => {
      const group = groupById.get(groupLayout.id);
      return [
        `<rect x="${groupLayout.x}" y="${groupLayout.y}" width="${groupLayout.width}" height="${groupLayout.height}" rx="8" fill="${COLORS.groupFill}" stroke="${COLORS.groupStroke}" stroke-width="1.4"/>`,
        `<text x="${groupLayout.x + 14}" y="${groupLayout.y + 24}" font-size="17" font-weight="700" fill="${COLORS.text}">${escapeXml(group?.title ?? "")}</text>`
      ].join("");
    }),
    ...layout.edges.map((edgeLayout) => {
      const edge = edgeById.get(edgeLayout.id);
      const dashed = edge?.style === "dashed" ? ` stroke-dasharray="7 6"` : "";
      const label = edge?.label
        ? `<text x="${edgeLayout.label?.x ?? 0}" y="${(edgeLayout.label?.y ?? 0) + 16}" font-size="13" fill="${COLORS.muted}">${escapeXml(edge.label)}</text>`
        : "";
      return `<polyline points="${pointsAttr(edgeLayout.points)}" fill="none" stroke="${COLORS.edge}" stroke-width="2"${dashed} marker-end="url(#arrow)"/>${label}`;
    }),
    ...layout.nodes.map((nodeLayout) => {
      const node = nodeById.get(nodeLayout.id);
      const shape = getShapeDefinition(node?.shapeKey);
      return [
        renderShape(shape, nodeLayout),
        renderMultilineText(
          node?.label || shape.defaultLabel || "",
          nodeLayout.x + nodeLayout.width / 2,
          nodeLayout.y + nodeLayout.height / 2,
          shape
        )
      ].join("");
    }),
    "</svg>"
  ].join("");
}

function renderShape(
  shape: ShapeDefinition,
  nodeLayout: { x: number; y: number; width: number; height: number }
): string {
  const fill = svgColor(shape.style?.fill ?? COLORS.nodeFill);
  const stroke = svgColor(shape.style?.stroke ?? COLORS.nodeStroke);
  const strokeWidth = shape.style?.strokeWidth ?? 1.8;

  switch (shape.primitive) {
    case "circle":
      return `<ellipse cx="${nodeLayout.x + nodeLayout.width / 2}" cy="${nodeLayout.y + nodeLayout.height / 2}" rx="${nodeLayout.width / 2}" ry="${nodeLayout.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    case "pill":
      return `<rect x="${nodeLayout.x}" y="${nodeLayout.y}" width="${nodeLayout.width}" height="${nodeLayout.height}" rx="${nodeLayout.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    case "diamond":
      return `<polygon points="${diamondPoints(nodeLayout)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    case "rect":
      return `<rect x="${nodeLayout.x}" y="${nodeLayout.y}" width="${nodeLayout.width}" height="${nodeLayout.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    case "round_rect":
    default:
      return `<rect x="${nodeLayout.x}" y="${nodeLayout.y}" width="${nodeLayout.width}" height="${nodeLayout.height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
}

function renderMultilineText(
  label: string,
  centerX: number,
  centerY: number,
  shape: ShapeDefinition
): string {
  const lines = label.split(/\n/).slice(0, 3);
  const lineHeight = 17;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2 + 5;
  const fontSize = shape.style?.fontSize ?? (lines.some((line) => line.length > 18) ? 13 : 15);
  const fontWeight = shape.style?.bold ? ` font-weight="700"` : "";
  const color = svgColor(shape.style?.textColor ?? COLORS.text);

  return lines
    .map(
      (line, index) =>
        `<text x="${centerX}" y="${startY + index * lineHeight}" text-anchor="middle" font-size="${fontSize}"${fontWeight} fill="${color}">${escapeXml(line)}</text>`
    )
    .join("");
}

function diamondPoints(rect: { x: number; y: number; width: number; height: number }): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return [
    `${cx},${rect.y}`,
    `${rect.x + rect.width},${cy}`,
    `${cx},${rect.y + rect.height}`,
    `${rect.x},${cy}`
  ].join(" ");
}

function svgColor(value: string): string {
  return value.startsWith("#") ? value : `#${value}`;
}

function pointsAttr(points: LayoutPoint[]): string {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
