import { useState, useCallback } from "react";
import { Activity, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HealthStatus = "idle" | "checking" | "success" | "error";

interface HealthResult {
  status: HealthStatus;
  latency: number | null;
  error: string | null;
}

export const TTSHealthcheck = () => {
  const [result, setResult] = useState<HealthResult>({
    status: "idle",
    latency: null,
    error: null,
  });

  const checkHealth = useCallback(async () => {
    setResult({ status: "checking", latency: null, error: null });

    const startTime = performance.now();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            text: "Health check.",
            voiceId: "JBFqnCBsd6RMkjVDRZzb",
          }),
        }
      );

      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Verify we got audio data back
      const blob = await response.blob();
      if (blob.size < 100) {
        throw new Error("Invalid audio response");
      }

      setResult({
        status: "success",
        latency,
        error: null,
      });

      // Auto-reset after 5 seconds
      setTimeout(() => {
        setResult((prev) =>
          prev.status === "success"
            ? { status: "idle", latency: prev.latency, error: null }
            : prev
        );
      }, 5000);
    } catch (err) {
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      setResult({
        status: "error",
        latency,
        error: err instanceof Error ? err.message : "Unknown error",
      });

      // Auto-reset after 5 seconds
      setTimeout(() => {
        setResult((prev) =>
          prev.status === "error"
            ? { status: "idle", latency: null, error: null }
            : prev
        );
      }, 5000);
    }
  }, []);

  const getStatusIcon = () => {
    switch (result.status) {
      case "checking":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "success":
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case "error":
        return <XCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Activity className="h-3 w-3" />;
    }
  };

  const getStatusText = () => {
    switch (result.status) {
      case "checking":
        return "Checking...";
      case "success":
        return `OK ${result.latency}ms`;
      case "error":
        return result.error || "Failed";
      default:
        return result.latency ? `Last: ${result.latency}ms` : "Check TTS";
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={checkHealth}
      disabled={result.status === "checking"}
      className={cn(
        "h-7 px-2 text-xs gap-1.5 font-mono",
        result.status === "success" && "text-green-600 dark:text-green-400",
        result.status === "error" && "text-red-600 dark:text-red-400"
      )}
      title={result.error || "Test TTS endpoint health"}
    >
      {getStatusIcon()}
      <span className="max-w-[80px] truncate">{getStatusText()}</span>
    </Button>
  );
};
