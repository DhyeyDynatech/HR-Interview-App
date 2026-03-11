'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, ShieldAlert, Eye } from 'lucide-react';

interface FaceMismatchWarningProps {
  isVisible: boolean;
  confidence: number;
  mismatchCount: number;
  faceDetected: boolean;
  error: string | null;
  onDismiss: () => void;
}

export function FaceMismatchWarning({
  isVisible,
  confidence,
  mismatchCount,
  faceDetected,
  error,
  onDismiss,
}: FaceMismatchWarningProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setIsAnimating(true);
    }
  }, [isVisible]);

  if (!isVisible) {
  return null;
}

  // Determine warning severity
  const isSevere = mismatchCount >= 3;
  const isNoFace = !faceDetected;


  return (
    <div 
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        isAnimating ? 'animate-in slide-in-from-top fade-in' : ''
      }`}
    >
      <div 
        className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-sm ${
          isSevere 
            ? 'bg-gradient-to-r from-red-600 to-red-700 border-red-400 shadow-red-500/40' 
            : isNoFace
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 border-amber-400 shadow-amber-500/40'
            : 'bg-gradient-to-r from-red-500 to-red-600 border-red-400 shadow-red-500/30'
        } text-white`}
      >
        {/* Icon */}
        <div className={`p-2.5 rounded-xl ${
          isSevere ? 'bg-white/20' : 'bg-white/15'
        }`}>
          {isNoFace ? (
            <Eye className="h-5 w-5" />
          ) : isSevere ? (
            <ShieldAlert className="h-5 w-5" />
          ) : (
            <AlertTriangle className="h-5 w-5" />
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col">
          <span className="font-semibold text-sm">
            {isNoFace 
              ? 'Face Not Detected' 
              : isSevere 
              ? 'Identity Verification Failed' 
              : 'Face Mismatch Detected'
            }
          </span>
          <span className="text-xs text-white/80">
            {isNoFace 
              ? 'Please ensure your face is visible in the camera'
              : `Your face doesn't match the registered profile (${Math.round(confidence * 100)}% match)`
            }
          </span>
          {mismatchCount > 1 && (
            <span className="text-[10px] text-white/60 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
              Warning #{mismatchCount}
              {isSevere && ' - This may be reported'}
            </span>
          )}
        </div>

        {/* Dismiss Button */}
        <button
          onClick={onDismiss}
          className="ml-2 p-1.5 hover:bg-white/20 rounded-full transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// Verification Status Indicator Component
interface VerificationStatusProps {
  isVerifying: boolean;
  isMatch: boolean | null;
  hasReference: boolean;
}

export function VerificationStatus({ isVerifying, isMatch, hasReference }: VerificationStatusProps) {
  if (!hasReference) {
  return null;
}


  return (
    <div className="absolute top-2 left-2 z-10">
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium ${
        isVerifying 
          ? 'bg-blue-500/80 text-white'
          : isMatch === null
          ? 'bg-gray-500/80 text-white'
          : isMatch
          ? 'bg-emerald-500/80 text-white'
          : 'bg-red-500/80 text-white'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${
          isVerifying ? 'bg-white animate-pulse' : 'bg-white'
        }`} />
        {isVerifying 
          ? 'Verifying...' 
          : isMatch === null 
          ? 'Pending' 
          : isMatch 
          ? 'Verified' 
          : 'Mismatch'
        }
      </div>
    </div>
  );
}

