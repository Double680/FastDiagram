import pptxgen from "pptxgenjs";
import type { LayoutSpec, NormalizedDiagramSpec } from "./types.ts";
import { getShapeDefinition } from "./shape-library/registry.ts";
import type { ShapeDefinition, ShapePrimitive } from "./shape-library/types.ts";

const PX_PER_IN = 96;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

export async function renderPptx(
  diagram: NormalizedDiagramSpec,
  layout: LayoutSpec
): Promise<Buffer> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Academic Diagram Drawer";
  pptx.subject = diagram.title;
  pptx.title = diagram.title;
  pptx.company = "Academic Diagram Drawer";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei"
  };

  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };

  if (layout.title) {
    slide.addText(diagram.title, {
      ...box(layout.title, layout),
      fontFace: "Microsoft YaHei",
      fontSize: 22,
      bold: true,
      color: "202020",
      align: "center",
      valign: "middle",
      margin: 0
    });
  }

  const groupById = new Map(diagram.groups.map((group) => [group.id, group]));
  for (const groupLayout of layout.groups ?? []) {
    const group = groupById.get(groupLayout.id);
    slide.addShape(pptx.ShapeType.roundRect, {
      ...box(groupLayout, layout),
      rectRadius: 0.04,
      fill: { color: "F1F1F1", transparency: 8 },
      line: { color: "A8A8A8", width: 1 }
    });
    slide.addText(group?.title ?? "", {
      x: px(groupLayout.x + 14, layout.canvas.width, SLIDE_W),
      y: px(groupLayout.y + 7, layout.canvas.height, SLIDE_H),
      w: px(Math.max(groupLayout.width - 28, 20), layout.canvas.width, SLIDE_W),
      h: px(28, layout.canvas.height, SLIDE_H),
      fontFace: "Microsoft YaHei",
      fontSize: 12,
      bold: true,
      color: "202020",
      margin: 0
    });
  }

  const edgeById = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  for (const edgeLayout of layout.edges) {
    const edge = edgeById.get(edgeLayout.id);
    for (let i = 0; i < edgeLayout.points.length - 1; i += 1) {
      const from = edgeLayout.points[i];
      const to = edgeLayout.points[i + 1];
      const line = {
        color: "404040",
        width: 1.4,
        dash: edge?.style === "dashed" ? "dash" : "solid",
        beginArrowType: "none",
        endArrowType: i === edgeLayout.points.length - 2 ? "triangle" : "none"
      } as any;

      slide.addShape(pptx.ShapeType.line, {
        x: px(from.x, layout.canvas.width, SLIDE_W),
        y: px(from.y, layout.canvas.height, SLIDE_H),
        w: px(to.x - from.x, layout.canvas.width, SLIDE_W),
        h: px(to.y - from.y, layout.canvas.height, SLIDE_H),
        line
      });
    }

    if (edge?.label && edgeLayout.label) {
      slide.addText(edge.label, {
        ...box(edgeLayout.label, layout),
        fontFace: "Microsoft YaHei",
        fontSize: 8,
        color: "666666",
        align: "center",
        valign: "middle",
        margin: 0
      });
    }
  }

  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  for (const nodeLayout of layout.nodes) {
    const node = nodeById.get(nodeLayout.id);
    const shape = getShapeDefinition(node?.shapeKey);
    const shapeOptions = {
      ...box(nodeLayout, layout),
      fill: { color: shape.style?.fill ?? "F7F7F7" },
      line: {
        color: shape.style?.stroke ?? "6D6D6D",
        width: shape.style?.strokeWidth ?? 1.2
      }
    } as any;
    if (shape.primitive === "round_rect" || shape.primitive === "pill") {
      shapeOptions.rectRadius = shape.primitive === "pill" ? 0.5 : 0.04;
    }

    slide.addShape(toPptxShapeType(shape.primitive), shapeOptions);
    slide.addText(node?.label || shape.defaultLabel || "", {
      ...box(nodeLayout, layout),
      fontFace: "Microsoft YaHei",
      fontSize: pptFontSize(shape, node?.label ?? ""),
      color: shape.style?.textColor ?? "202020",
      bold: shape.style?.bold ?? node?.kind === "model",
      align: "center",
      valign: "middle",
      fit: "shrink",
      margin: 0.06,
      breakLine: false
    });
  }

  const data = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(data as ArrayBuffer);
}

function box(
  rect: { x: number; y: number; width: number; height: number },
  layout: LayoutSpec
) {
  return {
    x: px(rect.x, layout.canvas.width, SLIDE_W),
    y: px(rect.y, layout.canvas.height, SLIDE_H),
    w: px(rect.width, layout.canvas.width, SLIDE_W),
    h: px(rect.height, layout.canvas.height, SLIDE_H)
  };
}

function px(value: number, canvasSize: number, slideSize: number): number {
  return (value / canvasSize) * slideSize;
}

export function canvasPxToIn(value: number): number {
  return value / PX_PER_IN;
}

function toPptxShapeType(primitive: ShapePrimitive) {
  switch (primitive) {
    case "circle":
      return "ellipse";
    case "diamond":
      return "diamond";
    case "rect":
      return "rect";
    case "pill":
    case "round_rect":
    default:
      return "roundRect";
  }
}

function pptFontSize(shape: ShapeDefinition, label: string): number {
  if (shape.style?.fontSize) return shape.style.fontSize;
  return label.length > 18 ? 9 : 11;
}
