import {
  ATSJobCardData,
  ATSJobDetail,
  ATSScoreResult,
} from "@/types/ats-scoring";

function getAuthHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("auth_token")
      : null;
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    if (response.status === 401) {
      // Token expired — clear local token and redirect to login
      localStorage.removeItem("auth_token");
      window.location.href = "/sign-in";
    }
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

async function listJobs(): Promise<ATSJobCardData[]> {
  const res = await fetch("/api/ats-scoring/jobs", {
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ jobs: ATSJobCardData[] }>(res);
  return data.jobs;
}

async function addJobs(interviewIds: string[]): Promise<void> {
  const res = await fetch("/api/ats-scoring/jobs", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ interviewIds }),
  });
  await handleResponse(res);
}

async function getJobDetail(interviewId: string): Promise<ATSJobDetail> {
  const res = await fetch(`/api/ats-scoring/jobs/${interviewId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ATSJobDetail>(res);
}

async function updateJd(
  interviewId: string,
  jdText: string,
  jdFilename: string
): Promise<void> {
  const res = await fetch(`/api/ats-scoring/jobs/${interviewId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ jdText, jdFilename }),
  });
  await handleResponse(res);
}

async function updateResults(
  interviewId: string,
  results: ATSScoreResult[]
): Promise<void> {
  const res = await fetch(`/api/ats-scoring/jobs/${interviewId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ results }),
  });
  await handleResponse(res);
}

async function removeJob(interviewId: string): Promise<void> {
  const res = await fetch(`/api/ats-scoring/jobs/${interviewId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  await handleResponse(res);
}

async function startBatchAnalysis(
  interviewId: string,
  resumes: { name: string; text: string }[]
): Promise<{ jobId: string; totalItems: number }> {
  const res = await fetch(`/api/ats-scoring/jobs/${interviewId}/queue`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ resumes }),
  });
  return handleResponse(res);
}

export const ATSJobService = {
  listJobs,
  addJobs,
  getJobDetail,
  updateJd,
  updateResults,
  removeJob,
  startBatchAnalysis,
};
