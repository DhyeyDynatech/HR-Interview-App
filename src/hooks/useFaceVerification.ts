'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface UseFaceVerificationProps {
  referenceImageUrl: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  checkInterval?: number; // in milliseconds, default 15000 (15 seconds)
  matchThreshold?: number; // 0-1, lower = stricter, default 0.6
}

interface VerificationResult {
  isMatch: boolean;
  confidence: number;
  lastChecked: Date | null;
  error: string | null;
  faceDetected: boolean;
}

let faceapiPromise: Promise<typeof import('face-api.js')> | null = null;
function getFaceApi() {
  if (!faceapiPromise) {
    faceapiPromise = import('face-api.js');
  }
  return faceapiPromise;
}

export function useFaceVerification({
  referenceImageUrl,
  videoRef,
  enabled,
  checkInterval = 15000,
  matchThreshold = 0.6,
}: UseFaceVerificationProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [referenceLoaded, setReferenceLoaded] = useState(false);
  const [result, setResult] = useState<VerificationResult>({
    isMatch: true,
    confidence: 0,
    lastChecked: null,
    error: null,
    faceDetected: false,
  });
  const [mismatchCount, setMismatchCount] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);

  const referenceDescriptorRef = useRef<Float32Array | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isVerifyingRef = useRef(false);
  const faceapiRef = useRef<typeof import('face-api.js') | null>(null);

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        console.log('🔄 Loading face-api models...');
        const faceapi = await getFaceApi();
        faceapiRef.current = faceapi;
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);
        console.log('✅ Face-api models loaded successfully');
        setModelsLoaded(true);
        setIsLoading(false);
      } catch (error) {
        console.error('❌ Error loading face-api models:', error);
        setResult(prev => ({ ...prev, error: 'Failed to load face recognition models' }));
        setIsLoading(false);
      }
    };
    loadModels();
  }, []);

  // Load reference image and extract face descriptor
  useEffect(() => {
    const loadReferenceImage = async () => {
      if (!referenceImageUrl || !modelsLoaded) {
        console.log('⏳ Waiting for reference image or models...', { referenceImageUrl: !!referenceImageUrl, modelsLoaded });

        return;
      }

      try {
        const faceapi = faceapiRef.current!;
        console.log('🔄 Loading reference image:', referenceImageUrl);
        const img = await faceapi.fetchImage(referenceImageUrl);
        console.log('📸 Reference image fetched, detecting face...');

        const detection = await faceapi
          .detectSingleFace(img)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          referenceDescriptorRef.current = detection.descriptor;
          setReferenceLoaded(true);
          console.log('✅ Reference face descriptor extracted successfully');
        } else {
          console.warn('⚠️ No face detected in reference image');
          setResult(prev => ({ ...prev, error: 'No face detected in reference image' }));
        }
      } catch (error) {
        console.error('❌ Error loading reference image:', error);
        setResult(prev => ({ ...prev, error: 'Failed to load reference image' }));
      }
    };
    loadReferenceImage();
  }, [referenceImageUrl, modelsLoaded]);

  // Verify face from video stream
  const verifyFace = useCallback(async () => {
    console.log('🔍 Attempting face verification...', {
      hasVideoRef: !!videoRef.current,
      hasReferenceDescriptor: !!referenceDescriptorRef.current,
      modelsLoaded,
      isVerifying: isVerifyingRef.current
    });

    if (!videoRef.current) {
      console.log('⚠️ Video element not available');

      return;
    }

    if (!referenceDescriptorRef.current) {
      console.log('⚠️ Reference descriptor not available');

      return;
    }

    if (!modelsLoaded || !faceapiRef.current) {
      console.log('⚠️ Models not loaded');

      return;
    }

    if (isVerifyingRef.current) {
      console.log('⚠️ Already verifying');

      return;
    }

    isVerifyingRef.current = true;
    const faceapi = faceapiRef.current;

    try {
      // Increment total attempts for every verification attempt
      setTotalAttempts(prev => prev + 1);

      console.log('🔄 Detecting face in video...');
      const detection = await faceapi
        .detectSingleFace(videoRef.current)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        console.log('⚠️ No face detected in video');
        setResult({
          isMatch: false,
          confidence: 0,
          lastChecked: new Date(),
          error: 'No face detected in video',
          faceDetected: false,
        });
        setMismatchCount(prev => prev + 1);
        isVerifyingRef.current = false;

        return;
      }

      // Calculate Euclidean distance between face descriptors
      const distance = faceapi.euclideanDistance(
        referenceDescriptorRef.current,
        detection.descriptor
      );

      // Lower distance = better match (0 = perfect match)
      const isMatch = distance < matchThreshold;
      const confidence = Math.max(0, Math.min(1, 1 - distance));

      console.log(`✅ Face verification result: distance=${distance.toFixed(3)}, isMatch=${isMatch}, confidence=${(confidence * 100).toFixed(1)}%`);

      setResult({
        isMatch,
        confidence,
        lastChecked: new Date(),
        error: null,
        faceDetected: true,
      });

      if (!isMatch) {
        setMismatchCount(prev => prev + 1);
      }
    } catch (error) {
      console.error('❌ Error verifying face:', error);
      setResult(prev => ({
        ...prev,
        error: 'Error during face verification',
        lastChecked: new Date(),
      }));
    } finally {
      isVerifyingRef.current = false;
    }
  }, [videoRef, modelsLoaded, matchThreshold]);

  // Start/stop verification interval
  useEffect(() => {
    console.log('🔄 Checking if should start verification...', {
      enabled,
      modelsLoaded,
      referenceLoaded,
      hasVideoRef: !!videoRef.current
    });

    if (enabled && modelsLoaded && referenceLoaded && videoRef.current) {
      console.log('✅ Starting face verification interval (every', checkInterval / 1000, 'seconds)');

      // Initial check after 3 seconds
      const initialTimeout = setTimeout(() => {
        console.log('🔍 Running initial face verification...');
        verifyFace();
      }, 3000);

      // Then check every interval
      intervalRef.current = setInterval(() => {
        console.log('🔍 Running scheduled face verification...');
        verifyFace();
      }, checkInterval);


      return () => {
        console.log('🛑 Stopping face verification interval');
        clearTimeout(initialTimeout);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else {
      console.log('⏳ Not starting verification yet - conditions not met');
    }
  }, [enabled, modelsLoaded, referenceLoaded, checkInterval, verifyFace, videoRef]);

  // Cleanup on unmount
  useEffect(() => {

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);


  return {
    isLoading,
    modelsLoaded,
    result,
    mismatchCount,
    totalAttempts,
    verifyNow: verifyFace,
    hasReferenceImage: referenceLoaded,
  };
}
