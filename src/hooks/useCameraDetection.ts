'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface UseCameraDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  checkInterval?: number; // in milliseconds, default 5000 (5 seconds)
}

interface CameraStatus {
  isOn: boolean;
  lastChecked: Date | null;
  offCount: number;
  totalChecks: number;
}

export function useCameraDetection({
  videoRef,
  enabled,
  checkInterval = 5000,
}: UseCameraDetectionProps) {
  const [status, setStatus] = useState<CameraStatus>({
    isOn: true,
    lastChecked: null,
    offCount: 0,
    totalChecks: 0,
  });
  const [showWarning, setShowWarning] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const checkCameraStatus = useCallback(() => {
    if (!videoRef.current) {
      console.log('⚠️ Video element not available for camera check');

      return;
    }

    const video = videoRef.current;
    
    // Check if video stream is active
    if (!video.srcObject) {
      console.log('❌ Camera is OFF - No video stream');
      setStatus(prev => ({
        isOn: false,
        lastChecked: new Date(),
        offCount: prev.offCount + 1,
        totalChecks: prev.totalChecks + 1,
      }));
      setShowWarning(true);

      return;
    }

    // Check if video is playing and has actual video data
    // Note: readyState 2 = HAVE_CURRENT_DATA, but for mirrored/streamed video,
    // we should also check if video has dimensions (videoWidth/videoHeight > 0)
    const hasVideoDimensions = video.videoWidth > 0 && video.videoHeight > 0;

    if (video.paused && !hasVideoDimensions) {
      console.log('❌ Camera is OFF - Video paused and no dimensions');
      setStatus(prev => ({
        isOn: false,
        lastChecked: new Date(),
        offCount: prev.offCount + 1,
        totalChecks: prev.totalChecks + 1,
      }));
      setShowWarning(true);

      return;
    }

    // If video has no dimensions yet, wait for it to load
    if (!hasVideoDimensions) {
      console.log('⏳ Camera check skipped - Video not ready yet (no dimensions)');
      return;
    }

    // Check if video has actual pixel data (not black screen)
    // We already verified video has dimensions above, so we can proceed with pixel check
    try {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Sample a few pixels to check if video has actual content
        // Use smaller sample size and ensure we don't go out of bounds
        const sampleSize = Math.min(50, Math.floor(canvas.width / 4), Math.floor(canvas.height / 4));
        const imageData = context.getImageData(
          Math.floor(canvas.width / 2 - sampleSize / 2),
          Math.floor(canvas.height / 2 - sampleSize / 2),
          sampleSize,
          sampleSize
        );

        let totalBrightness = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          totalBrightness += (r + g + b) / 3;
        }

        const avgBrightness = totalBrightness / (imageData.data.length / 4);
        console.log('📊 Camera brightness check:', avgBrightness.toFixed(2));

        // If average brightness is too low (< 5), it might be a black screen
        // This threshold catches covered cameras but allows dark rooms
        if (avgBrightness < 5) {
          console.log('❌ Camera might be OFF - Very dark/black screen detected (brightness:', avgBrightness.toFixed(2), ')');
          setStatus(prev => ({
            isOn: false,
            lastChecked: new Date(),
            offCount: prev.offCount + 1,
            totalChecks: prev.totalChecks + 1,
          }));
          setShowWarning(true);

          return;
        }
      }
    } catch (error) {
      console.error('Error checking camera pixel data:', error);
      // Don't mark camera as off due to pixel check errors - just log and continue
    }

    // Camera is on
    console.log('✅ Camera is ON');
    setStatus(prev => ({
      isOn: true,
      lastChecked: new Date(),
      offCount: prev.offCount,
      totalChecks: prev.totalChecks + 1,
    }));
  }, [videoRef]);

  // Start/stop camera checking
  useEffect(() => {
    if (enabled && videoRef.current) {
      console.log('✅ Starting camera detection (every', checkInterval / 1000, 'seconds)');
      
      // Initial check after 2 seconds
      const initialTimeout = setTimeout(() => {
        checkCameraStatus();
      }, 2000);

      // Then check every interval
      intervalRef.current = setInterval(() => {
        checkCameraStatus();
      }, checkInterval);

      return () => {
        clearTimeout(initialTimeout);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [enabled, checkInterval, checkCameraStatus, videoRef]);

  // Auto-hide warning after 6 seconds
  useEffect(() => {
    if (showWarning) {
      const timeout = setTimeout(() => setShowWarning(false), 6000);

      return () => clearTimeout(timeout);
    }
  }, [showWarning]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    status,
    showWarning,
    dismissWarning: () => setShowWarning(false),
  };
}

