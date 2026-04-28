import { NextResponse } from "next/server";
import { generateDiagram } from "@/lib/diagram/generate.ts";
import { generateInputSchema } from "@/lib/diagram/schema.ts";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = generateInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "请求参数无效"
      },
      { status: 400 }
    );
  }

  try {
    const output = await generateDiagram(parsed.data);
    return NextResponse.json({
      diagram: output.diagram,
      layout: output.layout,
      svg: output.svg,
      plan: output.plan,
      context: output.context,
      planner: output.planner
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "生成失败"
      },
      { status: 502 }
    );
  }
}
