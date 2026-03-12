"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanSearch, Plus, Search } from "lucide-react";
import { Interview } from "@/types/interview";
import { ATSJobCardData } from "@/types/ats-scoring";
import JobCard from "./jobCard";
import AddJobDialog from "./addJobDialog";

interface JobGridProps {
  jobs: ATSJobCardData[];
  onSelectJob: (interviewId: string) => void;
  onRemoveJob: (interviewId: string) => void;
  onAddJobs: (interviewIds: string[]) => void;
  interviews: Interview[];
  selectedJobIds: string[];
}

export default function JobGrid({
  jobs,
  onSelectJob,
  onRemoveJob,
  onAddJobs,
  interviews,
  selectedJobIds,
}: JobGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const filteredJobs = searchQuery
    ? jobs.filter((j) =>
        j.interviewName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : jobs;

  return (
    <main className="p-8 pt-0 ml-12 mr-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mt-8">
        <div>
          <div className="flex items-center gap-2">
            <ScanSearch className="h-6 w-6 text-indigo-500" />
            <h1 className="text-2xl font-bold">ATS Resume Scoring</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Compare resumes against a job description and get AI-powered
            compatibility scores
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Jobs
        </Button>
      </div>

      {/* Search Bar */}
      {jobs.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search jobs by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 max-w-md"
          />
        </div>
      )}

      {/* Job Cards Grid */}
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <Plus className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-slate-700 mb-1">
            No jobs added yet
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Click &quot;Add Jobs&quot; to select interview roles for ATS scoring.
          </p>
          <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Jobs
          </Button>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">
            No jobs match &quot;{searchQuery}&quot;
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.interviewId}
              interviewId={job.interviewId}
              interviewName={job.interviewName}
              hasJd={job.hasJd}
              jdFilename={job.jdFilename}
              resultCount={job.resultCount}
              avgScore={job.avgScore}
              onClick={() => onSelectJob(job.interviewId)}
              onRemove={() => onRemoveJob(job.interviewId)}
            />
          ))}
        </div>
      )}

      {/* Add Job Dialog */}
      <AddJobDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        interviews={interviews}
        selectedJobIds={selectedJobIds}
        onAddJobs={onAddJobs}
      />
    </main>
  );
}
