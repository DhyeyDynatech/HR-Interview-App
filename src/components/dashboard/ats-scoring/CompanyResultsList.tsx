"use client";

import React, { useState, useEffect } from "react";
import { AggregatedCompany } from "@/types/company-finder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Globe, Eye, FileText, Trash2 } from "lucide-react";
import { PaginationControls } from "@/components/ui/pagination-controls";

const PAGE_SIZE = 20;

interface CompanyResultsListProps {
  companies: AggregatedCompany[];
  previewUrls: Record<string, string>;
  resumeUrlMap: Record<string, string>;
  onViewResume: (url: string, name: string) => void;
  selectedCompanies: Set<string>;
  onToggleSelect: (companyName: string) => void;
  onToggleSelectAll: () => void;
  onDeleteCompany: (companyName: string) => void;
}

export const CompanyResultsList: React.FC<CompanyResultsListProps> = ({
  companies,
  previewUrls,
  resumeUrlMap,
  onViewResume,
  selectedCompanies,
  onToggleSelect,
  onToggleSelectAll,
  onDeleteCompany,
}) => {
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => { setCurrentPage(1); }, [companies.length]);

  const pagedCompanies = companies.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allSelected = companies.length > 0 && selectedCompanies.size === companies.length;

  return (
    <div className="flex flex-col gap-3">
    <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50">
            <th className="py-3 px-3 w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
            </th>
            <th className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Company</th>
            <th className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Type</th>
            <th className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Description</th>
            <th className="text-center py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Frequency</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {pagedCompanies.map((company, index) => {
            const key = company.companyName.trim().toLowerCase();
            const isSelected = selectedCompanies.has(key);

            return (
              <tr
                key={`${company.companyName}-${index}`}
                className={`border-b last:border-0 transition-colors ${isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50"}`}
              >
                {/* Checkbox */}
                <td className="py-3 px-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(company.companyName)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </td>

                {/* Company Name + Date */}
                <td className="py-3 px-4 min-w-[140px]">
                  <span className="font-medium text-slate-800 block">{company.companyName}</span>
                  {company.scannedAt && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(company.scannedAt).toLocaleDateString()}
                    </span>
                  )}
                </td>

                {/* Type Badge */}
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
                    {company.companyType === "service_provider"
                      ? "Provider"
                      : company.companyType === "service_consumer"
                      ? "Consumer"
                      : "Unknown"}
                  </Badge>
                </td>

                {/* Description */}
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
                    <p className="text-xs text-slate-500 mt-0.5 italic">
                      {company.contexts.filter(Boolean).join(" | ")}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {(company.sourceResumes || []).slice(0, 10).map((name) => {
                        const url = previewUrls[name] || resumeUrlMap[name];
                        return url ? (
                          <button
                            key={name}
                            onClick={() => onViewResume(url, name)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-[10px] text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-100"
                          >
                            <Eye className="h-3 w-3" />
                            <span className="max-w-[150px] truncate">{name}</span>
                          </button>
                        ) : (
                          <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] text-slate-500 border border-slate-200">
                            <FileText className="h-3 w-3" />
                            <span className="max-w-[150px] truncate">{name}</span>
                          </span>
                        );
                      })}
                      {(company.sourceResumes || []).length > 10 && (
                        <span className="text-[10px] text-slate-400 self-center">
                          +{company.sourceResumes.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Frequency */}
                <td className="py-3 px-4 text-center">
                  <span className="font-medium text-slate-700">{company.frequency}</span>
                </td>

                {/* Delete */}
                <td className="py-3 px-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
                    onClick={() => onDeleteCompany(company.companyName)}
                    title="Delete company"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <PaginationControls
      currentPage={currentPage}
      totalItems={companies.length}
      pageSize={PAGE_SIZE}
      onPageChange={setCurrentPage}
    />
    </div>
  );
};
