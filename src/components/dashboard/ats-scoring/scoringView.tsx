"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@/contexts/auth.context";
import { useAssignees } from "@/contexts/users.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ScanSearch,
  Upload,
  FileText,
  X,
  Loader2,
  Inbox,
  Download,
  BarChart3,
  Trophy,
  TrendingDown,
  Users,
  FolderOpen,
  Trash2,
  ArrowLeft,
  Eye,
  AlertTriangle,
  Search,
  Filter,
  Building2,
  MapPin,
  Globe,
  Calendar,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { parsePdf } from "@/actions/parse-pdf";
import { ATSScoreResult, ParsedResume } from "@/types/ats-scoring";
import { ExtractedCompany, AggregatedCompany } from "@/types/company-finder";
import ATSResultCard, { normalizeScore } from "@/components/dashboard/ats-scoring/atsResultCard";
import { ATSJobService } from "@/services/ats-job.service";
import { CompanyFinderService } from "@/services/company-finder.service";
import { ResumeViewer } from "@/components/dashboard/user/ResumeViewer";
import {
  getProcessingState,
  setProcessingState,
  subscribeProcessing,
  clearProcessingState,
} from "@/lib/processing-store";

const BATCH_SIZE = 5;
const PARSE_CONCURRENCY = 5;
const API_CONCURRENCY = 3;
const CF_BATCH_SIZE = 10;
const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 2_000;

