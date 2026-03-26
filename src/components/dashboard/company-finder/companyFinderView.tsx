"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/auth.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2,
  Upload,
  FileText,
  X,
  Loader2,
  Download,
  Search,
  FolderOpen,
  Trash2,
  Users,
  Eye,
  AlertTriangle,
  Calendar,
  MapPin,
  Globe,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { parsePdf } from "@/actions/parse-pdf";
import {
  CFParsedResume,
  ExtractedCompany,
  AggregatedCompany,
  CompanyType,
} from "@/types/company-finder";
import { CompanyFinderService } from "@/services/company-finder.service";
import { CFBatchProcessor } from "./CFBatchProcessor";
import { ResumeViewer } from "@/components/dashboard/user/ResumeViewer";
import {
  getProcessingState,
  setProcessingState,
  subscribeProcessing,
  clearProcessingState,
} from "@/lib/processing-store";
import { PaginationControls } from "@/components/ui/pagination-controls";

const PARSE_CONCURRENCY = 5;

// Extract resume filenames from context strings like: From resume "filename.pdf"
// ---------- Aggregation ----------

function aggregateCompanies(raw: ExtractedCompany[]): AggregatedCompany[] {
  const map = new Map<string, AggregatedCompany>();

  for (const c of raw) {
    const key = c.companyName.trim().toLowerCase();
    const existing = map.get(key);

    if (existing) {
      // Merge technologies
      for (const t of (c.technologies || [])) {
        if (!existing.technologies.includes(t)) existing.technologies.push(t);
      }
      // Merge domains
      for (const d of (c.relevantDomains || [])) {
        if (!existing.relevantDomains.includes(d))
          existing.relevantDomains.push(d);
      }
      // Keep factual fields from first occurrence if current is missing
      if (!existing.companyInfo && c.companyInfo) existing.companyInfo = c.companyInfo;
      if (!existing.headquarters && c.headquarters) existing.headquarters = c.headquarters;
      if (!existing.foundedYear && c.foundedYear) existing.foundedYear = c.foundedYear;
      // Merge countries from all occurrences (different batches may return different lists)
      if (c.countriesWorkedIn?.length) {
        if (!existing.countriesWorkedIn?.length) {
          existing.countriesWorkedIn = [...c.countriesWorkedIn];
        } else {
          for (const country of c.countriesWorkedIn) {
            if (!existing.countriesWorkedIn.includes(country)) {
              existing.countriesWorkedIn.push(country);
            }
          }
        }
      }
      // Add context and source resume
      existing.contexts.push(c.context);
      if ((c as any).resumeName && !existing.sourceResumes.includes((c as any).resumeName)) {
        existing.sourceResumes.push((c as any).resumeName);
      }
      existing.frequency++;
    } else {
      map.set(key, {
        companyName: c.companyName,
        companyType: c.companyType || "unknown",
        companyInfo: c.companyInfo || "",
        headquarters: c.headquarters || "",
        foundedYear: c.foundedYear || "",
        countriesWorkedIn: c.countriesWorkedIn ? [...c.countriesWorkedIn] : [],
        technologies: [...(c.technologies || [])],
        relevantDomains: [...(c.relevantDomains || [])],
        sourceResumes: (c as any).resumeName ? [(c as any).resumeName] : [],
        frequency: 1,
        contexts: [c.context],
      });
    }
  }

  return Array.from(map.values());
}

// ---------- Component ----------

interface CompanyFinderViewProps {
  scanId: string;
}

