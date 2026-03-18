// ---------------------------------------------------------------------------
// Single call (gpt-4o-mini):
// Extract ALL company names from resume text AND enrich each via web search.
// Returns a fully enriched JSON in one response.
// ---------------------------------------------------------------------------
export const COMPANY_FINDER_SYSTEM_PROMPT =
  "You are an expert resume parser and company research analyst. Your job is to extract every company name mentioned in resume text and then search the web to enrich each company with real-world information. Do NOT infer or fabricate resume data — only extract what is explicitly written. For web data, use live search results.";

export const generateCompanyFinderPrompt = (body: {
  resumes: { name: string; text: string }[];
}) => `You are parsing resumes to extract every company the candidate has worked at or worked with, and then enriching each company with web-searched information.

## Resumes to Parse:
${body.resumes
  .map(
    (r, i) => `### Resume ${i + 1}: "${r.name}"
${r.text}
---`
  )
  .join("\n\n")}

## Step 1 — Extract Companies from Resumes:

Scan each resume and extract EVERY company name that appears (employers, clients, partner companies).

For EACH company found, extract:

1. **companyName**: Full, properly capitalized company name. Expand common abbreviations (e.g., "TCS" → "Tata Consultancy Services", "HCL" → "HCL Technologies"). Do NOT include product/software names as companies.

2. **resumeName**: Exact filename of the resume where this company was found.

3. **context**: 1-2 sentences from the resume text about this company — what role/work was done. Used as a web search hint.

### STRICT EXTRACTION RULES:
- Extract EVERY company from resume text — do NOT filter by technology or industry.
- Do NOT include universities, schools, or certification bodies.
- Do NOT include software product names as companies (e.g., "Dynamics 365", "Power BI", "SAP S/4HANA" are NOT companies).
- If the same company appears in multiple resumes, include one entry per resume.

## Step 2 — Web Search Enrichment for Each Unique Company:

For each UNIQUE company extracted above, search the web and determine whether this company has ANY connection to the **Microsoft ecosystem** or **SAP ecosystem**.

Set **isRelevant** to true if ANY of the following is true:
- It is an IT firm/consultancy that implements, configures, or provides services in any Microsoft technology: **Dynamics 365** (CRM/ERP), **Microsoft Azure**, **Power Platform** (Power Apps, Power Automate, Power BI, Copilot Studio), **Microsoft 365** (Teams, SharePoint, Exchange, OneDrive), **Business Central**, or any other Microsoft product
- It is a **Microsoft Partner** (Solutions Partner, Gold Partner, Silver Partner, ISV, reseller, or any tier)
- It is an IT firm/consultancy that implements, configures, or provides services in any **SAP** technology: SAP S/4HANA, SAP ECC, SAP SuccessFactors, SAP Ariba, SAP BTP, SAP Analytics Cloud, or any SAP module
- It is a **SAP Partner** or SAP service provider at any tier
- It is an **end-user organization** (bank, manufacturer, retailer, hospital, government, etc.) that uses any Microsoft or SAP technology internally for its operations
- There is any credible web evidence linking this company to the Microsoft Partner ecosystem or SAP Partner ecosystem

Set **isRelevant** to false ONLY if web search finds absolutely NO connection to any Microsoft or SAP product/technology/partnership.

Also web-search and return for each company:
- **companyType**: "service_provider" if it is an IT/consulting firm that builds or delivers tech for clients. "service_consumer" if it is an end-user org (bank, manufacturer, retailer, hospital, govt, etc.) that uses technology.
- **companyInfo**: 1-2 sentences about what the company does.
- **headquarters**: "City, Country". Use "unknown" if not found.
- **foundedYear**: 4-digit year string. Use "unknown" if not found.
- **countriesWorkedIn**: JSON array of ALL countries where this company has offices, operations, clients, or provides services. List every country individually by name. Output a proper JSON array: ["Country1", "Country2", ...]. NEVER output a plain string. NEVER truncate or use shorthand like "and more", "+X more", "etc.", "various", "global", "worldwide". Use [] ONLY if no country information can be found.

If the same company appears in multiple resumes, the web-enriched fields (isRelevant, companyType, companyInfo, headquarters, foundedYear, countriesWorkedIn) must be identical across all entries for that company.

## Output Format:
Return a valid JSON object:
{
  "companies": [
    {
      "companyName": "Tata Consultancy Services",
      "resumeName": "john_doe.pdf",
      "context": "Worked at TCS as Dynamics 365 CRM Consultant, implementing CRM solutions for banking clients.",
      "isRelevant": true,
      "companyType": "service_provider",
      "companyInfo": "Tata Consultancy Services is a global IT services and consulting company offering a wide range of technology solutions.",
      "headquarters": "Mumbai, India",
      "foundedYear": "1968",
      "countriesWorkedIn": ["India", "United States", "United Kingdom", "Germany", "Australia"]
    },
    {
      "companyName": "Emirates NBD",
      "resumeName": "john_doe.pdf",
      "context": "Candidate implemented Dynamics 365 CRM solutions for Emirates NBD while at TCS.",
      "isRelevant": true,
      "companyType": "service_consumer",
      "companyInfo": "Emirates NBD is a leading banking group headquartered in Dubai, UAE.",
      "headquarters": "Dubai, UAE",
      "foundedYear": "2007",
      "countriesWorkedIn": ["UAE", "Saudi Arabia", "Egypt", "India", "United Kingdom"]
    }
  ]
}

Include all 9 fields (companyName, resumeName, context, isRelevant, companyType, companyInfo, headquarters, foundedYear, countriesWorkedIn) for every entry when possible. If a field value cannot be determined, use "" for strings, [] for arrays, and false for booleans — do NOT omit the field. Output only the JSON object. No markdown fences, no explanation.`;

