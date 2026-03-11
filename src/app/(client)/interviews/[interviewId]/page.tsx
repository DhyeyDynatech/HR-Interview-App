"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth.context";
import { useInterviews } from "@/contexts/interviews.context";
import { Share2, Filter, Pencil, UserIcon, Eye, Palette, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRouter } from "next/navigation";
import { ResponseService } from "@/services/responses.service";
import { ClientService } from "@/services/clients.service";
import { Interview } from "@/types/interview";
import { Response } from "@/types/response";
import { formatTimestampToDateHHMM } from "@/lib/utils";
import CallInfo from "@/components/call/callInfo";
import SummaryInfo from "@/components/dashboard/interview/summaryInfo";
import { InterviewService } from "@/services/interviews.service";
import EditInterview from "@/components/dashboard/interview/editInterview";
import Modal from "@/components/dashboard/Modal";
import { toast } from "sonner";
import { ChromePicker } from "react-color";

import SharePopup from "@/components/dashboard/interview/sharePopup";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateStatus } from "@/lib/enum";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";

interface Props {
  params: {
    interviewId: string;
  };
  searchParams: {
    call: string;
    edit: boolean;
    email?: string;
  };
}

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

function InterviewHome({ params, searchParams }: Props) {
  const [interview, setInterview] = useState<Interview>();
  const [responses, setResponses] = useState<Response[]>();
  const { getInterviewById } = useInterviews();
  const [isSharePopupOpen, setIsSharePopupOpen] = useState(false);
  const router = useRouter();
  const [isActive, setIsActive] = useState<boolean>(true);
  const [currentPlan, setCurrentPlan] = useState<string>("");
  const [isGeneratingInsights, setIsGeneratingInsights] =
    useState<boolean>(false);
  const [isViewed, setIsViewed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [themeColor, setThemeColor] = useState<string>("#4F46E5");
  const [iconColor, seticonColor] = useState<string>("#4F46E5");
  const { user } = useAuth();
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  function seeInterviewPreviewPage() {
    const protocol = base_url?.includes("localhost") ? "http" : "https";
    if (interview?.url) {
      const url = interview?.readable_slug
        ? `${protocol}://${base_url}/call/${interview?.readable_slug}`
        : interview.url.startsWith("http")
          ? interview.url
          : `https://${interview.url}`;
      window.open(url, "_blank");
    } else {
      console.error("Interview URL is null or undefined.");
    }
  };

  useEffect(() => {
    const fetchInterview = async () => {
      try {
        const response = await getInterviewById(params.interviewId);
        setInterview(response);
        setIsActive(response.is_active);
        setIsViewed(response.is_viewed);
        setThemeColor(response.theme_color ?? "#4F46E5");
        seticonColor(response.theme_color ?? "#4F46E5");
        setLoading(true);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    if (!interview || !isGeneratingInsights) {
      fetchInterview();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getInterviewById, params.interviewId, isGeneratingInsights]);

  useEffect(() => {
    const fetchResponses = async () => {
      try {
        const response = await ResponseService.getAllResponses(
          params.interviewId,
        );
        setResponses(response);
        setLoading(true);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDeleteResponse(deletedCallId: string) {
    if (responses) {
      setResponses(
        responses.filter((response) => response.call_id !== deletedCallId),
      );
      if (searchParams.call === deletedCallId) {
        router.push(`/interviews/${params.interviewId}`);
      }
    }
  };

  const handleResponseClick = async (response: Response) => {
    try {
      await ResponseService.saveResponse({ is_viewed: true }, response.call_id);
      if (responses) {
        const updatedResponses = responses.map((r) =>
          r.call_id === response.call_id ? { ...r, is_viewed: true } : r,
        );
        setResponses(updatedResponses);
      }
      setIsViewed(true);
    } catch (error) {
      console.error(error);
    }
  };

  const handleToggle = async () => {
    try {
      const updatedIsActive = !isActive;
      setIsActive(updatedIsActive);

      await InterviewService.updateInterview(
        { is_active: updatedIsActive },
        params.interviewId,
      );

      toast.success("Interview status updated", {
        description: `The interview is now ${
          updatedIsActive ? "active" : "inactive"
        }.`,
        position: "bottom-right",
        duration: 3000,
      });
    } catch (error) {
      console.error(error);
      toast.error("Error", {
        description: "Failed to update the interview status.",
        duration: 3000,
      });
    }
  };

  const handleThemeColorChange = async (newColor: string) => {
    try {
      await InterviewService.updateInterview(
        { theme_color: newColor },
        params.interviewId,
      );

      toast.success("Theme color updated", {
        position: "bottom-right",
        duration: 3000,
      });
    } catch (error) {
      console.error(error);
      toast.error("Error", {
        description: "Failed to update the theme color.",
        duration: 3000,
      });
    }
  };

  function handleCandidateStatusChange(callId: string, newStatus: string) {
    setResponses((prevResponses) => {

      return prevResponses?.map((response) =>
        response.call_id === callId
          ? { ...response, candidate_status: newStatus }
          : response,
      );
    });
  };

  function openSharePopup() {
    setIsSharePopupOpen(true);
  };

  function closeSharePopup() {
    setIsSharePopupOpen(false);
  };

  function handleColorChange(color: any) {
    setThemeColor(color.hex);
  };

  function applyColorChange() {
    if (themeColor !== iconColor) {
      seticonColor(themeColor);
      handleThemeColorChange(themeColor);
    }
    setShowColorPicker(false);
  };

  function filterResponses() {
    if (!responses) {

      return [];
    }

    let filtered = responses;

    // Filter by email if provided in searchParams
    if (searchParams.email) {
      filtered = filtered.filter(
        (response) => response?.email?.toLowerCase() === searchParams.email?.toLowerCase()
      );
    }

    // Filter by status
    if (filterStatus !== "ALL") {
      filtered = filtered.filter(
        (response) => response?.candidate_status == filterStatus,
      );
    }

    // Group by user (email) and keep only the latest response per user
    const latestByUser = new Map<string, Response>();

    filtered.forEach((response) => {
      const key = response.email
        ? response.email.toLowerCase()
        : `anonymous-${response.call_id}`;

      const existing = latestByUser.get(key);

      if (!existing) {
        latestByUser.set(key, response);

        return;
      }

      const existingDate = new Date(String(existing.created_at)).getTime();
      const currentDate = new Date(String(response.created_at)).getTime();

      if (currentDate > existingDate) {
        latestByUser.set(key, response);
      }
    });

    // Return latest responses sorted by created_at (newest first)
    return Array.from(latestByUser.values()).sort(
      (a, b) =>
        new Date(String(b.created_at)).getTime() -
        new Date(String(a.created_at)).getTime(),
    );
  };


  return (
    <div className="flex flex-col w-full h-full m-2 bg-white">
      {loading ? (
        <div className="flex flex-col items-center justify-center h-[80%] w-full">
          <LoaderWithText />
        </div>
      ) : (
        <>
          <div className="flex flex-col md:flex-row p-3 pt-4 justify-center gap-3 md:gap-6 items-center sticky top-2 bg-white z-10">
            <div className="font-bold text-sm md:text-md text-center md:text-left">{interview?.name}</div>

            <div
              className="w-5 h-5 rounded-full border-2 border-white shadow"
              style={{ backgroundColor: iconColor }}
            />

            <div className="flex flex-row gap-2 md:gap-3 my-auto text-sm md:text-base">
              <UserIcon className="my-auto" size={16} />:{" "}
              {String(searchParams.email ? filterResponses().length : responses?.length)}
              {searchParams.email && (
                <span className="text-xs text-gray-500 hidden sm:inline">
                  (of {responses?.length || 0} total)
                </span>
              )}
            </div>
            
            {searchParams.email && (
              <div className="flex items-center gap-2 px-2 md:px-3 py-1 md:py-1.5 bg-blue-50 border border-blue-200 rounded-md">
                <span className="text-xs text-blue-700 font-medium">
                  Viewing: <strong className="text-blue-900">{searchParams.email}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                  title="Show all responses"
                  onClick={() => {
                    router.push(`/interviews/${params.interviewId}`);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            <div className="flex flex-row flex-wrap gap-2 md:gap-3 justify-center items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className={
                      "bg-transparent shadow-none relative text-xs text-indigo-600 px-1 h-7 hover:scale-110 hover:bg-transparent"
                    }
                    variant={"secondary"}
                    onClick={(event) => {
                      event.stopPropagation();
                      openSharePopup();
                    }}
                  >
                    <Share2 size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="bg-zinc-300"
                  side="bottom"
                  sideOffset={4}
                >
                  <span className="text-black flex flex-row gap-4">Share</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="bg-transparent shadow-none text-xs text-indigo-600 px-0 h-7 hover:scale-110 relative"
                    onClick={(event) => {
                      event.stopPropagation();
                      seeInterviewPreviewPage();
                    }}
                  >
                    <Eye />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="bg-zinc-300"
                  side="bottom"
                  sideOffset={4}
                >
                  <span className="text-black flex flex-row gap-4">
                    Preview
                  </span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="bg-transparent shadow-none text-xs text-indigo-600 px-0 h-7 hover:scale-110 relative"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowColorPicker(!showColorPicker);
                    }}
                  >
                    <Palette size={19} />
                  </Button>
                </TooltipTrigger>
                {/* <TooltipContent
                  className="bg-zinc-300"
                  side="bottom"
                  sideOffset={4}
                >
                  <span className="text-black flex flex-row gap-4">
                    Theme Color
                  </span>
                </TooltipContent> */}
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="bg-transparent shadow-none text-xs text-indigo-600 px-0 h-7 hover:scale-110 relative"
                    onClick={(event) => {
                      router.push(
                        `/interviews/${params.interviewId}?edit=true`,
                      );
                    }}
                  >
                    <Pencil size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="bg-zinc-300"
                  side="bottom"
                  sideOffset={4}
                >
                  <span className="text-black flex flex-row gap-4">Edit</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <label className="inline-flex cursor-pointer">
              {currentPlan == "free_trial_over" ? (
                <>
                  <span className="ms-3 my-auto text-xs md:text-sm">Inactive</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipContent
                        className="bg-zinc-300"
                        side="bottom"
                        sideOffset={4}
                      >
                        Upgrade your plan to reactivate
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              ) : (
                <>
                  <span className="ms-3 my-auto text-xs md:text-sm">Active</span>
                  <Switch
                    checked={isActive}
                    className={`ms-3 my-auto ${
                      isActive ? "bg-indigo-600" : "bg-[#E6E7EB]"
                    }`}
                    onCheckedChange={handleToggle}
                  />
                </>
              )}
            </label>
            </div>
          </div>
          <div className="flex flex-col md:flex-row w-full p-1 md:p-2 h-[85vh] md:h-[85vh] gap-1 overflow-hidden">
            {!searchParams.call && (
              <div className="w-full md:w-[20%] flex flex-col p-1 md:p-2 divide-y-2 rounded-sm border-2 border-slate-100 min-h-0 max-h-[40vh] md:max-h-none">
              <div className="flex w-full justify-center py-2">
                <Select
                  onValueChange={async (newValue: string) => {
                    setFilterStatus(newValue);
                  }}
                >
                  <SelectTrigger className="w-[95%] bg-slate-100 rounded-lg">
                    <Filter size={18} className=" text-slate-400" />
                    <SelectValue placeholder="Filter By" />
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
                    <SelectItem value="ALL">
                      <div className="flex items-center">
                        <div className="w-3 h-3 border-2 border-gray-300 rounded-full mr-2" />
                        All
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <ScrollArea className="h-full p-1 rounded-md border-none">
                {filterResponses().length > 0 ? (
                  filterResponses().map((response) => (
                    <div
                      className={`p-2 rounded-md hover:bg-indigo-100 border-2 my-1 text-left text-xs ${
                        searchParams.call == response.call_id
                          ? "bg-indigo-200"
                          : "border-indigo-100"
                      } flex flex-row justify-between cursor-pointer w-full`}
                      key={response?.id}
                      onClick={() => {
                        router.push(
                          `/interviews/${params.interviewId}?call=${response.call_id}`,
                        );
                        handleResponseClick(response);
                      }}
                    >
                      <div className="flex flex-row gap-1 items-center w-full min-w-0">
                        {response.candidate_status === "NOT_SELECTED" ? (
                          <div className="w-[5%] h-full bg-red-500 rounded-sm flex-shrink-0" />
                        ) : response.candidate_status === "POTENTIAL" ? (
                          <div className="w-[5%] h-full bg-yellow-500 rounded-sm flex-shrink-0" />
                        ) : response.candidate_status === "SELECTED" ? (
                          <div className="w-[5%] h-full bg-green-500 rounded-sm flex-shrink-0" />
                        ) : (
                          <div className="w-[5%] h-full bg-gray-400 rounded-sm flex-shrink-0" />
                        )}
                        <div className="flex items-center justify-between w-full min-w-0">
                          <div className="flex flex-col my-auto min-w-0 flex-1">
                            <p className="font-medium mb-[2px] truncate text-xs md:text-sm">
                              {response?.name
                                ? `${response?.name}'s Response`
                                : "Anonymous"}
                            </p>
                            <p className="text-xs">
                              {formatTimestampToDateHHMM(
                                String(response?.created_at),
                              )}
                            </p>
                          </div>
                          <div className="flex flex-col items-center justify-center ml-auto flex-shrink-0">
                            {!response.is_viewed && (
                              <div className="w-4 h-4 flex items-center justify-center mb-1">
                                <div className="text-indigo-500 text-xl leading-none">
                                  ●
                                </div>
                              </div>
                            )}
                            <div
                              className={`w-6 h-6 flex items-center justify-center ${
                                response.is_viewed ? "h-full" : ""
                              }`}
                            >
                              {response.analytics &&
                                response.analytics.overallScore !==
                                  undefined && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="w-6 h-6 rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center">
                                          <span className="text-indigo-500 text-xs font-semibold">
                                            {response?.analytics?.overallScore}
                                          </span>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        className="bg-gray-500"
                                        side="bottom"
                                        sideOffset={4}
                                      >
                                        <span className="text-white font-normal flex flex-row gap-4">
                                          Overall Score
                                        </span>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-gray-500">
                    No responses to display
                  </p>
                )}
              </ScrollArea>
              </div>
            )}
            {responses && (
              <div className={searchParams.call ? "w-full h-full overflow-y-auto" : "w-full md:w-[80%] rounded-md min-h-0 overflow-auto"}>
                {searchParams.call ? (
                  <CallInfo
                    call_id={searchParams.call}
                    onDeleteResponse={handleDeleteResponse}
                    onCandidateStatusChange={handleCandidateStatusChange}
                  />
                ) : searchParams.edit ? (
                  <EditInterview interview={interview} />
                ) : (
                  <SummaryInfo responses={responses} interview={interview} />
                )}
              </div>
            )}
          </div>
        </>
      )}
      <Modal
        open={showColorPicker}
        closeOnOutsideClick={false}
        onClose={applyColorChange}
      >
        <div className="w-[250px] p-3">
          <h3 className="text-lg font-semibold mb-4 text-center">
            Choose a Theme Color
          </h3>
          <ChromePicker
            disableAlpha={true}
            color={themeColor}
            styles={{
              default: {
                picker: { width: "100%" },
              },
            }}
            onChange={handleColorChange}
          />
        </div>
      </Modal>
      {isSharePopupOpen && (
        <SharePopup
          open={isSharePopupOpen}
          shareContent={
            interview?.readable_slug
              ? `${base_url}/call/${interview?.readable_slug}`
              : (interview?.url as string)
          }
          onClose={closeSharePopup}
        />
      )}
    </div>
  );
}

export default InterviewHome;
