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
  // Static-frame detection: stores the pixel data from the previous check
  // so we can compare consecutive frames. A real camera always has sensor
  // noise / micro-movement; a hardware-shutter placeholder is perfectly static.
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const staticCountRef = useRef(0);
  // Two back-to-back static frames (≥10 s with default interval) before flagging.
  const STATIC_FRAME_THRESHOLD = 2;

  const markCameraOff = useCallback(() => {
    setStatus(prev => ({
      isOn: false,
      lastChecked: new Date(),
      offCount: prev.offCount + 1,
      totalChecks: prev.totalChecks + 1,
    }));
    setShowWarning(true);
  }, []);

  const markCameraOn = useCallback(() => {
    setStatus(prev => ({
      isOn: true,
      lastChecked: new Date(),
      offCount: prev.offCount,
      totalChecks: prev.totalChecks + 1,
    }));
  }, []);

  const checkCameraStatus = useCallback(() => {
    if (!videoRef.current) {
      console.log('⚠️ Video element not available for camera check');

      return;
    }

    const video = videoRef.current;

    // 1. No stream attached at all
    if (!video.srcObject) {
      console.log('❌ Camera is OFF - No video stream');
      markCameraOff();

      return;
    }

    const stream = video.srcObject as MediaStream;
    const videoTrack = stream.getVideoTracks()[0];

    // 2. Track ended (OS-level camera kill switch / device unplugged)
    if (videoTrack && videoTrack.readyState === 'ended') {
      console.log('❌ Camera is OFF - Track ended (OS killed the stream)');
      markCameraOff();

      return;
    }

    // 3. Track muted — browser/OS signals hardware shutter is blocking the lens
    if (videoTrack && videoTrack.muted) {
      console.log('❌ Camera is OFF - Hardware shutter detected (track.muted)');
      markCameraOff();

      return;
    }

    // 4. No video dimensions yet — wait for the element to be ready
    const hasVideoDimensions = video.videoWidth > 0 && video.videoHeight > 0;

    if (video.paused && !hasVideoDimensions) {
      console.log('❌ Camera is OFF - Video paused and no dimensions');
      markCameraOff();

      return;
    }

    if (!hasVideoDimensions) {
      console.log('⏳ Camera check skipped - Video not ready yet (no dimensions)');

      return;
    }

    // 5. Pixel analysis — catches both black frames AND gray/colored shutter
    //    placeholders that some cameras/browsers render instead of pure black.
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

        const sampleSize = Math.min(50, Math.floor(canvas.width / 4), Math.floor(canvas.height / 4));
        const imageData = context.getImageData(
          Math.floor(canvas.width / 2 - sampleSize / 2),
          Math.floor(canvas.height / 2 - sampleSize / 2),
          sampleSize,
          sampleSize,
        );

        // 5a. Near-black frame (brightness < 5)
        let totalBrightness = 0;
        const pixelCount = imageData.data.length / 4;
        for (let i = 0; i < imageData.data.length; i += 4) {
          totalBrightness += (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
        }
        const avgBrightness = totalBrightness / pixelCount;
        console.log('📊 Camera brightness:', avgBrightness.toFixed(2));

        if (avgBrightness < 5) {
          console.log('❌ Camera OFF - Near-black frame (brightness:', avgBrightness.toFixed(2), ')');
          prevFrameRef.current = null;
          staticCountRef.current = 0;
          markCameraOff();

          return;
        }

        // 5b. Static-frame detection — catches gray/colored shutter placeholders.
        // A physical-shutter overlay is a perfectly static digital image; a real
        // camera feed always has at least 1 LSB of sensor noise per channel.
        // avgDiff < 1.0 across the sample area is only possible for a static
        // digital image — not a real live feed, even in a completely dark room.
        const currentFrame = new Uint8ClampedArray(imageData.data);
        if (prevFrameRef.current && prevFrameRef.current.length === currentFrame.length) {
          let totalDiff = 0;
          for (let i = 0; i < currentFrame.length; i += 4) {
            totalDiff +=
              Math.abs(currentFrame[i]     - prevFrameRef.current[i])     +
              Math.abs(currentFrame[i + 1] - prevFrameRef.current[i + 1]) +
              Math.abs(currentFrame[i + 2] - prevFrameRef.current[i + 2]);
          }
          const avgDiff = totalDiff / (pixelCount * 3);
          console.log('📊 Camera frame diff:', avgDiff.toFixed(3));

          if (avgDiff < 1.0) {
            staticCountRef.current++;
            console.log(`📊 Static frame count: ${staticCountRef.current}/${STATIC_FRAME_THRESHOLD}`);
            if (staticCountRef.current >= STATIC_FRAME_THRESHOLD) {
              console.log('❌ Camera OFF - Static placeholder frame detected (shutter closed)');
              prevFrameRef.current = currentFrame;
              markCameraOff();

              return;
            }
          } else {
            staticCountRef.current = 0;
          }
        }
        prevFrameRef.current = currentFrame;
      }
    } catch (error) {
      console.error('Error checking camera pixel data:', error);
      // Don't mark camera as off due to pixel check errors
    }

    // Camera is confirmed on
    console.log('✅ Camera is ON');
    markCameraOn();
  }, [videoRef, markCameraOff, markCameraOn]);

  // Start/stop camera checking
  useEffect(() => {
    if (enabled && videoRef.current) {
      console.log('✅ Starting camera detection (every', checkInterval / 1000, 'seconds)');

      // Reset static-frame counter each time detection (re)starts
      prevFrameRef.current = null;
      staticCountRef.current = 0;

      // Listen for hardware shutter events on the video track.
      // "mute" fires instantly when the OS/hardware blocks the camera;
      // "unmute" fires when it is unblocked.
      const stream = videoRef.current.srcObject as MediaStream | null;
      const videoTrack = stream?.getVideoTracks()[0];
      const onTrackMuted = () => {
        console.log('❌ Camera track muted (hardware shutter closed)');
        markCameraOff();
      };
      const onTrackUnmuted = () => {
        console.log('✅ Camera track unmuted (hardware shutter opened)');
        prevFrameRef.current = null;
        staticCountRef.current = 0;
        setStatus(prev => ({
          isOn: true,
          lastChecked: new Date(),
          offCount: prev.offCount,
          totalChecks: prev.totalChecks + 1,
        }));
        setShowWarning(false);
      };
      if (videoTrack) {
        videoTrack.addEventListener('mute', onTrackMuted);
        videoTrack.addEventListener('unmute', onTrackUnmuted);
      }

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
        if (videoTrack) {
          videoTrack.removeEventListener('mute', onTrackMuted);
          videoTrack.removeEventListener('unmute', onTrackUnmuted);
        }
      };
    }
  }, [enabled, checkInterval, checkCameraStatus, videoRef, markCameraOff]);

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
