import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { V2DisciplineChoice } from "@/lib/codeAnalyzer/v2DisciplineNavigator";

export function V2DisciplineNavigator({
  choices,
  selectedKey,
  onSelect,
}: {
  choices: V2DisciplineChoice[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  if (choices.length <= 1) return null;
  return (
    <div
      className="flex flex-wrap gap-2"
      data-testid="v2-discipline-navigator"
      role="toolbar"
      aria-label="Filter drawings by discipline"
    >
      {choices.map((choice) => (
        <Button
          key={choice.key}
          type="button"
          size="sm"
          variant={selectedKey === choice.key ? "tealData" : "outline"}
          aria-pressed={selectedKey === choice.key}
          onClick={() => onSelect(choice.key)}
        >
          {choice.label}
          <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{choice.count}</Badge>
        </Button>
      ))}
    </div>
  );
}
