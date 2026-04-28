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
export type ConstraintDirection =
  | "left_to_right"
  | "right_to_left"
  | "top_to_bottom"
  | "bottom_to_top";
export type RelativePlacement = "top" | "bottom" | "left" | "right";
export type ConnectionRole =
  | "main"
  | "auxiliary"
  | "branch"
  | "feedback"
  | "residual"
  | "merge"
  | "reference";

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
  layoutConstraints?: DiagramLayoutConstraint[];
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
  role?: ConnectionRole;
  source: PlanSource;
};

export type DiagramLayoutConstraint =
  | {
      type: "main_flow";
      nodes: string[];
      direction?: ConstraintDirection;
      source: PlanSource;
    }
  | {
      type: "left_of" | "right_of" | "above" | "below";
      subject: string;
      object: string;
      source: PlanSource;
    }
  | {
      type: "same_row" | "same_column";
      nodes: string[];
      source: PlanSource;
    }
  | {
      type: "inside";
      subject: string;
      container: string;
      source: PlanSource;
    }
  | {
      type: "branch";
      from: string;
      through?: string[];
      to: string;
      placement?: RelativePlacement;
      source: PlanSource;
    };

export type DiagramLayoutConstraintDraft =
  | (Omit<Extract<DiagramLayoutConstraint, { type: "main_flow" }>, "source"> & {
      source?: PlanSource;
    })
  | (Omit<Extract<DiagramLayoutConstraint, { type: "left_of" | "right_of" | "above" | "below" }>, "source"> & {
      source?: PlanSource;
    })
  | (Omit<Extract<DiagramLayoutConstraint, { type: "same_row" | "same_column" }>, "source"> & {
      source?: PlanSource;
    })
  | (Omit<Extract<DiagramLayoutConstraint, { type: "inside" }>, "source"> & {
      source?: PlanSource;
    })
  | (Omit<Extract<DiagramLayoutConstraint, { type: "branch" }>, "source"> & {
      source?: PlanSource;
    });

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
  kind?: ConnectionRole;
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
  layoutConstraints?: DiagramLayoutConstraint[];
  layout?: LayoutIntent;
  style?: StyleIntent;
};

export type NormalizedDiagramSpec = Required<
  Pick<
    DiagramSpec,
    "type" | "nodes" | "edges" | "groups" | "layoutConstraints" | "layout" | "style"
  >
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
  planner: {
    source: "llm" | "rule_based";
    model?: string;
    fallbackReason?: string;
  };
  plan: DiagramPlan;
  diagram: NormalizedDiagramSpec;
  layout: LayoutSpec;
  svg: string;
};
