import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  Circle, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  X,
  ArrowRight,
  RotateCcw,
  PartyPopper
} from 'lucide-react';
import { useGettingStarted, ChecklistItem } from '@/hooks/useGettingStarted';
import { cn } from '@/lib/utils';

interface GettingStartedChecklistProps {
  className?: string;
  variant?: 'full' | 'compact';
}

export function GettingStartedChecklist({ 
  className, 
  variant = 'full' 
}: GettingStartedChecklistProps) {
  const {
    checklist,
    dismissed,
    completedCount,
    totalCount,
    progress,
    isComplete,
    completeItem,
    dismissChecklist,
    showChecklist,
    resetProgress,
  } = useGettingStarted();

  const [expanded, setExpanded] = useState(true);

  if (dismissed && !isComplete) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={className}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={showChecklist}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4 text-accent" />
          Show Getting Started ({completedCount}/{totalCount})
        </Button>
      </motion.div>
    );
  }

  if (isComplete && variant === 'compact') {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={className}
    >
      <Card className={cn(
        "border-accent/30 bg-gradient-to-br from-accent/5 to-transparent",
        isComplete && "border-emerald-500/30 from-emerald-500/5"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {isComplete ? (
                <PartyPopper className="h-5 w-5 text-emerald-500" />
              ) : (
                <Sparkles className="h-5 w-5 text-accent" />
              )}
              <CardTitle className="text-lg">
                {isComplete ? "You're all set!" : "Getting Started"}
              </CardTitle>
              <Badge 
                variant="secondary" 
                className={cn(
                  "ml-2",
                  isComplete && "bg-emerald-500/10 text-emerald-600"
                )}
              >
                {completedCount}/{totalCount}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              {!isComplete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={dismissChecklist}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="mt-3">
            <Progress 
              value={progress} 
              className={cn(
                "h-2",
                isComplete && "[&>div]:bg-emerald-500"
              )}
            />
          </div>
        </CardHeader>

        <AnimatePresence>
          {(expanded || isComplete) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <CardContent className="pt-0">
                {isComplete ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      Great job! You've completed all the getting started steps.
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetProgress}
                        className="gap-2"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset Progress
                      </Button>
                      <Button
                        size="sm"
                        onClick={dismissChecklist}
                        className="bg-emerald-500 hover:bg-emerald-600"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {checklist.map((item, index) => (
                      <ChecklistItemRow 
                        key={item.id} 
                        item={item} 
                        index={index}
                        onComplete={completeItem}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

interface ChecklistItemRowProps {
  item: ChecklistItem;
  index: number;
  onComplete: (id: string) => void;
}

function ChecklistItemRow({ item, index, onComplete }: ChecklistItemRowProps) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg transition-colors",
        item.completed 
          ? "bg-muted/50" 
          : "bg-background hover:bg-muted/30"
      )}
    >
      <button
        onClick={() => !item.completed && onComplete(item.id)}
        className="mt-0.5 flex-shrink-0"
        disabled={item.completed}
      >
        {item.completed ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground hover:text-accent transition-colors" />
        )}
      </button>
      
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-medium",
          item.completed && "line-through text-muted-foreground"
        )}>
          {item.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {item.description}
        </p>
      </div>

      {!item.completed && item.route && (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-shrink-0 gap-1 text-accent hover:text-accent"
          onClick={() => onComplete(item.id)}
        >
          <Link to={item.route}>
            {item.action}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      )}
    </motion.li>
  );
}
