"use client";

import {
  ArrowUpRightSquareIcon,
  AlarmClockIcon,
  XCircleIcon,
  CheckCircleIcon,
  Volume2Icon,
  MicIcon,
  VolumeXIcon,
  AlertTriangleIcon,
  UserIcon,
  MailIcon,
  VideoIcon,
} from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { useResponses } from "@/contexts/responses.context";
import Image from "next/image";
import axios from "axios";
import { RetellWebClient } from "retell-client-js-sdk";
import MiniLoader from "../loaders/mini-loader/miniLoader";
import { toast, Toaster } from "sonner";
import { isLightColor, testEmail } from "@/lib/utils";
import { ResponseService } from "@/services/responses.service";
import { Interview } from "@/types/interview";
import { FeedbackData } from "@/types/response";
import { FeedbackService } from "@/services/feedback.service";
import { FeedbackForm } from "@/components/call/feedbackForm";
import VideoRecorder, { VideoRecorderHandle } from '@/components/dashboard/interview/VideoRecorder';
import {
  TabSwitchWarning,
  useTabSwitchPrevention,
} from "./tabSwitchPrevention";
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
import { InterviewerService } from "@/services/interviewers.service";
import { assigneeService } from "@/services/users.service";
import { useFaceVerification } from "@/hooks/useFaceVerification";
import { FaceMismatchWarning, VerificationStatus } from "./FaceMismatchWarning";
import { useCameraDetection } from "@/hooks/useCameraDetection";
import { useMultiplePersonDetection } from "@/hooks/useMultiplePersonDetection";
import { ViolationWarning, ViolationTracker, CameraOffCountdownAlert } from "./ViolationWarnings";
import { AnimatePresence } from "framer-motion";
import { ViolationEvent } from "@/types/response";

// Type assertion needed because RetellWebClient extends EventEmitter but types don't expose event methods
const webClient = new RetellWebClient() as RetellWebClient & {
  on: (event: string, callback: (...args: any[]) => void) => void;
  removeAllListeners: () => void;
};

type InterviewProps = {
  interview: Interview;
};

type registerCallResponseType = {
  data: {
    registerCallResponse: {
      call_id: string;
      access_token: string;
    };
  };
};

type transcriptType = {
  role: string;
  content: string;
};

