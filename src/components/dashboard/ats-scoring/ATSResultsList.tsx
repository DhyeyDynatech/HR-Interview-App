"use client";

import React from "react";
import ATSResultCard from "./atsResultCard";
import { ATSScoreResult } from "@/types/ats-scoring";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ATSResultsListProps {
  results: ATSScoreResult[];
  selectedResults: Set<string>;
  toggleSelect: (resumeName: string) => void;
  toggleSelectAll: () => void;
  handleDeleteResult: (name: string) => void;
  handleDeleteSelected: () => void;
  previewUrls: Record<string, string>;
  uploadingFiles: Set<string>;
  searchQuery: string;
}

export const ATSResultsList: React.FC<ATSResultsListProps> = ({
  results,
  selectedResults,
  toggleSelect,
  toggleSelectAll,
  handleDeleteResult,
  handleDeleteSelected,
  previewUrls,
  uploadingFiles,
}) => {
  const isAllSelected = results.length > 0 && selectedResults.size === results.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-sm text-slate-600">Select All</span>
          </label>
          <p className="text-sm text-slate-500">
            Showing {results.length.toLocaleString()} results
            {selectedResults.size > 0 && (
              <span className="text-indigo-600 font-medium ml-1">
                ({selectedResults.size.toLocaleString()} selected)
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
            Delete Selected ({selectedResults.size.toLocaleString()})
          </Button>
        )}
      </div>

      {/* List — no fixed height; page scroll handles overflow */}
      <div className="w-full space-y-3">
        {results.map((result, index) => (
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
        ))}
      </div>
    </div>
  );
};
