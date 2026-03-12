# FoloUp — AI-Powered HR Interview Management System

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
20. [Configuration Files](#20-configuration-files)
21. [Environment Variables](#21-environment-variables)
22. [Deployment](#22-deployment)
23. [Data Flow Diagrams](#23-data-flow-diagrams)

---

## 1. Project Overview

**FoloUp** is an AI-powered HR interview management platform that automates candidate screening through voice-based AI interviews, resume scoring, company research, and real-time proctoring.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| AI Voice Interviews | Retell SDK-powered real-time voice conversations with AI interviewers |
| Real-Time Proctoring | Face verification, tab-switch detection, multi-person detection, camera monitoring |
| ATS Resume Scoring | GPT-4o-based resume scoring against job descriptions with progressive batch processing |
| Company Finder | Automated company extraction from resumes with web-enriched research |
| Candidate Management | Bulk import, assignment, tagging, status tracking |
| Interview Analytics | Transcript analysis, communication scoring, AI-generated insights |
| Cost Tracking | API usage monitoring across OpenAI and Retell services |

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
| Vercel Blob | 2.0.0 | File storage (resumes, images) |

### AI & Voice

| Technology | Version | Purpose |
|-----------|---------|---------|
| OpenAI (GPT-4o) | 4.6.0 | Question generation, scoring, analysis, insights |
| Retell SDK | 4.19.0 | Server-side voice call management |
| Retell Client SDK | 2.0.0 | Browser-side voice call interface |
| LangChain | 0.1.4 | LLM orchestration utilities |

### File Processing

| Technology | Purpose |
|-----------|---------|
| pdf-parse / pdfjs-dist | PDF resume parsing |
| mammoth | DOCX to text conversion |
| word-extractor | Legacy DOC file support |
| papaparse | CSV parsing for bulk imports |
| sharp | Image processing |

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
┌─────────────────────────────────────────────────────────┐
│                      CLIENT BROWSER                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐            │
│  │ Dashboard │  │ Call UI  │  │ Proctoring │            │
│  │  (React)  │  │ (Retell) │  │ (face-api) │            │
│  └─────┬─────┘  └─────┬────┘  └─────┬──────┘            │
└────────┼──────────────┼─────────────┼────────────────────┘
         │              │             │
         ▼              ▼             │
┌─────────────────────────────────────┼────────────────────┐
│              NEXT.JS SERVER (Vercel)│                     │
│  ┌──────────┐  ┌──────────┐  ┌─────┴─────┐              │
│  │ API Routes│  │Middleware │  │ Webhooks  │              │
│  │  (45+)   │  │  (Auth)  │  │ (Retell)  │              │
│  └─────┬─────┘  └──────────┘  └───────────┘              │
│        │                                                  │
│  ┌─────┴──────────────────────────────────────┐          │
│  │            SERVICE LAYER                    │          │
│  │  interviews · responses · analytics         │          │
│  │  users · ats-job · company-finder · cost    │          │
│  └─────┬──────────────┬───────────────┬───────┘          │
└────────┼──────────────┼───────────────┼──────────────────┘
         │              │               │
         ▼              ▼               ▼
┌──────────────┐ ┌────────────┐ ┌──────────────┐
│   Supabase   │ │   OpenAI   │ │ Vercel Blob  │
│ (PostgreSQL) │ │  (GPT-4o)  │ │  (Storage)   │
└──────────────┘ └────────────┘ └──────────────┘
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
│   │   ├── sign-in/[[...sign-in]]/   # Authentication (Clerk)
│   │   ├── sign-up/[[...sign-up]]/   # Registration (Clerk)
│   │   ├── api/                      # 45+ API route handlers
│   │   │   ├── auth/                 # login, signup, logout, session, password reset
│   │   │   ├── interviews/           # CRUD + listing
│   │   │   ├── assignees/            # Candidate assignment & bulk operations
│   │   │   ├── ats-scoring/          # ATS scoring + job management
│   │   │   ├── company-finder/       # Company scan CRUD
│   │   │   ├── users/                # User management + bulk import
│   │   │   ├── cost-analysis/        # Cost metrics + diagnostics
│   │   │   └── ...                   # Webhooks, uploads, AI generation, etc.
│   │   ├── layout.tsx                # Root layout
│   │   └── globals.css               # Global styles
│   │
│   ├── components/
│   │   ├── ui/                       # 30+ shadcn/Radix primitives
│   │   ├── call/                     # Interview call UI
│   │   │   ├── index.tsx             # Main call interface
│   │   │   ├── callInfo.tsx          # Interview & participant info
│   │   │   ├── feedbackForm.tsx      # Post-interview feedback
│   │   │   ├── FaceMismatchWarning.tsx
│   │   │   ├── ViolationWarnings.tsx
│   │   │   └── tabSwitchPrevention.tsx
│   │   ├── dashboard/
│   │   │   ├── interview/            # Interview cards, modals, tables
│   │   │   │   ├── create-popup/     # Multi-step interview creation
│   │   │   │   ├── interviewCard.tsx
│   │   │   │   ├── createInterviewModal.tsx
│   │   │   │   ├── dataTable.tsx
│   │   │   │   ├── editInterview.tsx
│   │   │   │   ├── VideoRecorder.tsx
│   │   │   │   └── ...
│   │   │   ├── interviewer/          # AI interviewer management
│   │   │   ├── user/                 # Candidate management UI
│   │   │   │   ├── userTable.tsx
│   │   │   │   ├── userDetailsModal.tsx
│   │   │   │   ├── bulkImportModal.tsx
│   │   │   │   ├── BulkActionsModals.tsx
│   │   │   │   ├── ResumeViewer.tsx
│   │   │   │   └── ...
│   │   │   ├── ats-scoring/          # ATS scoring UI
│   │   │   │   ├── scoringView.tsx   # Main scoring interface (progressive batch processing)
│   │   │   │   ├── atsResultCard.tsx # Individual score result card
│   │   │   │   ├── jobGrid.tsx       # Job posting grid
│   │   │   │   ├── jobCard.tsx
│   │   │   │   ├── addJobDialog.tsx
│   │   │   │   └── atsScoreChart.tsx
│   │   │   └── company-finder/       # Company finder UI
│   │   │       ├── companyFinderView.tsx
│   │   │       └── scanGrid.tsx
│   │   ├── loaders/                  # Loading components (page, logo, text, mini, progress)
│   │   ├── navbar.tsx
│   │   ├── sideMenu.tsx
│   │   ├── NavigationLoader.tsx
│   │   └── providers.tsx             # Context provider wrapper
│   │
│   ├── contexts/                     # React Context providers
│   │   ├── auth.context.tsx          # Authentication state
│   │   ├── interviews.context.tsx    # Interview CRUD
│   │   ├── interviewers.context.tsx  # AI interviewer state
│   │   ├── users.context.tsx         # Candidate/assignee management
│   │   ├── clients.context.tsx       # Organization state
│   │   ├── responses.context.tsx     # Interview response data
│   │   └── loading.context.tsx       # Global loading state
│   │
│   ├── services/                     # Business logic layer
│   │   ├── interviews.service.ts
│   │   ├── responses.service.ts
│   │   ├── analytics.service.ts      # OpenAI-powered analytics
│   │   ├── users.service.ts
│   │   ├── interviewers.service.ts
│   │   ├── clients.service.ts
│   │   ├── feedback.service.ts
│   │   ├── ats-job.service.ts
│   │   ├── company-finder.service.ts
│   │   ├── cost.service.ts
│   │   └── api-usage.service.ts
│   │
│   ├── lib/                          # Utilities & helpers
│   │   ├── auth.ts                   # JWT, hashing, user CRUD, Supabase client
│   │   ├── constants.ts              # AI interviewer configs & system prompts
│   │   ├── enum.tsx                  # Status enums
│   │   ├── utils.ts                  # General utilities
│   │   ├── logger.ts                 # Application logging
│   │   ├── processing-store.ts       # Module-level processing state (pub/sub)
│   │   ├── compose.tsx               # React composition helpers
│   │   ├── frontend-activity-log.ts  # Client-side activity logging
│   │   ├── user-activity-log.ts      # Server-side audit trail
│   │   └── prompts/                  # AI prompt templates
│   │       ├── analytics.ts
│   │       ├── ats-scoring.ts
│   │       ├── communication-analysis.ts
│   │       ├── company-finder.ts
│   │       ├── generate-insights.ts
│   │       └── generate-questions.ts
│   │
│   ├── hooks/                        # Custom React hooks
│   │   ├── useCameraDetection.ts     # Camera availability monitoring
│   │   ├── useFaceVerification.ts    # Face detection & comparison
│   │   ├── useMultiplePersonDetection.ts # Multi-person in frame
│   │   └── usePageLoading.ts         # Route transition loading
│   │
│   ├── types/                        # TypeScript interfaces
│   │   ├── auth.ts
│   │   ├── interview.ts
│   │   ├── response.ts
│   │   ├── user.ts
│   │   ├── interviewer.ts
│   │   ├── organization.ts
│   │   ├── ats-scoring.ts
│   │   ├── company-finder.ts
│   │   ├── cost.ts
│   │   └── database.types.ts        # Supabase auto-generated
│   │
│   ├── actions/
│   │   └── parse-pdf.ts             # Server action for PDF parsing
│   │
│   └── middleware.ts                 # Auth middleware (route protection)
│
├── migrations/
│   └── original_complete_database_setup.sql  # Full DB schema
│
├── public/                           # Static assets (images, audio, ML models)
├── Documentation/                    # Project documentation
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── components.json                   # shadcn/ui config
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

### Middleware (src/middleware.ts)

**Public routes** (no auth required):
- `/`, `/sign-in`, `/sign-up`
- `/call/*`, `/interview/*` (candidate-facing)
- Select API routes: `register-call`, `response-webhook`, `validate-user`, `upload-resume`, `generate-interview-questions`, `users/bulk-import-noauth`

**Protected routes** (auth required):
- `/dashboard/*` and all sub-routes
- All other API routes

**Behavior:**
- Unauthenticated page requests → redirect to `/sign-in?redirect_url=[original]`
- Unauthenticated API requests → `401 Unauthorized`

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

### Entity Relationship Overview

```
organization (1) ─── (N) user
organization (1) ─── (N) interview
organization (1) ─── (N) interview_assignee

user (1) ─── (N) interview (creator)
interview (1) ─── (N) interview_assignee
interview (1) ─── (N) response
interview (N) ─── (1) interviewer

user (1) ─── (N) user_activity_log
user (1) ─── (N) user_permissions
interview (1) ─── (N) feedback
```

### Tables

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
| first_name, last_name, email | text | Candidate info (email unique) |
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

#### `public.interviewer` — AI interviewer profiles

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| agent_id | text | Retell agent identifier |
| name, description | text | Display info |
| image, audio | text | Avatar & voice sample URLs |
| empathy, exploration, rapport, speed | integer (1-10) | Personality parameters |

#### `public.organization` — Company accounts

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Organization identifier |
| name | text | Company name |
| image_url | text | Logo URL |
| allowed_responses_count | integer | Usage quota |

#### `public.feedback` — Post-interview feedback

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| interview_id | text | Interview FK |
| email | text | Respondent email |
| feedback | text | Written feedback |
| satisfaction | integer | Rating score |

#### `public.user_activity_log` — Audit trail

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| user_id | text | Actor FK |
| action | text | Action type |
| resource_type, resource_id | text | Target resource |
| details | jsonb | Additional context |
| ip_address, user_agent | text | Request metadata |

#### `public.user_permissions` — RBAC permissions

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment ID |
| user_id | text | User FK |
| permission_name | text | Permission identifier |
| granted | boolean | Active flag |
| granted_by | text | Admin who granted |
| granted_at | timestamptz | Grant timestamp |

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
| GET | `/api/interviews` | List all interviews |
| GET/PUT/DELETE | `/api/interviews/[id]` | Single interview CRUD |

### Candidates / Assignees

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assignees` | List all assignees |
| GET/PUT/DELETE | `/api/assignees/[id]` | Single assignee CRUD |
| POST | `/api/assignees/assign-interview` | Assign interview to candidate |
| POST | `/api/assignees/bulk-assign-interview` | Bulk assignment |
| POST | `/api/assignees/bulk-assign-tag` | Bulk tag operations |
| POST | `/api/assignees/bulk-update-status` | Bulk status update |
| POST | `/api/assignees/bulk-delete` | Bulk delete |

### Interview Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register-call` | Register Retell voice call |
| GET | `/api/get-call` | Fetch call details |
| POST | `/api/refetch-call` | Refresh call info |
| POST | `/api/save-response` | Save interview response |
| POST | `/api/response-webhook` | Retell webhook for call completion |

### AI Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate-interview-questions` | Generate questions via GPT-4o |
| POST | `/api/generate-insights` | Generate interview insights |
| POST | `/api/analyze-communication` | Communication skills analysis |

### ATS Scoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ats-scoring` | Get ATS scoring data |
| GET/POST | `/api/ats-scoring/jobs` | List / create job postings |
| GET/DELETE | `/api/ats-scoring/jobs/[interviewId]` | Single job scoring CRUD |

### Company Finder

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/company-finder` | Company search |
| POST | `/api/company-finder/scans` | Create company scan |
| GET/DELETE | `/api/company-finder/scans/[id]` | Scan detail & deletion |

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

### Utilities

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/validate-user` | User validation |
| POST | `/api/log-activity` | Activity logging |
| POST | `/api/log-export` | Export interview logs |
| GET | `/api/get-agent-voice` | Retell agent voice config |
| GET | `/api/cost-analysis` | Cost metrics |
| GET | `/api/cost-analysis/diagnose` | Diagnostic cost analysis |

---

## 8. Client Pages & Routing

### Dashboard (Protected — requires auth)

| Route | Page | Description |
|-------|------|-------------|
| `/dashboard` | Main Dashboard | Interview listing, creation, management |
| `/dashboard/overview` | Analytics Overview | Charts, statistics, response trends |
| `/dashboard/users` | Candidate Management | User table, bulk import, assignments |
| `/dashboard/interviewers` | AI Interviewers | View/create AI interviewer profiles |
| `/dashboard/ats-scoring` | ATS Scoring | Resume scoring against job descriptions |
| `/dashboard/company-finder` | Company Finder | Company research from resumes |
| `/dashboard/cost-analysis` | Cost Analysis | API usage and cost tracking |
| `/dashboard/interviews/[id]` | Interview Detail | Responses, transcripts, analytics |
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

### UI Primitives (`src/components/ui/`)

30+ shadcn/Radix components: `accordion`, `alert-dialog`, `alert`, `avatar`, `badge`, `button`, `card`, `dialog`, `dropdown-menu`, `form`, `input`, `label`, `scroll-area`, `select`, `separator`, `skeleton`, `slider`, `switch`, `table`, `tabs`, `textarea`, `toast`, `toaster`, `tooltip`

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
| `createInterviewCard.tsx` | CTA card to create new interview |
| `createInterviewModal.tsx` | Multi-step interview creation wizard |
| `create-popup/details.tsx` | Step 1: Name, objective, duration, interviewer |
| `create-popup/questions.tsx` | Step 2: Add/edit questions |
| `create-popup/questionCard.tsx` | Individual question editor |
| `dataTable.tsx` | Interview responses table with sorting/actions |
| `editInterview.tsx` | Edit existing interview settings |
| `summaryInfo.tsx` | Interview summary (response count, insights) |
| `sharePopup.tsx` | Shareable interview link modal |
| `questionAnswerCard.tsx` | Q&A review with transcript |
| `VideoRecorder.tsx` | Video recording for video-based interviews |
| `fileUpload.tsx` | Generic file upload component |

### Candidate Management (`src/components/dashboard/user/`)

| Component | Purpose |
|-----------|---------|
| `userTable.tsx` | Full candidate data table with sorting, filtering, pagination |
| `userCard.tsx` | Candidate profile summary card |
| `userDetailsModal.tsx` | Detailed candidate profile with resume, history |
| `createUserModal.tsx` | Add new candidate form |
| `bulkImportModal.tsx` | CSV bulk import with column mapping |
| `BulkActionsModals.tsx` | Bulk delete, status update, tag assignment |
| `ResumeViewer.tsx` | Resume preview in modal |

### ATS Scoring (`src/components/dashboard/ats-scoring/`)

| Component | Purpose |
|-----------|---------|
| `scoringView.tsx` | Main scoring interface — handles resume upload, batch ATS scoring, progressive display, Company Finder integration |
| `atsResultCard.tsx` | Individual resume score card with View Resume button |
| `jobGrid.tsx` | Job posting grid with selection |
| `jobCard.tsx` | Individual job posting card |
| `addJobDialog.tsx` | Create new job posting dialog |
| `atsScoreChart.tsx` | Score distribution visualization |

### Company Finder (`src/components/dashboard/company-finder/`)

| Component | Purpose |
|-----------|---------|
| `companyFinderView.tsx` | Company research interface with scan management |
| `scanGrid.tsx` | Scan results grid layout |

### Layout Components

| Component | Purpose |
|-----------|---------|
| `navbar.tsx` | Top navigation with user menu |
| `sideMenu.tsx` | Sidebar navigation links |
| `NavigationLoader.tsx` | Route transition loading bar |
| `providers.tsx` | Context provider composition wrapper |

---

## 10. Services & Business Logic

### Service Layer (`src/services/`)

| Service | Responsibilities |
|---------|-----------------|
| `interviews.service.ts` | Interview CRUD, question management, Supabase queries |
| `responses.service.ts` | Response creation, retrieval, analytics attachment |
| `analytics.service.ts` | OpenAI-powered transcript analysis, scoring |
| `users.service.ts` | User CRUD, organization scoping |
| `interviewers.service.ts` | AI interviewer profile management |
| `clients.service.ts` | Organization management |
| `feedback.service.ts` | Post-interview feedback CRUD |
| `ats-job.service.ts` | ATS job posting management, scoring data |
| `company-finder.service.ts` | Company scan CRUD, result persistence |
| `cost.service.ts` | Cost calculation across AI services |
| `api-usage.service.ts` | API call tracking and usage metrics |

### Utility Libraries (`src/lib/`)

| File | Purpose |
|------|---------|
| `auth.ts` | JWT token generation/verification, password hashing, Supabase client factory, user CRUD |
| `constants.ts` | AI interviewer personality configs (Lisa, Bob), Retell system prompts |
| `enum.tsx` | `CandidateStatus` enum (NO_STATUS, NOT_SELECTED, POTENTIAL, SELECTED) |
| `utils.ts` | General utilities (cn helper for Tailwind class merging) |
| `logger.ts` | Structured application logging |
| `processing-store.ts` | Module-level pub/sub state store — persists processing state outside React lifecycle for cross-navigation resilience |
| `compose.tsx` | React component composition helpers |
| `frontend-activity-log.ts` | Client-side activity event logging |
| `user-activity-log.ts` | Server-side audit trail for admin actions |

### AI Prompt Templates (`src/lib/prompts/`)

| File | Purpose |
|------|---------|
| `analytics.ts` | Interview transcript analysis prompt — scoring, evaluation |
| `ats-scoring.ts` | Resume-to-job-description scoring prompt |
| `communication-analysis.ts` | Communication skills breakdown prompt |
| `company-finder.ts` | Company extraction & web enrichment prompt |
| `generate-insights.ts` | Interview insight generation prompt |
| `generate-questions.ts` | Interview question generation from job description |

---

## 11. AI & LLM Integration

### OpenAI GPT-4o Usage

| Feature | Prompt File | Description |
|---------|-------------|-------------|
| Interview Question Generation | `generate-questions.ts` | Generates role-specific interview questions from job descriptions |
| ATS Resume Scoring | `ats-scoring.ts` | Scores resumes against job descriptions (0-100 scale) |
| Post-Interview Analytics | `analytics.ts` | Analyzes transcripts for skills, knowledge, communication |
| Communication Analysis | `communication-analysis.ts` | Detailed breakdown of verbal communication skills |
| Insight Generation | `generate-insights.ts` | Generates actionable interview insights |
| Company Finder | `company-finder.ts` | Extracts companies from resumes with web enrichment |

### Retell SDK Integration

| Component | SDK | Purpose |
|-----------|-----|---------|
| Server-side call management | `retell-sdk` (v4.19.0) | Register calls, manage agents, webhook handling |
| Client-side call interface | `retell-client-js-sdk` (v2.0.0) | Browser WebRTC connection to Retell voice agent |

### AI Interviewer Profiles

Pre-configured AI interviewers with personality parameters:

| Parameter | Range | Description |
|-----------|-------|-------------|
| Empathy | 1-10 | Emotional intelligence during interview |
| Exploration | 1-10 | Depth of follow-up questions |
| Rapport | 1-10 | Conversational warmth |
| Speed | 1-10 | Pacing of interview flow |

---

## 12. Real-Time Video & Audio

| Technology | Purpose |
|-----------|---------|
| Retell AI SDK | Core platform for AI voice interviews (real-time audio streaming) |
| WebRTC MediaStream API | Captures camera/microphone from browser |
| MediaRecorder API | Records video as WebM format at 1280x720 |

### Real-Time Transcription

- **Provider:** Retell's built-in speech-to-text engine
- **How:** Retell processes audio server-side and streams transcripts back via WebSocket
- **Format:** Word-level timing with start/end timestamps for each word

### AI Interviewer Pipeline

| Component | Technology |
|-----------|------------|
| Voice Conversation | Retell SDK (real-time AI voice agent) |
| Text-to-Speech | Retell's built-in TTS (voices like "Explorer Lisa", "Empathetic Bob") |
| Question Generation | OpenAI GPT-4o (pre-generates interview questions) |
| Post-Interview Analysis | OpenAI GPT-4o (evaluates candidate responses) |

---

## 13. Proctoring & Violation Detection

All face detection runs **client-side in the browser** (privacy-preserving).

| Violation Type | Technology | How It Works |
|---------------|------------|-------------|
| Tab Switching | Browser Visibility API | Detects when `document.hidden` becomes true |
| Face Mismatch | face-api.js (ML library) | Compares reference photo with live video using Euclidean distance |
| Camera Off | Canvas pixel analysis | Extracts video frame, calculates average brightness (< 5 = off) |
| Multiple People | face-api.js | `detectAllFaces()` counts faces in frame |

### Face Detection Models

| Model | Purpose |
|-------|---------|
| `ssdMobilenetv1` | Fast face detection |
| `faceLandmark68Net` | Detects 68 facial landmarks |
| `faceRecognitionNet` | Generates face descriptors for comparison |

### Custom Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useCameraDetection` | `src/hooks/useCameraDetection.ts` | Monitors camera availability and status |
| `useFaceVerification` | `src/hooks/useFaceVerification.ts` | Compares live feed against reference photo |
| `useMultiplePersonDetection` | `src/hooks/useMultiplePersonDetection.ts` | Detects more than one person in frame |

### Violation Tracking

Violations are recorded per-response in the `response` table:
- `tab_switch_count` — number of tab switches
- `face_mismatch_count` — face verification failures
- `camera_off_count` — camera disabled events
- `multiple_person_count` — multi-person detections
- `violations_summary` (JSONB) — aggregated violation details

---

## 14. ATS Resume Scoring

### Overview

The ATS (Applicant Tracking System) scoring module allows recruiters to upload resumes and score them against job descriptions using GPT-4o.

### Flow

```
1. Upload Resumes (PDF/DOCX)
2. Parse resume text (pdf-parse / mammoth / word-extractor)
3. Upload files to Vercel Blob (parallel, tracked via uploadPromisesRef)
4. Select job posting(s) to score against
5. Batch process: send resume text + job description to GPT-4o
6. Progressive display: results appear as each batch completes
7. Score cards show: score (0-100), breakdown, View Resume button
```

### Key Implementation Details

- **Progressive batch processing:** Resumes are scored in batches; results render as each batch completes using `flushSync` to bypass React 18 automatic batching
- **Pre-upload pattern:** All resumes are uploaded to Vercel Blob BEFORE scoring begins, ensuring "View Resume" buttons are always available
- **Upload deduplication:** `uploadPromisesRef` (useRef<Map>) tracks in-flight uploads to prevent duplicate concurrent uploads
- **Processing state persistence:** Uses module-level `processing-store.ts` (not React state) so progress survives navigation away and back

---

## 15. Company Finder

### Overview

The Company Finder extracts company names from resumes and enriches them with web research data (founding info, industry, size, etc.).

### Flow

```
1. Resumes already uploaded and parsed
2. Batch resumes (CF_BATCH_SIZE = 3 per batch)
3. Process batches with concurrency (CF_CONCURRENCY = 3 workers)
4. Each batch → POST /api/company-finder → GPT-4o extracts + enriches companies
5. Progressive display: companies appear after each batch using flushSync
6. Results aggregated, deduplicated, persisted to database
7. Stats: Resumes Analyzed, Companies Found, filtering, selection
```

### Progressive Display

- Uses `flushSync` from `react-dom` to force synchronous renders after each batch
- Inline progress banner shows batch progress while results display below
- Empty state only shown when NOT analyzing AND no results exist
- `cfScannedResumeNames` tracks ALL analyzed resumes (not just those with companies found)

---

## 16. File Upload & Storage

### Vercel Blob Storage

| Upload Type | Endpoint | Purpose |
|------------|----------|---------|
| Resume files | `/api/upload-resume` | PDF/DOCX resume storage with email extraction |
| Profile images | `/api/upload-user-image` | Avatar/profile photo storage |

### Resume Upload Flow

```
1. File received via FormData
2. Text extracted (pdf-parse / mammoth / word-extractor)
3. Email extracted from resume text (regex)
4. File uploaded to Vercel Blob
5. Blob URL returned → stored in interview_assignee.resume_url
6. Duplicate detection: checks existing assignees by extracted email
```

### Supported Formats

| Format | Parser |
|--------|--------|
| PDF | pdf-parse, pdfjs-dist |
| DOCX | mammoth |
| DOC | word-extractor |

---

## 17. State Management

### React Context Providers

| Context | File | State Managed |
|---------|------|---------------|
| `AuthContext` | `auth.context.tsx` | User session, login/logout, token refresh |
| `InterviewsContext` | `interviews.context.tsx` | Interview list, CRUD operations |
| `InterviewersContext` | `interviewers.context.tsx` | AI interviewer profiles |
| `UsersContext` | `users.context.tsx` | Candidates/assignees, bulk operations |
| `ClientsContext` | `clients.context.tsx` | Organization data |
| `ResponsesContext` | `responses.context.tsx` | Interview responses & analytics |
| `LoadingContext` | `loading.context.tsx` | Global loading indicators |

### Module-Level Store (`processing-store.ts`)

A non-React pub/sub store that persists processing state outside the component lifecycle:

```typescript
interface ProcessingState {
  analyzing: boolean;
  progress: { current: number; total: number };
  itemCount: number;
}
```

- **Purpose:** When a user navigates away mid-analysis and returns, the component restores in-progress UI from this store
- **API:** `getProcessingState(key)`, `setProcessingState(key, update)`, `subscribeProcessing(key, fn)`, `clearProcessingState(key)`
- **Keys:** scanId (Company Finder) or interviewId (ATS Scoring)

### Additional Client State

| Library | Purpose |
|---------|---------|
| TanStack Query | Server state caching & synchronization |
| TanStack Table | Table state (sorting, filtering, pagination) |
| React Hook Form + Zod | Form state & validation |

---

## 18. Notifications & Email

### Email Delivery

- **Provider:** Microsoft Power Automate (webhook-based)
- **Endpoint:** `POWER_AUTOMATE_FLOW_URL` environment variable
- **Use cases:**
  - Candidate interview invitations (`/api/send-assignee-emails`)
  - Recruiter notifications on interview completion (`/api/send-recruiter-notification`)
  - Fixed recruiter email: configured via `FIXED_RECRUITER_EMAIL`

### In-App Notifications

- **Library:** Sonner (toast notifications)
- **Usage:** Success/error/info toasts for user actions

---

## 19. Cost Tracking & Analytics

### API Usage Tracking

| Service | Tracked Metrics |
|---------|----------------|
| OpenAI | Token usage per request, model, cost per 1K tokens |
| Retell | Call duration, per-minute cost |

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/cost-analysis` | Aggregated cost metrics |
| `GET /api/cost-analysis/diagnose` | Detailed diagnostic breakdown |

### Service

- `cost.service.ts` — Calculates costs across AI services
- `api-usage.service.ts` — Tracks individual API call metrics

---

## 20. Configuration Files

### `next.config.js`

- Redirects `/` → `/dashboard`
- Image optimization domains: `clerk.com`, Vercel Blob (`*.public.blob.vercel-storage.com`)
- Webpack: module replacement for `node:` imports, ignores face-api.js & TensorFlow warnings
- ESLint warnings ignored during build
- ESM externals: `loose` mode for Supabase compatibility
- Dev allowed origins: local network IPs

### `tsconfig.json`

- Target: ES5, Module: ESNext
- Path alias: `@/*` → `./src/*`
- Strict mode enabled

### `tailwind.config.ts`

- Dark mode: class-based
- CSS variables color system (HSL format)
- Custom animations for accordions
- Plugins: `tailwindcss-animate`, `tailwind-scrollbar-hide`

### `components.json`

- shadcn/ui configuration
- Style: default, RSC: true
- Tailwind CSS variables enabled

---

## 21. Environment Variables

| Variable | Purpose |
|----------|---------|
| `PASSWORD_SALT` | Salt for MD5 password hashing |
| `JWT_SECRET` | JWT token signing secret |
| `NEXT_PUBLIC_LIVE_URL` | Application base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous access key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side admin key |
| `OPENAI_API_KEY` | OpenAI API key (GPT-4o) |
| `RETELL_API_KEY` | Retell SDK API key |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token |
| `POWER_AUTOMATE_FLOW_URL` | Microsoft Power Automate webhook URL |
| `FIXED_RECRUITER_EMAIL` | Default recruiter notification email |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth (optional/fallback) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Clerk sign-up route |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Post-login redirect |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Post-registration redirect |

---

## 22. Deployment

| Setting | Value |
|---------|-------|
| Platform | Vercel |
| Build Command | `next build` |
| Start Command | `next start` |
| Dev Command | `next dev -H 0.0.0.0` |
| Node Version | >= 20.0.0 |
| Package Manager | Yarn 4.12.0 |
| ESLint | Enabled (warnings ignored in build) |
| File Storage | Vercel Blob |
| Database | Supabase (hosted PostgreSQL) |

---

## 23. Data Flow Diagrams

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
              │
              ▼
     ┌─────────────────┐     ┌────────────────┐
     │ Proctoring      │     │ AI Conducts    │
     │ (face, tab,     │     │ Interview      │
     │  camera, multi) │     │ (GPT-4o + TTS) │
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
                             │ (GPT-4o)       │
                             └────────┬───────┘
                                      │
                                      ▼
                             ┌────────────────┐
                             │ Admin Reviews  │
                             │ Results        │
                             └────────────────┘
```

### ATS Scoring Flow

```
Upload Resumes ──▶ Parse Text ──▶ Upload to Blob ──▶ Select Jobs
                                        │                  │
                                        ▼                  ▼
                                  URLs available    Batch Score (GPT-4o)
                                        │                  │
                                        ▼                  ▼
                                  View Resume      Progressive Results
                                  buttons ready    (flushSync renders)
```

### Company Finder Flow

```
Parsed Resumes ──▶ Batch (3/batch) ──▶ 3 Concurrent Workers
                                              │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                         Worker 1         Worker 2         Worker 3
                         (GPT-4o)         (GPT-4o)         (GPT-4o)
                              │                │                │
                              ▼                ▼                ▼
                        flushSync()      flushSync()      flushSync()
                         render            render            render
                              │                │                │
                              └────────┬───────┘────────────────┘
                                       ▼
                              Aggregated Results
                              (deduplicated, persisted)
```

---

*Last updated: March 12, 2026*
