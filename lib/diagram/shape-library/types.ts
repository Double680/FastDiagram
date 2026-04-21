import type { DiagramNode, LayoutNode, LayoutSpec } from "../types.ts";

export type AnchorName = "left" | "right" | "top" | "bottom" | "center";

export type ShapeCategory = "basic" | "operator" | "model" | "data" | "annotation";

export type ShapePrimitive = "round_rect" | "rect" | "circle" | "pill" | "diamond";

export type ShapeDefinition = {
  key: string;
  name: string;
  category: ShapeCategory;
  defaultLabel?: string;
  defaultSize: {
    width: number;
    height: number;
  };
  connectionPolicy: {
    inputAnchors: AnchorName[];
    outputAnchors: AnchorName[];
    preferredFlow?: "horizontal" | "vertical" | "merge" | "split";
  };
  primitive: ShapePrimitive;
  style?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    textColor?: string;
    fontSize?: number;
    bold?: boolean;
  };
};

export type ShapeRenderContext = {
  node: DiagramNode;
  layoutNode: LayoutNode;
  layout: LayoutSpec;
};
