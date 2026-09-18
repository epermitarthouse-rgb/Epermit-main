import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
  Download,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  parseJurisdictionCsv,
  csvRowsToRpcPayload,
  type JurisdictionCsvRow,
  type CsvImportMode,
} from '@/lib/jurisdictionCsvParser';
import { isMissingRpcError } from '@/lib/jurisdictionSubscriptionIntegrity';

interface JurisdictionCsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

interface ImportStats {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ place_name: string; state: string; message: string }>;
}

export function JurisdictionCsvImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: JurisdictionCsvImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<JurisdictionCsvRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [importMode, setImportMode] = useState<CsvImportMode>('skip_existing');
  const [minUnitsFilter, setMinUnitsFilter] = useState(0);

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setParseErrors([]);
    setImporting(false);
    setImportProgress(0);
    setImportStats(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      setParseErrors(['Please select a CSV file']);
      return;
    }

    setFile(selectedFile);
    setParseErrors([]);
    void parseCSV(selectedFile);
  };

  const parseCSV = async (csvFile: File) => {
    try {
      const text = await csvFile.text();
      const result = parseJurisdictionCsv(text);
      setParsedData(result.rows);
      setParseErrors(result.errors);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parse error';
      setParseErrors([`Error parsing CSV: ${message}`]);
    }
  };

  const filteredData = parsedData.filter((row) => row.total_units >= minUnitsFilter);

  const handleImport = async () => {
    if (filteredData.length === 0) return;

    setImporting(true);
    setImportProgress(0);

    const batchSize = 100;
    const totalBatches = Math.ceil(filteredData.length / batchSize);
    const aggregate: ImportStats = {
      total: filteredData.length,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
    };

    try {
      for (let batch = 0; batch < totalBatches; batch++) {
        const batchRows = filteredData.slice(batch * batchSize, batch * batchSize + batchSize);
        const { data, error } = await supabase.rpc('bulk_upsert_jurisdiction_volume', {
          p_rows: csvRowsToRpcPayload(batchRows),
          p_mode: importMode,
        });

        if (error) {
          if (isMissingRpcError(error)) {
            toast.error('CSV import RPC is not deployed yet. Apply the latest migration first.');
            break;
          }
          throw error;
        }

        aggregate.imported += Number(data?.imported ?? 0);
        aggregate.updated += Number(data?.updated ?? 0);
        aggregate.skipped += Number(data?.skipped ?? 0);
        const batchErrors = Array.isArray(data?.errors) ? data.errors : [];
        aggregate.errors += Number(data?.error_count ?? batchErrors.length);
        aggregate.errorDetails.push(
          ...batchErrors.map((entry: { place_name?: string; state?: string; message?: string }) => ({
            place_name: entry.place_name ?? '',
            state: entry.state ?? '',
            message: entry.message ?? 'Unknown error',
          })),
        );

        setImportProgress(Math.round(((batch + 1) / totalBatches) * 100));
      }

      setImportStats(aggregate);

      if (aggregate.imported + aggregate.updated > 0) {
        toast.success(
          `Import complete: ${aggregate.imported} added, ${aggregate.updated} updated, ${aggregate.skipped} skipped`,
        );
        onImportComplete();
      } else if (aggregate.errors > 0) {
        toast.error(`Import finished with ${aggregate.errors} error(s)`);
      } else {
        toast.message('No rows imported', {
          description: `${aggregate.skipped} existing row(s) were skipped.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      console.error('Import error:', err);
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const template =
      'state,place_name,fips_place,total_units,sf_1unit_units,duplex_units,mf_3plus_units\n' +
      'CA,"Los Angeles, City",12345,5000,2000,200,2800\n' +
      'TX,Houston,23456,4500,3000,150,1350';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jurisdiction_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!importing) {
          onOpenChange(o);
          if (!o) resetState();
        }
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Jurisdictions from CSV
          </DialogTitle>
          <DialogDescription>
            Upload BPS-style CSV data. Server-side import avoids loading the full catalog in the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {importStats && (
            <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Import Complete
              </h4>
              <div className="grid grid-cols-5 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{importStats.total.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{importStats.imported.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Imported</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">{importStats.updated.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-600">{importStats.skipped.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{importStats.errors.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
              {importStats.errorDetails.length > 0 && (
                <ScrollArea className="h-24 mt-2">
                  <ul className="text-xs text-destructive space-y-1">
                    {importStats.errorDetails.slice(0, 20).map((err, idx) => (
                      <li key={idx}>
                        {err.place_name || 'Unknown'} ({err.state || '??'}): {err.message}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>
          )}

          {!file && !importStats && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">Click to upload CSV file</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button variant="outline" onClick={downloadTemplate} className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Download Template CSV
              </Button>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="p-4 border border-destructive/50 rounded-lg bg-destructive/10 space-y-2">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">CSV parse issues</p>
                  <ul className="text-sm text-destructive/80 list-disc pl-4">
                    {parseErrors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {file && parsedData.length > 0 && !importStats && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {parsedData.length.toLocaleString()} rows parsed
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={resetState}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-4 items-center p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Label htmlFor="import-mode" className="text-sm whitespace-nowrap">
                    Existing rows:
                  </Label>
                  <select
                    id="import-mode"
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as CsvImportMode)}
                    className="px-2 py-1 border rounded text-sm"
                  >
                    <option value="skip_existing">Skip</option>
                    <option value="upsert_volume">Update volume data</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="min-units" className="text-sm whitespace-nowrap">
                    Min units:
                  </Label>
                  <select
                    id="min-units"
                    value={minUnitsFilter}
                    onChange={(e) => setMinUnitsFilter(parseInt(e.target.value, 10))}
                    className="px-2 py-1 border rounded text-sm"
                  >
                    <option value={0}>All</option>
                    <option value={10}>10+</option>
                    <option value={50}>50+</option>
                    <option value={100}>100+</option>
                    <option value={500}>500+</option>
                    <option value={1000}>1,000+</option>
                  </select>
                </div>
                <Badge variant="secondary" className="ml-auto">
                  {filteredData.length.toLocaleString()} to import
                </Badge>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <ScrollArea className="h-[250px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jurisdiction</TableHead>
                        <TableHead className="text-center">State</TableHead>
                        <TableHead className="text-center">FIPS</TableHead>
                        <TableHead className="text-right">Total Units</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredData.slice(0, 100).map((row) => (
                        <TableRow key={`${row.state}-${row.place_name}-${row.lineNumber}`}>
                          <TableCell className="font-medium">
                            {row.place_name}
                            {row.total_units >= 1000 && (
                              <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-700">
                                High Vol
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">{row.state}</TableCell>
                          <TableCell className="text-center text-muted-foreground text-xs">
                            {row.fips_place || '—'}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {row.total_units.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>

              {importing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Importing...</span>
                    <span>{importProgress}%</span>
                  </div>
                  <Progress value={importProgress} />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetState();
            }}
            disabled={importing}
          >
            {importStats ? 'Close' : 'Cancel'}
          </Button>
          {!importStats && file && parsedData.length > 0 && (
            <Button onClick={handleImport} disabled={importing || filteredData.length === 0}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import {filteredData.length.toLocaleString()} Jurisdictions
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
