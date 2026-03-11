export type AssigneeStatus = 'active' | 'inactive' | 'pending';
export type UserRole = 'admin' | 'manager' | 'interviewer' | 'viewer' | 'marketing';
export type UserStatus = 'active' | 'inactive' | 'pending' | 'suspended';
export type ReviewStatus = 'NO_STATUS' | 'NOT_SELECTED' | 'POTENTIAL' | 'SELECTED';
export type InterviewStatus = 'NOT_SENT' | 'INTERVIEW_SENT' | 'INTERVIEW_RESENT' | 'INTERVIEW_COMPLETED' | 'AI_RESPONSE_CAPTURED' | 'REVIEWED' | 'NOT_REVIEWED' | 'CANDIDATE_SELECTED' | 'CANDIDATE_REJECTED';

export interface ClientUser {
  id: string;
  created_at: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  avatar_url?: string;
  organization_id: string;
  role: UserRole;
  status: UserStatus;
  last_login?: string;
  created_by?: string;
  updated_at: string;
}

export interface InterviewAssignee {
  id: number;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  resume_url?: string;
  organization_id?: string | null;
  interview_id?: string | null;
  status: AssigneeStatus;
  assigned_by?: string;
  assigned_at?: string;
  notes?: string;
  tag?: string | null;
  applicant_id?: string | null;
  review_status?: ReviewStatus | null;
  // New flag: controls whether the assignee is allowed to take / retake the interview
  allow_retake?: boolean | null;
  // Interview process status tracking
  interview_status?: InterviewStatus | null;
}

export interface CreateAssigneeRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  resume_url?: string;
  organization_id?: string | null;
  interview_id?: string | null;
  status?: AssigneeStatus;
  notes?: string;
  tag?: string | null;
  applicant_id?: string | null;
  review_status?: ReviewStatus | null;
}

export interface UpdateAssigneeRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  resume_url?: string;
  interview_id?: string | null;
  status?: AssigneeStatus;
  notes?: string;
  tag?: string | null;
  applicant_id?: string | null;
  review_status?: ReviewStatus | null;
  interview_status?: InterviewStatus | null;
  allow_retake?: boolean | null;
}

export interface AssignInterviewRequest {
  assignee_id: number;
  interview_id: string;
  assigned_by: string;
  notes?: string;
}

export interface UnassignInterviewRequest {
  assignee_id: number;
  assigned_by: string;
}
