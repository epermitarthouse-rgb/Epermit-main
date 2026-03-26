import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarPlus, ClipboardList, Loader2, Calendar, List } from 'lucide-react';
import { useInspections } from '@/hooks/useInspections';
import { ScheduleInspectionDialog } from './ScheduleInspectionDialog';
import { RecordInspectionResultDialog } from './RecordInspectionResultDialog';
import { GeneratePunchListDialog } from './GeneratePunchListDialog';
import { InspectionList } from './InspectionList';
import { InspectionCalendar } from './InspectionCalendar';
import { PunchList } from './PunchList';
import { PrintableInspectionChecklist } from './PrintableInspectionChecklist';
import { Inspection, PunchListStatus } from '@/types/inspection';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type ViewMode = 'list' | 'calendar';

interface ProjectInspectionsSectionProps {
  projectId: string;
}

export function ProjectInspectionsSection({ projectId }: ProjectInspectionsSectionProps) {
  const {
    inspections,
    punchListItems,
    loading,
    createInspection,
    updateInspection,
    deleteInspection,
    updatePunchListItem,
    deletePunchListItem,
    generatePunchListFromInspection,
  } = useInspections(projectId);

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [recordResultDialogOpen, setRecordResultDialogOpen] = useState(false);
  const [generatePunchListDialogOpen, setGeneratePunchListDialogOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const handleSchedule = async (data: any) => {
    setScheduling(true);
    await createInspection(data);
    setScheduling(false);
  };

  const handleRecordResult = (inspection: Inspection) => {
    setSelectedInspection(inspection);
    setRecordResultDialogOpen(true);
  };

  const handleRecord = async (id: string, data: any) => {
    setRecording(true);
    await updateInspection(id, data);
    setRecording(false);
  };

  const handleOpenGeneratePunchList = () => {
    setGeneratePunchListDialogOpen(true);
  };

  const handleGeneratePunchList = async (items: any[]) => {
    if (!selectedInspection) return;
    setGenerating(true);
    await generatePunchListFromInspection(selectedInspection.id, items);
    setGenerating(false);
  };

  const handleUpdatePunchListStatus = async (id: string, status: PunchListStatus) => {
    await updatePunchListItem(id, { status });
  };

  const handleReschedule = async (inspectionId: string, newDate: Date) => {
    await updateInspection(inspectionId, { scheduled_date: newDate.toISOString() });
  };

  const handleCalendarInspectionClick = (inspection: Inspection) => {
    if (inspection.status === 'scheduled' || inspection.status === 'in_progress') {
      handleRecordResult(inspection);
    }
  };

  const openPunchItems = punchListItems.filter(i => i.status === 'open' || i.status === 'in_progress').length;

  return (
    <div className="space-y-4">
      <Tabs defaultValue="inspections" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="inspections" className="flex items-center gap-2">
              <CalendarPlus className="h-4 w-4" />
              Inspections ({inspections.length})
            </TabsTrigger>
            <TabsTrigger value="punchlist" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Punch List
              {openPunchItems > 0 && (
                <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">
                  {openPunchItems}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value) => value && setViewMode(value as ViewMode)}
              size="sm"
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="calendar" aria-label="Calendar view">
                <Calendar className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <PrintableInspectionChecklist projectId={projectId} />
            <Button size="sm" onClick={() => setScheduleDialogOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              Schedule
            </Button>
          </div>
        </div>

        <Separator />

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <TabsContent value="inspections" className="mt-4">
              {viewMode === 'list' ? (
                <InspectionList
                  inspections={inspections}
                  onRecordResult={handleRecordResult}
                  onDelete={deleteInspection}
                />
              ) : (
                <InspectionCalendar
                  inspections={inspections}
                  onReschedule={handleReschedule}
                  onInspectionClick={handleCalendarInspectionClick}
                />
              )}
            </TabsContent>

            <TabsContent value="punchlist" className="mt-4">
              <PunchList
                items={punchListItems}
                onUpdateStatus={handleUpdatePunchListStatus}
                onDelete={deletePunchListItem}
              />
            </TabsContent>
          </>
        )}
      </Tabs>

      <ScheduleInspectionDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        onSchedule={handleSchedule}
        scheduling={scheduling}
      />

      <RecordInspectionResultDialog
        open={recordResultDialogOpen}
        onOpenChange={setRecordResultDialogOpen}
        inspection={selectedInspection}
        onRecord={handleRecord}
        onGeneratePunchList={handleOpenGeneratePunchList}
        recording={recording}
      />

      <GeneratePunchListDialog
        open={generatePunchListDialogOpen}
        onOpenChange={setGeneratePunchListDialogOpen}
        inspection={selectedInspection}
        onGenerate={handleGeneratePunchList}
        generating={generating}
      />
    </div>
  );
}
