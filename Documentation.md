# FoloUp - AI-Powered HR Interview Management System

## Overview

FoloUp is an advanced AI-powered interview management platform that enables HR teams and recruiters to conduct automated voice interviews with candidates. The system uses AI interviewers (Explorer Lisa and Empathetic Bob) powered by Retell SDK, OpenAI GPT-4o for question generation and analysis, and real-time face verification to ensure interview integrity.

---

## 1. Main Functionalities

### Core Features

#### Interview Management
- **Create Interviews**: Set up custom interviews with specific objectives, questions, and duration
- **Interview Configuration**:
  - Customize interview questions (auto-generated via OpenAI GPT-4o or manual)
  - Set interview duration and objectives
  - Choose AI interviewer (Explorer Lisa or Empathetic Bob)
  - Configure branding (logo, theme colors)
  - Set interview as anonymous or named
  - Generate unique interview URLs with readable slugs
- **Interview Analytics**: View detailed analytics including:
  - Overall candidate scores (0-100)
  - Communication skills assessment
  - Question-by-question summaries
  - Soft skills evaluation
  - Interview transcripts and insights
  - Aggregated insights across all responses

#### AI-Powered Interviewers
- **Explorer Lisa**: Female AI interviewer with high exploration and rapport traits
- **Empathetic Bob**: Male AI interviewer with high empathy and rapport traits
- **Dynamic Conversation**: AI interviewers ask follow-up questions based on candidate responses
- **Voice Integration**: Natural voice conversations via Retell AI
- **LLM-Powered**: Uses GPT-4o for intelligent conversation flow
- **Customizable Traits**: Rapport, exploration, empathy, and speed ratings (1-10 scale)

#### Candidate/Assignee Management
- **Bulk Import**: Import candidates via CSV file with validation
- **Assignee Management**:
  - Assign candidates to specific interviews
  - Track interview status (Not Sent, Sent, Completed, Reviewed)
  - Review status tracking (No Status, Not Selected, Potential, Selected)
  - Tag management for organizing candidates
  - Allow/disallow interview retakes
  - Applicant ID auto-generation
- **Bulk Operations**:
  - Bulk assign interviews to multiple candidates
  - Bulk update status
  - Bulk assign tags
  - Bulk delete with confirmation
- **Email Notifications**: Automated email sending via Power Automate
- **Candidate Profiles**: Store candidate information including photos, resumes, contact details, and notes
- **Resume Upload**: PDF resume upload with parsing capabilities

#### Real-Time Interview Features
- **Voice Call Integration**: Powered by Retell SDK for real-time voice conversations
- **Face Verification**:
  - Real-time face detection using face-api.js
  - Reference photo capture before interview
  - Face mismatch warnings during interview
  - Multiple person detection in frame
  - Camera availability monitoring with countdown alerts
- **Proctoring Features**:
  - Tab switch detection and counting
  - Camera off detection with configurable alerts
  - Multiple person detection
  - Violation event logging with timestamps
  - Comprehensive violations summary
- **Live Transcript**: Real-time transcription of interview conversations
- **Video Recording**: Optional video recording capability

#### Response Analysis
- **AI-Powered Analytics**:
  - Communication skills scoring (0-10)
  - Overall performance scoring (0-100)
  - Question-specific summaries
  - Soft skills assessment
  - Sentiment analysis
- **Interview Insights**: Automated generation of candidate insights
- **Response Export**: Export interview data and analytics
- **Feedback Collection**: Post-interview feedback forms with satisfaction ratings

#### User Management
- **Authentication**: Custom JWT-based authentication system with Supabase
- **Role-Based Access Control**: Four user roles:
  - Admin: Full access to all features
  - Manager: Manage interviews and candidates
  - Interviewer: View assigned interviews and responses
  - Viewer: Read-only access
- **User Status**: Active, Inactive, Pending, Suspended states
- **Profile Management**: User profiles with avatar upload
- **Password Reset**: Email-based password reset flow with token expiration
- **Activity Logging**: Comprehensive audit trail of user actions
- **User Permissions**: Fine-grained permission system

