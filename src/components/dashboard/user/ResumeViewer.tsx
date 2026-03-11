'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ResumeViewerProps {
  isOpen: boolean;
  onClose: () => void;
  resumeUrl: string;
  assigneeName?: string;
  fileName?: string;
}

const BASE_SCALE = 2; // High-res render for crisp text

function isWordFile(url: string, fileName?: string): boolean {
  const source = fileName || url;
  const lower = source.toLowerCase().split('?')[0];
  return lower.endsWith('.docx') || lower.endsWith('.doc');
}

function getFileExtension(url: string, fileName?: string): string {
  const source = fileName || url;
  const lower = source.toLowerCase().split('?')[0];
  const ext = lower.slice(lower.lastIndexOf('.'));
  return ext || '.pdf';
}

function isBlobUrl(url: string): boolean {
  return url.startsWith('blob:');
}

export function ResumeViewer({ isOpen, onClose, resumeUrl, assigneeName, fileName }: ResumeViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(100);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfModule, setPdfModule] = useState<any>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Word file state
  const [wordLoaded, setWordLoaded] = useState(false);

  const isWord = isWordFile(resumeUrl, fileName);
  const isBlob = isBlobUrl(resumeUrl);

  // Office Online embed URL for Word files (only for remote URLs, not blob URLs)
  const officeEmbedUrl = isWord && !isBlob
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resumeUrl)}`
    : '';

  // Load PDF.js (only for PDFs)
  useEffect(() => {
    if (isWord) return;
    import('pdfjs-dist').then((pdfjs) => {
      const version = pdfjs.version || '4.10.38';
      const workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      setPdfModule(pdfjs);
    }).catch((err) => {
      console.error('Failed to load PDF.js:', err);
      setError('PDF viewer initialization failed. Using fallback viewer.');
    });
  }, [isWord]);

  // Handle Word file open
  useEffect(() => {
    if (!isOpen || !resumeUrl || !isWord) return;
    setLoading(false);
    setError(null);
    setWordLoaded(false);
    setZoom(100);

    // For local blob Word files, mark as ready immediately (shown with download option)
    if (isBlob) {
      setWordLoaded(true);
    }
  }, [isOpen, resumeUrl, isWord, isBlob]);

  // Load PDF
  useEffect(() => {
    if (!isOpen || !resumeUrl || !pdfModule || isWord) return;

    setLoading(true);
    setError(null);
    setPageNumber(1);
    setZoom(100);

    const loadPdf = async () => {
      try {
        const loadingTask = pdfModule.getDocument(resumeUrl);
        const pdf = await loadingTask.promise;
        setNumPages(pdf.numPages);
        setLoading(false);
      } catch (err: any) {
        console.error('Error loading PDF:', err);
        if (err?.message?.includes('worker') || err?.message?.includes('Worker')) {
          setError('PDF worker failed. Using fallback viewer.');
        } else {
          setError('Failed to load PDF. Using fallback viewer.');
        }
        setLoading(false);
      }
    };

    loadPdf();
  }, [isOpen, resumeUrl, pdfModule, isWord]);

  // Render PDF canvas
  useEffect(() => {
    if (!pdfModule || !resumeUrl || !canvasRef.current || loading || error || pageNumber < 1 || isWord) return;

    const renderPage = async () => {
      try {
        const loadingTask = pdfModule.getDocument(resumeUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNumber);

        if (canvasRef.current) {
          const viewport = page.getViewport({ scale: BASE_SCALE });
          canvasRef.current.width = viewport.width;
          canvasRef.current.height = viewport.height;
          setCanvasSize({ width: viewport.width, height: viewport.height });

          const context = canvasRef.current.getContext('2d');
          if (context) {
            await page.render({
              canvasContext: context,
              viewport: viewport,
            }).promise;
          }
        }
      } catch (err) {
        console.error('Error rendering PDF page:', err);
        setError('Failed to render PDF page. Please try again.');
      }
    };

    renderPage();
  }, [pdfModule, resumeUrl, pageNumber, loading, error, isWord]);

  // Reset scroll when zoom changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [zoom]);

  const goToPrevPage = () => setPageNumber((prev) => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber((prev) => Math.min(numPages, prev + 1));

  const handleDownload = () => {
    const ext = getFileExtension(resumeUrl, fileName);
    const link = document.createElement('a');
    link.href = resumeUrl;
    link.download = fileName || `${assigneeName || 'resume'}_resume${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(200, prev + 25));
  const handleZoomOut = () => setZoom((prev) => Math.max(50, prev - 25));
  const resetZoom = () => setZoom(100);

  // CSS display size for PDF
  const displayWidth = (canvasSize.width / BASE_SCALE) * (zoom / 100);
  const displayHeight = (canvasSize.height / BASE_SCALE) * (zoom / 100);

  // Show zoom controls
  const showZoomControls = isWord ? wordLoaded : (!loading && !error);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>
                {assigneeName ? `${assigneeName}'s Resume` : 'Resume Viewer'}
              </DialogTitle>
              <DialogDescription>
                View and download the resume document
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {showZoomControls && (
                <div className="flex items-center gap-1 border rounded-md px-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleZoomOut}
                    disabled={zoom <= 50}
                    className="h-8 w-8 p-0"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <button
                    onClick={resetZoom}
                    className="text-xs text-gray-600 min-w-[40px] text-center hover:text-gray-900"
                    title="Reset zoom"
                  >
                    {zoom}%
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleZoomIn}
                    disabled={zoom >= 200}
                    className="h-8 w-8 p-0"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div ref={scrollContainerRef} className="flex-1 overflow-auto border rounded-lg bg-gray-50 p-4">
          {/* Loading spinner (PDF only — Word iframe handles its own loading) */}
          {loading && !isWord && (
            <div className="flex items-center justify-center h-96">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          )}

          {error && !isWord && (
            <div className="flex flex-col items-center justify-center w-full gap-4">
              <p className="text-amber-600 text-sm">{error}</p>
              <div className="w-full" style={{ height: '600px', minHeight: '600px' }}>
                <iframe
                  src={`${resumeUrl}#toolbar=0`}
                  className="w-full h-full border rounded shadow-lg"
                  title="Resume PDF"
                  style={{ minHeight: '600px' }}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => window.open(resumeUrl, '_blank')}>
                  Open in new tab
                </Button>
                <Button variant="outline" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
              </div>
            </div>
          )}

          {/* Word file viewer */}
          {isWord && (
            <>
              {loading && (
                <div className="flex items-center justify-center h-96">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              )}
              {/* Local blob Word file — preview not supported, offer download */}
              {isBlob && wordLoaded && (
                <div className="flex flex-col items-center justify-center h-72 gap-4 bg-white border rounded shadow-lg mx-auto p-8" style={{ maxWidth: '500px' }}>
                  <div className="text-center">
                    <p className="text-gray-700 font-medium text-base mb-1">
                      {fileName || 'Word Document'}
                    </p>
                    <p className="text-gray-500 text-sm">
                      Word file preview is not available in-browser. Please download the file to view it.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={handleDownload}>
                      <Download className="h-4 w-4 mr-2" />
                      Download File
                    </Button>
                  </div>
                </div>
              )}
              {/* Remote Word file via Office Online iframe */}
              {!isBlob && (
                <div
                  style={{
                    width: wordLoaded ? `${800 * (zoom / 100)}px` : undefined,
                    height: wordLoaded ? `${600 * (zoom / 100)}px` : undefined,
                    overflow: 'hidden',
                    display: wordLoaded ? 'block' : 'none',
                  }}
                >
                  <iframe
                    src={officeEmbedUrl}
                    className="border rounded shadow-lg bg-white"
                    style={{
                      width: '800px',
                      height: '600px',
                      transformOrigin: 'top left',
                      transform: `scale(${zoom / 100})`,
                    }}
                    title="Resume Word Document"
                    onLoad={() => {
                      setWordLoaded(true);
                      setLoading(false);
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* PDF canvas content */}
          {!loading && !error && !isWord && (
            <div style={{ minWidth: displayWidth > 0 ? `${displayWidth}px` : undefined }}>
              <canvas
                ref={canvasRef}
                className="shadow-lg bg-white block mx-auto"
                style={{
                  width: displayWidth > 0 ? `${displayWidth}px` : undefined,
                  height: displayHeight > 0 ? `${displayHeight}px` : undefined,
                }}
              />
            </div>
          )}
        </div>

        {/* PDF page navigation */}
        {!loading && !error && !isWord && numPages > 0 && (
          <div className="flex items-center justify-between pt-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={goToPrevPage}
              disabled={pageNumber <= 1}
              className="flex items-center gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>

            <span className="text-sm text-gray-600">
              Page {pageNumber} of {numPages}
            </span>

            <Button
              variant="outline"
              onClick={goToNextPage}
              disabled={pageNumber >= numPages}
              className="flex items-center gap-2"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
