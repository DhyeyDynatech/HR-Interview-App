"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Plus,
  Search,
  X,
  Users,
  FileText,
  Pencil,
} from "lucide-react";
import { CFScanCard } from "@/types/company-finder";

interface ScanGridProps {
  scans: CFScanCard[];
  onSelectScan: (id: string) => void;
  onRemoveScan: (id: string) => void;
  onRenameScan: (id: string, currentName: string) => void;
  onNewScan: () => void;
}

export default function ScanGrid({
  scans,
  onSelectScan,
  onRemoveScan,
  onRenameScan,
  onNewScan,
}: ScanGridProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredScans = searchQuery
    ? scans.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : scans;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-indigo-500" />
            <h1 className="text-2xl font-bold">Company Finder</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Extract and classify companies from resumes using AI analysis
          </p>
        </div>
        <Button onClick={onNewScan} className="gap-2">
          <Plus className="h-4 w-4" />
          New Scan
        </Button>
      </div>

      {/* Search Bar */}
      {scans.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search scans by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 max-w-md"
          />
        </div>
      )}

      {/* Scan Cards Grid */}
      {scans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <Plus className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-slate-700 mb-1">
            No scans yet
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Click &quot;New Scan&quot; to upload resumes and find companies.
          </p>
          <Button onClick={onNewScan} className="gap-2">
            <Plus className="h-4 w-4" />
            New Scan
          </Button>
        </div>
      ) : filteredScans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">
            No scans match &quot;{searchQuery}&quot;
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredScans.map((scan) => (
            <Card
              key={scan.id}
              className="group relative cursor-pointer transition-all duration-200 hover:shadow-md hover:border-indigo-200 min-h-[140px] flex flex-col"
              onClick={() => onSelectScan(scan.id)}
            >
              <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameScan(scan.id, scan.name);
                  }}
                  className="p-1 rounded-md hover:bg-indigo-50 text-slate-400 hover:text-indigo-500"
                  title="Rename scan"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveScan(scan.id);
                  }}
                  className="p-1 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500"
                  title="Remove scan"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <CardContent className="flex flex-col justify-between flex-1 pt-5 pb-4">
                <div className="flex items-start gap-2 mb-3">
                  <FileText className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                  <h3 className="font-semibold text-sm leading-tight line-clamp-2">
                    {scan.name}
                  </h3>
                </div>

                <div className="flex flex-col gap-1.5">
                  {scan.companyCount > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs gap-1 w-fit"
                        >
                          <Building2 className="h-3 w-3" />
                          {scan.companyCount} companies
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="bg-amber-50 text-amber-700 border-amber-200 text-xs gap-1 w-fit"
                        >
                          <Users className="h-3 w-3" />
                          {scan.resumeCount} resumes
                        </Badge>
                      </div>
                    </>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-slate-50 text-slate-500 border-dashed border-slate-300 text-xs gap-1 w-fit"
                    >
                      No results yet
                    </Badge>
                  )}

                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(scan.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
