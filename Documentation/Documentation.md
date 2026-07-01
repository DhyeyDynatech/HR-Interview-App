# DynaTech HR Interviewer — AI-Powered HR Interview Management System

## Complete Technical Documentation

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack Summary](#2-tech-stack-summary)
3. [Architecture Overview](#3-architecture-overview)
4. [Directory Structure](#4-directory-structure)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Database Schema](#6-database-schema)
7. [API Routes Reference](#7-api-routes-reference)
8. [Client Pages & Routing](#8-client-pages--routing)
9. [Components](#9-components)
10. [Services & Business Logic](#10-services--business-logic)
11. [AI & LLM Integration](#11-ai--llm-integration)
12. [Real-Time Video & Audio](#12-real-time-video--audio)
13. [Proctoring & Violation Detection](#13-proctoring--violation-detection)
14. [ATS Resume Scoring](#14-ats-resume-scoring)
15. [Company Finder](#15-company-finder)
16. [File Upload & Storage](#16-file-upload--storage)
17. [State Management](#17-state-management)
18. [Notifications & Email](#18-notifications--email)
19. [Cost Tracking & Analytics](#19-cost-tracking--analytics)
20. [Retry & Error Handling](#20-retry--error-handling)
21. [Configuration Files](#21-configuration-files)
22. [Environment Variables](#22-environment-variables)
23. [Deployment](#23-deployment)
24. [Data Flow Diagrams](#24-data-flow-diagrams)

---

## 1. Project Overview

**DynaTech HR Interviewer** is an AI-powered HR interview management platform that automates candidate screening through voice-based AI interviews, resume scoring, company research, and real-time proctoring.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| AI Voice Interviews | Real-time voice conversations with AI interviewers. Two interchangeable providers selectable via `USE_VOICE_LIVE` env flag: **Retell SDK** (default) or **Azure Voice Live** (WebSocket Realtime API). |
| Real-Time Proctoring | Face verification, tab-switch detection, multi-person detection, camera monitoring |
| ATS Resume Scoring | gpt-5-mini-based resume scoring against job descriptions with server-side queue processing |
| Company Finder | Automated company extraction + web-enriched research from resumes; Dynatech Relevant filter (SAP/Dynamics) |
| Candidate Management | Bulk import, assignment, tagging, status tracking |
| Interview Analytics | Transcript analysis, communication scoring, AI-generated insights |
| Interview Recording | Mono Opus/webm audio recording of the candidate + agent (Voice Live path) uploaded to Azure Blob Storage |
| Cost Tracking | Real token-based cost tracking across 8 categories including web search call pricing |

---

## 2. Tech Stack Summary

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 14.2.20 | Full-stack React framework (App Router) |
| React | 18 | UI library |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 3.3.0 | Utility-first styling |
| Radix UI | latest | Accessible headless UI primitives (13+ packages) |
| shadcn/ui | latest | Pre-built component library on Radix |
| MUI | 5.15.20 | Material Design components |
| NextUI | 2.4.6 | Additional UI components |
| Framer Motion | 11.3.21 | Animations |
| TanStack Table | 8.20.1 | Data tables with sorting/filtering |
| TanStack Query | 5.17.15 | Server state management |
| React Hook Form | 7.49.0 | Form management |
| Zod | 3.23.8 | Schema validation |

### Backend & Database

| Technology | Version | Purpose |
|-----------|---------|---------|
| Supabase | 2.39.3 | PostgreSQL database + auth infrastructure |
| Prisma | 5.6.0 | ORM / database client |
| Azure Blob Storage | @azure/storage-blob 12.31 | File storage for all assets — recordings, resumes, images (each in its own container) |

### AI & Voice

| Technology | Purpose |
|-----------|---------|
| Azure OpenAI (gpt-5-mini) | All LLM tasks: question generation, ATS scoring, analytics, company extraction |
| OpenAI Direct (Responses API) | Company enrichment with built-in web_search tool |
| Retell SDK (v4.19.0) | Server-side voice call management (default voice provider) |
| Retell Client SDK (v2.0.0) | Browser-side voice call interface (default voice provider) |
| Azure Voice Live API (Realtime) | Alternate voice provider — WebSocket-based realtime audio with server-side VAD, function calling (`end_interview`, `report_refusal`), and Azure Neural voice synthesis. Enabled via `USE_VOICE_LIVE=true`. |
| Azure Blob Storage (`@azure/storage-blob` v12.31) | All file storage — Voice Live audio recordings, resumes, and user images (separate containers) |

### File Processing & Utilities

| Technology | Version | Purpose |
|-----------|---------|---------|
| pdf-parse / pdfjs-dist | 1.1.1 / ^4.10.38 | PDF resume parsing |
| mammoth | ^1.11.0 | DOCX to text conversion |
| word-extractor | ^1.0.4 | Legacy DOC file support |
| papaparse | ^5.5.3 | CSV parsing for bulk imports |
| sharp | latest | Image processing |
| adm-zip | ^0.5.16 | ZIP/DOCX archive extraction |
| canvas | ^3.2.2 | Server-side canvas for image processing |
| langchain | ^0.1.4 | LLM utility framework |
| marked | ^13.0.3 | Markdown to HTML rendering |
| mupdf | ^1.27.0 | Alternative PDF processing engine |

### Proctoring & Detection

| Technology | Purpose |
|-----------|---------|
| face-api.js | Client-side face detection & verification |
| ssdMobilenetv1 | Fast face detection model |
| faceLandmark68Net | 68-point facial landmark detection |
| faceRecognitionNet | Face descriptor generation for comparison |

### Notifications

| Technology | Purpose |
|-----------|---------|
| Microsoft Power Automate | Email sending via webhook |
| Sonner | In-app toast notifications |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT BROWSER                          │
│  ┌──────────┐  ┌──────────────────────┐  ┌────────────┐         │
│  │Dashboard │  │ Call UI              │  │ Proctoring │         │
│  │ (React)  │  │ Retell SDK ──or──    │  │ (face-api) │         │
│  │          │  │ VoiceLiveClient (WS) │  │            │         │
│  └─────┬────┘  └──────────┬───────────┘  └─────┬──────┘         │
└────────┼──────────────────┼─────────────────────┼───────────────┘
         │                  │                     │
         ▼                  ▼                     │
┌────────────────────────────────────────────────┼───────────────┐
│                  NEXT.JS SERVER (Vercel)        │                │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┴┐              │
│  │API Routes│  │Middleware│  │ Webhooks /        │              │
│  │  (55+)   │  │  (Auth)  │  │ end-of-call hooks │              │
│  └─────┬────┘  └──────────┘  └───────────────────┘              │
│        │                                                         │
│  ┌─────┴────────────────────────────────────────┐               │
│  │             SERVICE LAYER                     │               │
│  │  interviews · responses · analytics           │               │
│  │  users · ats-job · company-finder · cost      │               │
│  └─────┬───────────────┬──────────────┬─────────┘               │
└────────┼───────────────┼──────────────┼─────────────────────────┘
         │               │              │
         ▼               ▼              ▼
┌──────────────┐ ┌────────────────┐ ┌──────────────────────────────────┐
│   Supabase   │ │  Azure OpenAI  │ │ Azure Blob Storage               │
│ (PostgreSQL) │ │  (gpt-5-mini)  │ │ (recordings, resumes, images —   │
│              │ │                │ │  separate containers)            │
└──────────────┘ └────────┬───────┘ └──────────────────────────────────┘
                          │
                 ┌────────┴────────┐
                 │ OpenAI Direct   │
                 │ (Responses API) │
                 │ + web_search    │
                 └─────────────────┘

Voice provider (chosen per-call via USE_VOICE_LIVE env flag):
  ┌─────────────────┐                     ┌──────────────────────────┐
  │ Retell platform │ ←── default ──      │ Azure Voice Live         │
  │ (WebRTC + SDK)  │     │               │ (WebSocket Realtime API) │
  └─────────────────┘     │               └──────────────────────────┘
                          └── USE_VOICE_LIVE=true ──┘
```

---

## 4. Directory Structure

```
HR-Interviewer/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (client)/                 # Protected routes (require auth)
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx          # Main dashboard / interviews list
│   │   │   │   ├── overview/         # Analytics & statistics
│   │   │   │   ├── users/            # Candidate management
│   │   │   │   ├── interviewers/     # AI interviewer profiles
│   │   │   │   ├── ats-scoring/      # ATS resume scoring module
│   │   │   │   ├── company-finder/   # Company research module
│   │   │   │   ├── cost-analysis/    # Cost analytics
│   │   │   │   └── interviews/[interviewId]/ # Interview detail & responses
│   │   │   ├── profile/              # User profile
│   │   │   └── reset-password/       # Password reset
│   │   ├── (user)/
│   │   │   └── call/[interviewId]/   # Candidate interview call page (public)
│   │   ├── sign-in/[[...sign-in]]/   # Authentication
│   │   ├── sign-up/[[...sign-up]]/   # Registration
│   │   ├── api/                      # 55+ API route handlers
│   │   │   ├── auth/                 # login, signup, logout, session, password reset
│   │   │   ├── interviews/           # CRUD + listing
│   │   │   ├── profile/
│   │   │   │   ├── route.ts          # GET/PUT user profile
│   │   │   │   └── password/route.ts # PUT change password
│   │   │   ├── create-interviewer/route.ts  # GET interviewer creation
│   │   │   ├── assignees/            # Candidate assignment & bulk operations
│   │   │   ├── ats-scoring/
│   │   │   │   ├── route.ts          # Legacy single-call ATS scoring
│   │   │   │   └── jobs/
│   │   │   │       ├── route.ts      # List / create job postings
│   │   │   │       └── [interviewId]/
│   │   │   │           ├── route.ts           # Job CRUD
│   │   │   │           ├── queue/route.ts     # Queue batch job
│   │   │   │           ├── urls/route.ts      # Resume URL management
│   │   │   │           └── process/route.ts   # Process batch tasks
│   │   │   ├── company-finder/
│   │   │   │   ├── route.ts          # Legacy single-call CF
│   │   │   │   ├── extract/route.ts  # Legacy extraction endpoint
│   │   │   │   ├── cache/route.ts    # Company cache lookup
│   │   │   │   └── scans/
│   │   │   │       ├── route.ts      # Create scan
│   │   │   │       └── [id]/
│   │   │   │           ├── route.ts            # Scan CRUD
│   │   │   │           ├── queue/route.ts      # Queue CF batch job
│   │   │   │           ├── job-status/route.ts # CF job status polling
│   │   │   │           ├── extract/route.ts    # Stage A: NLP extraction
│   │   │   │           ├── enrich/route.ts     # Stage B: Web enrichment
│   │   │   │           ├── process/route.ts    # Combined pipeline
│   │   │   │           └── retry-failed/route.ts # POST retry failed tasks
│   │   │   ├── users/                # User management + bulk import
│   │   │   ├── cost-analysis/        # Cost metrics + diagnostics
│   │   │   ├── voice-live/
│   │   │   │   └── save-call/route.ts     # End-of-call sink for Voice Live: persists transcript + analytics + cost + violations + assignee status + recruiter email
│   │   │   ├── upload-call-recording/
│   │   │   │   └── route.ts               # Streams candidate audio blob to Azure Blob Storage; returns the public URL stored on the response row
│   │   │   └── ...                   # Webhooks, uploads, AI generation
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── ui/                       # 30+ shadcn/Radix primitives
│   │   ├── call/                     # Interview call UI
│   │   ├── dashboard/
│   │   │   ├── interview/            # Interview cards, modals, tables
│   │   │   ├── interviewer/          # AI interviewer management
│   │   │   ├── user/                 # Candidate management UI
│   │   │   ├── ats-scoring/
│   │   │   │   ├── scoringView.tsx   # Main scoring interface
│   │   │   │   ├── ATSBatchProcessor.tsx  # Server-side batch job polling
│   │   │   │   ├── atsResultCard.tsx
│   │   │   │   ├── jobGrid.tsx
│   │   │   │   ├── jobCard.tsx
│   │   │   │   ├── addJobDialog.tsx
│   │   │   │   ├── ATSResultsList.tsx
│   │   │   │   └── CompanyResultsList.tsx
│   │   │   ├── company-finder/
│   │   │   │   ├── companyFinderView.tsx  # Main CF interface
│   │   │   │   └── CFBatchProcessor.tsx   # Server-side batch job polling
│   │   │   ├── interviewer/
│   │   │   │   ├── interviewerCard.tsx    # AI interviewer profile card
│   │   │   │   └── interviewerDetailsModal.tsx # Interviewer details modal
│   │   │   └── Modal.tsx                 # Shared dashboard modal utility
│   │   ├── loaders/
│   │   │   ├── loader-with-logo/loaderWithLogo.tsx
│   │   │   ├── loader-with-text/loaderWithText.tsx
│   │   │   ├── mini-loader/miniLoader.tsx
│   │   │   ├── page-loader/PageLoader.tsx
│   │   │   └── progress-bar/ProgressBar.tsx
│   │   ├── navbar.tsx
│   │   ├── sideMenu.tsx
│   │   ├── NavigationLoader.tsx
│   │   └── providers.tsx
│   │
│   ├── contexts/                     # React Context providers
│   │   ├── auth.context.tsx
│   │   ├── interviews.context.tsx
│   │   ├── interviewers.context.tsx
│   │   ├── users.context.tsx
│   │   ├── clients.context.tsx
│   │   ├── responses.context.tsx
│   │   └── loading.context.tsx
│   │
│   ├── services/
│   │   ├── interviews.service.ts
│   │   ├── responses.service.ts
│   │   ├── analytics.service.ts
│   │   ├── users.service.ts
│   │   ├── interviewers.service.ts
│   │   ├── clients.service.ts
│   │   ├── feedback.service.ts
│   │   ├── ats-job.service.ts
│   │   ├── company-finder.service.ts
│   │   ├── cost.service.ts
│   │   └── api-usage.service.ts
│   │
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── constants.ts              # Retell + Voice Live system prompts (buildVoiceLiveInterviewPrompt)
│   │   ├── enum.tsx
│   │   ├── utils.ts
│   │   ├── logger.ts
│   │   ├── normalize-company-key.ts  # Company name normalisation for deduplication
│   │   ├── processing-store.ts       # Module-level processing state (pub/sub)
│   │   ├── openai-client.ts          # Azure OpenAI + OpenAI Direct clients
│   │   ├── azure-blob.ts             # Shared Azure Blob client factory + container helpers (recordings, resumes, images)
│   │   ├── voice-live-client.ts      # Azure Voice Live WebSocket client (mic capture, PCM playback, chunked recording, silence watchdog, hard time cap)
│   │   ├── user-activity-log.ts
│   │   └── prompts/
│   │       ├── analytics.ts
│   │       ├── ats-scoring.ts
│   │       ├── communication-analysis.ts
│   │       ├── company-finder.ts
│   │       ├── generate-insights.ts
│   │       └── generate-questions.ts
│   │
│   ├── hooks/
│   │   ├── useCameraDetection.ts
│   │   ├── useFaceVerification.ts
│   │   └── useMultiplePersonDetection.ts
│   │
│   ├── types/
│   │   ├── auth.ts
│   │   ├── interview.ts
│   │   ├── response.ts
│   │   ├── user.ts
│   │   ├── interviewer.ts
│   │   ├── ats-scoring.ts
│   │   ├── company-finder.ts
│   │   ├── cost.ts
│   │   └── pdf-parse.d.ts            # Manual type declaration for pdf-parse
│   │
│   ├── actions/
│   │   └── parse-pdf.ts
│   │
│   └── middleware.ts
│
├── DB setup/
│   └── complete_database_setup.sql
│
├── public/
│   ├── audio-worklets/
│   │   └── pcm-recorder.js           # AudioWorklet that downsamples mic to 24kHz int16 PCM for Voice Live
│   └── ...
├── Documentation/
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── components.json
```

---

## 5. Authentication & Authorization

### Authentication Flow

```
User Login → POST /api/auth/login
  → Validate email + password (MD5 + salt)
  → Generate JWT (7-day expiry)
  → Set auth_token cookie (HTTP-only)
  → Return user data + token

Session Check → GET /api/auth/session
  → Read auth_token from cookie or Authorization header
  → Verify JWT signature
  → Return user data or 401
```

### JWT Implementation

- **Algorithm:** Custom MD5-based (base64 payload + MD5 signature)
- **Payload:** `{ userId, exp (7 days), iat }`
- **Storage:** HTTP-only `auth_token` cookie
- **Fallback:** Bearer token via `Authorization` header

### Password Handling

- **Hash:** MD5 with `PASSWORD_SALT` environment variable
- **Reset flow:** Token-based reset via `/api/auth/forgot-password` and `/api/auth/reset-password`

### Middleware (`src/middleware.ts`)

**Public routes** (no auth required):
- `/`, `/sign-in`
- `/call/*`, `/interview/*` (candidate-facing)
- API routes: `/api/auth/login`, `/api/auth/signup`, `/api/auth/logout`, `/api/register-call`, `/api/get-call`, `/api/generate-interview-questions`, `/api/analyze-communication`, `/api/response-webhook`, `/api/validate-user`, `/api/users/bulk-import-noauth`, `/api/get-assignee-photo`

> **Note:** `/sign-up` is currently disabled (commented out in middleware). `/api/upload-resume` is NOT a public route despite being candidate-facing — it requires auth.

**Protected routes** (auth required):
- `/dashboard/*` and all sub-routes
- All other API routes

### Role-Based Access

| Role | Description |
|------|-------------|
| admin | Full access to all features |
| manager | Team management + interviews |
| interviewer | Interview management |
| viewer | Read-only dashboard access |
| marketing | Limited access for marketing team |

---

## 6. Database Schema

### Core Tables

#### `public.user` — Admin/Recruiter accounts

| Column | Type | Description |
|--------|------|-------------|
| id | text (PK) | Unique user identifier |
| email | text (unique) | Login email |
| password_hash | text | MD5 + salt hash |
| first_name, last_name | text | Name |
| phone | text | Phone number |
| avatar_url | text | Profile image URL |
| organization_id | text | Organization FK |
| role | user_role enum | admin, manager, interviewer, viewer, marketing |
| status | user_status enum | active, inactive, pending, suspended |
| last_login | timestamptz | Last login timestamp |
| reset_token, reset_token_expires | text, timestamptz | Password reset |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.interview` — Interview configurations

| Column | Type | Description |
|--------|------|-------------|
| id | text (PK) | Interview identifier |
| name | text | Interview title |
| description, objective | text | Purpose and goals |
| user_id | text | Creator FK |
| interviewer_id | text | AI interviewer FK |
| organization_id | text | Organization FK |
| questions | jsonb | Array of question objects |
| is_active, is_anonymous, is_archived | boolean | Status flags |
| logo_url, theme_color | text | Branding |
| url, readable_slug | text | Shareable links |
| quotes | jsonb | Notable quotes from responses |
| insights | text[] | AI-generated insights |
| respondents | text[] | List of respondent IDs |
| question_count, response_count | integer | Counters |
| time_duration | integer | Interview duration (minutes) |

#### `public.interview_assignee` — Candidates/Applicants

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| first_name, last_name, email | text | Candidate info |
| phone | text | Phone |
| avatar_url, resume_url | text | Profile image & resume blob URL |
| notes, tag | text | Recruiter notes & tags |
| interview_id | text | Assigned interview FK |
| organization_id | text | Organization FK |
| assigned_by | text | Recruiter who assigned |
| assigned_at | timestamptz | Assignment date |
| status | text | active, inactive, pending |
| review_status | text | NO_STATUS, NOT_SELECTED, POTENTIAL, SELECTED |
| applicant_id | text | Auto-generated via trigger |
| allow_retake | boolean | Can retake interview |

#### `public.response` — Interview results

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| interview_id | text | Interview FK |
| call_id | text | Retell call identifier |
| name, email | text | Respondent info |
| candidate_status | text | Evaluation status |
| duration | integer | Call duration (seconds) |
| details | jsonb | Full transcript & Q&A data |
| analytics | jsonb | AI-generated analysis scores |
| is_analysed | boolean | Analytics generated flag |
| is_ended | boolean | Call completed flag |
| is_viewed | boolean | Recruiter viewed flag |
| tab_switch_count | integer | Tab violation count |
| face_mismatch_count | integer | Face mismatch violations |
| camera_off_count | integer | Camera-off violations |
| multiple_person_count | integer | Multi-person violations |
| violations_summary | jsonb | Aggregated violation data |

#### `public.organization` — Company accounts

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Organization identifier |
| name | text | Company name |
| image_url | text | Logo URL |
| allowed_responses_count | integer | Usage quota |

### ATS Scoring Tables

#### `public.ats_job_data` — Job postings + scoring metadata

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Job data identifier |
| interview_id | text (unique) | Interview FK |
| organization_id | text | Organization FK |
| jd_text | text | Job description text |
| result_count | integer | Number of scored resumes |
| avg_score | numeric | Average ATS score |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.ats_score_items` — Individual resume scores

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Score item ID |
| interview_id | text | Job FK |
| organization_id | text | Organization FK |
| resume_name | text | Resume filename |
| resume_url | text | Azure Blob URL (older rows may hold legacy Vercel Blob URLs) |
| overall_score | numeric | 0–100 ATS score |
| category_scores | jsonb | Breakdown by category |
| category_details | jsonb | Detailed category analysis |
| matched_skills | text[] | Skills matching JD |
| missing_skills | text[] | Skills not found |
| strengths | text[] | Candidate strengths |
| interview_focus_areas | text[] | Suggested interview focus |
| summary | text | AI-generated summary |
| candidate_details | jsonb | Name, email, experience |
| suggested_tag | text | Recommended tag |
| candidate_profile | jsonb | Full candidate profile |
| jd_understanding | jsonb | JD comprehension analysis |
| experience_depth_analysis | jsonb | Experience depth |
| swot_analysis | jsonb | SWOT breakdown |
| experience_match | jsonb | Experience match details |

#### `public.ats_batch_jobs` — ATS processing job queue

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Job ID |
| interview_id | text | Interview FK |
| status | text | pending, processing, completed, failed |
| total_items | integer | Total resumes to process |
| processed_items | integer | Completed count |
| failed_items | integer | Failed count |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.ats_job_tasks` — Individual resume tasks

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Task ID |
| job_id | uuid | Batch job FK |
| resume_name | text | Resume filename |
| resume_text | text | Extracted resume text |
| resume_url | text | Blob URL |
| status | text | pending, processing, completed, failed |
| error_message | text | Failure reason |
| created_at, updated_at | timestamptz | Timestamps |

### Company Finder Tables

#### `public.company_finder_scan` — Scan sessions

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Scan ID |
| organization_id | text | Organization FK |
| results | jsonb | Aggregated company results |
| resume_names | text[] | Analyzed resume filenames |
| resume_urls | jsonb | name→URL mapping |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.cf_batch_jobs` — CF processing job queue

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Job ID |
| scan_id | text | Scan FK |
| status | text | pending, processing, completed, failed |
| total_items | integer | Total resumes |
| processed_items | integer | Completed count |
| failed_items | integer | Failed count |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.cf_job_tasks` — Individual resume tasks

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Task ID |
| job_id | uuid | Batch job FK |
| resume_name | text | Resume filename |
| resume_text | text | Extracted text |
| resume_url | text | Blob URL |
| status | text | pending, processing, completed, failed |
| error_message | text | Failure reason |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.cf_company_mentions` — Raw extraction results

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Mention ID |
| scan_id | text | Scan FK |
| normalized_key | text | Lowercased company name |
| company_name | text | Original company name |
| resume_name | text | Source resume |
| resume_url | text | Source resume blob URL |
| context | text | Context sentence from resume |

#### `public.cf_enrich_queue` — Companies awaiting web enrichment

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Queue item ID |
| scan_id | text | Scan FK |
| company_name | text | Company name |
| normalized_key | text | Normalized key (unique per scan) |
| status | text | pending, processing, completed, failed |
| created_at, updated_at | timestamptz | Timestamps |

#### `public.cf_company_cache` — Enriched company data cache

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Cache entry ID |
| company_name | text | Company name |
| normalized_key | text (unique) | Lookup key |
| company_type | text | Client, Provider, Partner, etc. |
| company_info | text | AI-generated description |
| headquarters | text | HQ location |
| founded_year | text | Year founded |
| countries_worked_in | text[] | Operating countries |
| technologies | text[] | Technology stack |
| relevant_domains | text[] | Industry domains |
| is_relevant | boolean | SAP/Dynamics relevance flag |
| created_at | timestamptz | Cache timestamp |

### Cost Tracking Tables

#### `public.api_usage` — API usage records

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| created_at | timestamptz | Record timestamp |
| organization_id | text | Organization FK (nullable) |
| user_id | text | User FK (nullable) |
| interview_id | text | Interview FK (nullable) |
| response_id | integer | Response FK (nullable) |
| category | text | Usage category (see §19) |
| service | text | openai, retell, vercel |
| input_tokens | integer | Prompt tokens |
| output_tokens | integer | Completion tokens |
| total_tokens | integer | Total tokens |
| duration_seconds | integer | Voice call duration |
| cost_usd | numeric | Calculated cost |
| model | text | Model identifier |
| request_id | text | Deduplication key |
| metadata | jsonb | Category-specific data incl. searchCalls, searchCost, tokenCost |

### Database Functions

| Function | Purpose |
|----------|---------|
| `increment_job_progress(job_uuid, processed_inc, failed_inc)` | Atomic counter increment for ATS batch jobs |
| `increment_cf_job_progress(job_uuid, processed_inc, failed_inc)` | Atomic counter increment for CF batch jobs |

### Database Triggers

| Trigger | Table | Purpose |
|---------|-------|---------|
| `trigger_auto_generate_applicant_id` | interview_assignee | Auto-generates applicant_id on INSERT |
| `update_interview_assignee_updated_at` | interview_assignee | Updates `updated_at` on change |
| `update_user_updated_at` | user | Updates `updated_at` on change |

---

## 7. API Routes Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login, returns JWT |
| POST | `/api/auth/signup` | User registration |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/session` | Validate current session |
| POST | `/api/auth/forgot-password` | Send password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |

### Interviews

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/create-interview` | Create new interview |
| PUT/DELETE | `/api/interviews/[id]` | Update / delete interview |

### Candidates / Assignees

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assignees` | List all assignees |
| GET/PUT/DELETE | `/api/assignees/[id]` | Single assignee CRUD |
| POST/DELETE | `/api/assignees/assign-interview` | Assign / unassign interview to candidate |
| POST | `/api/assignees/bulk-assign-interview` | Bulk assignment |
| POST | `/api/assignees/bulk-assign-tag` | Bulk tag operations |
| POST | `/api/assignees/bulk-update-status` | Bulk status update |
| POST | `/api/assignees/bulk-delete` | Bulk delete |

### Interview Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register-call` | Register a voice call. Branches on `USE_VOICE_LIVE`: when **false** (default) creates a Retell web call; when **true** returns a Voice Live `wsUrl` + `sessionConfig` (system prompt, voice, VAD threshold, function tools `end_interview` / `report_refusal`) for the browser to open a WebSocket directly. |
| GET | `/api/get-call` | Fetch call details + save voice usage (Retell path) |
| POST | `/api/refetch-call` | Refresh call info |
| POST | `/api/save-response` | Save interview response |
| POST | `/api/response-webhook` | Retell webhook for call completion |
| POST | `/api/voice-live/save-call` | End-of-call sink for the Voice Live path. Persists transcript + violation counts + violations_summary to the `response` row, runs `generateInterviewAnalytics`, records voice cost into `api_usage` with `service="azure-voicelive"`, marks the assignee `INTERVIEW_COMPLETED` + locks retake, and triggers the recruiter notification email. The client saves the **transcript first** (retried up to 3× with backoff) so a slow/failed recording step can never block it, then attaches the recording URL/status. Also supports an `attach_recording_only` fast-path (patches `details.recording_url`/`recording_status` without re-running analytics/email). A `pagehide`/`visibilitychange` `sendBeacon` fallback fires this save even if the candidate closes the tab mid-call. |
| POST | `/api/upload-call-recording` | Uploads Voice Live audio to Azure Blob Storage (mono Opus/webm, ≤200 MB, within 6 h of row creation). Two modes: **append/chunk** (a `seq` form field — `seq=0` creates an append-blob, `seq>0` appends, used for the incremental in-call upload) and **full-blob** (no `seq`, end-of-call fallback). Returns the public URL stored on the response row. |
| GET/POST | `/api/voice-live/sweep-stale` | Cron watchdog (Vercel cron, daily). Finalizes any Voice Live `response` row left `is_ended=false` past its interview's `time_duration` + 5 min grace: marks it ended+visible, runs analytics on any saved transcript, stamps `details.finalized_by="server_sweep"`, and unlocks the assignee's retake. Guards the "device died mid-call" case the browser can't. Gated by `CRON_SECRET` (Vercel auto-injects `Authorization: Bearer`); fails closed if unset. |

### AI Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate-interview-questions` | Generate questions via gpt-5-mini |
| POST | `/api/generate-insights` | Generate interview insights |
| POST | `/api/analyze-communication` | Communication skills analysis |

### ATS Scoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ats-scoring` | Legacy single-call ATS scoring |
| GET/POST | `/api/ats-scoring/jobs` | List / create job postings |
| GET/PUT/PATCH/DELETE | `/api/ats-scoring/jobs/[interviewId]` | Single job CRUD (GET, update, patch, delete) |
| POST | `/api/ats-scoring/jobs/[interviewId]/queue` | Queue batch job (creates `ats_batch_jobs` + `ats_job_tasks`) |
| PATCH | `/api/ats-scoring/jobs/[interviewId]/urls` | Resume URL management for a job |
| POST | `/api/ats-scoring/jobs/[interviewId]/process` | Process next batch of pending tasks (called repeatedly by client) |

### Company Finder

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/company-finder` | Legacy single-call enrichment |
| POST | `/api/company-finder/extract` | Legacy single-call extraction |
| POST | `/api/company-finder/cache` | Company cache lookup |
| POST | `/api/company-finder/scans` | Create scan session |
| GET/DELETE | `/api/company-finder/scans/[id]` | Scan detail & deletion |
| POST | `/api/company-finder/scans/[id]/queue` | Queue CF batch job (creates `cf_batch_jobs` + `cf_job_tasks`) |
| GET | `/api/company-finder/scans/[id]/job-status` | Poll CF batch job progress |
| POST | `/api/company-finder/scans/[id]/extract` | Stage A: NLP extraction (no web search) |
| POST | `/api/company-finder/scans/[id]/enrich` | Stage B: Web enrichment per company |
| POST | `/api/company-finder/scans/[id]/process` | Combined extract→enrich pipeline |
| POST | `/api/company-finder/scans/[id]/retry-failed` | Retry failed CF tasks in a batch job |

### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/users` | List / create users |
| GET/PUT/DELETE | `/api/users/[id]` | Single user CRUD |
| POST | `/api/users/bulk-import` | CSV bulk import (authenticated) |
| POST | `/api/users/bulk-import-noauth` | CSV bulk import (no auth) |

### File Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload-resume` | Upload resume with email extraction |
| POST | `/api/upload-user-image` | Upload profile image |
| GET | `/api/get-assignee-photo` | Fetch assignee photo |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/send-assignee-emails` | Email invitations via Power Automate |
| POST | `/api/send-recruiter-notification` | Recruiter alert emails |

### Profile Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/PUT | `/api/profile` | Get / update current user profile |
| PUT | `/api/profile/password` | Change user password |

### AI Interviewer

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/create-interviewer` | Fetch interviewer creation config |

### Utilities & Cost

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/validate-user` | User validation |
| POST | `/api/log-activity` | Activity logging |
| GET | `/api/get-agent-voice` | Retell agent voice config |
| POST | `/api/cost-analysis` | Cost metrics (tracked or estimated) |
| GET | `/api/cost-analysis` | Get interviews list for filter |

---

## 8. Client Pages & Routing

### Dashboard (Protected — requires auth)

| Route | Page | Description |
|-------|------|-------------|
| `/dashboard` | Main Dashboard | Interview listing, creation, management |
| `/dashboard/overview` | Analytics Overview | Charts, statistics, response trends |
| `/dashboard/users` | Candidate Management | User table, bulk import, assignments |
| `/dashboard/interviewers` | AI Interviewers | View/create AI interviewer profiles |
| `/dashboard/ats-scoring` | ATS Scoring | Resume scoring with Dynatech Relevant filter |
| `/dashboard/company-finder` | Company Finder | Company research with Dynatech Relevant filter |
| `/dashboard/cost-analysis` | Cost & Analysis | API usage, cost tracking by 8 categories |
| `/interviews/[interviewId]` | Interview Detail | Responses, transcripts, analytics |
| `/profile` | Profile | User profile management |
| `/reset-password` | Reset Password | Password change form |

### Public Routes

| Route | Description |
|-------|-------------|
| `/call/[interviewId]` | Candidate interview call interface |
| `/sign-in` | Login page |
| `/sign-up` | Registration page |

---

## 9. Components

### ATS Scoring (`src/components/dashboard/ats-scoring/`)

| Component | Purpose |
|-----------|---------|
| `scoringView.tsx` | Main scoring interface — resume upload, batch processing, Companies tab with Dynatech Relevant filter, CSV export |
| `ATSBatchProcessor.tsx` | Polls `/api/ats-scoring/jobs/[id]/process` repeatedly; handles waiting/retry/completion states; shows progress bar |
| `atsResultCard.tsx` | Individual resume score card with View Resume button |
| `ATSResultsList.tsx` | Paginated list of ATS score results |
| `CompanyResultsList.tsx` | List of company-level results derived from ATS scoring |
| `jobGrid.tsx` | Job posting grid with selection |
| `jobCard.tsx` | Individual job posting card |
| `addJobDialog.tsx` | Create new job posting dialog |

### Company Finder (`src/components/dashboard/company-finder/`)

| Component | Purpose |
|-----------|---------|
| `companyFinderView.tsx` | Main CF interface — scan management, Dynatech Relevant toggle (default ON), progressive resume count, CSV export of filtered data |
| `CFBatchProcessor.tsx` | Polls `/api/company-finder/scans/[id]/process` (or extract/enrich routes) repeatedly; handles progress/completion |

### Call Components (`src/components/call/`)

| Component | Purpose |
|-----------|---------|
| `index.tsx` | Main call interface — connects to Retell, manages call lifecycle |
| `callInfo.tsx` | Displays interview name, interviewer info, candidate info |
| `feedbackForm.tsx` | Post-interview satisfaction & feedback collection |
| `FaceMismatchWarning.tsx` | Alert when face doesn't match reference photo |
| `ViolationWarnings.tsx` | Proctoring violation indicators |
| `tabSwitchPrevention.tsx` | Detects and records tab switches |

### Interview Management (`src/components/dashboard/interview/`)

| Component | Purpose |
|-----------|---------|
| `interviewCard.tsx` | Interview list card with status, respondent count |
| `createInterviewModal.tsx` | Multi-step interview creation wizard |
| `create-popup/details.tsx` | Step 1: Name, objective, duration, interviewer |
| `create-popup/questions.tsx` | Step 2: Add/edit questions |
| `create-popup/questionCard.tsx` | Individual question card within creation wizard |
| `dataTable.tsx` | Interview responses table with sorting/actions |
| `editInterview.tsx` | Edit existing interview settings |
| `sharePopup.tsx` | Shareable interview link modal |
| `fileUpload.tsx` | Resume/file upload component within interview flow |
| `VideoRecorder.tsx` | Video recording for video-based interviews |
| `questionAnswerCard.tsx` | Q&A display card for interview response review |
| `summaryInfo.tsx` | Interview summary/overview information panel |

### AI Interviewer Management (`src/components/dashboard/interviewer/`)

| Component | Purpose |
|-----------|---------|
| `interviewerCard.tsx` | AI interviewer profile card with details and actions |
| `interviewerDetailsModal.tsx` | Detailed view/edit modal for AI interviewer profiles |

### Dashboard Utilities (`src/components/dashboard/`)

| Component | Purpose |
|-----------|---------|
| `Modal.tsx` | Shared reusable modal component for dashboard views |

### Candidate Management (`src/components/dashboard/user/`)

| Component | Purpose |
|-----------|---------|
| `userCard.tsx` | Candidate card with status, tags, and actions |
| `createUserModal.tsx` | Add new candidate form |
| `bulkImportModal.tsx` | CSV bulk import with column mapping |
| `BulkActionsModals.tsx` | Bulk delete, status update, tag assignment |
| `ResumeViewer.tsx` | Resume preview in modal |

### Loaders (`src/components/loaders/`)

| Component | Purpose |
|-----------|---------|
| `loader-with-logo/loaderWithLogo.tsx` | Full-page loader with app logo |
| `loader-with-text/loaderWithText.tsx` | Loader with customizable text message |
| `mini-loader/miniLoader.tsx` | Small inline spinner for buttons/cards |
| `page-loader/PageLoader.tsx` | Page-level loading indicator |
| `progress-bar/ProgressBar.tsx` | Horizontal progress bar for batch operations |

### Top-Level Components (`src/components/`)

| Component | Purpose |
|-----------|---------|
| `navbar.tsx` | Top navigation bar with user menu |
| `sideMenu.tsx` | Left sidebar navigation with route links |
| `NavigationLoader.tsx` | Route transition loading indicator |
| `providers.tsx` | Wraps app with all React Context providers |

---

## 10. Services & Business Logic

### Service Layer (`src/services/`)

| Service | Responsibilities |
|---------|-----------------|
| `interviews.service.ts` | Interview CRUD, question management, Supabase queries |
| `responses.service.ts` | Response creation, retrieval, analytics attachment |
| `analytics.service.ts` | gpt-5-mini transcript analysis, scoring (uses `MODELS.GPT5_MINI`) |
| `users.service.ts` | User CRUD, organization scoping |
| `interviewers.service.ts` | AI interviewer profile management |
| `clients.service.ts` | Organization management |
| `feedback.service.ts` | Post-interview feedback CRUD |
| `ats-job.service.ts` | ATS job posting management, scoring data |
| `company-finder.service.ts` | Company scan CRUD, result persistence |
| `cost.service.ts` | Cost calculation: token cost + web search cost split; `getCostAnalyticsWithCategories()` |
| `api-usage.service.ts` | API call tracking — `saveOpenAIUsage()` (with `searchCalls`), `saveVoiceUsage()`, `saveBlobUploadUsage()` |

### Utility Libraries (`src/lib/`)

| File | Purpose |
|------|---------|
| `auth.ts` | JWT token generation/verification, password hashing, Supabase client factory |
| `openai-client.ts` | Azure OpenAI client (`getOpenAIClient`), OpenAI Direct client (`getOpenAIClientDirect`), `MODELS` constants |
| `normalize-company-key.ts` | Normalises company names to a consistent deduplication key — strips legal suffixes (Ltd, Limited, Pvt, Inc, Corp, GmbH, LLC, etc.), lowercases, collapses whitespace. Used by Company Finder to deduplicate across `cf_company_mentions`, `cf_enrich_queue`, and `company_cache`. |
| `constants.ts` | AI interviewer personality configs (Lisa, Bob), Retell system prompts |
| `logger.ts` | Structured application logging |
| `processing-store.ts` | Module-level pub/sub state — persists ATS/CF processing state across navigation |
| `user-activity-log.ts` | Server-side audit trail for admin actions |

### AI Prompt Templates (`src/lib/prompts/`)

| File | Purpose |
|------|---------|
| `analytics.ts` | Interview transcript analysis — scoring, evaluation |
| `ats-scoring.ts` | Resume-to-job-description scoring prompt |
| `communication-analysis.ts` | Communication skills breakdown |
| `company-finder.ts` | Company extraction (NLP only) + web enrichment prompts |
| `generate-insights.ts` | Interview insight generation |
| `generate-questions.ts` | Interview question generation from job description |

---

## 11. AI & LLM Integration

### Models Used

| Constant | Deployment | Purpose |
|----------|-----------|---------|
| `MODELS.GPT5_MINI` | Azure (`AZURE_OPENAI_DEPLOYMENT_GPT5_MINI`) | All LLM tasks |
| `MODELS.GPT5` | Alias → same Azure deployment | Legacy alias (same model) |
| CF enrichment | OpenAI Direct (`gpt-5-mini` via Responses API) | Web search enrichment |

> **Note:** All OpenAI calls use Azure OpenAI except Company Finder enrichment, which uses the OpenAI Responses API directly for the built-in `web_search` tool.

### Feature → Model Mapping

| Feature | Client | Tool |
|---------|--------|------|
| Interview Question Generation | Azure OpenAI | gpt-5-mini, Chat Completions |
| ATS Resume Scoring (batch) | Azure OpenAI | gpt-5-mini, Chat Completions |
| Post-Interview Analytics | Azure OpenAI | gpt-5-mini, Chat Completions |
| Communication Analysis | Azure OpenAI | gpt-5-mini, Chat Completions |
| Insight Generation | Azure OpenAI | gpt-5-mini, Chat Completions |
| Company Extraction (NLP) | Azure OpenAI | gpt-5-mini, Chat Completions |
| Company Enrichment (web) | OpenAI Direct | gpt-5-mini, Responses API + web_search |

### Web Search Pricing

The company enrichment step uses the OpenAI Responses API with the built-in `web_search` tool:

| Context Size | Cost per Call |
|-------------|--------------|
| low | $0.025 |
| medium (default) | $0.0275 |
| high | $0.030 |

Each enrichment API call may internally trigger multiple sub-searches. Actual search call count is tracked from `response.output` items of type `web_search_call`.

### Retell SDK Integration

| Component | SDK | Purpose |
|-----------|-----|---------|
| Server-side call management | `retell-sdk` (v4.19.0) | Register calls, manage agents, webhook handling |
| Client-side call interface | `retell-client-js-sdk` (v2.0.0) | Browser WebRTC connection to Retell voice agent |

### Voice Provider Switcher

The voice interviewer can run on either Retell or Azure Voice Live. The choice is made server-side per-call inside `/api/register-call` based on the `USE_VOICE_LIVE` env flag — the candidate-side UI in [src/components/call/index.tsx](src/components/call/index.tsx) detects the response shape and instantiates the matching client.

| | Retell (default) | Azure Voice Live |
|---|---|---|
| Trigger | `USE_VOICE_LIVE` unset / false | `USE_VOICE_LIVE=true` |
| Transport | WebRTC via `retell-client-js-sdk` | WebSocket (Realtime API) via `src/lib/voice-live-client.ts` |
| System prompt | `RETELL_AGENT_GENERAL_PROMPT` (Retell dashboard) | `buildVoiceLiveInterviewPrompt()` in [src/lib/constants.ts](src/lib/constants.ts) |
| Voice | Configured per agent in Retell dashboard | `AZURE_VOICELIVE_VOICE` env (any Azure Neural voice, e.g. `en-IN-Diya:DragonHDLatestNeural`) |
| Turn detection | Retell built-in | `server_vad` (threshold 0.7, silence_duration_ms 1200, prefix_padding_ms 300) |
| Transcription | Retell built-in | `whisper-1` (locked to English) |
| Backchanneling ("mm-hmm" mid-turn) | ✅ Platform feature | ❌ Not supported — compensated for via prompt-level per-answer acknowledgments |
| Idle / silence handling | ✅ Platform feature | ✅ Client-side silence watchdog in `voice-live-client.ts` |
| Function calling | N/A (prompt-only ending) | `end_interview(reason)`, `report_refusal(reason)` |
| End-of-call data path | `/api/response-webhook` (server-pushed) | `/api/voice-live/save-call` (browser-pushed) |
| Audio recording | Retell stores recording on its platform | Browser captures via `MediaRecorder`, uploaded incrementally (~15 s append-blob chunks) to Azure Blob Storage during the call via `/api/upload-call-recording`, with an end-of-call full-blob fallback |
| Cost record `service` field | `retell` | `azure-voicelive` |

#### Voice Live client (`src/lib/voice-live-client.ts`)

Self-contained `VoiceLiveClient` class wraps the entire candidate-side voice pipeline:

| Concern | Implementation |
|---------|----------------|
| Mic capture | `AudioWorklet` (`public/audio-worklets/pcm-recorder.js`) downsamples to 24 kHz int16 PCM, base64-encodes, streams as `input_audio_buffer.append` events |
| Agent playback | Decodes streamed `response.audio.delta` int16 PCM chunks, schedules them on `AudioContext.currentTime` with an ~80 ms lead to avoid gaps |
| Echo prevention | Mic track disabled while agent is speaking (`response.audio.delta`) and re-enabled only AFTER the agent's playback queue drains — prevents `server_vad` triggering on the agent's own audio |
| Interruption | `input_audio_buffer.speech_started` flushes the playback queue so the candidate can cut in |
| Tool calls | Accumulates `response.function_call_arguments.delta` chunks, dispatches `end_interview` / `report_refusal` on `.done`, sends matching `function_call_output` back so the Realtime API conversation history stays valid |
| Silence watchdog | After every `response.done` re-enables the mic AND arms a 12 s timer. If no speech detected, sends a `response.create` instructing the agent to gently check in and re-ask the same question. Allows 2 such check-ins before calling `forceEnd("candidate_unresponsive")` (which still delivers a spoken goodbye). Counter resets on every transcribed candidate reply. |
| Graceful ending | When agent calls `end_interview` or `forceEnd()` is invoked, queues a closing "goodbye" `response.create` if not already spoken, and only fires `onEndCall` after that audio finishes streaming |
| Hard time cap | Three independent layers enforce the interview `time_duration`: (1) the agent's own `end_interview`; (2) a wall-clock React countdown in the call page; (3) a tab-throttle-proof `setTimeout(limit + 30 s grace)` inside the client that calls `forceEnd("time_expired")`. The server-side `sweep-stale` cron is the final backstop for a suspended/crashed tab. |
| Recording | Mixes candidate mic + agent PCM into a single mono `MediaStreamAudioDestinationNode`, encoded by `MediaRecorder` into Opus/webm (64 kbps). Each ~15 s chunk is appended to an Azure append-blob during the call (`onRecordingChunk`), with a full-blob upload at session end as fallback. |

---

## 12. Real-Time Video & Audio

| Technology | Purpose |
|-----------|---------|
| Retell AI SDK | Default voice platform for AI interviews (real-time audio streaming) |
| Azure Voice Live API (Realtime) | Alternate voice provider — WebSocket-based PCM streaming, server-side VAD, function calling |
| WebRTC MediaStream API | Captures camera/microphone from browser (both providers) |
| AudioWorklet (`pcm-recorder.js`) | Voice Live only — downsamples mic to 24 kHz int16 PCM before websocket send |
| MediaRecorder API | Records video (WebM 1280×720) and, for Voice Live, the mixed candidate+agent audio (Opus/webm mono) |

### Real-Time Transcription

| Provider | Engine | Notes |
|---------|--------|-------|
| Retell | Built-in speech-to-text | Word-level timing with start/end timestamps |
| Voice Live | `whisper-1` (Azure-hosted) | Hard-locked to English in [src/app/api/register-call/route.ts](src/app/api/register-call/route.ts) (`input_audio_transcription.language: "en"`) so non-English accents don't drift the agent into another language |

### AI Interviewer Pipeline

| Component | Retell path | Voice Live path |
|-----------|-------------|-----------------|
| Voice Conversation | Retell SDK | `VoiceLiveClient` (WebSocket Realtime) |
| Text-to-Speech | Retell's built-in TTS | Azure Neural voice from `AZURE_VOICELIVE_VOICE` |
| Question Generation | gpt-5-mini | gpt-5-mini |
| Live agent model | Configured per agent in Retell dashboard | `AZURE_VOICELIVE_MODEL` env (`gpt-4o-mini-realtime-preview` / `gpt-realtime-mini` / `gpt-5-mini`) |
| Post-Interview Analysis | gpt-5-mini | gpt-5-mini |

### Voice Live conditions that end the interview

1. **Agent invokes `end_interview` tool** (after speaking a goodbye) — reasons: `all_questions_covered`, `candidate_refused_to_answer`, `candidate_requested_end`, `time_expired`.
2. **Closing-message pattern matched** in `src/components/call/index.tsx` — agent spoke a closing-style line without invoking the tool; client drains audio queue and ends.
3. **3 refusals reached** — client-side counter in `onRefusalReported` calls `forceEnd("candidate_refused_to_answer")` if the model didn't end on its own.
4. **Candidate unresponsive** — silence watchdog fires 2 unanswered check-ins, then calls `forceEnd("candidate_unresponsive")` (still delivers a spoken goodbye).
5. **Interview duration cap exceeded** — component-level timer at [src/components/call/index.tsx](src/components/call/index.tsx) against `currentTimeDuration`.
6. **Anti-cheat triggers** — camera off >2 min ends abruptly (no goodbye).
7. **WebSocket error / transport failure** — abrupt end via `fail()` path.
8. **Candidate clicks "End Call" or hangs up.**

---

## 13. Proctoring & Violation Detection

All face detection runs **client-side in the browser** (privacy-preserving).

| Violation Type | Technology | How It Works |
|---------------|------------|-------------|
| Tab Switching | Browser Visibility API | Detects when `document.hidden` becomes true |
| Face Mismatch | face-api.js | Compares reference photo with live video using Euclidean distance |
| Camera Off | Canvas pixel analysis | Extracts video frame, calculates average brightness (< 5 = off) |
| Multiple People | face-api.js | `detectAllFaces()` counts faces in frame |

### Violation Tracking

Violations are recorded per-response in the `response` table:
- `tab_switch_count`, `face_mismatch_count`, `camera_off_count`, `multiple_person_count`
- `violations_summary` (JSONB) — aggregated violation details

---

## 14. ATS Resume Scoring

### Overview

Scores resumes against job descriptions using gpt-5-mini. Supports bulk upload (thousands of resumes) via server-side queue processing with client-side polling.

### Server-Side Queue Flow

```
1.  Recruiter uploads resumes (PDF/DOCX) + selects job posting
2.  Client parses resumes browser-side (pdf-parse / mammoth)
3.  Client uploads files to Azure Blob via `/api/upload-resume` (parallel, with deduplication)
4.  POST /api/ats-scoring/jobs/queue
      → Creates ats_batch_jobs record (status=processing)
      → Creates one ats_job_tasks row per resume (status=pending)
5.  ATSBatchProcessor polls POST /api/ats-scoring/jobs/[id]/process
      → Atomically claims next batch of pending tasks (sets updated_at)
      → Sends resume text + JD to gpt-5-mini (batch of 5)
      → Upserts results into ats_score_items
      → Marks tasks completed / failed
      → Updates job progress via increment_job_progress()
      → Returns { processedCount, failedCount } or { waiting: true }
6.  Client polls until job status = completed
7.  Results loaded from ats_score_items
```

### Key Implementation Details

- **Stale task recovery:** Tasks stuck in `processing` >7 min are reset to `pending` (handles Vercel fn timeout)
- **Atomic claiming:** Uses `update ... where status='pending'` to prevent duplicate processing across parallel workers
- **Retry on errors:** `callWithRetry()` wraps OpenAI calls — 429 quota errors skip immediately (no retry), other 429/5xx retry with exponential backoff (max 3 attempts)
- **maxDuration:** 300s (Vercel Pro limit)
- **Dynatech Relevant filter:** Companies tab has toggle (default ON) filtering to SAP/Dynamics-related companies using word-boundary regex `/\bsap\b/` and `/\bdynamics\b/`
- **CSV export:** Always exports currently filtered data; includes "Is Dynatech Relevant" (True/False) column

---

## 15. Company Finder

### Overview

Extracts company names from resumes via NLP, then enriches them with web research (founding info, industry, technologies, countries). Includes Dynatech Relevant filter showing only SAP/Dynamics-related companies.

### Split Pipeline Architecture

The processing is split into two separate stages to work within Vercel's 300s function timeout:

```
Stage A — Extract (NLP only, no web search)
  POST /api/company-finder/scans/[id]/extract
    → Claims batch of pending resume tasks
    → Sends resume text to gpt-5-mini (Chat Completions)
    → Extracts company names + context
    → Inserts into cf_company_mentions
    → Inserts unique companies into cf_enrich_queue
    → Marks tasks completed

Stage B — Enrich (Web search per company)
  POST /api/company-finder/scans/[id]/enrich
    → Claims batch from cf_enrich_queue
    → Checks cf_company_cache for already-enriched companies
    → Sends cache misses to OpenAI Responses API + web_search
    → Caches results in cf_company_cache
    → Merges with cached results
    → Returns enriched company data

Combined — POST /api/company-finder/scans/[id]/process
    → Runs Extract → Cache lookup → Enrich in one Vercel fn call
    → Used by CFBatchProcessor for the primary flow
```

### Dynatech Relevant Filter

- **Default:** ON (shows only SAP/Dynamics companies)
- **Toggle button:** "Dynatech Relevant" in filter bar
- **Matching logic:** Word-boundary regex against companyName, companyInfo, technologies, and contexts fields:
  ```
  /\bdynamics\b/.test(fields) || /\bsap\b/.test(fields)
  ```
- **"Is Dynatech Relevant" column:** Included in CSV exports (True/False)
- **CSV export:** Always exports currently filtered data only

### Resumes Analyzed Counter

- **During analysis:** Increments progressively as batches complete (`analyzeProgress.current`)
- **After analysis:** Shows total unique resumes processed (from `savedResumeNames`)

### Key Implementation Details

- **Resume uploads (Azure Blob):** Enabled — files uploaded in background immediately on drop; also awaited before analysis starts so resume URLs are available
- **Stale task recovery:** Tasks stuck >3 min (CF extract) or >7 min (process) reset to pending
- **Company cache:** `company_cache` prevents re-enriching already-known companies across scans
- **Company name deduplication:** `normalizeCompanyKey()` strips legal suffixes (Ltd, Limited, Pvt, Inc, Corp, GmbH, LLC, SA, AG, etc.) to produce a consistent key used for upsert conflict detection — e.g. `"Infosys Limited"`, `"Infosys Ltd."`, `"Infosys Pvt Ltd"` all resolve to `"infosys"`
- **Retry:** All OpenAI calls wrapped in `callWithRetry()` — quota 429 skipped, other errors retry with backoff

---

## 16. File Upload & Storage

### Azure Blob Storage

All uploads now go to **Azure Blob Storage** (the same account used for interview
recordings). Vercel Blob is no longer used by any code path. The shared client
lives in [src/lib/azure-blob.ts](src/lib/azure-blob.ts) (`getAzureContainerClient`,
container-name helpers, `buildBlobUrl`); each asset type has its **own container**:

| Asset | Container (default) | Env override | Endpoint |
|-------|--------------------|--------------|----------|
| Interview recordings (audio) | `interview-recordings` | `AZURE_STORAGE_CONTAINER` | `/api/upload-call-recording` |
| Resumes | `interview-resumes` | `AZURE_STORAGE_RESUME_CONTAINER` | `/api/upload-resume` |
| User/candidate images | `interview-images` | `AZURE_STORAGE_IMAGE_CONTAINER` | `/api/upload-user-image` |

All three containers use public-blob read access (URLs resolve directly in
`<img>` / viewers without SAS signing) and are auto-created on first upload via
`createIfNotExists`. They all share `AZURE_STORAGE_ACCOUNT_NAME` /
`AZURE_STORAGE_ACCOUNT_KEY`.

| Upload Type | Endpoint | Purpose |
|------------|----------|---------|
| Resume files | `/api/upload-resume` | PDF/DOCX resume storage with email extraction |
| Profile images | `/api/upload-user-image` | Avatar/profile photo storage |
| CF preview files | Client-side `uploadFilesForPreview()` | Background upload for View Resume buttons (posts to `/api/upload-resume`) |
| CF analysis files | Client-side `uploadResumeFiles()` | Upload before analysis starts (posts to `/api/upload-resume`) |

> **Migration note:** Files uploaded before the Azure migration remain on Vercel
> Blob and keep working via their stored URLs; only new uploads go to Azure. The
> `@vercel/blob` npm package is still installed but unused, and
> `BLOB_READ_WRITE_TOKEN` is deprecated.

### Resume Blob Naming & Deduplication

- **Blob path:** `resumes/{candidateEmail}{ext}` (e.g. `resumes/john.doe@example.com.pdf`) in the `interview-resumes` container
- **Extension preserved** on the blob path so the resume viewer (Office Online / PDF.js) detects the file type from the URL
- **Existence check:** Before uploading, `blockBlob.exists()` is called for that path. If found, the existing Azure URL is returned immediately — no re-upload
- **Fallback key:** If no email can be extracted from the resume text, the sanitized original filename is used as the key

### Supported Resume Formats

| Format | Parser |
|--------|--------|
| PDF | pdf-parse, pdfjs-dist |
| DOCX | mammoth |
| DOC | word-extractor |

### Interview Recording Storage (incremental)

Voice Live audio is **uploaded incrementally during the call**, not only at the
end. The `MediaRecorder` emits a chunk every 15 s; each chunk is appended to a
single **Azure append-blob** at `{interviewId}/{callId}.webm` (`seq=0` creates,
`seq>0` appends). This means most of the recording is already persisted if the
tab closes mid-interview — at most ~15 s of trailing audio is lost. The
end-of-call full-blob upload remains a fallback when no chunk uploaded. The
response row carries a `details.recording_status`
(`uploaded` / `pending` / `empty` / `failed_to_start` / `upload_failed`) so a
recruiter can tell why audio is missing. Upload window: 6 h from row creation.

---

## 17. State Management

### React Context Providers

| Context | State Managed |
|---------|---------------|
| `AuthContext` | User session, login/logout, token refresh |
| `InterviewsContext` | Interview list, CRUD operations |
| `InterviewersContext` | AI interviewer profiles |
| `UsersContext` | Candidates/assignees, bulk operations |
| `ClientsContext` | Organization data |
| `ResponsesContext` | Interview responses & analytics |
| `LoadingContext` | Global loading indicators |

### Module-Level Store (`processing-store.ts`)

A non-React pub/sub store that persists processing state outside the component lifecycle:

```typescript
interface ProcessingState {
  analyzing: boolean;
  progress: { current: number; total: number };
  itemCount: number;
  batchJobActive?: boolean;
  batchTotal?: number;
}
```

- **Purpose:** When a user navigates away mid-analysis and returns, the component restores in-progress UI from this store
- **API:** `getProcessingState(key)`, `setProcessingState(key, update)`, `subscribeProcessing(key, fn)`, `clearProcessingState(key)`
- **Keys:** scanId (Company Finder) or interviewId (ATS Scoring)

---

## 18. Notifications & Email

- **Provider:** Microsoft Power Automate (webhook-based)
- **Endpoint:** `POWER_AUTOMATE_FLOW_URL` environment variable
- **Use cases:** Candidate interview invitations, recruiter completion notifications
- **In-app:** Sonner toast notifications

---

## 19. Cost Tracking & Analytics

### 8 Usage Categories

| Category | Service | What's Tracked |
|----------|---------|----------------|
| `interview_creation` | OpenAI | Question generation tokens |
| `interview_response` | OpenAI | Analytics generation tokens |
| `insights` | OpenAI | Insight generation tokens |
| `communication_analysis` | OpenAI | Communication analysis tokens |
| `voice_call` | Retell | Call duration + Retell API cost |
| `blob_upload` | Vercel | File size → storage cost |
| `ats_scoring` | OpenAI | Resume scoring tokens |
| `company_finder` | OpenAI | Extraction tokens + web search calls |

### Cost Formula

**OpenAI token cost:**
```
cost = (inputTokens / 1000) × input_rate + (outputTokens / 1000) × output_rate
```

**Web search (company_finder enrichment):**
```
cost += searchCalls × $0.0275   (medium context, default)
```

**Total per record:**
```
cost_usd = tokenCost + searchCost
```

### Pricing Constants (`src/types/cost.ts`)

| Model | Input / 1K tokens | Output / 1K tokens |
|-------|------------------|--------------------|
| gpt-5-mini | $0.00025 | $0.002 |
| gpt-5 | $0.00125 | $0.010 |
| Web search call | $0.0275 / call (medium) | — |
| Retell voice | $0.07 / min (fallback) | — |
| Azure Blob Storage | ~$0.018–0.021 / GB / month (hot tier) | — |

### GPT Cost Card Split

The Cost & Analysis dashboard GPT Cost card shows:
- **gpt-5-mini:** Pure token cost + token count
- **Web Search:** Summed web search call fees from `metadata.searchCost`

### Web Search Tracking

Each enrichment API call records:
- `metadata.searchCalls` — count of `web_search_call` items in response output
- `metadata.searchCost` — `searchCalls × $0.0275`
- `metadata.tokenCost` — token-only portion of cost_usd

### Organization ID Attribution

All API routes correctly pass `organization_id` to `api_usage` records:
- Batch routes (`extract`, `enrich`, `process`) look up `organization_id` from `company_finder_scan` using `scanId`
- ATS batch route uses `jobData.organization_id`
- Voice call route uses `interview.organization_id`

---

## 20. Retry & Error Handling

### Custom `callWithRetry()` Function

All batch-processing OpenAI calls are wrapped in a custom retry function present in:
- `src/app/api/company-finder/scans/[id]/extract/route.ts`
- `src/app/api/company-finder/scans/[id]/enrich/route.ts`
- `src/app/api/company-finder/scans/[id]/process/route.ts`
- `src/app/api/ats-scoring/jobs/[interviewId]/process/route.ts`

### Retry Logic

```
1. On error: check if status === 429 AND message contains "quota"/"exceeded"/"billing"
   → YES: throw immediately (quota exhausted — retrying won't help)
   → NO: check if status === 429 or 5xx
       → YES + attempts remaining: wait with exponential backoff (2s × 2^attempt + jitter), retry
       → NO / max attempts reached: throw
```

| Scenario | Action |
|----------|--------|
| 429 quota exceeded | Skip immediately, mark task failed |
| 429 rate limit (temporary) | Retry up to 3–4 times with backoff |
| 5xx server error | Retry up to 3–4 times with backoff |
| Timeout / AbortError | Retry if attempts remain |

---

## 21. Configuration Files

### `next.config.js`

- Redirects `/` → `/dashboard`
- Image optimization allow-list: Clerk (`img.clerk.com`), Azure Blob (`*.blob.core.windows.net`), and the legacy Vercel Blob host
- Webpack: module replacement for `node:` imports, ignores face-api.js & TensorFlow warnings
- ESLint warnings ignored during build
- ESM externals: `loose` mode for Supabase compatibility

### `tsconfig.json`

- Target: ES5, Module: ESNext
- Path alias: `@/*` → `./src/*`
- Strict mode enabled

### `tailwind.config.ts`

- Dark mode: class-based
- CSS variables color system (HSL format)
- Custom animations for accordions
- Plugins: `tailwindcss-animate`, `tailwind-scrollbar-hide`

### `package.json` resolutions

- `@supabase/supabase-js` pinned to `^2.39.3` to avoid auth-helper drift.
- `zod-to-json-schema` pinned to `3.22.5` — newer transitive versions (3.24+) import from `zod/v3`, a subpath that didn't exist until `zod@3.25.x`. The project pins `zod@3.23.8`, so the older `zod-to-json-schema` is what keeps the Vercel build green. Drop this pin if/when `zod` is bumped to `≥3.25`.

---

## 22. Environment Variables

| Variable | Purpose |
|----------|---------|
| `PASSWORD_SALT` | Salt for MD5 password hashing |
| `JWT_SECRET` | JWT token signing secret |
| `NEXT_PUBLIC_LIVE_URL` | Application base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous access key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side admin key |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI API version |
| `AZURE_OPENAI_DEPLOYMENT_GPT5_MINI` | Azure deployment name for gpt-5-mini |
| `OPENAI_API_KEY` | OpenAI Direct API key (for Responses API + web_search) |
| `RETELL_API_KEY` | Retell SDK API key |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token — **deprecated**, no longer used (all storage moved to Azure) |
| `POWER_AUTOMATE_FLOW_URL` | Microsoft Power Automate webhook URL |
| `FIXED_RECRUITER_EMAIL` | Default recruiter notification email |
| `USE_VOICE_LIVE` | Master switch (`true`/`false`) — when `true`, `/api/register-call` returns a Voice Live session instead of registering a Retell call |
| `AZURE_VOICELIVE_ENDPOINT` | Azure AI Foundry / Speech resource endpoint, e.g. `https://<resource>.services.ai.azure.com` |
| `AZURE_VOICELIVE_API_KEY` | API key for the Voice Live realtime endpoint |
| `AZURE_VOICELIVE_MODEL` | Realtime model deployment (e.g. `gpt-4o-mini-realtime-preview`, `gpt-realtime-mini`, `gpt-5-mini`) |
| `AZURE_VOICELIVE_VOICE` | Azure Neural voice name (e.g. `en-IN-Diya:DragonHDLatestNeural`) |
| `AZURE_VOICELIVE_API_VERSION` | API version string (e.g. `2025-10-01`) |
| `AZURE_STORAGE_ACCOUNT_NAME` | Azure Blob Storage account name (3–24 lowercase alphanumeric chars) — shared by recordings, resumes, and images |
| `AZURE_STORAGE_ACCOUNT_KEY` | Azure Blob Storage account key |
| `AZURE_STORAGE_CONTAINER` | Container name for recordings (default `interview-recordings`) |
| `AZURE_STORAGE_RESUME_CONTAINER` | Container name for resumes (default `interview-resumes`) |
| `AZURE_STORAGE_IMAGE_CONTAINER` | Container name for user/candidate images (default `interview-images`) |
| `AZURE_STORAGE_ENDPOINT` | Optional override — defaults to `https://<account>.blob.core.windows.net` |
| `CRON_SECRET` | Secret gating the `sweep-stale` cron endpoint. Vercel Cron auto-injects it as `Authorization: Bearer`. If unset, the sweeper refuses to run (fail closed). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Clerk sign-up redirect URL (legacy — not actively used, auth is custom JWT) |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Clerk post-sign-in redirect (legacy) |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Clerk post-sign-up redirect (legacy) |

---

## 23. Deployment

| Setting | Value |
|---------|-------|
| Platform | Vercel |
| Build Command | `next build` |
| Start Command | `next start` |
| Dev Command | `next dev -H 0.0.0.0` |
| Node Version | >= 20.0.0 |
| Package Manager | Yarn 4.12.0 |
| Max Function Duration | 300s (Vercel Pro) |
| File Storage | Azure Blob Storage (recordings, resumes, images) |
| Database | Supabase (hosted PostgreSQL) |

---

## 24. Data Flow Diagrams

### Candidate Interview Flow

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  Admin    │────▶│ Create       │────▶│ Assign       │
│  Login    │     │ Interview    │     │ Candidates   │
└──────────┘     └──────────────┘     └──────┬───────┘
                                              │
                  ┌───────────────────────────▶│
                  │                            ▼
           ┌──────┴──────┐           ┌─────────────────┐
           │ Email Sent  │◀──────────│ Send Invitation │
           │ to Candidate│           │ (Power Automate)│
           └──────┬──────┘           └─────────────────┘
                  │
                  ▼
           ┌──────────────┐     ┌──────────────┐
           │ Candidate    │────▶│ Retell Voice │
           │ Opens /call  │     │ Session      │
           └──────────────┘     └──────┬───────┘
                                       │
              ┌────────────────────────┘
              ▼
     ┌─────────────────┐     ┌────────────────┐
     │ Proctoring      │     │ AI Conducts    │
     │ (face, tab,     │     │ Interview      │
     │  camera, multi) │     │ (gpt-5-mini)   │
     └────────┬────────┘     └────────┬───────┘
              │                       │
              ▼                       ▼
     ┌─────────────────┐     ┌────────────────┐
     │ Violations      │     │ Webhook fires  │
     │ Recorded        │     │ on completion  │
     └─────────────────┘     └────────┬───────┘
                                      │
                                      ▼
                             ┌────────────────┐
                             │ Analytics      │
                             │ Generated      │
                             │ (gpt-5-mini)   │
                             └────────┬───────┘
                                      │
                                      ▼
                             ┌────────────────┐
                             │ Admin Reviews  │
                             │ Results        │
                             └────────────────┘
```

### ATS Scoring Flow (Server-Side Queue)

```
Upload Resumes ──▶ Parse Text (browser) ──▶ Upload to Blob ──▶ Select Job
                                                  │                  │
                                                  ▼                  ▼
                                           URLs available    POST /jobs/queue
                                                             (create batch job
                                                              + task rows)
                                                                     │
                                                                     ▼
                              ATSBatchProcessor polls /jobs/[id]/process
                                                                     │
                              ┌──────────────────────────────────────┘
                              ▼
                    Claim batch (5 tasks, atomic)
                              │
                              ▼
                    POST to gpt-5-mini
                    (resume text + JD)
                              │
                              ▼
                    Upsert → ats_score_items
                    Update → ats_batch_jobs progress
                              │
                              ▼
                    Return { processedCount }
                              │
                    ┌─────────┘
                    │  repeat until all tasks done
                    ▼
               Job status = completed
               Results loaded from DB
```

### Company Finder Flow (Split Pipeline)

```
Upload Resumes ──▶ Parse (browser) ──▶ Upload to Blob ──▶ POST /scans (create scan)
                                                                     │
                                                                     ▼
                              CFBatchProcessor polls /scans/[id]/process
                                                                     │
                              ┌──────────────────────────────────────┘
                              ▼
                    ── STAGE A: EXTRACT ──
                    Claim resume tasks
                    Send to gpt-5-mini (Chat Completions)
                    Extract company names + context
                    Save to cf_company_mentions
                    Queue unique companies in cf_enrich_queue
                              │
                              ▼
                    ── STAGE B: CACHE LOOKUP ──
                    Check cf_company_cache for known companies
                              │
                    ┌─────────┴──────────┐
                    │ Cache hit          │ Cache miss
                    ▼                   ▼
              Use cached          Send to OpenAI
              company data        Responses API
                                  + web_search tool
                                  → Save to cf_company_cache
                              │
                              ▼
                    Merge cached + newly enriched
                    Save to company_finder_scan.results
                    Update progress
                              │
                    ┌─────────┘
                    │  repeat until all tasks done
                    ▼
               All tasks completed
               Results displayed with Dynatech Relevant filter (default ON)
               Export CSV (filtered data + Is Dynatech Relevant column)
```

---

*Last updated: May 26, 2026*
