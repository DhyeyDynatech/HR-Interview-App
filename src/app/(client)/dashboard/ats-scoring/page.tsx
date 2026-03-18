"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useInterviews } from "@/contexts/interviews.context";
import { ATSJobService } from "@/services/ats-job.service";
import { ATSJobCardData } from "@/types/ats-scoring";
import JobGrid from "@/components/dashboard/ats-scoring/jobGrid";
import ScoringView from "@/components/dashboard/ats-scoring/scoringView";

const SELECTED_JOB_KEY = "ats_selected_job";

export default function ATSScoringPage() {
  const { interviews } = useInterviews();
  const [jobs, setJobs] = useState<ATSJobCardData[]>([]);
  const [selectedJob, setSelectedJob] = useState<{ interviewId: string; interviewName: string } | null>(() => {
    // Restore last-opened job on mount so navigation away and back keeps the same view
    try {
      const saved = localStorage.getItem(SELECTED_JOB_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await ATSJobService.listJobs();
      setJobs(data);
    } catch (err) {
      console.error("Failed to load ATS jobs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleAddJobs = async (interviewIds: string[]) => {
    await ATSJobService.addJobs(interviewIds);
    await fetchJobs();
  };

  const handleRemoveJob = async (interviewId: string) => {
    await ATSJobService.removeJob(interviewId);
    setJobs((prev) => prev.filter((j) => j.interviewId !== interviewId));
  };

  const handleSelectJob = (interviewId: string) => {
    const job = jobs.find((j) => j.interviewId === interviewId);
    if (job) {
      const next = { interviewId: job.interviewId, interviewName: job.interviewName };
      setSelectedJob(next);
      try { localStorage.setItem(SELECTED_JOB_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    }
  };

  const handleBack = () => {
    setSelectedJob(null);
    try { localStorage.removeItem(SELECTED_JOB_KEY); } catch { /* ignore */ }
    fetchJobs();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  if (selectedJob) {
    return (
      <ScoringView
        interviewId={selectedJob.interviewId}
        interviewName={selectedJob.interviewName}
        onBack={handleBack}
      />
    );
  }

  return (
    <JobGrid
      jobs={jobs}
      onSelectJob={handleSelectJob}
      onRemoveJob={handleRemoveJob}
      onAddJobs={handleAddJobs}
      interviews={interviews}
      selectedJobIds={jobs.map((j) => j.interviewId)}
    />
  );
}
