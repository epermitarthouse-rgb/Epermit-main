import { useState } from 'react';
import { FileText, Download, Database, Server, Route, Code, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { mvpDocumentationData } from '@/lib/mvpDocumentationData';
import { exportMVPDocumentationPDF } from '@/lib/mvpDocumentationPDF';
import { toast } from 'sonner';

const MVPDocumentation = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<{
    fileName: string;
    pageCount: number;
    tableCount: number;
    functionCount: number;
    routeCount: number;
  } | null>(null);

  const data = mvpDocumentationData;

  const handleExportPDF = async () => {
    setIsGenerating(true);
    try {
      // Small delay to show loading state
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = exportMVPDocumentationPDF();
      setGenerationResult(result);
      toast.success(`PDF generated successfully: ${result.fileName}`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const stats = [
    { icon: Database, label: 'Database Tables', value: data.tables.length, color: 'text-blue-600' },
    { icon: Server, label: 'Edge Functions', value: data.edgeFunctions.length, color: 'text-green-600' },
    { icon: Route, label: 'Application Routes', value: data.routes.length, color: 'text-purple-600' },
    { icon: Code, label: 'Custom Hooks', value: data.hooks.length, color: 'text-orange-600' },
  ];

  const sections = [
    { title: 'Application Overview', items: ['Purpose & value propositions', 'Target users', 'Live URL'] },
    { title: 'Technology Stack', items: data.techStack.map(t => t.category) },
    { title: 'Application Routes', items: [`${data.routes.filter(r => !r.authRequired).length} public`, `${data.routes.filter(r => r.authRequired).length} protected`] },
    { title: 'Database Schema', items: data.tables.slice(0, 5).map(t => t.name).concat(['...and more']) },
    { title: 'Edge Functions', items: data.edgeFunctions.slice(0, 5).map(f => f.name).concat(['...and more']) },
    { title: 'Feature Specifications', items: data.features.map(f => f.category) },
    { title: 'Subscription Tiers', items: data.subscriptionTiers.map(t => t.name) },
    { title: 'TypeScript Enums', items: data.enums.slice(0, 5).map(e => e.name).concat(['...and more']) },
    { title: 'Custom React Hooks', items: data.hooks.slice(0, 5).map(h => h.name).concat(['...and more']) },
    { title: 'Key Components', items: data.components.map(c => c.category) },
    { title: 'Security (RLS Policies)', items: ['Function-based access control', 'Project isolation', 'Role-based permissions'] },
  ];

  return (
    <>
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">MVP Documentation Export</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Generate a comprehensive PDF document containing all technical specifications, database schema, features, and architecture details of the {data.appName} MVP.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {stats.map((stat) => (
            <Card key={stat.label} className="text-center">
              <CardContent className="pt-6">
                <stat.icon className={`h-8 w-8 mx-auto mb-2 ${stat.color}`} />
                <div className="text-3xl font-bold text-foreground">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Export Button */}
        <Card className="mb-8 border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <FileText className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-foreground">Generate PDF Documentation</h3>
                  <p className="text-sm text-muted-foreground">
                    Download a complete technical specification document (~30-40 pages)
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                onClick={handleExportPDF}
                disabled={isGenerating}
                className="min-w-[200px]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="h-5 w-5 mr-2" />
                    Download PDF
                  </>
                )}
              </Button>
            </div>

            {generationResult && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">PDF Generated Successfully!</span>
                </div>
                <div className="mt-2 text-sm text-green-600 dark:text-green-500">
                  <p>File: {generationResult.fileName}</p>
                  <p>Pages: {generationResult.pageCount} • Tables: {generationResult.tableCount} • Functions: {generationResult.functionCount} • Routes: {generationResult.routeCount}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Document Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Document Contents Preview</CardTitle>
            <CardDescription>
              The generated PDF will include the following sections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map((section, index) => (
                <div
                  key={section.title}
                  className="p-4 border rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">
                      {index + 1}
                    </Badge>
                    <h4 className="font-medium text-foreground">{section.title}</h4>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {section.items.map((item, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* App Info */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            <strong>{data.appName}</strong> • {data.version}
          </p>
          <p className="mt-1">{data.tagline}</p>
        </div>
      </div>
    </>
  );
};

export default MVPDocumentation;
