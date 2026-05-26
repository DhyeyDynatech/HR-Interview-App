import { useEffect, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Copy, ArrowUpRight } from "lucide-react";
import { CopyCheck } from "lucide-react";
import { ResponseService } from "@/services/responses.service";
import axios from "axios";
import MiniLoader from "@/components/loaders/mini-loader/miniLoader";
import { InterviewerService } from "@/services/interviewers.service";

interface Props {
  name: string | null;
  interviewerId: bigint;
  id: string;
  url: string;
  readableSlug: string;
  variant?: 'grid' | 'list';
}

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

function InterviewCard({ name, interviewerId, id, url, readableSlug, variant = 'grid' }: Props) {
  const [copied, setCopied] = useState(false);
  const [responseCount, setResponseCount] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [img, setImg] = useState("");

  useEffect(() => {
    const fetchInterviewer = async () => {
      const interviewer =
        await InterviewerService.getInterviewer(interviewerId);
      setImg(interviewer.image);
    };
    fetchInterviewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();
    // For Retell, get-call drives analysis inline so usually one tick is
    // enough. For Voice Live, analysis is driven by /api/voice-live/save-call
    // on the candidate's connection, so the dashboard has to keep polling
    // until that finishes. Five minutes is a safe upper bound — longer than
    // any realistic interview-end-to-analytics gap, short enough to stop
    // spinning forever if save-call crashed.
    const MAX_POLL_DURATION_MS = 5 * 60 * 1000;
    const POLL_INTERVAL_MS = 5000;

    const tick = async () => {
      if (cancelled) return;

      try {
        const responses = await ResponseService.getAllResponses(id);
        if (cancelled) return;

        // Count unique respondents by email (one per assignee)
        const uniqueEmails = new Set(
          responses
            .map((r: any) => r.email?.toLowerCase())
            .filter((email: string | undefined | null) => !!email),
        );
        setResponseCount(uniqueEmails.size);

        const unanalysed = responses.filter((r: any) => !r.is_analysed);
        if (unanalysed.length === 0) {
          setIsFetching(false);

          return;
        }

        setIsFetching(true);

        // Drive each unanalysed response forward. For Retell this runs
        // analytics inline; for Voice Live this either retries analytics
        // from the saved transcript or returns in_progress (no-op).
        for (const response of unanalysed) {
          if (cancelled) return;
          try {
            await axios.post("/api/get-call", { id: response.call_id });
          } catch {
            // API failure — keep polling, save-call may still be in flight
          }
        }

        if (cancelled) return;

        if (Date.now() - startTime < MAX_POLL_DURATION_MS) {
          pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          setIsFetching(false);
        }
      } catch {
        if (!cancelled) setIsFetching(false);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard
      .writeText(
        readableSlug ? `${base_url}/call/${readableSlug}` : (url as string),
      )
      .then(
        () => {
          setCopied(true);
          toast.success(
            "The link to your interview has been copied to your clipboard.",
            {
              position: "bottom-right",
              duration: 3000,
            },
          );
          setTimeout(() => {
            setCopied(false);
          }, 2000);
        },
        () => {
          // Failed to copy to clipboard
        },
      );
  };

  const handleJumpToInterview = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const interviewUrl = readableSlug
      ? `/call/${readableSlug}`
      : `/call/${url}`;
    window.open(interviewUrl, "_blank");
  };

  const linkStyle = {
    pointerEvents: isFetching ? ("none" as const) : ("auto" as const),
    cursor: isFetching ? "default" : "pointer",
  };

  if (variant === 'list') {

    return (
      <a href={`/interviews/${id}`} style={linkStyle}>
        <div className={`flex items-center gap-4 rounded-lg border bg-white px-4 py-3 hover:shadow-sm transition-shadow ${isFetching ? "opacity-60" : ""}`}>
          <div className="flex-shrink-0">
            {img ? (
              <Image
                src={img}
                alt="Picture of the interviewer"
                width={36}
                height={36}
                className="object-cover object-center rounded"
              />
            ) : (
              <div className="w-9 h-9 bg-gray-200 rounded animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-gray-900 truncate">{name}</p>
            {isFetching && <div className="mt-1"><MiniLoader /></div>}
          </div>
          <div className="text-gray-600 text-xs font-medium whitespace-nowrap">
            Responses:{" "}
            <span className="text-gray-900 font-semibold">
              {responseCount?.toString() || 0}
            </span>
          </div>
          <div className="flex gap-1">
            <Button
              className="text-xs text-indigo-600 px-2 h-8"
              variant="secondary"
              onClick={handleJumpToInterview}
            >
              <ArrowUpRight size={16} />
            </Button>
            <Button
              className={`text-xs text-indigo-600 px-2 h-8 ${copied ? "bg-indigo-300 text-white" : ""}`}
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                copyToClipboard();
              }}
            >
              {copied ? <CopyCheck size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </div>
      </a>
    );
  }

  return (
    <a href={`/interviews/${id}`} style={linkStyle}>
      <Card className="relative p-0 cursor-pointer h-40 w-52 rounded-lg border shadow-sm hover:shadow-md transition-shadow">
        <CardContent className={`p-0 ${isFetching ? "opacity-60" : ""}`}>
          <div className="w-full h-24 overflow-hidden bg-indigo-600 flex items-center text-center">
            <CardTitle className="w-full mx-2 text-white text-sm font-medium">
              {name}
              {isFetching && (
                <div className="z-100 mt-[-5px]">
                  <MiniLoader />
                </div>
              )}
            </CardTitle>
          </div>
          <div className="flex flex-row items-center px-3 py-2">
            <div className="flex-shrink-0">
              {img ? (
                <Image
                  src={img}
                  alt="Picture of the interviewer"
                  width={40}
                  height={40}
                  className="object-cover object-center"
                />
              ) : (
                <div className="w-[40px] h-[40px] bg-gray-200 rounded animate-pulse" />
              )}
            </div>
            <div className="text-gray-600 text-xs font-medium ml-auto whitespace-nowrap">
              Responses:{" "}
              <span className="text-gray-900">
                {responseCount?.toString() || 0}
              </span>
            </div>
          </div>
          <div className="absolute top-2 right-2 flex gap-1">
            <Button
              className="text-xs text-indigo-600 px-1 h-6"
              variant={"secondary"}
              onClick={handleJumpToInterview}
            >
              <ArrowUpRight size={16} />
            </Button>
            <Button
              className={`text-xs text-indigo-600 px-1 h-6  ${
                copied ? "bg-indigo-300 text-white" : ""
              }`}
              variant={"secondary"}
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                copyToClipboard();
              }}
            >
              {copied ? <CopyCheck size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

export default InterviewCard;