#### Dashboard and Reporting
- **Overview Dashboard**:
  - Total interviews, responses, and candidates
  - Cost breakdown charts
  - Recent activity
- **Interview Dashboard**: List and manage all interviews
- **Users/Assignees Dashboard**: Manage candidates with filtering and search
- **Cost Analysis Dashboard**:
  - Real-time cost tracking by category
  - GPT token usage (input/output)
  - Voice call duration and costs
  - Filter by date range, category, interview
  - Cost export functionality
- **Response Tracking**: Monitor candidate responses and completion status

#### Cost Tracking
- **API Usage Tracking**:
  - Track OpenAI token consumption
  - Track Retell voice minutes
  - Track Vercel Blob storage usage
- **Cost Categories**:
  - Interview creation
  - Interview responses
  - Insights generation
  - Communication analysis
  - Voice calls
  - Blob uploads
- **Pricing Models**:
  - GPT-4o: $2.50 per 1M input tokens, $10 per 1M output tokens
  - Retell voice: $0.07 per minute

---

## 2. How to Setup

### Prerequisites

- **Node.js**: Version 20.0.0 or higher
- **Yarn**: Version 4.12.0 (package manager)
- **Supabase Account**: For database and authentication
- **Retell API Account**: For voice call functionality
- **OpenAI API Key**: For question generation and analysis
- **Vercel Blob Storage** (optional): For file storage
- **Power Automate** (optional): For email notifications

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd FoloUp
```

### Step 2: Install Dependencies

```bash
yarn install
```

### Step 3: Environment Variables Setup

Create a `.env.local` file in the root directory with the following variables:

#### Required Environment Variables

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Retell SDK Configuration
RETELL_API_KEY=your_retell_api_key

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Application URLs
NEXT_PUBLIC_LIVE_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Password Security
PASSWORD_SALT=your_custom_password_salt
```

#### Optional Environment Variables

```env
# Vercel Blob Storage (for file uploads)
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token

# Power Automate (for email notifications)
POWER_AUTOMATE_FLOW_URL=your_power_automate_flow_url

# Fixed Recruiter Email (for notifications)
FIXED_RECRUITER_EMAIL=recruiter@company.com
```

### Step 4: Database Setup

1. **Create Supabase Project**:
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Note down your project URL and API keys

2. **Run Database Migrations**:
   - Execute the SQL script in `migrations/original_complete_database_setup.sql` in your Supabase SQL editor
   - This will create all necessary tables, functions, and sequences

3. **Verify Database Schema**:
   - Ensure the following tables are created:
     - `user` - Application users
     - `interview` - Interview configurations
     - `interview_assignee` - Candidates assigned to interviews
     - `interviewer` - AI interviewer profiles
     - `response` - Interview responses and analytics
     - `feedback` - Post-interview feedback
     - `organization` - Organization/company data
     - `user_activity_log` - Audit trail
     - `user_permissions` - Fine-grained permissions

### Step 5: Create AI Interviewers

After setting up the database, you need to create the AI interviewers (Explorer Lisa and Empathetic Bob):

1. Start the development server:
```bash
yarn dev
```

2. Make a GET request to create interviewers:
```bash
curl http://localhost:3000/api/create-interviewer
```

This will:
- Create LLM models in Retell
- Create AI agents (Explorer Lisa and Empathetic Bob) in Retell
- Store interviewer information in your database

### Step 6: Run the Development Server

```bash
yarn dev
```

The application will be available at `http://localhost:3000`

### Step 7: Build for Production

```bash
yarn build
yarn start
```

---

## 3. Deployment on Vercel

### Prerequisites for Vercel Deployment

