import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, MousePointer, Trash2, Link2, Save } from "lucide-react";
import { usePlanMarkups, type PlanMarkup, type MarkupData } from "@/hooks/usePlanMarkups";
import { toast } from "sonner";

interface ParsedComment {
  id: string;
  comment_number?: string;
  comment_text?: string;
  discipline?: string;
}

interface RevisionCloudOverlayProps {
  projectId: string;
  documentId?: string;
  pageNumber: number;
  width: number;
  height: number;
  comments?: ParsedComment[];
  onMarkupLinked?: (markupId: string, commentId: string) => void;
}

function generateCloudPath(x: number, y: number, w: number, h: number): string {
  const arcRadius = Math.min(12, Math.min(Math.abs(w), Math.abs(h)) / 4);
  const arcDiameter = arcRadius * 2;

  const left = Math.min(x, x + w);
  const top = Math.min(y, y + h);
  const right = Math.max(x, x + w);
  const bottom = Math.max(y, y + h);
  const absW = right - left;
  const absH = bottom - top;

  if (absW < 10 || absH < 10) return "";

  const segments: string[] = [];
  segments.push(`M ${left} ${top}`);

  const topCount = Math.max(1, Math.round(absW / arcDiameter));
  const stepX = absW / topCount;
  for (let i = 0; i < topCount; i++) {
    const cx = left + stepX * i + stepX / 2;
    const ex = left + stepX * (i + 1);
    segments.push(
      `A ${stepX / 2} ${arcRadius} 0 0 1 ${ex} ${top}`
    );
  }

  const rightCount = Math.max(1, Math.round(absH / arcDiameter));
  const stepYR = absH / rightCount;
  for (let i = 0; i < rightCount; i++) {
    const ey = top + stepYR * (i + 1);
    segments.push(
      `A ${arcRadius} ${stepYR / 2} 0 0 1 ${right} ${ey}`
    );
  }

  const bottomCount = Math.max(1, Math.round(absW / arcDiameter));
  const stepXB = absW / bottomCount;
  for (let i = 0; i < bottomCount; i++) {
    const ex = right - stepXB * (i + 1);
    segments.push(
      `A ${stepXB / 2} ${arcRadius} 0 0 1 ${ex} ${bottom}`
    );
  }

  const leftCount = Math.max(1, Math.round(absH / arcDiameter));
  const stepYL = absH / leftCount;
  for (let i = 0; i < leftCount; i++) {
    const ey = bottom - stepYL * (i + 1);
    segments.push(
      `A ${arcRadius} ${stepYL / 2} 0 0 1 ${left} ${ey}`
    );
  }

  segments.push("Z");
  return segments.join(" ");
}

