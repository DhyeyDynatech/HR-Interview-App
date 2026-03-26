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
  AlertCircle,
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
import { ExtractedCompany, AggregatedCompany, CachedCompany, ExtractedCompanyName } from "@/types/company-finder";
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
import { ATSResultsList } from "./ATSResultsList";
import { CompanyResultsList } from "./CompanyResultsList";
import { ATSBatchProcessor } from "./ATSBatchProcessor";

const BATCH_SIZE = 5;
const PARSE_CONCURRENCY = 5; // Balanced for performance and server stability
const API_CONCURRENCY = 3;
const CF_EXTRACT_BATCH_SIZE = 10; // extraction is fast — no web search
const CF_ENRICH_BATCH_SIZE = 5; // enrichment uses web_search — keep small to avoid 504 timeouts
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
  const regex = /From resume [“]([^”]+)[”]/gi;
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
      analyzingCountRef.current = storedAts.itemCount;
      // Reload partial results AND check if batch job is still active on the server.
      // If the job completed while we were away, clear the stale in-memory state
      // so the UI doesn't flash a progress bar then immediately hide it.
      ATSJobService.getJobDetail(interviewId).then((detail) => {
        if (detail.results?.length > 0) setResults(detail.results);

        if (!detail.activeBatchJob && storedAts.batchJobActive) {
          // Job finished while we were away — clear stale processing state
          setAnalyzing(false);
          setBatchJobActive(false);
          isAnalyzingRef.current = false;
          setAnalyzeProgress({ current: 0, total: 0 });
          clearProcessingState(atsKey);
          // Auto-trigger company finder if resumes are available
          try {
            const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
            if (stored && !isRunningCFRef.current) {
              const storedResumes = JSON.parse(stored) as { name: string; text: string; url?: string }[];
              const restoredUrls: Record<string, string> = {};
              for (const r of storedResumes) { if (r.url) restoredUrls[r.name] = r.url; }
              if (Object.keys(restoredUrls).length > 0) previewUrlsRef.current = { ...previewUrlsRef.current, ...restoredUrls };
              if (storedResumes.length > 0) runCompanyFinder(storedResumes as ParsedResume[]);
            }
          } catch { /* ignore */ }
        } else if (detail.activeBatchJob) {
          // Job still running — update progress from server truth
          const done = detail.activeBatchJob.processedItems + detail.activeBatchJob.failedItems;
          setAnalyzeProgress({ current: done, total: detail.activeBatchJob.totalItems });
          setBatchTotal(detail.activeBatchJob.totalItems);
          setProcessingState(atsKey, {
            ...storedAts,
            progress: { current: done, total: detail.activeBatchJob.totalItems },
          });
        }
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
        setBatchJobActive(false);
        setAnalyzeProgress({ current: 0, total: 0 });
        atsRemounted = false;
        return;
      }
      setAnalyzing(s.analyzing);
      setAnalyzeProgress(s.progress);
      analyzingCountRef.current = s.itemCount;
      if (s.batchJobActive) {
        setBatchJobActive(true);
        setBatchTotal(s.batchTotal || s.itemCount);
      }
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
  const [results, setResults] = useState<ATSScoreResult[]>([]);
  const [pagination, setPagination] = useState<{ total: number; offset: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [parsingResumes, setParsingResumes] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0 });

  // Analysis state — initialize directly from processingStore so the progress bar
  // appears on the VERY FIRST render after navigation, not after an effect fires.
  const [analyzing, setAnalyzing] = useState(() => {
    const stored = getProcessingState(`ats_${interviewId}`);
    return stored?.analyzing ?? false;
  });
  const [batchJobActive, setBatchJobActive] = useState(() => {
    const stored = getProcessingState(`ats_${interviewId}`);
    return stored?.batchJobActive ?? false;
  });
  const [batchTotal, setBatchTotal] = useState(() => {
    const stored = getProcessingState(`ats_${interviewId}`);
    return stored?.batchTotal ?? 0;
  });
  const [analyzeProgress, setAnalyzeProgress] = useState(() => {
    const stored = getProcessingState(`ats_${interviewId}`);
    return stored?.progress ?? { current: 0, total: 0 };
  });
  const [creatingAssignees, setCreatingAssignees] = useState(false);
  const [viewingResume, setViewingResume] = useState<{ url: string; name: string } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  // Ref always holds latest previewUrls — used inside async functions to avoid stale closure
  const previewUrlsRef = useRef<Record<string, string>>({});
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const analyzingCountRef = useRef(0);
  const isAnalyzingRef = useRef(false);
  const isRunningCFRef = useRef(false);
  // Holds parsed resumes so company finder can be triggered after ATS batch completes
  const cfPendingResumesRef = useRef<ParsedResume[]>([]);
  // Tracks in-flight / completed blob upload promises keyed by resume name.
  // Shared between uploadFilesForPreview (file-drop) and handleAnalyze so we
  // never upload the same file twice and handleAnalyze can await them all.
  const uploadPromisesRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [skippedInfo, setSkippedInfo] = useState<{ count: number; names: string[] } | null>(null);
  const [failedToParse, setFailedToParse] = useState<{ count: number; names: string[] } | null>(null);
  // Company Finder state
  const [extractedCompanies, setExtractedCompanies] = useState<ExtractedCompany[]>([]);
  // Initialize companyAnalyzing to true immediately if sessionStorage has resume data for this interview
  // AND the processing store confirms CF is still running. This prevents the flash of "No companies
  // found" while the auto-restart effect is pending, but avoids stuck spinners when CF already finished.
  const [companyAnalyzing, setCompanyAnalyzing] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const cfState = getProcessingState(`cf_${interviewId}`);
      if (cfState?.analyzing) {
        // Only treat as truly running if sessionStorage still has resume data
        const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
        if (!stored) return false; // stale store — CF already completed
        return true;
      }
      // Don't pre-set CF analyzing if ATS batch is still running
      const atsState = getProcessingState(`ats_${interviewId}`);
      if (atsState?.batchJobActive || atsState?.analyzing) return false;
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
  const [cfRelevantOnly, setCfRelevantOnly] = useState(true);
  const [selectedCFCompanies, setSelectedCFCompanies] = useState<Set<string>>(new Set());

  // Lightweight polling: when analysis is active, poll getJobDetail every 10s
  // to keep progress updated. This is critical when ATSBatchProcessor's workers
  // time out (MAX_WAITING) due to long-running server-side OpenAI calls returning 202s.
  // This poll keeps the progress bar alive and detects completion reliably.
  useEffect(() => {
    if (!analyzing) return;

    const pollInterval = setInterval(async () => {
      try {
        const detail = await ATSJobService.getJobDetail(interviewId);
        if (detail.results?.length > 0) setResults(detail.results);

        if (detail.activeBatchJob) {
          const done = detail.activeBatchJob.processedItems + detail.activeBatchJob.failedItems;
          const total = detail.activeBatchJob.totalItems;
          setAnalyzeProgress({ current: done, total });
          setBatchTotal(total);
          analyzingCountRef.current = total;

          // Check if all items are actually done even though job status is still "processing".
          // This happens when ATSBatchProcessor workers timed out and no client polls /process
          // to trigger the status transition from "processing" to "completed".
          if (total > 0 && done >= total) {
            // Fire a final /process call to trigger the server-side status transition
            fetch(`/api/ats-scoring/jobs/${interviewId}/process`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ batchSize: 1 }),
            }).catch(() => {});
            // Clear state — job is effectively done
            clearInterval(pollInterval);
            if (detail.results?.length > 0) backfillResumeUrls(detail.results);
            setBatchJobActive(false);
            setAnalyzing(false);
            isAnalyzingRef.current = false;
            setProcessingState(`ats_${interviewId}`, { analyzing: false, batchJobActive: false });
            clearProcessingState(`ats_${interviewId}`);
            // Auto-trigger company finder
            try {
              const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
              if (stored && !isRunningCFRef.current) {
                const storedResumes = JSON.parse(stored) as { name: string; text: string; url?: string }[];
                const restoredUrls: Record<string, string> = {};
                for (const r of storedResumes) { if (r.url) restoredUrls[r.name] = r.url; }
                if (Object.keys(restoredUrls).length > 0) previewUrlsRef.current = { ...previewUrlsRef.current, ...restoredUrls };
                if (storedResumes.length > 0) runCompanyFinder(storedResumes as ParsedResume[]);
              }
            } catch { /* ignore */ }
            return;
          }
        } else {
          // Job completed — load results and clear state
          clearInterval(pollInterval);
          // Backfill missing resume URLs
          if (detail.results?.length > 0) backfillResumeUrls(detail.results);
          setBatchJobActive(false);
          setAnalyzing(false);
          isAnalyzingRef.current = false;
          setProcessingState(`ats_${interviewId}`, { analyzing: false, batchJobActive: false });
          clearProcessingState(`ats_${interviewId}`);
          // Auto-trigger company finder
          try {
            const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
            if (stored && !isRunningCFRef.current) {
              const storedResumes = JSON.parse(stored) as { name: string; text: string; url?: string }[];
              const restoredUrls: Record<string, string> = {};
              for (const r of storedResumes) { if (r.url) restoredUrls[r.name] = r.url; }
              if (Object.keys(restoredUrls).length > 0) previewUrlsRef.current = { ...previewUrlsRef.current, ...restoredUrls };
              if (storedResumes.length > 0) runCompanyFinder(storedResumes as ParsedResume[]);
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore poll errors */ }
    }, 10000);

    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing, interviewId]);

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

  // Keep previewUrlsRef in sync with previewUrls state so async functions always have fresh URLs
  useEffect(() => { previewUrlsRef.current = previewUrls; }, [previewUrls]);

  // Whenever resumeUrlMap gains new URLs, merge them into previewUrls so CF badges are clickable
  useEffect(() => {
    const newEntries = Object.entries(resumeUrlMap).filter(([k]) => !previewUrls[k]);
    if (newEntries.length > 0) {
      const newUrls = Object.fromEntries(newEntries);
      previewUrlsRef.current = { ...previewUrlsRef.current, ...newUrls };
      setPreviewUrls((prev) => ({ ...prev, ...newUrls }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeUrlMap]);

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

        // Restore active batch job from DB if processingStore has no record of it.
        // This covers: hard refresh, or navigating away before setProcessingState was called.
        if (detail.activeBatchJob && !getProcessingState(`ats_${interviewId}`)?.analyzing) {
          const bj = detail.activeBatchJob;
          const done = bj.processedItems + bj.failedItems;
          setAnalyzing(true);
          setBatchJobActive(true);
          setBatchTotal(bj.totalItems);
          setAnalyzeProgress({ current: done, total: bj.totalItems });
          analyzingCountRef.current = bj.totalItems;
          setProcessingState(`ats_${interviewId}`, {
            analyzing: true,
            batchJobActive: true,
            batchTotal: bj.totalItems,
            itemCount: bj.totalItems,
            progress: { current: done, total: bj.totalItems },
          });
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
                previewUrlsRef.current = { ...previewUrlsRef.current, ...cfDetail.resumeUrls };
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
    // verify sessionStorage still has resume data. If not, the store is stale — clear it.
    if (currentState?.analyzing) {
      try {
        const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
        if (!stored) {
          // Store is stale (CF finished but store wasn't cleared) — reset UI
          clearProcessingState(`cf_${interviewId}`);
          setCompanyAnalyzing(false);
          cfAutoRestartAttempted.current = true;
          return;
        }
      } catch { /* ignore */ }
      cfAutoRestartAttempted.current = true;
      return;
    }

    // Do NOT start CF while ATS batch is still in progress.
    // handleBatchComplete will trigger CF automatically once ATS finishes.
    // Don't mark as attempted — the effect will re-run when analyzing/batchJobActive become false.
    if (analyzing || batchJobActive) return;


    try {
      const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
      if (!stored) return;
      const storedResumes = JSON.parse(stored) as { name: string; text: string; url?: string }[];
      if (storedResumes.length === 0) return;
      const restoredUrls: Record<string, string> = {};
      for (const r of storedResumes) { if (r.url) restoredUrls[r.name] = r.url; }
      if (Object.keys(restoredUrls).length > 0) previewUrlsRef.current = { ...previewUrlsRef.current, ...restoredUrls };
      cfAutoRestartAttempted.current = true;
      setCompanyAnalyzing(true);
      runCompanyFinder(storedResumes as ParsedResume[]);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading, interviewId, user?.role, analyzing, batchJobActive]);

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
  // NOTE: We wait 2s before reading from DB so the async saveCFResultsToDB write
  // has time to finish — without this delay the effect reads stale data and reverts
  // the freshly-set in-memory state back to the old results (race condition).
  const prevCompanyAnalyzingRef = useRef(companyAnalyzing);
  useEffect(() => {
    const was = prevCompanyAnalyzingRef.current;
    prevCompanyAnalyzingRef.current = companyAnalyzing;
    if (!was || companyAnalyzing) return; // only on true → false transition

    const timer = setTimeout(async () => {
      try {
        const scanId = cfScanId || await CompanyFinderService.findAtsScanId(interviewId);
        if (!scanId) return;
        const cfDetail = await CompanyFinderService.getScanDetail(scanId);
        if (cfDetail.results?.length > 0) {
          setPersistedCompanyResults((prev) => {
            const dbResults = cfDetail.results as AggregatedCompany[];
            // Only replace in-memory results with DB data if DB has MORE companies.
            // This prevents a stale DB snapshot from overwriting fresher in-memory state.
            if (prev && prev.length >= dbResults.length) return prev;
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
    }, 2000); // Wait for saveCFResultsToDB async write to complete before reading back

    return () => clearTimeout(timer);
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
    const skippedNames: string[] = [];

    const queue = [...pdfFiles];
    let completed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        if (file.size > 10 * 1024 * 1024) {
          skippedCount++;
          skippedNames.push(file.name);
          completed++;
          setParseProgress({ current: completed, total: pdfFiles.length });
          continue;
        }

        try {
          const formData = new FormData();
          formData.append("file", file);
          const result = await parsePdf(formData);

          if (result.success && result.text && result.text.trim().length > 0) {
            newResumes.push({
              name: file.name,
              text: result.text,
              file,
            });
          } else {
            console.warn(`Parse returned empty for ${file.name}:`, result.error || 'empty text');
            skippedCount++;
            skippedNames.push(file.name);
          }
        } catch (err) {
          console.warn(`Parse threw for ${file.name}:`, err);
          skippedCount++;
          skippedNames.push(file.name);
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
      setFailedToParse({ count: skippedCount, names: skippedNames });
      toast.warning(
        `${skippedCount} file(s) could not be parsed. See details below.`
      );
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
    const orgId = user?.organization_id;
    // Skip resumes already tracked (in-flight/done) OR already stored in DB (resumeUrlMap)
    const toUpload = newResumes.filter(
      (r) => !uploadPromisesRef.current.has(r.name) && !resumeUrlMap[r.name] && !previewUrlsRef.current[r.name]
    );
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
                previewUrlsRef.current = { ...previewUrlsRef.current, [resume.name]: resumeUrl };
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

  // Analyze resumes with background queue system (Production Scale)
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
    const newResumes = resumes.filter((r) => !existingNames.has(r.name));

    if (newResumes.length === 0) {
      toast.info("All uploaded resumes have already been scored.");
      isAnalyzingRef.current = false;
      return;
    }

    setAnalyzing(true);
    // Don't activate ATSBatchProcessor yet — wait until queue API confirms job creation.
    // Setting batchJobActive before the DB write completes causes a race: ATSBatchProcessor
    // polls /process immediately, finds the OLD completed job, gets 404, and calls finish().
    setAnalyzeProgress({ current: 0, total: newResumes.length });
    analyzingCountRef.current = newResumes.length;
    setProcessingState(`ats_${interviewId}`, {
      analyzing: true,
      itemCount: newResumes.length,
      progress: { current: 0, total: newResumes.length },
    });

    try {
      // Wait for all blob uploads to finish so resume URLs are available for the queue
      if (uploadPromisesRef.current.size > 0) {
        await Promise.all(Array.from(uploadPromisesRef.current.values()));
      }

      // 1. Queue resumes in chunks (Production safeguard for high volume)
      // Sending 6,000 in one POST would cause '413 Request Entity Too Large'
      const CHUNK_SIZE = 200; // ~1-2MB per chunk
      let totalQueued = 0;
      let activeJobId: string | null = null;

      for (let i = 0; i < newResumes.length; i += CHUNK_SIZE) {
        const chunk = newResumes.slice(i, i + CHUNK_SIZE);

        const response = await ATSJobService.startBatchAnalysis(
          interviewId,
          chunk.map(r => ({ name: r.name, text: r.text, url: previewUrlsRef.current[r.name] || undefined }))
        );

        if (!activeJobId) activeJobId = response.jobId;

        totalQueued += chunk.length;
        setAnalyzeProgress({ current: totalQueued, total: newResumes.length });

        // Remove successfully queued resumes from memory to prevent browser lag
        const chunkNames = new Set(chunk.map(c => c.name));
        setResumes(prev => prev.filter(r => !chunkNames.has(r.name)));
      }

      // 2. All chunks queued — job is now confirmed in DB. Activate the batch processor.
      setBatchJobActive(true);
      setBatchTotal(newResumes.length);
      setProcessingState(`ats_${interviewId}`, {
        analyzing: true,
        batchJobActive: true,
        batchTotal: newResumes.length,
        itemCount: newResumes.length,
        progress: { current: 0, total: newResumes.length },
      });

      // Save resumes for CF auto-trigger after ATS completes
      cfPendingResumesRef.current = newResumes;
      try {
        sessionStorage.setItem(
          `cf_resumes_${interviewId}`,
          JSON.stringify(newResumes.map((r) => ({ name: r.name, text: r.text, url: previewUrlsRef.current[r.name] || undefined })))
        );
      } catch { /* ignore */ }
      setAnalyzeProgress({ current: 0, total: newResumes.length });
      toast.success(`Queued ${newResumes.length} resumes — AI analysis starting...`);
      
    } catch (error: any) {
      console.error("Failed to start analysis:", error);
      toast.error("Failed to start analysis", {
        description: error.message || "An unexpected error occurred while queueing."
      });
      // Queue failed — reset all processing state
      setAnalyzing(false);
      setBatchJobActive(false);
      isAnalyzingRef.current = false;
      clearProcessingState(`ats_${interviewId}`);
    }
  };

  // Backfill missing resume_url in ats_score_items using previewUrls from blob uploads.
  // The batch process route doesn't save resume_url, so we patch it after scoring completes.
  // This makes CF resume badges clickable on subsequent page loads.
  const backfillResumeUrls = async (scoredResults: ATSScoreResult[]) => {
    const urlUpdates: { resumeName: string; resumeUrl: string }[] = [];
    for (const r of scoredResults) {
      if (!r.resumeUrl) {
        const url = previewUrlsRef.current[r.resumeName];
        if (url) urlUpdates.push({ resumeName: r.resumeName, resumeUrl: url });
      }
    }
    if (urlUpdates.length === 0) return;

    try {
      await fetch(`/api/ats-scoring/jobs/${interviewId}/urls`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: urlUpdates }),
      });
    } catch {
      // Non-critical — URLs will just remain unclickable until next upload
    }
  };

  const handleBatchComplete = () => {
    // If the component is unmounted (user navigated away), do NOT clear the processing store.
    // Clearing it would prevent the next mount from restoring the batch processor.
    // When the user returns, ATSBatchProcessor will remount, poll, get a 404 (job done),
    // and call onComplete() again — this time with the component mounted.
    if (!mountedRef.current) return;

    // Check server truth before clearing state. ATSBatchProcessor might have timed out
    // (MAX_WAITING) while the server-side OpenAI calls are still running. In that case,
    // keep batchJobActive=true so the polling effect continues tracking progress.
    ATSJobService.getJobDetail(interviewId).then(data => {
       if (data.results?.length > 0) setResults(data.results);
       if (data.pagination) setPagination(data.pagination);

       if (data.activeBatchJob) {
         // Job is STILL running on server — ATSBatchProcessor timed out (MAX_WAITING)
         // but server-side OpenAI calls are still processing.
         // Unmount ATSBatchProcessor (its workers keep failing with 202s) but keep
         // analyzing=true so the simple progress bar shows instead.
         // The polling effect will continue tracking progress via getJobDetail.
         const done = data.activeBatchJob.processedItems + data.activeBatchJob.failedItems;
         setBatchJobActive(false); // unmount ATSBatchProcessor
         setAnalyzing(true);       // keep progress bar visible
         isAnalyzingRef.current = true;
         setBatchTotal(data.activeBatchJob.totalItems);
         analyzingCountRef.current = data.activeBatchJob.totalItems;
         setAnalyzeProgress({ current: done, total: data.activeBatchJob.totalItems });
         setProcessingState(`ats_${interviewId}`, {
           analyzing: true,
           batchJobActive: false,
           batchTotal: data.activeBatchJob.totalItems,
           itemCount: data.activeBatchJob.totalItems,
           progress: { current: done, total: data.activeBatchJob.totalItems },
         });
         return;
       }

       // Backfill any missing resume URLs before clearing state
       if (data.results?.length > 0) backfillResumeUrls(data.results);

       // Job truly completed — safe to clear state
       setBatchJobActive(false);
       setAnalyzing(false);
       isAnalyzingRef.current = false;
       setProcessingState(`ats_${interviewId}`, { analyzing: false, batchJobActive: false });
       clearProcessingState(`ats_${interviewId}`);

       // Auto-trigger company finder with the resumes we saved before clearing state
       const resumesForCF = cfPendingResumesRef.current;
       if (resumesForCF.length > 0 && !isRunningCFRef.current) {
         cfPendingResumesRef.current = [];
         runCompanyFinder(resumesForCF);
       } else if (!isRunningCFRef.current) {
         // Fallback: ref was cleared (post-navigation remount) — try sessionStorage
         try {
           const stored = sessionStorage.getItem(`cf_resumes_${interviewId}`);
           if (stored) {
             const storedResumes = JSON.parse(stored) as { name: string; text: string; url?: string }[];
             const restoredUrls: Record<string, string> = {};
             for (const r of storedResumes) { if (r.url) restoredUrls[r.name] = r.url; }
             if (Object.keys(restoredUrls).length > 0) previewUrlsRef.current = { ...previewUrlsRef.current, ...restoredUrls };
             if (storedResumes.length > 0) runCompanyFinder(storedResumes as ParsedResume[]);
           }
         } catch { /* ignore */ }
       }
    });
  };

  // Export company results as CSV (Companies Founded tab)
  const exportCompanyCSV = () => {
    if (!filteredCFResults || filteredCFResults.length === 0) return;

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
      "Is Dynatech Relevant",
    ];

    const isDynaTechRelevant = (c: AggregatedCompany) => {
      const fields = [c.companyName, c.companyInfo || "", ...(c.technologies || []), ...(c.contexts || [])].join(" ").toLowerCase();
      return /\bdynamics\b/.test(fields) || /\bsap\b/.test(fields);
    };

    const rows = filteredCFResults.map((c: AggregatedCompany) => [
      `"${c.companyName.replace(/"/g, '""')}"`,
      c.companyType === "service_provider" ? "Service Provider" : c.companyType === "service_consumer" ? "Service Consumer" : "Unknown",
      `"${(c.companyInfo || "").replace(/"/g, '""')}"`,
      `"${(c.headquarters || "").replace(/"/g, '""')}"`,
      c.foundedYear || "",
      `"${(c.countriesWorkedIn || []).join(", ").replace(/"/g, '""')}"`,
      c.frequency,
      `"${(c.sourceResumes || []).join(", ").replace(/"/g, '""')}"`,
      `"${(c.contexts || []).join(" | ").replace(/"/g, '""')}"`,
      isDynaTechRelevant(c) ? "True" : "False",
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
            const orgId = user?.organization_id;
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
      const existingCFResultsAtStart: AggregatedCompany[] = persistedCompanyResults || [];
      const existingCFResumeNamesAtStart: string[] = cfScannedResumeNames || [];
      cfAutoRestartAttempted.current = true;
      const CF_CONCURRENCY = 3;

      // Persist resume texts so we can auto-restart if the page is refreshed mid-run
      try {
        sessionStorage.setItem(cfStorageKey, JSON.stringify(
          resumesToScan.map((r) => ({ name: r.name, text: r.text, url: previewUrlsRef.current[r.name] || undefined }))
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
          if (Object.keys(crossScan.resumeUrls).length > 0) {
            previewUrlsRef.current = { ...previewUrlsRef.current, ...crossScan.resumeUrls };
            setPreviewUrls((prev) => ({ ...prev, ...crossScan.resumeUrls }));
          }
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
        flushSync(() => { setPersistedCompanyResults(merged); });
        const names = Array.from(new Set([
          ...existingCFResumeNamesAtStart,
          ...reusedResumeNames,
          ...merged.flatMap((c) => c.sourceResumes),
        ]));
        setCfScannedResumeNames((prev) => names.length > prev.length ? names : prev);
        await saveCFResultsToDB(merged, names, resolvedScanId);
      }

      // If all resumes were already processed in other scans, finish early
      if (resumesToScan.length === 0) {
        // Still update the resume count so the card shows the correct number
        const allNames = Array.from(new Set([...existingCFResumeNamesAtStart, ...reusedResumeNames]));
        setCfScannedResumeNames(allNames);
        try { sessionStorage.removeItem(cfStorageKey); } catch { /* ignore */ }
        return;
      }

      const scannedAt = new Date().toISOString();
      const processedNamesSet = new Set<string>([...existingCFResumeNamesAtStart, ...reusedResumeNames]);

      // ═══════════════════════════════════════════════════════════════════
      // STAGE A — Extract company names from resumes (gpt-5-mini, fast)
      // ═══════════════════════════════════════════════════════════════════
      const extractBatches: ParsedResume[][] = [];
      for (let i = 0; i < resumesToScan.length; i += CF_EXTRACT_BATCH_SIZE) {
        extractBatches.push(resumesToScan.slice(i, i + CF_EXTRACT_BATCH_SIZE));
      }

      const totalResumes = resumesToScan.length;
      setProcessingState(cfKey, { analyzing: true, itemCount: totalResumes, progress: { current: 0, total: totalResumes } });

      const allExtractedNames: ExtractedCompanyName[] = [];
      let resumesExtracted = 0;

      // Helper: build AggregatedCompany[] from extracted names + available enrichment data
      const buildPartialResults = (enrichedCached: CachedCompany[]): AggregatedCompany[] => {
        const enrichedMap = new Map<string, CachedCompany>();
        for (const c of enrichedCached) {
          enrichedMap.set(c.companyName.toLowerCase().trim().replace(/\s+/g, " "), c);
        }
        const companyMap = new Map<string, AggregatedCompany>();
        for (const ext of allExtractedNames) {
          const key = ext.companyName.toLowerCase().trim().replace(/\s+/g, " ");
          const enriched = enrichedMap.get(key);
          const existing = companyMap.get(key);
          if (existing) {
            existing.contexts.push(ext.context);
            if (ext.resumeName && !existing.sourceResumes.includes(ext.resumeName)) {
              existing.sourceResumes.push(ext.resumeName);
            }
            existing.frequency = existing.sourceResumes.length;
          } else {
            companyMap.set(key, {
              companyName: enriched?.companyName || ext.companyName,
              companyType: enriched?.companyType || "unknown",
              companyInfo: enriched?.companyInfo || "",
              headquarters: enriched?.headquarters || "",
              foundedYear: enriched?.foundedYear || "",
              countriesWorkedIn: enriched?.countriesWorkedIn || [],
              technologies: [],
              relevantDomains: [],
              sourceResumes: ext.resumeName ? [ext.resumeName] : [],
              frequency: 1,
              contexts: [ext.context],
              scannedAt,
            });
          }
        }
        const aggregated = Array.from(companyMap.values()).sort((a, b) => b.frequency - a.frequency);
        const newKeys = new Set(aggregated.map((c) => c.companyName.trim().toLowerCase()));
        return [
          ...existingCFResultsAtStart.filter((c) => !newKeys.has(c.companyName.trim().toLowerCase())),
          ...reusedCompanies.filter((c) => !newKeys.has(c.companyName.trim().toLowerCase())),
          ...aggregated,
        ];
      };

      const extractQueue = extractBatches.map((batch, idx) => ({ batch, idx }));
      const extractWorker = async () => {
        while (extractQueue.length > 0) {
          const item = extractQueue.shift();
          if (!item) break;
          try {
            const names = await CompanyFinderService.extractCompanyNames(
              item.batch.map((r) => ({ name: r.name, text: r.text })),
              user?.id,
              user?.organization_id
            );
            allExtractedNames.push(...names);
          } catch (err) {
            console.error(`CF extraction batch ${item.idx + 1} failed:`, err);
          }
          // Track resume names regardless of extraction success
          for (const r of item.batch) processedNamesSet.add(r.name);
          const processedNames = Array.from(processedNamesSet);
          setCfScannedResumeNames((prev) =>
            processedNames.length > prev.length ? processedNames : prev
          );
          // Resume-based progress (not step-based)
          resumesExtracted = Math.min(resumesExtracted + item.batch.length, totalResumes);
          setProcessingState(cfKey, { progress: { current: resumesExtracted, total: totalResumes } });
          // Save resume names to DB so they survive tab/page navigation during active run.
          // Use updateResumeNames (not saveCFResultsToDB) to avoid overwriting company results.
          if (resolvedScanId) {
            const urlsForSave: Record<string, string> = {};
            for (const n of processedNames) {
              const u = previewUrlsRef.current[n] || resumeUrlMap[n];
              if (u) urlsForSave[n] = u;
            }
            CompanyFinderService.updateResumeNames(resolvedScanId, processedNames, urlsForSave).catch(() => {});
          }
        }
      };
      const extractWorkers = Array.from(
        { length: Math.min(CF_CONCURRENCY, extractBatches.length) },
        () => extractWorker()
      );
      await Promise.all(extractWorkers);

      // Deduplicate company names
      const uniqueCompanyNames = Array.from(
        new Set(allExtractedNames.map((c) => c.companyName.trim()))
      ).filter(Boolean);

      if (uniqueCompanyNames.length === 0 && reusedCompanies.length === 0) {
        // No companies found — still save resume names
        const processedNames = Array.from(processedNamesSet);
        await saveCFResultsToDB(existingCFResultsAtStart, processedNames, resolvedScanId);
        try { sessionStorage.removeItem(cfStorageKey); } catch { /* ignore */ }
        return;
      }

      // Show partial (extraction-only) companies immediately so the list isn't empty during enrichment
      if (allExtractedNames.length > 0) {
        setPersistedCompanyResults(buildPartialResults([]));
      }

      // ═══════════════════════════════════════════════════════════════════
      // STAGE B — Cache lookup
      // ═══════════════════════════════════════════════════════════════════
      let cachedCompanies: CachedCompany[] = [];
      let cacheMisses: string[] = uniqueCompanyNames;
      try {
        const cacheResult = await CompanyFinderService.lookupCache(uniqueCompanyNames);
        cachedCompanies = cacheResult.cached;
        cacheMisses = cacheResult.misses;
      } catch (err) {
        console.error("Cache lookup failed, enriching all:", err);
      }
      // Show companies updated with cached data immediately
      if (cachedCompanies.length > 0) {
        setPersistedCompanyResults(buildPartialResults(cachedCompanies));
      }

      // ═══════════════════════════════════════════════════════════════════
      // STAGE C — Enrich cache misses via web search
      // ═══════════════════════════════════════════════════════════════════
      let freshlyEnriched: CachedCompany[] = [];
      if (cacheMisses.length > 0) {
        const enrichBatches: string[][] = [];
        for (let i = 0; i < cacheMisses.length; i += CF_ENRICH_BATCH_SIZE) {
          enrichBatches.push(cacheMisses.slice(i, i + CF_ENRICH_BATCH_SIZE));
        }

        const enrichQueue = enrichBatches.map((batch, idx) => ({ batch, idx }));
        const enrichWorker = async () => {
          while (enrichQueue.length > 0) {
            const item = enrichQueue.shift();
            if (!item) break;
            try {
              const enriched = await CompanyFinderService.enrichAndCache(
                item.batch,
                user?.id,
                user?.organization_id,
                "ats_scoring"
              );
              freshlyEnriched.push(...enriched);
            } catch (err) {
              console.error(`CF enrichment batch ${item.idx + 1} failed:`, err);
            }
            // Update companies progressively after each enrichment batch
            setPersistedCompanyResults(buildPartialResults([...cachedCompanies, ...freshlyEnriched]));
          }
        };
        const enrichWorkers = Array.from(
          { length: Math.min(CF_CONCURRENCY, enrichBatches.length) },
          () => enrichWorker()
        );
        await Promise.all(enrichWorkers);
      }

      // ═══════════════════════════════════════════════════════════════════
      // MERGE — Combine cached + enriched + resume contexts → AggregatedCompany[]
      // ═══════════════════════════════════════════════════════════════════
      const allEnrichedMap = new Map<string, CachedCompany>();
      for (const c of [...cachedCompanies, ...freshlyEnriched]) {
        const key = c.companyName.toLowerCase().trim().replace(/\s+/g, " ");
        allEnrichedMap.set(key, c);
      }

      // Build AggregatedCompany[] by joining extraction data with enrichment
      const companyMap = new Map<string, AggregatedCompany>();
      for (const ext of allExtractedNames) {
        const key = ext.companyName.toLowerCase().trim().replace(/\s+/g, " ");
        const enriched = allEnrichedMap.get(key);
        const existing = companyMap.get(key);

        if (existing) {
          existing.contexts.push(ext.context);
          if (ext.resumeName && !existing.sourceResumes.includes(ext.resumeName)) {
            existing.sourceResumes.push(ext.resumeName);
          }
          existing.frequency = existing.sourceResumes.length;
        } else {
          companyMap.set(key, {
            companyName: enriched?.companyName || ext.companyName,
            companyType: enriched?.companyType || "unknown",
            companyInfo: enriched?.companyInfo || "",
            headquarters: enriched?.headquarters || "",
            foundedYear: enriched?.foundedYear || "",
            countriesWorkedIn: enriched?.countriesWorkedIn || [],
            technologies: [],
            relevantDomains: [],
            sourceResumes: ext.resumeName ? [ext.resumeName] : [],
            frequency: 1,
            contexts: [ext.context],
            scannedAt,
          });
        }
      }

      const newAggregated = Array.from(companyMap.values());
      newAggregated.sort((a, b) => b.frequency - a.frequency);

      // Merge: reused + new + existing
      const newCompanyKeys = new Set(newAggregated.map((c) => c.companyName.trim().toLowerCase()));
      const combined = [
        ...existingCFResultsAtStart.filter((c) => !newCompanyKeys.has(c.companyName.trim().toLowerCase())),
        ...reusedCompanies.filter((c) => !newCompanyKeys.has(c.companyName.trim().toLowerCase())),
        ...newAggregated,
      ];

      flushSync(() => { setPersistedCompanyResults(combined); });
      setExtractedCompanies([]); // no longer accumulating raw companies in 3-stage mode
      const processedNames = Array.from(processedNamesSet);
      setCfScannedResumeNames((prev) =>
        processedNames.length > prev.length ? processedNames : prev
      );
      await saveCFResultsToDB(combined, processedNames, resolvedScanId);

      // All done — clear the restart token
      try { sessionStorage.removeItem(cfStorageKey); } catch { /* ignore */ }

    } catch (err) {
      console.error("Company Finder run failed:", err);
      try { sessionStorage.removeItem(`cf_resumes_${interviewId}`); } catch { /* ignore */ }
    } finally {
      isRunningCFRef.current = false;
      setProcessingState(`cf_${interviewId}`, { analyzing: false });
      clearProcessingState(`cf_${interviewId}`);
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
      const previousResults = results;
      const updated = results.filter((r) => r.resumeName !== resumeName);
      setResults(updated);

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
    [results, interviewId, persistedCompanyResults] // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (selectedResults.size === 0) return;
    const previousResults = results;
    const previousSelected = new Set(selectedResults);
    const deletedNames = new Set(selectedResults);
    const updated = results.filter((r) => !deletedNames.has(r.resumeName));
    setResults(updated);
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
      // Build resume URLs — use ref for freshest data (avoids stale closure in long async runs)
      const urls: Record<string, string> = {};
      for (const n of names) {
        const url = previewUrlsRef.current[n] || resumeUrlMap[n] || previewUrls[n];
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
      if (cfRelevantOnly) {
        const fields = [c.companyName, c.companyInfo || "", ...(c.technologies || []), ...(c.contexts || [])].join(" ").toLowerCase();
        if (!/\bdynamics\b/.test(fields) && !/\bsap\b/.test(fields)) return false;
      }
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
    ), [companyResults, cfTypeFilter, cfSearchQuery, cfSortBy, cfRelevantOnly]);

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

      {/* Resume Upload — hidden while batch processing is active */}
      <Card className={batchJobActive ? "hidden" : ""}>
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

        {/* Skipped resumes banner (Already scored) */}
        {skippedInfo && !analyzing && (
          <div className="w-full max-w-2xl p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    {skippedInfo.count} resume(s) already scored
                  </p>
                  <p className="text-xs text-amber-600 mt-1">
                    These were already scored for this job. To re-score, delete the existing result first.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2 overflow-y-auto max-h-[100px]">
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

        {/* Failed to parse banner */}
        {failedToParse && !analyzing && (
          <div className="w-full max-w-2xl p-4 bg-red-50 rounded-lg border border-red-200 mt-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">
                    {failedToParse.count} file(s) failed to parse
                  </p>
                  <p className="text-xs text-red-600 mt-1">
                    These files might be empty, corrupted, scanned (images), or too large (&gt;10MB).
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2 overflow-y-auto max-h-[100px]">
                    {failedToParse.names.map((name) => (
                      <span
                        key={name}
                        className="inline-block px-2 py-0.5 bg-red-100 rounded text-[11px] text-red-700 border border-red-200 max-w-[250px] truncate"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setFailedToParse(null)}
                className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Analysis progress — only show during queuing phase, not when ATSBatchProcessor is active */}
        {analyzing && !batchJobActive && analyzeProgress.total > 1 && (
          <div className="w-full max-w-md p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-indigo-700">
                Processing resumes...
              </span>
              <span className="text-sm font-medium text-indigo-700">
                {Math.min(analyzeProgress.current, analyzingCountRef.current)}/{analyzingCountRef.current} processed
              </span>
            </div>
            <div className="w-full bg-indigo-100 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(Math.min(analyzeProgress.current, analyzingCountRef.current) / Math.max(1, analyzingCountRef.current)) * 100}%`,
                }}
              />
            </div>
            {results && results.length > 0 && (
              <p className="text-xs text-indigo-600 mt-2 text-center">{results.length} resumes scored so far — scroll down to view</p>
            )}
          </div>
        )}
      </div>

      {/* Batch Processor — lives OUTSIDE tabs so it never unmounts when switching tabs */}
      {batchJobActive && (
        <ATSBatchProcessor
          interviewId={interviewId}
          totalItems={batchTotal}
          initialScored={analyzeProgress.current}
          onComplete={handleBatchComplete}
          onProgress={(curr) => {
            setAnalyzeProgress({ current: curr, total: batchTotal });
            setProcessingState(`ats_${interviewId}`, { progress: { current: curr, total: batchTotal } });
            // Fetch scored results from DB after each batch so they show progressively
            if (curr > 0) {
              ATSJobService.getJobDetail(interviewId)
                .then((detail) => { if (detail.results?.length > 0) setResults(detail.results); })
                .catch(() => {});
            }
          }}
          isProcessing={analyzing}
          setIsProcessing={setAnalyzing}
        />
      )}

      {/* Results Section */}
      {((results && results.length > 0) || batchJobActive || analyzing) && (
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
                {!companyAnalyzing && !analyzing && !batchJobActive && companyResults.length > 0 && (
                  <span className="ml-0.5 text-[11px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-medium">
                    {companyResults.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="ats" className="mt-4 focus-visible:outline-none">
            <div className="flex flex-col gap-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-indigo-50 to-white border-indigo-100 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-500/10 rounded-lg">
                        <Users className="h-5 w-5 text-indigo-500" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{(results || []).length.toLocaleString()}</p>
                        <p className="text-xs text-slate-500">Resumes Analyzed</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 rounded-lg">
                        <BarChart3 className="h-5 w-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{avgScore}</p>
                        <p className="text-xs text-slate-500">Average Score</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-50 to-white border-green-100 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 rounded-lg">
                        <Trophy className="h-5 w-5 text-green-500" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {results?.[0] ? normalizeScore(results[0].overallScore) : 0}
                        </p>
                        <p className="text-xs text-slate-500">Highest Score</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-red-50 to-white border-red-100 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-red-500/10 rounded-lg">
                        <TrendingDown className="h-5 w-5 text-red-500" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {results?.[results.length - 1] ? normalizeScore(results[results.length - 1].overallScore) : 0}
                        </p>
                        <p className="text-xs text-slate-500">Lowest Score</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Filter Bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-white p-3 rounded-xl border shadow-sm">
                <div className="relative flex-1 w-full sm:max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search resumes, skills, candidates..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={scoreFilter}
                    onChange={(e) => setScoreFilter(e.target.value as any)}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  >
                    <option value="all">All Scores</option>
                    <option value="excellent">Excellent (8+)</option>
                    <option value="strong">Strong (7+)</option>
                    <option value="good">Good (5.5+)</option>
                  </select>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  >
                    <option value="score">Sort by Score</option>
                    <option value="name">Sort by Name</option>
                    <option value="date">Sort by Date</option>
                  </select>
                </div>
              </div>

              {/* Virtualized ATS Results */}
              {filteredResults && (
                <ATSResultsList
                  results={filteredResults}
                  selectedResults={selectedResults}
                  toggleSelect={toggleSelect}
                  toggleSelectAll={toggleSelectAll}
                  handleDeleteResult={handleDeleteResult}
                  handleDeleteSelected={handleDeleteSelected}
                  previewUrls={previewUrls}
                  uploadingFiles={uploadingFiles}
                  searchQuery={searchQuery}
                />
              )}
            </div>
          </TabsContent>

          {(user?.role === "admin" || user?.role === "marketing") && (
            <TabsContent value="companies" className="mt-4 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
                {/* ATS scoring in progress — company results may be stale */}
                {(analyzing || batchJobActive) && companyResults.length > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 text-amber-600" />
                    <span>ATS scoring is in progress. Company data shown below is from a previous run and will update once scoring completes.</span>
                  </div>
                )}
                {/* Inline extraction progress */}
                {companyAnalyzing && (
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                          <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-indigo-900">
                            {cfProgress && cfProgress.current < cfProgress.total
                              ? "Scanning Resumes"
                              : "Enriching Companies"}
                          </p>
                          <p className="text-xs text-indigo-600">
                            {cfProgress && cfProgress.total > 0
                              ? cfProgress.current < cfProgress.total
                                ? `${cfProgress.current} of ${cfProgress.total} resumes scanned`
                                : `${cfProgress.total} of ${cfProgress.total} resumes scanned — enriching company data…`
                              : "This happens in the background. You can browse results so far."}
                          </p>
                        </div>
                      </div>
                      {cfProgress && cfProgress.total > 0 && (
                        <span className="text-sm font-bold text-indigo-700">
                          {Math.min(100, Math.round((cfProgress.current / cfProgress.total) * 100))}%
                        </span>
                      )}
                    </div>
                    {cfProgress && cfProgress.total > 0 && (
                      <div className="h-1.5 w-full bg-indigo-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${Math.min(100, Math.round((cfProgress.current / cfProgress.total) * 100))}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Companies Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="bg-gradient-to-br from-indigo-50 to-white border-indigo-100 shadow-sm">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/10 rounded-lg">
                          <Building2 className="h-5 w-5 text-indigo-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{companyResults.length.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">Total Unique Companies</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-100 shadow-sm">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/10 rounded-lg">
                          <Users className="h-5 w-5 text-amber-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{cfScannedResumeNames.length.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">Resumes Processed</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Company Filter Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-white p-3 rounded-xl border shadow-sm">
                  <button
                    onClick={() => setCfRelevantOnly((v) => !v)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      cfRelevantOnly
                        ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${cfRelevantOnly ? "bg-white" : "bg-slate-400"}`} />
                    Dynatech Relevant
                  </button>
                  <div className="relative flex-1 w-full sm:max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search companies, HQ, info..."
                      value={cfSearchQuery}
                      onChange={(e) => setCfSearchQuery(e.target.value)}
                      className="pl-9 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={cfTypeFilter}
                      onChange={(e) => setCfTypeFilter(e.target.value as "all" | "service_provider" | "service_consumer")}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    >
                      <option value="all">All Types</option>
                      <option value="service_provider">Providers</option>
                      <option value="service_consumer">Consumers</option>
                    </select>
                    <select
                      value={cfSortBy}
                      onChange={(e) => setCfSortBy(e.target.value as "frequency" | "name")}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    >
                      <option value="frequency">Sort by Freq</option>
                      <option value="name">Sort by Name</option>
                    </select>
                  </div>
                </div>

                {/* Select All / Bulk Delete bar */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">
                    Showing {filteredCFResults.length.toLocaleString()} companies
                    {selectedCFCompanies.size > 0 && (
                      <span className="text-indigo-600 font-medium ml-1">
                        ({selectedCFCompanies.size.toLocaleString()} selected)
                      </span>
                    )}
                  </p>
                  {selectedCFCompanies.size > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteCFSelected}
                      className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 gap-1.5"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Selected ({selectedCFCompanies.size.toLocaleString()})
                    </Button>
                  )}
                </div>

                {/* Company List */}
                <CompanyResultsList
                  companies={filteredCFResults}
                  previewUrls={previewUrls}
                  resumeUrlMap={resumeUrlMap}
                  onViewResume={(url, name) => setViewingResume({ url, name })}
                  selectedCompanies={selectedCFCompanies}
                  onToggleSelect={toggleCFSelect}
                  onToggleSelectAll={toggleCFSelectAll}
                  onDeleteCompany={handleDeleteCFCompany}
                />
              </div>
            </TabsContent>
          )}
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
