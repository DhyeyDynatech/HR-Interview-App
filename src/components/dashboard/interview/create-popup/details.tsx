import React, { useState, useEffect } from "react";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/auth.context";
import { useInterviewers } from "@/contexts/interviewers.context";
import { InterviewBase, Question } from "@/types/interview";
import { ChevronRight, ChevronLeft, Info } from "lucide-react";
import Image from "next/image";
import { CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import FileUpload from "../fileUpload";
import Modal from "@/components/dashboard/Modal";
import InterviewerDetailsModal from "@/components/dashboard/interviewer/interviewerDetailsModal";
import { Interviewer } from "@/types/interviewer";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VoiceInfo {
  agent_id: string | null;
  agent_name: string | null;
  voice_id: string | null;
  voice_name: string | null;
  language: string | null;
  voice_preview_url: string | null;
  provider: string | null;
  gender: string | null;
  age: string | null;
}

interface Props {
  open: boolean;
  setLoading: (loading: boolean) => void;
  interviewData: InterviewBase;
  setInterviewData: (interviewData: InterviewBase) => void;
  isUploaded: boolean;
  setIsUploaded: (isUploaded: boolean) => void;
  fileName: string;
  setFileName: (fileName: string) => void;
}

function DetailsPopup({
  open,
  setLoading,
  interviewData,
  setInterviewData,
  isUploaded,
  setIsUploaded,
  fileName,
  setFileName,
}: Props) {
  const { user } = useAuth();
  const { interviewers } = useInterviewers();
  const [isClicked, setIsClicked] = useState(false);
  const [openInterviewerDetails, setOpenInterviewerDetails] = useState(false);
  const [interviewerDetails, setInterviewerDetails] = useState<Interviewer>();
  const [voiceInfoCache, setVoiceInfoCache] = useState<Record<string, VoiceInfo>>({});

  const [name, setName] = useState(interviewData.name);
  const [selectedInterviewer, setSelectedInterviewer] = useState(
    interviewData.interviewer_id,
  );
  const [objective, setObjective] = useState(interviewData.objective);
  // Anonymous responses are no longer supported - always false
  const isAnonymous = false;
  const [numQuestions, setNumQuestions] = useState(
    interviewData.question_count == 0
      ? ""
      : String(interviewData.question_count),
  );
  const [duration, setDuration] = useState(interviewData.time_duration);
  const [uploadedDocumentContext, setUploadedDocumentContext] = useState("");

  const slideLeft = (id: string, value: number) => {
    var slider = document.getElementById(`${id}`);
    if (slider) {
      slider.scrollLeft = slider.scrollLeft - value;
    }
  };

  const slideRight = (id: string, value: number) => {
    var slider = document.getElementById(`${id}`);
    if (slider) {
      slider.scrollLeft = slider.scrollLeft + value;
    }
  };

  const fetchVoiceInfo = async (agentId: string) => {
    if (voiceInfoCache[agentId]) return;

    try {
      const response = await axios.get("/api/get-agent-voice", {
        params: { agent_id: agentId },
      });

      if (response.data && response.status === 200) {
        setVoiceInfoCache(prev => ({
          ...prev,
          [agentId]: {
            agent_id: response.data.agent_id,
            agent_name: response.data.agent_name,
            voice_id: response.data.voice_id,
            voice_name: response.data.voice_name,
            language: response.data.language,
            voice_preview_url: response.data.voice_preview_url,
            provider: response.data.provider,
            gender: response.data.gender,
            age: response.data.age,
          },
        }));
      }
    } catch (error) {
      console.error("Error fetching voice info:", error);
    }
  };

  const onGenrateQuestions = async () => {
    setLoading(true);

    const data = {
      name: name.trim(),
      objective: objective.trim(),
      number: numQuestions,
      context: uploadedDocumentContext,
      userId: user?.id,
      organizationId: user?.organization_id,
      // Fields for API usage tracking metadata
      numberOfQuestions: Number(numQuestions),
      interviewName: name.trim(),
    };

    const generatedQuestions = (await axios.post(
      "/api/generate-interview-questions",
      data,
    )) as any;

    const generatedQuestionsResponse = JSON.parse(
      generatedQuestions?.data?.response,
    );

    const updatedQuestions = generatedQuestionsResponse.questions.map(
      (question: Question) => ({
        id: uuidv4(),
        question: question.question.trim(),
        follow_up_count: 1,
      }),
    );

    const updatedInterviewData = {
      ...interviewData,
      name: name.trim(),
      objective: objective.trim(),
      questions: updatedQuestions,
      interviewer_id: selectedInterviewer,
      question_count: Number(numQuestions),
      time_duration: duration,
      description: generatedQuestionsResponse.description,
      is_anonymous: isAnonymous,
    };
    setInterviewData(updatedInterviewData);
  };

  const onManual = () => {
    setLoading(true);

    const updatedInterviewData = {
      ...interviewData,
      name: name.trim(),
      objective: objective.trim(),
      questions: [{ id: uuidv4(), question: "", follow_up_count: 1 }],
      interviewer_id: selectedInterviewer,
      question_count: Number(numQuestions),
      time_duration: String(duration),
      description: "",
      is_anonymous: isAnonymous,
    };
    setInterviewData(updatedInterviewData);
  };

  useEffect(() => {
    if (!open) {
      setName("");
      setSelectedInterviewer(BigInt(0));
      setObjective("");
      setNumQuestions("");
      setDuration("");
      setIsClicked(false);
      setVoiceInfoCache({});
    }
  }, [open]);


  return (
    <>
      <div className="text-center w-[38rem]">
        <h1 className="text-xl font-semibold">Create an Interview</h1>
        <div className="flex flex-col justify-center items-start mt-4 ml-10 mr-8">
          <div className="flex flex-row justify-center items-center">
            <h3 className="text-sm font-medium">Interview Name:</h3>
            <input
              type="text"
              className="border-b-2 focus:outline-none border-gray-500 px-2 w-96 py-0.5 ml-3"
              placeholder="e.g. Name of the Interview"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => setName(e.target.value.trim())}
            />
          </div>
          <h3 className="text-sm mt-3 font-medium">Select an Interviewer:</h3>
          <div className="relative flex items-center mt-1">
            <div
              id="slider-3"
              className=" h-36 pt-1 overflow-x-scroll scroll whitespace-nowrap scroll-smooth scrollbar-hide w-[27.5rem]"
            >
              <TooltipProvider>
                {interviewers.map((item) => (
                  <div
                    className=" p-0 inline-block cursor-pointer ml-1 mr-5 rounded-xl shrink-0 overflow-hidden"
                    key={item.id}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="absolute ml-9 z-10"
                          onMouseEnter={() => {
                            if (item.agent_id) {
                              fetchVoiceInfo(item.agent_id);
                            }
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setInterviewerDetails(item);
                            setOpenInterviewerDetails(true);
                          }}
                        >
                          <Info size={18} color="#4f46e5" strokeWidth={2.2} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[250px] p-3">
                        {item.agent_id && voiceInfoCache[item.agent_id] ? (
                          <div className="text-xs space-y-1">
                            <div className="font-semibold text-sm mb-2">{item.name}</div>
                            {voiceInfoCache[item.agent_id].voice_name && (
                              <div>
                                <span className="text-gray-500">Voice:</span>{" "}
                                <span className="font-medium">
                                  {voiceInfoCache[item.agent_id].voice_name}
                                  {voiceInfoCache[item.agent_id].language && (
                                    <span className="text-gray-500 ml-1">
                                      ({voiceInfoCache[item.agent_id].language})
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}
                            {voiceInfoCache[item.agent_id].provider && (
                              <div>
                                <span className="text-gray-500">Provider:</span>{" "}
                                <span className="font-medium capitalize">
                                  {voiceInfoCache[item.agent_id].provider}
                                </span>
                              </div>
                            )}
                            {voiceInfoCache[item.agent_id].gender && (
                              <div>
                                <span className="text-gray-500">Gender:</span>{" "}
                                <span className="font-medium capitalize">
                                  {voiceInfoCache[item.agent_id].gender}
                                </span>
                              </div>
                            )}
                            <div className="text-gray-400 text-[10px] mt-2">
                              Click for full details
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs">
                            <div className="font-semibold">{item.name}</div>
                            <div className="text-gray-400 mt-1">
                              {item.agent_id ? "Loading voice info..." : "Click for details"}
                            </div>
                          </div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                    <div
                      className={`w-[96px] overflow-hidden rounded-full ${
                        selectedInterviewer === item.id
                          ? "border-4 border-indigo-600"
                          : ""
                      }`}
                      onClick={() => setSelectedInterviewer(item.id)}
                    >
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt="Picture of the interviewer"
                          width={70}
                          height={70}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 rounded-full" style={{ aspectRatio: '1/1' }} />
                      )}
                    </div>
                    <CardTitle className="mt-0 text-xs text-center">
                      {item.name}
                    </CardTitle>
                  </div>
                ))}
              </TooltipProvider>
            </div>
            {interviewers.length > 4 ? (
              <div className="flex-row justify-center ml-3 mb-1 items-center space-y-6">
                <ChevronRight
                  className="opacity-50 cursor-pointer hover:opacity-100"
                  size={27}
                  onClick={() => slideRight("slider-3", 115)}
                />
                <ChevronLeft
                  className="opacity-50 cursor-pointer hover:opacity-100"
                  size={27}
                  onClick={() => slideLeft("slider-3", 115)}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
          <h3 className="text-sm font-medium">Objective:</h3>
          <Textarea
            value={objective}
            className="h-24 mt-2 border-2 border-gray-500 w-[33.2rem]"
            placeholder="e.g. Find best candidates based on their technical skills and previous projects."
            onChange={(e) => setObjective(e.target.value)}
            onBlur={(e) => setObjective(e.target.value.trim())}
          />
          <h3 className="text-sm font-medium mt-2">
            Upload any documents related to the interview.
          </h3>
          <FileUpload
            isUploaded={isUploaded}
            setIsUploaded={setIsUploaded}
            fileName={fileName}
            setFileName={setFileName}
            setUploadedDocumentContext={setUploadedDocumentContext}
          />
          <div className="flex flex-row gap-3 justify-between w-full mt-3">
            <div className="flex flex-row justify-center items-center ">
              <h3 className="text-sm font-medium ">Number of Questions:</h3>
              <input
                type="number"
                step="1"
                max="10"
                min="1"
                className="border-b-2 text-center focus:outline-none  border-gray-500 w-14 px-2 py-0.5 ml-3"
                value={numQuestions}
                onChange={(e) => {
                  let value = e.target.value;
                  if (
                    value === "" ||
                    (Number.isInteger(Number(value)) && Number(value) > 0)
                  ) {
                    if (Number(value) > 10) {
                      value = "10";
                    }
                    setNumQuestions(value);
                  }
                }}
              />
            </div>
            <div className="flex flex-row justify-center items-center">
              <h3 className="text-sm font-medium ">Duration (mins):</h3>
              <input
                type="number"
                step="1"
                max="20"
                min="1"
                className="border-b-2 text-center focus:outline-none  border-gray-500 w-14 px-2 py-0.5 ml-3"
                value={duration}
                onChange={(e) => {
                  let value = e.target.value;
                  if (
                    value === "" ||
                    (Number.isInteger(Number(value)) && Number(value) > 0)
                  ) {
                    if (Number(value) > 20) {
                      value = "20";
                    }
                    setDuration(value);
                  }
                }}
              />
            </div>
          </div>
          <div className="flex flex-row w-full justify-center items-center space-x-24 mt-5">
            <Button
              disabled={
                (name &&
                objective &&
                numQuestions &&
                duration &&
                selectedInterviewer != BigInt(0)
                  ? false
                  : true) || isClicked
              }
              className="bg-indigo-600 hover:bg-indigo-800  w-40"
              onClick={() => {
                setIsClicked(true);
                onGenrateQuestions();
              }}
            >
              Generate Questions
            </Button>
            <Button
              disabled={
                (name &&
                objective &&
                numQuestions &&
                duration &&
                selectedInterviewer != BigInt(0)
                  ? false
                  : true) || isClicked
              }
              className="bg-indigo-600 w-40 hover:bg-indigo-800"
              onClick={() => {
                setIsClicked(true);
                onManual();
              }}
            >
              I&apos;ll do it myself
            </Button>
          </div>
        </div>
      </div>
      <Modal
        open={openInterviewerDetails}
        closeOnOutsideClick={true}
        onClose={() => {
          setOpenInterviewerDetails(false);
        }}
      >
        <InterviewerDetailsModal interviewer={interviewerDetails} />
      </Modal>
    </>
  );
}

export default DetailsPopup;
