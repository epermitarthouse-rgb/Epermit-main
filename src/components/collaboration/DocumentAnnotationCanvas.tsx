import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { 
  Pencil, 
  Square, 
  Circle, 
  ArrowRight, 
  Type, 
  Highlighter,
  CloudCog,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Eye,
  EyeOff,
  Palette,
  MousePointer,
  Save
} from 'lucide-react';
import { useDocumentAnnotations, AnnotationType, AnnotationData, DocumentAnnotation } from '@/hooks/useDocumentAnnotations';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Point {
  x: number;
  y: number;
}

interface DocumentAnnotationCanvasProps {
  projectId: string;
  documentId?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
}

const COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#000000', // black
];

const TOOLS: { type: AnnotationType | 'select'; icon: any; label: string }[] = [
  { type: 'select', icon: MousePointer, label: 'Select' },
  { type: 'freehand', icon: Pencil, label: 'Redline' },
  { type: 'rectangle', icon: Square, label: 'Rectangle' },
  { type: 'circle', icon: Circle, label: 'Circle' },
  { type: 'arrow', icon: ArrowRight, label: 'Arrow' },
  { type: 'text', icon: Type, label: 'Text Callout' },
  { type: 'highlight', icon: Highlighter, label: 'Highlight' },
  { type: 'revision_cloud', icon: CloudCog, label: 'Revision Cloud' },
];

