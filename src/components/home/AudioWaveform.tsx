import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AudioWaveformProps {
  isActive: boolean;
  isLoading?: boolean;
  className?: string;
  barCount?: number;
}

export function AudioWaveform({ 
  isActive, 
  isLoading = false, 
  className,
  barCount = 5 
}: AudioWaveformProps) {
  const [bars, setBars] = useState<number[]>(Array(barCount).fill(0.3));
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!isActive || isLoading) {
      setBars(Array(barCount).fill(0.15));
      return;
    }

    const animate = () => {
      setBars(prev => prev.map(() => 
        0.2 + Math.random() * 0.8
      ));
      animationRef.current = requestAnimationFrame(() => {
        setTimeout(animate, 100 + Math.random() * 50);
      });
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, isLoading, barCount]);

  return (
    <div className={cn(
      "flex items-center justify-center gap-0.5 h-6",
      className
    )}>
      {bars.map((height, index) => (
        <motion.div
          key={index}
          className={cn(
            "w-1 rounded-full",
            isActive && !isLoading 
              ? "bg-primary" 
              : "bg-muted-foreground/40"
          )}
          initial={{ height: '15%' }}
          animate={{ 
            height: `${height * 100}%`,
            opacity: isActive ? 1 : 0.5
          }}
          transition={{ 
            duration: 0.15,
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}
