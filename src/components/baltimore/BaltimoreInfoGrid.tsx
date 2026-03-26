import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BaltimoreInfoGridProps {
  items: Array<[string, string | ReactNode]>;
  className?: string;
}

export function BaltimoreInfoGrid({ items, className }: BaltimoreInfoGridProps) {
  return (
    <table className={cn("w-full border-collapse text-sm", className)}>
      <tbody>
        {items.map(([label, value], i) => (
          <tr key={i} className="border-b border-border last:border-0">
            <td className="w-[40%] py-1.5 pr-2 align-top text-muted-foreground">
              {label}
            </td>
            <td className="py-1.5 text-foreground">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
