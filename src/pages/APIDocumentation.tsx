import { useState } from 'react';
import { Copy, Check, Lock, Unlock, ChevronDown, ChevronRight, Search, Code2, Server, Zap, Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiEndpoints, categoryLabels, APIEndpoint } from '@/lib/apiDocumentationData';
import { exportAPIDocumentationPDF } from '@/lib/apiDocumentationPDF';
import { toast } from 'sonner';

const APIDocumentation = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const result = await exportAPIDocumentationPDF();
      toast.success(`PDF downloaded: ${result.fileName}`);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Failed to export PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const filteredEndpoints = apiEndpoints.filter(endpoint => {
    const matchesSearch = searchQuery === '' || 
      endpoint.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      endpoint.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || endpoint.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const groupedEndpoints = filteredEndpoints.reduce((acc, endpoint) => {
    if (!acc[endpoint.category]) acc[endpoint.category] = [];
    acc[endpoint.category].push(endpoint);
    return acc;
  }, {} as Record<string, APIEndpoint[]>);

  const toggleEndpoint = (name: string) => {
    const newExpanded = new Set(expandedEndpoints);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedEndpoints(newExpanded);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const generateCurlExample = (endpoint: APIEndpoint) => {
    const baseUrl = 'https://lsdkbdbzgohblonzgwhr.supabase.co';
    const url = `${baseUrl}${endpoint.path}`;
    
    let curl = `curl -X ${endpoint.method} "${url}"`;
    
    if (endpoint.authRequired) {
      curl += ` \\\n  -H "Authorization: Bearer YOUR_JWT_TOKEN"`;
    }
    curl += ` \\\n  -H "apikey: YOUR_ANON_KEY"`;
    curl += ` \\\n  -H "Content-Type: application/json"`;
    
    if (endpoint.requestBody && endpoint.method !== 'GET') {
      curl += ` \\\n  -d '${JSON.stringify(endpoint.requestBody.example, null, 2)}'`;
    }
    
    return curl;
  };

  const generateJsExample = (endpoint: APIEndpoint) => {
    let code = `import { supabase } from '@/lib/supabase';\n\n`;
    
    if (endpoint.requestBody) {
      code += `const response = await supabase.functions.invoke('${endpoint.path.split('/').pop()}', {\n`;
      code += `  body: ${JSON.stringify(endpoint.requestBody.example, null, 2).split('\n').join('\n  ')}\n`;
      code += `});\n\n`;
    } else {
      code += `const response = await supabase.functions.invoke('${endpoint.path.split('/').pop()}');\n\n`;
    }
    
    code += `if (response.error) {\n`;
    code += `  console.error('Error:', response.error);\n`;
    code += `} else {\n`;
    code += `  console.log('Success:', response.data);\n`;
    code += `}`;
    
    return code;
  };

  const MethodBadge = ({ method }: { method: string }) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      POST: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      PUT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
      DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    return <Badge className={`font-mono text-xs ${colors[method]}`}>{method}</Badge>;
  };

  const CodeBlock = ({ code, id }: { code: string; id: string }) => (
    <div className="relative">
      <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-sm overflow-x-auto">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 text-slate-400 hover:text-slate-100"
        onClick={() => copyToClipboard(code, id)}
      >
        {copiedCode === id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );

  return (
    <>
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Server className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-3xl font-bold text-foreground">API Documentation</h1>
            </div>
            <Button onClick={handleExportPDF} disabled={isExporting}>
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </>
              )}
            </Button>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Complete reference for all edge functions. Each endpoint includes authentication requirements,
            request/response schemas, and code examples.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-foreground">{apiEndpoints.length}</div>
              <div className="text-sm text-muted-foreground">Total Endpoints</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-foreground">
                {apiEndpoints.filter(e => e.authRequired).length}
              </div>
              <div className="text-sm text-muted-foreground">Protected</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-foreground">
                {apiEndpoints.filter(e => !e.authRequired).length}
              </div>
              <div className="text-sm text-muted-foreground">Public</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-foreground">
                {Object.keys(categoryLabels).length}
              </div>
              <div className="text-sm text-muted-foreground">Categories</div>
            </CardContent>
          </Card>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search endpoints..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Button>
            {Object.entries(categoryLabels).map(([key, { label }]) => (
              <Button
                key={key}
                variant={selectedCategory === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {/* Base URL */}
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary" />
              <span className="font-medium">Base URL:</span>
              <code className="bg-muted px-2 py-1 rounded text-xs">
                https://lsdkbdbzgohblonzgwhr.supabase.co
              </code>
            </div>
          </CardContent>
        </Card>

        {/* Endpoints */}
        <div className="space-y-6">
          {Object.entries(groupedEndpoints).map(([category, endpoints]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-4">
                <Badge className={categoryLabels[category]?.color}>
                  {categoryLabels[category]?.label}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {categoryLabels[category]?.description}
                </span>
              </div>

              <div className="space-y-3">
                {endpoints.map((endpoint) => (
                  <Collapsible
                    key={endpoint.name}
                    open={expandedEndpoints.has(endpoint.name)}
                    onOpenChange={() => toggleEndpoint(endpoint.name)}
                  >
                    <Card className="overflow-hidden">
                      <CollapsibleTrigger className="w-full">
                        <CardHeader className="py-4 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {expandedEndpoints.has(endpoint.name) ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <MethodBadge method={endpoint.method} />
                              <code className="text-sm font-mono text-foreground">
                                {endpoint.path}
                              </code>
                              {endpoint.authRequired ? (
                                <Lock className="h-4 w-4 text-yellow-600" />
                              ) : (
                                <Unlock className="h-4 w-4 text-green-600" />
                              )}
                            </div>
                            <span className="text-sm text-muted-foreground hidden md:block">
                              {endpoint.name}
                            </span>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <CardContent className="pt-0 pb-6">
                          <div className="border-t pt-4">
                            <p className="text-muted-foreground mb-4">{endpoint.description}</p>

                            <div className="flex items-center gap-2 mb-4">
                              <Badge variant={endpoint.authRequired ? 'default' : 'secondary'}>
                                {endpoint.authRequired ? 'Authentication Required' : 'Public'}
                              </Badge>
                            </div>

                            <Tabs defaultValue="request" className="w-full">
                              <TabsList className="mb-4">
                                <TabsTrigger value="request">Request</TabsTrigger>
                                <TabsTrigger value="response">Response</TabsTrigger>
                                <TabsTrigger value="examples">
                                  <Code2 className="h-4 w-4 mr-1" />
                                  Code Examples
                                </TabsTrigger>
                              </TabsList>

                              <TabsContent value="request">
                                {endpoint.requestBody ? (
                                  <div className="space-y-4">
                                    <h4 className="font-medium text-sm">Request Body</h4>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="border-b">
                                            <th className="text-left py-2 pr-4">Field</th>
                                            <th className="text-left py-2 pr-4">Type</th>
                                            <th className="text-left py-2 pr-4">Required</th>
                                            <th className="text-left py-2">Description</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {endpoint.requestBody.fields.map((field) => (
                                            <tr key={field.name} className="border-b">
                                              <td className="py-2 pr-4">
                                                <code className="text-xs bg-muted px-1 rounded">{field.name}</code>
                                              </td>
                                              <td className="py-2 pr-4 text-muted-foreground">{field.type}</td>
                                              <td className="py-2 pr-4">
                                                {field.required ? (
                                                  <Badge variant="destructive" className="text-xs">Required</Badge>
                                                ) : (
                                                  <Badge variant="secondary" className="text-xs">Optional</Badge>
                                                )}
                                              </td>
                                              <td className="py-2 text-muted-foreground">{field.description}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div>
                                      <h5 className="text-sm font-medium mb-2">Example</h5>
                                      <CodeBlock
                                        code={JSON.stringify(endpoint.requestBody.example, null, 2)}
                                        id={`${endpoint.name}-request`}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-muted-foreground text-sm">No request body required</p>
                                )}
                              </TabsContent>

                              <TabsContent value="response">
                                <div className="space-y-4">
                                  <h4 className="font-medium text-sm">Response Body (200 OK)</h4>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b">
                                          <th className="text-left py-2 pr-4">Field</th>
                                          <th className="text-left py-2 pr-4">Type</th>
                                          <th className="text-left py-2">Description</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {endpoint.responseBody.fields.map((field) => (
                                          <tr key={field.name} className="border-b">
                                            <td className="py-2 pr-4">
                                              <code className="text-xs bg-muted px-1 rounded">{field.name}</code>
                                            </td>
                                            <td className="py-2 pr-4 text-muted-foreground">{field.type}</td>
                                            <td className="py-2 text-muted-foreground">{field.description}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div>
                                    <h5 className="text-sm font-medium mb-2">Example Response</h5>
                                    <CodeBlock
                                      code={JSON.stringify(endpoint.responseBody.example, null, 2)}
                                      id={`${endpoint.name}-response`}
                                    />
                                  </div>

                                  {endpoint.errorResponses && endpoint.errorResponses.length > 0 && (
                                    <div>
                                      <h5 className="text-sm font-medium mb-2">Error Responses</h5>
                                      <div className="space-y-2">
                                        {endpoint.errorResponses.map((err, i) => (
                                          <div key={i} className="flex items-center gap-2 text-sm">
                                            <Badge variant="destructive" className="text-xs">{err.status}</Badge>
                                            <span className="text-muted-foreground">{err.message}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {endpoint.notes && endpoint.notes.length > 0 && (
                                    <div className="p-3 bg-muted rounded-lg">
                                      <h5 className="text-sm font-medium mb-1">Notes</h5>
                                      <ul className="text-sm text-muted-foreground space-y-1">
                                        {endpoint.notes.map((note, i) => (
                                          <li key={i}>• {note}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              </TabsContent>

                              <TabsContent value="examples">
                                <div className="space-y-4">
                                  <div>
                                    <h5 className="text-sm font-medium mb-2">JavaScript (Supabase Client)</h5>
                                    <CodeBlock
                                      code={generateJsExample(endpoint)}
                                      id={`${endpoint.name}-js`}
                                    />
                                  </div>
                                  <div>
                                    <h5 className="text-sm font-medium mb-2">cURL</h5>
                                    <CodeBlock
                                      code={generateCurlExample(endpoint)}
                                      id={`${endpoint.name}-curl`}
                                    />
                                  </div>
                                </div>
                              </TabsContent>
                            </Tabs>
                          </div>
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                ))}
              </div>
            </div>
          ))}
        </div>

        {filteredEndpoints.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No endpoints found matching your search.</p>
          </div>
        )}
      </div>
    </>
  );
};

export default APIDocumentation;