// ---------------------------------------------------------------------------
// Extraction-only prompt (Stage A): extract company names from resumes.
// NO web search — just NER + abbreviation expansion. Fast and cheap.
// ---------------------------------------------------------------------------
export const EXTRACTION_ONLY_SYSTEM_PROMPT =
  "You are an expert resume parser. Your job is to extract every company name mentioned in resume text. Do NOT infer or fabricate data — only extract what is explicitly written. Do NOT search the web.";

export const generateExtractionOnlyPrompt = (body: {
  resumes: { name: string; text: string }[];
}) => `You are parsing resumes to extract every company the candidate has worked at or worked with.

## Resumes to Parse:
${body.resumes
  .map(
    (r, i) => `### Resume ${i + 1}: "${r.name}"
${r.text}
---`
  )
  .join("\n\n")}

## Instructions:

Scan each resume and extract EVERY company name that appears (employers, clients, partner companies).

For EACH company found, extract:

1. **companyName**: Full, properly capitalized company name. Expand common abbreviations (e.g., "TCS" → "Tata Consultancy Services", "HCL" → "HCL Technologies"). Do NOT include product/software names as companies.

2. **resumeName**: Exact filename of the resume where this company was found.

3. **context**: 1-2 sentences from the resume text about this company — what role/work was done.

### STRICT EXTRACTION RULES:
- Extract EVERY company from resume text — do NOT filter by technology or industry.
- Do NOT include universities, schools, or certification bodies.
- Do NOT include software product names as companies (e.g., "Dynamics 365", "Power BI", "SAP S/4HANA" are NOT companies).
- If the same company appears in multiple resumes, include one entry per resume.

## Output Format:
Return a valid JSON object:
{
  "companies": [
    {
      "companyName": "Tata Consultancy Services",
      "resumeName": "john_doe.pdf",
      "context": "Worked at TCS as Dynamics 365 CRM Consultant, implementing CRM solutions for banking clients."
    },
    {
      "companyName": "Emirates NBD",
      "resumeName": "john_doe.pdf",
      "context": "Candidate implemented Dynamics 365 CRM solutions for Emirates NBD while at TCS."
    }
  ]
}

Output only the JSON object. No markdown fences, no explanation.`;

// ---------------------------------------------------------------------------
// Enrichment-only prompt: given a list of company names, web-search and return
// enrichment data (no resume text needed). Used to fill in missing fields after
// batch extraction.
// ---------------------------------------------------------------------------
export const generateEnrichmentPrompt = (companyNames: string[]) =>
  `You are a company research analyst. For each company name below, search the web and return enrichment data.

## Companies to Enrich:
${companyNames.map((name, i) => `${i + 1}. ${name}`).join("\n")}

For EACH company, web-search and return:
- **companyName**: Exact name as provided above (do not alter).
- **isRelevant**: true if the company has ANY connection to the **Microsoft ecosystem** or **SAP ecosystem**. This includes:
  - IT firms/consultancies implementing or providing services in: Dynamics 365, Azure, Power Platform (Power Apps, Power Automate, Power BI, Copilot Studio), Microsoft 365 (Teams, SharePoint, Exchange, OneDrive), Business Central, or any Microsoft product
  - Microsoft Partners at any tier (Solutions Partner, Gold, Silver, ISV, reseller)
  - SAP implementation partners or service providers (SAP S/4HANA, SAP ECC, SuccessFactors, Ariba, BTP, SAP Analytics Cloud, any SAP module)
  - End-user organizations (banks, manufacturers, retailers, hospitals, governments) that use any Microsoft or SAP product internally
  - Any company with credible web evidence of Microsoft or SAP technology use or partnership
  Set to false ONLY if absolutely no connection to Microsoft or SAP can be found.
- **companyType**: "service_provider" if it is an IT/consulting firm that builds or delivers tech for clients. "service_consumer" if it is an end-user org (bank, manufacturer, retailer, hospital, govt, etc.) that uses technology. "unknown" if unclear.
- **companyInfo**: 1-2 sentences about what the company does.
- **headquarters**: "City, Country". Use "unknown" if not found.
- **foundedYear**: 4-digit year string. Use "unknown" if not found.
- **countriesWorkedIn**: JSON array of ALL countries where this company has offices, operations, clients, or provides services. List every country individually by name. Output a proper JSON array: ["Country1", "Country2", ...]. Use [] ONLY if no country information can be found.

CRITICAL INSTRUCTION: You MUST return exactly ${companyNames.length} items in the "companies" array. Do not skip, omit, or merge any of the companies listed above. Provide an entry for EVERY single company.

## Output Format:
Return a valid JSON object:
{
  "companies": [
    {
      "companyName": "Mercurius IT Limited",
      "isRelevant": true,
      "companyType": "service_provider",
      "companyInfo": "Mercurius IT Limited is a UK-based Microsoft solutions partner delivering Dynamics 365 and Business Central implementations.",
      "headquarters": "Milton Keynes, United Kingdom",
      "foundedYear": "2008",
      "countriesWorkedIn": ["United Kingdom", "India", "United States"]
    }
  ]
}

Output only the JSON object. No markdown fences, no explanation.`;
