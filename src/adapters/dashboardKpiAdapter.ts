/** Presentation KPIs only — callers pass real counts from hooks/queries. Never invent mock KPIs. */
export type DashboardKpi = {
  id: string;
  label: string;
  value: number | string;
  hint?: string;
};

export function buildDashboardKpis(input: {
  projectCount: number;
  checklistCount?: number;
  calculationCount?: number;
  selectedProjectName?: string | null;
}): DashboardKpi[] {
  return [
    {
      id: "projects",
      label: "Projects",
      value: input.projectCount,
      hint: input.selectedProjectName ? `Active: ${input.selectedProjectName}` : undefined,
    },
    {
      id: "checklists",
      label: "Saved checklists",
      value: input.checklistCount ?? 0,
    },
    {
      id: "calculations",
      label: "Saved calculations",
      value: input.calculationCount ?? 0,
    },
  ];
}
