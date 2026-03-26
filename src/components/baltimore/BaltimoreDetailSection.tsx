import { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface BaltimoreDetailSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function BaltimoreDetailSection({
  title,
  children,
  className,
}: BaltimoreDetailSectionProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}
