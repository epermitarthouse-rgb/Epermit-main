import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PgcStatusSegment =
  | { type: "text"; value: string }
  | {
      type: "link";
      text: string;
      href?: string;
      target?: string;
      onclick?: string;
    };

export type PgcStatusSection =
  | {
      type: "kv_list";
      title?: string;
      classHint?: string;
      items: Array<{
        key: string;
        valueText?: string;
        segments?: PgcStatusSegment[];
        emphasized?: boolean;
      }>;
    }
  | {
      type: "table";
      title?: string;
      classHint?: string;
      headers: string[];
      rows: Record<string, string>[];
      rowCells?: Array<
        Array<{
          text: string;
          segments?: PgcStatusSegment[];
          emphasized?: boolean;
        }>
      >;
    }
  | {
      type: "task_list";
      title?: string;
      classHint?: string;
      items: Array<{
        text: string;
        segments?: PgcStatusSegment[];
        emphasized?: boolean;
      }>;
    }
  | {
      type: "links";
      title?: string;
      classHint?: string;
      links: Array<{
        text: string;
        href?: string;
        target?: string;
        onclick?: string;
      }>;
    }
  | {
      type: "text_block";
      title?: string;
      classHint?: string;
      segments?: PgcStatusSegment[];
    }
  | { type: "divider"; classHint?: string };

export interface PgcStatusTabData {
  sections?: PgcStatusSection[];
  keyValues?: { key: string; value: string }[];
  tables?: {
    headers: string[];
    rows: Record<string, string>[];
    title?: string;
  }[];
  links?: { text: string; href?: string; target?: string; onclick?: string }[];
  meta?: Record<string, unknown>;
  error?: string;
}

function renderStatusInlineLink(
  s: {
    text: string;
    href?: string;
    target?: string;
    onclick?: string;
  },
  key: string,
) {
  const h = (s.href ?? "").trim();
  if (h) {
    return (
      <a
        key={key}
        href={h}
        target={s.target || "_blank"}
        rel="noopener noreferrer"
        className="text-gold underline decoration-gold/40 hover:text-gold-deep hover:decoration-gold-deep"
      >
        {s.text}
      </a>
    );
  }
  if ((s.onclick ?? "").trim()) {
    return (
      <span
        key={key}
        className="text-gold underline decoration-dotted decoration-gold/50 cursor-help"
        title={s.onclick}
      >
        {s.text}
      </span>
    );
  }
  return <span key={key}>{s.text}</span>;
}

function renderSegments(
  segments: PgcStatusSegment[] | undefined,
  keyBase: string,
  emphasized?: boolean,
) {
  if (!segments?.length) return null;
  const emphasisClass = emphasized ? "text-destructive font-medium" : "";
  return (
    <span className={emphasisClass}>
      {segments.map((s, i) => {
        if (s.type === "link") {
          return renderStatusInlineLink(s, `${keyBase}-l-${i}`);
        }
        const parts = String(s.value).split("\n");
        return parts.map((line, li) => (
          <React.Fragment key={`${keyBase}-t-${i}-${li}`}>
            {li > 0 ? <br /> : null}
            {line}
          </React.Fragment>
        ));
      })}
    </span>
  );
}