export function DocumentAnnotationCanvas({
  projectId,
  documentId,
  imageUrl,
  width = 800,
  height = 600,
}: DocumentAnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { annotations, addAnnotation, deleteAnnotation, clearAllAnnotations, loading } = 
    useDocumentAnnotations(projectId, documentId);

  const [activeTool, setActiveTool] = useState<AnnotationType | 'select'>('select');
  const [activeColor, setActiveColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<Point | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [history, setHistory] = useState<DocumentAnnotation[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Draw annotations on canvas
  const drawAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!showAnnotations) return;

    annotations.forEach(ann => {
      if (!ann.visible) return;

      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.stroke_width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const isSelected = selectedAnnotation === ann.id;
      if (isSelected) {
        ctx.shadowColor = ann.color;
        ctx.shadowBlur = 5;
      }

      switch (ann.annotation_type) {
        case 'freehand':
        case 'redline':
          if (ann.data.points && ann.data.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(ann.data.points[0].x, ann.data.points[0].y);
            ann.data.points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
          }
          break;

        case 'rectangle':
          if (ann.data.startX !== undefined && ann.data.width) {
            ctx.strokeRect(ann.data.startX, ann.data.startY!, ann.data.width, ann.data.height!);
          }
          break;

        case 'circle':
          if (ann.data.startX !== undefined && ann.data.width) {
            ctx.beginPath();
            const rx = ann.data.width / 2;
            const ry = ann.data.height! / 2;
            ctx.ellipse(
              ann.data.startX + rx,
              ann.data.startY! + ry,
              Math.abs(rx),
              Math.abs(ry),
              0, 0, Math.PI * 2
            );
            ctx.stroke();
          }
          break;

        case 'arrow':
          if (ann.data.startX !== undefined && ann.data.endX !== undefined) {
            const headLen = 15;
            const dx = ann.data.endX - ann.data.startX;
            const dy = ann.data.endY! - ann.data.startY!;
            const angle = Math.atan2(dy, dx);

            ctx.beginPath();
            ctx.moveTo(ann.data.startX, ann.data.startY!);
            ctx.lineTo(ann.data.endX, ann.data.endY!);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(ann.data.endX, ann.data.endY!);
            ctx.lineTo(
              ann.data.endX - headLen * Math.cos(angle - Math.PI / 6),
              ann.data.endY! - headLen * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(ann.data.endX, ann.data.endY!);
            ctx.lineTo(
              ann.data.endX - headLen * Math.cos(angle + Math.PI / 6),
              ann.data.endY! - headLen * Math.sin(angle + Math.PI / 6)
            );
            ctx.stroke();
          }
          break;

        case 'text':
        case 'callout':
          if (ann.data.startX !== undefined && ann.data.text) {
            ctx.font = `${ann.data.fontSize || 14}px sans-serif`;
            ctx.fillText(ann.data.text, ann.data.startX, ann.data.startY!);
          }
          break;

        case 'highlight':
          if (ann.data.startX !== undefined && ann.data.width) {
            ctx.globalAlpha = 0.3;
            ctx.fillRect(ann.data.startX, ann.data.startY!, ann.data.width, ann.data.height!);
            ctx.globalAlpha = 1;
          }
          break;

        case 'revision_cloud':
          if (ann.data.startX !== undefined && ann.data.width) {
            drawRevisionCloud(ctx, ann.data.startX, ann.data.startY!, ann.data.width, ann.data.height!);
          }
          break;
      }

      ctx.shadowBlur = 0;
    });
  }, [annotations, showAnnotations, selectedAnnotation]);

  const drawRevisionCloud = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const arcSize = 10;
    ctx.beginPath();
    
    // Top edge
    for (let i = x; i < x + w; i += arcSize * 2) {
      ctx.arc(i + arcSize, y, arcSize, Math.PI, 0, false);
    }
    // Right edge
    for (let i = y; i < y + h; i += arcSize * 2) {
      ctx.arc(x + w, i + arcSize, arcSize, -Math.PI / 2, Math.PI / 2, false);
    }
    // Bottom edge
    for (let i = x + w; i > x; i -= arcSize * 2) {
      ctx.arc(i - arcSize, y + h, arcSize, 0, Math.PI, false);
    }
    // Left edge
    for (let i = y + h; i > y; i -= arcSize * 2) {
      ctx.arc(x, i - arcSize, arcSize, Math.PI / 2, -Math.PI / 2, false);
    }
    
    ctx.stroke();
  };

  useEffect(() => {
    drawAnnotations();
  }, [drawAnnotations]);

  const getMousePos = (e: React.MouseEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'select') {
      // Check if clicking on an annotation
      const pos = getMousePos(e);
      const clicked = annotations.find(ann => {
        if (ann.data.startX !== undefined) {
          return pos.x >= ann.data.startX && 
                 pos.x <= ann.data.startX + (ann.data.width || 50) &&
                 pos.y >= ann.data.startY! && 
                 pos.y <= ann.data.startY! + (ann.data.height || 50);
        }
        return false;
      });
      setSelectedAnnotation(clicked?.id || null);
      return;
    }

    if (activeTool === 'text') {
      setTextPosition(getMousePos(e));
      return;
    }

    setIsDrawing(true);
    const pos = getMousePos(e);
    setStartPoint(pos);
    setCurrentPoints([pos]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || activeTool === 'select' || activeTool === 'text') return;

    const pos = getMousePos(e);
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = activeColor;
    ctx.fillStyle = activeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';

    if (activeTool === 'freehand') {
      setCurrentPoints(prev => [...prev, pos]);
      ctx.beginPath();
      ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
      currentPoints.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (startPoint) {
      const w = pos.x - startPoint.x;
      const h = pos.y - startPoint.y;

      switch (activeTool) {
        case 'rectangle':
          ctx.strokeRect(startPoint.x, startPoint.y, w, h);
          break;
        case 'circle':
          ctx.beginPath();
          ctx.ellipse(
            startPoint.x + w / 2,
            startPoint.y + h / 2,
            Math.abs(w / 2),
            Math.abs(h / 2),
            0, 0, Math.PI * 2
          );
          ctx.stroke();
          break;
        case 'arrow':
          const headLen = 15;
          const angle = Math.atan2(h, w);
          ctx.beginPath();
          ctx.moveTo(startPoint.x, startPoint.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(pos.x - headLen * Math.cos(angle - Math.PI / 6), pos.y - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(pos.x - headLen * Math.cos(angle + Math.PI / 6), pos.y - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
          break;
        case 'highlight':
          ctx.globalAlpha = 0.3;
          ctx.fillRect(startPoint.x, startPoint.y, w, h);
          ctx.globalAlpha = 1;
          break;
        case 'revision_cloud':
          drawRevisionCloud(ctx, startPoint.x, startPoint.y, w, h);
          break;
      }
    }
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!isDrawing && activeTool !== 'text') return;

    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, overlay!.width, overlay!.height);
    }

    const pos = getMousePos(e);
    let data: AnnotationData = {};

    if (activeTool === 'freehand' && currentPoints.length > 1) {
      data = { points: [...currentPoints, pos] };
    } else if (startPoint && activeTool !== 'freehand' && activeTool !== 'text') {
      data = {
        startX: startPoint.x,
        startY: startPoint.y,
        endX: pos.x,
        endY: pos.y,
        width: pos.x - startPoint.x,
        height: pos.y - startPoint.y
      };
    }

    if (Object.keys(data).length > 0 && activeTool !== 'select') {
      await addAnnotation(activeTool as AnnotationType, data, {
        documentId,
        color: activeColor,
        strokeWidth
      });
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoints([]);
  };

  const handleTextSubmit = async () => {
    if (!textPosition || !textInput.trim()) return;

    await addAnnotation('text', {
      startX: textPosition.x,
      startY: textPosition.y,
      text: textInput,
      fontSize: 14
    }, {
      documentId,
      color: activeColor
    });

    setTextInput('');
    setTextPosition(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedAnnotation) {
      await deleteAnnotation(selectedAnnotation);
      setSelectedAnnotation(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-muted rounded-lg">
        {/* Tools */}
        <div className="flex items-center gap-1">
          {TOOLS.map(tool => {
            const Icon = tool.icon;
            return (
              <Button
                key={tool.type}
                variant={activeTool === tool.type ? 'default' : 'ghost'}
                size="icon"
                className="h-9 w-9"
                onClick={() => setActiveTool(tool.type)}
                title={tool.label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            );
          })}
        </div>

        <Separator orientation="vertical" className="h-8" />

        {/* Color picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <div
                className="h-5 w-5 rounded-full border-2 border-background shadow"
                style={{ backgroundColor: activeColor }}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <div className="flex gap-1">
              {COLORS.map(color => (
                <button
                  key={color}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                    activeColor === color ? 'border-primary' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setActiveColor(color)}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Stroke width */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <div className="w-4 h-0.5 bg-foreground" style={{ height: strokeWidth }} />
              <span className="text-xs">{strokeWidth}px</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48">
            <Label className="text-xs">Stroke Width</Label>
            <Slider
              value={[strokeWidth]}
              onValueChange={([v]) => setStrokeWidth(v)}
              min={1}
              max={10}
              step={1}
              className="mt-2"
            />
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-8" />

        {/* Actions */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setShowAnnotations(!showAnnotations)}
          title={showAnnotations ? 'Hide annotations' : 'Show annotations'}
        >
          {showAnnotations ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleDeleteSelected}
          disabled={!selectedAnnotation}
          title="Delete selected"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-destructive"
          onClick={clearAllAnnotations}
          title="Clear all my annotations"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        className="relative border rounded-lg overflow-hidden bg-muted/30"
        style={{ width, height }}
      >
        {/* Background image */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Document"
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}

        {/* Annotations canvas */}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="absolute inset-0"
        />

        {/* Drawing overlay */}
        <canvas
          ref={overlayRef}
          width={width}
          height={height}
          className="absolute inset-0 cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setIsDrawing(false)}
        />

        {/* Text input popup */}
        {textPosition && (
          <div
            className="absolute bg-background border rounded-lg p-2 shadow-lg z-10"
            style={{ left: textPosition.x, top: textPosition.y }}
          >
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
              placeholder="Enter text..."
              autoFocus
              className="w-48"
            />
            <div className="flex gap-1 mt-2">
              <Button size="sm" onClick={handleTextSubmit}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => setTextPosition(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* No image placeholder */}
        {!imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <p>Upload a document to annotate</p>
          </div>
        )}
      </div>

      {/* Annotation count */}
      <div className="text-sm text-muted-foreground">
        {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} on this document
      </div>
    </div>
  );
}
