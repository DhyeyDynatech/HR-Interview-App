import Image from "next/image";
import { CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import ReactAudioPlayer from "react-audio-player";
import { Interviewer } from "@/types/interviewer";
import { useEffect, useState } from "react";
import axios from "axios";
import { Volume2, User, MessageSquare } from "lucide-react";

interface Props {
  interviewer: Interviewer | undefined;
}

interface VoiceInfo {
  agent_id: string | null;
  agent_name: string | null;
  begin_message: string | null;
  voice_id: string | null;
  voice_name: string | null;
  language: string | null;
  voice_preview_url: string | null;
  provider: string | null;
  gender: string | null;
  age: string | null;
}

function InterviewerDetailsModal({ interviewer }: Props) {
  const [voiceInfo, setVoiceInfo] = useState<VoiceInfo | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVoiceInfo = async () => {
      if (!interviewer?.agent_id) {
        return;
      }

      setVoiceLoading(true);
      setVoiceError(null);

      try {
        const response = await axios.get("/api/get-agent-voice", {
          params: {
            agent_id: interviewer.agent_id,
          },
        });

        if (response.data && response.status === 200) {
          setVoiceInfo({
            agent_id: response.data.agent_id,
            agent_name: response.data.agent_name,
            begin_message: response.data.begin_message,
            voice_id: response.data.voice_id,
            voice_name: response.data.voice_name,
            language: response.data.language,
            voice_preview_url: response.data.voice_preview_url,
            provider: response.data.provider,
            gender: response.data.gender,
            age: response.data.age,
          });
        }
      } catch (error) {
        console.error("Error fetching voice info:", error);
        setVoiceError("Could not load voice information from Retell");
      } finally {
        setVoiceLoading(false);
      }
    };

    fetchVoiceInfo();
  }, [interviewer?.agent_id]);

  const audioSource = voiceInfo?.voice_preview_url
    ? voiceInfo.voice_preview_url
    : interviewer?.audio
      ? `/audio/${interviewer.audio}`
      : null;

  const displayDescription = voiceInfo?.begin_message || interviewer?.description;

  return (
    <div className="w-[550px] max-w-[90vw]">
      {/* Header */}
      <div className="text-center pb-3 border-b border-gray-200">
        <CardTitle className="text-xl font-bold text-gray-800">
          {voiceInfo?.agent_name || interviewer?.name}
        </CardTitle>
      </div>

      <div className="mt-4">
        {/* Main Content */}
        <div className="flex gap-5">
          {/* Avatar Section */}
          <div className="flex-shrink-0">
            <div className="w-32 h-36 border-2 border-indigo-200 rounded-xl overflow-hidden shadow-sm bg-white">
              {interviewer?.image ? (
                <Image
                  src={interviewer.image}
                  alt="Picture of the interviewer"
                  width={128}
                  height={144}
                  className="w-full h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-100 to-indigo-50 flex items-center justify-center">
                  <User size={40} className="text-indigo-300" />
                </div>
              )}
            </div>
          </div>

          {/* Info Section */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {/* Description / Begin Message */}
            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg p-3 border border-indigo-100">
              <div className="flex items-start gap-2">
                <MessageSquare size={14} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-700 leading-relaxed italic line-clamp-3">
                  &ldquo;{displayDescription}&rdquo;
                </p>
              </div>
            </div>

            {/* Voice Info Card */}
            {voiceLoading ? (
              <div className="bg-gray-50 rounded-lg p-3 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            ) : voiceInfo ? (
              <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Volume2 size={14} className="text-indigo-600" />
                  <span className="text-xs font-semibold text-gray-800">Voice Details</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {voiceInfo.voice_name && (
                    <div>
                      <span className="text-gray-500">Voice:</span>{" "}
                      <span className="font-medium text-gray-800">
                        {voiceInfo.voice_name}
                        {voiceInfo.language && (
                          <span className="text-indigo-600 ml-1">({voiceInfo.language})</span>
                        )}
                      </span>
                    </div>
                  )}
                  {voiceInfo.provider && (
                    <div>
                      <span className="text-gray-500">Provider:</span>{" "}
                      <span className="font-medium text-gray-800 capitalize">{voiceInfo.provider}</span>
                    </div>
                  )}
                  {voiceInfo.gender && (
                    <div>
                      <span className="text-gray-500">Gender:</span>{" "}
                      <span className="font-medium text-gray-800 capitalize">{voiceInfo.gender}</span>
                    </div>
                  )}
                  {voiceInfo.age && (
                    <div>
                      <span className="text-gray-500">Age:</span>{" "}
                      <span className="font-medium text-gray-800 capitalize">{voiceInfo.age}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Audio Player */}
            {audioSource && (
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-200">
                <ReactAudioPlayer
                  src={audioSource}
                  controls
                  style={{ width: "100%", height: "32px" }}
                />
              </div>
            )}
            {!audioSource && !voiceLoading && (
              <div className="text-xs text-gray-400 text-center py-2">
                No voice preview available
              </div>
            )}
          </div>
        </div>

        {/* Settings Section */}
        <div className="mt-5 pt-4 border-t border-gray-200">
          <h3 className="text-xs font-semibold text-gray-700 mb-3 text-center">
            Interviewer Settings
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {/* Empathy */}
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs text-gray-600">Empathy</span>
              <div className="flex-1">
                <Slider
                  value={[(interviewer?.empathy || 10) / 10]}
                  max={1}
                  step={0.1}
                  className="cursor-default"
                />
              </div>
              <span className="w-8 text-xs font-medium text-indigo-600 text-right">
                {(interviewer?.empathy || 10) / 10}
              </span>
            </div>

            {/* Exploration */}
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs text-gray-600">Exploration</span>
              <div className="flex-1">
                <Slider
                  value={[(interviewer?.exploration || 10) / 10]}
                  max={1}
                  step={0.1}
                  className="cursor-default"
                />
              </div>
              <span className="w-8 text-xs font-medium text-indigo-600 text-right">
                {(interviewer?.exploration || 10) / 10}
              </span>
            </div>

            {/* Rapport */}
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs text-gray-600">Rapport</span>
              <div className="flex-1">
                <Slider
                  value={[(interviewer?.rapport || 10) / 10]}
                  max={1}
                  step={0.1}
                  className="cursor-default"
                />
              </div>
              <span className="w-8 text-xs font-medium text-indigo-600 text-right">
                {(interviewer?.rapport || 10) / 10}
              </span>
            </div>

            {/* Speed */}
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs text-gray-600">Speed</span>
              <div className="flex-1">
                <Slider
                  value={[(interviewer?.speed || 10) / 10]}
                  max={1}
                  step={0.1}
                  className="cursor-default"
                />
              </div>
              <span className="w-8 text-xs font-medium text-indigo-600 text-right">
                {(interviewer?.speed || 10) / 10}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InterviewerDetailsModal;
