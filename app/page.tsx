"use client";

import { useMemo, useState } from "react";
import type {
  DiagramPlan,
  DiagramType,
  GenerationContext,
  LayoutSpec,
  NormalizedDiagramSpec
} from "@/lib/diagram/types.ts";

const DEFAULT_PROMPT =
  "绘制一个 Transformer Encoder-Decoder 架构图，包含输入嵌入、位置编码、编码器堆叠、解码器堆叠、Linear、Softmax 和输出概率，编码器输出用虚线连接到解码器。";

type GenerateResponse = {
  context: GenerationContext;
  plan: DiagramPlan;
  diagram: NormalizedDiagramSpec;
  layout: LayoutSpec;
  svg: string;
};

export default function Page() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [diagramType, setDiagramType] = useState<DiagramType | "auto">("auto");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setLoading(true);
    setError("");
    setExporting(false);
    setResult(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt,
          diagramType: diagramType === "auto" ? undefined : diagramType
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "生成失败");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!result) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          diagram: result.diagram,
          layout: result.layout
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "导出失败");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${result.diagram.title || "diagram"}.pptx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  const jsonPreview = useMemo(() => {
    if (!result) return "";
    return JSON.stringify(
      {
        plan: result.plan,
        diagram: result.diagram
      },
      null,
      2
    );
  }, [result]);

  return (
    <main className="page">
      <section className="sidebar">
        <h1 className="title">自动化科学 Diagram 绘图</h1>
        <p className="hint">
          输入中文绘图需求，生成黑白灰学术风 Diagram 初稿，并导出为 PowerPoint
          可编辑对象。
        </p>

        <div className="field">
          <label htmlFor="prompt">绘图需求</label>
          <textarea
            id="prompt"
            className="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="diagramType">图类型</label>
          <select
            id="diagramType"
            className="select"
            value={diagramType}
            onChange={(event) => setDiagramType(event.target.value as DiagramType | "auto")}
          >
            <option value="auto">自动判断</option>
            <option value="technical_route">技术路线图</option>
            <option value="research_framework">研究框架图</option>
            <option value="model_architecture">方法/模型结构图</option>
            <option value="general">通用 Diagram</option>
          </select>
        </div>

        <div className="actions">
          <button onClick={handleGenerate} disabled={loading || !prompt.trim()}>
            {loading ? "生成中" : "生成 Diagram"}
          </button>
          <button
            className="secondary"
            onClick={handleExport}
            disabled={!result || exporting}
          >
            {exporting ? "导出中" : "导出 PPTX"}
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="main">
        <div className="preview-bar">
          <h2 className="preview-title">{result?.diagram.title ?? "预览"}</h2>
          <span className="hint">
            {result
              ? `${result.plan.intentType}，${result.diagram.nodes.length} 个模块，${result.diagram.edges.length} 条连接`
              : loading
                ? "正在生成新的 Diagram"
                : "生成后显示 SVG 预览"}
          </span>
        </div>

        <div
          className="preview"
          dangerouslySetInnerHTML={{
            __html:
              result?.svg ??
              `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'><rect width='1280' height='720' fill='#ffffff'/><text x='640' y='360' text-anchor='middle' font-size='24' fill='#666666'>${loading ? "正在生成" : "等待生成"}</text></svg>`
          }}
        />

        {result ? (
          <div className="plan-summary">
            <strong>DiagramPlan</strong>
            <span>用户显式模块：{result.plan.modules.filter((item) => item.source === "user_explicit").length}</span>
            <span>模型推断模块：{result.plan.modules.filter((item) => item.source === "model_inferred").length}</span>
            {result.plan.unresolvedQuestions?.length ? (
              <span>待确认：{result.plan.unresolvedQuestions.join("；")}</span>
            ) : null}
          </div>
        ) : null}

        {jsonPreview ? <pre className="json">{jsonPreview}</pre> : null}
      </section>
    </main>
  );
}
