import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Play, Square } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export interface ReviewTimerHandle {
  stopAndSave: () => Promise<void>;
  isRunning: () => boolean;
}

interface ReviewTimerProps {
  projectId: string | null;
  commentCount: number;
  compact?: boolean;
  className?: string;
}

export const ReviewTimer = forwardRef<ReviewTimerHandle, ReviewTimerProps>(
  function ReviewTimer({ projectId, commentCount, compact = false, className }, ref) {
    const { user } = useAuth();
    const [running, setRunning] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }, []);

    const start = useCallback(() => {
      startTimeRef.current = Date.now();
      setElapsed(0);
      setRunning(true);
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    }, []);

    const stop = useCallback(async () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setRunning(false);

      if (!startTimeRef.current || !user?.id || !projectId) return;

      const durationMinutes = Math.round(((Date.now() - startTimeRef.current) / 60000) * 100) / 100;
      startTimeRef.current = null;

      if (durationMinutes < 0.01) return;

      try {
        await supabase.from("baseline_actions").insert({
          project_id: projectId,
          expeditor_id: user.id,
          action_type: "timed_review",
          duration_minutes: durationMinutes,
        });
      } catch (err) {
        console.error("Failed to save review timing:", err);
      }
    }, [user?.id, projectId]);

    useImperativeHandle(ref, () => ({
      stopAndSave: stop,
      isRunning: () => running,
    }), [stop, running]);

    const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    };

    const buttonClass = cn(
      compact
        ? "h-8 rounded-lg px-2.5 text-xs font-medium [&_svg]:size-3.5"
        : "h-7 px-3 text-xs rounded-full",
      className,
    );

    return (
      <div className="flex items-center gap-1.5" data-testid="review-timer">
        {running ? (
          <>
            <div
              className={cn(
                "flex items-center gap-1.5 font-mono bg-red-500/10 text-red-500 border border-red-500/30",
                compact ? "h-8 rounded-lg px-2 text-[11px]" : "rounded px-2 py-1 text-xs",
              )}
            >
              <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              {formatTime(elapsed)}
            </div>
            <Button
              variant="outline"
              onClick={stop}
              data-testid="button-stop-timer"
              className={buttonClass}
            >
              <Square />
              Stop
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            onClick={start}
            disabled={!projectId || commentCount === 0}
            data-testid="button-start-timer"
            className={cn(
              buttonClass,
              compact && "text-muted-foreground hover:text-foreground",
            )}
          >
            <Play />
            Start Review Timer
          </Button>
        )}
      </div>
    );
  }
);
