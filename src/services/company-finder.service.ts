import {
  CFScanCard,
  CFScanDetail,
  AggregatedCompany,
} from "@/types/company-finder";

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

async function listScans(): Promise<CFScanCard[]> {
  const res = await fetch("/api/company-finder/scans", {
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ scans: CFScanCard[] }>(res);
  return data.scans;
}

async function createScan(name: string): Promise<{ id: string; name: string }> {
  const res = await fetch("/api/company-finder/scans", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  return handleResponse<{ id: string; name: string }>(res);
}

async function getScanDetail(id: string): Promise<CFScanDetail> {
  const res = await fetch(`/api/company-finder/scans/${id}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<CFScanDetail>(res);
}

async function updateResults(
  id: string,
  data: { results: AggregatedCompany[]; resumeNames: string[]; resumeUrls?: Record<string, string> }
): Promise<void> {
  const res = await fetch(`/api/company-finder/scans/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  await handleResponse(res);
}

async function updateName(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/company-finder/scans/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
}

async function removeScan(id: string): Promise<void> {
  const res = await fetch(`/api/company-finder/scans/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  await handleResponse(res);
}

// Prefix used to link a CF scan to an ATS job (not shown to users)
const ATS_SCAN_PREFIX = "__ats__";

/** Find the scan ID linked to a given ATS job, or null if not yet created. */
async function findAtsScanId(interviewId: string): Promise<string | null> {
  const scans = await listScans();
  const name = `${ATS_SCAN_PREFIX}${interviewId}`;
  const found = scans.find((s) => s.name === name);
  return found?.id || null;
}

/** Find or create the CF scan linked to an ATS job, returning its ID. */
async function ensureAtsScan(interviewId: string): Promise<string> {
  const existing = await findAtsScanId(interviewId);
  if (existing) return existing;
  const name = `${ATS_SCAN_PREFIX}${interviewId}`;
  const scan = await createScan(name);
  return scan.id;
}

/**
 * Search ALL other scans for resumes that have already been processed.
 * Returns the aggregated company results that reference those resumes,
 * plus the list of resume names that were found (so callers can skip them).
 */
async function findExistingResultsForResumes(
  currentScanId: string,
  resumeNames: string[]
): Promise<{ companies: AggregatedCompany[]; processedNames: string[]; resumeUrls: Record<string, string> }> {
  if (resumeNames.length === 0) return { companies: [], processedNames: [], resumeUrls: {} };

  const nameSet = new Set(resumeNames.map((n) => n.toLowerCase().trim()));
  const allScans = await listScans();
  const otherScans = allScans.filter((s) => s.id !== currentScanId);

  const processedNames = new Set<string>();
  const companyMap = new Map<string, AggregatedCompany>();
  const collectedUrls: Record<string, string> = {};

  for (const scan of otherScans) {
    // Quick check: does this scan have any of our target resumes?
    if (scan.resumeCount === 0) continue;

    let detail: CFScanDetail;
    try {
      detail = await getScanDetail(scan.id);
    } catch {
      continue;
    }

    // Check if any of the target resume names appear in this scan
    const matchingNames = (detail.resumeNames || []).filter((n) =>
      nameSet.has(n.toLowerCase().trim())
    );
    if (matchingNames.length === 0) continue;

    for (const n of matchingNames) processedNames.add(n);

    // Collect resume URLs from the source scan
    if (detail.resumeUrls) {
      for (const n of matchingNames) {
        if (detail.resumeUrls[n] && !collectedUrls[n]) {
          collectedUrls[n] = detail.resumeUrls[n];
        }
      }
    }

    // Collect companies that reference any of the matching resumes
    for (const company of detail.results || []) {
      const hasMatchingSource = (company.sourceResumes || []).some((sr) =>
        nameSet.has(sr.toLowerCase().trim())
      );
      if (!hasMatchingSource) continue;

      const key = company.companyName.toLowerCase().trim();
      const existing = companyMap.get(key);
      if (!existing) {
        companyMap.set(key, { ...company });
      } else {
        // Merge: prefer richer data
        if (!existing.companyInfo && company.companyInfo) existing.companyInfo = company.companyInfo;
        if (!existing.headquarters && company.headquarters) existing.headquarters = company.headquarters;
        if (!existing.foundedYear && company.foundedYear) existing.foundedYear = company.foundedYear;
        if (company.countriesWorkedIn?.length && !existing.countriesWorkedIn?.length) {
          existing.countriesWorkedIn = [...company.countriesWorkedIn];
        } else if (company.countriesWorkedIn?.length && existing.countriesWorkedIn?.length) {
          for (const c of company.countriesWorkedIn) {
            if (!existing.countriesWorkedIn.includes(c)) existing.countriesWorkedIn.push(c);
          }
        }
        for (const sr of company.sourceResumes || []) {
          if (!existing.sourceResumes.includes(sr)) existing.sourceResumes.push(sr);
        }
        for (const ctx of company.contexts || []) {
          if (!existing.contexts.includes(ctx)) existing.contexts.push(ctx);
        }
        existing.frequency = existing.sourceResumes.length;
      }
    }
  }

  return {
    companies: Array.from(companyMap.values()),
    processedNames: Array.from(processedNames),
    resumeUrls: collectedUrls,
  };
}

export const CompanyFinderService = {
  listScans,
  createScan,
  getScanDetail,
  updateResults,
  updateName,
  removeScan,
  findAtsScanId,
  ensureAtsScan,
  findExistingResultsForResumes,
};