- Vercel account ([vercel.com](https://vercel.com))
- GitHub/GitLab/Bitbucket repository connected to Vercel
- All environment variables configured

### Step 1: Connect Repository to Vercel

1. Log in to your Vercel account
2. Click "Add New Project"
3. Import your Git repository
4. Vercel will automatically detect it as a Next.js project

### Step 2: Configure Environment Variables

In your Vercel project settings:

1. Go to **Settings** > **Environment Variables**
2. Add all the environment variables from your `.env` file:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RETELL_API_KEY`
   - `OPENAI_API_KEY`
   - `NEXT_PUBLIC_LIVE_URL`
   - `NEXT_PUBLIC_APP_URL`
   - `PASSWORD_SALT`
   - And any optional variables you're using

3. **Important**: Set environment variables for all environments (Production, Preview, Development)

### Step 3: Configure Build Settings

Vercel will automatically detect Next.js, but verify these settings:

- **Framework Preset**: Next.js
- **Build Command**: `yarn build`
- **Output Directory**: `.next`
- **Install Command**: `yarn install`

### Step 4: Update NEXT_PUBLIC_LIVE_URL

After deployment, update `NEXT_PUBLIC_LIVE_URL` in Vercel environment variables to your production domain:
```
NEXT_PUBLIC_LIVE_URL=https://your-project.vercel.app
```

### Step 5: Deploy

1. Push your code to the connected Git repository
2. Vercel will automatically trigger a deployment
3. Monitor the deployment in the Vercel dashboard

### Step 6: Post-Deployment Setup

1. **Create Interviewers**:
   - After first deployment, visit: `https://your-domain.vercel.app/api/create-interviewer`
   - This initializes Explorer Lisa and Empathetic Bob in your production environment

2. **Verify Database Connection**:
   - Ensure your Supabase project allows connections from your Vercel domain
   - Check Supabase RLS (Row Level Security) policies if needed

3. **Test Webhooks**:
   - Configure Retell webhook URL: `https://your-domain.vercel.app/api/response-webhook`
   - This enables automatic response capture after interviews

### Troubleshooting Vercel Deployment

**Issue: Build fails with module resolution errors**
- Ensure all dependencies are in `package.json`
- Check that `yarn.lock` is committed

**Issue: Environment variables not working**
- Verify variables are set in Vercel dashboard
- Restart deployment after adding new variables
- Check variable names match exactly (case-sensitive)

**Issue: API routes returning 500 errors**
- Check Vercel function logs
- Verify all required environment variables are set
- Ensure Supabase and Retell API keys are valid

**Issue: Face-api.js not loading**
- This is expected - face-api.js loads models at runtime
- Models are stored in `/public/models/` directory

---

## 4. Additional Important Information

### Technology Stack

- **Framework**: Next.js 14.2.20 (React 18)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 3.3.0
- **UI Components**:
  - Radix UI (Accordion, Dialog, Dropdown, etc.)
  - shadcn/ui
  - Material-UI (MUI)
  - NextUI
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Custom JWT-based auth with Supabase
- **Voice AI**: Retell SDK 4.19.0
- **AI/ML**:
  - OpenAI API (GPT-4o)
  - face-api.js (face detection)
- **File Storage**: Vercel Blob Storage
- **Email**: Power Automate (Microsoft)
- **State Management**: React Context API, TanStack Query
- **Form Handling**: React Hook Form with Zod validation

### Project Structure

```
FoloUp/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (client)/           # Authenticated dashboard routes
│   │   │   ├── dashboard/
│   │   │   │   ├── overview/   # Dashboard home with stats
│   │   │   │   ├── users/      # Candidate/assignee management
│   │   │   │   ├── interviewers/ # AI interviewer selection
│   │   │   │   └── cost-analysis/ # Cost tracking dashboard
│   │   │   ├── interviews/     # Interview details and management
│   │   │   ├── profile/        # User profile
│   │   │   ├── sign-in/        # Login page
│   │   │   └── sign-up/        # Registration page
│   │   ├── (user)/             # Public interview routes
│   │   │   └── call/           # Interview call interface
│   │   └── api/                # API routes (41+ endpoints)
│   ├── components/
│   │   ├── call/               # Interview call components
│   │   ├── dashboard/          # Dashboard components
│   │   │   ├── interview/      # Interview CRUD components
│   │   │   └── user/           # User/assignee management
│   │   ├── loaders/            # Loading state components
│   │   └── ui/                 # Reusable shadcn/ui components
│   ├── contexts/               # React Context providers
│   │   ├── auth.context.tsx
│   │   ├── interviews.context.tsx
│   │   ├── users.context.tsx
│   │   ├── interviewers.context.tsx
│   │   └── responses.context.tsx
│   ├── hooks/                  # Custom React hooks
│   │   ├── useFaceVerification.ts
│   │   ├── useCameraDetection.ts
│   │   └── useMultiplePersonDetection.ts
│   ├── lib/                    # Utility functions and constants
│   │   ├── auth.ts             # Authentication utilities
│   │   ├── constants.ts        # App constants
│   │   └── prompts/            # AI prompt templates
│   ├── services/               # Business logic services
│   │   ├── interviews.service.ts
│   │   ├── users.service.ts
│   │   ├── responses.service.ts
│   │   ├── interviewers.service.ts
│   │   ├── cost.service.ts
│   │   └── api-usage.service.ts
│   └── types/                  # TypeScript type definitions
├── public/
│   ├── models/                 # face-api.js ML models
│   └── audio/                  # Interviewer voice samples
├── migrations/                 # Database migration scripts
└── package.json
```

### Key API Endpoints

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/signup` - User registration
- `POST /api/auth/logout` - Logout
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

#### Interviews
- `GET /api/interviews` - List interviews
- `POST /api/interviews` - Create interview
- `GET /api/interviews/[id]` - Get interview details
- `PUT /api/interviews/[id]` - Update interview
- `DELETE /api/interviews/[id]` - Delete interview

#### Assignees (Candidates)
- `GET /api/assignees` - List assignees
- `POST /api/assignees` - Create assignee
- `PUT /api/assignees/[id]` - Update assignee
- `DELETE /api/assignees/[id]` - Delete assignee
- `POST /api/assignees/bulk-assign-interview` - Bulk assign interviews
- `POST /api/assignees/bulk-update-status` - Bulk status update
- `POST /api/assignees/bulk-delete` - Bulk delete

#### Interview Calls
- `POST /api/register-call` - Register interview call with Retell
- `GET /api/get-call` - Get call details
- `POST /api/save-response` - Save response after interview
- `POST /api/response-webhook` - Webhook for call completion

#### AI Generation
- `POST /api/generate-interview-questions` - Generate questions via GPT-4o
- `POST /api/generate-insights` - Generate insights from responses
- `POST /api/analyze-communication` - Analyze communication skills
- `GET /api/create-interviewer` - Initialize AI interviewers

#### Cost and Analytics
- `POST /api/cost-analysis` - Get cost breakdown
- `POST /api/log-activity` - Log user activity

### Security Considerations

1. **Authentication**: Custom JWT tokens with MD5 signature
2. **Password Hashing**: MD5 with configurable salt
3. **API Security**: Bearer token authentication on protected routes
4. **Activity Logging**: Comprehensive audit trail for compliance
5. **Environment Variables**: Never commit `.env` to Git
6. **Row Level Security**: Configure Supabase RLS policies

### Organization Plans

- **Free Plan**: Limited to 10 responses
- **Pro Plan**: Pay-per-response model with full features

### Browser Compatibility

- **Chrome/Edge**: Fully supported (recommended)
- **Firefox**: Supported
- **Safari**: Supported (may have camera/microphone limitations)
- **Mobile**: Limited support (desktop recommended for interviews)

### Monitoring and Logging

- Activity logging to Supabase `user_activity_log` table
- API usage tracking for cost analysis
- Error logging via custom logger utility
- Vercel function logs for API debugging

### Support and Contact

- **Email**: founders@folo-up.co
- **Issues**: Report via GitHub issues

---

## Quick Start Checklist

- [ ] Install Node.js 20+ and Yarn
- [ ] Clone repository
- [ ] Install dependencies (`yarn install`)
- [ ] Set up Supabase project
- [ ] Run database migrations
- [ ] Configure environment variables
- [ ] Create AI interviewers (`/api/create-interviewer`)
- [ ] Test locally (`yarn dev`)
- [ ] Deploy to Vercel
- [ ] Configure production environment variables
- [ ] Set up Retell webhook
- [ ] Test end-to-end interview flow

---

## License

Private - All rights reserved

---

**Last Updated**: January 2025
**Version**: 0.1.0
