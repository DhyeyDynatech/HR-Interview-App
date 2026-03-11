export interface ATSCategoryDetail {
  score: number;
  reasons: string[];
}

export interface ATSCategoryScores {
  skills: number;
  experience: number;
  education: number;
  keywords?: number;
}

export interface ATSCandidateDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

// ---------- Detailed Analysis Types (new comprehensive assessment) ----------

export interface ATSCandidateProfile {
  name: string;
  currentRole: string;
  currentCompany: string;
  totalExperience: string;
  primaryExpertise: string;
  education: string;
  certifications: string;
  location: string;
  professionalSummary: string;
}

export interface ATSJDUnderstanding {
  roleOverview: string;
  keyResponsibilities: string[];
  criticalSkills: string[];
  niceToHaveSkills: string[];
  domainExpectations: string;
  leadershipExpectations: string;
  businessImpact: string;
}

export interface ATSExperienceParameter {
  parameter: string;
  rating: string;
  observation: string;
}

export interface ATSExperienceDepthAnalysis {
  parameters: ATSExperienceParameter[];
  keyObservations: string[];
}

export interface ATSSWOTAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
  finalHiringInsight: string;
}

// ---------- Main Score Result ----------

export interface ATSScoreResult {
  resumeName: string;
  overallScore: number;
  categoryScores: ATSCategoryScores;
  categoryDetails?: {
    skills: ATSCategoryDetail;
    experience: ATSCategoryDetail;
    education: ATSCategoryDetail;
    keywords?: ATSCategoryDetail;
  };
  experienceMatch?: boolean;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  interviewFocusAreas: string[];
  summary: string;
  candidateDetails: ATSCandidateDetails;
  suggestedTag: string;
  scoredAt?: string;
  resumeUrl?: string;
  // Detailed analysis (optional — absent in legacy results)
  candidateProfile?: ATSCandidateProfile;
  jdUnderstanding?: ATSJDUnderstanding;
  experienceDepthAnalysis?: ATSExperienceDepthAnalysis;
  swotAnalysis?: ATSSWOTAnalysis;
}

export interface ATSAnalysisRequest {
  jobDescription: string;
  resumes: { name: string; text: string }[];
  userId?: string;
  organizationId?: string;
}

export interface ATSAnalysisResponse {
  results: ATSScoreResult[];
}

export interface ParsedResume {
  name: string;
  text: string;
  file: File;
}

export interface ATSJobCardData {
  interviewId: string;
  interviewName: string;
  hasJd: boolean;
  jdFilename: string;
  resultCount: number;
  avgScore: number;
}

export interface ATSJobDetail {
  interviewId: string;
  interviewName: string;
  jdText: string;
  jdFilename: string;
  results: ATSScoreResult[];
}
