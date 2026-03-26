"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CompanyFinderService } from "@/services/company-finder.service";
import CompanyFinderView from "@/components/dashboard/company-finder/companyFinderView";
import { useAuth } from "@/contexts/auth.context";

const DEFAULT_SCAN_NAME = "My Companies";

export default function CompanyFinderPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [scanId, setScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canAccess = user?.role === "admin" || user?.role === "marketing";

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) {
      router.replace("/dashboard");
      return;
    }

    async function ensureScan() {
      try {
        const scans = await CompanyFinderService.listScans();
        // Filter out internal ATS-linked scans
        const userScans = scans.filter((s) => !s.name.startsWith("__ats__"));
        if (userScans.length > 0) {
          // Pick the scan with the most resumes (falls back to newest if all are empty)
          const best = userScans.reduce((a, b) => (b.resumeCount > a.resumeCount ? b : a));
          setScanId(best.id);
        } else {
          const scan = await CompanyFinderService.createScan(DEFAULT_SCAN_NAME);
          setScanId(scan.id);
        }
      } catch (err) {
        console.error("Failed to load company finder:", err);
      } finally {
        setLoading(false);
      }
    }
    ensureScan();
  }, [authLoading, canAccess]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading || !scanId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return <CompanyFinderView scanId={scanId} />;
}
