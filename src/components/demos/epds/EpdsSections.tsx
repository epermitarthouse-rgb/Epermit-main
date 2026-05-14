import { type ComponentType, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarIcon,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileStack,
  FolderOpen,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Send,
  Shield,
  Sparkles,
  User,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/** Extra sizing on demo controls; primitives use theme tokens. */
const dsInput =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 dark:bg-card";

const permitTrendConfig = {
  filed: {
    label: "Applications filed",
    color: "hsl(var(--chart-1))",
  },
  inspections: {
    label: "Inspections booked",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

export function EpdsSections() {
  const [selectedRowId, setSelectedRowId] = useState<string | null>("perm-4821");
  const [sheetFormOpen, setSheetFormOpen] = useState(false);
  const [sheetReviewOpen, setSheetReviewOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState<Date | undefined>(new Date(2026, 4, 8));
  const [aiDraftTriage, setAiDraftTriage] = useState(true);

  const chartData = useMemo(
    () => [
      { month: "Jan", filed: 18, inspections: 12 },
      { month: "Feb", filed: 24, inspections: 15 },
      { month: "Mar", filed: 21, inspections: 19 },
      { month: "Apr", filed: 28, inspections: 22 },
      { month: "May", filed: 32, inspections: 26 },
    ],
    [],
  );

  const handleToast = () => {
    toast.info("County sync scheduled", {
      description: "Fairfax uploads will reconcile in ~6 minutes.",
    });
  };

  return (
    <div className="container-page pb-28">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        {/* Page chrome */}
        <div className="space-y-6">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/dashboard">Dashboard</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/projects">Projects</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Design system preview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="label-caps text-muted-foreground">Internal mock · same theme tokens as production</p>
              <h1 className="font-display text-3xl font-light tracking-tight text-foreground sm:text-4xl">
                Epermit component language
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                21st-style token structure with PermitPilot surfaces: cream canvas, obsidian dark shell, teal
                operational primary, gold navigation highlights. Toggle theme in the shell header to confirm both
                modes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="ai" className="uppercase tracking-wide">
                Live preview route
              </Badge>
              <Badge variant="brand">Gold secondary</Badge>
            </div>
          </div>

          <Card className="rounded-lg shadow-sm hover:translate-y-0">
            <CardContent className="flex flex-col gap-4 p-4 pt-6 sm:flex-row sm:items-center">
              <div className="relative flex-1 min-w-[12rem]">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className={cn(dsInput, "h-11 rounded-lg pl-9")}
                  placeholder="Search permits, counties, IFC refs…"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select defaultValue="va">
                  <SelectTrigger className={cn(dsInput, "h-11 w-[160px] rounded-lg bg-background dark:bg-card")}>
                    <SelectValue placeholder="Jurisdiction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="va">Virginia cluster</SelectItem>
                    <SelectItem value="md">Maryland / DC</SelectItem>
                    <SelectItem value="south">Sunbelt rollout</SelectItem>
                  </SelectContent>
                </Select>
                <Select defaultValue="review">
                  <SelectTrigger className={cn(dsInput, "h-11 w-[150px] rounded-lg bg-background dark:bg-card")}>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="review">In plan review</SelectItem>
                    <SelectItem value="issued">Issued</SelectItem>
                    <SelectItem value="hold">On hold</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={handleToast}>
                  Run filter sweep
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* KPI */}
        <section className="space-y-4">
          <SectionTitle kicker="KPI & status" title="Throughput & queue health" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Plan review SLA"
              value="4.8d"
              delta="+0.6d vs Fairfax baseline"
              icon={Shield}
              tone="default"
            />
            <MetricCard
              title="Open IFC comments"
              value="128"
              delta="−12 after auto-classify sweep"
              icon={MessageSquare}
              tone="warning"
            />
            <MetricCard
              title="Permits nearing expiry"
              value="7"
              delta="County of Arlington backlog"
              icon={ClipboardList}
              tone="muted"
            />
            <MetricCard
              title="AI draft coverage"
              value="94%"
              delta="Eligible jurisdictions only"
              icon={Sparkles}
              tone="teal"
            />
          </div>
        </section>

        {/* Raised / bordered cards */}
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-lg lg:col-span-2">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Filing throughput</CardTitle>
                <CardDescription>County of Arlington pilot · stacked permit + inspection cadence</CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Chart actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Export</DropdownMenuLabel>
                  <DropdownMenuItem>Open in Analytics</DropdownMenuItem>
                  <DropdownMenuItem>CSV · jurisdiction slice</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Copy embed token</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              <ChartContainer config={permitTrendConfig} className="h-[260px] w-full">
                <BarChart accessibilityLayer data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="filed" fill="var(--color-filed)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="inspections" fill="var(--color-inspections)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-2 shadow-md">
            <CardHeader>
              <CardTitle className="text-lg">Workflow · PP-2419-ARL</CardTitle>
              <CardDescription>Ballston residential tower envelope</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-tight uppercase tracking-wide text-muted-foreground">
                  <span>Plan review completeness</span>
                  <span>72%</span>
                </div>
                <Progress value={72} className="h-2 rounded-full bg-secondary" />
              </div>
              <WorkflowStep active done label="Intake QC" caption="County packet matched" />
              <WorkflowStep active={false} done label="Structural peer" caption="Awaiting Fairfax signed letter" />
              <WorkflowStep active={false} done={false} label="Fire marshal sign-off" caption="Occupant load unresolved" />
            </CardContent>
            <CardFooter className="flex justify-between pb-6">
              <Button variant="ghost" size="sm" className="font-tight" onClick={() => setSheetReviewOpen(true)}>
                Open review drawer
              </Button>
              <Button size="sm" className="font-tight" variant="outline" asChild>
                <a href="#">View permit file</a>
              </Button>
            </CardFooter>
          </Card>
        </section>

        {/* Tables */}
        <section className="space-y-4">
          <SectionTitle kicker="Data density" title="Permit queue tables" />

          <div className="space-y-8">
            <div>
              <h3 className="mb-2 font-tight text-sm font-semibold text-foreground">Standard table · actions & badges</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox aria-label="Select all" disabled />
                    </TableHead>
                    <TableHead>Permit ID</TableHead>
                    <TableHead>Jurisdiction</TableHead>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    data-state={selectedRowId === "perm-4821" ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedRowId("perm-4821")}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedRowId === "perm-4821"} aria-label="Select row" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">PP-2419-ARL</TableCell>
                    <TableCell>Arlington County, VA</TableCell>
                    <TableCell className="text-muted-foreground">N. Okonkwo</TableCell>
                    <TableCell>
                      <Badge variant="warning" className="font-tight">
                        Comments due
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">09</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Row actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Duplicate filing</DropdownMenuItem>
                          <DropdownMenuItem>Freeze jurisdiction sync</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  <TableRow
                    data-state={selectedRowId === "perm-5110" ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedRowId("perm-5110")}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedRowId === "perm-5110"} aria-label="Select row" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">PP-5110-FX</TableCell>
                    <TableCell>Fairfax County, VA</TableCell>
                    <TableCell className="text-muted-foreground">L. Harrell</TableCell>
                    <TableCell>
                      <Badge variant="success">Cleared IFC</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">14</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="opacity-55">
                    <TableCell colSpan={7} className="text-xs text-muted-foreground">
                      Row hover vs selected contrast is tuned via <code className="font-mono">muted</code> /{" "}
                      <code className="font-mono">elevated</code>.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <div className="mt-4">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious href="#" aria-disabled />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#" isActive>
                        1
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#">2</PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext href="#" />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </div>

            <div>
              <h3 className="mb-2 font-tight text-sm font-semibold text-foreground">
                Compact table · IFC comment codes
              </h3>
              <Table wrapperClassName="rounded-md border-dashed border-border/80">
                <TableHeader className="table-head-sticky">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-10 py-2 text-[10px]">Code</TableHead>
                    <TableHead className="h-10 py-2 text-[10px]">Description</TableHead>
                    <TableHead className="h-10 py-2 text-[10px]">County response</TableHead>
                    <TableHead className="h-10 py-2 text-[10px] text-right">Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { code: "IBC§503.4", note: "Height area · stair pressurization", resp: "Resubmit VE narrative", age: "2d" },
                    { code: "IFC§907", note: "Detector spacing · high bay", resp: "OK w/ VFDS mod", age: "5d" },
                    { code: "NFPA13", note: "ESFR calc · commodity class IV", resp: "Hold — hydrant curve", age: "1d" },
                  ].map((row) => (
                    <TableRow key={row.code} tabIndex={0} className="focus-visible:bg-muted/40 focus-visible:outline-none">
                      <TableCell className="py-2 px-3 font-mono text-[11px]">{row.code}</TableCell>
                      <TableCell className="py-2 px-3 text-xs">{row.note}</TableCell>
                      <TableCell className="py-2 px-3 text-xs text-muted-foreground">{row.resp}</TableCell>
                      <TableCell className="py-2 px-3 text-right font-mono text-[11px]">{row.age}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        {/* Drawers & dialogs */}
        <section className="space-y-4">
          <SectionTitle kicker="Overlays" title="Sheets, dialogs, destructive guardrails" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setSheetFormOpen(true)}>
              Form sheet
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSheetReviewOpen(true)}>
              Review drawer
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Edit jurisdiction metadata</Button>
              </DialogTrigger>
              <DialogContent className={cn("max-w-lg border-border bg-background p-6")}>
                <DialogHeader>
                  <DialogTitle>Arlington County notes</DialogTitle>
                  <DialogDescription>Internal ops copy only — persists to Supabase staging.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="portal-slug-url">Portal slug</Label>
                    <Input id="portal-slug-url" defaultValue="arlington-va/permittrak" className={cn(dsInput, "rounded-md")} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="county-queue-id">County queue ID</Label>
                    <Input id="county-queue-id" defaultValue="Q-ARL-08912" className={cn(dsInput, "rounded-md font-mono")} />
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" type="button">
                    Discard
                  </Button>
                  <Button type="button">Save changes</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Revoke IFC upload tokens</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke Fairfax signed URLs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    GC partners lose access immediately. Fairfax packet version 04-B must be regenerated.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                  <AlertDialogAction type="button" className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Revoke tokens
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Form sheet */}
          <Sheet open={sheetFormOpen} onOpenChange={setSheetFormOpen}>
            <SheetContent className={cn("flex flex-col gap-4 border-border bg-background sm:max-w-md")}>
              <SheetHeader className="text-left">
                <SheetTitle>New supplemental upload</SheetTitle>
                <SheetDescription>Associate files with PP-2419-ARL before county cut-off tonight.</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 overflow-y-auto pr-1">
                <div className="grid gap-1.5">
                  <Label htmlFor="ds-doc-title">Drawing title block</Label>
                  <Input id="ds-doc-title" placeholder="SPR-ENG-REV04" className={cn(dsInput, "rounded-md font-mono")} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Target review stage</Label>
                  <RadioGroup defaultValue="structural">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="rw-structural" value="structural" />
                      <Label htmlFor="rw-structural">Structural IFC pass</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="rw-fire" value="fire" />
                      <Label htmlFor="rw-fire">Life safety / FIRE</Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">AI auto-triage</p>
                    <p className="text-xs text-muted-foreground">Classify comments · route to SMEs</p>
                  </div>
                  <Switch checked={aiDraftTriage} onCheckedChange={setAiDraftTriage} aria-label="AI auto-triage" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ds-notes-field">County-facing note</Label>
                  <Textarea
                    id="ds-notes-field"
                    rows={4}
                    placeholder="Summarize delta vs prior upload…"
                    className={cn(dsInput, "min-h-[100px] rounded-md")}
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-11 justify-start text-left font-normal", dsInput)} type="button">
                      <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                      {dateDraft ? format(dateDraft, "PPP") : "Revision date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateDraft} onSelect={setDateDraft} />
                  </PopoverContent>
                </Popover>
              </div>
              <SheetFooter className="mt-auto flex-row gap-2 sm:justify-end">
                <SheetClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </SheetClose>
                <Button
                  type="button"
                  onClick={() => {
                    setSheetFormOpen(false);
                    toast.success("Upload queued for PP-2419-ARL");
                  }}
                >
                  Stage upload
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          {/* Review drawer */}
          <Sheet open={sheetReviewOpen} onOpenChange={setSheetReviewOpen}>
            <SheetContent side="right" overlayClassName="bg-black/50" className="w-full gap-6 border-border bg-background sm:max-w-xl">
              <SheetHeader className="text-left border-b border-border pb-4">
                <SheetTitle>Reviewer thread · IFC pass 3</SheetTitle>
                <SheetDescription>County of Arlington · Ballston facade VE package</SheetDescription>
              </SheetHeader>

              <div className="space-y-6 overflow-y-auto pr-1 pb-28">
                <div className="rounded-lg border border-border/70 bg-muted/25 p-4">
                  <p className="text-xs font-tight uppercase tracking-wide text-muted-foreground">Latest county comment</p>
                  <p className="mt-3 text-sm leading-relaxed text-foreground">
                    Please coordinate stair pressurization fans with IFC §909 — updated loads attached to Fairfax peer
                    revision 04-B.
                  </p>
                  <Separator className="my-4" />
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">IFC§909</Badge>
                    <Badge variant="ai">AI summary · high confidence</Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <ReviewComment
                    initials="NO"
                    name="Nadia Okonkwo"
                    meta="County plan reviewer · Tue 09:41"
                    body="Hydrant residual needs 20 psi residual at most remote hose stream per NFPA §4.35 — confirm with Fairfax water model export."
                  />
                  <ReviewComment
                    initials="LH"
                    name="Luis Harrell"
                    meta="PE of record · Wed 07:58"
                    body="Uploaded revised pump curve CSV + witness test letter. Holds until Arlington closes NFPA parallel."
                  />
                </div>

                <ReviewerActivity />

                <FileRow name="Structural_IFC_Response_Matrix_rev04.pdf" badge="County" />
                <FileRow name="Hydrant_residual_curve.csv" badge="Consultant" />
              </div>

              <SheetFooter className="mt-auto gap-3 border-t border-border bg-background pb-10 pt-4">
                <Textarea placeholder="Respond to reviewer (internal draft)…" className={cn(dsInput, "min-h-[76px] flex-1 rounded-md")} />
                <Button type="button" className="shrink-0 gap-2" variant="outline">
                  <Mail className="h-4 w-4" />
                  Email packet
                </Button>
                <Button type="button" className="shrink-0 gap-2">
                  <Send className="h-4 w-4" />
                  Post reply
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </section>

        {/* Panels & patterns */}
        <section className="space-y-4">
          <SectionTitle kicker="Patterns" title="Tasks, filings, accordion, banners" />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-lg bg-card shadow-elegant hover:translate-y-0">
              <CardHeader>
                <CardTitle className="text-lg font-display">Outstanding tasks · GC team</CardTitle>
                <CardDescription>Ballston façade package</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <TaskRow status="blocked" title="Hydrant residual proof" subtitle="County hold · NFPA 13 appendix" />
                <TaskRow status="doing" title="Upload signed VE letter" subtitle="Architect seal required" />
                <TaskRow status="done" title="Submit smoke control narrative" subtitle="Structural peer cleared" />
              </CardContent>
            </Card>

            <Accordion type="single" collapsible defaultValue="item-1">
              <AccordionItem value="item-1">
                <AccordionTrigger>County intake packet · checklist status</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                  <FeatureRow
                    icon={CheckCircle2}
                    ok
                    label="AACO portal credentials rotated"
                    detail="Ends in 82 days · Vault ref #4411"
                  />
                  <FeatureRow
                    icon={Loader2}
                    ok={false}
                    label="Fire marshal routing"
                    detail="Holiday staffing — SLA +2 days"
                    iconClassName="animate-spin"
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>Jurisdiction SLA assumptions</AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  Arlington adopts Fairfax structural peer outcomes when IFC matrix cells align. Divergence triggers manual
                  triage badge.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 gap-1 font-tight text-muted-foreground data-[state=open]:[&>svg]:rotate-90"
              >
                Collapsible QA notes{" "}
                <ChevronRight className="h-4 w-4 opacity-70 transition-transform" aria-hidden />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 rounded-lg border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
              County reviewers requested dual-path hydrant simulations when occupancy &gt; 500. Keep linked to IFC matrix cell
              C7.
            </CollapsibleContent>
          </Collapsible>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-lg hover:translate-y-0 shadow-none hover:shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-tight font-semibold">Bordered KPI shell</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Muted surface for explanatory copy beside dense grids.</CardContent>
            </Card>
            <Card className="flex flex-col items-center justify-center gap-2 rounded-lg border-dashed border-border/70 py-10 text-center hover:translate-y-0">
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No supplemental uploads</p>
              <p className="text-xs text-muted-foreground">Drag IFC responses or browse county portal.</p>
              <Button size="sm" variant="outline" className="mt-2 gap-2">
                <Paperclip className="h-4 w-4" /> Add files
              </Button>
            </Card>

            <Card className="rounded-lg hover:translate-y-0 shadow-md">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base font-tight font-semibold">Card with destructive action</CardTitle>
                  <CardDescription>Jurisdiction unlink</CardDescription>
                </div>
              </CardHeader>
              <CardFooter className="justify-end gap-2">
                <Button variant="destructive" size="sm">
                  Remove Fairfax binding
                </Button>
              </CardFooter>
            </Card>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle>Portal sync degraded</AlertTitle>
            <AlertDescription>
              Fairfax Accela outage window until 03:30 UTC · manual CSV export required for IFC matrix refresh.
            </AlertDescription>
          </Alert>

          <Alert>
            <Info className="h-5 w-5" />
            <AlertTitle>Weekly jurisdiction digest queued</AlertTitle>
            <AlertDescription>Includes Fairfax + Arlington deltas — PDF lands in PermitPilot inbox in ~12 minutes.</AlertDescription>
          </Alert>

          <div className="rounded-xl border border-border/70 bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Skeleton · loading placeholders</p>
            <div className="mt-4 space-y-3">
              <Skeleton className="h-4 w-3/4 max-w-[360px]" />
              <Skeleton className="h-4 w-5/6 max-w-[280px]" />
              <div className="flex gap-2">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          </div>
        </section>

        {/* Buttons & tabs */}
        <section className="space-y-4">
          <SectionTitle kicker="Controls" title="Buttons, tabs, toaster" />

          <Card className="rounded-lg hover:translate-y-0">
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap gap-2">
                <Button>Primary submit</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="gold">Gold editorial</Button>
                <Button variant="tealData">Teal dataset</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="outline" disabled>
                  Disabled
                </Button>
              </div>
              <Tabs defaultValue="queue">
                <TabsList className="grid max-w-xl grid-cols-3 rounded-lg bg-muted/60 p-1">
                  <TabsTrigger value="queue">Queue health</TabsTrigger>
                  <TabsTrigger value="county">County SLAs</TabsTrigger>
                  <TabsTrigger value="exports">Exports</TabsTrigger>
                </TabsList>
                <TabsContent value="queue" className="mt-4 rounded-lg border border-border/60 bg-muted/15 p-4 text-sm leading-relaxed text-muted-foreground">
                  Fairfax intake queue at 142 active permits (+8 since Friday). IFC comment SLA risk on{" "}
                  <span className="font-mono text-foreground">PP-4821-WO</span>.
                </TabsContent>
                <TabsContent value="county" className="mt-4 rounded-lg border border-border/60 bg-muted/15 p-4 text-sm text-muted-foreground">
                  Arlington plan review SLA 4.8d median · Gold badge indicates county partnership tier.
                </TabsContent>
                <TabsContent value="exports" className="mt-4 rounded-lg border border-border/60 bg-muted/15 p-4 text-sm text-muted-foreground">
                  CSV + PDF bundles honor dark mode typography — verify printed contrast separately.
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => toast.success("Permit flagged for weekly report")}>
                  Toast · success
                </Button>
                <Button type="button" variant="outline" onClick={() => toast.warning("County packet checksum mismatch")}>
                  Toast · warning
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Error-ish inline */}
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Synthetic error panel · PP-0891 sync failed validation (409). Inspect county payload diff before reopening IFC
          thread.
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <p className="label-caps">{kicker}</p>
      <h2 className="font-display mt-2 text-xl font-light tracking-tight text-foreground sm:text-2xl">{title}</h2>
    </div>
  );
}

