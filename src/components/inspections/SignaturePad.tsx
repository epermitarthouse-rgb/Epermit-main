import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Eraser, Check, PenTool } from 'lucide-react';

interface SignaturePadProps {
  label: string;
  onSignatureChange?: (signatureData: string | null) => void;
  initialSignature?: string | null;
  width?: number;
  height?: number;
  disabled?: boolean;
}

export function SignaturePad({
  label,
  onSignatureChange,
  initialSignature = null,
  width = 300,
  height = 100,
  disabled = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);
  const [signatureData, setSignatureData] = useState<string | null>(initialSignature);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Set drawing styles
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Load initial signature if provided
    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = initialSignature;
    } else {
      // Clear with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [width, height, initialSignature]);

  const getCoordinates = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    } else {
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    e.preventDefault();
    setIsDrawing(true);
    setHasSignature(true);

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [disabled, getCoordinates]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    e.preventDefault();
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing, disabled, getCoordinates]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    
    setIsDrawing(false);
    
    const canvas = canvasRef.current;
    if (canvas) {
      const data = canvas.toDataURL('image/png');
      setSignatureData(data);
      onSignatureChange?.(data);
    }
  }, [isDrawing, onSignatureChange]);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureData(null);
    onSignatureChange?.(null);
  }, [onSignatureChange]);

  // Handle touch events properly
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preventScroll = (e: TouchEvent) => {
      if (isDrawing) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    return () => {
      canvas.removeEventListener('touchmove', preventScroll);
    };
  }, [isDrawing]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex items-center gap-1 print:hidden">
          {hasSignature && (
            <span className="text-xs text-green-600 flex items-center gap-1 mr-2">
              <Check className="h-3 w-3" />
              Signed
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSignature}
            disabled={disabled || !hasSignature}
            className="h-7 px-2 text-xs gap-1"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </Button>
        </div>
      </div>
      
      <div className={`relative border rounded-md bg-white ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair'}`}>
        {/* Signature line overlay */}
        <div className="absolute bottom-4 left-4 right-4 border-b border-dashed border-muted-foreground/30 pointer-events-none" />
        
        {/* Placeholder text when no signature */}
        {!hasSignature && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-muted-foreground/40 text-sm flex items-center gap-2">
              <PenTool className="h-4 w-4" />
              Sign here
            </span>
          </div>
        )}
        
        <canvas
          ref={canvasRef}
          className="w-full touch-none"
          style={{ 
            height: `${height}px`,
            maxWidth: '100%',
          }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        
        {/* Print version - show signature image */}
        {signatureData && (
          <div className="hidden print:block">
            <img src={signatureData} alt={`${label} signature`} className="max-h-[100px]" />
          </div>
        )}
      </div>
      
      {/* Date field */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Date:</span>
        <span className="border-b border-dashed border-muted-foreground flex-1 min-w-[120px]">
          {hasSignature ? new Date().toLocaleDateString() : ''}
        </span>
      </div>
    </div>
  );
}
