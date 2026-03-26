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
import { Checkbox } from '@/components/ui/checkbox';
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

interface JurisdictionCsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

interface ParsedRow {
  state: string;
  place_name: string;
  fips_place: string;
  total_units: number;
  sf_1unit_units: number;
  duplex_units: number;
  mf_3plus_units: number;
}

interface ImportStats {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
}

export function JurisdictionCsvImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: JurisdictionCsvImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [minUnitsFilter, setMinUnitsFilter] = useState(0);

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    setImporting(false);
    setImportProgress(0);
    setImportStats(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      setParseError('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setParseError(null);
    parseCSV(selectedFile);
  };

  const parseCSV = async (csvFile: File) => {
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        setParseError('CSV file is empty or has no data rows');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      // Validate required columns
      const requiredColumns = ['state', 'place_name'];
      const missingColumns = requiredColumns.filter(col => !headers.includes(col));
      
      if (missingColumns.length > 0) {
        setParseError(`Missing required columns: ${missingColumns.join(', ')}`);
        return;
      }

      const stateIdx = headers.indexOf('state');
      const nameIdx = headers.indexOf('place_name');
      const fipsIdx = headers.indexOf('fips_place');
      const totalIdx = headers.indexOf('total_units');
      const sfIdx = headers.indexOf('sf_1unit_units');
      const duplexIdx = headers.indexOf('duplex_units');
      const mfIdx = headers.indexOf('mf_3plus_units');

      const parsed: ParsedRow[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values.length < 2) continue;

        parsed.push({
          state: values[stateIdx] || '',
          place_name: values[nameIdx] || '',
          fips_place: fipsIdx >= 0 ? values[fipsIdx] || '' : '',
          total_units: totalIdx >= 0 ? parseInt(values[totalIdx]) || 0 : 0,
          sf_1unit_units: sfIdx >= 0 ? parseInt(values[sfIdx]) || 0 : 0,
          duplex_units: duplexIdx >= 0 ? parseInt(values[duplexIdx]) || 0 : 0,
          mf_3plus_units: mfIdx >= 0 ? parseInt(values[mfIdx]) || 0 : 0,
        });
      }

      setParsedData(parsed);
    } catch (err: any) {
      setParseError(`Error parsing CSV: ${err.message}`);
    }
  };

  const filteredData = parsedData.filter(row => row.total_units >= minUnitsFilter);

  const handleImport = async () => {
    if (filteredData.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    
    const stats: ImportStats = { total: filteredData.length, imported: 0, skipped: 0, errors: 0 };
    const batchSize = 100;
    const totalBatches = Math.ceil(filteredData.length / batchSize);

    try {
      // Get existing jurisdictions to check for duplicates
      let existingNames = new Set<string>();
      
      if (skipExisting) {
        const { data: existing } = await supabase
          .from('jurisdictions')
          .select('name, state');
        
        if (existing) {
          existingNames = new Set(existing.map(j => `${j.name.toLowerCase()}-${j.state.toLowerCase()}`));
        }
      }

      for (let batch = 0; batch < totalBatches; batch++) {
        const startIdx = batch * batchSize;
        const endIdx = Math.min(startIdx + batchSize, filteredData.length);
        const batchData = filteredData.slice(startIdx, endIdx);

        const recordsToInsert = batchData
          .filter(row => {
            if (skipExisting) {
              const key = `${row.place_name.toLowerCase()}-${row.state.toLowerCase()}`;
              if (existingNames.has(key)) {
                stats.skipped++;
                return false;
              }
            }
            return true;
          })
          .map(row => ({
            name: row.place_name,
            state: row.state,
            fips_place: row.fips_place || null,
            residential_units_2024: row.total_units,
            sf_1unit_units_2024: row.sf_1unit_units,
            duplex_units_2024: row.duplex_units,
            mf_3plus_units_2024: row.mf_3plus_units,
            is_high_volume: row.total_units >= 1000,
            is_active: true,
            data_source: 'BPS 2024 CSV Import',
            base_permit_fee: 0,
            plan_review_fee: 0,
            inspection_fee: 0,
            expedited_available: false,
            expedited_fee_multiplier: 1,
            reviewer_contacts: [],
          }));

        if (recordsToInsert.length > 0) {
          const { error } = await supabase
            .from('jurisdictions')
            .insert(recordsToInsert);

          if (error) {
            console.error('Batch insert error:', error);
            stats.errors += recordsToInsert.length;
          } else {
            stats.imported += recordsToInsert.length;
          }
        }

        setImportProgress(Math.round(((batch + 1) / totalBatches) * 100));
      }

      setImportStats(stats);
      
      if (stats.imported > 0) {
        toast.success(`Successfully imported ${stats.imported.toLocaleString()} jurisdictions`);
        onImportComplete();
      }
    } catch (err: any) {
      console.error('Import error:', err);
      toast.error('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const template = 'state,place_name,fips_place,total_units,sf_1unit_units,duplex_units,mf_3plus_units\nCA,Los Angeles,12345,5000,2000,200,2800\nTX,Houston,23456,4500,3000,150,1350';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jurisdiction_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importing) { onOpenChange(o); if (!o) resetState(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Jurisdictions from CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file with jurisdiction data. Supports BPS format with permit volume data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Import Stats (after import) */}
          {importStats && (
            <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Import Complete
              </h4>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{importStats.total.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{importStats.imported.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Imported</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-600">{importStats.skipped.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Skipped (Existing)</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{importStats.errors.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
            </div>
          )}

          {/* File Upload */}
          {!file && !importStats && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">Click to upload CSV file</p>
                <p className="text-sm text-muted-foreground mt-1">
                  or drag and drop
                </p>
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

          {/* Parse Error */}
          {parseError && (
            <div className="p-4 border border-destructive/50 rounded-lg bg-destructive/10 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Error parsing file</p>
                <p className="text-sm text-destructive/80">{parseError}</p>
              </div>
            </div>
          )}

          {/* File Info & Preview */}
          {file && parsedData.length > 0 && !importStats && (
            <div className="space-y-4">
              {/* File info */}
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

              {/* Import Options */}
              <div className="flex flex-wrap gap-4 items-center p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="skip-existing"
                    checked={skipExisting}
                    onCheckedChange={(c) => setSkipExisting(!!c)}
                  />
                  <Label htmlFor="skip-existing" className="text-sm">Skip existing jurisdictions</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="min-units" className="text-sm whitespace-nowrap">Min units:</Label>
                  <select
                    id="min-units"
                    value={minUnitsFilter}
                    onChange={(e) => setMinUnitsFilter(parseInt(e.target.value))}
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

              {/* Preview Table */}
              <div className="border rounded-lg overflow-hidden">
                <ScrollArea className="h-[250px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jurisdiction</TableHead>
                        <TableHead className="text-center">State</TableHead>
                        <TableHead className="text-center">FIPS</TableHead>
                        <TableHead className="text-right">Total Units</TableHead>
                        <TableHead className="text-right">SF</TableHead>
                        <TableHead className="text-right">MF 3+</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredData.slice(0, 100).map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {row.place_name}
                            {row.total_units >= 1000 && (
                              <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-700">
                                High Vol
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">{row.state}</TableCell>
                          <TableCell className="text-center text-muted-foreground text-xs">{row.fips_place || '—'}</TableCell>
                          <TableCell className="text-right font-medium">{row.total_units.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{row.sf_1unit_units.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{row.mf_3plus_units.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {filteredData.length > 100 && (
                  <div className="p-2 text-center text-xs text-muted-foreground border-t bg-muted/30">
                    Showing first 100 of {filteredData.length.toLocaleString()} rows
                  </div>
                )}
              </div>

              {/* Import Progress */}
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
          <Button variant="outline" onClick={() => { onOpenChange(false); resetState(); }} disabled={importing}>
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
