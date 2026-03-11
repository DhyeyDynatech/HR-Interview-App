"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, X, CheckCircle2, AlertCircle, Users } from "lucide-react";

interface JobCardProps {
  interviewId: string;
  interviewName: string;
  hasJd: boolean;
  jdFilename: string;
  resultCount: number;
  avgScore: number;
  onClick: () => void;
  onRemove: () => void;
}

export default function JobCard({
  interviewName,
  hasJd,
  jdFilename,
  resultCount,
  avgScore,
  onClick,
  onRemove,
}: JobCardProps) {
  const getScoreColor = (score: number) => {
    // Normalize legacy 0-100 scores to 0-10
    const s = score > 10 ? Math.round((score / 10) * 10) / 10 : score;
    if (s >= 7.5) return "text-green-600";
    if (s >= 5) return "text-amber-600";
    return "text-red-600";
  };

  return (
    <Card
      className="group relative cursor-pointer transition-all duration-200 hover:shadow-md hover:border-indigo-200 min-h-[140px] flex flex-col"
      onClick={onClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500"
        title="Remove job"
      >
        <X className="h-4 w-4" />
      </button>

      <CardContent className="flex flex-col justify-between flex-1 pt-5 pb-4">
        <div className="flex items-start gap-2 mb-3">
          <FileText className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
          <h3 className="font-semibold text-sm leading-tight line-clamp-2">
            {interviewName}
          </h3>
        </div>

        <div className="flex flex-col gap-1.5">
          {hasJd ? (
            <Badge
              variant="outline"
              className="bg-green-50 text-green-700 border-green-200 text-xs gap-1 w-fit"
            >
              <CheckCircle2 className="h-3 w-3" />
              {jdFilename
                ? `JD: ${jdFilename.length > 20 ? jdFilename.slice(0, 20) + "..." : jdFilename}`
                : "JD uploaded"}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-slate-50 text-slate-500 border-dashed border-slate-300 text-xs gap-1 w-fit"
            >
              <AlertCircle className="h-3 w-3" />
              No JD uploaded
            </Badge>
          )}

          {resultCount > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant="outline"
                className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs gap-1 w-fit"
              >
                <Users className="h-3 w-3" />
                {resultCount} scored
              </Badge>
              <span className={`text-xs font-semibold ${getScoreColor(avgScore)}`}>
                Avg: {avgScore}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
