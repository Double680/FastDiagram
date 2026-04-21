import { NextResponse } from "next/server";
import { renderPptx } from "@/lib/diagram/render-pptx.ts";
import type { LayoutSpec, NormalizedDiagramSpec } from "@/lib/diagram/types.ts";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.diagram || !body?.layout) {
    return NextResponse.json({ error: "缺少 diagram 或 layout" }, { status: 400 });
  }

  const diagram = body.diagram as NormalizedDiagramSpec;
  const layout = body.layout as LayoutSpec;
  const buffer = await renderPptx(diagram, layout);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const filename = encodeURIComponent(`${diagram.title || "diagram"}.pptx`);

  return new Response(arrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store"
    }
  });
}
