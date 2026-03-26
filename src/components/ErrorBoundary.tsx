import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-4" />
          <h3 className="font-semibold text-lg mb-2">
            {this.props.fallbackTitle ?? "Something went wrong"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {this.state.error.message}
          </p>
          <Button onClick={this.handleRetry} variant="outline">
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
