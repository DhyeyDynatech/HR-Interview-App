"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Clock,
  Cpu,
  Mic,
  TrendingUp,
  Filter,
  Download,
  RefreshCw,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Lightbulb,
  Phone,
  Upload,
  Info,
  User,
  Mail,
  Briefcase,
  Hash,
  Calendar,
  FileImage,
  ScanSearch,
} from "lucide-react";
import {
  CostFilters,
  PRICING,
  EnhancedCostSummary,
  UsageCategory,
} from "@/types/cost";
import { PaginationControls } from "@/components/ui/pagination-controls";

// Category icon mapping
const CATEGORY_ICONS: Record<UsageCategory, React.ReactNode> = {
  interview_creation: <FileText className="h-4 w-4" />,
  interview_response: <MessageSquare className="h-4 w-4" />,
  insights: <Lightbulb className="h-4 w-4" />,
  communication_analysis: <Cpu className="h-4 w-4" />,
  voice_call: <Phone className="h-4 w-4" />,
  blob_upload: <Upload className="h-4 w-4" />,
  ats_scoring: <ScanSearch className="h-4 w-4" />,
  company_finder: <ScanSearch className="h-4 w-4" />,
  resume_parsing: <FileImage className="h-4 w-4" />,
};

// Category color mapping
const CATEGORY_COLORS: Record<UsageCategory, string> = {
  interview_creation: "bg-blue-100 text-blue-700",
  interview_response: "bg-purple-100 text-purple-700",
  insights: "bg-yellow-100 text-yellow-700",
  communication_analysis: "bg-pink-100 text-pink-700",
  voice_call: "bg-orange-100 text-orange-700",
  blob_upload: "bg-indigo-100 text-indigo-700",
  ats_scoring: "bg-emerald-100 text-emerald-700",
  company_finder: "bg-cyan-100 text-cyan-700",
  resume_parsing: "bg-rose-100 text-rose-700",
};

function CostAnalysisPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [costData, setCostData] = useState<any[]>([]);
  const [summary, setSummary] = useState<EnhancedCostSummary | null>(null);
  const [interviews, setInterviews] = useState<{ id: string; name: string }[]>([]);
  const [dataSource, setDataSource] = useState<"tracked" | "estimated">("estimated");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Filter state
  const [filters, setFilters] = useState<CostFilters>({
    sortBy: "date",
    sortOrder: "desc",
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedInterview, setSelectedInterview] = useState<string>("all");
  const [minCost, setMinCost] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const orgId = user?.organization_id;

  const toggleRowExpansion = (id: number) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const fetchCostData = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const appliedFilters: CostFilters = {
        ...filters,
        startDate: startDate || undefined,
        // Append end-of-day time so records from the selected date are fully included
        endDate: endDate ? `${endDate}T23:59:59` : undefined,
        interviewId: selectedInterview !== "all" ? selectedInterview : undefined,
        minCost: minCost ? parseFloat(minCost) : undefined,
        maxCost: maxCost ? parseFloat(maxCost) : undefined,
        category: selectedCategory !== "all" ? selectedCategory as UsageCategory : undefined,
      };

      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const response = await fetch("/api/cost-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ filters: appliedFilters }),
      });

      if (response.ok) {
        const result = await response.json();
        // Filter out deprecated call_creation records from legacy data
        const filteredData = (result.data || []).filter(
          (item: any) => item.category !== "call_creation"
        );
        setCostData(filteredData);
        setCurrentPage(1);
        const summaryData = result.summary as EnhancedCostSummary | null;
        if (summaryData?.byCategory) {
          summaryData.byCategory = summaryData.byCategory.filter(
            (cat) => cat.category !== ("call_creation" as any)
          );
        }
        setSummary(summaryData);
        setDataSource(result.dataSource || "estimated");
      } else {
        setCostData([]);
        setSummary(null);
      }
    } catch (error) {
      console.error("Error fetching cost data:", error);
      setCostData([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, filters, startDate, endDate, selectedInterview, minCost, maxCost, selectedCategory]);

  const fetchInterviews = useCallback(async () => {
    if (!orgId) return;

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const response = await fetch("/api/cost-analysis", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.ok) {
        const result = await response.json();
        setInterviews(result.interviews || []);
      }
    } catch (error) {
      console.error("Error fetching interviews:", error);
    }
  }, [orgId]);

  useEffect(() => {
    fetchInterviews();
  }, [fetchInterviews]);

  useEffect(() => {
    fetchCostData();
  }, [fetchCostData]);

  const handleSort = (field: "date" | "cost" | "duration") => {
    setFilters(prev => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field && prev.sortOrder === "desc" ? "asc" : "desc",
    }));
  };

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedInterview("all");
    setSelectedCategory("all");
    setMinCost("");
    setMaxCost("");
    setFilters({ sortBy: "date", sortOrder: "desc" });
  };

  const exportToCSV = () => {
    // Handle both tracked (new format) and estimated (legacy format) data
    const headers = dataSource === "tracked"
      ? ["Date", "Category", "Service", "Input Tokens", "Output Tokens", "Total Tokens", "Duration (min)", "Cost ($)"]
      : ["Date", "Interview", "Candidate", "Email", "Duration (min)", "GPT Input Tokens", "GPT Output Tokens", "GPT Cost ($)", "Voice Cost ($)", "Total Cost ($)"];

    const rows = costData.map(item => {
      if (dataSource === "tracked") {
        return [
          new Date(item.date).toLocaleDateString(),
          item.categoryLabel || item.category,
          item.service,
          item.inputTokens || "",
          item.outputTokens || "",
          item.totalTokens || "",
          item.durationMinutes || "",
          item.cost.toFixed(6),
        ];
      }

      // Legacy format
      return [
        new Date(item.date).toLocaleDateString(),
        item.interviewName,
        item.candidateName,
        item.candidateEmail,
        item.costBreakdown?.voice?.durationMinutes?.toFixed(2) || "",
        item.costBreakdown?.gpt?.inputTokens || "",
        item.costBreakdown?.gpt?.outputTokens || "",
        item.costBreakdown?.gpt?.cost?.toFixed(4) || "",
        item.costBreakdown?.voice?.cost?.toFixed(4) || "",
        item.costBreakdown?.total?.toFixed(4) || "",
      ];
    });

    const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-analysis-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const formatCurrency = (value: number) => {
    return `$${value.toFixed(4)}`;
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  const pagedCostData = costData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const SortIcon = ({ field }: { field: string }) => {
    if (filters.sortBy !== field) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return filters.sortOrder === "asc" ? (
      <ChevronUp className="h-4 w-4 ml-1" />
    ) : (
      <ChevronDown className="h-4 w-4 ml-1" />
    );
  };

  // Render category-specific details in expanded view
  const renderCategoryDetails = (item: any) => {
    const metadata = item.metadata || {};

    switch (item.category as UsageCategory) {
      case "interview_creation":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">Job Role</p>
                <p className="text-sm font-medium">{metadata.jobRole || item.interviewName || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">Questions Generated</p>
                <p className="text-sm font-medium">{metadata.questionCount || "N/A"}</p>
              </div>
            </div>
            {item.interviewId && (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs text-gray-500">Interview ID</p>
                  <p className="text-sm font-medium truncate max-w-[200px]">{item.interviewId}</p>
                </div>
              </div>
            )}
          </div>
        );

      case "interview_response":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {item.interviewName && (
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-purple-500" />
                <div>
                  <p className="text-xs text-gray-500">Interview</p>
                  <p className="text-sm font-medium">{item.interviewName}</p>
                </div>
              </div>
            )}
            {metadata.candidateName && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-purple-500" />
                <div>
                  <p className="text-xs text-gray-500">Candidate</p>
                  <p className="text-sm font-medium">{metadata.candidateName}</p>
                </div>
              </div>
            )}
            {metadata.candidateEmail && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-purple-500" />
                <div>
                  <p className="text-xs text-gray-500">Email</p>
                  <p className="text-sm font-medium">{metadata.candidateEmail}</p>
                </div>
              </div>
            )}
          </div>
        );

      case "voice_call":
        return (
          <div className="space-y-4">
            {/* Call Info Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {item.interviewName && (
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-gray-500">Interview</p>
                    <p className="text-sm font-medium">{item.interviewName}</p>
                  </div>
                </div>
              )}
              {metadata.candidateName && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-gray-500">Candidate</p>
                    <p className="text-sm font-medium">{metadata.candidateName}</p>
                  </div>
                </div>
              )}
              {metadata.candidateEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-gray-500">Email</p>
                    <p className="text-sm font-medium">{metadata.candidateEmail}</p>
                  </div>
                </div>
              )}
              {item.durationMinutes && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-gray-500">Call Duration</p>
                    <p className="text-sm font-medium">{item.durationMinutes} minutes</p>
                  </div>
                </div>
              )}
            </div>

            {/* Retell API Cost */}
            {item.cost > 0 && (
              <div className="mt-2 p-3 bg-orange-50 rounded-lg border border-orange-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-800">Retell API Cost</span>
                  </div>
                  <span className="text-sm font-semibold text-orange-700">${item.cost.toFixed(4)}</span>
                </div>
                {item.durationMinutes && item.durationMinutes > 0 && (
                  <p className="text-xs text-orange-600 mt-1">
                    ~${(item.cost / item.durationMinutes).toFixed(4)}/min
                  </p>
                )}
                {metadata.costSource === "fallback_estimate" && (
                  <p className="text-xs text-gray-400 mt-1">(Estimated — Retell API cost unavailable)</p>
                )}
              </div>
            )}
          </div>
        );

      case "insights":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(metadata.interviewName || item.interviewName) && (
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-yellow-600" />
                <div>
                  <p className="text-xs text-gray-500">Interview</p>
                  <p className="text-sm font-medium">{metadata.interviewName || item.interviewName}</p>
                </div>
              </div>
            )}
            {metadata.responseCount !== undefined && (
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-yellow-600" />
                <div>
                  <p className="text-xs text-gray-500">Responses Analyzed</p>
                  <p className="text-sm font-medium">{metadata.responseCount}</p>
                </div>
              </div>
            )}
          </div>
        );

      case "communication_analysis":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {item.interviewName && (
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-pink-500" />
                <div>
                  <p className="text-xs text-gray-500">Interview</p>
                  <p className="text-sm font-medium">{item.interviewName}</p>
                </div>
              </div>
            )}
            {item.responseId && (
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-pink-500" />
                <div>
                  <p className="text-xs text-gray-500">Response ID</p>
                  <p className="text-sm font-medium">{item.responseId}</p>
                </div>
              </div>
            )}
          </div>
        );

      case "blob_upload":
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {metadata.originalName && (
                <div className="flex items-center gap-2">
                  <FileImage className="h-4 w-4 text-indigo-500" />
                  <div>
                    <p className="text-xs text-gray-500">File Name</p>
                    <p className="text-sm font-medium truncate max-w-[200px]">{metadata.originalName}</p>
                  </div>
                </div>
              )}
              {metadata.fileType && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-500" />
                  <div>
                    <p className="text-xs text-gray-500">File Type</p>
                    <p className="text-sm font-medium capitalize">{metadata.fileType}</p>
                  </div>
                </div>
              )}
              {metadata.fileSizeBytes && (
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-indigo-500" />
                  <div>
                    <p className="text-xs text-gray-500">File Size</p>
                    <p className="text-sm font-medium">{(metadata.fileSizeBytes / 1024).toFixed(2)} KB</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-indigo-500" />
                <div>
                  <p className="text-xs text-gray-500">Storage Cost</p>
                  <p className="text-sm font-medium">${PRICING.VERCEL_BLOB_STORAGE_PER_GB}/GB/month</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Cost shown is the monthly storage cost for this file based on Vercel Blob pricing (${PRICING.VERCEL_BLOB_STORAGE_PER_GB}/GB/month).
            </p>
          </div>
        );

      case "ats_scoring":
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {metadata.resumeCount && (
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-emerald-500" />
                  <div>
                    <p className="text-xs text-gray-500">Resumes Analyzed</p>
                    <p className="text-sm font-medium">{metadata.resumeCount}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs text-gray-500">Cost per Resume</p>
                  <p className="text-sm font-medium">
                    ${metadata.resumeCount ? (item.cost / metadata.resumeCount).toFixed(4) : item.cost.toFixed(4)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs text-gray-500">Model</p>
                  <p className="text-sm font-medium">{item.model || "gpt-5-mini"}</p>
                </div>
              </div>
              {item.inputTokens && item.outputTokens && (
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-emerald-500" />
                  <div>
                    <p className="text-xs text-gray-500">Tokens (In / Out)</p>
                    <p className="text-sm font-medium">
                      {item.inputTokens.toLocaleString()} / {item.outputTokens.toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {metadata.resumeNames && (
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-emerald-500 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500">Resume Files</p>
                  <p className="text-sm font-medium">
                    {metadata.resumeNames.join(", ")}
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      case "company_finder":
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {(metadata.resumeCount || metadata.companyCount) && (
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-cyan-500" />
                  <div>
                    <p className="text-xs text-gray-500">{metadata.stage === "enrichment" ? "Companies Enriched" : "Resumes Processed"}</p>
                    <p className="text-sm font-medium">{metadata.companyCount || metadata.resumeCount}</p>
                  </div>
                </div>
              )}
              {metadata.stage && (
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-cyan-500" />
                  <div>
                    <p className="text-xs text-gray-500">Stage</p>
                    <p className="text-sm font-medium capitalize">{metadata.stage}</p>
                  </div>
                </div>
              )}
              {metadata.searchCalls != null && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-cyan-500" />
                  <div>
                    <p className="text-xs text-gray-500">Web Search Calls</p>
                    <p className="text-sm font-medium">{metadata.searchCalls} × ${PRICING.WEB_SEARCH_PER_CALL}/call</p>
                  </div>
                </div>
              )}
              {metadata.searchCalls != null && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-cyan-500" />
                  <div>
                    <p className="text-xs text-gray-500">Cost Breakdown</p>
                    <p className="text-sm font-medium">
                      Tokens: ${(metadata.tokenCost ?? 0).toFixed(4)} + Search: ${(metadata.searchCost ?? 0).toFixed(4)}
                    </p>
                  </div>
                </div>
              )}
              {item.inputTokens && item.outputTokens && (
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-cyan-500" />
                  <div>
                    <p className="text-xs text-gray-500">Tokens (In / Out)</p>
                    <p className="text-sm font-medium">
                      {item.inputTokens.toLocaleString()} / {item.outputTokens.toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {metadata.resumeNames && (
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-cyan-500 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500">Resume Files</p>
                  <p className="text-sm font-medium">
                    {metadata.resumeNames.join(", ")}
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return (
          <div className="text-sm text-gray-500">
            No additional details available
          </div>
        );
    }
  };

  // Show loading skeleton while auth is loading or data is being fetched
  if (authLoading || (loading && !costData.length)) {
    return (
      <main className="p-8 pt-0 ml-12 mr-auto">
        <div className="flex flex-col gap-6 mt-8">
          <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-gray-200 animate-pulse rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[4, 5, 6].map(i => (
              <div key={i} className="h-32 bg-gray-200 animate-pulse rounded-xl" />
            ))}
          </div>
          <div className="h-96 bg-gray-200 animate-pulse rounded-xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 pt-0 ml-12 mr-auto">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between mt-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Cost & Analysis</h2>
            <p className="text-sm text-gray-600">
              Track your interview costs across GPT and Voice platforms
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchCostData}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <>
            {/* Monthly Cost Banner */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">
                  This Month ({new Date().toLocaleString("default", { month: "long", year: "numeric" })})
                </span>
              </div>
              <span className="text-xl font-bold text-blue-700">
                {formatCurrency(summary.monthlyTotalCost ?? 0)}
              </span>
            </div>

            {/* Row 1: Total Cost + GPT Cost + Voice Cost */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    Total Cost
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(summary.totalCost)}</div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalTokens.toLocaleString()} tokens &middot; {summary.totalMinutes.toFixed(1)} min voice
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    GPT Cost
                  </CardTitle>
                  <Cpu className="h-4 w-4 text-purple-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(summary.gptCost)}</div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <p className="text-xs text-gray-500">
                      <span className="text-purple-600 font-medium">gpt-5-mini:</span>{" "}
                      {formatCurrency(summary.tokenCost ?? summary.gptCost)} &middot; {summary.totalTokens.toLocaleString()} tokens
                    </p>
                    <p className="text-xs text-gray-500">
                      <span className="text-cyan-600 font-medium">Web Search:</span>{" "}
                      {formatCurrency(summary.webSearchCost ?? 0)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    Voice Cost
                  </CardTitle>
                  <Mic className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(summary.voiceCost)}</div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalMinutes.toFixed(1)} minutes
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Avg Cost/Interview + Avg Cost/Resume (ATS) + Avg Cost/Resume (CF) — tracked data only */}
            {dataSource === "tracked" && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    Avg Cost / Interview
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(summary.avgInterviewCost)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalInterviewCycles} completed interview{summary.totalInterviewCycles !== 1 ? "s" : ""}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    Avg Cost / Resume (ATS)
                  </CardTitle>
                  <ScanSearch className="h-4 w-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(summary.avgCostPerResumeATS)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalATSResumes.toLocaleString()} resume{summary.totalATSResumes !== 1 ? "s" : ""} · GPT + CF
                  </p>
                  {summary.atsBreakdown && summary.totalATSResumes > 0 && (
                    <div className="mt-2 space-y-0.5 text-[11px] text-gray-400 border-t pt-2">
                      <div className="flex justify-between">
                        <span>ATS scoring</span>
                        <span className="text-emerald-600">{formatCurrency(summary.atsBreakdown.atsCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CF extraction</span>
                        <span className="text-indigo-500">{formatCurrency(summary.atsBreakdown.cfExtractionCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CF enrichment</span>
                        <span className="text-indigo-500">{formatCurrency(summary.atsBreakdown.cfEnrichmentCost)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    Avg Cost / Resume (CF)
                  </CardTitle>
                  <ScanSearch className="h-4 w-4 text-cyan-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(summary.avgCostPerResumeCF)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalCFResumes.toLocaleString()} resume{summary.totalCFResumes !== 1 ? "s" : ""} scanned
                  </p>
                  {summary.cfBreakdown && summary.totalCFResumes > 0 && (
                    <div className="mt-2 space-y-0.5 text-[11px] text-gray-400 border-t pt-2">
                      <div className="flex justify-between">
                        <span>CF extraction</span>
                        <span className="text-indigo-500">{formatCurrency(summary.cfBreakdown.cfExtractionCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CF enrichment</span>
                        <span className="text-indigo-500">{formatCurrency(summary.cfBreakdown.cfEnrichmentCost)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>}
          </>
        )}

        {/* Category Breakdown (only shown for tracked data) */}
        {summary?.byCategory && summary.byCategory.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Cost by Category</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {dataSource === "tracked" ? "Real Usage" : "Estimated"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {summary.byCategory.map((cat) => (
                  <div
                    key={cat.category}
                    className={`p-4 rounded-lg border ${CATEGORY_COLORS[cat.category] || "bg-gray-100"}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {CATEGORY_ICONS[cat.category]}
                      <span className="text-sm font-medium">{cat.categoryLabel}</span>
                    </div>
                    <div className="text-2xl font-bold">${cat.totalCost.toFixed(4)}</div>
                    <div className="text-xs mt-1 opacity-75">
                      {cat.service === "openai" ? (
                        <span>{cat.totalTokens.toLocaleString()} tokens ({cat.count} calls)</span>
                      ) : cat.service === "retell" ? (
                        <span>{cat.totalDurationMinutes.toFixed(1)} min ({cat.count} calls)</span>
                      ) : cat.category === "blob_upload" ? (
                        <span>{(cat.totalStorageBytes / (1024 * 1024 * 1024)).toFixed(4)} GB stored</span>
                      ) : (
                        <span>{cat.count} upload{cat.count !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    {cat.count > 0 && (
                      <div className="text-xs mt-0.5 opacity-60">
                        {cat.category === "blob_upload"
                          ? "~$0.023/GB/month"
                          : `~$${(cat.totalCost / cat.count).toFixed(4)}/${cat.service === "vercel" ? "upload" : "run"}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pricing Info */}
        <Card className="bg-gray-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Current Pricing Rates</span>
            </div>
            <div className="space-y-3 text-sm text-gray-600">
              {/* OpenAI Models */}
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">OpenAI Models (per 1M tokens)</span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-1.5">
                  {Object.entries(PRICING.OPENAI_MODELS).map(([model, rates]) => (
                    <div key={model} className="p-2 bg-white rounded border">
                      <span className="font-medium text-xs text-gray-800">{model}</span>
                      <div className="flex gap-2 mt-0.5 text-xs">
                        <span className="text-green-600">${(rates.input * 1000).toFixed(2)} in</span>
                        <span className="text-blue-600">${(rates.output * 1000).toFixed(2)} out</span>
                      </div>
                    </div>
                  ))}
                  {/* Web Search */}
                  <div className="p-2 bg-white rounded border">
                    <span className="font-medium text-xs text-gray-800">Web Search (gpt-5-mini)</span>
                    <div className="flex gap-2 mt-0.5 text-xs">
                      <span className="text-cyan-600">${PRICING.WEB_SEARCH_PER_CALL}/call</span>
                      <span className="text-gray-400">($10 / 1K calls)</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Voice + Storage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-2 bg-white rounded border">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Voice (Retell)</span>
                  <div className="text-xs mt-0.5 text-gray-600">~$0.07+/min <span className="text-gray-400">(varies by LLM &amp; voice engine)</span></div>
                </div>
                <div className="p-2 bg-white rounded border">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vercel Blob Storage (Pro)</span>
                  <div className="text-xs mt-0.5 text-gray-600">
                    <span className="text-emerald-600 font-medium">5 GB free/month</span>
                    <span className="text-gray-400"> storage · then </span>
                    <span className="text-blue-600">${PRICING.VERCEL_BLOB_STORAGE_PER_GB}/GB/month</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <CardTitle className="text-base">Filters</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  End Date
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Interview
                </label>
                <Select value={selectedInterview} onValueChange={setSelectedInterview}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Interviews" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Interviews</SelectItem>
                    {interviews.map(interview => (
                      <SelectItem key={interview.id} value={interview.id}>
                        {interview.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Category
                </label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="interview_creation">Interview Creation</SelectItem>
                    <SelectItem value="interview_response">Interview Analytics</SelectItem>
                    <SelectItem value="insights">Insights Generation</SelectItem>
                    <SelectItem value="communication_analysis">Communication Analysis</SelectItem>
                    <SelectItem value="voice_call">Voice Call</SelectItem>
                    <SelectItem value="blob_upload">File Upload</SelectItem>
                    <SelectItem value="ats_scoring">ATS Scoring</SelectItem>
                    <SelectItem value="company_finder">Company Finder</SelectItem>
                    <SelectItem value="resume_parsing">Resume Parsing (OCR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Min Cost ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={minCost}
                  onChange={e => setMinCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Max Cost ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={maxCost}
                  onChange={e => setMaxCost(e.target.value)}
                  placeholder="10.00"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {dataSource === "tracked" ? "API Usage Details" : "Interview Cost Breakdown"}
              </CardTitle>
              {dataSource === "tracked" && (
                <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                  Real Token Counts
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {costData.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <DollarSign className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">No cost data available</p>
                <p className="text-sm">Complete some interviews to see cost analytics</p>
              </div>
            ) : dataSource === "tracked" ? (
              /* New tracked data table format */
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort("date")}
                    >
                      <div className="flex items-center">
                        Date
                        <SortIcon field="date" />
                      </div>
                    </TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Input Tokens</TableHead>
                    <TableHead className="text-right">Output Tokens</TableHead>
                    <TableHead className="text-right">Total Tokens</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort("cost")}
                    >
                      <div className="flex items-center justify-end">
                        Cost
                        <SortIcon field="cost" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedCostData.map(item => (
                    <React.Fragment key={item.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleRowExpansion(item.id)}
                      >
                        <TableCell className="w-[40px] p-2">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            {expandedRows.has(item.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{new Date(item.date).toLocaleDateString()}</div>
                          <div className="text-xs text-gray-500">{new Date(item.date).toLocaleTimeString()}</div>
                        </TableCell>
                        <TableCell>
                          <Badge className={CATEGORY_COLORS[item.category as UsageCategory] || "bg-gray-100"}>
                            <span className="flex items-center gap-1">
                              {CATEGORY_ICONS[item.category as UsageCategory]}
                              {item.categoryLabel}
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {item.service === "openai" ? (item.model || "gpt-5-mini") : item.service === "retell" ? "Retell" : "Vercel Blob"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.inputTokens ? (
                            <span className="text-green-600">{item.inputTokens.toLocaleString()}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.outputTokens ? (
                            <span className="text-blue-600">{item.outputTokens.toLocaleString()}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.totalTokens ? (
                            <span className="font-medium">{item.totalTokens.toLocaleString()}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.durationMinutes ? (
                            <span>{item.durationMinutes.toFixed(1)} min</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge className="bg-green-600">
                            ${(item.cost ?? 0).toFixed(6)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {expandedRows.has(item.id) && (
                        <TableRow className="bg-gray-50/50">
                          <TableCell colSpan={9} className="p-4">
                            <div className="rounded-lg border bg-white p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <Info className="h-4 w-4 text-gray-500" />
                                <span className="text-sm font-medium text-gray-700">Details</span>
                              </div>
                              {renderCategoryDetails(item)}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            ) : (
              /* Legacy estimated data table format */
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort("date")}
                    >
                      <div className="flex items-center">
                        Date
                        <SortIcon field="date" />
                      </div>
                    </TableHead>
                    <TableHead>Interview</TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort("duration")}
                    >
                      <div className="flex items-center">
                        Duration
                        <SortIcon field="duration" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">GPT Tokens</TableHead>
                    <TableHead className="text-right">GPT Cost</TableHead>
                    <TableHead className="text-right">Voice Cost</TableHead>
                    <TableHead
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort("cost")}
                    >
                      <div className="flex items-center justify-end">
                        Total Cost
                        <SortIcon field="cost" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedCostData.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {new Date(item.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span className="truncate max-w-[150px] block">
                          {item.interviewName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.candidateName}</p>
                          <p className="text-xs text-gray-500">{item.candidateEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDuration(item.duration)}</TableCell>
                      <TableCell className="text-right">
                        <div className="text-xs">
                          <span className="text-green-600">
                            +{item.costBreakdown?.gpt?.inputTokens || 0}
                          </span>
                          {" / "}
                          <span className="text-blue-600">
                            -{item.costBreakdown?.gpt?.outputTokens || 0}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                          {formatCurrency(item.costBreakdown?.gpt?.cost || 0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                          {formatCurrency(item.costBreakdown?.voice?.cost || 0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-green-600">
                          {formatCurrency(item.costBreakdown?.total || 0)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <PaginationControls
          currentPage={currentPage}
          totalItems={costData.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </main>
  );
}

export default CostAnalysisPage;
