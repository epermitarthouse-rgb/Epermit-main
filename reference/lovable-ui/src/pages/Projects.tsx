import { Link } from "react-router-dom";
import { ArrowRight, Filter, Plus, RadioTower, ShieldAlert, Wrench } from "lucide-react";
import { projects } from "@/components/permitpilot/data";
import { AlertBanner, MetricCard, PageHeader, Panel, ProgressLine, ServicePill, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const filters = ["All projects", "Permit-led", "Utility-led", "Combined service", "Action needed"];

const Projects = () => {
  const permitLed = projects.filter((project) => project.services.includes("permit-expediting")).length;
  const utilityLed = projects.filter((project) => project.services.includes("utility-coordination")).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Client workspace"
        title="Projects across permit expediting and utility coordination."
        body="Each project shows service mix, queue state, blockers, ownership, and the next operator action so newcomers can understand exactly what is moving and what is stalled."
        action={<button className="pilot-button-primary"><Plus className="h-4 w-4" /> New Project</button>}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Active projects" value={`${projects.length}`} detail="Shared client workspace" />
        <MetricCard label="Permit-led" value={`${permitLed}`} detail="Permit expediting in scope" icon={ShieldAlert} />
        <MetricCard label="Utility-led" value={`${utilityLed}`} detail="Provider-facing coordination" icon={Wrench} />
        <MetricCard label="Open blockers" value={`${projects.reduce((sum, project) => sum + project.openIssues, 0)}`} detail="Across both service lines" icon={RadioTower} />
      </div>

      <AlertBanner
        tone="warn"
        title="Projects now carry both service lines"
        detail="PermitPilot treats permit expediting and utility coordination as one client workflow. Mixed-service projects surface both permit blockers and provider dependencies in the same workspace."
      />

      <div className="flex flex-wrap gap-3">
        {filters.map((item) => (
          <button key={item} className="pilot-button-ghost py-2"><Filter className="h-4 w-4" />{item}</button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {projects.map((project) => (
          <Panel key={project.id} className="transition-colors hover:border-primary">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="pilot-kicker">{project.id}</div>
                <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">{project.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{project.address}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusPill tone={project.risk === "High" ? "bad" : project.risk === "Medium" ? "warn" : "good"}>{project.risk} risk</StatusPill>
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
                  {project.status}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {project.services.map((service) => (
                <ServicePill key={service} service={service} />
              ))}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Meta label="Client" value={project.client} />
              <Meta label="Jurisdiction" value={project.jurisdiction} />
              <Meta label="Owner" value={project.owner} />
            </div>

            <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Meta label="Service summary" value={project.serviceSummary} />
                <Meta label="Project type" value={project.projectType} />
                <Meta label="Queue health" value={project.queueHealth} />
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{project.phase}</span>
                <span>{project.progress}% complete</span>
              </div>
              <ProgressLine value={project.progress} />
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <MiniStat label="Permit items" value={`${project.permitCount}`} />
              <MiniStat label="Utility items" value={`${project.utilityCount}`} />
              <MiniStat label="Open issues" value={`${project.openIssues}`} />
            </div>

            <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4">
              <div className="pilot-kicker">Current blockers</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {project.blockers.map((blocker) => (
                  <span key={blocker} className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-data text-[10px] uppercase tracking-wider text-destructive">
                    {blocker}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                Providers: <span className="text-foreground">{project.providers.join(" · ")}</span>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                Next action: <span className="text-foreground">{project.next}</span>
                <div className="mt-1 font-data text-[11px] uppercase tracking-wider text-muted-foreground">{project.due}</div>
              </div>
              <Link to="/projects/alpha" className="pilot-button-ghost py-2">Open Workspace <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
};

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="pilot-kicker">{label}</div>
    <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
  </div>
);

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border bg-background px-4 py-3">
    <div className="pilot-kicker">{label}</div>
    <div className="mt-2 font-data text-2xl font-semibold text-foreground">{value}</div>
  </div>
);

export default Projects;