export default function CompanyFinderView({
  scanId,
}: CompanyFinderViewProps) {
  const { user } = useAuth();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Tracks whether this component instance remounted into an already-running analysis
  // (started by a previous mount). When true, the subscriber reloads results from DB
  // on progress updates since the old closure's setResults targets the dead instance.
  const remountedIntoAnalysisRef = useRef(false);

  // Restore in-progress state if the user navigated away during analysis
  useEffect(() => {
    const stored = getProcessingState(scanId);
    if (stored?.analyzing) {
      remountedIntoAnalysisRef.current = true;
      setAnalyzing(true);
      setAnalyzeProgress(stored.progress);
      analyzingCountRef.current = stored.itemCount;
      if (stored.batchJobActive) {
        setCfBatchActive(true);
        setCfBatchTotal(stored.batchTotal || stored.itemCount);
      }
      // Reload partial results from DB so user sees progress after navigating back
      CompanyFinderService.getScanDetail(scanId).then((detail) => {
        if (detail?.results?.length > 0) setResults(detail.results);
      }).catch(() => {});
    }

    const unsub = subscribeProcessing(scanId, (s) => {
      // Always process analyzing=false to avoid stuck spinners
      if (!s.analyzing) {
        setAnalyzing(false);
        setCfBatchActive(false);
        setAnalyzeProgress({ current: 0, total: 0 });
        remountedIntoAnalysisRef.current = false;
        return;
      }
      setAnalyzing(s.analyzing);
      setAnalyzeProgress(s.progress);
      analyzingCountRef.current = s.itemCount;
      if (s.batchJobActive) {
        setCfBatchActive(true);
        setCfBatchTotal(s.batchTotal || s.itemCount);
      }
      // If we remounted into an ongoing analysis, reload results from DB
      // (the old closure's setResults targets the dead component instance).
      // Delay slightly to let the DB write from the old closure complete.
      if (remountedIntoAnalysisRef.current) {
        setTimeout(() => {
          CompanyFinderService.getScanDetail(scanId).then((detail) => {
            if (detail?.results?.length > 0) setResults(detail.results);
          }).catch(() => {});
        }, 1500);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  // Resume state
  const [resumes, setResumes] = useState<CFParsedResume[]>([]);
  const [parsingResumes, setParsingResumes] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0 });

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<AggregatedCompany[] | null>(null);

  // Loading saved data
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [savedResumeNames, setSavedResumeNames] = useState<string[]>([]);

  // Resume URLs (name → url mapping)
  const [resumeUrls, setResumeUrls] = useState<Record<string, string>>({});
  const [viewingResume, setViewingResume] = useState<{ url: string; name: string } | null>(null);
  const analyzingCountRef = useRef(0);
  const [skippedInfo, setSkippedInfo] = useState<{ count: number; names: string[] } | null>(null);

  // Track files currently being uploaded for preview
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"frequency" | "name">("frequency");
  const [typeFilter, setTypeFilter] = useState<"all" | CompanyType>("all");
  const [relevantOnly, setRelevantOnly] = useState(true);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, typeFilter, relevantOnly, sortBy]);

  // ---------- Load saved data on mount ----------

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const detail = await CompanyFinderService.getScanDetail(scanId);
        if (cancelled) return;
        if (detail.results && detail.results.length > 0) {
          setResults(detail.results);
        }
        if (detail.resumeNames && detail.resumeNames.length > 0) {
          setSavedResumeNames(detail.resumeNames);
        }
        if (detail.resumeUrls) {
          setResumeUrls(detail.resumeUrls);
        }
      } catch (err) {
        console.error("Failed to load scan detail:", err);
      } finally {
        if (!cancelled) setLoadingSaved(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  // Reload results from DB when analysis completes.
  // Handles tab-switch case: old closure saved results to DB but its setState
  // targets the previous (unmounted) component instance.
  const prevAnalyzingRef = useRef(analyzing);
  useEffect(() => {
    const was = prevAnalyzingRef.current;
    prevAnalyzingRef.current = analyzing;
    if (!was || analyzing) return; // only on true → false transition

    (async () => {
      try {
        const detail = await CompanyFinderService.getScanDetail(scanId);
        if (detail.results?.length) {
          setResults(detail.results);
          if (detail.resumeNames?.length) setSavedResumeNames(detail.resumeNames);
          if (detail.resumeUrls) setResumeUrls(detail.resumeUrls);
        }
      } catch (err) {
        console.error("Failed to reload results after completion:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing, scanId]);

  // ---------- Resume parsing ----------

  const processResumeFiles = async (files: File[]) => {
    const supportedExts = [".pdf", ".doc", ".docx"];
    const supportedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    const validFiles = files.filter(
      (f) =>
        supportedTypes.includes(f.type) ||
        supportedExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );

    if (validFiles.length === 0) {
      toast.error("No PDF or Word files found");
      return;
    }

    setParsingResumes(true);
    setParseProgress({ current: 0, total: validFiles.length });
    const newResumes: CFParsedResume[] = [];
    let skippedCount = 0;
    const skippedNames: string[] = [];

    const queue = [...validFiles];
    let completed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        if (file.size > 10 * 1024 * 1024) {
          skippedCount++;
          skippedNames.push(file.name);
          completed++;
          setParseProgress({ current: completed, total: validFiles.length });
          continue;
        }

        try {
          const formData = new FormData();
          formData.append("file", file);
          const result = await parsePdf(formData);

          if (result.success && result.text && result.text.trim().length > 0) {
            newResumes.push({ name: file.name, text: result.text, file });
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
        setParseProgress({ current: completed, total: validFiles.length });
      }
    };

    const workers = Array.from(
      { length: Math.min(PARSE_CONCURRENCY, validFiles.length) },
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
      toast.warning(
        `${skippedCount} file(s) skipped (too large or failed to parse): ${skippedNames.join(', ')}`
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

  const handleFolderUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
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
    setResults(null);
    toast.info("All resumes cleared");
  };

  // ---------- Upload all resume files for preview immediately after parsing ----------

  const uploadFilesForPreview = async (newResumes: CFParsedResume[]) => {
    const orgId = user?.organization_id;
    const toUpload = newResumes.filter((r) => !resumeUrls[r.name]);
    if (toUpload.length === 0) return;

    setUploadingFiles((prev) => {
      const next = new Set(prev);
      toUpload.forEach((r) => next.add(r.name));
      return next;
    });

    await Promise.all(
      toUpload.map(async (resume) => {
        try {
          const formData = new FormData();
          formData.append("resume", resume.file);
          if (orgId) formData.append("organizationId", orgId);
          if (user?.id) formData.append("userId", user.id);

          const res = await fetch("/api/upload-resume", { method: "POST", body: formData });
          if (res.ok) {
            const { resumeUrl } = await res.json();
            if (resumeUrl) {
              setResumeUrls((prev) => ({ ...prev, [resume.name]: resumeUrl }));
            }
          }
        } catch {
          // Silently skip failed uploads
        } finally {
          setUploadingFiles((prev) => {
            const next = new Set(prev);
            next.delete(resume.name);
            return next;
          });
        }
      })
    );
  };

  // Batch job state for server-side CF processing — restore from processing store on remount
  const [cfBatchActive, setCfBatchActive] = useState(() => {
    const stored = getProcessingState(scanId);
    return stored?.batchJobActive ?? false;
  });
  const [cfBatchTotal, setCfBatchTotal] = useState(() => {
    const stored = getProcessingState(scanId);
    return stored?.batchTotal ?? 0;
  });

  // Poll scan detail every 15s while batch is active — picks up partial results
  // saved by the server after each concurrent enrichment round.
  useEffect(() => {
    if (!cfBatchActive) return;
    const interval = setInterval(() => {
      CompanyFinderService.getScanDetail(scanId)
        .then((detail) => {
          if (detail?.results?.length > 0) setResults(detail.results);
          if (detail?.resumeUrls) setResumeUrls((prev) => ({ ...prev, ...detail.resumeUrls }));
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(interval);
  }, [cfBatchActive, scanId]);

  // ---------- Analysis (Server-side queue: Parse → Queue → Process) ----------

  const handleAnalyze = async () => {
    if (resumes.length === 0) {
      toast.error("Please upload at least one resume");
      return;
    }

    const existingResumeNamesAtStart: string[] = savedResumeNames || [];

    // Skip resumes already analyzed in this scan
    const existingNames = (results && results.length > 0)
      ? new Set(existingResumeNamesAtStart)
      : new Set<string>();
    const skippedResumes = resumes.filter((r) => existingNames.has(r.name));
    let newResumes = resumes.filter((r) => !existingNames.has(r.name));

    if (skippedResumes.length > 0) {
      setSkippedInfo({
        count: skippedResumes.length,
        names: skippedResumes.map((r) => r.name),
      });
    }

    if (newResumes.length === 0) {
      setResumes([]);
      return;
    }

    // Check for cross-scan reuse before queuing
    try {
      const crossScan = await CompanyFinderService.findExistingResultsForResumes(
        scanId,
        newResumes.map((r) => r.name)
      );
      if (crossScan.processedNames.length > 0) {
        if (Object.keys(crossScan.resumeUrls).length > 0) {
          setResumeUrls((prev) => ({ ...prev, ...crossScan.resumeUrls }));
        }
        const reusedSet = new Set(crossScan.processedNames.map((n) => n.toLowerCase().trim()));
        newResumes = newResumes.filter((r) => !reusedSet.has(r.name.toLowerCase().trim()));

        if (newResumes.length === 0 && crossScan.companies.length > 0) {
          // All found in other scans — merge and finish
          const existingBase = results || [];
          const reusedKeys = new Set(crossScan.companies.map((c) => c.companyName.trim().toLowerCase()));
          const merged = [
            ...existingBase.filter((c) => !reusedKeys.has(c.companyName.trim().toLowerCase())),
            ...crossScan.companies,
          ];
          merged.sort((a, b) => b.frequency - a.frequency);
          setResults(merged);
          const allNames = Array.from(new Set([...existingResumeNamesAtStart, ...crossScan.processedNames]));
          setSavedResumeNames(allNames);
          await CompanyFinderService.updateResults(scanId, {
            results: merged,
            resumeNames: allNames,
            resumeUrls: { ...resumeUrls, ...crossScan.resumeUrls },
          });
          setResumes([]);
          toast.success(`Reused ${crossScan.companies.length} companies from existing scans`);
          return;
        }
        if (crossScan.processedNames.length > 0) {
          toast.info(`${crossScan.processedNames.length} resume(s) already scanned — reusing existing results`);
        }
      }
    } catch (err) {
      console.error("Cross-scan lookup failed, proceeding:", err);
    }

    analyzingCountRef.current = newResumes.length;
    setAnalyzing(true);
    setProcessingState(scanId, { analyzing: true, itemCount: newResumes.length, progress: { current: 0, total: newResumes.length } });

    try {
      // Wait for resume blob uploads so URLs are available
      await uploadResumeFiles(resumes, [], []);

      // Queue resumes server-side in chunks (memory cleanup: release text after each chunk)
      const CHUNK_SIZE = 200;
      let totalQueued = 0;

      for (let i = 0; i < newResumes.length; i += CHUNK_SIZE) {
        const chunk = newResumes.slice(i, i + CHUNK_SIZE);

        await CompanyFinderService.startBatchAnalysis(
          scanId,
          chunk.map(r => ({
            name: r.name,
            text: r.text,
            url: resumeUrls[r.name] || undefined,
          }))
        );

        totalQueued += chunk.length;
        setAnalyzeProgress({ current: totalQueued, total: newResumes.length });
      }

      // Activate batch processor
      setCfBatchActive(true);
      setCfBatchTotal(newResumes.length);
      setProcessingState(scanId, {
        analyzing: true,
        batchJobActive: true,
        batchTotal: newResumes.length,
        itemCount: newResumes.length,
        progress: { current: 0, total: newResumes.length },
      });

      // Memory cleanup: release parsed resume text from browser
      setResumes([]);

      toast.success(`Queued ${newResumes.length} resumes — server-side analysis starting...`);
    } catch (error: any) {
      console.error("Company finder queue error:", error);
      toast.error("Failed to start analysis", { description: error.message || "Please try again." });
      setAnalyzing(false);
      setCfBatchActive(false);
      setProcessingState(scanId, { analyzing: false });
      clearProcessingState(scanId);
    }
  };

  const handleCFBatchComplete = () => {
    if (!mountedRef.current) return;

    // Reload results from DB (they were saved incrementally by the process route)
    CompanyFinderService.getScanDetail(scanId).then((detail) => {
      if (detail?.results?.length > 0) setResults(detail.results);
      if (detail?.resumeNames?.length > 0) setSavedResumeNames(detail.resumeNames);
      if (detail?.resumeUrls) setResumeUrls((prev) => ({ ...prev, ...detail.resumeUrls }));

      setCfBatchActive(false);
      setAnalyzing(false);
      setAnalyzeProgress({ current: 0, total: 0 });
      setProcessingState(scanId, { analyzing: false, batchJobActive: false });
      clearProcessingState(scanId);

      if (mountedRef.current) toast.success("Company analysis complete!");
    }).catch(() => {
      setCfBatchActive(false);
      setAnalyzing(false);
      setProcessingState(scanId, { analyzing: false });
      clearProcessingState(scanId);
    });
  };

  // ---------- Upload resume files for View Resume ----------

  const uploadResumeFiles = async (
    resumeList: CFParsedResume[],
    allResumeNames: string[],
    currentResults: AggregatedCompany[]
  ) => {
    const orgId = user?.organization_id;

    // Upload all files in parallel for speed
    const uploadPromises = resumeList
      .filter((resume) => !resumeUrls[resume.name]) // skip already uploaded
      .map(async (resume) => {
        try {
          const formData = new FormData();
          formData.append("resume", resume.file);
          if (orgId) formData.append("organizationId", orgId);
          if (user?.id) formData.append("userId", user.id);

          const res = await fetch("/api/upload-resume", {
            method: "POST",
            body: formData,
          });
          if (res.ok) {
            const { resumeUrl } = await res.json();
            if (resumeUrl) return { name: resume.name, url: resumeUrl };
          }
        } catch {
          // Skip failed uploads
        }
        return { name: resume.name, url: "" };
      });

    const results = await Promise.allSettled(uploadPromises);
    const newUrls: Record<string, string> = {};
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.url) {
        newUrls[r.value.name] = r.value.url;
      }
    }

    if (Object.keys(newUrls).length > 0) {
      const mergedUrls = { ...resumeUrls, ...newUrls };
      setResumeUrls(mergedUrls);

      // Persist URLs to Supabase if we have results to attach them to (always runs)
      if (currentResults.length > 0) {
        CompanyFinderService.updateResults(scanId, {
          results: currentResults,
          resumeNames: allResumeNames,
          resumeUrls: mergedUrls,
        }).catch((err) => {
          console.error("Failed to save resume URLs:", err);
        });
      }
    }
  };

  // ---------- Export CSV ----------

  const exportCSV = () => {
    if (!filteredResults || filteredResults.length === 0) return;

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

    const rows = filteredResults.map((c) => [
      `"${c.companyName.replace(/"/g, '""')}"`,
      c.companyType === "service_provider" ? "Service Provider" : c.companyType === "service_consumer" ? "Service Consumer" : "Unknown",
      `"${(c.companyInfo || "").replace(/"/g, '""')}"`,
      `"${(c.headquarters || "").replace(/"/g, '""')}"`,
      c.foundedYear || "",
      `"${(c.countriesWorkedIn || []).join(", ").replace(/"/g, '""')}"`,
      c.frequency,
      `"${(c.sourceResumes || []).join(", ").replace(/"/g, '""')}"`,
      `"${c.contexts.join(" | ").replace(/"/g, '""')}"`,
      isDynaTechRelevant(c) ? "True" : "False",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.join(","))
      .join("\n");
    // BOM prefix for Excel
    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `company-finder-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // ---------- Filtering ----------

  const filteredResults = results
    ? results
        .filter((c) => {
          // Relevant filter: only show companies related to Dynamics or SAP
          if (relevantOnly) {
            const searchFields = [
              c.companyName,
              c.companyInfo || "",
              ...(c.technologies || []),
              ...(c.contexts || []),
            ].join(" ").toLowerCase();
            const isDynamicsOrSAP = /\bdynamics\b/.test(searchFields) || /\bsap\b/.test(searchFields);
            if (!isDynamicsOrSAP) return false;
          }

          if (typeFilter !== "all" && c.companyType !== typeFilter) return false;
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            return (
              c.companyName.toLowerCase().includes(q) ||
              (c.technologies || []).some((t) => t.toLowerCase().includes(q))
            );
          }
          return true;
        })
        .sort((a, b) => {
          if (sortBy === "frequency") return b.frequency - a.frequency;
          return a.companyName.localeCompare(b.companyName);
        })
    : null;

  const pagedResults = filteredResults
    ? filteredResults.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : null;

  // ---------- Delete company ----------

  const handleDeleteCompany = useCallback(
    (companyName: string) => {
      if (!results) return;
      const updated = results.filter(
        (c) => c.companyName.trim().toLowerCase() !== companyName.trim().toLowerCase()
      );
      const hasResults = updated.length > 0;
      setResults(hasResults ? updated : null);

      // If last company deleted, also clear saved resume names so counts reset
      const updatedResumeNames = hasResults ? savedResumeNames : [];
      if (!hasResults) setSavedResumeNames([]);

      CompanyFinderService.updateResults(scanId, {
        results: updated,
        resumeNames: updatedResumeNames,
      }).catch((err) => {
        console.error("Failed to delete company:", err);
        toast.error("Failed to delete from server");
      });

      toast.success("Company removed");
    },
    [results, scanId, savedResumeNames]
  );

  // ---------- Selection ----------

  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());

  const toggleSelect = (companyName: string) => {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      const key = companyName.trim().toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!filteredResults) return;
    if (selectedCompanies.size === filteredResults.length) {
      setSelectedCompanies(new Set());
    } else {
      setSelectedCompanies(
        new Set(filteredResults.map((c) => c.companyName.trim().toLowerCase()))
      );
    }
  };

  const handleDeleteSelected = () => {
    if (!results || selectedCompanies.size === 0) return;
    const count = selectedCompanies.size;
    const updated = results.filter(
      (c) => !selectedCompanies.has(c.companyName.trim().toLowerCase())
    );
    const hasResults = updated.length > 0;
    setResults(hasResults ? updated : null);
    setSelectedCompanies(new Set());

    // If all results are deleted, also clear saved resume names so counts reset
    const updatedResumeNames = hasResults ? savedResumeNames : [];
    if (!hasResults) setSavedResumeNames([]);

    CompanyFinderService.updateResults(scanId, {
      results: updated,
      resumeNames: updatedResumeNames,
    }).catch((err) => {
      console.error("Failed to delete companies:", err);
      toast.error("Failed to delete from server");
    });
    toast.success(`${count} company(ies) removed`);
  };

  // ---------- Stats ----------

  const totalCompanies = filteredResults?.length || 0;
  // Count all analyzed resumes (not just those with companies found)
  // During active analysis, show only the resumes processed so far (analyzeProgress.current)
  const resumeCountDisplay = analyzing
    ? savedResumeNames.length + analyzeProgress.current
    : savedResumeNames.length > 0
      ? savedResumeNames.length
      : resumes.length;

  // ---------- Loading state ----------

  if (loadingSaved) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <main className="p-8 pt-0 ml-12 mr-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between mt-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-indigo-500" />
            Company Finder
          </h2>
          <p className="text-sm text-gray-600 mt-0.5">
            Extract and classify companies from resumes using AI analysis
          </p>
        </div>
        {results && (
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        )}
      </div>

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
                {resumes.length > 0
                  ? `${resumes.length.toLocaleString()} uploaded`
                  : "0 uploaded"}
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
                    ) : resumeUrls[resume.name] ? (
                      <button
                        onClick={() => setViewingResume({ url: resumeUrls[resume.name], name: resume.name })}
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
          disabled={resumes.length === 0 || analyzing}
          onClick={handleAnalyze}
          className="px-8 bg-indigo-600 hover:bg-indigo-700"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Finding companies in {analyzingCountRef.current.toLocaleString()} resume(s)...
            </>
          ) : (
            <>
              <Building2 className="h-4 w-4 mr-2" />
              Find Companies
              {resumes.length > 0
                ? ` in ${resumes.length.toLocaleString()} Resume${resumes.length !== 1 ? "s" : ""}`
                : ""}
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
                    Already analyzed. To re-analyze, delete the existing results first and upload again.
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

        {/* Analysis progress — queuing phase (before batch processor takes over) */}
        {analyzing && !cfBatchActive && analyzeProgress.total > 1 && (
          <div className="w-full max-w-md p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-indigo-700">Queuing resumes...</span>
              <span className="text-sm font-medium text-indigo-700">
                {analyzeProgress.current}/{analyzeProgress.total} queued
              </span>
            </div>
            <div className="w-full bg-indigo-100 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${analyzeProgress.total > 0 ? (analyzeProgress.current / analyzeProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* CF Batch Processor — server-side processing */}
      {cfBatchActive && (
        <CFBatchProcessor
          scanId={scanId}
          totalItems={cfBatchTotal}
          onComplete={handleCFBatchComplete}
          onProgress={(curr) => {
            setAnalyzeProgress({ current: curr, total: cfBatchTotal });
            setProcessingState(scanId, { progress: { current: curr, total: cfBatchTotal } });
            // Reload results incrementally from DB
            if (curr > 0) {
              CompanyFinderService.getScanDetail(scanId)
                .then((detail) => { if (detail?.results?.length > 0) setResults(detail.results); })
                .catch(() => {});
            }
          }}
          isProcessing={analyzing}
          setIsProcessing={setAnalyzing}
        />
      )}

      {/* Results Section */}
      {results && results.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-indigo-500" />
                  <div>
                    <p className="text-2xl font-bold">{totalCompanies}</p>
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
                    <p className="text-2xl font-bold">{resumeCountDisplay}</p>
                    <p className="text-xs text-slate-500">Resumes Analyzed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <button
              onClick={() => setRelevantOnly((v) => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                relevantOnly
                  ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${relevantOnly ? "bg-white" : "bg-slate-400"}`} />
              Dynatech Relevant
            </button>
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search companies, technologies, domains..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-3">
              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as "all" | CompanyType)
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white"
              >
                <option value="all">All Types</option>
                <option value="service_provider">Service Provider</option>
                <option value="service_consumer">Service Consumer</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "frequency" | "name")
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white"
              >
                <option value="frequency">Sort by Frequency</option>
                <option value="name">Sort by Name</option>
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
                    checked={filteredResults.length > 0 && selectedCompanies.size === filteredResults.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-sm text-slate-600">Select All</span>
                </label>
                <p className="text-sm text-slate-500">
                  Showing {filteredResults.length} of {results.length} companies
                  {selectedCompanies.size > 0 && (
                    <span className="text-indigo-600 font-medium ml-1">
                      ({selectedCompanies.size} selected)
                    </span>
                  )}
                </p>
              </div>
              {selectedCompanies.size > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteSelected}
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Selected ({selectedCompanies.size})
                </Button>
              )}
            </div>
          )}

          {/* Results Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="py-3 px-3 w-10">
                        <input
                          type="checkbox"
                          checked={!!filteredResults && filteredResults.length > 0 && selectedCompanies.size === filteredResults.length}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">
                        Company
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">
                        Type
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">
                        Description
                      </th>
                      <th className="text-center py-3 px-4 font-medium text-slate-600">
                        Frequency
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600 w-10">
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedResults?.map((company, index) => (
                      <tr
                        key={index}
                        className={`border-b last:border-0 hover:bg-slate-50 transition-colors ${
                          selectedCompanies.has(company.companyName.trim().toLowerCase())
                            ? "bg-indigo-50/50"
                            : ""
                        }`}
                      >
                        <td className="py-3 px-3">
                          <input
                            type="checkbox"
                            checked={selectedCompanies.has(company.companyName.trim().toLowerCase())}
                            onChange={() => toggleSelect(company.companyName)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-medium text-slate-800">
                            {company.companyName}
                          </span>
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
                          {company.companyType ? (
                            <Badge
                              className={`whitespace-nowrap ${
                                company.companyType === "service_provider"
                                  ? "bg-blue-100 text-blue-700 hover:bg-blue-100"
                                  : company.companyType === "service_consumer"
                                  ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-100"
                              }`}
                            >
                              {company.companyType === "service_provider"
                                ? "Provider"
                                : company.companyType === "service_consumer"
                                ? "Consumer"
                                : "Unknown"}
                            </Badge>
                          ) : (
                            <Badge className="whitespace-nowrap bg-slate-100 text-slate-500 hover:bg-slate-100">
                              Unknown
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {/* Company Info */}
                          {company.companyInfo && (
                            <div className="mb-2">
                              <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Company Info</span>
                              <p className="text-xs text-slate-700 mt-0.5">{company.companyInfo}</p>
                              {/* Metadata row: HQ | Founded | Countries */}
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
                          {/* Why Selected */}
                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Why Selected</span>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {company.contexts.join(" | ")}
                            </p>
                            {(() => {
                              const sourceNames = company.sourceResumes || [];
                              if (sourceNames.length === 0) return null;
                              return (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {sourceNames.map((name) => {
                                    const hasUrl = !!resumeUrls[name];
                                    return hasUrl ? (
                                      <button
                                        key={name}
                                        onClick={() => setViewingResume({ url: resumeUrls[name], name })}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-[10px] text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-100"
                                        title={`View ${name}`}
                                      >
                                        <Eye className="h-3 w-3" />
                                        <span className="max-w-[150px] truncate">{name}</span>
                                      </button>
                                    ) : (
                                      <span
                                        key={name}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] text-slate-500 border border-slate-200"
                                        title={name}
                                      >
                                        <FileText className="h-3 w-3" />
                                        <span className="max-w-[150px] truncate">{name}</span>
                                      </span>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-medium text-slate-700">
                            {company.frequency}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
                            onClick={() => handleDeleteCompany(company.companyName)}
                            title="Delete company"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {filteredResults && filteredResults.length > pageSize && (
            <PaginationControls
              currentPage={currentPage}
              totalItems={filteredResults.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </>
      )}

      {results && results.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">
              No companies found in the uploaded resumes.
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Try uploading resumes with more work experience details.
            </p>
          </CardContent>
        </Card>
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
