import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
} from "lucide-react";
import { loadPdfDocument, type PdfDocumentHandle } from "@/lib/pdfToImage";

interface PlanViewerProps {
  documentUrl: string;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onTotalPagesChange?: (total: number) => void;
  className?: string;
  overlayContent?: (dims: { width: number; height: number }) => React.ReactNode;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM_INDEX = 3;

export function PlanViewer({
  documentUrl,
  currentPage: controlledPage,
  onPageChange,
  onTotalPagesChange,
  className,
  overlayContent,
}: PlanViewerProps) {
  const [pdfHandle, setPdfHandle] = useState<PdfDocumentHandle | null>(null);
  const [internalPage, setInternalPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [rendering, setRendering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 });
  const [jumpInput, setJumpInput] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);

  const page = controlledPage ?? internalPage;
  const zoom = ZOOM_STEPS[zoomIndex];

  const setPage = useCallback(
    (p: number) => {
      if (onPageChange) {
        onPageChange(p);
      } else {
        setInternalPage(p);
      }
    },
    [onPageChange]
  );

  useEffect(() => {
    if (!documentUrl) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadPdfDocument(documentUrl)
      .then((handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        setPdfHandle((prev) => {
          if (prev) prev.destroy();
          return handle;
        });
        setTotalPages(handle.numPages);
        onTotalPagesChange?.(handle.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load PDF");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentUrl]);

  useEffect(() => {
    return () => {
      pdfHandle?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!pdfHandle || !canvasRef.current || page < 1 || page > totalPages)
      return;

    const id = ++renderIdRef.current;
    setRendering(true);

    pdfHandle
      .renderPage(page, canvasRef.current, zoom)
      .then((dims) => {
        if (id === renderIdRef.current) {
          setCanvasDims(dims);
          setRendering(false);
        }
      })
      .catch(() => {
        if (id === renderIdRef.current) setRendering(false);
      });
  }, [pdfHandle, page, zoom, totalPages]);

  const goToPrev = () => {
    if (page > 1) setPage(page - 1);
  };

  const goToNext = () => {
    if (page < totalPages) setPage(page + 1);
  };

  const handleJump = () => {
    const num = parseInt(jumpInput, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      setPage(num);
      setJumpInput("");
    }
  };

  const handleJumpKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleJump();
  };

  const zoomIn = () => {
    setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1));
  };

  const zoomOut = () => {
    setZoomIndex((i) => Math.max(i - 1, 0));
  };

  const resetZoom = () => {
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  };

  const fitToWidth = () => {
    if (!containerRef.current || canvasDims.width === 0) return;
    const containerWidth = containerRef.current.clientWidth - 32;
    const baseWidth = canvasDims.width / zoom;
    const targetZoom = containerWidth / baseWidth;
    const closest = ZOOM_STEPS.reduce((prev, curr, idx) =>
      Math.abs(curr - targetZoom) < Math.abs(ZOOM_STEPS[typeof prev === "number" ? prev : 0] - targetZoom)
        ? idx
        : prev as number,
      0 as number
    );
    setZoomIndex(typeof closest === "number" ? closest : DEFAULT_ZOOM_INDEX);
  };

  if (error) {
    return (
      <div
        className={`flex items-center justify-center p-8 text-destructive ${className ?? ""}`}
        data-testid="plan-viewer-error"
      >
        <p>Failed to load PDF: {error}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className ?? ""}`} data-testid="plan-viewer">
      <div className="flex items-center justify-between gap-2 p-2 border-b bg-secondary/30 flex-wrap">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPrev}
            disabled={page <= 1 || loading}
            data-testid="button-prev-page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span
            className="text-sm text-muted-foreground px-2 whitespace-nowrap"
            data-testid="text-page-indicator"
          >
            {loading ? "..." : `${page} / ${totalPages}`}
          </span>

          <Button
            variant="outline"
            size="icon"
            onClick={goToNext}
            disabled={page >= totalPages || loading}
            data-testid="button-next-page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 ml-2">
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              onKeyDown={handleJumpKeyDown}
              placeholder="Go to"
              className="w-16 text-sm"
              disabled={loading}
              data-testid="input-page-jump"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleJump}
              disabled={loading}
              data-testid="button-page-jump"
            >
              Go
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={zoomOut}
            disabled={zoomIndex <= 0 || loading}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>

          <span
            className="text-sm text-muted-foreground px-2 min-w-[3.5rem] text-center"
            data-testid="text-zoom-level"
          >
            {Math.round(zoom * 100)}%
          </span>

          <Button
            variant="outline"
            size="icon"
            onClick={zoomIn}
            disabled={zoomIndex >= ZOOM_STEPS.length - 1 || loading}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={resetZoom}
            disabled={loading}
            data-testid="button-zoom-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={fitToWidth}
            disabled={loading || canvasDims.width === 0}
            data-testid="button-fit-width"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/50 flex items-start justify-center p-4"
        data-testid="plan-viewer-canvas-container"
      >
        {loading ? (
          <Skeleton className="w-full max-w-2xl h-96" data-testid="plan-viewer-skeleton" />
        ) : (
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              className={`shadow-md transition-opacity duration-150 ${rendering ? "opacity-60" : "opacity-100"}`}
              data-testid="plan-viewer-canvas"
            />
            {overlayContent && canvasDims.width > 0 && (
              <div
                className="absolute top-0 left-0"
                style={{
                  width: canvasDims.width,
                  height: canvasDims.height,
                  pointerEvents: "none",
                }}
                data-testid="plan-viewer-overlay"
              >
                {overlayContent(canvasDims)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
