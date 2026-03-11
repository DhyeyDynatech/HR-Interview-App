'use client';

import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  Download,
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/auth.context';
import { useLoading } from '@/contexts/loading.context';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

interface ParsedUser {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  status?: string;
  notes?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{
    row: number;
    email: string;
    error: string;
  }>;
  imported: Array<any>;
}

export function BulkImportModal({
  isOpen,
  onClose,
  onImportComplete,
}: BulkImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFilePickerOpenRef = useRef(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const organizationId = user?.organization_id;
  const { startLoading, stopLoading } = useLoading();

  function handleClose() {
    // Refresh the list only when closing the modal if there were successful imports
    if (needsRefresh) {
      onImportComplete();
      setNeedsRefresh(false);
    }
    setFile(null);
    setParsedData([]);
    setImportResult(null);
    setShowResults(false);
    onClose();
  };

  // Ignore auto-close from Radix (backdrop / escape / file dialog); we close explicitly via buttons
  function handleOpenChange(open: boolean) {
    if (!open && isFilePickerOpenRef.current) {
      return; // keep dialog open while file picker is open
    }
    if (!open) {
      handleClose();
    }
  };

  function downloadTemplate() {
    const csvContent = `email,first_name,last_name,phone,status,notes
john.doe@example.com,John,Doe,+1234567890,active,Marketing team member
jane.smith@example.com,Jane,Smith,+0987654321,active,Sales representative
bob.johnson@example.com,Bob,Johnson,+1122334455,pending,Needs verification`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'assignee_import_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: 'Template Downloaded',
      description: 'CSV template has been downloaded successfully.',
    });
  };

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        toast({
          title: 'Invalid File',
        description: 'Please upload a CSV file.',
        variant: 'destructive',
      });

      return;
    }

      setFile(selectedFile);
      parseCSVFile(selectedFile);
      // file picker is closed now
      setTimeout(() => {
        isFilePickerOpenRef.current = false;
      }, 500);
    }
  };

  function parseCSVFile(file: File) {
    setIsLoading(true);
    setParsedData([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        const data = results.data as ParsedUser[];
        
        // Validate and clean data
        const validData = data
          .filter((row: any) => row.email && row.email.trim() !== '')
          .map((row: any) => ({
            email: row.email?.trim() || '',
            first_name: row.first_name?.trim() || '',
            last_name: row.last_name?.trim() || '',
            phone: row.phone?.trim() || '',
            status: row.status?.trim()?.toLowerCase() || 'active',
            notes: row.notes?.trim() || '',
          }));

        if (validData.length === 0) {
          toast({
            title: 'No Valid Data',
            description: 'No valid user data found in the CSV file.',
            variant: 'destructive',
          });
          setFile(null);
        } else if (validData.length > 1000) {
          toast({
            title: 'Too Many Records',
            description: 'Cannot import more than 1000 users at once.',
            variant: 'destructive',
          });
          setFile(null);
        } else {
          setParsedData(validData);
          toast({
            title: 'File Parsed',
            description: `Found ${validData.length} valid user(s) to import.`,
          });
        }
        setIsLoading(false);
      },
      error: (error) => {
        console.error('CSV parsing error:', error);
        toast({
          title: 'Parse Error',
          description: 'Failed to parse CSV file. Please check the format.',
          variant: 'destructive',
        });
        setFile(null);
        setIsLoading(false);
      },
    });
  };

  const handleImport = async () => {
    if (parsedData.length === 0) {
      toast({
        title: 'No Data',
      description: 'Please upload a CSV file with user data.',
      variant: 'destructive',
    });

    return;
  }

    setIsLoading(true);
    setShowResults(false);
    const taskId = startLoading('csv-import'); // Show global loader with task ID

    try {
      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await fetch('/api/users/bulk-import-noauth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include', // Include cookies for authentication
        body: JSON.stringify({
          users: parsedData,
          organization_id: organizationId || null, // Make organization optional
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to import users');
      }

      setImportResult(data.result);
      setShowResults(true);

      // Simple toast with just counts
      toast({
        title: 'Import Completed',
        description: `Imported: ${data.result.success} user(s). Failed: ${data.result.failed} user(s).`,
        variant: data.result.failed > 0 ? 'destructive' : 'default',
      });

      // Mark that we need to refresh the list when modal closes
      if (data.result.success > 0) {
        setNeedsRefresh(true);
      }
    } catch (error) {
      console.error('Error importing users:', error);
      toast({
        title: 'Import Failed',
        description: error instanceof Error ? error.message : 'An error occurred during import.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      stopLoading(taskId); // Hide global loader with task ID
    }
  };

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  };

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile);
      parseCSVFile(droppedFile);
    } else {
      toast({
        title: 'Invalid File',
        description: 'Please drop a CSV file.',
        variant: 'destructive',
      });
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('input[type="file"]') || isFilePickerOpenRef.current) {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('input[type="file"]') || isFilePickerOpenRef.current) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (isFilePickerOpenRef.current) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Bulk Import Users from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple users at once. Download the template to see the required format.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Download Template Section */}
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-blue-600" />
              <div>
                <p className="font-medium text-blue-900">Need a template?</p>
                <p className="text-sm text-blue-700">
                  Download our CSV template with sample data
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              className="border-blue-300 text-blue-700 hover:bg-blue-100"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          {/* File Upload Section */}
          {!showResults && (
            <div className="space-y-4">
              <Label>Upload CSV File</Label>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-700 mb-2">
                  {file ? file.name : 'Drop your CSV file here or click to browse'}
                </p>
                <p className="text-sm text-gray-500">
                  Supported format: CSV (up to 1000 users)
                </p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                  onClick={() => {
                    isFilePickerOpenRef.current = true;
                  }}
                  onFocus={() => {
                    isFilePickerOpenRef.current = true;
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      isFilePickerOpenRef.current = false;
                    }, 500);
                  }}
                />
              </div>

              {/* Preview Section */}
              {parsedData.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Preview ({parsedData.length} users)</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFile(null);
                        setParsedData([]);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>First Name</TableHead>
                          <TableHead>Last Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedData.slice(0, 10).map((user, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">{user.email}</TableCell>
                            <TableCell>{user.first_name || '-'}</TableCell>
                            <TableCell>{user.last_name || '-'}</TableCell>
                            <TableCell>{user.phone || '-'}</TableCell>
                            <TableCell>
                              <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                                {user.status || 'active'}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {parsedData.length > 10 && (
                    <p className="text-sm text-gray-500 text-center">
                      ... and {parsedData.length - 10} more users
                    </p>
                  )}
                </div>
              )}

              {/* Import Info */}
              {parsedData.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Important:</strong> Make sure all email addresses are valid and unique.
                    First name and last name are required. Invalid entries will be skipped during import.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Results Section */}
          {showResults && importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-sm text-green-700">Successful</p>
                      <p className="text-2xl font-bold text-green-900">
                        {importResult.success}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-600" />
                    <div>
                      <p className="text-sm text-red-700">Failed</p>
                      <p className="text-2xl font-bold text-red-900">
                        {importResult.failed}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-red-700">Errors</Label>
                  <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.errors.map((error, index) => (
                          <TableRow key={index}>
                            <TableCell>{error.row}</TableCell>
                            <TableCell className="font-medium">{error.email}</TableCell>
                            <TableCell className="text-red-600 text-sm">
                              {error.error}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={handleClose}>
              {showResults ? 'Close' : 'Cancel'}
            </Button>
            {!showResults && (
              <Button
                onClick={handleImport}
                disabled={isLoading || parsedData.length === 0}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import {parsedData.length} User(s)
                  </>
                )}
              </Button>
            )}
            {showResults && importResult && importResult.success > 0 && (
              <Button
                onClick={() => {
                  // Refresh the list before allowing more imports
                  if (needsRefresh) {
                    onImportComplete();
                    setNeedsRefresh(false);
                  }
                  setFile(null);
                  setParsedData([]);
                  setImportResult(null);
                  setShowResults(false);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
              >
                Import More Users
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

