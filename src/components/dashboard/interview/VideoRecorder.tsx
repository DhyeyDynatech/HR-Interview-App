import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";

interface VideoRecorderProps {
  interviewId: string;
  username: string;
  onSave?: (videoBlob: Blob, filename: string) => void;
  isRecording?: boolean; // New prop to control when recording starts
}

export interface VideoRecorderHandle {
  videoElement: HTMLVideoElement | null;
  getVideoRef: () => React.RefObject<HTMLVideoElement>;
  getStream: () => MediaStream | null;
  startRecording: () => void;
  stopRecording: () => void;
  isRecording: boolean;
}

const VideoRecorder = forwardRef<VideoRecorderHandle, VideoRecorderProps>(({
  interviewId,
  username,
  onSave,
  isRecording: shouldRecord = true, // Default to true for backward compatibility
}, ref) => {
  const [recording, setRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Start recording function
  const startRecording = () => {
    if (streamRef.current && !mediaRecorderRef.current) {
      try {
        chunksRef.current = [];
        const mediaRecorder = new MediaRecorder(streamRef.current);
        mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          const filename = `${interviewId}_${username}.webm`;
          if (onSave) {
            onSave(blob, filename);
          }
        };
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start();
        setRecording(true);
        console.log('Recording started');
      } catch (error) {
        console.error("Error starting recording:", error);
      }
    }
  };

  // Stop recording function
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
      console.log('Recording stopped');
    }
  };

  // Expose video element and controls to parent component
  useImperativeHandle(ref, () => ({
    videoElement: videoRef.current,
    getVideoRef: () => videoRef,
    getStream: () => streamRef.current,
    startRecording,
    stopRecording,
    isRecording: recording,
  }));

  // Start camera on mount (always)
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraReady(true);
        console.log('Camera started');
      } catch (error) {
        console.error("Error starting camera:", error);
      }
    };

    startCamera();

    // Cleanup: stop camera when component unmounts
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Handle recording based on shouldRecord prop
  useEffect(() => {
    if (cameraReady && shouldRecord && !recording) {
      startRecording();
    }
    // Note: We don't stop recording when shouldRecord becomes false
    // because we want to keep recording until component unmounts
  }, [cameraReady, shouldRecord]);


  return (
    <div className="relative">
      <video
        ref={videoRef}
        className="w-64 h-48 sm:w-80 sm:h-60 lg:w-96 lg:h-72 xl:w-[28rem] xl:h-[21rem] object-cover rounded-lg"
        style={{ background: "#1a1a2e", transform: "scaleX(-1)" }}
        autoPlay
        muted
        playsInline
      />
      {recording && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-[10px] text-white font-medium bg-black/50 px-1.5 py-0.5 rounded">REC</span>
        </div>
      )}
    </div>
  );
});

VideoRecorder.displayName = 'VideoRecorder';

export default VideoRecorder;