function MetricCard({
  title,
  value,
  delta,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  delta: string;
  icon: ComponentType<{ className?: string }>;
  tone: "default" | "warning" | "muted" | "teal";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning/25 bg-warning/10"
      : tone === "muted"
        ? "border-border/60 bg-muted/30"
        : tone === "teal"
          ? "border-teal/30 bg-teal/10"
          : "border-border/70 bg-card";

  return (
    <Card className={cn("rounded-lg hover:translate-y-0", toneClass)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium font-tight text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="font-display text-3xl font-light tabular-nums text-foreground">{value}</div>
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowUpRight className="h-3 w-3 opacity-70" />
          {delta}
        </p>
      </CardContent>
    </Card>
  );
}

function WorkflowStep({
  label,
  caption,
  active,
  done,
}: {
  label: string;
  caption: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-tight font-semibold",
          done && "border-primary bg-primary text-primary-foreground",
          !done && active && "border-primary text-primary",
          !done && !active && "border-border text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : active ? "•" : ""}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}

function ReviewComment({
  initials,
  name,
  meta,
  body,
}: {
  initials: string;
  name: string;
  meta: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border/60 bg-card/60 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {initials}
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <Badge variant="outline" className="text-[10px]">
            {meta}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function ReviewerActivity() {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <p className="label-caps text-muted-foreground">Reviewer activity · last 72h</p>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        <li className="flex gap-2">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <span>County uploaded IFC matrix export v06</span>
        </li>
        <li className="flex gap-2">
          <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
          <span>Consultant synced structural peer PDF</span>
        </li>
        <li className="flex gap-2">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>Fairfax clarified hydrant wording via portal message</span>
        </li>
      </ul>
    </div>
  );
}

function FileRow({ name, badge }: { name: string; badge: string }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-left text-sm hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-2 truncate font-mono text-xs text-foreground">
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </span>
      <Badge variant="secondary" className="font-tight uppercase tracking-wide">
        {badge}
      </Badge>
    </button>
  );
}

function TaskRow({
  title,
  subtitle,
  status,
}: {
  title: string;
  subtitle: string;
  status: "done" | "doing" | "blocked";
}) {
  const badge =
    status === "done" ? (
      <Badge variant="success">Done</Badge>
    ) : status === "doing" ? (
      <Badge variant="ai">In flight</Badge>
    ) : (
      <Badge variant="outlineDanger">Blocked</Badge>
    );

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
      <div>
        <p className="font-tight text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {badge}
    </div>
  );
}

function FeatureRow({
  icon: Icon,
  label,
  detail,
  ok,
  iconClassName,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  ok: boolean;
  iconClassName?: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className={cn("mt-1 h-4 w-4 shrink-0", iconClassName, ok ? "text-success" : "text-warning")} />
      <div>
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
