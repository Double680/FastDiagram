import type { ShapeDefinition } from "./types.ts";

export const basicShapes: ShapeDefinition[] = [
  {
    key: "basic.round_rect",
    name: "Round Rectangle",
    category: "basic",
    defaultSize: { width: 170, height: 62 },
    connectionPolicy: {
      inputAnchors: ["left", "top"],
      outputAnchors: ["right", "bottom"],
      preferredFlow: "horizontal"
    },
    primitive: "round_rect"
  },
  {
    key: "basic.rect",
    name: "Rectangle",
    category: "basic",
    defaultSize: { width: 170, height: 62 },
    connectionPolicy: {
      inputAnchors: ["left", "top"],
      outputAnchors: ["right", "bottom"],
      preferredFlow: "horizontal"
    },
    primitive: "rect"
  },
  {
    key: "basic.circle",
    name: "Circle",
    category: "basic",
    defaultSize: { width: 58, height: 58 },
    connectionPolicy: {
      inputAnchors: ["left", "top", "bottom"],
      outputAnchors: ["right"],
      preferredFlow: "horizontal"
    },
    primitive: "circle"
  }
];