function Call({ interview }: InterviewProps) {
  const { createResponse } = useResponses();
  const [lastInterviewerResponse, setLastInterviewerResponse] =
    useState<string>("");
  const [lastUserResponse, setLastUserResponse] = useState<string>("");
  const [activeTurn, setActiveTurn] = useState<string>("");
  const [Loading, setLoading] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isValidEmail, setIsValidEmail] = useState<boolean>(false);
  const [callId, setCallId] = useState<string>("");
  const { tabSwitchCount } = useTabSwitchPrevention();
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [interviewerImg, setInterviewerImg] = useState("");
  const [interviewTimeDuration, setInterviewTimeDuration] =
    useState<string>("1");
  const [time, setTime] = useState(0);
  const [currentTimeDuration, setCurrentTimeDuration] = useState<string>("0");
  const [baseTabSwitchCount, setBaseTabSwitchCount] = useState(0);
  const [baseMismatchCount, setBaseMismatchCount] = useState(0);
  const [baseCameraOffCount, setBaseCameraOffCount] = useState(0);
  const [baseMultiplePersonCount, setBaseMultiplePersonCount] = useState(0);

  // Camera preview state - show video before interview starts
  const [showCameraPreview, setShowCameraPreview] = useState(true);

  // Camera countdown timer states
  const [cameraOffCountdown, setCameraOffCountdown] = useState<number | null>(null);
  const [cameraOffStartTime, setCameraOffStartTime] = useState<number | null>(null);
  const [showCameraOffAlert, setShowCameraOffAlert] = useState(false);
  const cameraCountdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Face verification states
  const [assigneePhotoUrl, setAssigneePhotoUrl] = useState<string | null>(null);
  const [showMismatchWarning, setShowMismatchWarning] = useState(false);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoRecorderRef = useRef<VideoRecorderHandle>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const interviewVideoRef = useRef<HTMLVideoElement>(null);

  const lastUserResponseRef = useRef<HTMLDivElement | null>(null);

  // Face verification hook - use the visible video element (interviewVideoRef)
  // The hidden VideoRecorder's video element doesn't render frames properly for face detection
  const {
    result: verificationResult,
    mismatchCount,
    totalAttempts: faceVerificationTotal,
    isLoading: verificationLoading,
    hasReferenceImage,
    modelsLoaded
  } = useFaceVerification({
    referenceImageUrl: assigneePhotoUrl,
    videoRef: interviewVideoRef,
    enabled: isStarted && !isEnded && !!assigneePhotoUrl && !!videoStream,
    checkInterval: 15000, // Check every 15 seconds
    matchThreshold: 0.6,
  });

  // Camera detection hook - use the visible video element (interviewVideoRef)
  // The hidden VideoRecorder's video element doesn't render properly for pixel detection
  const {
    status: cameraStatus,
    showWarning: showCameraWarning,
    dismissWarning: dismissCameraWarning,
  } = useCameraDetection({
    videoRef: interviewVideoRef,
    enabled: isStarted && !isEnded && !!videoStream,
    checkInterval: 5000, // Check every 5 seconds
  });

  // Monitor camera status and start countdown when camera goes off
  useEffect(() => {
    if (!isStarted || isEnded) {
      // Clear countdown if interview not started or ended
      if (cameraCountdownIntervalRef.current) {
        clearInterval(cameraCountdownIntervalRef.current);
        cameraCountdownIntervalRef.current = null;
      }
      setCameraOffCountdown(null);
      setCameraOffStartTime(null);
      setShowCameraOffAlert(false);
      return;
    }

    // If camera is off and we haven't started countdown yet
    if (!cameraStatus.isOn && cameraOffStartTime === null) {
      const startTime = Date.now();
      setCameraOffStartTime(startTime);
      setShowCameraOffAlert(true);
      setCameraOffCountdown(120); // 2 minutes = 120 seconds
      
      // Start countdown timer
      cameraCountdownIntervalRef.current = setInterval(() => {
        setCameraOffCountdown((prevCountdown) => {
          if (prevCountdown === null || prevCountdown <= 0) {
            // Auto-end interview after 2 minutes
            if (cameraCountdownIntervalRef.current) {
              clearInterval(cameraCountdownIntervalRef.current);
              cameraCountdownIntervalRef.current = null;
            }
            // End the interview
            webClient.stopCall();
            setIsEnded(true);
            toast.error("Interview ended automatically: Camera was turned off for more than 2 minutes.");
            return 0;
          }
          return prevCountdown - 1;
        });
      }, 1000);
    }
    
    // If camera is back on, clear countdown
    if (cameraStatus.isOn && cameraOffStartTime !== null) {
      if (cameraCountdownIntervalRef.current) {
        clearInterval(cameraCountdownIntervalRef.current);
        cameraCountdownIntervalRef.current = null;
      }
      setCameraOffCountdown(null);
      setCameraOffStartTime(null);
      setShowCameraOffAlert(false);
    }

    return () => {
      if (cameraCountdownIntervalRef.current) {
        clearInterval(cameraCountdownIntervalRef.current);
        cameraCountdownIntervalRef.current = null;
      }
    };
  }, [cameraStatus.isOn, isStarted, isEnded, cameraOffStartTime]);

  // Multiple person detection hook - use the visible video element (interviewVideoRef)
  // The hidden VideoRecorder's video element doesn't render frames properly for face detection
  const {
    status: multiplePersonStatus,
    showWarning: showMultiplePersonWarning,
    dismissWarning: dismissMultiplePersonWarning,
  } = useMultiplePersonDetection({
    videoRef: interviewVideoRef,
    enabled: isStarted && !isEnded && !!videoStream,
    modelsLoaded,
    checkInterval: 10000, // Check every 10 seconds
    minConfidence: 0.5,
  });

  // Update video element ref and stream when recorder ref changes
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let attempts = 0;
    const maxAttempts = 30; // Try for up to 15 seconds (30 * 500ms)

    function checkVideoElement() {
      if (videoRecorderRef.current?.videoElement) {
        videoElementRef.current = videoRecorderRef.current.videoElement;
        setVideoElement(videoRecorderRef.current.videoElement);
      }
      // Get the stream and apply it to preview/interview video elements
      const stream = videoRecorderRef.current?.getStream();
      if (stream) {
        setVideoStream(stream);
        // Apply stream to preview video if it exists
        if (previewVideoRef.current && previewVideoRef.current.srcObject !== stream) {
          previewVideoRef.current.srcObject = stream;
          previewVideoRef.current.play().catch(() => {});
        }
        // Apply stream to interview video if it exists
        if (interviewVideoRef.current && interviewVideoRef.current.srcObject !== stream) {
          interviewVideoRef.current.srcObject = stream;
          interviewVideoRef.current.play().catch(() => {});
        }
        // Stop polling once stream is connected
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        return true;
      }
      return false;
    }

    // Check immediately
    const hasStream = checkVideoElement();

    // If no stream yet, poll until we get it
    if (!hasStream) {
      intervalId = setInterval(() => {
        attempts++;
        const success = checkVideoElement();
        if (success || attempts >= maxAttempts) {
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      }, 500);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [showCameraPreview, isStarted]);

  // Apply stream to preview video when it's available
  useEffect(() => {
    if (!isStarted && !isEnded && videoStream && previewVideoRef.current) {
      if (previewVideoRef.current.srcObject !== videoStream) {
        previewVideoRef.current.srcObject = videoStream;
        previewVideoRef.current.play().catch(() => {});
      }
    }
  }, [isStarted, isEnded, videoStream]);

  // Apply stream to interview video when it mounts
  useEffect(() => {
    if (isStarted && !isEnded && videoStream && interviewVideoRef.current) {
      if (interviewVideoRef.current.srcObject !== videoStream) {
        interviewVideoRef.current.srcObject = videoStream;
        interviewVideoRef.current.play().catch(() => {});
      }
    }
  }, [isStarted, isEnded, videoStream]);

  // Show warning when face mismatch detected
  useEffect(() => {
    if (!verificationResult.isMatch && verificationResult.lastChecked && hasReferenceImage) {
      setShowMismatchWarning(true);
      // Auto-hide warning after 8 seconds
      const timeout = setTimeout(() => setShowMismatchWarning(false), 8000);

      return () => clearTimeout(timeout);
    }
  }, [verificationResult, hasReferenceImage]);

  // Preload assignee photo during camera preview (before interview starts)
  // This prevents video stuttering when face verification initializes
  useEffect(() => {
    const fetchAssigneePhoto = async () => {
      // Fetch as soon as we have email and interview.id (during preview phase)
      if (email && interview.id && !assigneePhotoUrl) {
        try {
          const res = await fetch('/api/get-assignee-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, interview_id: interview.id }),
          });
          const data = await res.json();
          if (data.avatar_url) {
            setAssigneePhotoUrl(data.avatar_url);
          }
        } catch {
          // Photo fetch failed - face verification will be skipped
        }
      }
    };
    fetchAssigneePhoto();
  }, [email, interview.id, assigneePhotoUrl]);

  const handleFeedbackSubmit = async (
    formData: Omit<FeedbackData, "interview_id">,
  ) => {
    try {
      const result = await FeedbackService.submitFeedback({
        ...formData,
        interview_id: interview.id,
      });

      if (result) {
        toast.success("Thank you for your feedback!");
        setIsFeedbackSubmitted(true);
        setIsDialogOpen(false);
      } else {
        toast.error("Failed to submit feedback. Please try again.");
      }
    } catch {
      toast.error("An error occurred. Please try again later.");
    }
  };

  useEffect(() => {
    if (lastUserResponseRef.current) {
      const { current } = lastUserResponseRef;
      current.scrollTop = current.scrollHeight;
    }
  }, [lastUserResponse]);

  useEffect(() => {
    let intervalId: any;
    if (isCalling) {
      // setting time from 0 to 1 every 10 milisecond using javascript setInterval method
      intervalId = setInterval(() => setTime(time + 1), 10);
    }
    setCurrentTimeDuration(String(Math.floor(time / 100)));
    if (Number(currentTimeDuration) == Number(interviewTimeDuration) * 60) {
      webClient.stopCall();
      setIsEnded(true);
    }


    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCalling, time, currentTimeDuration]);

  useEffect(() => {
    if (testEmail(email)) {
      setIsValidEmail(true);
    }
  }, [email]);

  useEffect(() => {
    webClient.on("call_started", () => {
      setIsCalling(true);
    });

    webClient.on("call_ended", () => {
      setIsCalling(false);
      setIsEnded(true);
    });

    webClient.on("agent_start_talking", () => {
      setActiveTurn("agent");
    });

    webClient.on("agent_stop_talking", () => {
      // Optional: Add any logic when agent stops talking
      setActiveTurn("user");
    });

    webClient.on("error", () => {
      webClient.stopCall();
      setIsEnded(true);
      setIsCalling(false);
    });

    webClient.on("update", (update) => {
      if (update.transcript) {
        const transcripts: transcriptType[] = update.transcript;
        const roleContents: { [key: string]: string } = {};

        transcripts.forEach((transcript) => {
          roleContents[transcript?.role] = transcript?.content;
        });

        setLastInterviewerResponse(roleContents["agent"]);
        setLastUserResponse(roleContents["user"]);
      }
    });


    return () => {
      // Clean up event listeners
      webClient.removeAllListeners();
    };
  }, []);

  const onEndCallClick = async () => {
    if (isStarted) {
      setLoading(true);
      webClient.stopCall();
      setIsEnded(true);
      setLoading(false);
    } else {
      setIsEnded(true);
    }
    // Clear camera countdown if interview ends
    if (cameraCountdownIntervalRef.current) {
      clearInterval(cameraCountdownIntervalRef.current);
      cameraCountdownIntervalRef.current = null;
    }
    setCameraOffCountdown(null);
    setCameraOffStartTime(null);
    setShowCameraOffAlert(false);
  };

  const startConversation = async () => {
    setLoading(true);
    
    // 0. Basic validation for email & name
    if (!testEmail(email)) {
      toast.error("Please enter a valid email address before starting the interview.");
      setLoading(false);

      return;
    }

    if (!name.trim()) {
      toast.error("Please enter your name before starting the interview.");
      setLoading(false);

      return;
    }

    // 1. Check if this assignee is allowed to take / retake the interview
    try {
      // We only enforce the flag when we can match the assignee record
      const assignee = await assigneeService.getAssigneeByEmailAndInterview(
        email.toLowerCase(),
        interview.id,
      );

      if (assignee && assignee.allow_retake === false) {
        setLoading(false);
        toast.error(
          "You have already completed this interview. Please contact your recruiter if you need another attempt.",
        );

        return;
      }
    } catch {
      // If this check fails, don't block the interview
    }

    // Check if camera is available (video stream should be ready from preview)
    if (!videoStream) {
      toast.error("Please ensure your camera is on before starting the interview.");
      setLoading(false);
      return;
    }

    // Validate email with backend
    try {
      const validateRes = await axios.post("/api/validate-user", { email,interview_id: interview.id, });
      if (!validateRes.data.success) {
        toast.error(validateRes.data.error || "You are not authorized person");
        setLoading(false);

        return;
      }
    } catch (err: any) {
      const message =
      err?.response?.data?.error ||
      err?.message ||
      "You are not authorized person";
      toast.error(message);
      setLoading(false);

      return;
    }
    const data = {
      mins: interview?.time_duration,
      objective: interview?.objective,
      questions: interview?.questions.map((q) => q.question).join(", "),
      name: name || "not provided",
      email: email || null,
      interview_id: interview?.id || null,
    };

    // Capture current violation counters as baseline for this attempt
    setBaseTabSwitchCount(tabSwitchCount);
    setBaseMismatchCount(mismatchCount);
    setBaseCameraOffCount(cameraStatus.offCount);
    setBaseMultiplePersonCount(multiplePersonStatus.multiplePersonCount);

    try {
      const registerCallResponse: registerCallResponseType = await axios.post(
        "/api/register-call",
        { dynamic_data: data, interviewer_id: interview?.interviewer_id },
      );

      if (registerCallResponse.data.registerCallResponse.access_token) {
        await webClient
          .startCall({
            accessToken:
              registerCallResponse.data.registerCallResponse.access_token,
          })
          .catch(() => {});
        setIsCalling(true);
        setIsStarted(true);

        const newCallId =
          registerCallResponse?.data?.registerCallResponse?.call_id;
        setCallId(newCallId);

        await createResponse({
          interview_id: interview.id,
          call_id: newCallId,
          email: email,
          name: name,
        });
      } else {
        toast.error(
          "We couldn't start your interview. Please try again in a moment.",
        );
      }
    } catch {
      toast.error(
        "Something went wrong while starting the interview. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (interview?.time_duration) {
      setInterviewTimeDuration(interview?.time_duration);
    }
  }, [interview]);

  useEffect(() => {
    const fetchInterviewer = async () => {
      const interviewer = await InterviewerService.getInterviewer(
        interview.interviewer_id,
      );
      setInterviewerImg(interviewer.image);
    };
    fetchInterviewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview.interviewer_id]);

  useEffect(() => {
    if (isEnded) {
      const updateInterview = async () => {
        // Create violations summary with all violation types (per attempt)
        const tabSwitchDelta = Math.max(
          0,
          tabSwitchCount - baseTabSwitchCount,
        );
        const mismatchDelta = Math.max(0, mismatchCount - baseMismatchCount);
        // Check if interview ended due to camera being off for 2+ minutes
        const endedDueToCameraOff = cameraOffStartTime !== null && cameraOffCountdown === 0;
        
        // If interview ended due to camera being off, ensure it's counted
        const cameraOffDelta = endedDueToCameraOff 
          ? Math.max(1, cameraStatus.offCount - baseCameraOffCount + 1)
          : Math.max(0, cameraStatus.offCount - baseCameraOffCount);
        
        const multiplePersonDelta = Math.max(
          0,
          multiplePersonStatus.multiplePersonCount -
            baseMultiplePersonCount,
        );

        const violations: ViolationEvent[] = [];
        
        // Add tab switch violations
        for (let i = 0; i < tabSwitchDelta; i++) {
          violations.push({
            type: 'tab_switch',
            timestamp: new Date().toISOString(),
            details: 'Assignee switched tabs during the interview'
          });
        }
        
        // Add face mismatch violations
        for (let i = 0; i < mismatchDelta; i++) {
          violations.push({
            type: 'face_mismatch',
            timestamp: new Date().toISOString(),
            details: 'Face did not match the profile picture'
          });
        }
        
        // Add camera off violations
        for (let i = 0; i < cameraOffDelta; i++) {
          if (i === cameraOffDelta - 1 && endedDueToCameraOff) {
            // Last violation is the one that caused interview to end
            violations.push({
              type: 'camera_off',
              timestamp: new Date().toISOString(),
              details: 'Interview ended automatically: Camera was turned off for more than 2 minutes'
            });
          } else {
            violations.push({
              type: 'camera_off',
              timestamp: new Date().toISOString(),
              details: 'Camera was turned off during the interview'
            });
          }
        }
        
        // Add multiple person violations
        for (let i = 0; i < multiplePersonDelta; i++) {
          violations.push({
            type: 'multiple_person',
            timestamp: new Date().toISOString(),
            details: 'Multiple persons detected in the video'
          });
        }
        
        // Calculate total attempts (current total minus base total, or just current total if no base)
        const faceMismatchTotal = faceVerificationTotal || 0;
        const cameraOffTotal = cameraStatus.totalChecks || 0;
        const multiplePersonTotal = multiplePersonStatus.totalChecks || 0;

        await ResponseService.saveResponse(
          { 
            is_ended: true, 
            tab_switch_count: tabSwitchDelta,
            face_mismatch_count: mismatchDelta,
            camera_off_count: cameraOffDelta,
            multiple_person_count: multiplePersonDelta,
            // Default candidate status after interview: To Be Reviewed
            candidate_status: 'NO_STATUS',
            face_mismatch_total: faceMismatchTotal,
            camera_off_total: cameraOffTotal,
            multiple_person_total: multiplePersonTotal,
            violations_summary: violations
          },
          callId,
        );

        // Once the interview has ended successfully, mark the assignee as not allowed to retake
        // and update interview_status to INTERVIEW_COMPLETED
        try {
          if (email && interview?.id) {
            const assignee = await assigneeService.getAssigneeByEmailAndInterview(
              email.toLowerCase(),
              interview.id,
            );

            if (assignee && assignee.id) {
              await assigneeService.updateAssignee(assignee.id, {
                allow_retake: false,
                interview_status: 'INTERVIEW_COMPLETED',
              });
            }
          }
        } catch {
          // Non-critical error - assignee status update failed
        }

        // Send email notification to recruiter
        if (email && callId) {
          try {
            await fetch('/api/send-recruiter-notification', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                callId: callId,
                assigneeEmail: email,
              }),
            });
          } catch {
            // Non-critical - notification failed silently
          }
        }
      };

      updateInterview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnded]);


  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/20">
      {/* Violation Warnings */}
      {isStarted && <TabSwitchWarning />}
      
      {/* Modern Violation Warnings */}
      <AnimatePresence>
        {isStarted && !isEnded && showMismatchWarning && (
          <ViolationWarning type="face-mismatch" onDismiss={() => setShowMismatchWarning(false)} />
        )}
        {isStarted && !isEnded && showCameraWarning && !showCameraOffAlert && (
          <ViolationWarning type="camera" onDismiss={dismissCameraWarning} />
        )}
        {isStarted && !isEnded && showMultiplePersonWarning && (
          <ViolationWarning type="multiple-person" onDismiss={dismissMultiplePersonWarning} />
        )}
        {isStarted && !isEnded && showCameraOffAlert && cameraOffCountdown !== null && (
          <CameraOffCountdownAlert 
            countdown={cameraOffCountdown} 
            onDismiss={() => setShowCameraOffAlert(false)} 
          />
        )}
      </AnimatePresence>

      {/* Violation Tracker - Hidden per user request */}
      {/* {isStarted && !isEnded && (
        <ViolationTracker
          tabSwitchCount={tabSwitchCount}
          faceMismatchCount={mismatchCount}
          cameraOffCount={cameraStatus.offCount}
          multiplePersonCount={multiplePersonStatus.multiplePersonCount}
        />
      )} */}

      {/* Persistent VideoRecorder - rendered once and never unmounts until interview ends */}
      {!isEnded && (
        <div className="hidden">
          <VideoRecorder
            ref={videoRecorderRef}
            interviewId={interview.id}
            username={name || "Anonymous"}
            isRecording={isStarted}
          />
        </div>
      )}

      <div className="w-[95%] md:w-[90%] lg:w-[85%] max-w-7xl">
        <Card className="min-h-[90vh] rounded-2xl border border-slate-200/60 bg-white/80 backdrop-blur-sm shadow-xl shadow-indigo-100/50 overflow-hidden">
          <div className="h-full flex flex-col">
            {/* Progress Bar */}
            <div className="px-6 pt-4">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 transition-all duration-500 ease-out"
                  style={{
                    width: isEnded
                      ? "100%"
                      : `${
                          (Number(currentTimeDuration) /
                            (Number(interviewTimeDuration) * 60)) *
                          100
                        }%`,
                  }}
                />
              </div>
            </div>
            
            {/* Header */}
            <CardHeader className="items-center py-4 px-6">
              {!isEnded && (
                <CardTitle className="text-xl md:text-2xl font-semibold text-slate-800 tracking-tight">
                  {interview?.name}
                </CardTitle>
              )}
              {!isEnded && (
                <div className="flex items-center gap-2 mt-2 px-4 py-1.5 rounded-full bg-indigo-50/80 border border-indigo-100">
                  <AlarmClockIcon
                    className="h-4 w-4"
                    style={{ color: interview.theme_color || '#4F46E5' }}
                  />
                  <span className="text-sm text-slate-600">
                    Expected duration:{" "}
                    <span
                      className="font-semibold"
                      style={{ color: interview.theme_color || '#4F46E5' }}
                    >
                      {interviewTimeDuration} mins
                    </span>
                    {" "}or less
                  </span>
                </div>
              )}
            </CardHeader>
            {!isStarted && !isEnded && (
              <div className="flex-1 flex items-center justify-center px-4 py-6 lg:py-8">
                <div className="w-full max-w-4xl">
                  {/* Main Card */}
                  <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 overflow-hidden">
                    {/* Header with Logo */}
                    <div className="bg-gradient-to-r from-slate-50 via-white to-slate-50 border-b border-slate-100 px-6 py-5">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        {interview?.logo_url && (
                          <Image
                            src={interview?.logo_url}
                            alt="Company Logo"
                            className="h-10 w-auto object-contain"
                            width={120}
                            height={40}
                          />
                        )}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 border border-indigo-100">
                            <AlarmClockIcon className="h-4 w-4 text-indigo-600" />
                            <span className="text-sm font-medium text-slate-700">
                              Duration: <span className="text-indigo-600">{interviewTimeDuration} min</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Two Column Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-slate-100">
                      {/* Left Column - Camera Preview */}
                      <div className="p-6 lg:p-8 bg-gradient-to-br from-slate-50/50 to-white">
                        <div className="flex flex-col h-full">
                          {/* Section Header */}
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 rounded-lg bg-indigo-100">
                              <VideoIcon className="h-4 w-4 text-indigo-600" />
                            </div>
                            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Camera Preview</h3>
                          </div>

                          {/* Camera Container */}
                          <div className="relative flex-1 flex items-center justify-center">
                            <div className="relative w-full max-w-md">
                              {/* Video Frame */}
                              <div className="relative aspect-video bg-slate-900 rounded-2xl overflow-hidden shadow-lg ring-1 ring-slate-200">
                                <video
                                  ref={previewVideoRef}
                                  className="w-full h-full object-cover"
                                  style={{ background: "#0f172a", transform: "scaleX(-1)" }}
                                  autoPlay
                                  muted
                                  playsInline
                                />

                                {/* Overlay when no stream */}
                                {!videoStream && (
                                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm">
                                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-500 flex items-center justify-center mb-3 animate-pulse">
                                      <UserIcon className="h-8 w-8 text-slate-500" />
                                    </div>
                                    <p className="text-slate-400 text-sm font-medium">Initializing camera...</p>
                                    <p className="text-slate-500 text-xs mt-1">Please allow camera access</p>
                                  </div>
                                )}

                                {/* Face positioning guide overlay */}
                                {videoStream && (
                                  <div className="absolute inset-0 pointer-events-none">
                                    {/* Corner guides */}
                                    <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-white/30 rounded-tl-lg" />
                                    <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-white/30 rounded-tr-lg" />
                                    <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-white/30 rounded-bl-lg" />
                                    <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-white/30 rounded-br-lg" />
                                  </div>
                                )}
                              </div>

                              {/* Camera Status Badge */}
                              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
                                {videoStream ? (
                                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-full shadow-lg shadow-emerald-200">
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                                    </span>
                                    <span className="text-sm font-medium">Camera Ready</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-full shadow-lg shadow-amber-200">
                                    <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>
                                    <span className="text-sm font-medium">Connecting...</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Camera Tips */}
                          <p className="text-xs text-slate-500 text-center mt-6">
                            Position your face within the frame and ensure good lighting
                          </p>
                        </div>
                      </div>

                      {/* Right Column - Instructions & Form */}
                      <div className="p-6 lg:p-8 flex flex-col">
                        {/* Interview Description */}
                        {interview?.description && (
                          <p className="text-slate-600 text-sm leading-relaxed mb-6">
                            {interview?.description}
                          </p>
                        )}

                        {/* Pre-Interview Checklist */}
                        <div className="bg-slate-50 rounded-xl p-5 mb-6 border border-slate-100">
                          <h4 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                            <span className="p-1.5 rounded-lg bg-indigo-100">
                              <CheckCircleIcon className="h-3.5 w-3.5 text-indigo-600" />
                            </span>
                            Pre-Interview Checklist
                          </h4>
                          <ul className="space-y-3">
                            <li className="flex items-start gap-3">
                              <div className="mt-0.5 p-1 rounded-full bg-emerald-100">
                                <Volume2Icon className="h-3 w-3 text-emerald-600" />
                              </div>
                              <span className="text-sm text-slate-600">Ensure your volume is turned up</span>
                            </li>
                            <li className="flex items-start gap-3">
                              <div className="mt-0.5 p-1 rounded-full bg-emerald-100">
                                <MicIcon className="h-3 w-3 text-emerald-600" />
                              </div>
                              <span className="text-sm text-slate-600">Grant microphone access when prompted</span>
                            </li>
                            <li className="flex items-start gap-3">
                              <div className="mt-0.5 p-1 rounded-full bg-emerald-100">
                                <VolumeXIcon className="h-3 w-3 text-emerald-600" />
                              </div>
                              <span className="text-sm text-slate-600">Be in a quiet environment</span>
                            </li>
                            <li className="flex items-start gap-3">
                              <div className="mt-0.5 p-1 rounded-full bg-amber-100">
                                <AlertTriangleIcon className="h-3 w-3 text-amber-600" />
                              </div>
                              <span className="text-sm text-slate-600">
                                Tab switching will be <span className="font-medium text-amber-700">monitored</span>
                              </span>
                            </li>
                          </ul>
                        </div>

                        {/* Form Fields */}
                        <div className="space-y-4 mb-6">
                          <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                              <MailIcon className="h-4 w-4 text-slate-400" />
                              Email Address
                            </label>
                            <input
                              value={email}
                              type="email"
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                              placeholder="you@example.com"
                              onChange={(e) => setEmail(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                              <UserIcon className="h-4 w-4 text-slate-400" />
                              Your Name
                            </label>
                            <input
                              value={name}
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                              placeholder="Enter your full name"
                              onChange={(e) => setName(e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-3 mt-auto">
                          <Button
                            className="flex-1 h-12 rounded-xl font-semibold text-base shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: interview.theme_color ?? "#4F46E5",
                              color: isLightColor(interview.theme_color ?? "#4F46E5")
                                ? "#1e293b"
                                : "white",
                            }}
                            disabled={
                              Loading ||
                              (!isValidEmail || !name || !videoStream)
                            }
                            onClick={startConversation}
                          >
                            {!Loading ? (
                              <>
                                <CheckCircleIcon className="h-5 w-5 mr-2" />
                                Start Interview
                              </>
                            ) : (
                              <MiniLoader />
                            )}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                className="h-12 px-8 rounded-xl border-2 border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all font-medium"
                                disabled={Loading}
                              >
                                Exit
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-2xl">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-xl">Exit Interview?</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-600">
                                  Are you sure you want to exit without starting the interview?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="gap-2">
                                <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-indigo-600 hover:bg-indigo-700 rounded-xl"
                                  onClick={async () => {
                                    await onEndCallClick();
                                  }}
                                >
                                  Yes, Exit
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isStarted && !isEnded && (
              <div className="flex-1 flex flex-col px-4 lg:px-8 py-4 lg:py-6">
                {/* Main Interview Container */}
                <div className="flex-1 bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-slate-200/60 overflow-hidden">
                  <div className="h-full grid grid-cols-1 lg:grid-cols-2">
                    {/* Left Panel - Interviewer */}
                    <div className="relative flex flex-col bg-gradient-to-br from-indigo-50/30 via-white to-slate-50/50 p-6 lg:p-8 border-b lg:border-b-0 lg:border-r border-slate-100">
                      {/* Section Label */}
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-indigo-100 shadow-sm">
                            <MicIcon className="h-4 w-4 text-indigo-600" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Interviewer</h3>
                            <p className="text-xs text-slate-500">AI Assistant</p>
                          </div>
                        </div>
                        {/* Speaking Indicator */}
                        {activeTurn === "agent" && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-full shadow-lg shadow-indigo-200 animate-pulse">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                            </span>
                            <span className="text-xs font-semibold">Speaking</span>
                          </div>
                        )}
                      </div>

                      {/* Interviewer Avatar Card */}
                      <div className="flex justify-center mb-6">
                        <div className={`relative p-1 rounded-full transition-all duration-300 ${
                          activeTurn === "agent"
                            ? "bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 shadow-xl shadow-indigo-200"
                            : "bg-slate-200"
                        }`}>
                          <div className="bg-white p-1.5 rounded-full">
                            {interviewerImg ? (
                              <Image
                                src={interviewerImg}
                                alt="Interviewer"
                                width={160}
                                height={160}
                                className="rounded-full object-cover w-28 h-28 sm:w-32 sm:h-32 lg:w-36 lg:h-36"
                              />
                            ) : (
                              <div className="w-28 h-28 sm:w-32 sm:h-32 lg:w-36 lg:h-36 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse flex items-center justify-center">
                                <UserIcon className="h-12 w-12 text-slate-400" />
                              </div>
                            )}
                          </div>
                          {/* Audio wave animation when speaking */}
                          {activeTurn === "agent" && (
                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                              <span className="w-1 h-3 bg-indigo-500 rounded-full animate-[pulse_0.5s_ease-in-out_infinite]"></span>
                              <span className="w-1 h-5 bg-indigo-500 rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.1s]"></span>
                              <span className="w-1 h-4 bg-indigo-500 rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.2s]"></span>
                              <span className="w-1 h-6 bg-indigo-500 rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.3s]"></span>
                              <span className="w-1 h-3 bg-indigo-500 rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.4s]"></span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Transcript Box */}
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Live Transcript</span>
                          <div className="flex-1 h-px bg-slate-200"></div>
                        </div>
                        <div className="flex-1 bg-slate-50/80 rounded-xl p-5 border border-slate-100 overflow-y-auto min-h-[140px] max-h-[220px] lg:max-h-[280px]">
                          <p className="text-base lg:text-lg text-slate-700 leading-relaxed">
                            {lastInterviewerResponse || (
                              <span className="text-slate-400 italic flex items-center gap-2">
                                <span className="flex gap-1">
                                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"></span>
                                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                                </span>
                                Waiting for interviewer...
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Right Panel - Candidate */}
                    <div className="relative flex flex-col bg-gradient-to-br from-emerald-50/20 via-white to-slate-50/50 p-6 lg:p-8">
                      {/* Section Label */}
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-emerald-100 shadow-sm">
                            <VideoIcon className="h-4 w-4 text-emerald-600" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">{name || "Candidate"}</h3>
                            <p className="text-xs text-slate-500">You</p>
                          </div>
                        </div>
                        {/* Your Turn Indicator */}
                        {activeTurn === "user" && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-full shadow-lg shadow-emerald-200 animate-pulse">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                            </span>
                            <span className="text-xs font-semibold">Your Turn</span>
                          </div>
                        )}
                      </div>

                      {/* Video Container */}
                      <div className="flex justify-center mb-6">
                        <div className={`relative p-1 rounded-2xl transition-all duration-300 ${
                          activeTurn === "user"
                            ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 shadow-xl shadow-emerald-200"
                            : "bg-slate-200"
                        }`}>
                          <div className="relative bg-slate-900 rounded-xl overflow-hidden">
                            <video
                              ref={interviewVideoRef}
                              className="w-full max-w-[320px] sm:max-w-[380px] lg:max-w-[420px] aspect-video object-cover"
                              style={{ background: "#0f172a", transform: "scaleX(-1)" }}
                              autoPlay
                              muted
                              playsInline
                            />

                            {/* Corner guides */}
                            <div className="absolute inset-0 pointer-events-none">
                              <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-white/40 rounded-tl-lg" />
                              <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-white/40 rounded-tr-lg" />
                              <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-white/40 rounded-bl-lg" />
                              <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-white/40 rounded-br-lg" />
                            </div>

                            {/* Recording indicator */}
                            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-red-500/90 backdrop-blur-sm rounded-md shadow-lg">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                              </span>
                              <span className="text-[10px] text-white font-bold tracking-wider">REC</span>
                            </div>

                            {/* Face Verification Status */}
                            {hasReferenceImage && (
                              <VerificationStatus
                                isVerifying={verificationLoading}
                                isMatch={verificationResult.lastChecked ? verificationResult.isMatch : null}
                                hasReference={hasReferenceImage}
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* User Response Box */}
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Your Response</span>
                          <div className="flex-1 h-px bg-slate-200"></div>
                        </div>
                        <div
                          ref={lastUserResponseRef}
                          className="flex-1 bg-slate-50/80 rounded-xl p-5 border border-slate-100 overflow-y-auto min-h-[140px] max-h-[220px] lg:max-h-[280px]"
                        >
                          <p className="text-base lg:text-lg text-slate-700 leading-relaxed">
                            {lastUserResponse || (
                              <span className="text-slate-400 italic">Your response will appear here as you speak...</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div className="mt-4 flex items-center justify-center">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="px-8 py-2.5 h-12 rounded-xl border-2 border-red-200 bg-white text-red-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition-all duration-200 font-semibold shadow-sm hover:shadow-md"
                        disabled={Loading}
                      >
                        <XCircleIcon className="h-5 w-5 mr-2" />
                        End Interview
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-2xl">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-xl">End Interview?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600">
                          This action cannot be undone. Are you sure you want to end the interview now?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700 rounded-xl"
                          onClick={async () => {
                            await onEndCallClick();
                          }}
                        >
                          Yes, End Interview
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}

            {isEnded && (
              <div className="flex-1 flex items-center justify-center px-4 py-8">
                <div className="w-full max-w-md bg-gradient-to-br from-white to-emerald-50/30 rounded-2xl shadow-lg border border-slate-200/60 overflow-hidden p-8 text-center">
                  {/* Success Icon */}
                  <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200">
                    <CheckCircleIcon className="h-8 w-8 text-white" />
                  </div>
                  
                  <h2 className="text-2xl font-semibold text-slate-800 mb-3">
                    {isStarted ? "Interview Complete!" : "Thank You!"}
                  </h2>
                  
                  <p className="text-slate-600 mb-4">
                    {isStarted
                      ? "Thank you for taking the time to participate in this interview. Your responses have been recorded."
                      : "Thank you for your consideration. We appreciate your time."}
                  </p>
                  
                  <p className="text-sm text-slate-500 mb-6">
                    You can safely close this tab now.
                  </p>

                  <div className="flex flex-col items-center gap-4">
                    {!isFeedbackSubmitted && isStarted && (
                      <AlertDialog
                        open={isDialogOpen}
                        onOpenChange={setIsDialogOpen}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white h-11 px-8 rounded-full shadow-md hover:shadow-lg transition-all"
                            onClick={() => setIsDialogOpen(true)}
                          >
                            Share Your Feedback
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-2xl">
                          <FeedbackForm
                            email={email}
                            onSubmit={handleFeedbackSubmit}
                          />
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    
                    {isFeedbackSubmitted && (
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium">
                        <CheckCircleIcon className="h-4 w-4" />
                        Feedback submitted
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
          </div>
        </Card>
        
        {/* Footer */}
        <div className="flex justify-center items-center mt-4 mb-2">
          <a
            className="group flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 backdrop-blur-sm border border-slate-200/60 hover:bg-white hover:border-slate-300 transition-all duration-200 shadow-sm"
            href="https://folo-up.co/"
            target="_blank">
            <span className="text-sm text-slate-600">
              Powered by{" "}
              <a
            className="font-bold underline"
            href="https://dynatechconsultancy.com/"
            target="_blank"
          >
           <span className="text-indigo-600">DynaTech Systems</span>

            
          </a>
            </span>
            <ArrowUpRightSquareIcon className="h-4 w-4 text-indigo-500 group-hover:text-indigo-600 transition-colors" />
          </a>

        </div>
      </div>
    </div>
  );
}

export default Call;