/** Fetch with exponential backoff on 429 (rate limit) and 5xx errors. */
async function fetchWithRetry(url: string, init: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status === 429 || (response.status >= 500 && attempt < retries)) {
        // Use Retry-After header if present, otherwise exponential backoff with jitter
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`[fetchWithRetry] ${url} returned ${response.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`[fetchWithRetry] ${url} network error, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${retries}):`, err);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error(`Failed after ${retries} retries`);
}

// ---------- Company Finder helpers ----------
function extractResumeNamesFromContext(contexts: string[]): string[] {
  const names = new Set<string>();
  const regex = /From resume ["\u201c]([^"\u201d]+)["\u201d]/gi;
  for (const ctx of contexts) {
    let match;
    while ((match = regex.exec(ctx)) !== null) names.add(match[1]);
  }
  return Array.from(names);
}

function aggregateCFCompanies(raw: ExtractedCompany[]): AggregatedCompany[] {
  const map = new Map<string, AggregatedCompany>();
  const scannedAt = new Date().toISOString();
  for (const c of raw) {
    const key = c.companyName.toLowerCase().trim();
    const existing = map.get(key);
    if (existing) {
      if (!existing.companyInfo && c.companyInfo) existing.companyInfo = c.companyInfo;
      if (!existing.headquarters && c.headquarters) existing.headquarters = c.headquarters;
      if (!existing.foundedYear && c.foundedYear) existing.foundedYear = c.foundedYear;
      if (!existing.countriesWorkedIn?.length && c.countriesWorkedIn?.length)
        existing.countriesWorkedIn = c.countriesWorkedIn;
      existing.contexts.push(c.context);
      for (const t of (c.technologies || [])) {
        if (!existing.technologies.includes(t)) existing.technologies.push(t);
      }
      for (const d of (c.relevantDomains || [])) {
        if (!existing.relevantDomains.includes(d)) existing.relevantDomains.push(d);
      }
      const rns = (c as any).resumeName
        ? [(c as any).resumeName as string]
        : extractResumeNamesFromContext([c.context]);
      for (const rn of rns) {
        if (!existing.sourceResumes.includes(rn)) existing.sourceResumes.push(rn);
      }
      existing.frequency = existing.sourceResumes.length;
    } else {
      const sourceResumes = (c as any).resumeName
        ? [(c as any).resumeName as string]
        : extractResumeNamesFromContext([c.context]);
      map.set(key, {
        companyName: c.companyName,
        companyType: c.companyType || "unknown",
        companyInfo: c.companyInfo || "",
        headquarters: c.headquarters || "",
        foundedYear: c.foundedYear || "",
        countriesWorkedIn: c.countriesWorkedIn ? [...c.countriesWorkedIn] : [],
        technologies: [...(c.technologies || [])],
        relevantDomains: [...(c.relevantDomains || [])],
        sourceResumes,
        frequency: 1,
        contexts: [c.context],
        scannedAt,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.frequency - a.frequency);
}

interface ScoringViewProps {
  interviewId: string;
  interviewName: string;
  onBack: () => void;
}

export default function ScoringView({
  interviewId,
  interviewName,
  onBack,
}: ScoringViewProps) {
  const { user } = useAuth();
  const { addAssignee } = useAssignees();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const jdSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Restore in-progress state if user navigated away during ATS/CF analysis.
  // Also subscribes to processing store so that when the OLD closure (from a
  // previous mount) finishes, this instance learns about it and reloads from DB.
  useEffect(() => {
    const atsKey = `ats_${interviewId}`;
    const cfKey = `cf_${interviewId}`;

    // Track whether we remounted into an already-running analysis
    let atsRemounted = false;

    const storedAts = getProcessingState(atsKey);
    if (storedAts?.analyzing) {
      atsRemounted = true;
      setAnalyzing(true);
      setAnalyzeProgress(storedAts.progress);
      analyzingCountRef.current = storedAts.itemCount;
      // Reload partial results from DB so user sees progress after navigating back
      ATSJobService.getJobDetail(interviewId).then((detail) => {
        if (detail.results?.length > 0) setResults(detail.results);
      }).catch(() => {});
    }

    const storedCf = getProcessingState(cfKey);
    if (storedCf?.analyzing) {
      setCompanyAnalyzing(true);
      setCfProgress(storedCf.progress);
      if (storedCf.itemCount) setCfItemCount(storedCf.itemCount);
    }

    const unsubAts = subscribeProcessing(atsKey, (s) => {
      // Always process analyzing=false to avoid stuck spinners
      if (!s.analyzing) {
        setAnalyzing(false);
        setAnalyzeProgress({ current: 0, total: 0 });
        atsRemounted = false;
        return;
      }
      setAnalyzing(s.analyzing);
      setAnalyzeProgress(s.progress);
      analyzingCountRef.current = s.itemCount;
      // If we remounted into an ongoing analysis, reload results from DB
      // (the old closure's setResults targets the dead component instance).
      // Delay slightly to let the DB write from the old closure complete.
      if (atsRemounted) {
        setTimeout(() => {
          ATSJobService.getJobDetail(interviewId).then((detail) => {
            if (detail.results?.length > 0) setResults(detail.results);
          }).catch(() => {});
        }, 1500);
      }
    });

    const unsubCf = subscribeProcessing(cfKey, (s) => {
      // Always process analyzing=false to avoid stuck spinners
      if (!s.analyzing) {
        setCompanyAnalyzing(false);
        setCfProgress(null);
        setCfItemCount(0);
        return;
      }
      setCompanyAnalyzing(s.analyzing);
      setCfProgress(s.progress);
      if (s.itemCount) setCfItemCount(s.itemCount);
    });

    return () => {
      unsubAts();
      unsubCf();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  // Data loading state
  const [dataLoading, setDataLoading] = useState(true);

  // JD state
  const [jdInputMode, setJdInputMode] = useState<"text" | "pdf">("text");
  const [jobDescription, setJobDescription] = useState("");
  const [jdFileName, setJdFileName] = useState("");
  const [jdParsing, setJdParsing] = useState(false);

  // Resume state
  const [resumes, setResumes] = useState<ParsedResume[]>([]);
  const [parsingResumes, setParsingResumes] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0 });

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<ATSScoreResult[] | null>(null);
  const [creatingAssignees, setCreatingAssignees] = useState(false);
  const [viewingResume, setViewingResume] = useState<{ url: string; name: string } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const analyzingCountRef = useRef(0);
  const isAnalyzingRef = useRef(false);
  const isRunningCFRef = useRef(false);
  // Tracks in-flight / completed blob upload promises keyed by resume name.
  // Shared between uploadFilesForPreview (file-drop) and handleAnalyze so we
  // never upload the same file twice and handleAnalyze can await them all.
  const uploadPromisesRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [skippedInfo, setSkippedInfo] = useState<{ count: number; names: string[] } | null>(null);

  // Company Finder state
  const [extractedCompanies, setExtractedCompanies] = useState<ExtractedCompany[]>([]);
  // Initialize companyAnalyzing to true immediately if sessionStorage has resume data for this interview
  // AND the processing store confirms CF is still running. This prevents the flash of "No companies
  // found" while the auto-restart effect is pending, but avoids stuck spinners when CF already finished.
  const [companyAnalyzing, setCompanyAnalyzing] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const cfState = getProcessingState(`cf_${interviewId}`);
      if (cfState?.analyzing) return true;
      const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
      return !!stored;
    } catch {
      return false;
    }
  });
  const [cfProgress, setCfProgress] = useState<{ current: number; total: number } | null>(null);
  const [cfItemCount, setCfItemCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"ats" | "companies">("ats");
  // Persisted CF results (loaded from DB on mount; updated after analysis / resume delete)
  const [persistedCompanyResults, setPersistedCompanyResults] = useState<AggregatedCompany[] | null>(null);
  const [cfScannedResumeNames, setCfScannedResumeNames] = useState<string[]>([]);
  const [cfScanId, setCfScanId] = useState<string | null>(null);

  // CF filter / selection state
  const [cfSearchQuery, setCfSearchQuery] = useState("");
  const [cfTypeFilter, setCfTypeFilter] = useState<"all" | "service_provider" | "service_consumer">("all");
  const [cfSortBy, setCfSortBy] = useState<"frequency" | "name">("frequency");
  const [selectedCFCompanies, setSelectedCFCompanies] = useState<Set<string>>(new Set());

  // Build resume URL lookup from scored results (memoized to avoid re-computation on every render)
  const resumeUrlMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (results) {
      for (const r of results) {
        if (r.resumeUrl) map[r.resumeName] = r.resumeUrl;
      }
    }
    return map;
  }, [results]);

  // Load JD and results from Supabase on mount
  useEffect(() => {
    if (!interviewId) return;
    let cancelled = false;

    (async () => {
      try {
        setDataLoading(true);
        const detail = await ATSJobService.getJobDetail(interviewId);
        if (cancelled) return;

        if (detail.jdText) {
          setJobDescription(detail.jdText);
          if (detail.jdFilename) {
            setJdFileName(detail.jdFilename);
            setJdInputMode("pdf");
          }
        }
        if (detail.results && detail.results.length > 0) {
          setResults(detail.results);
        }

        // Load linked company finder results
        try {
          const scanId = await CompanyFinderService.findAtsScanId(interviewId);
          if (scanId && !cancelled) {
            const cfDetail = await CompanyFinderService.getScanDetail(scanId);
            if (cfDetail.results?.length > 0) {
              const activeResumeNames = new Set(
                (detail.results || []).map((r: ATSScoreResult) => r.resumeName)
              );

              let reconciled: AggregatedCompany[];
              if (activeResumeNames.size === 0) {
                // No ATS results yet — cannot reconcile, keep all company results as-is
                reconciled = cfDetail.results as AggregatedCompany[];
              } else {
                // Reconcile: remove companies whose source resumes no longer exist in ATS results
                reconciled = (cfDetail.results as AggregatedCompany[])
                  .map((c) => {
                    // Legacy data with empty sourceResumes — cannot reconcile, keep as-is
                    if (!c.sourceResumes?.length) return c;
                    const validSources = c.sourceResumes.filter((r) => activeResumeNames.has(r));
                    if (validSources.length === 0) return null;
                    return { ...c, sourceResumes: validSources, frequency: validSources.length };
                  })
                  .filter(Boolean) as AggregatedCompany[];
              }

              setPersistedCompanyResults(reconciled);
              setCfScanId(scanId);
              if (cfDetail.resumeNames?.length) setCfScannedResumeNames(cfDetail.resumeNames);

              // Load CF scan resume URLs so Eye buttons work on page reload
              if (cfDetail.resumeUrls) {
                setPreviewUrls((prev) => ({ ...prev, ...cfDetail.resumeUrls }));
              }

              // If stale companies were removed, persist the cleaned-up version back to DB
              if (reconciled.length < cfDetail.results.length) {
                const names = Array.from(new Set(reconciled.flatMap((c) => c.sourceResumes)));
                CompanyFinderService.updateResults(scanId, { results: reconciled, resumeNames: names })
                  .catch((err) => console.error("Failed to reconcile company results:", err));
              }
            }
          }
        } catch (cfErr) {
          console.error("Failed to load linked company finder data:", cfErr);
        }
      } catch (error) {
        console.error("Failed to load ATS job data:", error);
        toast.error("Failed to load saved data");
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  // Auto-restart Company Finder if page was refreshed while it was running.
  // Only restarts if:
  //   1. sessionStorage has resume data for this interview (set by runCompanyFinder)
  //   2. The processing store does NOT show an active run (avoids double-run on tab switch)
  const cfAutoRestartAttempted = useRef(false);
  useEffect(() => {
    if (dataLoading || !interviewId || cfAutoRestartAttempted.current) return;
    if (user?.role !== 'admin' && user?.role !== 'marketing') return;

    const cfKey = `cf_${interviewId}`;
    const currentState = getProcessingState(cfKey);

    // If the processing store still shows CF running from a PREVIOUS mount's closure,
    // do NOT restart — that closure is still active. The subscriber will pick up completion.
    if (currentState?.analyzing) {
      cfAutoRestartAttempted.current = true;
      return;
    }

    try {
      const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
      if (!stored) return;
      const storedResumes = JSON.parse(stored) as { name: string; text: string }[];
      if (storedResumes.length === 0) return;
      cfAutoRestartAttempted.current = true;
      setCompanyAnalyzing(true);
      runCompanyFinder(storedResumes as ParsedResume[]);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading, interviewId, user?.role]);

  // Auto-save JD to Supabase (debounced, 1500ms for network calls)
  useEffect(() => {
    if (!interviewId || dataLoading) return;

    if (jdSaveTimeoutRef.current) {
      clearTimeout(jdSaveTimeoutRef.current);
    }

    jdSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await ATSJobService.updateJd(interviewId, jobDescription, jdFileName);
      } catch (error) {
        console.error("Failed to auto-save JD:", error);
      }
    }, 1500);

    return () => {
      if (jdSaveTimeoutRef.current) {
        clearTimeout(jdSaveTimeoutRef.current);
      }
    };
  }, [jobDescription, jdFileName, interviewId, dataLoading]);

  // Reload Company Finder results from DB when analysis completes.
  // Covers the tab-switch case: old closure saved results to DB but couldn't
  // update this component's state (old setState is a no-op in React 18).
  const prevCompanyAnalyzingRef = useRef(companyAnalyzing);
  useEffect(() => {
    const was = prevCompanyAnalyzingRef.current;
    prevCompanyAnalyzingRef.current = companyAnalyzing;
    if (!was || companyAnalyzing) return; // only on true → false transition

    (async () => {
      try {
        const scanId = cfScanId || await CompanyFinderService.findAtsScanId(interviewId);
        if (!scanId) return;
        const cfDetail = await CompanyFinderService.getScanDetail(scanId);
        if (cfDetail.results?.length > 0) {
          setPersistedCompanyResults((prev) => {
            const dbResults = cfDetail.results as AggregatedCompany[];
            // Don't overwrite fresher in-memory results with stale DB data
            // (race: saveCFResultsToDB may not have completed when this useEffect fires)
            if (prev && prev.length > dbResults.length) return prev;
            return dbResults;
          });
          if (!cfScanId) setCfScanId(scanId);
        }
        if (cfDetail.resumeNames?.length) {
          setCfScannedResumeNames((prev) =>
            cfDetail.resumeNames.length > prev.length ? cfDetail.resumeNames : prev
          );
        }
      } catch (err) {
        console.error("Failed to reload company results after completion:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyAnalyzing, interviewId]);

  // Reload ATS results from DB when analysis completes (same pattern as CF above).
  const prevAnalyzingRef = useRef(analyzing);
  useEffect(() => {
    const was = prevAnalyzingRef.current;
    prevAnalyzingRef.current = analyzing;
    if (!was || analyzing) return; // only on true → false transition

    (async () => {
      try {
        const detail = await ATSJobService.getJobDetail(interviewId);
        if (detail.results?.length > 0) {
          setResults(detail.results);
        }
      } catch (err) {
        console.error("Failed to reload ATS results after completion:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing, interviewId]);

  // JD PDF upload handler
  const onJdDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        toast.error("File must be smaller than 10MB");
        return;
      }

      try {
        setJdParsing(true);
        const formData = new FormData();
        formData.append("file", file);
        const result = await parsePdf(formData);

        if (!result.success) {
          throw new Error(result.error);
        }

        const text = result.text || "";
        setJobDescription(text);
        setJdFileName(file.name);

        // Clear debounce timer to prevent race condition, then save immediately
        if (jdSaveTimeoutRef.current) {
          clearTimeout(jdSaveTimeoutRef.current);
        }
        ATSJobService.updateJd(interviewId, text, file.name).catch((err) => {
          console.error("Failed to save parsed JD:", err);
        });

        toast.success("Job description parsed successfully");
      } catch (error) {
        console.error(error);
        toast.error("Failed to parse document", {
          description: "Please try again or paste the text directly.",
        });
      } finally {
        setJdParsing(false);
      }
    },
    [interviewId]
  );

  const {
    getRootProps: getJdRootProps,
    getInputProps: getJdInputProps,
  } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/msword": [".doc"],
    },
    maxFiles: 1,
    onDrop: onJdDrop,
  });

  // Shared resume processing function with parallel parsing
  const processResumeFiles = async (files: File[]) => {
    const supportedExts = [".pdf", ".doc", ".docx"];
    const supportedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    const pdfFiles = files.filter(
      (f) =>
        supportedTypes.includes(f.type) ||
        supportedExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );

    if (pdfFiles.length === 0) {
      toast.error("No PDF or Word files found");
      return;
    }

    setParsingResumes(true);
    setParseProgress({ current: 0, total: pdfFiles.length });
    const newResumes: ParsedResume[] = [];
    let skippedCount = 0;

    const queue = [...pdfFiles];
    let completed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        if (file.size > 10 * 1024 * 1024) {
          skippedCount++;
          completed++;
          setParseProgress({ current: completed, total: pdfFiles.length });
          continue;
        }

        try {
          const formData = new FormData();
          formData.append("file", file);
          const result = await parsePdf(formData);

          if (result.success && result.text) {
            newResumes.push({
              name: file.name,
              text: result.text,
              file,
            });
          } else {
            skippedCount++;
          }
        } catch {
          skippedCount++;
        }

        completed++;
        setParseProgress({ current: completed, total: pdfFiles.length });
      }
    };

    const workers = Array.from(
      { length: Math.min(PARSE_CONCURRENCY, pdfFiles.length) },
      () => worker()
    );
    await Promise.all(workers);

    if (newResumes.length > 0) {
      setResumes((prev) => [...prev, ...newResumes]);
      toast.success(`${newResumes.length} resume(s) added`);
      // Upload files in background immediately so Eye buttons become available
      uploadFilesForPreview(newResumes);
    }
    if (skippedCount > 0) {
      toast.warning(`${skippedCount} file(s) skipped (too large or failed to parse)`);
    }

    setParsingResumes(false);
    setParseProgress({ current: 0, total: 0 });
  };

  const onResumeDrop = useCallback(
    async (acceptedFiles: File[]) => {
      await processResumeFiles(acceptedFiles);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resumes.length]
  );

  const {
    getRootProps: getResumeRootProps,
    getInputProps: getResumeInputProps,
  } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/msword": [".doc"],
    },
    onDrop: onResumeDrop,
    disabled: parsingResumes,
  });

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processResumeFiles(Array.from(files));
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const removeResume = (index: number) => {
    setResumes((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAllResumes = () => {
    setResumes([]);
    toast.info("All resumes cleared");
  };

  // ---------- Upload all resume files for preview immediately after parsing ----------

  const uploadFilesForPreview = async (newResumes: ParsedResume[]) => {
    const orgId = user?.organization_id || user?.id;
    // Only start uploads for files not already tracked (in-flight or done)
    const toUpload = newResumes.filter((r) => !uploadPromisesRef.current.has(r.name));
    if (toUpload.length === 0) return;

    setUploadingFiles((prev) => {
      const next = new Set(prev);
      toUpload.forEach((r) => next.add(r.name));
      return next;
    });

    await Promise.all(
      toUpload.map((resume) => {
        const p = (async (): Promise<string | null> => {
          try {
            const formData = new FormData();
            formData.append("resume", resume.file);
            if (orgId) formData.append("organizationId", orgId);
            if (user?.id) formData.append("userId", user.id);

            const res = await fetch("/api/upload-resume", { method: "POST", body: formData });
            if (res.ok) {
              const { resumeUrl } = await res.json();
              if (resumeUrl) {
                setPreviewUrls((prev) => ({ ...prev, [resume.name]: resumeUrl }));
                return resumeUrl;
              }
            }
            return null;
          } catch {
            return null;
          } finally {
            setUploadingFiles((prev) => {
              const next = new Set(prev);
              next.delete(resume.name);
              return next;
            });
          }
        })();
        uploadPromisesRef.current.set(resume.name, p);
        return p;
      })
    );
  };

  // Analyze resumes with batched API calls
  const handleAnalyze = async () => {
    if (isAnalyzingRef.current) return;
    if (!jobDescription.trim()) {
      toast.error("Please provide a job description");
      return;
    }
    if (resumes.length === 0) {
      toast.error("Please upload at least one resume");
      return;
    }
    isAnalyzingRef.current = true;

    // Skip resumes already scored for this job
    const existingResultsAtStart: ATSScoreResult[] = results || [];
    const existingNames = new Set(existingResultsAtStart.map((r) => r.resumeName));
    const skippedResumes = resumes.filter((r) => existingNames.has(r.name));
    const newResumes = resumes.filter((r) => !existingNames.has(r.name));

    if (skippedResumes.length > 0) {
      setSkippedInfo({
        count: skippedResumes.length,
        names: skippedResumes.map((r) => r.name),
      });
    }

    if (newResumes.length === 0) {
      isAnalyzingRef.current = false;
      setResumes([]);
      return;
    }

    const atsKey = `ats_${interviewId}`;
    analyzingCountRef.current = newResumes.length;
    setAnalyzing(true);
    setProcessingState(atsKey, { analyzing: true, itemCount: newResumes.length, progress: { current: 0, total: 0 } });

    try {
      // Phase 1: Upload ALL resumes to blob before scoring starts.
      // Re-use any in-flight promises from uploadFilesForPreview (triggered on file drop)
      // so we never upload the same file twice. Start fresh uploads only for files not tracked.
      const orgId = user?.organization_id || user?.id;
      const preUploadUrls: Record<string, string> = {};

      for (const resume of newResumes) {
        if (!uploadPromisesRef.current.has(resume.name)) {
          const p = (async (): Promise<string | null> => {
            try {
              const formData = new FormData();
              formData.append("resume", resume.file);
              if (orgId) formData.append("organizationId", orgId);
              if (user?.id) formData.append("userId", user.id);
              setUploadingFiles((prev) => new Set([...prev, resume.name]));
              const res = await fetch("/api/upload-resume", { method: "POST", body: formData });
              if (res.ok) {
                const { resumeUrl } = await res.json();
                if (resumeUrl) {
                  setPreviewUrls((prev) => ({ ...prev, [resume.name]: resumeUrl }));
                  return resumeUrl;
                }
              }
              return null;
            } catch {
              return null;
            } finally {
              setUploadingFiles((prev) => { const next = new Set(prev); next.delete(resume.name); return next; });
            }
          })();
          uploadPromisesRef.current.set(resume.name, p);
        }
      }

      // Await ALL uploads (both previously started and new) before scoring begins
      const uploadResults = await Promise.allSettled(
        newResumes.map((r) => uploadPromisesRef.current.get(r.name) ?? Promise.resolve(null))
      );
      newResumes.forEach((r, i) => {
        const res = uploadResults[i];
        const url = res.status === "fulfilled" ? res.value : null;
        if (url) preUploadUrls[r.name] = url;
      });

      const batches: ParsedResume[][] = [];
      for (let i = 0; i < newResumes.length; i += BATCH_SIZE) {
        batches.push(newResumes.slice(i, i + BATCH_SIZE));
      }

      setAnalyzeProgress({ current: 0, total: batches.length });
      setProcessingState(atsKey, { progress: { current: 0, total: batches.length } });
      // Shared accumulator — all workers push here between awaits (JS single-thread = atomic).
      const allNewResults: ATSScoreResult[] = [];
      let completedBatches = 0;
      const scoredAt = new Date().toISOString();

      let failedBatches = 0;
      const callATSAPI = async (resumeBatch: ParsedResume[]): Promise<ATSScoreResult[]> => {
        const response = await fetchWithRetry("/api/ats-scoring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobDescription: jobDescription.trim(),
            resumes: resumeBatch.map((r) => ({ name: r.name, text: r.text })),
            userId: user?.id,
            organizationId: user?.organization_id,
          }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          throw new Error(err.error || `HTTP ${response.status}`);
        }
        const data = await response.json();
        return (data.results || []).map((r: ATSScoreResult) => ({ ...r, scoredAt }));
      };

      // Push results + take a consistent snapshot + render. Called synchronously
      // between awaits so push + snapshot is atomic across concurrent workers.
      const appendAndRender = (results: ATSScoreResult[]) => {
        allNewResults.push(...results);
        const snapshot = allNewResults.map((r) => ({
          ...r,
          resumeUrl: preUploadUrls[r.resumeName] || resumeUrlMap[r.resumeName] || r.resumeUrl,
        }));
        setResults((prev) => {
          const existingBase = prev || [];
          const partialNames = new Set(snapshot.map((r) => r.resumeName));
          const partialMerged = [
            ...existingBase.filter((r) => !partialNames.has(r.resumeName)),
            ...snapshot,
          ];
          partialMerged.sort((a, b) => b.overallScore - a.overallScore);
          return partialMerged;
        });
        ATSJobService.updateResults(interviewId, [...existingResultsAtStart, ...snapshot]).catch(() => {});
      };

      const batchQueue = batches.map((batch, idx) => ({ batch, idx }));
      const batchWorker = async () => {
        while (batchQueue.length > 0) {
          const item = batchQueue.shift();
          if (!item) break;

          try {
            const results = await callATSAPI(item.batch);
            appendAndRender(results);
          } catch (firstErr) {
            console.warn(`Batch ${item.idx + 1} failed, retrying with smaller chunks:`, firstErr);
            const half = Math.ceil(item.batch.length / 2);
            const subBatches = [item.batch.slice(0, half), item.batch.slice(half)].filter(b => b.length > 0);
            for (const sub of subBatches) {
              try {
                const results = await callATSAPI(sub);
                appendAndRender(results);
              } catch (subErr) {
                console.error(`Sub-batch failed:`, subErr);
                failedBatches++;
              }
            }
          }

          completedBatches++;
          setProcessingState(atsKey, { progress: { current: completedBatches, total: batches.length } });
          setAnalyzeProgress({ current: completedBatches, total: batches.length });
        }
      };

      const batchWorkers = Array.from(
        { length: Math.min(API_CONCURRENCY, batches.length) },
        () => batchWorker()
      );
      await Promise.all(batchWorkers);

      // Final merge with URLs attached
      const uploadedUrls: Record<string, string> = { ...preUploadUrls };
      const newResultsWithUrls = allNewResults.map((r) => ({
        ...r,
        resumeUrl: uploadedUrls[r.resumeName] || resumeUrlMap[r.resumeName] || r.resumeUrl || undefined,
      }));
      const newResumeNames = new Set(allNewResults.map((r) => r.resumeName));
      const merged: ATSScoreResult[] = [
        ...existingResultsAtStart.filter((r) => !newResumeNames.has(r.resumeName)),
        ...newResultsWithUrls,
      ];
      merged.sort((a, b) => b.overallScore - a.overallScore);
      setResults(merged);

      ATSJobService.updateResults(interviewId, merged).catch((err) => {
        console.error("Failed to save results:", err);
        if (mountedRef.current) toast.error("Results computed but failed to save to server");
      });

      if (allNewResults.length > 0) {
        if (failedBatches > 0 && mountedRef.current) {
          toast.warning(`${allNewResults.length} resume(s) scored. ${failedBatches} batch(es) failed — try re-uploading those resumes.`);
        }
        // These run regardless of mount state so they complete in background
        createAssigneesFromResults(newResultsWithUrls);
        if (user?.role === 'admin' || user?.role === 'marketing') {
          runCompanyFinder(resumes);
        }
      } else if (mountedRef.current) {
        toast.error("Analysis failed — connection was reset by OpenAI. Please try again with fewer resumes or retry.");
      }
    } catch (error: any) {
      console.error("ATS analysis error:", error);
      if (mountedRef.current) {
        toast.error("Analysis failed", {
          description: error.message || "Please try again.",
        });
      }
    } finally {
      isAnalyzingRef.current = false;
      // Broadcast analyzing=false BEFORE clearing so any re-mounted subscriber
      // picks up the completion signal (same pattern as runCompanyFinder).
      setProcessingState(atsKey, { analyzing: false });
      clearProcessingState(atsKey);
      setAnalyzing(false);
      setAnalyzeProgress({ current: 0, total: 0 });
      // Clear upload promises to free memory — these are one-shot per analysis run
      uploadPromisesRef.current.clear();
      if (mountedRef.current) {
        setResumes([]);
      }
    }
  };

  // Export company results as CSV (Companies Founded tab)
  const exportCompanyCSV = () => {
    if (!companyResults || companyResults.length === 0) return;

    const headers = [
      "Company",
      "Type",
      "Company Info",
      "Headquarters",
      "Founded Year",
      "Countries",
      "Frequency",
      "Source Resumes",
      "Description",
    ];

    const rows = companyResults.map((c) => [
      `"${c.companyName.replace(/"/g, '""')}"`,
      c.companyType === "service_provider" ? "Service Provider" : c.companyType === "service_consumer" ? "Service Consumer" : "Unknown",
      `"${(c.companyInfo || "").replace(/"/g, '""')}"`,
      `"${(c.headquarters || "").replace(/"/g, '""')}"`,
      c.foundedYear || "",
      `"${(c.countriesWorkedIn || []).join(", ").replace(/"/g, '""')}"`,
      c.frequency,
      `"${(c.sourceResumes || []).join(", ").replace(/"/g, '""')}"`,
      `"${(c.contexts || []).join(" | ").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `companies-${interviewName.replace(/[^a-zA-Z0-9]/g, "_")}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Export ATS results as CSV
  const exportCSV = () => {
    if (!results) return;

    const headers = [
      "Rank",
      "Resume",
      "Candidate Name",
      "Email",
      "Phone",
      "Suggested Tag",
      "Overall Score",
      "Skills Score",
      "Experience Match",
      "Education Score",
      "Keywords Score",
      "Matched Skills",
      "Missing Skills",
      "Strengths",
      "Interview Focus Areas",
      "Summary",
      // Candidate Profile (new detailed analysis)
      "Current Role",
      "Current Company",
      "Total Experience",
      "Primary Expertise",
      "Education",
      "Certifications",
      "Location",
      // Experience Depth
      "Experience Depth Parameters",
      "Key Observations",
      // SWOT
      "SWOT Strengths",
      "SWOT Weaknesses",
      "SWOT Opportunities",
      "SWOT Risks",
      "Final Hiring Insight",
    ];

    const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;

    const rows = results.map((r, i) => {
      const cp = r.candidateProfile;
      const ed = r.experienceDepthAnalysis;
      const sw = r.swotAnalysis;

      return [
        i + 1,
        r.resumeName,
        esc(`${r.candidateDetails?.firstName || ""} ${r.candidateDetails?.lastName || ""}`.trim()),
        r.candidateDetails?.email || "",
        r.candidateDetails?.phone || "",
        r.suggestedTag || "",
        normalizeScore(r.overallScore),
        normalizeScore(r.categoryScores.skills),
        r.experienceMatch === undefined ? normalizeScore(r.categoryScores.experience) : (r.experienceMatch ? "Yes" : "No"),
        normalizeScore(r.categoryScores.education),
        r.categoryScores.keywords !== undefined ? normalizeScore(r.categoryScores.keywords) : "",
        esc(r.matchedSkills.join(", ")),
        esc(r.missingSkills.join(", ")),
        esc((r.strengths || []).join(", ")),
        esc((r.interviewFocusAreas || []).join(", ")),
        esc(r.summary),
        // Candidate Profile
        esc(cp?.currentRole || ""),
        esc(cp?.currentCompany || ""),
        esc(cp?.totalExperience || ""),
        esc(cp?.primaryExpertise || ""),
        esc(cp?.education || ""),
        esc(cp?.certifications || ""),
        esc(cp?.location || ""),
        // Experience Depth
        esc((ed?.parameters || []).map((p) => `${p.parameter}: ${p.rating} - ${p.observation}`).join(" | ")),
        esc((ed?.keyObservations || []).join(" | ")),
        // SWOT
        esc((sw?.strengths || []).join(", ")),
        esc((sw?.weaknesses || []).join(", ")),
        esc((sw?.opportunities || []).join(", ")),
        esc((sw?.risks || []).join(", ")),
        esc(sw?.finalHiringInsight || ""),
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ats-scoring-${interviewName.replace(/[^a-zA-Z0-9]/g, "_")}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Automatically create assignees from ATS results
  const createAssigneesFromResults = async (scoredResults: ATSScoreResult[]) => {
    const MIN_SCORE = 6;
    if (mountedRef.current) setCreatingAssignees(true);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let belowThreshold = 0;
    let expNotMatched = 0;
    const urlUpdates: Record<string, string> = {};

    for (const result of scoredResults) {
      // Skip candidates whose experience doesn't match JD requirement
      if (result.experienceMatch === false) {
        expNotMatched++;
        continue;
      }

      // Skip candidates scoring below threshold
      if (normalizeScore(result.overallScore) < MIN_SCORE) {
        belowThreshold++;
        continue;
      }

      const details = result.candidateDetails;

      try {
        let resumeUrl = result.resumeUrl || resumeUrlMap[result.resumeName] || "";
        const matchingResume = resumes.find((r) => r.name === result.resumeName);
        if (!resumeUrl && matchingResume?.file) {
          try {
            const resumeFormData = new FormData();
            resumeFormData.append("resume", matchingResume.file);
            const orgId = user?.organization_id || user?.id;
            if (orgId) {
              resumeFormData.append("organizationId", orgId);
            }
            if (user?.id) {
              resumeFormData.append("userId", user.id);
            }
            const uploadRes = await fetch("/api/upload-resume", {
              method: "POST",
              body: resumeFormData,
            });
            if (uploadRes.ok) {
              const { resumeUrl: url } = await uploadRes.json();
              resumeUrl = url || "";
            }
          } catch {
            // Continue without resume URL
          }
        }

        // Update result with resumeUrl immediately so Eye button appears right away
        if (resumeUrl && !result.resumeUrl) {
          urlUpdates[result.resumeName] = resumeUrl;
          if (mountedRef.current) {
            setResults((prev) => {
              if (!prev) return prev;
              return prev.map((r) =>
                r.resumeName === result.resumeName ? { ...r, resumeUrl } : r
              );
            });
          }
        }

        await addAssignee({
          first_name: details?.firstName || "",
          last_name: details?.lastName || "",
          email: details?.email || "",
          phone: details?.phone || "",
          resume_url: resumeUrl,
          organization_id: user?.organization_id || null,
          interview_id: interviewId,
          tag: result.suggestedTag || null,
          status: "active",
        }, { silent: true });
        created++;
      } catch (error: any) {
        if (error?.message?.includes("already exists") || error?.status === 409) {
          skipped++;
        } else {
          failed++;
        }
      }
    }

    // Persist all resume URL updates to Supabase in one call (runs regardless of mount state)
    if (Object.keys(urlUpdates).length > 0) {
      if (mountedRef.current) {
        setResults((prev) => {
          if (!prev) return prev;
          ATSJobService.updateResults(interviewId, prev).catch((err) => {
            console.error("Failed to save resume URLs:", err);
          });
          return prev;
        });
      }
    }

    if (mountedRef.current) setCreatingAssignees(false);

    // Single consolidated notification
    if (mountedRef.current) {
      const extra: string[] = [];
      if (skipped > 0) extra.push(`${skipped} skipped (already exist)`);
      if (expNotMatched > 0) extra.push(`${expNotMatched} skipped (experience doesn't match)`);
      if (belowThreshold > 0) extra.push(`${belowThreshold} below score ${MIN_SCORE}`);
      if (failed > 0) extra.push(`${failed} failed`);

      if (created > 0) {
        toast.success(`${created} Assignee(s) created (score ${MIN_SCORE}+)`, {
          description: extra.length > 0 ? extra.join(", ") : undefined,
        });
      } else if (extra.length > 0) {
        toast.info(extra.join(", "));
      }
    }
  };

  const runCompanyFinder = async (initialResumesToScan: ParsedResume[]) => {
    if (initialResumesToScan.length === 0) return;
    if (isRunningCFRef.current) {
      console.warn("[CF] Skipped: already running");
      return;
    }
    isRunningCFRef.current = true;
    const cfKey = `cf_${interviewId}`;
    const cfStorageKey = `cf_resumes_${interviewId}`;

    try {
      let resumesToScan = [...initialResumesToScan];
      // Capture existing CF state at the start so async operations have a stable base
      const existingCFResultsAtStart: AggregatedCompany[] = persistedCompanyResults || [];
      const existingCFResumeNamesAtStart: string[] = cfScannedResumeNames || [];
      // Prevent the auto-restart effect from double-starting if this was triggered by the
      // analyze button (not the effect itself). Safe to set here — the ref is only false on
      // a fresh component mount, and this function won't be called twice concurrently.
      cfAutoRestartAttempted.current = true;
      const CF_CONCURRENCY = 3;

      // Persist resume texts so we can auto-restart if the page is refreshed mid-run
      try {
        sessionStorage.setItem(cfStorageKey, JSON.stringify(
          resumesToScan.map((r) => ({ name: r.name, text: r.text }))
        ));
      } catch { /* ignore storage errors */ }

      flushSync(() => { setCompanyAnalyzing(true); });

      // Resolve/create the DB scan ID once before the loop
      let resolvedScanId: string | null = cfScanId;
      if (!resolvedScanId) {
        try {
          resolvedScanId = await CompanyFinderService.ensureAtsScan(interviewId);
          setCfScanId(resolvedScanId);
        } catch (err) {
          console.error("Failed to create CF scan before batching:", err);
        }
      }

      // ── Reuse results from other scans (standalone Company Finder, etc.) ──
      let reusedCompanies: AggregatedCompany[] = [];
      let reusedResumeNames: string[] = [];
      try {
        const crossScan = await CompanyFinderService.findExistingResultsForResumes(
          resolvedScanId || "",
          resumesToScan.map((r) => r.name)
        );
        if (crossScan.processedNames.length > 0) {
          reusedCompanies = crossScan.companies;
          reusedResumeNames = crossScan.processedNames;
          // Merge resume URLs from source scans so Eye buttons work
          if (Object.keys(crossScan.resumeUrls).length > 0) {
            setPreviewUrls((prev) => ({ ...prev, ...crossScan.resumeUrls }));
          }
          // Remove already-processed resumes from the API queue
          const reusedSet = new Set(reusedResumeNames.map((n) => n.toLowerCase().trim()));
          resumesToScan = resumesToScan.filter((r) => !reusedSet.has(r.name.toLowerCase().trim()));
        }
      } catch (err) {
        console.error("Cross-scan lookup failed, proceeding with full analysis:", err);
      }

      // If reused companies found, merge them immediately into current results
      if (reusedCompanies.length > 0) {
        const reusedKeys = new Set(reusedCompanies.map((c) => c.companyName.trim().toLowerCase()));
        const merged = [
          ...existingCFResultsAtStart.filter((c) => !reusedKeys.has(c.companyName.trim().toLowerCase())),
          ...reusedCompanies,
        ];
        // flushSync forces an immediate synchronous render so the Companies Founded
        // tab shows results right away even if the user is on the ATS Scoring tab.
        flushSync(() => { setPersistedCompanyResults(merged); });
        const names = Array.from(new Set([
          ...existingCFResumeNamesAtStart,
          ...reusedResumeNames,
          ...merged.flatMap((c) => c.sourceResumes),
        ]));
        setCfScannedResumeNames((prev) => names.length > prev.length ? names : prev);
        // Await the DB save so the completion useEffect doesn't fetch stale data
        await saveCFResultsToDB(merged, names, resolvedScanId);
      }

      // If all resumes were already processed in other scans, finish early
      if (resumesToScan.length === 0) {
        try { sessionStorage.removeItem(cfStorageKey); } catch { /* ignore */ }
        return;
      }

      // Split remaining resumes into batches of CF_BATCH_SIZE
      const batches: ParsedResume[][] = [];
      for (let i = 0; i < resumesToScan.length; i += CF_BATCH_SIZE) {
        batches.push(resumesToScan.slice(i, i + CF_BATCH_SIZE));
      }

      setProcessingState(cfKey, { analyzing: true, itemCount: resumesToScan.length, progress: { current: 0, total: batches.length } });

      // Shared accumulator — all workers push here between awaits (JS single-thread = atomic push).
      const allRawCompanies: ExtractedCompany[] = [...extractedCompanies];
      let completedBatches = 0;
      // Shared set of ALL processed resume names (concurrent-safe in JS single-threaded event loop)
      // Include previously scanned names so the resume count is cumulative
      const processedNamesSet = new Set<string>([...existingCFResumeNamesAtStart, ...reusedResumeNames]);

      // Push results + take snapshot + render + persist. Called synchronously between awaits
      // so push + snapshot is atomic across concurrent workers. Returns a promise for the DB save.
      const appendAndRenderCF = async (newRaw: ExtractedCompany[]) => {
        allRawCompanies.push(...newRaw);
        setExtractedCompanies([...allRawCompanies]);
        const processedNames = Array.from(processedNamesSet);
        const freshAggregated = aggregateCFCompanies(allRawCompanies);
        const freshKeys = new Set(freshAggregated.map((c) => c.companyName.trim().toLowerCase()));
        const combined = [
          ...existingCFResultsAtStart.filter((c) => !freshKeys.has(c.companyName.trim().toLowerCase())),
          ...reusedCompanies.filter((c) => !freshKeys.has(c.companyName.trim().toLowerCase())),
          ...freshAggregated,
        ];
        flushSync(() => { setPersistedCompanyResults(combined); });
        await saveCFResultsToDB(combined, processedNames, resolvedScanId);
      };

      const batchQueue = batches.map((batch, idx) => ({ batch, idx }));
      const batchWorker = async () => {
        while (batchQueue.length > 0) {
          const item = batchQueue.shift();
          if (!item) break;

          try {
            const response = await fetchWithRetry("/api/company-finder", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                resumes: item.batch.map((r) => ({ name: r.name, text: r.text })),
                userId: user?.id,
                organizationId: user?.organization_id,
                category: "ats_scoring",
              }),
            });

            // Add this batch's resumes to the shared set — always, regardless of whether
            // companies were found, so the resume count includes all analyzed resumes
            for (const r of item.batch) processedNamesSet.add(r.name);
            const processedNames = Array.from(processedNamesSet);
            setCfScannedResumeNames((prev) =>
              processedNames.length > prev.length ? processedNames : prev
            );

            if (response.ok) {
              const data = await response.json();
              if (data.companies?.length > 0) {
                await appendAndRenderCF(data.companies as ExtractedCompany[]);
              } else {
                // No new companies — still render with current accumulated data + persist resume names
                await appendAndRenderCF([]);
              }
            } else {
              console.warn(`Company Finder batch ${item.idx + 1}/${batches.length} returned ${response.status}`);
            }
          } catch (batchErr) {
            console.error(`Company Finder batch ${item.idx + 1}/${batches.length} failed:`, batchErr);
          }

          completedBatches++;
          setProcessingState(cfKey, { progress: { current: completedBatches, total: batches.length } });
        }
      };

      const workers = Array.from(
        { length: Math.min(CF_CONCURRENCY, batches.length) },
        () => batchWorker()
      );
      await Promise.all(workers);

      // All batches done — clear the restart token
      try { sessionStorage.removeItem(cfStorageKey); } catch { /* ignore */ }

    } catch (err) {
      console.error("Company Finder run failed:", err);
      try { sessionStorage.removeItem(cfStorageKey); } catch { /* ignore */ }
    } finally {
      isRunningCFRef.current = false;
      // Broadcast analyzing=false BEFORE clearing so any newly-subscribed component instance
      // (e.g. after a navigate-away + back) receives the completion signal via its subscriber.
      setProcessingState(`cf_${interviewId}`, { analyzing: false });
      clearProcessingState(`cf_${interviewId}`);
      // Direct call covers the same-instance case (no guard — safe in React 18)
      setCompanyAnalyzing(false);
    }
  };

  const handleClearJd = () => {
    setJdFileName("");
    setJobDescription("");
    // Clear debounce timer
    if (jdSaveTimeoutRef.current) {
      clearTimeout(jdSaveTimeoutRef.current);
    }
    ATSJobService.updateJd(interviewId, "", "").catch((err) => {
      console.error("Failed to clear JD:", err);
    });
  };

  const handleDeleteResult = useCallback(
    async (resumeName: string) => {
      if (!results) return;
      const previousResults = results;
      const updated = results.filter((r) => r.resumeName !== resumeName);
      setResults(updated.length > 0 ? updated : null);

      try {
        await ATSJobService.updateResults(interviewId, updated);
        toast.success("Result deleted");

        // Reconcile companies against remaining ATS results
        if (persistedCompanyResults) {
          const activeNames = new Set(updated.map((r) => r.resumeName));
          const updatedCF = persistedCompanyResults
            .map((c) => {
              const validSources = c.sourceResumes.filter((r) => activeNames.has(r));
              if (validSources.length === 0) return null;
              return validSources.length < c.sourceResumes.length
                ? { ...c, sourceResumes: validSources, frequency: Math.max(1, validSources.length) }
                : c;
            })
            .filter(Boolean) as AggregatedCompany[];
          setPersistedCompanyResults(updatedCF);
          saveCFResultsToDB(updatedCF);
        }
      } catch (err: any) {
        console.error("Failed to delete result:", err);
        toast.error(err?.message || "Failed to delete result from server");
        // Rollback UI to previous state
        setResults(previousResults);
      }
    },
    [results, interviewId, persistedCompanyResults] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Selection state
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());

  const toggleSelect = (resumeName: string) => {
    setSelectedResults((prev) => {
      const next = new Set(prev);
      if (next.has(resumeName)) next.delete(resumeName);
      else next.add(resumeName);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!filteredResults) return;
    if (selectedResults.size === filteredResults.length) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(filteredResults.map((r) => r.resumeName)));
    }
  };

  const handleDeleteSelected = async () => {
    if (!results || selectedResults.size === 0) return;
    const previousResults = results;
    const previousSelected = new Set(selectedResults);
    const deletedNames = new Set(selectedResults);
    const updated = results.filter((r) => !deletedNames.has(r.resumeName));
    setResults(updated.length > 0 ? updated : null);
    setSelectedResults(new Set());

    try {
      await ATSJobService.updateResults(interviewId, updated);
      toast.success(`${deletedNames.size} result(s) deleted`);

      // Reconcile companies against remaining ATS results
      if (persistedCompanyResults) {
        const activeNames = new Set(updated.map((r) => r.resumeName));
        const updatedCF = persistedCompanyResults
          .map((c) => {
            const validSources = c.sourceResumes.filter((r) => activeNames.has(r));
            if (validSources.length === 0) return null;
            return validSources.length < c.sourceResumes.length
              ? { ...c, sourceResumes: validSources, frequency: Math.max(1, validSources.length) }
              : c;
          })
          .filter(Boolean) as AggregatedCompany[];
        setPersistedCompanyResults(updatedCF);
        saveCFResultsToDB(updatedCF);
      }
    } catch (err: any) {
      console.error("Failed to delete results:", err);
      toast.error(err?.message || "Failed to delete results from server");
      // Rollback UI to previous state
      setResults(previousResults);
      setSelectedResults(previousSelected);
    }
  };

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [scoreFilter, setScoreFilter] = useState<"all" | "excellent" | "strong" | "good">("all");
  const [sortBy, setSortBy] = useState<"score" | "name" | "date">("score");

  const canAnalyze =
    jobDescription.trim().length > 0 && resumes.length > 0 && !analyzing;

  const avgScore =
    results && results.length > 0
      ? Math.round(
          results.reduce((sum, r) => sum + normalizeScore(r.overallScore), 0) / results.length * 10
        ) / 10
      : 0;

  // Derived company results — prefer persisted (DB) data; fall back to in-session state
  const companyResults =
    persistedCompanyResults !== null
      ? persistedCompanyResults
      : aggregateCFCompanies(extractedCompanies);

  /** Save aggregated company results to the linked CF scan in Supabase. */
  const saveCFResultsToDB = async (
    aggregated: AggregatedCompany[],
    resumeNames?: string[],
    scanId?: string | null
  ) => {
    try {
      let id = scanId !== undefined ? scanId : cfScanId;
      if (!id) {
        id = await CompanyFinderService.ensureAtsScan(interviewId);
        setCfScanId(id);
      }
      const names =
        resumeNames ??
        Array.from(new Set(aggregated.flatMap((c) => c.sourceResumes)));
      // Build resume URLs from previewUrls + ATS results so Eye buttons work cross-scan
      const urls: Record<string, string> = {};
      for (const n of names) {
        const url = previewUrls[n] || resumeUrlMap[n];
        if (url) urls[n] = url;
      }
      await CompanyFinderService.updateResults(id, {
        results: aggregated,
        resumeNames: names,
        ...(Object.keys(urls).length > 0 && { resumeUrls: urls }),
      });
    } catch (err) {
      console.error("Failed to save company results to DB:", err);
    }
  };

  const filteredCFResults = useMemo(() => companyResults
    .filter((c) => {
      if (cfTypeFilter !== "all" && c.companyType !== cfTypeFilter) return false;
      if (cfSearchQuery.trim()) {
        const q = cfSearchQuery.toLowerCase();
        return (
          c.companyName.toLowerCase().includes(q) ||
          (c.technologies || []).some((t) => t.toLowerCase().includes(q)) ||
          (c.relevantDomains || []).some((d) => d.toLowerCase().includes(q)) ||
          (c.companyInfo || "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) =>
      cfSortBy === "frequency"
        ? b.frequency - a.frequency
        : a.companyName.localeCompare(b.companyName)
    ), [companyResults, cfTypeFilter, cfSearchQuery, cfSortBy]);

  const toggleCFSelect = (companyName: string) => {
    const key = companyName.trim().toLowerCase();
    setSelectedCFCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCFSelectAll = () => {
    if (selectedCFCompanies.size === filteredCFResults.length) {
      setSelectedCFCompanies(new Set());
    } else {
      setSelectedCFCompanies(new Set(filteredCFResults.map((c) => c.companyName.trim().toLowerCase())));
    }
  };

  const handleDeleteCFCompany = (companyName: string) => {
    const key = companyName.trim().toLowerCase();
    setExtractedCompanies((prev) => prev.filter((c) => c.companyName.trim().toLowerCase() !== key));
    const updated = (persistedCompanyResults || []).filter(
      (c) => c.companyName.trim().toLowerCase() !== key
    );
    setPersistedCompanyResults(updated);
    saveCFResultsToDB(updated);
  };

  const handleDeleteCFSelected = () => {
    setExtractedCompanies((prev) =>
      prev.filter((c) => !selectedCFCompanies.has(c.companyName.trim().toLowerCase()))
    );
    const updated = (persistedCompanyResults || []).filter(
      (c) => !selectedCFCompanies.has(c.companyName.trim().toLowerCase())
    );
    setPersistedCompanyResults(updated);
    setSelectedCFCompanies(new Set());
    saveCFResultsToDB(updated);
  };

  // Filtered results
  const filteredResults = useMemo(() => results
    ? results
        .filter((r) => {
          // Score filter (normalized to 0-10 scale)
          const ns = normalizeScore(r.overallScore);
          if (scoreFilter === "excellent" && ns < 8) return false;
          if (scoreFilter === "strong" && ns < 7) return false;
          if (scoreFilter === "good" && ns < 5.5) return false;
          // Search filter
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const candidateName = r.candidateDetails
              ? `${r.candidateDetails.firstName || ""} ${r.candidateDetails.lastName || ""}`.toLowerCase()
              : "";
            return (
              r.resumeName.toLowerCase().includes(q) ||
              candidateName.includes(q) ||
              r.matchedSkills.some((s) => s.toLowerCase().includes(q)) ||
              r.missingSkills.some((s) => s.toLowerCase().includes(q)) ||
              r.summary.toLowerCase().includes(q)
            );
          }
          return true;
        })
        .sort((a, b) => {
          if (sortBy === "score") return b.overallScore - a.overallScore;
          if (sortBy === "name") return a.resumeName.localeCompare(b.resumeName);
          // date
          return (b.scoredAt || "").localeCompare(a.scoredAt || "");
        })
    : null, [results, scoreFilter, searchQuery, sortBy]);

  // Loading state
  if (dataLoading) {
    return (
      <main className="p-8 pt-0 ml-12 mr-auto flex flex-col gap-6">
        <div className="flex items-center gap-4 mt-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1 text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Jobs
          </Button>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {interviewName}
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">Loading...</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 pt-0 ml-12 mr-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between mt-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1 text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Jobs
          </Button>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {interviewName}
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">
              ATS Resume Scoring
            </p>
          </div>
        </div>
        {activeTab === "companies"
          ? companyResults.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportCompanyCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )
          : results && (
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )
        }
      </div>

      {/* Job Description Input */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Job Description</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={jdInputMode}
            onValueChange={(v) => setJdInputMode(v as "text" | "pdf")}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="text">Paste Text</TabsTrigger>
              <TabsTrigger value="pdf">Upload File</TabsTrigger>
            </TabsList>

            <TabsContent value="text">
              <textarea
                className="w-full min-h-[200px] p-4 border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Paste the job description here..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
              {jobDescription && (
                <p className="text-xs text-slate-400 mt-1">
                  {jobDescription.split(/\s+/).filter(Boolean).length} words
                </p>
              )}
            </TabsContent>

            <TabsContent value="pdf">
              {jdFileName && jobDescription ? (
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-700 font-medium">
                        {jdFileName}
                      </span>
                      <Badge className="bg-green-100 text-green-700 text-xs">
                        Parsed
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearJd}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-green-600 mt-1">
                    {jobDescription.split(/\s+/).filter(Boolean).length} words
                    extracted
                  </p>
                </div>
              ) : (
                <div
                  {...getJdRootProps({
                    className:
                      "border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 py-8 flex justify-center items-center flex-col hover:bg-gray-100 transition-colors",
                  })}
                >
                  <input {...getJdInputProps()} />
                  {jdParsing ? (
                    <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
                  ) : (
                    <>
                      <Inbox className="h-8 w-8 text-indigo-400" />
                      <p className="mt-2 text-sm text-slate-500">
                        Drop job description file here
                      </p>
                      <p className="text-xs text-slate-400">PDF or Word, max 10MB</p>
                    </>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Resume Upload */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Upload Resumes</CardTitle>
            <div className="flex items-center gap-2">
              {resumes.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllResumes}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear All
                </Button>
              )}
              <Badge variant="outline" className="text-xs">
                {resumes.length.toLocaleString()} uploaded
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Hidden folder input */}
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            onChange={handleFolderUpload}
            accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            multiple
            {...({ webkitdirectory: "", directory: "" } as any)}
          />

          {/* Upload area */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div
              {...getResumeRootProps({
                className:
                  "border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 py-6 flex justify-center items-center flex-col hover:bg-gray-100 transition-colors",
              })}
            >
              <input {...getResumeInputProps()} />
              <Upload className="h-6 w-6 text-indigo-400" />
              <p className="mt-2 text-sm text-slate-500 text-center">
                Drop resume files here or click to browse
              </p>
              <p className="text-xs text-slate-400">PDF or Word, 10MB each</p>
            </div>

            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={parsingResumes}
              className="border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 py-6 flex justify-center items-center flex-col hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FolderOpen className="h-6 w-6 text-amber-500" />
              <p className="mt-2 text-sm text-slate-500 text-center">
                Upload entire folder
              </p>
              <p className="text-xs text-slate-400">
                Select a folder containing resumes
              </p>
            </button>
          </div>

          {/* Parse progress */}
          {parsingResumes && parseProgress.total > 0 && (
            <div className="mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />
                  <span className="text-sm text-indigo-700">
                    Parsing resumes...
                  </span>
                </div>
                <span className="text-sm font-medium text-indigo-700">
                  {parseProgress.current}/{parseProgress.total}
                </span>
              </div>
              <div className="w-full bg-indigo-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(parseProgress.current / parseProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* File List */}
          {resumes.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto p-1">
                {resumes.map((resume, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full text-sm"
                  >
                    <FileText className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-700 max-w-[200px] truncate">
                      {resume.name}
                    </span>
                    {uploadingFiles.has(resume.name) ? (
                      <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin" />
                    ) : previewUrls[resume.name] ? (
                      <button
                        onClick={() => setViewingResume({ url: previewUrls[resume.name], name: resume.name })}
                        className="hover:bg-indigo-100 rounded-full p-0.5 transition-colors"
                        title="View resume"
                      >
                        <Eye className="h-3.5 w-3.5 text-indigo-500 hover:text-indigo-700" />
                      </button>
                    ) : null}
                    <button
                      onClick={() => removeResume(index)}
                      className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"
                    >
                      <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analyze Button */}
      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          disabled={!canAnalyze}
          onClick={handleAnalyze}
          className="px-8 bg-indigo-600 hover:bg-indigo-700"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analyzing {analyzingCountRef.current.toLocaleString()} resume(s)...
            </>
          ) : (
            <>
              <ScanSearch className="h-4 w-4 mr-2" />
              Analyze {resumes.length > 0 ? `${resumes.length.toLocaleString()} ` : ""}Resume{resumes.length !== 1 ? "s" : ""}
            </>
          )}
        </Button>

        {/* Skipped resumes banner */}
        {skippedInfo && !analyzing && (
          <div className="w-full max-w-2xl p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    {skippedInfo.count} resume(s) skipped
                  </p>
                  <p className="text-xs text-amber-600 mt-1">
                    Already scored for this job. To re-score a resume, delete its existing result first, then analyze again.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {skippedInfo.names.map((name) => (
                      <span
                        key={name}
                        className="inline-block px-2 py-0.5 bg-amber-100 rounded text-[11px] text-amber-700 border border-amber-200 max-w-[250px] truncate"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSkippedInfo(null)}
                className="text-amber-400 hover:text-amber-600 transition-colors flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Analysis progress */}
        {analyzing && analyzeProgress.total > 1 && (
          <div className="w-full max-w-md p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-indigo-700">
                Processing resumes...
              </span>
              <span className="text-sm font-medium text-indigo-700">
                {Math.min(analyzeProgress.current * BATCH_SIZE, analyzingCountRef.current)}/{analyzingCountRef.current} processed
              </span>
            </div>
            <div className="w-full bg-indigo-100 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(Math.min(analyzeProgress.current * BATCH_SIZE, analyzingCountRef.current) / analyzingCountRef.current) * 100}%`,
                }}
              />
            </div>
            {results && results.length > 0 && (
              <p className="text-xs text-indigo-600 mt-2 text-center">{results.length} resumes scored so far — scroll down to view</p>
            )}
          </div>
        )}
      </div>

      {/* Results Section */}
      {results && results.length > 0 && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "ats" | "companies")}>
          <TabsList>
            <TabsTrigger value="ats" className="gap-1.5">
              <ScanSearch className="h-4 w-4" />
              ATS Scoring
            </TabsTrigger>
            {(user?.role === 'admin' || user?.role === 'marketing') && (
              <TabsTrigger value="companies" className="gap-1.5">
                <Building2 className="h-4 w-4" />
                Companies Founded
                {companyAnalyzing && <Loader2 className="h-3 w-3 animate-spin" />}
                {!companyAnalyzing && companyResults.length > 0 && (
                  <span className="ml-0.5 text-[11px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-medium">
                    {companyResults.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="ats" className="mt-4">
          <div className="flex flex-col gap-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-indigo-500" />
                  <div>
                    <p className="text-2xl font-bold">{results.length}</p>
                    <p className="text-xs text-slate-500">Resumes Analyzed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold">{avgScore}</p>
                    <p className="text-xs text-slate-500">Average Score</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Trophy className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold">
                      {results[0] ? normalizeScore(results[0].overallScore) : 0}
                    </p>
                    <p className="text-xs text-slate-500">Highest Score</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <TrendingDown className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="text-2xl font-bold">
                      {results[results.length - 1] ? normalizeScore(results[results.length - 1].overallScore) : 0}
                    </p>
                    <p className="text-xs text-slate-500">Lowest Score</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search resumes, candidates, skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-3">
              <select
                value={scoreFilter}
                onChange={(e) =>
                  setScoreFilter(e.target.value as "all" | "excellent" | "strong" | "good")
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white"
              >
                <option value="all">All Scores</option>
                <option value="excellent">Excellent (80+)</option>
                <option value="strong">Strong (70+)</option>
                <option value="good">Good (55+)</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "score" | "name" | "date")
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white"
              >
                <option value="score">Sort by Score</option>
                <option value="name">Sort by Name</option>
                <option value="date">Sort by Date</option>
              </select>
            </div>
          </div>

          {/* Results count + Select All + Delete Selected */}
          {filteredResults && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={filteredResults.length > 0 && selectedResults.size === filteredResults.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-sm text-slate-600">Select All</span>
                </label>
                <p className="text-sm text-slate-500">
                  Showing {filteredResults.length} of {results.length} results
                  {selectedResults.size > 0 && (
                    <span className="text-indigo-600 font-medium ml-1">
                      ({selectedResults.size} selected)
                    </span>
                  )}
                </p>
              </div>
              {selectedResults.size > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteSelected}
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Selected ({selectedResults.size})
                </Button>
              )}
            </div>
          )}

          {/* Result Cards */}
          <div className="flex flex-col gap-3">
            {filteredResults && filteredResults.length > 0 ? (
              filteredResults.map((result, index) => (
                <div key={result.resumeName} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedResults.has(result.resumeName)}
                    onChange={() => toggleSelect(result.resumeName)}
                    className="h-4 w-4 mt-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <ATSResultCard
                      result={result}
                      rank={index + 1}
                      onDelete={handleDeleteResult}
                      previewUrl={previewUrls[result.resumeName]}
                      isUploading={uploadingFiles.has(result.resumeName)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400 text-center py-6">
                No results match your filters.
              </p>
            )}
          </div>
          </div>
          </TabsContent>

          {/* Companies Founded Tab */}
          {(user?.role === 'admin' || user?.role === 'marketing') && <TabsContent value="companies" className="mt-4">
            {!companyAnalyzing && companyResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
                <Building2 className="h-8 w-8" />
                <p className="text-sm">No companies found yet. Analyze resumes to auto-detect companies.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {/* Inline progress banner — visible while analyzing, replaces old full-screen spinner */}
                {companyAnalyzing && (
                  <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-indigo-700 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Fetching company data from the web…
                      </span>
                      {cfProgress && cfItemCount > 0 && (
                        <span className="text-sm font-medium text-indigo-700">
                          {Math.min(cfProgress.current * CF_BATCH_SIZE, cfItemCount)}/{cfItemCount} processed
                        </span>
                      )}
                    </div>
                    {cfProgress && cfItemCount > 0 && (
                      <div className="w-full bg-indigo-100 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${(Math.min(cfProgress.current * CF_BATCH_SIZE, cfItemCount) / cfItemCount) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-indigo-500" />
                        <div>
                          <p className="text-2xl font-bold">
                            {companyResults.length}
                            {companyAnalyzing && <Loader2 className="inline h-4 w-4 ml-2 animate-spin text-indigo-400" />}
                          </p>
                          <p className="text-xs text-slate-500">Total Companies</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <Users className="h-5 w-5 text-amber-500" />
                        <div>
                          <p className="text-2xl font-bold">{cfScannedResumeNames.length || new Set(companyResults.flatMap((c) => c.sourceResumes)).size || results?.length || 0}</p>
                          <p className="text-xs text-slate-500">Resumes Analyzed</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Filter Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="relative flex-1 w-full sm:max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search companies, technologies, domains..."
                      value={cfSearchQuery}
                      onChange={(e) => setCfSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={cfTypeFilter}
                      onChange={(e) => setCfTypeFilter(e.target.value as "all" | "service_provider" | "service_consumer")}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white"
                    >
                      <option value="all">All Types</option>
                      <option value="service_provider">Service Provider</option>
                      <option value="service_consumer">Service Consumer</option>
                    </select>
                    <select
                      value={cfSortBy}
                      onChange={(e) => setCfSortBy(e.target.value as "frequency" | "name")}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white"
                    >
                      <option value="frequency">Sort by Frequency</option>
                      <option value="name">Sort by Name</option>
                    </select>
                  </div>
                </div>

                {/* Count */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">
                    Showing {filteredCFResults.length} of {companyResults.length} companies
                  </p>
                </div>

                {/* Table */}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Company</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Type</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Description</th>
                        <th className="text-center py-3 px-4 font-medium text-slate-600">Frequency</th>
                        <th className="py-3 px-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCFResults.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                            {companyAnalyzing ? "Scanning resumes for companies…" : "No companies match your filters."}
                          </td>
                        </tr>
                      )}
                      {filteredCFResults.map((company, index) => (
                        <tr
                          key={index}
                          className="border-b last:border-0 hover:bg-slate-50 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <span className="font-medium text-slate-800">{company.companyName}</span>
                            {company.scannedAt && (
                              <span className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                                <Calendar className="h-3 w-3" />
                                {new Date(company.scannedAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              className={`whitespace-nowrap ${
                                company.companyType === "service_provider"
                                  ? "bg-blue-100 text-blue-700 hover:bg-blue-100"
                                  : company.companyType === "service_consumer"
                                  ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-100"
                              }`}
                            >
                              {company.companyType === "service_provider" ? "Provider" : company.companyType === "service_consumer" ? "Consumer" : "Unknown"}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            {company.companyInfo && (
                              <div className="mb-2">
                                <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Company Info</span>
                                <p className="text-xs text-slate-700 mt-0.5">{company.companyInfo}</p>
                                <div className="flex flex-wrap items-center gap-3 mt-1.5">
                                  {company.headquarters && company.headquarters !== "Unknown" && (
                                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                      <MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" />
                                      {company.headquarters}
                                    </span>
                                  )}
                                  {company.foundedYear && company.foundedYear !== "Unknown" && (
                                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                      <Calendar className="h-3 w-3 text-slate-400 flex-shrink-0" />
                                      Est. {company.foundedYear}
                                    </span>
                                  )}
                                  {company.countriesWorkedIn && company.countriesWorkedIn.length > 0 && (
                                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                      <Globe className="h-3 w-3 text-slate-400 flex-shrink-0" />
                                      {company.countriesWorkedIn.join(", ")}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            <div>
                              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Why Selected</span>
                              {(() => {
                                // Build a human-readable reason based on companyType and contexts
                                const isConsumer = company.companyType === "service_consumer";
                                const contextLines = company.contexts.filter(Boolean);
                                let reason = "";
                                if (isConsumer) {
                                  reason = `${company.companyName} is a client/end-user organisation. ${contextLines.length > 0 ? contextLines[0] : ""}`.trim();
                                } else {
                                  reason = contextLines.length > 0 ? contextLines.join(" | ") : `Candidate worked at ${company.companyName}.`;
                                }
                                return <p className="text-xs text-slate-500 mt-0.5">{reason}</p>;
                              })()}
                              {company.sourceResumes && company.sourceResumes.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {company.sourceResumes.map((name) => {
                                    const url = previewUrls[name] || resumeUrlMap[name];
                                    return url ? (
                                      <button
                                        key={name}
                                        onClick={() => setViewingResume({ url, name })}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-[10px] text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-100"
                                      >
                                        <Eye className="h-3 w-3" />
                                        <span className="max-w-[150px] truncate">{name}</span>
                                      </button>
                                    ) : (
                                      <span
                                        key={name}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] text-slate-500 border border-slate-200"
                                      >
                                        <FileText className="h-3 w-3" />
                                        <span className="max-w-[150px] truncate">{name}</span>
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="font-medium text-slate-700">{company.frequency}</span>
                          </td>
                          <td className="py-3 px-2 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
                              onClick={() => handleDeleteCFCompany(company.companyName)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>}
        </Tabs>
      )}

      {viewingResume && (
        <ResumeViewer
          isOpen={true}
          onClose={() => setViewingResume(null)}
          resumeUrl={viewingResume.url}
          assigneeName={viewingResume.name}
          fileName={viewingResume.name}
        />
      )}
    </main>
  );
}