function LegacyKeyValues({
  keyValues,
}: {
  keyValues: { key: string; value: string }[];
}) {
  return (
    <div className="rounded-xl border border-cream-sunken bg-cream shadow-cream overflow-hidden">
      {keyValues.map((kv, i) => (
        <div
          key={`${kv.key}-${i}`}
          className={`grid grid-cols-[minmax(140px,1fr)_2fr] gap-2 border-t border-cream-sunken px-3 py-2 text-left first:border-t-0 ${
            i % 2 === 0 ? "bg-cream" : "bg-cream-raised/40"
          }`}
        >
          <div className="font-medium text-ink-primary-light">{kv.key}</div>
          <div className="text-ink-primary-light">{kv.value || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function LegacyTables({
  tables,
}: {
  tables: {
    headers: string[];
    rows: Record<string, string>[];
    title?: string;
  }[];
}) {
  return (
    <div className="space-y-4">
      {tables.map((tbl, ti) => (
        <div key={ti}>
          {tbl.title ? (
            <p className="mb-2 font-semibold text-ink-primary-light">{tbl.title}</p>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-cream-sunken bg-cream">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-cream-sunken bg-cream hover:bg-cream">
                  {tbl.headers?.map((h, hi) => (
                    <TableHead
                      key={hi}
                      className="text-[10px] font-mono uppercase tracking-[0.12em] text-ink-tertiary-light font-normal border-r border-cream-sunken last:border-r-0"
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tbl.rows?.map((row, ri) => (
                  <TableRow
                    key={ri}
                    className={
                      ri % 2 === 1
                        ? "bg-cream-raised/35 border-t border-cream-sunken hover:bg-cream-raised/55"
                        : "bg-cream border-t border-cream-sunken hover:bg-cream-raised/50"
                    }
                  >
                    {tbl.headers?.map((h) => (
                      <TableCell
                        key={h}
                        className="border-r border-cream-sunken last:border-r-0 text-ink-primary-light"
                      >
                        {row[h] ?? ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionBlock({
  section,
  index,
}: {
  section: PgcStatusSection;
  index: number;
}) {
  if (section.type === "divider") {
    return <hr className="my-4 border-cream-sunken" />;
  }
  if (section.type === "text_block") {
    return (
      <div className="mb-3" data-section-index={index}>
        {section.title ? (
          <h3 className="mb-1 text-base font-semibold text-ink-primary-light">
            {section.title}
          </h3>
        ) : null}
        <div className="whitespace-pre-wrap text-ink-primary-light">
          {renderSegments(section.segments, `tb-${index}`, false)}
        </div>
      </div>
    );
  }
  if (section.type === "links") {
    return (
      <div className="mb-4" data-section-index={index}>
        {section.title ? (
          <p className="mb-1 font-semibold text-ink-primary-light">{section.title}</p>
        ) : null}
        <ul className="list-none space-y-1 pl-0">
          {section.links.map((L, li) => (
            <li key={li}>
              {renderStatusInlineLink(
                {
                  text: L.text || (L.href ?? "").trim() || "link",
                  href: L.href,
                  target: L.target,
                  onclick: L.onclick,
                },
                `sec-links-${index}-${li}`,
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (section.type === "kv_list") {
    return (
      <div className="mb-4" data-section-index={index}>
        {section.title ? (
          <p className="mb-2 font-semibold text-ink-primary-light">{section.title}</p>
        ) : null}
        <div className="border border-cream-sunken rounded-xl bg-cream shadow-cream overflow-hidden">
          {section.items.map((it, ii) => (
            <div
              key={ii}
              className={`grid grid-cols-[minmax(160px,1fr)_2fr] gap-2 border-t border-cream-sunken px-3 py-2 first:border-t-0 ${
                ii % 2 === 0 ? "bg-cream" : "bg-cream-raised/40"
              }`}
            >
              <div className="font-medium text-ink-primary-light">{it.key}</div>
              <div
                className={
                  it.emphasized ? "text-destructive font-medium" : "text-ink-primary-light"
                }
              >
                {it.segments?.length
                  ? renderSegments(
                      it.segments,
                      `kv-${index}-${ii}`,
                      it.emphasized,
                    )
                  : it.valueText || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (section.type === "task_list") {
    return (
      <div className="mb-4" data-section-index={index}>
        {section.title ? (
          <p className="mb-2 font-semibold text-ink-primary-light">{section.title}</p>
        ) : null}
        <ul className="list-disc space-y-1 pl-6 text-ink-primary-light">
          {section.items.map((it, ii) => (
            <li
              key={ii}
              className={
                it.emphasized ? "text-destructive font-medium marker:text-destructive" : ""
              }
            >
              {it.segments?.length
                ? renderSegments(
                    it.segments,
                    `tl-${index}-${ii}`,
                    it.emphasized,
                  )
                : it.text}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (section.type === "table") {
    const rich = section.rowCells;
    return (
      <div className="mb-4" data-section-index={index}>
        {section.title ? (
          <p className="mb-2 font-semibold text-ink-primary-light">{section.title}</p>
        ) : null}
        <div className="overflow-x-auto rounded-xl border border-cream-sunken bg-cream shadow-cream">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-cream-sunken bg-cream hover:bg-cream">
                {section.headers?.map((h, hi) => (
                  <TableHead
                    key={hi}
                    className="text-[10px] font-mono uppercase tracking-[0.12em] text-ink-tertiary-light font-normal border-r border-cream-sunken last:border-r-0"
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows?.map((row, ri) => (
                <TableRow
                  key={ri}
                  className={
                    ri % 2 === 1
                      ? "bg-cream-raised/35 border-t border-cream-sunken hover:bg-cream-raised/55"
                      : "bg-cream border-t border-cream-sunken hover:bg-cream-raised/50"
                  }
                >
                  {section.headers?.map((h, hi) => {
                    const cell = rich?.[ri]?.[hi];
                    return (
                      <TableCell
                        key={h}
                        className={`border-r border-cream-sunken last:border-r-0 align-top ${
                          cell?.emphasized
                            ? "text-destructive font-medium"
                            : "text-ink-primary-light"
                        }`}
                      >
                        {cell?.segments?.length
                          ? renderSegments(
                              cell.segments,
                              `cell-${index}-${ri}-${hi}`,
                              cell.emphasized,
                            )
                          : row[h] ?? ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }
  return null;
}

export function PgcStatusTab({ status }: { status: PgcStatusTabData }) {
  const sections = status.sections;
  const hasSections = Array.isArray(sections) && sections.length > 0;
  const hasLegacy =
    (status.keyValues?.length ?? 0) > 0 || (status.tables?.length ?? 0) > 0;

  return (
    <div className="pgc-status-portal max-w-2xl mx-auto w-full rounded-xl border border-cream-sunken bg-cream-raised px-6 py-8 text-[13px] leading-relaxed text-ink-primary-light shadow-cream">
      {hasSections ? (
        <div className="space-y-1">
          {sections!.map((sec, i) => (
            <SectionBlock key={i} section={sec} index={i} />
          ))}
        </div>
      ) : null}
      {!hasSections && hasLegacy ? (
        <div className="space-y-4">
          {status.keyValues && status.keyValues.length > 0 ? (
            <LegacyKeyValues keyValues={status.keyValues} />
          ) : null}
          {status.tables && status.tables.length > 0 ? (
            <LegacyTables tables={status.tables} />
          ) : null}
        </div>
      ) : null}
      {!hasSections && !hasLegacy ? (
        <p className="text-center text-ink-tertiary-light">No status data available.</p>
      ) : null}
      {!hasSections && status.links && status.links.length > 0 ? (
        <div className="mt-6 border-t border-cream-sunken pt-4">
          <p className="mb-2 font-semibold text-ink-primary-light">Links</p>
          <ul className="list-none space-y-1">
            {status.links.map((L, i) => (
              <li key={i}>
                {renderStatusInlineLink(
                  {
                    text: L.text || (L.href ?? "").trim() || "link",
                    href: L.href,
                    target: L.target,
                    onclick: L.onclick,
                  },
                  `flat-links-${i}`,
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
