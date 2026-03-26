import { useState, useMemo, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { BaltimoreRecordHeader } from "@/components/baltimore/BaltimoreRecordHeader";
import {
  BaltimoreRecordTabBar,
  BALTIMORE_MINIMAL_SECTIONS_UI,
  type DetailPanel,
} from "@/components/baltimore/BaltimoreRecordTabBar";
import { BaltimoreDetailSection } from "@/components/baltimore/BaltimoreDetailSection";
import { BaltimoreInfoGrid } from "@/components/baltimore/BaltimoreInfoGrid";
import { BaltimorePanelTable } from "@/components/baltimore/BaltimorePanelTable";
import { getBaltimoreRecordDetail } from "@/data/baltimorePortalMock";

export default function BaltimoreRecordDetailPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const [activePanel, setActivePanel] = useState<DetailPanel>("record_details");
  const showFullSections = !BALTIMORE_MINIMAL_SECTIONS_UI;

  const record = useMemo(() => {
    if (!recordId) return null;
    return getBaltimoreRecordDetail(recordId);
  }, [recordId]);

  useEffect(() => {
    if (!BALTIMORE_MINIMAL_SECTIONS_UI) return;
    if (activePanel !== "record_details" && activePanel !== "attachments") {
      setActivePanel("record_details");
    }
  }, [activePanel]);

  if (!recordId) {
    return (
      <BaltimoreLayout activeModule="permits" permitsSubActive="search">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Missing record ID.
          </CardContent>
        </Card>
      </BaltimoreLayout>
    );
  }

  if (!record) {
    return (
      <BaltimoreLayout activeModule="permits" permitsSubActive="search">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Record not found.
          </CardContent>
        </Card>
      </BaltimoreLayout>
    );
  }

  return (
    <BaltimoreLayout activeModule="permits" permitsSubActive="search">
      <div className="space-y-6">
        <BaltimoreRecordHeader record={record} />

        <Card>
          <BaltimoreRecordTabBar
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            minimalSections={BALTIMORE_MINIMAL_SECTIONS_UI}
          />
          <CardContent className="min-h-[200px] pt-6">
            {activePanel === "record_details" && (
              <BaltimoreDetailSection title="Record Details">
                <div className="space-y-4">
                  {record.workLocation && (
                    <div>
                      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                        Work Location
                      </h4>
                      <BaltimoreInfoGrid
                        items={[
                          ["Address", record.workLocation.address],
                          [
                            "City, State ZIP",
                            `${record.workLocation.city}, ${record.workLocation.state} ${record.workLocation.zip}`,
                          ],
                        ]}
                      />
                    </div>
                  )}
                  {record.recordDetails &&
                    Object.keys(record.recordDetails).length > 0 && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                          Record Details
                        </h4>
                        <BaltimoreInfoGrid
                          items={Object.entries(record.recordDetails)}
                        />
                      </div>
                    )}
                  {record.applicant?.name && (
                    <div>
                      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                        Applicant
                      </h4>
                      <BaltimoreInfoGrid
                        items={[
                          ["Name", record.applicant.name],
                          [
                            "Contact",
                            record.applicant.contact ?? "—",
                          ],
                        ]}
                      />
                    </div>
                  )}
                  {record.licensedProfessional?.name && (
                    <div>
                      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                        Licensed Professional
                      </h4>
                      <BaltimoreInfoGrid
                        items={[
                          ["Name", record.licensedProfessional.name],
                          [
                            "License Type",
                            record.licensedProfessional.licenseType ?? "—",
                          ],
                        ]}
                      />
                    </div>
                  )}
                  {record.description && (
                    <div>
                      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                        Description
                      </h4>
                      <p className="text-sm text-[#333]">
                        {record.description}
                      </p>
                    </div>
                  )}
                  {record.owner &&
                    Object.keys(record.owner).length > 0 && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                          Owner / Metadata
                        </h4>
                        <BaltimoreInfoGrid
                          items={Object.entries(record.owner)}
                        />
                      </div>
                    )}
                </div>
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "processing_status" && (
              <BaltimoreDetailSection title="Processing Status">
                <BaltimorePanelTable
                  columns={[
                    {
                      key: "department",
                      header: "Department",
                      render: (r) => r.department as string,
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (r) => r.status as string,
                    },
                    {
                      key: "date",
                      header: "Date",
                      render: (r) => (r.date as string) ?? "—",
                    },
                    {
                      key: "comment",
                      header: "Comment",
                      render: (r) => (r.comment as string) ?? "—",
                    },
                  ]}
                  data={record.processingStatus ?? []}
                  emptyMessage="No processing status data."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "related_records" && (
              <BaltimoreDetailSection title="Related Records">
                <BaltimorePanelTable
                  columns={[
                    {
                      key: "recordNumber",
                      header: "Record Number",
                      render: (r) => (
                        <Link
                          to={`/baltimore/records/${encodeURIComponent(r.recordId as string)}`}
                          className="text-primary hover:underline"
                        >
                          {r.recordNumber as string}
                        </Link>
                      ),
                    },
                    {
                      key: "type",
                      header: "Type",
                      render: (r) => (r.type as string) ?? "—",
                    },
                  ]}
                  data={record.relatedRecords ?? []}
                  emptyMessage="No related records."
                />
              </BaltimoreDetailSection>
            )}

            {activePanel === "attachments" && (
              <BaltimoreDetailSection title="Attachments">
                <BaltimorePanelTable
                  columns={[
                    {
                      key: "name",
                      header: "File Name",
                      render: (r) => r.name as string,
                    },
                    {
                      key: "type",
                      header: "Type",
                      render: (r) => r.type as string,
                    },
                    {
                      key: "uploadedDate",
                      header: "Uploaded",
                      render: (r) =>
                        (r.uploadedDate as string) ?? "—",
                    },
                    {
                      key: "action",
                      header: "Action",
                      render: (r) => (
                        <span className="cursor-pointer text-primary">
                          {(r.actionLabel as string) || "View"}
                        </span>
                      ),
                    },
                  ]}
                  data={record.attachments ?? []}
                  emptyMessage="No attachments."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "inspections" && (
              <BaltimoreDetailSection title="Inspections">
                <BaltimorePanelTable
                  columns={[
                    {
                      key: "type",
                      header: "Type",
                      render: (r) => r.type as string,
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (r) => r.status as string,
                    },
                    {
                      key: "scheduledDate",
                      header: "Scheduled",
                      render: (r) =>
                        (r.scheduledDate as string) ?? "—",
                    },
                    {
                      key: "completedDate",
                      header: "Completed",
                      render: (r) =>
                        (r.completedDate as string) ?? "—",
                    },
                    {
                      key: "inspector",
                      header: "Inspector",
                      render: (r) =>
                        (r.inspector as string) ?? "—",
                    },
                  ]}
                  data={record.inspections ?? []}
                  emptyMessage="No inspections."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "fees" && (
              <BaltimoreDetailSection title="Fees">
                <BaltimorePanelTable
                  columns={[
                    {
                      key: "name",
                      header: "Fee",
                      render: (r) => r.name as string,
                    },
                    {
                      key: "amount",
                      header: "Amount",
                      render: (r) => r.amount as string,
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (r) => r.status as string,
                    },
                    {
                      key: "dueDate",
                      header: "Due Date",
                      render: (r) => (r.dueDate as string) ?? "—",
                    },
                  ]}
                  data={record.fees ?? []}
                  emptyMessage="No fees."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "plan_review" && (
              <BaltimoreDetailSection title="Plan Review">
                <BaltimorePanelTable
                  columns={[
                    {
                      key: "discipline",
                      header: "Discipline",
                      render: (r) => r.discipline as string,
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (r) => r.status as string,
                    },
                    {
                      key: "reviewer",
                      header: "Reviewer",
                      render: (r) => (r.reviewer as string) ?? "—",
                    },
                    {
                      key: "completedDate",
                      header: "Completed",
                      render: (r) =>
                        (r.completedDate as string) ?? "—",
                    },
                  ]}
                  data={record.planReview ?? []}
                  emptyMessage="No plan review data."
                />
              </BaltimoreDetailSection>
            )}
          </CardContent>
        </Card>
      </div>
    </BaltimoreLayout>
  );
}
