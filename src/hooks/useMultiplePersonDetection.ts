'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface UseMultiplePersonDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  modelsLoaded: boolean;
  checkInterval?: number; // in milliseconds, default 10000 (10 seconds)
  minConfidence?: number; // minimum confidence for face detection, default 0.5
}

interface DetectionStatus {
  faceCount: number;
  lastChecked: Date | null;
  multiplePersonCount: number;
  isAlone: boolean;
  totalChecks: number;
}

let faceapiPromise: Promise<typeof import('face-api.js')> | null = null;
function getFaceApi() {
  if (!faceapiPromise) {
    faceapiPromise = import('face-api.js');
  }
  return faceapiPromise;
}

export function useMultiplePersonDetection({
  videoRef,
  enabled,
  modelsLoaded,
  checkInterval = 10000,
  minConfidence = 0.5,
}: UseMultiplePersonDetectionProps) {
  const [status, setStatus] = useState<DetectionStatus>({
    faceCount: 0,
    lastChecked: null,
    multiplePersonCount: 0,
    isAlone: true,
    totalChecks: 0,
  });
  const [showWarning, setShowWarning] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isDetectingRef = useRef(false);
  const faceapiRef = useRef<typeof import('face-api.js') | null>(null);

  // Load face-api dynamically when models are loaded
  useEffect(() => {
    if (modelsLoaded) {
      getFaceApi().then(mod => { faceapiRef.current = mod; });
    }
  }, [modelsLoaded]);

  const detectPeople = useCallback(async () => {
    if (!videoRef.current) {
      console.log('⚠️ Video element not available for people detection');

      return;
    }

    if (!modelsLoaded || !faceapiRef.current) {
      console.log('⚠️ Face detection models not loaded');

      return;
    }

    if (isDetectingRef.current) {
      console.log('⚠️ Already detecting people');

      return;
    }

    isDetectingRef.current = true;
    const faceapi = faceapiRef.current;

    try {
      console.log('🔍 Detecting multiple people in video...');

      // Detect all faces in the video
      const detections = await faceapi
        .detectAllFaces(
          videoRef.current,
          new faceapi.SsdMobilenetv1Options({ minConfidence })
        );

      const faceCount = detections.length;
      console.log(`👥 Detected ${faceCount} person(s)`);

      const isMultiplePeople = faceCount > 1;

      setStatus(prev => ({
        faceCount,
        lastChecked: new Date(),
        multiplePersonCount: isMultiplePeople
          ? prev.multiplePersonCount + 1
          : prev.multiplePersonCount,
        isAlone: !isMultiplePeople,
        totalChecks: prev.totalChecks + 1,
      }));

      if (isMultiplePeople) {
        setShowWarning(true);
      }
    } catch (error) {
      console.error('❌ Error detecting multiple people:', error);
    } finally {
      isDetectingRef.current = false;
    }
  }, [videoRef, modelsLoaded, minConfidence]);

  // Start/stop detection interval
  useEffect(() => {
    if (enabled && modelsLoaded && videoRef.current) {
      console.log('✅ Starting multiple person detection (every', checkInterval / 1000, 'seconds)');

      // Initial check after 5 seconds
      const initialTimeout = setTimeout(() => {
        detectPeople();
      }, 5000);

      // Then check every interval
      intervalRef.current = setInterval(() => {
        detectPeople();
      }, checkInterval);

      return () => {
        clearTimeout(initialTimeout);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [enabled, modelsLoaded, checkInterval, detectPeople, videoRef]);

  // Auto-hide warning after 8 seconds
  useEffect(() => {
    if (showWarning) {
      const timeout = setTimeout(() => setShowWarning(false), 8000);

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
