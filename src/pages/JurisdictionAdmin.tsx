import { useState } from 'react';
import { JurisdictionManager } from '@/components/admin/JurisdictionManager';
import { CoverageRequestsPanel } from '@/components/admin/CoverageRequestsPanel';
import { AdminPageShell } from '@/components/admin/AdminPageShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoverageRequestPrefill, CreateJurisdictionData } from '@/types/jurisdiction';

export default function JurisdictionAdmin() {
  const [activeTab, setActiveTab] = useState('catalog');
  const [formPrefill, setFormPrefill] = useState<Partial<CreateJurisdictionData> | null>(null);
  const [coverageRequestId, setCoverageRequestId] = useState<string | null>(null);
  const [coverageRefreshKey, setCoverageRefreshKey] = useState(0);

  const handleAddFromCoverage = (prefill: CoverageRequestPrefill) => {
    setActiveTab('catalog');
    setCoverageRequestId(prefill.coverageRequestId);
    setFormPrefill({
      name: prefill.name,
      state: prefill.state,
      city: prefill.city,
      county: prefill.county,
      notes: prefill.notes
        ? `Coverage request notes:\n${prefill.notes}`
        : 'Created from coverage request',
      data_source: 'Coverage Request',
    });
  };

  return (
    <AdminPageShell
      variant="editorial"
      title="Jurisdiction Administration"
      description="Manage jurisdiction database, fees, SLAs, coverage requests, and reviewer contacts"
      breadcrumbs={[{ label: 'Jurisdictions' }]}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="coverage">Coverage Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <JurisdictionManager
            formPrefill={formPrefill}
            onFormPrefillConsumed={() => {
              setFormPrefill(null);
              setCoverageRequestId(null);
            }}
            coverageRequestId={coverageRequestId}
            onCoverageRequestResolved={() => {
              setCoverageRefreshKey((key) => key + 1);
              setActiveTab('coverage');
            }}
          />
        </TabsContent>

        <TabsContent value="coverage">
          <CoverageRequestsPanel key={coverageRefreshKey} onAddJurisdiction={handleAddFromCoverage} />
        </TabsContent>
      </Tabs>
    </AdminPageShell>
  );
}
