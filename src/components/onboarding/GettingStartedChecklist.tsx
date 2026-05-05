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
          className="gap-2 rounded-lg border-gold/45 bg-cream text-gold-deep transition-colors hover:bg-gold hover:text-cream"
        >
          <Sparkles className="h-4 w-4 text-teal" />
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
      <Card
        className={cn(
          "rounded-2xl border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream transition-[box-shadow,border-color] dark:bg-cream-raised dark:text-ink-primary-light",
          isComplete
            ? "border-emerald-500/35 shadow-[0_8px_28px_-8px_hsl(142_71%_45%/0.1)] hover:border-emerald-500/45"
            : "border-teal/18 shadow-[0_10px_32px_-8px_hsl(var(--accent-teal)/0.08)] hover:border-gold/25",
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {isComplete ? (
                <PartyPopper className="h-5 w-5 text-emerald-500" />
              ) : (
                <Sparkles className="h-5 w-5 text-teal" />
              )}
              <CardTitle className="text-lg !font-normal font-display tracking-tight !text-ink-primary-light">
                {isComplete ? "You're all set!" : "Getting Started"}
              </CardTitle>
              <Badge 
                variant="secondary" 
                className={cn(
                  "ml-2 border border-cream-sunken bg-cream-sunken/50 text-ink-secondary-light",
                  isComplete && "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
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
                  className="h-7 w-7 text-ink-tertiary-light hover:bg-cream-sunken/50 hover:text-ink-primary-light dark:hover:bg-cream-sunken/40"
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
                className="h-7 w-7 text-ink-tertiary-light hover:bg-cream-sunken/50 hover:text-ink-primary-light dark:hover:bg-cream-sunken/40"
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
                "h-2 rounded-full border border-cream-sunken/60 bg-cream-sunken/45",
                isComplete ? "[&>div]:!bg-emerald-500" : "[&>div]:!bg-gold",
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
                    <p className="mb-4 text-sm text-ink-secondary-light">
                      Great job! You've completed all the getting started steps.
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetProgress}
                        className="gap-2 rounded-lg border-gold/45 text-gold-deep transition-colors hover:border-gold hover:bg-gold hover:text-cream"
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
        "flex items-start gap-3 rounded-lg border border-cream-sunken/55 p-3 transition-colors",
        item.completed
          ? "border-teal/20 bg-teal-soft/45"
          : "border-transparent bg-cream hover:border-cream-sunken hover:bg-cream-sunken/35",
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
          <Circle className="h-5 w-5 text-teal/70 transition-colors hover:text-teal" />
        )}
      </button>
      
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-medium text-ink-primary-light",
          item.completed && "text-ink-tertiary-light line-through"
        )}>
          {item.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-secondary-light">
          {item.description}
        </p>
      </div>

      {!item.completed && item.route && (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-shrink-0 gap-1 text-gold-deep hover:bg-cream-sunken/40 hover:text-gold"
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
