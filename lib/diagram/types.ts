export type DiagramType =
  | "technical_route"
  | "research_framework"
  | "model_architecture"
  | "general";

export type LayoutDirection = "left_to_right" | "top_to_bottom";
export type LayoutPattern =
  | "flow"
  | "layered"
  | "three_column"
  | "encoder_decoder"
  | "stage";
export type PlanIntentType = "explicit" | "conceptual" | "mixed";
export type PlanSource = "user_explicit" | "model_inferred";

export type GenerationContext = {
  rawPrompt: string;
  diagramType: DiagramType;
  language: "zh";
  nodeLimit: number;
  stylePreset: "academic_bw";
  canvas: {
    aspectRatio: "16:9";
  };
  layoutPreference?: {
    direction?: LayoutDirection;
    pattern?: LayoutPattern;
  };
  explicitConstraints?: string[];
};

export type DiagramPlan = {
  subject: string;
  diagramType: DiagramType;
  intentType: PlanIntentType;
  mainIdea: string;
  groups?: DiagramPlanGroup[];
  modules: DiagramPlanModule[];
  connections: DiagramPlanConnection[];
  layoutNotes?: string[];
  simplificationNotes?: string[];
  assumptions?: string[];
  unresolvedQuestions?: string[];
};

export type DiagramPlanGroup = {
  id: string;
  title: string;
  role?: string;
};

export type DiagramPlanModule = {
  id: string;
  label: string;
  groupId?: string;
  role?: string;
  shapeKey?: string;
  source: PlanSource;
};

export type DiagramPlanConnection = {
  from: string;
  to: string;
  meaning?: string;
  style?: "solid" | "dashed";
  source: PlanSource;
};

export type DiagramNode = {
  id: string;
  label: string;
  kind?:
    | "input"
    | "process"
    | "model"
    | "operator"
    | "output"
    | "data"
    | "result"
    | "note";
  shapeKey?: string;
  groupId?: string;
  level?: number;
  order?: number;
};

export type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: "main" | "branch" | "feedback" | "auxiliary";
  style?: "solid" | "dashed";
};

export type DiagramGroup = {
  id: string;
  title: string;
  nodeIds: string[];
  kind?: "layer" | "stage" | "container";
};

export type LayoutIntent = {
  direction?: LayoutDirection;
  pattern?: LayoutPattern;
};

export type StyleIntent = {
  preset?: "academic_bw";
};

export type DiagramSpec = {
  title?: string;
  type: DiagramType;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
  layout?: LayoutIntent;
  style?: StyleIntent;
};

export type NormalizedDiagramSpec = Required<
  Pick<DiagramSpec, "type" | "nodes" | "edges" | "groups" | "layout" | "style">
> & {
  title: string;
};

export type LayoutSpec = {
  canvas: {
    width: number;
    height: number;
    unit: "px";
  };
  title?: LayoutText;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  groups?: LayoutGroup[];
};

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutEdge = {
  id: string;
  from: string;
  to: string;
  points: LayoutPoint[];
  label?: LayoutText;
};

export type LayoutGroup = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutText = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutPoint = {
  x: number;
  y: number;
};

export type GenerateInput = {
  prompt: string;
  diagramType?: DiagramType;
};

export type GenerateOutput = {
  context: GenerationContext;
  plan: DiagramPlan;
  diagram: NormalizedDiagramSpec;
  layout: LayoutSpec;
  svg: string;
};
