"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Trash2,
  Eye,
  User,
  Briefcase,
  BarChart3,
  Shield,
  Loader2,
} from "lucide-react";
import { ATSScoreResult } from "@/types/ats-scoring";
import { ResumeViewer } from "@/components/dashboard/user/ResumeViewer";

interface ATSResultCardProps {
  result: ATSScoreResult;
  rank: number;
  onDelete?: (resumeName: string) => void;
  previewUrl?: string;
  isUploading?: boolean;
}

/** Normalize legacy 0-100 scores to 0-10 scale */
export function normalizeScore(score: number): number {
  if (score > 10) return Math.round((score / 10) * 10) / 10;
  return score;
}

function getScoreColor(score: number) {
  const s = normalizeScore(score);
  if (s >= 7) return "text-green-600";
  if (s >= 4) return "text-yellow-600";
  return "text-red-600";
}

function getScoreBg(score: number) {
  const s = normalizeScore(score);
  if (s >= 7) return "bg-green-100 text-green-700 border-green-200";
  if (s >= 4) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function getProgressBarColor(score: number) {
  const s = normalizeScore(score);
  if (s >= 7) return "bg-green-500";
  if (s >= 4) return "bg-yellow-500";
  return "bg-red-500";
}

export function getScoreLabel(score: number) {
  const s = normalizeScore(score);
  if (s >= 8) return "Excellent";
  if (s >= 7) return "Strong";
  if (s >= 5.5) return "Good";
  if (s >= 4) return "Fair";
  return "Weak";
}

function getRatingColor(rating: string) {
  const r = rating.toLowerCase();
  if (r === "strong" || r === "high" || r === "stable") return "bg-green-100 text-green-700 border-green-200";
  if (r === "moderate" || r === "medium" || r === "partial" || r === "moderate risk") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function hasDetailedAnalysis(result: ATSScoreResult): boolean {
  return !!(result.candidateProfile || result.swotAnalysis || result.experienceDepthAnalysis || result.jdUnderstanding);
}

export default function ATSResultCard({ result, rank, onDelete, previewUrl, isUploading }: ATSResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const categoryKeys = ["skills", "experience", "education"] as const;
  const categoryLabels: Record<string, string> = {
    skills: "Skills",
    experience: "Experience",
    education: "Education",
  };

  const overallNorm = normalizeScore(result.overallScore);
  const detailed = hasDetailedAnalysis(result);

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      {/* Collapsed Header */}
      <CardHeader
        className="cursor-pointer py-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-slate-100 text-sm font-bold text-slate-600">
              #{rank}
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              <span className="font-medium text-sm">{result.resumeName}</span>
              {result.scoredAt && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Calendar className="h-3 w-3" />
                  {new Date(result.scoredAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
              {(result.resumeUrl || previewUrl) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowResume(true);
                  }}
                >
                  <Eye className="h-3 w-3" />
                  View Resume
                </Button>
              ) : isUploading ? (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading...
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              className={`text-base font-bold px-3 py-1 border ${getScoreBg(result.overallScore)}`}
            >
              {overallNorm}/10
            </Badge>
            <span className={`text-xs font-medium ${getScoreColor(result.overallScore)}`}>
              {getScoreLabel(result.overallScore)}
            </span>
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(result.resumeName);
                }}
                title="Delete result"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        {!expanded && (
          <p className="text-sm text-slate-500 mt-2 ml-12">
            {result.summary}
          </p>
        )}
      </CardHeader>

      {/* Expanded Content */}
      {expanded && (
        <CardContent className="pt-0 pb-6">
          {/* Summary */}
          <p className="text-sm text-slate-600 mb-6 ml-12">{result.summary}</p>

          {/* Category Scores with Expandable Reasons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 items-start">
            {categoryKeys.map((key) => {
              const rawScore = result.categoryScores[key];
              const normScore = normalizeScore(rawScore);
              const detail = result.categoryDetails?.[key];
              const reasons = detail?.reasons || [];
              const isExpanded = expandedCategories.has(key);
              const isExperience = key === "experience";
              const expMatch = result.experienceMatch;

              return (
                <div key={key} className="rounded-lg bg-slate-50 border overflow-hidden">
                  <div
                    className={`p-3 ${reasons.length > 0 ? "cursor-pointer" : ""}`}
                    onClick={() => reasons.length > 0 && toggleCategory(key)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">
                        {categoryLabels[key]}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isExperience && expMatch !== undefined ? (
                          expMatch ? (
                            <span className="flex items-center gap-1 text-sm font-bold text-green-600">
                              <CheckCircle2 className="h-4 w-4" />
                              Matches
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-sm font-bold text-red-600">
                              <XCircle className="h-4 w-4" />
                              Doesn&apos;t Match
                            </span>
                          )
                        ) : (
                          <span className={`text-sm font-bold ${getScoreColor(rawScore)}`}>
                            {normScore}/10
                          </span>
                        )}
                        {reasons.length > 0 && (
                          isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                          )
                        )}
                      </div>
                    </div>
                    {isExperience && expMatch !== undefined ? (
                      <div className={`h-2 w-full rounded-full ${expMatch ? "bg-green-500" : "bg-red-500"}`} />
                    ) : (
                      <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getProgressBarColor(rawScore)}`}
                          style={{ width: `${Math.min(normScore * 10, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Expandable Reasons */}
                  {isExpanded && reasons.length > 0 && (
                    <div className="px-3 pb-3 pt-1 border-t border-slate-200 bg-white">
                      <ul className="space-y-1.5">
                        {reasons.map((reason, i) => (
                          <li
                            key={i}
                            className={`flex items-start gap-2 text-xs ${
                              i === 0
                                ? "text-slate-800 font-medium"
                                : "text-slate-600"
                            }`}
                          >
                            <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                              i === 0 ? "bg-indigo-500" : "bg-slate-400"
                            }`} />
                            {reason}
                          </li>
                        ))}
                      </ul>
                      {/* Inline matched/missing skills for Skills category */}
                      {key === "skills" && (result.matchedSkills.length > 0 || result.missingSkills.length > 0) && (
                        <ul className="space-y-1.5 mt-3 pt-2 border-t border-slate-100">
                          {result.matchedSkills.map((skill, i) => (
                            <li key={`m-${i}`} className="flex items-start gap-2 text-xs text-green-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0" />
                              {skill}
                            </li>
                          ))}
                          {result.missingSkills.map((skill, i) => (
                            <li key={`x-${i}`} className="flex items-start gap-2 text-xs text-red-600">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />
                              {skill}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detailed Analysis (new format) OR Legacy Strengths/Interview Focus */}
          {detailed ? (
            <Tabs defaultValue="swot" className="w-full">
              <TabsList className="grid w-full grid-cols-4 mb-4">
                <TabsTrigger value="swot" className="text-xs gap-1">
                  <Shield className="h-3.5 w-3.5" />
                  SWOT
                </TabsTrigger>
                <TabsTrigger value="profile" className="text-xs gap-1">
                  <User className="h-3.5 w-3.5" />
                  Profile
                </TabsTrigger>
                <TabsTrigger value="experience" className="text-xs gap-1">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Exp. Depth
                </TabsTrigger>
                <TabsTrigger value="jd" className="text-xs gap-1">
                  <Briefcase className="h-3.5 w-3.5" />
                  JD Analysis
                </TabsTrigger>
              </TabsList>

              {/* SWOT Analysis Tab */}
              <TabsContent value="swot">
                {result.swotAnalysis ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Strengths */}
                      <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-green-600" />
                          <span className="text-xs font-semibold text-green-800 uppercase tracking-wide">Strengths</span>
                        </div>
                        <ul className="space-y-1.5">
                          {result.swotAnalysis.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-green-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-400 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Weaknesses */}
                      <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                        <div className="flex items-center gap-2 mb-2">
                          <XCircle className="h-4 w-4 text-red-600" />
                          <span className="text-xs font-semibold text-red-800 uppercase tracking-wide">Weaknesses</span>
                        </div>
                        <ul className="space-y-1.5">
                          {result.swotAnalysis.weaknesses.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-red-400 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Opportunities */}
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-blue-600" />
                          <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Opportunities</span>
                        </div>
                        <ul className="space-y-1.5">
                          {result.swotAnalysis.opportunities.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-blue-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Risks */}
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Risks</span>
                        </div>
                        <ul className="space-y-1.5">
                          {result.swotAnalysis.risks.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {/* Final Hiring Insight */}
                    {result.swotAnalysis.finalHiringInsight && (
                      <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                        <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">Hiring Insight</span>
                        <p className="text-sm text-indigo-700 mt-1">{result.swotAnalysis.finalHiringInsight}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-6">No SWOT data available</p>
                )}
              </TabsContent>

              {/* Candidate Profile Tab */}
              <TabsContent value="profile">
                {result.candidateProfile ? (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-lg border">
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            ["Name", result.candidateProfile.name],
                            ["Current Role", result.candidateProfile.currentRole],
                            ["Current Company", result.candidateProfile.currentCompany],
                            ["Total Experience", result.candidateProfile.totalExperience],
                            ["Primary Expertise", result.candidateProfile.primaryExpertise],
                            ["Education", result.candidateProfile.education],
                            ["Certifications", result.candidateProfile.certifications],
                            ["Location", result.candidateProfile.location],
                          ]
                            .filter(([, val]) => val && val.trim())
                            .map(([label, val], i) => (
                              <tr key={label} className={i % 2 === 0 ? "bg-slate-50" : "bg-white"}>
                                <td className="px-3 py-2 font-medium text-slate-600 w-40">{label}</td>
                                <td className="px-3 py-2 text-slate-800">{val}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {result.candidateProfile.professionalSummary && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Professional Summary</span>
                        <p className="text-sm text-slate-700 mt-1">{result.candidateProfile.professionalSummary}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-6">No profile data available</p>
                )}
              </TabsContent>

              {/* Experience Depth Tab */}
              <TabsContent value="experience">
                {result.experienceDepthAnalysis ? (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-100 border-b">
                            <th className="px-3 py-2 text-left font-medium text-slate-600">Parameter</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-600 w-28">Rating</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-600">Observation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.experienceDepthAnalysis.parameters.map((p, i) => (
                            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                              <td className="px-3 py-2 font-medium text-slate-700">{p.parameter}</td>
                              <td className="px-3 py-2">
                                <Badge variant="outline" className={`text-xs ${getRatingColor(p.rating)}`}>
                                  {p.rating}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-slate-600">{p.observation}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {result.experienceDepthAnalysis.keyObservations.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Key Observations</span>
                        <ul className="space-y-1.5 mt-2">
                          {result.experienceDepthAnalysis.keyObservations.map((o, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                              {o}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-6">No experience depth data available</p>
                )}
              </TabsContent>

              {/* JD Understanding Tab */}
              <TabsContent value="jd">
                {result.jdUnderstanding ? (
                  <div className="space-y-3">
                    {result.jdUnderstanding.roleOverview && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Role Overview</span>
                        <p className="text-sm text-slate-700 mt-1">{result.jdUnderstanding.roleOverview}</p>
                      </div>
                    )}
                    {result.jdUnderstanding.keyResponsibilities?.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Key Responsibilities</span>
                        <ul className="space-y-1 mt-2">
                          {result.jdUnderstanding.keyResponsibilities.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {result.jdUnderstanding.criticalSkills?.length > 0 && (
                        <div className="p-3 rounded-lg bg-slate-50 border">
                          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Critical Skills</span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {result.jdUnderstanding.criticalSkills.map((s, i) => (
                              <Badge key={i} variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">{s}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {result.jdUnderstanding.niceToHaveSkills?.length > 0 && (
                        <div className="p-3 rounded-lg bg-slate-50 border">
                          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Nice to Have</span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {result.jdUnderstanding.niceToHaveSkills.map((s, i) => (
                              <Badge key={i} variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 text-xs">{s}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {result.jdUnderstanding.domainExpectations && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Domain Expectations</span>
                        <p className="text-sm text-slate-700 mt-1">{result.jdUnderstanding.domainExpectations}</p>
                      </div>
                    )}
                    {result.jdUnderstanding.leadershipExpectations && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Leadership Expectations</span>
                        <p className="text-sm text-slate-700 mt-1">{result.jdUnderstanding.leadershipExpectations}</p>
                      </div>
                    )}
                    {result.jdUnderstanding.businessImpact && (
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Business Impact</span>
                        <p className="text-sm text-slate-700 mt-1">{result.jdUnderstanding.businessImpact}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-6">No JD analysis data available</p>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            /* Legacy layout for old results without detailed analysis */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Strengths */}
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-100">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">Strengths</span>
                </div>
                <ul className="space-y-2">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-blue-700">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Interview Focus Areas */}
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800">Interview Focus Areas</span>
                </div>
                <ul className="space-y-2">
                  {result.interviewFocusAreas.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      )}
      {(result.resumeUrl || previewUrl) && (
        <ResumeViewer
          isOpen={showResume}
          onClose={() => setShowResume(false)}
          resumeUrl={result.resumeUrl || previewUrl!}
          assigneeName={
            result.candidateDetails?.firstName
              ? `${result.candidateDetails.firstName} ${result.candidateDetails.lastName || ""}`.trim()
              : result.resumeName
          }
        />
      )}
    </Card>
  );
}
