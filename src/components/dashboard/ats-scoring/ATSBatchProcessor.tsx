"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const BATCH_SIZE = 5;        // resumes per OpenAI call
const CONCURRENCY = 3;       // parallel workers hitting /process simultaneously
const INTER_BATCH_MS = 200;  // brief cooldown between each worker's iterations
const WAIT_MS = 3000;        // wait time when queue job not yet created (202 response)
const MAX_EMPTY = 3;         // consecutive empty batches before giving up
const MAX_WAITING = 20;      // max consecutive 202 "waiting" retries (~60s) before force-exit

interface ATSBatchProcessorProps {
  interviewId: string;
  totalItems: number;
  initialScored?: number;
  onComplete: () => void;
  onProgress: (current: number, total: number) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
}

export const ATSBatchProcessor: React.FC<ATSBatchProcessorProps> = ({
  interviewId,
  totalItems,
  initialScored = 0,
  onComplete,
  onProgress,
  isProcessing,
  setIsProcessing,
}) => {
  const [scored, setScored] = useState(initialScored);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actualConcurrency, setActualConcurrency] = useState(CONCURRENCY);

  const isProcessingRef = useRef(isProcessing);
  const scoredRef = useRef(initialScored);
  const failedRef = useRef(0);
  const consecutiveEmptyRef = useRef(0);
  const consecutiveWaitingRef = useRef(0);
  const completedRef = useRef(false); // ensures onComplete fires exactly once
  const workersStartedRef = useRef(false);

  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    isProcessingRef.current = false;
    setIsProcessing(false);
    onComplete();
  }, [onComplete, setIsProcessing]);

  const runWorkers = useCallback(async () => {
    const worker = async () => {
      while (isProcessingRef.current) {
        let res: Response;
        let data: any;

        try {
          res = await fetch(`/api/ats-scoring/jobs/${interviewId}/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchSize: BATCH_SIZE }),
          });
          data = await res.json();
        } catch (err: any) {
          console.error("[Processor] Fetch error:", err);
          setError(err.message);
          consecutiveEmptyRef.current += 1;
          if (consecutiveEmptyRef.current >= MAX_EMPTY) { finish(); return; }
          await sleep(INTER_BATCH_MS);
          continue;
        }

        if (res.status === 202 && data.waiting) {
          consecutiveWaitingRef.current += 1;
          if (consecutiveWaitingRef.current >= MAX_WAITING) {
            // Tasks likely stuck in DB "processing" state (Vercel fn timed out mid-execution).
            // Force-exit so the UI doesn't freeze forever.
            console.warn("[Processor] Max waiting retries exceeded — force-finishing.");
            finish();
            return;
          }
          await sleep(WAIT_MS);
          continue;
        }
        // Reset waiting counter on any non-202 response
        consecutiveWaitingRef.current = 0;

        if (res.status === 404) {
          // No active processing job — batch already completed
          console.log("[Processor] No active job (404) — done.");
          finish();
          return;
        }

        if (!res.ok) {
          setError(data.message || "Batch failed");
          consecutiveEmptyRef.current += 1;
          if (consecutiveEmptyRef.current >= MAX_EMPTY) { finish(); return; }
          await sleep(INTER_BATCH_MS);
          continue;
        }

        if (data.dbError) {
          console.error("[Processor] DB upsert error:", data.dbError);
          setError(`DB error: ${data.dbError} — run the unique constraint migration in Supabase`);
        }

        const processedNow: number = data.processedCount || 0;
        const failedNow: number = data.failedCount || 0;

        if (processedNow === 0 && failedNow === 0) {
          consecutiveEmptyRef.current += 1;
          if (consecutiveEmptyRef.current >= MAX_EMPTY) { finish(); return; }
        } else {
          consecutiveEmptyRef.current = 0;
          setError(null);
        }

        // Update shared counters (multiple workers write concurrently — JS is single-threaded so safe)
        scoredRef.current += processedNow;
        failedRef.current += failedNow;
        setScored(scoredRef.current);
        setFailed(failedRef.current);
        onProgress(scoredRef.current, totalItems);

        if (totalItems > 0 && scoredRef.current + failedRef.current >= totalItems) {
          finish();
          return;
        }

        await sleep(INTER_BATCH_MS);
      }
    };

    // Only launch as many workers as there are batches needed
    const computed = totalItems > 0
      ? Math.min(CONCURRENCY, Math.ceil(totalItems / BATCH_SIZE))
      : CONCURRENCY;
    setActualConcurrency(computed);
    // Launch workers in parallel
    await Promise.all(Array.from({ length: computed }, () => worker()));

    // If isProcessing was externally set to false (Pause), workers exit cleanly
  }, [interviewId, totalItems, onProgress, finish]);

  // Start workers when processing begins; reset when it toggles
  useEffect(() => {
    if (!isProcessing) {
      workersStartedRef.current = false;
      return;
    }
    if (workersStartedRef.current) return;
    workersStartedRef.current = true;

    // Reset state for fresh run
    completedRef.current = false;
    scoredRef.current = initialScored;
    failedRef.current = 0;
    consecutiveEmptyRef.current = 0;
    consecutiveWaitingRef.current = 0;
    setScored(initialScored);
    setFailed(0);
    setError(null);

    runWorkers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing]);

  const percentage = totalItems > 0 ? Math.min(100, Math.round((scored / totalItems) * 100)) : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-lg ${isProcessing ? "bg-indigo-50" : "bg-slate-50"}`}>
          <Loader2 className={`h-5 w-5 ${isProcessing ? "text-indigo-500 animate-spin" : "text-slate-400"}`} />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">
            {isProcessing ? "AI Analysing Resumes..." : "Analysis Complete"}
          </h3>
          <p className="text-xs text-slate-500">
            {scored.toLocaleString()} of {totalItems.toLocaleString()} resumes scored
            {failed > 0 && ` · ${failed} failed`}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-indigo-500 transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-green-600 font-medium">
            <CheckCircle2 className="h-3 w-3" />
            {scored} Scored
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1 text-red-600 font-medium">
              <AlertCircle className="h-3 w-3" />
              {failed} Failed
            </span>
          )}
        </div>
        <span className="text-slate-400 font-medium">{percentage}% Complete</span>
      </div>

      {/* Error notice (non-fatal) */}
      {error && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-center gap-2 text-xs text-amber-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <p className="flex-1">Note: {error} — retrying automatically…</p>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-amber-700 font-bold underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
};
