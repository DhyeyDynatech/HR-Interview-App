"use client";

import React, { useEffect, useState } from "react";
import {
  Analytics,
  CallData,
  ViolationEvent,
  Response as InterviewResponse,
} from "@/types/response";
import axios from "axios";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import ReactAudioPlayer from "react-audio-player";
import { DownloadIcon, TrashIcon, Clock, AlertTriangle, Video, Users, CheckCircle2, CameraOff, UserX, Shield, Monitor, Calendar, Smile, Frown, Meh } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ResponseService } from "@/services/responses.service";
import { useRouter } from "next/navigation";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { CircularProgress } from "@nextui-org/react";
import QuestionAnswerCard from "@/components/dashboard/interview/questionAnswerCard";
import { marked } from "marked";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateStatus } from "@/lib/enum";
import { ArrowLeft } from "lucide-react";
import { assigneeService } from "@/services/users.service";

type CallProps = {
  call_id: string;
  onDeleteResponse: (deletedCallId: string) => void;
  onCandidateStatusChange: (callId: string, newStatus: string) => void;
};

function CallInfo({
  call_id,
  onDeleteResponse,
  onCandidateStatusChange,
}: CallProps) {
  const [call, setCall] = useState<CallData>();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isClicked, setIsClicked] = useState(false);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<string>("");
  const [interviewId, setInterviewId] = useState<string>("");
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);
  const [faceMismatchCount, setFaceMismatchCount] = useState<number>(0);
  const [cameraOffCount, setCameraOffCount] = useState<number>(0);
  const [multiplePersonCount, setMultiplePersonCount] = useState<number>(0);
  const [faceMismatchTotal, setFaceMismatchTotal] = useState<number>(0);
  const [cameraOffTotal, setCameraOffTotal] = useState<number>(0);
  const [multiplePersonTotal, setMultiplePersonTotal] = useState<number>(0);
  const [violationsSummary, setViolationsSummary] =
    useState<ViolationEvent[]>([]);
  const [responseData, setResponseData] = useState<any>(null);
  const [userResponses, setUserResponses] = useState<InterviewResponse[]>([]);
  const [qaPairs, setQaPairs] = useState<Array<{ question: string; answer: string }>>([]);

  useEffect(() => {
    const fetchResponses = async () => {
      setIsLoading(true);
      setCall(undefined);
      setEmail("");
      setName("");

      try {
        const response = await axios.post("/api/get-call", { id: call_id });
        setCall(response.data.callResponse);
        setAnalytics(response.data.analytics);
        
        // Update responseData with duration from API if available
        if (response.data.duration !== undefined) {
          setResponseData((prev: any) => ({
            ...prev,
            duration: response.data.duration,
            details: response.data.callResponse,
          }));
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call_id]);

  useEffect(() => {
    const fetchEmail = async () => {
      setIsLoading(true);
      try {
        const response = await ResponseService.getResponseByCallId(call_id);
        setEmail(response.email);
        setName(response.name);
        setCandidateStatus(response.candidate_status);
        setInterviewId(response.interview_id);
        setTabSwitchCount(response.tab_switch_count || 0);
        setFaceMismatchCount(response.face_mismatch_count || 0);
        setCameraOffCount(response.camera_off_count || 0);
        setMultiplePersonCount(response.multiple_person_count || 0);
        setFaceMismatchTotal(response.face_mismatch_total || 0);
        setCameraOffTotal(response.camera_off_total || 0);
        setMultiplePersonTotal(response.multiple_person_total || 0);
        setViolationsSummary(response.violations_summary || []);
        setResponseData(response);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call_id]);

  // Fetch all attempts for this assignee (by email + interview_id)
  useEffect(() => {
    const fetchUserResponses = async () => {
      try {
        if (!email || !interviewId) {
          return;
        }

        const allResponses =
          await ResponseService.getAllResponses(interviewId);

        const sameUserResponses = allResponses.filter(
          (r: InterviewResponse) =>
            r.email &&
            email &&
            r.email.toLowerCase() === email.toLowerCase(),
        );

        sameUserResponses.sort(
          (a: InterviewResponse, b: InterviewResponse) =>
            new Date(String(b.created_at)).getTime() -
            new Date(String(a.created_at)).getTime(),
        );

        setUserResponses(sameUserResponses);
      } catch (error) {
        console.error("Error fetching user responses:", error);
      }
    };

    fetchUserResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, interviewId]);

  useEffect(() => {
    const replaceAgentAndUser = (transcript: string, name: string): string => {
      const agentReplacement = "**AI interviewer:**";
      const userReplacement = `**${name}:**`;

      // Replace "Agent:" with "AI interviewer:" and "User:" with the variable `${name}:`
      let updatedTranscript = transcript
        .replace(/Agent:/g, agentReplacement)
        .replace(/User:/g, userReplacement);

      // Add space between the dialogues
      updatedTranscript = updatedTranscript.replace(/(?:\r\n|\r|\n)/g, "\n\n");

      return updatedTranscript;
    };

    const buildTranscriptFromObject = (transcriptObject: any[]): string => {
      if (!transcriptObject || !Array.isArray(transcriptObject)) {
        return "";
      }

      return transcriptObject
        .map((item: any) => {
          const role = item.role === 'agent' ? 'Agent' : 'User';

          return `${role}: ${item.content || ''}`;
        })
        .join('\n\n');
    };

    const extractQAPairs = (transcriptObject: any[]): Array<{ question: string; answer: string }> => {
      if (!transcriptObject || !Array.isArray(transcriptObject)) {
        return [];
      }

      const pairs: Array<{ question: string; answer: string }> = [];
      let currentQuestion = '';
      let currentAnswer = '';

      for (const item of transcriptObject) {
        const content = (item.content || '').trim();
        if (!content) continue;

        if (item.role === 'agent') {
          // If we have a pending question-answer pair, save it
          if (currentQuestion && currentAnswer) {
            pairs.push({ question: currentQuestion, answer: currentAnswer });
          }
          // Start a new question
          currentQuestion = content;
          currentAnswer = '';
        } else if (item.role === 'user') {
          // Accumulate answer (in case answer spans multiple entries)
          if (currentAnswer) {
            currentAnswer += ' ' + content;
          } else {
            currentAnswer = content;
          }
        }
      }

      // Don't forget the last pair
      if (currentQuestion && currentAnswer) {
        pairs.push({ question: currentQuestion, answer: currentAnswer });
      }

      return pairs;
    };

    if (call || responseData) {
      // Check multiple possible transcript locations
      let transcriptText = "";
      
      // 1. Direct transcript property from call
      if (call?.transcript && typeof call.transcript === 'string') {
        transcriptText = call.transcript;
      }
      // 2. Transcript in responseData.details (for analyzed calls)
      else if (responseData?.details?.transcript && typeof responseData.details.transcript === 'string') {
        transcriptText = responseData.details.transcript;
      }
      // 3. Transcript in call.details object (for analyzed calls)
      else if ((call as any)?.details?.transcript && typeof (call as any).details.transcript === 'string') {
        transcriptText = (call as any).details.transcript;
      }
      // 4. Build from call.transcript_object array
      else if (call?.transcript_object && Array.isArray(call.transcript_object) && call.transcript_object.length > 0) {
        transcriptText = buildTranscriptFromObject(call.transcript_object);
      }
      // 5. Build from responseData.details.transcript_object
      else if (responseData?.details?.transcript_object && Array.isArray(responseData.details.transcript_object) && responseData.details.transcript_object.length > 0) {
        transcriptText = buildTranscriptFromObject(responseData.details.transcript_object);
      }
      // 6. Build from call.transcript_with_tool_calls array
      else if ((call as any)?.transcript_with_tool_calls && Array.isArray((call as any).transcript_with_tool_calls) && (call as any).transcript_with_tool_calls.length > 0) {
        transcriptText = buildTranscriptFromObject((call as any).transcript_with_tool_calls);
      }
      // 7. Check call.details.transcript_object
      else if ((call as any)?.details?.transcript_object && Array.isArray((call as any).details.transcript_object) && (call as any).details.transcript_object.length > 0) {
        transcriptText = buildTranscriptFromObject((call as any).details.transcript_object);
      }
      
      // Debug logging (can be removed in production)
      if (!transcriptText || transcriptText.trim().length === 0) {
        console.log("🔍 Transcript Debug:", {
          hasCall: !!call,
          hasResponseData: !!responseData,
          hasCallTranscript: !!call?.transcript,
          hasResponseDataDetailsTranscript: !!responseData?.details?.transcript,
          hasCallDetails: !!(call as any)?.details,
          hasCallDetailsTranscript: !!(call as any)?.details?.transcript,
          hasCallTranscriptObject: !!call?.transcript_object,
          callTranscriptObjectLength: call?.transcript_object?.length || 0,
          hasResponseDataDetailsTranscriptObject: !!responseData?.details?.transcript_object,
          responseDataDetailsTranscriptObjectLength: responseData?.details?.transcript_object?.length || 0,
          callKeys: Object.keys(call || {}),
          responseDataKeys: Object.keys(responseData || {}),
        });
      }
      
      if (transcriptText && transcriptText.trim().length > 0) {
        if (name) {
          setTranscript(replaceAgentAndUser(transcriptText, name));
        } else {
          // Use generic replacement if name is not available yet
          let updatedTranscript = transcriptText
            .replace(/Agent:/g, "**AI interviewer:**")
            .replace(/User:/g, "**Candidate:**");
          updatedTranscript = updatedTranscript.replace(/(?:\r\n|\r|\n)/g, "\n\n");
          setTranscript(updatedTranscript);
        }
      } else {
        setTranscript("");
      }

      // Extract Q&A pairs from transcript_object
      let transcriptObjectArray: any[] = [];
      
      if (call?.transcript_object && Array.isArray(call.transcript_object)) {
        transcriptObjectArray = call.transcript_object;
      } else if (responseData?.details?.transcript_object && Array.isArray(responseData.details.transcript_object)) {
        transcriptObjectArray = responseData.details.transcript_object;
      } else if ((call as any)?.details?.transcript_object && Array.isArray((call as any).details.transcript_object)) {
        transcriptObjectArray = (call as any).details.transcript_object;
      } else if ((call as any)?.transcript_with_tool_calls && Array.isArray((call as any).transcript_with_tool_calls)) {
        transcriptObjectArray = (call as any).transcript_with_tool_calls;
      }

      if (transcriptObjectArray.length > 0) {
        const pairs = extractQAPairs(transcriptObjectArray);
        setQaPairs(pairs);
      } else {
        setQaPairs([]);
      }
    }
  }, [call, name, responseData]);

  const onDeleteResponseClick = async () => {
    try {
      const response = await ResponseService.getResponseByCallId(call_id);

      if (response) {
        const interview_id = response.interview_id;

        await ResponseService.deleteResponse(call_id);

        router.push(`/interviews/${interview_id}`);

        onDeleteResponse(call_id);
      }

      toast.success("Response deleted successfully.", {
        position: "bottom-right",

        duration: 3000,
      });
    } catch (error) {
      console.error("Error deleting response:", error);

      toast.error("Failed to delete the response.", {
        position: "bottom-right",

        duration: 3000,
      });
    }
  };


  return (
    <div className="w-full h-full z-[10]">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-[75%] w-full">
          <LoaderWithText />
        </div>
      ) : (
        <>
        
        {userResponses.length > 1 && (
            <div className="bg-slate-200 rounded-2xl min-h-[100px] p-4 px-5 mb-[20px]">
              <p className="font-semibold my-2 mb-3">Attempt History</p>
              <div className="flex flex-wrap gap-2">
                {userResponses.map((resp, index) => (
                  <button
                    key={resp.call_id}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      resp.call_id === call_id
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-indigo-50 hover:border-indigo-300"
                    }`}
                    onClick={() => {
                      if (resp.call_id !== call_id) {
                        router.push(
                          `/interviews/${interviewId}?call=${resp.call_id}`,
                        );
                      }
                    }}
                  >
                    Attempt {userResponses.length - index}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Interview Information Block */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 mb-4 border border-indigo-200 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Duration */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <Clock className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">Interview Duration</p>
                    <p className="text-lg font-bold text-gray-900">
                      {responseData?.duration 
                        ? `${Math.floor(responseData.duration / 60)}m ${responseData.duration % 60}s`
                        : call?.start_timestamp && call?.end_timestamp
                        ? `${Math.floor((call.end_timestamp - call.start_timestamp) / 60000)}m ${Math.floor(((call.end_timestamp - call.start_timestamp) % 60000) / 1000)}s`
                        : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tab Switching */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${tabSwitchCount > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                    <AlertTriangle className={`h-5 w-5 ${tabSwitchCount > 0 ? 'text-red-600' : 'text-green-600'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">Tab Switching</p>
                    <p className={`text-lg font-bold ${tabSwitchCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {tabSwitchCount > 0 ? `${tabSwitchCount} times` : 'No issues'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Video Status */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${call?.disconnection_reason ? 'bg-yellow-100' : 'bg-green-100'}`}>
                    <Video className={`h-5 w-5 ${call?.disconnection_reason ? 'text-yellow-600' : 'text-green-600'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">Video/Audio Status</p>
                    <p className={`text-lg font-bold ${call?.disconnection_reason ? 'text-yellow-600' : 'text-green-600'}`}>
                      {call?.disconnection_reason ? 'Issues detected' : 'Normal'}
                    </p>
                    {call?.disconnection_reason && (
                      <p className="text-xs text-gray-500 mt-1 truncate">{call.disconnection_reason}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Voice Detection - Multiple Person */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${multiplePersonCount > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                    <Users className={`h-5 w-5 ${multiplePersonCount > 0 ? 'text-red-600' : 'text-green-600'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">Voice Detection</p>
                    <p className={`text-lg font-bold ${multiplePersonCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {multiplePersonCount > 0 ? `${multiplePersonCount} times` : 'Single person detected'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Interview Violations Section */}

          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 y-3">
            <div className="flex flex-col justify-between bt-2">
              <div>
                <div className="flex justify-between items-center pb-4 pr-2">
                  <div
                    className=" inline-flex items-center text-indigo-600 hover:cursor-pointer"
                    onClick={() => {
                      router.push(`/interviews/${interviewId}`);
                    }}
                  >
                    <ArrowLeft className="mr-2" />
                    <p className="text-sm font-semibold">Back to Summary</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-between gap-3 w-full">
                <div className="flex flex-row justify-between">
                  <div className="flex flex-row gap-3">
                    <Avatar>
                      <AvatarFallback>{name ? name[0] : "A"}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      {name && (
                        <p className="text-sm font-semibold px-2">{name}</p>
                      )}
                      {email && <p className="text-sm px-2">{email}</p>}
                    </div>
                  </div>
                  <div className="flex flex-row mr-2 items-center gap-3">
                    <label htmlFor="candidateStatus" className="text-sm font-semibold">Candidate Review Status</label>
                    <Select
                      value={candidateStatus}
                      onValueChange={async (newValue: string) => {
                        setCandidateStatus(newValue);
                        // Update status for this specific response in local state
                        onCandidateStatusChange(call_id, newValue);

                        // Update candidate_status for all attempts of this assignee in the database
                        if (email && interviewId) {
                          try {
                            await ResponseService.updateCandidateStatusForUser(
                              interviewId,
                              email,
                              newValue,
                            );
                          } catch (error) {
                            console.error(
                              "Error updating candidate status for all attempts:",
                              error,
                            );
                          }
                        }
                        
                        // Sync review_status with candidate_status in assignee table
                        if (email && interviewId) {
                          try {
                            await assigneeService.updateAssigneeReviewStatus(
                              email,
                              interviewId,
                              newValue as 'NO_STATUS' | 'NOT_SELECTED' | 'POTENTIAL' | 'SELECTED'
                            );
                            // Dispatch event to notify other pages to refresh assignees
                            window.dispatchEvent(new CustomEvent('assigneeReviewStatusUpdated', {
                              detail: { email, interviewId, reviewStatus: newValue }
                            }));
                          } catch (error) {
                            console.error('Error syncing review status:', error);
                            // Don't show error to user - this is a background sync
                          }
                        }
                      }}
                    >
                      <SelectTrigger className="w-[180px]  bg-slate-50 rounded-2xl">
                        <SelectValue placeholder="Not Selected" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CandidateStatus.NO_STATUS}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-gray-400 rounded-full mr-2" />
                            To Be Reviewed
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.NOT_SELECTED}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-red-500 rounded-full mr-2" />
                            Not Selected
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.POTENTIAL}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2" />
                            Potential
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.SELECTED}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-green-500 rounded-full mr-2" />
                            Selected
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <AlertDialog>
                      <AlertDialogTrigger>
                        <Button
                          disabled={isClicked}
                          className="bg-red-500 hover:bg-red-600 p-2"
                        >
                          <TrashIcon size={16} className="" />
                        </Button>
                      </AlertDialogTrigger>

                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>

                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently
                            delete this response.
                          </AlertDialogDescription>
                        </AlertDialogHeader>

                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>

                          <AlertDialogAction
                            className="bg-indigo-600 hover:bg-indigo-800"
                            onClick={async () => {
                              await onDeleteResponseClick();
                            }}
                          >
                            Continue
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="flex flex-col mt-3">
                  <p className="font-semibold">Interview Recording</p>
                  <div className="flex flex-row gap-3 mt-2">
                    {(call?.recording_url || (call as any)?.details?.recording_url || responseData?.details?.recording_url) ? (
                      <>
                        <ReactAudioPlayer 
                          src={call?.recording_url || (call as any)?.details?.recording_url || responseData?.details?.recording_url} 
                          controls 
                        />
                        <a
                          className="my-auto"
                          href={call?.recording_url || (call as any)?.details?.recording_url || responseData?.details?.recording_url}
                          download=""
                          aria-label="Download"
                        >
                          <DownloadIcon size={20} />
                        </a>
                      </>
                    ) : (
                      <p className="text-sm text-gray-500 italic">Recording not available</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {/* <div>{call.}</div> */}
          </div>
          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 my-3">
            <p className="font-semibold my-2">General Summary</p>

            <div className="grid grid-cols-3 gap-4 my-2 mt-4 ">
              {analytics?.overallScore !== undefined && (
                <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                  <div className="flex flex-row gap-2 align-middle">
                    <CircularProgress
                      classNames={{
                        svg: "w-28 h-28 drop-shadow-md",
                        indicator: "stroke-indigo-600",
                        track: "stroke-indigo-600/10",
                        value: "text-3xl font-semibold text-indigo-600",
                      }}
                      value={analytics?.overallScore}
                      strokeWidth={4}
                      showValueLabel={true}
                      formatOptions={{ signDisplay: "never" }}
                    />
                    <p className="font-medium my-auto text-xl">
                      Overall Hiring Score
                    </p>
                  </div>
                  <div className="">
                    <div className="font-medium ">
                      <span className="font-normal">Feedback: </span>
                      {analytics?.overallFeedback === undefined ? (
                        <Skeleton className="w-[200px] h-[20px]" />
                      ) : (
                        analytics?.overallFeedback
                      )}
                    </div>
                  </div>
                </div>
              )}
              {analytics?.communication && (
                <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                  <div className="flex flex-row gap-2 align-middle">
                    <CircularProgress
                      classNames={{
                        svg: "w-28 h-28 drop-shadow-md",
                        indicator: "stroke-indigo-600",
                        track: "stroke-indigo-600/10",
                        value: "text-3xl font-semibold text-indigo-600",
                      }}
                      value={analytics?.communication.score}
                      maxValue={10}
                      minValue={0}
                      strokeWidth={4}
                      showValueLabel={true}
                      valueLabel={
                        <div className="flex items-baseline">
                          {analytics?.communication.score ?? 0}
                          <span className="text-xl ml-0.5">/10</span>
                        </div>
                      }
                      formatOptions={{ signDisplay: "never" }}
                    />
                    <p className="font-medium my-auto text-xl">Communication</p>
                  </div>
                  <div className="">
                    <div className="font-medium ">
                      <span className="font-normal">Feedback: </span>
                      {analytics?.communication.feedback === undefined ? (
                        <Skeleton className="w-[200px] h-[20px]" />
                      ) : (
                        analytics?.communication.feedback
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                <div className="flex flex-row gap-3 items-center">
                  <p className="my-auto font-medium">User Sentiment: </p>
                  {(() => {
                    const userSentiment = call?.call_analysis?.user_sentiment || 
                                         (call as any)?.details?.call_analysis?.user_sentiment || 
                                         responseData?.details?.call_analysis?.user_sentiment;

                    if (userSentiment === undefined) {
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 italic">Not available</span>
                        </div>
                      );
                    }

                    const sentiment = userSentiment.toString().toLowerCase();
                    const isPositive = sentiment === "positive";
                    const isNegative = sentiment === "negative";
                    const isNeutral = sentiment === "neutral";

                    return (
                      <div className="flex items-center gap-2">
                        {/* Sentiment Badge with Icon */}
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-sm ${
                          isPositive 
                            ? "bg-green-100 text-green-700 border border-green-300" 
                            : isNegative 
                            ? "bg-red-100 text-red-700 border border-red-300"
                            : isNeutral
                            ? "bg-yellow-100 text-yellow-700 border border-yellow-300"
                            : "bg-gray-100 text-gray-700 border border-gray-300"
                        }`}>
                          {/* Icon */}
                          {isPositive && <Smile className="h-4 w-4" />}
                          {isNegative && <Frown className="h-4 w-4" />}
                          {isNeutral && <Meh className="h-4 w-4" />}
                          
                          {/* Sentiment Text */}
                          <span>{userSentiment}</span>
                          
                          {/* Colored Dot Indicator */}
                          <div className={`h-2 w-2 rounded-full ${
                            isPositive 
                              ? "bg-green-500" 
                              : isNegative 
                              ? "bg-red-500"
                              : isNeutral
                              ? "bg-yellow-500"
                              : "bg-gray-500"
                          }`} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="">
                  <div className="font-medium  ">
                    <span className="font-normal">Call Summary: </span>
                    {(() => {
                      const callSummary = call?.call_analysis?.call_summary || 
                                         (call as any)?.details?.call_analysis?.call_summary || 
                                         responseData?.details?.call_analysis?.call_summary;

                      return callSummary === undefined ? (
                        <span className="text-gray-500 italic">Not available</span>
                      ) : (
                        callSummary
                      );
                    })()}
                  </div>
                </div>
                {(() => {
                  const completionReason = call?.call_analysis?.call_completion_rating_reason || 
                                          (call as any)?.details?.call_analysis?.call_completion_rating_reason || 
                                          responseData?.details?.call_analysis?.call_completion_rating_reason;

                  return completionReason && (
                    <p className="font-medium ">
                      {completionReason}
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>
          
          {/* Accordion Section - All content in one block */}
          <div className="bg-slate-200 rounded-2xl p-4 px-5 my-3 mb-[20px]">
            <Accordion type="single" collapsible className="w-full" defaultValue="call-summary">
              {/* Call Summary Accordion Item */}
              <AccordionItem value="call-summary" className="border-b border-slate-300">
                <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                  Call Summary
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4">
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="font-medium">
                      <span className="font-normal">Call Summary: </span>
                      {(() => {
                        const callSummary = call?.call_analysis?.call_summary || 
                                         (call as any)?.details?.call_analysis?.call_summary || 
                                         responseData?.details?.call_analysis?.call_summary;

                        return callSummary === undefined ? (
                          <span className="text-gray-500 italic">Not available</span>
                        ) : (
                          callSummary
                        );
                      })()}
                    </div>
                    {(() => {
                      const completionReason = call?.call_analysis?.call_completion_rating_reason || 
                                              (call as any)?.details?.call_analysis?.call_completion_rating_reason || 
                                              responseData?.details?.call_analysis?.call_completion_rating_reason;

                      return completionReason && (
                        <p className="font-medium mt-2">
                          {completionReason}
                        </p>
                      );
                    })()}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Question Summary Accordion Item */}
              {analytics &&
              analytics.questionSummaries &&
              analytics.questionSummaries.length > 0 && (
                <AccordionItem value="question-summary" className="border-b border-slate-300">
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                    Question Summary
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="rounded-md max-h-72 text-sm mt-3 py-3 leading-6 overflow-y-auto whitespace-pre-line px-2 bg-slate-50">
                      {analytics?.questionSummaries.map((qs, index) => (
                        <QuestionAnswerCard
                          key={qs.question}
                          questionNumber={index + 1}
                          question={qs.question}
                          answer={qs.summary}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Transcript Summary Accordion Item - Shows Q&A Pairs */}
              {qaPairs.length > 0 && (
                <AccordionItem value="transcript-summary" className="border-b border-slate-300">
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                    <div className="flex items-center justify-between w-full pr-4">
                      <span>Transcript Summary</span>
                      <span className="text-xs text-gray-600 font-medium">
                        {qaPairs.length} Q&A {qaPairs.length === 1 ? 'pair' : 'pairs'}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="rounded-md max-h-96 text-sm mt-3 py-3 leading-6 overflow-y-auto whitespace-pre-line px-2 bg-slate-50">
                      {qaPairs.map((qa, index) => (
                        <QuestionAnswerCard
                          key={`qa-${index}`}
                          questionNumber={index + 1}
                          question={qa.question}
                          answer={qa.answer}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Transcript Accordion Item */}
              <AccordionItem value="transcript" className="border-b border-slate-300">
                <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span>Transcript</span>
                    {userResponses.length > 1 && (
                      <div className="text-xs text-gray-600 flex items-center gap-2">
                        <span className="font-semibold">Interview Attempts:</span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                          {userResponses.length}
                        </span>
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4">
                  <div className="rounded-2xl text-sm max-h-96 overflow-y-auto whitespace-pre-line px-2 bg-slate-50">
                    <div
                      className="text-sm p-4 rounded-2xl leading-5"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: transcript && transcript.trim().length > 0 ? marked(transcript) : '<p class="text-gray-500 italic">No transcript available for this interview.</p>' }}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Violations Details Accordion Item */}
              {violationsSummary.length > 0 && (
                <AccordionItem value="violations-details" className="border-b border-slate-300">
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                    <div className="flex items-center justify-between w-full pr-4">
                      <span className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-red-500" />
                        Violations Details
                      </span>
                      <span className="text-xs text-red-600 font-medium px-2 py-0.5 rounded-full bg-red-100">
                        {violationsSummary.length} total
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="space-y-4">
                      {/* Violation Summary Cards - 5 boxes in 1 row */}
                      <div className="grid grid-cols-5 gap-3">
                        {/* Tab Switch Count */}
                        <div className={`p-3 rounded-lg ${tabSwitchCount > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
                          <div className="flex items-center gap-2">
                            <Monitor className={`h-4 w-4 ${tabSwitchCount > 0 ? 'text-orange-500' : 'text-green-500'}`} />
                            <span className="text-xs font-medium text-gray-600">Tab Switches</span>
                          </div>
                          <p className={`text-lg font-bold mt-1 ${tabSwitchCount > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            {tabSwitchCount}
                          </p>
                        </div>

                        {/* Face Mismatch Count */}
                        <div className={`p-3 rounded-lg ${faceMismatchCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                          <div className="flex items-center gap-2">
                            <UserX className={`h-4 w-4 ${faceMismatchCount > 0 ? 'text-red-500' : 'text-green-500'}`} />
                            <span className="text-xs font-medium text-gray-600">Face Mismatch</span>
                          </div>
                          <p className={`text-lg font-bold mt-1 ${faceMismatchCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {faceMismatchCount}
                            {faceMismatchTotal > 0 && (
                              <span className="text-sm font-normal text-gray-500">/{faceMismatchTotal}</span>
                            )}
                          </p>
                          {faceMismatchTotal > 0 && (
                            <p className="text-xs text-gray-500">Total checks: {faceMismatchTotal}</p>
                          )}
                        </div>

                        {/* Camera Off Count */}
                        <div className={`p-3 rounded-lg ${cameraOffCount > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                          <div className="flex items-center gap-2">
                            <CameraOff className={`h-4 w-4 ${cameraOffCount > 0 ? 'text-yellow-600' : 'text-green-500'}`} />
                            <span className="text-xs font-medium text-gray-600">Camera Off</span>
                          </div>
                          <p className={`text-lg font-bold mt-1 ${cameraOffCount > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                            {cameraOffCount}
                            {cameraOffTotal > 0 && (
                              <span className="text-sm font-normal text-gray-500">/{cameraOffTotal}</span>
                            )}
                          </p>
                          {cameraOffTotal > 0 && (
                            <p className="text-xs text-gray-500">Total checks: {cameraOffTotal}</p>
                          )}
                        </div>

                        {/* Multiple Person Count */}
                        <div className={`p-3 rounded-lg ${multiplePersonCount > 0 ? 'bg-purple-50 border border-purple-200' : 'bg-green-50 border border-green-200'}`}>
                          <div className="flex items-center gap-2">
                            <Users className={`h-4 w-4 ${multiplePersonCount > 0 ? 'text-purple-500' : 'text-green-500'}`} />
                            <span className="text-xs font-medium text-gray-600">Multiple Persons</span>
                          </div>
                          <p className={`text-lg font-bold mt-1 ${multiplePersonCount > 0 ? 'text-purple-600' : 'text-green-600'}`}>
                            {multiplePersonCount}
                            {multiplePersonTotal > 0 && (
                              <span className="text-sm font-normal text-gray-500">/{multiplePersonTotal}</span>
                            )}
                          </p>
                          {multiplePersonTotal > 0 && (
                            <p className="text-xs text-gray-500">Total checks: {multiplePersonTotal}</p>
                          )}
                        </div>

                        {/* Total Violations */}
                        <div className={`p-3 rounded-lg ${(tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount) > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                          <div className="flex items-center gap-2">
                            <Shield className={`h-4 w-4 ${(tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount) > 0 ? 'text-red-500' : 'text-green-500'}`} />
                            <span className="text-xs font-medium text-gray-600">Total Violations</span>
                          </div>
                          <p className={`text-lg font-bold mt-1 ${(tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount}
                          </p>
                        </div>
                      </div>

                      {/* Violation Timeline - 5 boxes per row */}
                      <p className="text-sm font-semibold text-gray-700">Violation Timeline</p>
                      <div className="grid grid-cols-5 gap-3 max-h-80 overflow-y-auto">
                        {violationsSummary.map((violation, index) => (
                          <div
                            key={index}
                            className={`p-3 rounded-lg border ${
                              violation.type === 'tab_switch' ? 'bg-orange-50 border-orange-200' :
                              violation.type === 'face_mismatch' ? 'bg-red-50 border-red-200' :
                              violation.type === 'camera_off' ? 'bg-yellow-50 border-yellow-200' :
                              'bg-purple-50 border-purple-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`p-1.5 rounded-full ${
                                violation.type === 'tab_switch' ? 'bg-orange-100' :
                                violation.type === 'face_mismatch' ? 'bg-red-100' :
                                violation.type === 'camera_off' ? 'bg-yellow-100' :
                                'bg-purple-100'
                              }`}>
                                {violation.type === 'tab_switch' && <Monitor className="h-3 w-3 text-orange-600" />}
                                {violation.type === 'face_mismatch' && <UserX className="h-3 w-3 text-red-600" />}
                                {violation.type === 'camera_off' && <CameraOff className="h-3 w-3 text-yellow-600" />}
                                {violation.type === 'multiple_person' && <Users className="h-3 w-3 text-purple-600" />}
                              </div>
                              <span className={`text-xs font-semibold ${
                                violation.type === 'tab_switch' ? 'text-orange-700' :
                                violation.type === 'face_mismatch' ? 'text-red-700' :
                                violation.type === 'camera_off' ? 'text-yellow-700' :
                                'text-purple-700'
                              }`}>
                                {violation.type === 'tab_switch' && 'Tab Switch'}
                                {violation.type === 'face_mismatch' && 'Face Mismatch'}
                                {violation.type === 'camera_off' && 'Camera Off'}
                                {violation.type === 'multiple_person' && 'Multiple Persons'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">
                              {new Date(violation.timestamp).toLocaleTimeString()}
                            </p>
                            {violation.details && (
                              <p className="text-xs text-gray-500 mt-1 truncate" title={violation.details}>
                                {violation.details}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

            </Accordion>
          </div>
        </>
      )}
    </div>
  );
}

export default CallInfo;
