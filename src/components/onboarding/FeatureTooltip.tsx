import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X, Lightbulb, ArrowRight } from 'lucide-react';
import { useGettingStarted } from '@/hooks/useGettingStarted';
import { cn } from '@/lib/utils';

interface FeatureTooltipProps {
  id: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  showOnce?: boolean;
  delay?: number;
  className?: string;
}

export function FeatureTooltip({
  id,
  title,
  description,
  position = 'bottom',
  children,
  action,
  showOnce = true,
  delay = 500,
  className,
}: FeatureTooltipProps) {
  const { hasSeenTooltip, markTooltipSeen } = useGettingStarted();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (showOnce && hasSeenTooltip(id)) {
      return;
    }

    const timer = setTimeout(() => {
      setVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [id, showOnce, hasSeenTooltip, delay]);

  const handleDismiss = () => {
    setDismissed(true);
    setVisible(false);
    if (showOnce) {
      markTooltipSeen(id);
    }
  };

  const handleAction = () => {
    action?.onClick();
    handleDismiss();
  };

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent',
  };

  if (dismissed || (showOnce && hasSeenTooltip(id))) {
    return <>{children}</>;
  }

  return (
    <div className={cn("relative inline-block", className)}>
      {children}
      
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: position === 'bottom' ? -10 : position === 'top' ? 10 : 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "absolute z-50 w-72 p-4 rounded-lg shadow-lg",
              "bg-primary text-primary-foreground",
              positionClasses[position]
            )}
          >
            {/* Arrow */}
            <div 
              className={cn(
                "absolute w-0 h-0 border-8 border-primary",
                arrowClasses[position]
              )} 
            />

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-6 w-6 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>

            {/* Content */}
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-full bg-accent/20 flex-shrink-0">
                <Lightbulb className="h-4 w-4 text-accent" />
              </div>
              <div className="flex-1 pr-4">
                <h4 className="font-semibold text-sm mb-1">{title}</h4>
                <p className="text-xs text-primary-foreground/80 leading-relaxed">
                  {description}
                </p>
                
                {action && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3 gap-1 h-7 text-xs"
                    onClick={handleAction}
                  >
                    {action.label}
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {/* Got it button */}
            <div className="flex justify-end mt-3 pt-2 border-t border-primary-foreground/10">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
                onClick={handleDismiss}
              >
                Got it
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Simpler spotlight tooltip for inline hints
interface SpotlightHintProps {
  id: string;
  message: string;
  children: React.ReactNode;
  className?: string;
}

export function SpotlightHint({ id, message, children, className }: SpotlightHintProps) {
  const { hasSeenTooltip, markTooltipSeen } = useGettingStarted();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasSeenTooltip(id)) {
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [id, hasSeenTooltip]);

  const handleDismiss = () => {
    setVisible(false);
    markTooltipSeen(id);
  };

  if (hasSeenTooltip(id)) {
    return <>{children}</>;
  }

  return (
    <div className={cn("relative", className)}>
      {children}
      
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute -top-1 -right-1 z-10"
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span 
                className="relative inline-flex rounded-full h-3 w-3 bg-accent cursor-pointer"
                onClick={handleDismiss}
                title={message}
              />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
