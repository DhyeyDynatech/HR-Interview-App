"use client";

import { Interview } from "@/types/interview";
import { Interviewer } from "@/types/interviewer";
import { Response } from "@/types/response";
import React, { useEffect, useState, useCallback } from "react";
import { UserCircleIcon, SmileIcon, Info } from "lucide-react";
import { useInterviewers } from "@/contexts/interviewers.context";
import { PieChart } from "@mui/x-charts/PieChart";
import { CandidateStatus } from "@/lib/enum";
import { convertSecondstoMMSS } from "@/lib/utils";
import Image from "next/image";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import DataTable, {
  TableData,
} from "@/components/dashboard/interview/dataTable";
import { ScrollArea } from "@/components/ui/scroll-area";

type SummaryProps = {
  responses: Response[];
  interview: Interview | undefined;
};

function InfoTooltip({ content }: { content: string }) {

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info
            className="h-2 w-2 text-[#4F46E5] inline-block ml-0 align-super font-bold"
            strokeWidth={2.5}
          />
        </TooltipTrigger>
        <TooltipContent className="bg-gray-500 text-white font-normal">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SummaryInfo({ responses, interview }: SummaryProps) {
  const { interviewers } = useInterviewers();
  const [interviewer, setInterviewer] = useState<Interviewer>();
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [completedInterviews, setCompletedInterviews] = useState<number>(0);
  const [sentimentCount, setSentimentCount] = useState({
    positive: 0,
    negative: 0,
    neutral: 0,
  });
  const [callCompletion, setCallCompletion] = useState({
    complete: 0,
    incomplete: 0,
    partial: 0,
  });
  const totalResponses = responses.length;

  const [candidateStatusCount, setCandidateStatusCount] = useState({
    [CandidateStatus.NO_STATUS]: 0,
    [CandidateStatus.NOT_SELECTED]: 0,
    [CandidateStatus.POTENTIAL]: 0,
    [CandidateStatus.SELECTED]: 0,
  });

  const [tableData, setTableData] = useState<TableData[]>([]);

  // Memoize prepareTableData to prevent recreation on every render
  const prepareTableData = useCallback((responses: Response[]): TableData[] => {
    return responses.map((response) => {
      // Extract communication score - handle both number and string formats
      let communicationScore: number = 0;
      const commScoreRaw = response.analytics?.communication?.score;
      if (commScoreRaw !== null && commScoreRaw !== undefined) {
        // Convert to string first to check for "/" pattern
        const commScoreStr = String(commScoreRaw);
        if (commScoreStr.includes("/")) {
          // Extract number before "/" if it's in "X/10" format
          const numPart = commScoreStr.split("/")[0].trim();
          communicationScore = parseFloat(numPart) || 0;
        } else if (typeof commScoreRaw === "number") {
          communicationScore = commScoreRaw;
        } else {
          // Try to parse as number
          const parsed = parseFloat(commScoreStr);
          communicationScore = isNaN(parsed) ? 0 : parsed;
        }
      }

      // Extract overall score - handle both number and string formats
      let overallScore: number = 0;
      const overallScoreRaw = response.analytics?.overallScore;
      if (overallScoreRaw !== null && overallScoreRaw !== undefined) {
        // Convert to string first to check for "/" pattern
        const overallScoreStr = String(overallScoreRaw);
        if (overallScoreStr.includes("/")) {
          // Extract number before "/" if it's in "X/100" format
          const numPart = overallScoreStr.split("/")[0].trim();
          overallScore = parseFloat(numPart) || 0;
        } else if (typeof overallScoreRaw === "number") {
          overallScore = overallScoreRaw;
        } else {
          // Try to parse as number
          const parsed = parseFloat(overallScoreStr);
          overallScore = isNaN(parsed) ? 0 : parsed;
        }
      }

      return {
        call_id: response.call_id,
        name: response.name || "Anonymous",
        overallScore: overallScore,
        communicationScore: communicationScore,
        callSummary:
          response.analytics?.softSkillSummary ||
          response.details?.call_analysis?.call_summary ||
          "No summary available",
      };
    });
  }, []); // Empty dependencies since function doesn't depend on props/state

  useEffect(() => {
    if (!interviewers || !interview) {
      return;
    }
    const interviewer = interviewers.find(
      (interviewer) => interviewer.id === interview.interviewer_id,
    );
    setInterviewer(interviewer);
  }, [interviewers, interview]);

  useEffect(() => {
    if (!responses) {
      return;
    }

    const sentimentCounter = {
      positive: 0,
      negative: 0,
      neutral: 0,
    };

    const callCompletionCounter = {
      complete: 0,
      incomplete: 0,
      partial: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;

    const statusCounter = {
      [CandidateStatus.NO_STATUS]: 0,
      [CandidateStatus.NOT_SELECTED]: 0,
      [CandidateStatus.POTENTIAL]: 0,
      [CandidateStatus.SELECTED]: 0,
    };

    responses.forEach((response) => {
      const sentiment = response.details?.call_analysis?.user_sentiment;
      if (sentiment === "Positive") {
        sentimentCounter.positive += 1;
      } else if (sentiment === "Negative") {
        sentimentCounter.negative += 1;
      } else if (sentiment === "Neutral") {
        sentimentCounter.neutral += 1;
      }

      const callCompletion =
        response.details?.call_analysis?.call_completion_rating;
      if (callCompletion === "Complete") {
        callCompletionCounter.complete += 1;
      } else if (callCompletion === "Incomplete") {
        callCompletionCounter.incomplete += 1;
      } else if (callCompletion === "Partial") {
        callCompletionCounter.partial += 1;
      }

      const agentTaskCompletion =
        response.details?.call_analysis?.agent_task_completion_rating;
      if (
        agentTaskCompletion === "Complete" ||
        agentTaskCompletion === "Partial"
      ) {
        completedCount += 1;
      }

      totalDuration += response.duration;
      if (
        Object.values(CandidateStatus).includes(
          response.candidate_status as CandidateStatus,
        )
      ) {
        statusCounter[response.candidate_status as CandidateStatus]++;
      }
    });

    setSentimentCount(sentimentCounter);
    setCallCompletion(callCompletionCounter);
    setTotalDuration(totalDuration);
    setCompletedInterviews(completedCount);
    setCandidateStatusCount(statusCounter);

    const preparedData = prepareTableData(responses);
    setTableData(preparedData);
  }, [responses]);


  return (
    <div className="min-h-[60vh] md:h-screen z-[10] mx-1 md:mx-2 overflow-y-auto">
      {responses.length > 0 ? (
        <div className="bg-slate-200 rounded-2xl min-h-[120px] p-3 md:p-4">
          <div className="flex flex-col md:flex-row gap-2 justify-between items-start md:items-center mb-3">
            <div className="flex flex-row gap-2 items-center">
              <p className="font-semibold text-base md:text-lg">Overall Analysis</p>
            </div>
            <p className="text-sm md:text-base">
              Interviewer used:{" "}
              <span className="font-medium">{interviewer?.name}</span>
            </p>
          </div>
          <p className="mb-4 text-sm md:text-base">
            Interview Description:{" "}
            <span className="font-medium">{interview?.description}</span>
          </p>
          <div className="mb-4 p-3 md:p-4 rounded-2xl bg-slate-50 shadow-md">
            <ScrollArea className="h-[250px] md:h-[300px]">
              <DataTable data={tableData} interviewId={interview?.id || ""} />
            </ScrollArea>
          </div>
          {/* Three Panels Layout */}
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            {/* Left Panel - Stacked Cards */}
            <div className="flex flex-col gap-4 w-full md:w-[28%]">
              <div className="flex flex-col p-4 rounded-2xl bg-slate-50 shadow-md min-h-[140px] justify-center">
                <div className="flex flex-row items-center justify-center gap-1 font-semibold mb-3 text-[15px]">
                  Average Duration
                  <InfoTooltip content="Average time users took to complete an interview" />
                </div>
                <div className="flex items-center justify-center">
                  <p className="text-2xl font-semibold text-indigo-600 w-fit p-2 px-4 bg-indigo-100 rounded-md">
                    {convertSecondstoMMSS(totalDuration / responses.length)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-50 shadow-md min-h-[140px]">
                <div className="flex flex-row gap-1 font-semibold mb-3 text-[15px] text-center">
                  Interview Completion Rate
                  <InfoTooltip content="Percentage of interviews completed successfully" />
                </div>
                <p className="w-fit text-2xl font-semibold text-indigo-600 p-2 px-4 bg-indigo-100 rounded-md">
                  {Math.round(
                    (completedInterviews / responses.length) * 10000,
                  ) / 100}
                  %
                </p>
              </div>
            </div>
            {/* Middle Panel - Candidate Sentiment */}
            <div className="flex flex-col p-4 rounded-2xl bg-slate-50 shadow-md w-full md:w-[36%] min-h-[320px]">
              <div className="flex flex-row gap-2 items-center justify-center font-bold mb-4 text-[15px]">
                <SmileIcon className="w-5 h-5" />
                Candidate Sentiment
                <InfoTooltip content="Distribution of user sentiments during interviews" />
              </div>
              <div className="flex flex-row gap-4 w-full flex-1 items-center">
                {/* Chart Part - Takes more space */}
                <div className="flex-[1.8] flex justify-center items-center min-h-0">
                  <PieChart
                    sx={{
                      "& .MuiChartsLegend-root": {
                        display: "none !important",
                      },
                    }}
                    series={[
                      {
                        data: [
                          {
                            id: 0,
                            value: sentimentCount.positive,
                            label: `Positive (${sentimentCount.positive})`,
                            color: "#22c55e",
                          },
                          {
                            id: 1,
                            value: sentimentCount.negative,
                            label: `Negative (${sentimentCount.negative})`,
                            color: "#ef4444",
                          },
                          {
                            id: 2,
                            value: sentimentCount.neutral,
                            label: `Neutral (${sentimentCount.neutral})`,
                            color: "#eab308",
                          },
                        ],
                        highlightScope: { faded: "global", highlighted: "item" },
                        faded: {
                          innerRadius: 10,
                          additionalRadius: -10,
                          color: "gray",
                        },
                      },
                    ]}
                    width={240}
                    height={240}
                  />
                </div>
                {/* Content/Legend Part - Takes less space */}
                <div className="flex-1 flex flex-col justify-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#22c55e]"></div>
                    <span className="text-sm font-medium">Positive ({sentimentCount.positive})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#ef4444]"></div>
                    <span className="text-sm font-medium">Negative ({sentimentCount.negative})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#eab308]"></div>
                    <span className="text-sm font-medium">Neutral ({sentimentCount.neutral})</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Right Panel - Candidate Status */}
            <div className="flex flex-col p-4 rounded-2xl bg-slate-50 shadow-md w-full md:w-[36%] min-h-[320px]">
              <div className="flex flex-row gap-2 items-center justify-center font-bold mb-4 text-[15px]">
                <UserCircleIcon className="w-5 h-5" />
                Candidate Status
                <InfoTooltip content="Breakdown of the candidate selection status" />
              </div>
              <div className="flex flex-row gap-4 w-full flex-1 items-center">
                {/* Chart Part - Takes more space */}
                <div className="flex-[1.8] flex justify-center items-center min-h-0">
                  <PieChart
                    sx={{
                      "& .MuiChartsLegend-root": {
                        display: "none !important",
                      },
                    }}
                    series={[
                      {
                        data: [
                          {
                            id: 0,
                            value: candidateStatusCount[CandidateStatus.SELECTED],
                            label: `Selected (${candidateStatusCount[CandidateStatus.SELECTED]})`,
                            color: "#22c55e",
                          },
                          {
                            id: 1,
                            value: candidateStatusCount[CandidateStatus.POTENTIAL],
                            label: `Potential (${candidateStatusCount[CandidateStatus.POTENTIAL]})`,
                            color: "#eab308",
                          },
                          {
                            id: 2,
                            value:
                              candidateStatusCount[CandidateStatus.NOT_SELECTED],
                            label: `Not Selected (${candidateStatusCount[CandidateStatus.NOT_SELECTED]})`,
                            color: "#eb4444",
                          },
                          {
                            id: 3,
                            value: candidateStatusCount[CandidateStatus.NO_STATUS],
                            label: `To Be Reviewed (${candidateStatusCount[CandidateStatus.NO_STATUS]})`,
                            color: "#9ca3af",
                          },
                        ],
                        highlightScope: { faded: "global", highlighted: "item" },
                        faded: {
                          innerRadius: 10,
                          additionalRadius: -10,
                          color: "gray",
                        },
                      },
                    ]}
                    width={240}
                    height={240}
                  />
                </div>
                {/* Content/Legend Part - Takes less space */}
                <div className="flex-1 flex flex-col justify-center gap-3">
                  <div className="text-sm font-medium text-center mb-2">
                    Total Responses: {totalResponses}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#22c55e]"></div>
                    <span className="text-sm font-medium">Selected ({candidateStatusCount[CandidateStatus.SELECTED]})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#eab308]"></div>
                    <span className="text-sm font-medium">Potential ({candidateStatusCount[CandidateStatus.POTENTIAL]})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#eb4444]"></div>
                    <span className="text-sm font-medium">Not Selected ({candidateStatusCount[CandidateStatus.NOT_SELECTED]})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#9ca3af]"></div>
                    <span className="text-sm font-medium">To Be Reviewed ({candidateStatusCount[CandidateStatus.NO_STATUS]})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-[60%] flex flex-col items-center justify-center">
          <div className="flex flex-col items-center">
            <Image
              src="/no-responses.png"
              alt="logo"
              width={270}
              height={270}
              className="w-48 h-48 md:w-[270px] md:h-[270px]"
            />
            <p className="text-center text-xs md:text-sm mt-0 px-4">
              Please share with your intended respondents
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SummaryInfo;
