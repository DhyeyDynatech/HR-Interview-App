import React from 'react';
import {
  AlertTriangleIcon,
  CameraOffIcon,
  UsersIcon,
  UserXIcon,
  MonitorIcon,
  XIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ViolationWarningProps {
  type: 'camera' | 'multiple-person' | 'face-mismatch' | 'tab-switch';
  onDismiss?: () => void;
  autoHide?: boolean;
}

interface CameraOffCountdownAlertProps {
  countdown: number;
  onDismiss?: () => void;
}

const warningConfig = {
  camera: {
    icon: CameraOffIcon,
    title: 'Camera Issue Detected',
    message: 'Your camera appears to be off or not working properly. Please ensure your camera is on and working.',
    bgColor: 'bg-gradient-to-r from-red-500 to-orange-500',
    iconColor: 'text-white',
  },
  'multiple-person': {
    icon: UsersIcon,
    title: 'Multiple People Detected',
    message: 'We detected multiple people in your video. Please ensure you are in a private, quiet space alone.',
    bgColor: 'bg-gradient-to-r from-orange-500 to-yellow-500',
    iconColor: 'text-white',
  },
  'face-mismatch': {
    icon: UserXIcon,
    title: 'Face Verification Failed',
    message: 'Your face does not match the profile photo. Please ensure you are the registered candidate and your face is clearly visible.',
    bgColor: 'bg-gradient-to-r from-purple-500 to-pink-500',
    iconColor: 'text-white',
  },
  'tab-switch': {
    icon: MonitorIcon,
    title: 'Tab Switch Detected',
    message: 'Switching tabs during the interview is tracked and may affect your evaluation.',
    bgColor: 'bg-gradient-to-r from-blue-500 to-indigo-500',
    iconColor: 'text-white',
  },
};

export function ViolationWarning({ type, onDismiss, autoHide = true }: ViolationWarningProps) {
  const config = warningConfig[type];

  // Define highlighted phrases for each type
  const highlightPhrases: Record<string, string[]> = {
    camera: ['camera', 'off', 'not working'],
    'face-mismatch': ['face', 'does not match', 'profile photo'],
    'multiple-person': ['multiple people', 'private'],
    'tab-switch': ['Switching tabs', 'tracked'],
  };

  const phrases = highlightPhrases[type] || [];
  const message = config.message;

  // Split message and highlight key phrases
  const renderMessage = () => {
    const result = message;

    // Create a combined regex for all phrases
    const combinedRegex = new RegExp(`(${phrases.join('|')})`, 'gi');
    const matches: Array<{ text: string; isHighlight: boolean; index: number }> = [];
    let lastIndex = 0;

    let match;
    while ((match = combinedRegex.exec(result)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        matches.push({
          text: result.substring(lastIndex, match.index),
          isHighlight: false,
          index: lastIndex,
        });
      }
      // Add highlighted match
      matches.push({
        text: match[0],
        isHighlight: true,
        index: match.index,
      });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < result.length) {
      matches.push({
        text: result.substring(lastIndex),
        isHighlight: false,
        index: lastIndex,
      });
    }

    return matches.length > 0
      ? matches.map((item) =>
          item.isHighlight ? (
            <span key={`highlight-${item.index}`} className="text-red-600">
              {item.text}
            </span>
          ) : (
            <React.Fragment key={`text-${item.index}`}>{item.text}</React.Fragment>
          )
        )
      : message;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="fixed top-4 right-4 z-50 w-full max-w-md"
    >
      <div className="bg-white rounded-lg shadow-lg p-4 border border-gray-200 relative">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 font-bold leading-relaxed mb-2">
              {renderMessage()}
            </p>
          </div>
          {onDismiss && (
            <button
              className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Dismiss warning"
              onClick={onDismiss}
            >
              <XIcon className="h-5 w-5 text-gray-600" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

interface ViolationTrackerProps {
  tabSwitchCount: number;
  faceMismatchCount: number;
  cameraOffCount: number;
  multiplePersonCount: number;
}

export function CameraOffCountdownAlert({ countdown, onDismiss }: CameraOffCountdownAlertProps) {
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="fixed top-4 right-4 z-50 w-full max-w-md"
    >
      <div className="bg-white rounded-lg shadow-lg p-4 border border-gray-200 relative">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 font-bold leading-relaxed mb-2">
              Please turn on your <span className="text-red-600">camera</span> to start the interview.
            </p>
            <p className="text-sm text-gray-900 font-bold leading-relaxed flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-black flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs font-bold">!</span>
              </span>
              <span>The interview cannot begin without <span className="text-red-600">camera access</span>. If your camera remains off for <span className="text-red-600">{formattedTime}</span>, your interview will be automatically ended.</span>
            </p>
          </div>
          {onDismiss && (
            <button
              className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Dismiss warning"
              onClick={onDismiss}
            >
              <XIcon className="h-5 w-5 text-gray-600" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function ViolationTracker({
  tabSwitchCount,
  faceMismatchCount,
  cameraOffCount,
  multiplePersonCount,
}: ViolationTrackerProps) {
  const totalViolations = tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount;

  if (totalViolations === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-200 p-4 min-w-[280px]"
      >
        <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2 text-sm">
          <AlertTriangleIcon className="h-4 w-4 text-orange-500" />
          <span><span className="text-red-600">Violations</span> Detected</span>
        </h4>
        <div className="space-y-2">
          {tabSwitchCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 flex items-center gap-2">
                <MonitorIcon className="h-3.5 w-3.5 text-blue-500" />
                Tab Switches
              </span>
              <span className="font-semibold text-blue-600">{tabSwitchCount}</span>
            </div>
          )}
          {faceMismatchCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 flex items-center gap-2">
                <UserXIcon className="h-3.5 w-3.5 text-purple-500" />
                Face Mismatches
              </span>
              <span className="font-semibold text-purple-600">{faceMismatchCount}</span>
            </div>
          )}
          {cameraOffCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 flex items-center gap-2">
                <CameraOffIcon className="h-3.5 w-3.5 text-red-500" />
                Camera Issues
              </span>
              <span className="font-semibold text-red-600">{cameraOffCount}</span>
            </div>
          )}
          {multiplePersonCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 flex items-center gap-2">
                <UsersIcon className="h-3.5 w-3.5 text-orange-500" />
                Multiple People
              </span>
              <span className="font-semibold text-orange-600">{multiplePersonCount}</span>
            </div>
          )}
          <div className="pt-2 mt-2 border-t border-slate-200">
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="text-slate-900">Total Violations</span>
              <span className={`${totalViolations > 5 ? 'text-red-600' : 'text-orange-600'}`}>
                {totalViolations}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

