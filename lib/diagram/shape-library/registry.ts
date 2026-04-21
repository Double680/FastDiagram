import { basicShapes } from "./basic-shapes.ts";
import { modelShapes } from "./model-shapes.ts";
import { operatorShapes } from "./operator-shapes.ts";
import type { ShapeDefinition } from "./types.ts";

export const DEFAULT_SHAPE_KEY = "basic.round_rect";

const definitions = [...basicShapes, ...operatorShapes, ...modelShapes];
const registry = new Map(definitions.map((shape) => [shape.key, shape]));

export function getShapeDefinition(shapeKey?: string): ShapeDefinition {
  return registry.get(shapeKey ?? DEFAULT_SHAPE_KEY) ?? registry.get(DEFAULT_SHAPE_KEY)!;
}

export function hasShapeDefinition(shapeKey?: string): boolean {
  return Boolean(shapeKey && registry.has(shapeKey));
}

export function normalizeShapeKey(shapeKey?: string): string {
  return getShapeDefinition(shapeKey).key;
}

export function listShapeDefinitions(): ShapeDefinition[] {
  return [...definitions];
}
