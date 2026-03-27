"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Extract workers (fast — NLP only, no web search) ─────────────────────────
const EXTRACT_BATCH    = 5;   // resumes per /extract call
const EXTRACT_CONCUR   = 3;   // parallel /extract workers
const EXTRACT_WAIT_MS  = 3000; // wait when 202 (tasks in-flight by another worker)
const EXTRACT_MAX_WAIT = 40;  // max consecutive 202s before giving up (~2 min)

// ── Enrich workers (slow — web search per company) ───────────────────────────
const ENRICH_WAIT_MS   = 8000;  // wait when 202 (no companies queued yet or in-flight)
const ENRICH_MAX_WAIT  = 150;   // max consecutive 202s (~20 min)
const ENRICH_CONCUR    = 3;     // parallel /enrich workers

const INTER_BATCH_MS   = 300;   // cooldown between iterations

interface CFBatchProcessorProps {
  scanId: string;
  totalItems: number;
  initialProcessed?: number;
  onComplete: () => void;
  onProgress: (current: number, total: number) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
}

export const CFBatchProcessor: React.FC<CFBatchProcessorProps> = ({
  scanId,
  totalItems,
  initialProcessed = 0,
  onComplete,
  onProgress,
  isProcessing,
  setIsProcessing,
}) => {

  // Refs so worker closures always see current values without stale captures
  const isProcessingRef     = useRef(isProcessing);
  const extractedRef        = useRef(initialProcessed);
  const extractDoneRef      = useRef(false);
  const enrichDoneRef       = useRef(false);
  const completedRef        = useRef(false);
  const workersStartedRef   = useRef(false);

  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    isProcessingRef.current = false;
    setIsProcessing(false);
    onComplete();
  }, [onComplete, setIsProcessing]);

  // ── Extract worker loop ───────────────────────────────────────────────────
  const runExtractWorker = useCallback(async () => {
    let consecutiveWaiting = 0;

    while (isProcessingRef.current && !extractDoneRef.current) {
      let res: Response;
      let data: any;

      try {
        res = await fetch(`/api/company-finder/scans/${scanId}/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: EXTRACT_BATCH }),
        });
        data = await res.json();
      } catch {
        consecutiveWaiting++;
        if (consecutiveWaiting >= EXTRACT_MAX_WAIT) return;
        await sleep(EXTRACT_WAIT_MS);
        continue;
      }

      if (res.status === 404) return; // no active job

      if (res.status === 202 && data.waiting) {
        consecutiveWaiting++;
        if (consecutiveWaiting >= EXTRACT_MAX_WAIT) return;
        await sleep(EXTRACT_WAIT_MS);
        continue;
      }
      consecutiveWaiting = 0;

      if (data.extractionDone) {
        extractDoneRef.current = true;
        return;
      }

      if (!res.ok) {
        await sleep(INTER_BATCH_MS);
        continue;
      }

      const processed: number = data.processedCount || 0;

      extractedRef.current += processed;
      onProgress(extractedRef.current, totalItems);

      if (totalItems > 0 && extractedRef.current >= totalItems) {
        extractDoneRef.current = true;
        return;
      }

      await sleep(INTER_BATCH_MS);
    }
  }, [scanId, totalItems, onProgress]);

  // ── Enrich worker loop ────────────────────────────────────────────────────
  // NOTE: workers do NOT call finish() — the IIFE owns finish() so the retry
  // pass can run after the first enrich pass completes.
  const runEnrichWorker = useCallback(async () => {
    let consecutiveWaiting = 0;

    while (isProcessingRef.current && !enrichDoneRef.current) {
      let res: Response;
      let data: any;

      try {
        res = await fetch(`/api/company-finder/scans/${scanId}/enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        data = await res.json();
      } catch {
        consecutiveWaiting++;
        if (consecutiveWaiting >= ENRICH_MAX_WAIT) { enrichDoneRef.current = true; return; }
        await sleep(ENRICH_WAIT_MS);
        continue;
      }

      // 404 = job marked complete by enrich route → all done
      if (res.status === 404 || data.message === "All done") {
        enrichDoneRef.current = true; // signal other workers to stop
        return;
      }

      if (res.status === 202 && data.waiting) {
        consecutiveWaiting++;
        if (consecutiveWaiting >= ENRICH_MAX_WAIT) { enrichDoneRef.current = true; return; }
        await sleep(ENRICH_WAIT_MS);
        continue;
      }
      consecutiveWaiting = 0;

      if (!res.ok) {
        await sleep(INTER_BATCH_MS);
        continue;
      }

      await sleep(INTER_BATCH_MS);
    }
  }, [scanId]);

  // ── Start both worker groups when isProcessing flips to true ─────────────
  useEffect(() => {
    if (!isProcessing) {
      workersStartedRef.current = false;
      return;
    }
    if (workersStartedRef.current) return;
    workersStartedRef.current = true;

    // Reset state
    completedRef.current     = false;
    extractDoneRef.current   = false;
    enrichDoneRef.current    = false;
    extractedRef.current     = initialProcessed;

    // Run extract workers first; only after ALL extraction is done, start enrich
    (async () => {
      const extractWorkers = Array.from({ length: EXTRACT_CONCUR }, () => runExtractWorker());
      await Promise.all(extractWorkers);

      // Guard: user may have cancelled while extraction was running
      if (!isProcessingRef.current) { finish(); return; }

      enrichDoneRef.current = false;
      const enrichWorkers = Array.from({ length: ENRICH_CONCUR }, () => runEnrichWorker());
      await Promise.all(enrichWorkers);

      // One retry pass — reset any failed enrich items back to pending and try once more
      if (isProcessingRef.current) {
        try {
          const retryRes = await fetch(`/api/company-finder/scans/${scanId}/retry-failed`, { method: "POST" });
          const retryData = await retryRes.json();
          if (retryData.resetCount > 0) {
            enrichDoneRef.current = false; // reset for retry pass
            const retryWorkers = Array.from({ length: ENRICH_CONCUR }, () => runEnrichWorker());
            await Promise.all(retryWorkers);
          }
        } catch {
          // Retry fetch failed — proceed to finish
        }
      }

      finish();
    })();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing]);

  return null;
};
