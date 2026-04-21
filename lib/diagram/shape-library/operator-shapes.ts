import type { ShapeDefinition } from "./types.ts";

export const operatorShapes: ShapeDefinition[] = [
  {
    key: "operator.add",
    name: "Add",
    category: "operator",
    defaultLabel: "+",
    defaultSize: { width: 44, height: 44 },
    connectionPolicy: {
      inputAnchors: ["left", "top", "bottom"],
      outputAnchors: ["right"],
      preferredFlow: "merge"
    },
    primitive: "circle",
    style: {
      fill: "FFFFFF",
      stroke: "505050",
      strokeWidth: 1.8,
      fontSize: 22,
      bold: true
    }
  },
  {
    key: "operator.concat",
    name: "Concatenate",
    category: "operator",
    defaultLabel: "Concat",
    defaultSize: { width: 64, height: 44 },
    connectionPolicy: {
      inputAnchors: ["left", "top", "bottom"],
      outputAnchors: ["right"],
      preferredFlow: "merge"
    },
    primitive: "pill",
    style: {
      fill: "FFFFFF",
      stroke: "505050",
      strokeWidth: 1.8,
      fontSize: 10,
      bold: true
    }
  },
  {
    key: "operator.multiply",
    name: "Multiply",
    category: "operator",
    defaultLabel: "x",
    defaultSize: { width: 44, height: 44 },
    connectionPolicy: {
      inputAnchors: ["left", "top", "bottom"],
      outputAnchors: ["right"],
      preferredFlow: "merge"
    },
    primitive: "circle",
    style: {
      fill: "FFFFFF",
      stroke: "505050",
      strokeWidth: 1.8,
      fontSize: 18,
      bold: true
    }
  }
];