export function RevisionCloudOverlay({
  projectId,
  documentId,
  pageNumber,
  width,
  height,
  comments = [],
  onMarkupLinked,
}: RevisionCloudOverlayProps) {
  const { markups, addMarkup, deleteMarkup, linkComment, loading } =
    usePlanMarkups(projectId, pageNumber, documentId);

  const [mode, setMode] = useState<"select" | "draw">("select");
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedMarkup, setSelectedMarkup] = useState<string | null>(null);
  const [linkingMarkup, setLinkingMarkup] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPoint = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== "draw") return;
      const pt = getSvgPoint(e);
      setDrawing(true);
      setDrawStart(pt);
      setDrawEnd(pt);
    },
    [mode, getSvgPoint]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawing) return;
      setDrawEnd(getSvgPoint(e));
    },
    [drawing, getSvgPoint]
  );

  const handleMouseUp = useCallback(async () => {
    if (!drawing || !drawStart || !drawEnd) return;
    setDrawing(false);

    const w = drawEnd.x - drawStart.x;
    const h = drawEnd.y - drawStart.y;
    if (Math.abs(w) < 10 || Math.abs(h) < 10) {
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }

    const nextDelta = markups.length + 1;
    const markupData: MarkupData = {
      x: Math.min(drawStart.x, drawEnd.x) / width,
      y: Math.min(drawStart.y, drawEnd.y) / height,
      width: Math.abs(w) / width,
      height: Math.abs(h) / height,
      deltaNumber: nextDelta,
    };

    try {
      await addMarkup({
        documentId,
        pageNumber,
        markupData,
      });
      toast.success(`Revision cloud #${nextDelta} added`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save markup");
    }

    setDrawStart(null);
    setDrawEnd(null);
  }, [drawing, drawStart, drawEnd, markups.length, addMarkup, documentId, pageNumber]);

  const handleCloudClick = useCallback(
    (e: React.MouseEvent, markup: PlanMarkup) => {
      e.stopPropagation();
      if (mode === "select") {
        setSelectedMarkup(markup.id === selectedMarkup ? null : markup.id);
      }
    },
    [mode, selectedMarkup]
  );

  const handleDelete = useCallback(async () => {
    if (!selectedMarkup) return;
    try {
      await deleteMarkup(selectedMarkup);
      setSelectedMarkup(null);
      toast.success("Markup deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete markup");
    }
  }, [selectedMarkup, deleteMarkup]);

  const handleLinkComment = useCallback(
    async (commentId: string) => {
      if (!linkingMarkup) return;
      try {
        await linkComment(linkingMarkup, commentId);
        onMarkupLinked?.(linkingMarkup, commentId);
        setLinkingMarkup(null);
        toast.success("Comment linked to markup");
      } catch (err: any) {
        toast.error(err.message || "Failed to link comment");
      }
    },
    [linkingMarkup, linkComment, onMarkupLinked]
  );

  const statusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "#22c55e";
      case "rejected":
        return "#ef4444";
      default:
        return "#f59e0b";
    }
  };

  const previewPath =
    drawing && drawStart && drawEnd
      ? generateCloudPath(drawStart.x, drawStart.y, drawEnd.x - drawStart.x, drawEnd.y - drawStart.y)
      : "";

  return (
    <div
      style={{ width, height, position: "absolute", top: 0, left: 0 }}
      data-testid="revision-cloud-overlay"
    >
      <div
        className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 border"
        data-testid="markup-toolbar"
      >
        <Button
          variant={mode === "select" ? "default" : "ghost"}
          size="icon"
          onClick={() => setMode("select")}
          data-testid="button-markup-select"
        >
          <MousePointer className="h-4 w-4" />
        </Button>
        <Button
          variant={mode === "draw" ? "default" : "ghost"}
          size="icon"
          onClick={() => setMode("draw")}
          data-testid="button-markup-draw"
        >
          <Pencil className="h-4 w-4" />
        </Button>

        {selectedMarkup && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLinkingMarkup(selectedMarkup)}
              data-testid="button-markup-link"
            >
              <Link2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              data-testid="button-markup-delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}

        {loading && (
          <span className="text-xs text-muted-foreground px-2" data-testid="text-markup-loading">
            Saving...
          </span>
        )}
      </div>

      {linkingMarkup && comments.length > 0 && (
        <div
          className="absolute top-12 left-2 z-10 bg-background border rounded-md p-2 shadow-lg max-h-48 overflow-y-auto w-64"
          data-testid="markup-link-panel"
        >
          <p className="text-xs font-medium mb-1">Link to comment:</p>
          {comments.map((c) => (
            <button
              key={c.id}
              className="w-full text-left text-xs p-1.5 rounded hover-elevate truncate"
              onClick={() => handleLinkComment(c.id)}
              data-testid={`button-link-comment-${c.id}`}
            >
              #{c.comment_number || "?"} - {c.comment_text?.slice(0, 60) || "No text"}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => setLinkingMarkup(null)}
            data-testid="button-cancel-link"
          >
            Cancel
          </Button>
        </div>
      )}

      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={mode === "draw" ? "cursor-crosshair" : "cursor-default"}
        style={{ pointerEvents: mode === "draw" || mode === "select" ? "auto" : "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          if (drawing) {
            setDrawing(false);
            setDrawStart(null);
            setDrawEnd(null);
          }
        }}
        data-testid="revision-cloud-svg"
      >
        {markups.map((markup) => {
          const md = markup.markup_data;
          const px = md.x * width;
          const py = md.y * height;
          const pw = md.width * width;
          const ph = md.height * height;
          const path = generateCloudPath(px, py, pw, ph);
          if (!path) return null;

          const isSelected = selectedMarkup === markup.id;
          const color = statusColor(markup.status);

          return (
            <g
              key={markup.id}
              onClick={(e) => handleCloudClick(e, markup)}
              style={{ cursor: mode === "select" ? "pointer" : undefined }}
              data-testid={`revision-cloud-${markup.id}`}
            >
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray={markup.status === "pending" ? "6 3" : undefined}
                opacity={0.85}
              />
              {isSelected && (
                <path
                  d={path}
                  fill={color}
                  opacity={0.08}
                  stroke="none"
                />
              )}

              {md.deltaNumber && (
                <>
                  <circle
                    cx={px + pw - 8}
                    cy={py - 8}
                    r={10}
                    fill={color}
                    opacity={0.9}
                  />
                  <text
                    x={px + pw - 8}
                    y={py - 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="bold"
                    fill="white"
                    data-testid={`text-delta-${markup.id}`}
                  >
                    {md.deltaNumber}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {previewPath && (
          <path
            d={previewPath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={0.7}
            data-testid="revision-cloud-preview"
          />
        )}
      </svg>
    </div>
  );
}
