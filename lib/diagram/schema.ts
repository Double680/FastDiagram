import { z } from "zod";

export const diagramTypeSchema = z.enum([
  "technical_route",
  "research_framework",
  "model_architecture",
  "general"
]);

export const planIntentTypeSchema = z.enum(["explicit", "conceptual", "mixed"]);
export const planSourceSchema = z.enum(["user_explicit", "model_inferred"]);

export const diagramPlanGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  role: z.string().optional()
});

export const diagramPlanModuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  groupId: z.string().optional(),
  role: z.string().optional(),
  shapeKey: z.string().optional(),
  source: planSourceSchema.optional()
});

export const diagramPlanConnectionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  meaning: z.string().optional(),
  style: z.enum(["solid", "dashed"]).optional(),
  source: planSourceSchema.optional()
});

export const diagramPlanSchema = z.object({
  subject: z.string().min(1),
  diagramType: diagramTypeSchema,
  intentType: planIntentTypeSchema.optional(),
  mainIdea: z.string().min(1),
  groups: z.array(diagramPlanGroupSchema).optional(),
  modules: z.array(diagramPlanModuleSchema).min(1),
  connections: z.array(diagramPlanConnectionSchema),
  layoutNotes: z.array(z.string()).optional(),
  simplificationNotes: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  unresolvedQuestions: z.array(z.string()).optional()
});

export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z
    .enum(["input", "process", "model", "operator", "output", "data", "result", "note"])
    .optional(),
  shapeKey: z.string().min(1).optional(),
  groupId: z.string().optional(),
  level: z.number().int().min(0).optional(),
  order: z.number().int().min(0).optional()
});

export const diagramEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  kind: z.enum(["main", "branch", "feedback", "auxiliary"]).optional(),
  style: z.enum(["solid", "dashed"]).optional()
});

export const diagramGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  nodeIds: z.array(z.string().min(1)),
  kind: z.enum(["layer", "stage", "container"]).optional()
});

export const layoutIntentSchema = z.object({
  direction: z.enum(["left_to_right", "top_to_bottom"]).optional(),
  pattern: z
    .enum(["flow", "layered", "three_column", "encoder_decoder", "stage"])
    .optional()
});

export const styleIntentSchema = z.object({
  preset: z.literal("academic_bw").optional()
});

export const diagramSpecSchema = z.object({
  title: z.string().optional(),
  type: diagramTypeSchema,
  nodes: z.array(diagramNodeSchema).min(1),
  edges: z.array(diagramEdgeSchema),
  groups: z.array(diagramGroupSchema).optional(),
  layout: layoutIntentSchema.optional(),
  style: styleIntentSchema.optional()
});

export const generateInputSchema = z.object({
  prompt: z.string().trim().min(1, "请输入绘图需求"),
  diagramType: diagramTypeSchema.optional()
});
