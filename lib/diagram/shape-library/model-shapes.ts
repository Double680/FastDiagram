import type { ShapeDefinition } from "./types.ts";

export const modelShapes: ShapeDefinition[] = [
  {
    key: "model.block",
    name: "Model Block",
    category: "model",
    defaultSize: { width: 190, height: 70 },
    connectionPolicy: {
      inputAnchors: ["left", "top"],
      outputAnchors: ["right", "bottom"],
      preferredFlow: "horizontal"
    },
    primitive: "round_rect",
    style: {
      fill: "F7F7F7",
      stroke: "5F5F5F",
      strokeWidth: 1.8,
      bold: true
    }
  },
  {
    key: "model.attention",
    name: "Attention Block",
    category: "model",
    defaultSize: { width: 190, height: 70 },
    connectionPolicy: {
      inputAnchors: ["left", "top"],
      outputAnchors: ["right", "bottom"],
      preferredFlow: "horizontal"
    },
    primitive: "round_rect",
    style: {
      fill: "F7F7F7",
      stroke: "5F5F5F",
      strokeWidth: 1.8,
      bold: true
    }
  }
];
