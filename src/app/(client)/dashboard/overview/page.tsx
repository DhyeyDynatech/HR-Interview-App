"use client";

import React, { useMemo, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth.context";
import { useInterviews } from "@/contexts/interviews.context";
import { useAssignees } from "@/contexts/users.context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { useLoading } from "@/contexts/loading.context";
import {
  PlayCircle,
  Users,
  CheckCircle,
  Clock,
  ArrowRight,
  UserCheck,
  FileText,
  Settings,
  BarChart3,
  ChevronRight,
  DollarSign,
  UserPlus,
  CheckCircle2,
} from "lucide-react";
import { Interview } from "@/types/interview";
import { InterviewAssignee } from "@/types/user";

function DashboardOverview() {
  const { user, isLoading: authLoading } = useAuth();
  const { interviews, interviewsLoading } = useInterviews();
  const { assignees, assigneesLoading } = useAssignees();
  const router = useRouter();
  const { startLoading } = useLoading();
  const [costData, setCostData] = useState<{ monthlyCost: number; todayCost: number } | null>(null);

  const handleNavigation = (path: string) => {
    startLoading();
    router.push(path);
  };

  const fetchCostData = useCallback(async () => {
    if (!user?.organization_id && !user?.id) return;
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

      // Fetch monthly cost
      const monthlyResponse = await fetch("/api/cost-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: user.organization_id || user.id,
          userId: user.id,
          filters: { startDate: startOfMonth },
        }),
      });

      // Fetch today's cost
      const todayResponse = await fetch("/api/cost-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: user.organization_id || user.id,
          userId: user.id,
          filters: { startDate: startOfToday, endDate: endOfToday },
        }),
      });

      let monthlyCost = 0;
      let todayCost = 0;

      if (monthlyResponse.ok) {
        const monthlyResult = await monthlyResponse.json();
        monthlyCost = monthlyResult.summary?.monthlyTotalCost ?? monthlyResult.summary?.totalCost ?? 0;
      }

      if (todayResponse.ok) {
        const todayResult = await todayResponse.json();
        todayCost = todayResult.summary?.totalCost || 0;
      }

      setCostData({ monthlyCost, todayCost });
    } catch (error) {
      console.error("Error fetching cost data:", error);
    }
  }, [user?.organization_id, user?.id]);

  useEffect(() => {
    if (user) {
      fetchCostData();
    }
  }, [user, fetchCostData]);

  const stats = useMemo(() => {
    const totalInterviews = interviews.length;
    const activeInterviews = interviews.filter((i) => i.is_active).length;
    const pausedInterviews = totalInterviews - activeInterviews;
    const totalUsers = assignees.length;

    const completedInterviews = assignees.filter(
      (a) =>
        a.interview_status === "INTERVIEW_COMPLETED" ||
        a.interview_status === "AI_RESPONSE_CAPTURED" ||
        a.interview_status === "REVIEWED"
    ).length;

    const pendingResponses = assignees.filter(
      (a) =>
        a.interview_status === "INTERVIEW_SENT" ||
        a.interview_status === "INTERVIEW_RESENT"
    ).length;

    const selectedCandidates = assignees.filter(
      (a) => a.review_status === "SELECTED"
    ).length;

    const totalResponses = interviews.reduce(
      (sum, interview) => sum + Number(interview.response_count || 0),
      0
    );

    const inProgress = assignees.filter(
      (a) => a.interview_status === "INTERVIEW_SENT" || a.interview_status === "INTERVIEW_RESENT"
    ).length;

    const awaitingResponse = assignees.filter(
      (a) => a.interview_status === "INTERVIEW_SENT"
    ).length;

    const shortlistedToday = assignees.filter(
      (a) => {
        const today = new Date();
        const updated = new Date(a.updated_at);
        return a.review_status === "SELECTED" &&
               updated.toDateString() === today.toDateString();
      }
    ).length;

    // Funnel stats with proper status mapping
    const invited = assignees.filter(
      (a) => a.interview_status === "INTERVIEW_SENT" || a.interview_status === "INTERVIEW_RESENT"
    ).length;

    const completed = completedInterviews;

    const reviewed = assignees.filter(
      (a) => a.interview_status === "REVIEWED" ||
             a.review_status === "SELECTED" ||
             a.review_status === "POTENTIAL" ||
             a.review_status === "NOT_SELECTED"
    ).length;

    const shortlisted = assignees.filter(
      (a) => a.review_status === "POTENTIAL"
    ).length;

    const selected = selectedCandidates;

    const rejected = assignees.filter(
      (a) => a.review_status === "NOT_SELECTED" || a.interview_status === "CANDIDATE_REJECTED"
    ).length;

    const completionRate = totalUsers > 0 ? Math.round((completed / totalUsers) * 100) : 0;
    const selectionRate = totalUsers > 0 ? Math.round((selected / totalUsers) * 100) : 0;

    return {
      totalInterviews,
      activeInterviews,
      pausedInterviews,
      totalUsers,
      completedInterviews,
      pendingResponses,
      selectedCandidates,
      totalResponses,
      inProgress,
      awaitingResponse,
      shortlistedToday,
      invited,
      completed,
      reviewed,
      shortlisted,
      selected,
      rejected,
      completionRate,
      selectionRate,
    };
  }, [interviews, assignees]);

  const recentAssignees = useMemo(() => {
    return [...assignees]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  }, [assignees]);

  const recentInterviews = useMemo(() => {
    return [...interviews]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  }, [interviews]);

  const activeInterviewsList = useMemo(() => {
    return [...interviews]
      .filter((i) => i.is_active)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  }, [interviews]);

  const getInterviewStats = (interview: Interview) => {
    const interviewAssignees = assignees.filter((a) => a.interview_id === interview.id);
    const candidates = interviewAssignees.length;
    const started = interviewAssignees.filter(
      (a) => a.interview_status && a.interview_status !== "NOT_SENT"
    ).length;
    const completed = interviewAssignees.filter(
      (a) =>
        a.interview_status === "INTERVIEW_COMPLETED" ||
        a.interview_status === "AI_RESPONSE_CAPTURED" ||
        a.interview_status === "REVIEWED"
    ).length;
    return { candidates, started, completed };
  };

  const formatDate = (date: string | Date) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const getRelativeTime = (date: string | Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} wer ago`;
    return `${Math.floor(diffDays / 30)} Im ago`;
  };

  const getStatusBadge = (candidate: InterviewAssignee) => {
    if (candidate.review_status === "SELECTED") {
      return <Badge className="bg-green-100 text-green-700 border-0 text-xs font-medium px-2 py-0.5">Shortlisted</Badge>;
    }
    if (candidate.review_status === "NOT_SELECTED") {
      return <Badge className="bg-red-100 text-red-600 border-0 text-xs font-medium px-2 py-0.5">Rejected</Badge>;
    }
    if (candidate.interview_status === "INTERVIEW_COMPLETED" || candidate.interview_status === "AI_RESPONSE_CAPTURED") {
      return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs font-medium px-2 py-0.5">Evaluating</Badge>;
    }
    return <Badge className="bg-gray-100 text-gray-600 border-0 text-xs font-medium px-2 py-0.5">Pending</Badge>;
  };

  const isLoading = authLoading || interviewsLoading || assigneesLoading;

  if (isLoading) {
    return (
      <main className="p-4 md:p-6 pt-2 md:pt-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-6 w-40 bg-gray-200 animate-pulse rounded" />
              <div className="h-4 w-56 bg-gray-200 animate-pulse rounded mt-2" />
            </div>
            <div className="h-9 w-28 bg-gray-200 animate-pulse rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-gray-200 animate-pulse rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 md:p-6 pt-2 md:pt-4 w-full">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg md:text-xl font-semibold text-gray-900">
              Welcome back, {user?.first_name || "User"}
            </h1>
            <p className="text-xs md:text-sm text-gray-500">
              Here's an overview of your interview platform
            </p>
          </div>
        </div>

        {/* Top Stats Row - 5 Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Total Interviews */}
          <Card className="border shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleNavigation("/dashboard")}>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm text-gray-500 font-medium">Total Interviews</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-900 mt-0.5">{stats.totalInterviews}</p>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 truncate">
                    {stats.activeInterviews} Active, {stats.pausedInterviews} paused, closed
                  </p>
                </div>
                <Users className="h-4 w-4 md:h-5 md:w-5 text-gray-400 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          {/* Total Candidates */}
          <Card className="border shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleNavigation("/dashboard/users")}>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm text-gray-500 font-medium">Total Candidates</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-900 mt-0.5">{stats.totalUsers}</p>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5">
                    {stats.inProgress} new today
                  </p>
                </div>
                <Users className="h-4 w-4 md:h-5 md:w-5 text-gray-400 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          {/* Completed Interviews */}
          <Card className="border shadow-sm">
            <CardContent className="p-3 md:p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm text-gray-500 font-medium">Completed Interviews</p>
                  <div className="flex items-baseline gap-1 md:gap-2 mt-0.5">
                    <p className="text-xl md:text-2xl font-bold text-gray-900">{stats.completedInterviews}</p>
                  </div>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    {stats.completionRate}% completion rate
                    <svg className="w-3 h-3 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                      <polyline points="17 6 23 6 23 12"></polyline>
                    </svg>
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-gray-400 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          {/* Pending Responses */}
          <Card className="border shadow-sm">
            <CardContent className="p-3 md:p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm text-gray-500 font-medium">Pending Responses</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-900 mt-0.5">{stats.pendingResponses}</p>
                  <p className="text-[10px] md:text-xs text-orange-500 mt-0.5">
                    {stats.awaitingResponse} Awaited start
                  </p>
                </div>
                <Clock className="h-4 w-4 md:h-5 md:w-5 text-green-500 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          {/* Selected Candidates */}
          <Card className="border shadow-sm cursor-pointer hover:shadow-md transition-shadow col-span-2 md:col-span-1" onClick={() => handleNavigation("/dashboard/users")}>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm text-gray-500 font-medium">Selected Candidates</p>
                  <div className="flex items-baseline gap-1 md:gap-2 mt-0.5">
                    <p className="text-xl md:text-2xl font-bold text-gray-900">{stats.selectedCandidates}</p>
                  </div>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    {stats.selectionRate}% selection rate
                    <svg className="w-3 h-3 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                      <polyline points="17 6 23 6 23 12"></polyline>
                    </svg>
                  </p>
                </div>
                <Users className="h-4 w-4 md:h-5 md:w-5 text-gray-400 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Interview Funnel & Candidate Status Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Interview Funnel Overview */}
          <Card className="lg:col-span-2 border shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4 md:px-5">
              <CardTitle className="text-sm md:text-base font-semibold text-gray-900">Interview Funnel Overview</CardTitle>
            </CardHeader>
            <CardContent className="px-4 md:px-5 pb-3">
              {/* Funnel Bar with Arrow/Chevron Design - 5 Stages */}
              <div className="flex h-[60px] md:h-[68px] relative">
                {/* Invited - Dark Navy */}
                <div className="relative flex-1 min-w-0">
                  <div className="absolute inset-0 bg-[#1e2a4a]" style={{ clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 0 100%)' }} />
                  <div className="relative h-full flex flex-col items-center justify-center text-white px-2 md:px-4">
                    <span className="text-[10px] md:text-xs font-medium text-blue-200">Invited</span>
                    <span className="text-xl md:text-2xl font-bold">{stats.invited}</span>
                  </div>
                </div>

                {/* Completed - Blue */}
                <div className="relative flex-1 min-w-0 -ml-2">
                  <div className="absolute inset-0 bg-[#3b5998]" style={{ clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 0 100%, 15px 50%)' }} />
                  <div className="relative h-full flex flex-col items-center justify-center text-white px-2 md:px-4">
                    <span className="text-[10px] md:text-xs font-medium text-blue-200">Completed</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl md:text-2xl font-bold">{stats.completed}</span>
                      <span className="text-[10px] md:text-xs opacity-80">{stats.totalUsers > 0 ? Math.round((stats.completed / stats.totalUsers) * 100) : 0}%</span>
                    </div>
                  </div>
                </div>

                {/* Reviewed - Cyan */}
                <div className="relative flex-1 min-w-0 -ml-2">
                  <div className="absolute inset-0 bg-[#17a2b8]" style={{ clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 0 100%, 15px 50%)' }} />
                  <div className="relative h-full flex flex-col items-center justify-center text-white px-2 md:px-4">
                    <span className="text-[10px] md:text-xs font-medium">Reviewed</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl md:text-2xl font-bold">{stats.reviewed}</span>
                      <span className="text-[10px] md:text-xs opacity-80">{stats.totalUsers > 0 ? Math.round((stats.reviewed / stats.totalUsers) * 100) : 0}%</span>
                    </div>
                  </div>
                </div>

                {/* Shortlisted - Teal */}
                <div className="relative flex-1 min-w-0 -ml-2">
                  <div className="absolute inset-0 bg-[#20c997]" style={{ clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 0 100%, 15px 50%)' }} />
                  <div className="relative h-full flex flex-col items-center justify-center text-white px-2 md:px-4">
                    <span className="text-[10px] md:text-xs font-medium">Shortlisted</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl md:text-2xl font-bold">{stats.shortlisted}</span>
                      <span className="text-[10px] md:text-xs opacity-80">{stats.totalUsers > 0 ? Math.round((stats.shortlisted / stats.totalUsers) * 100) : 0}%</span>
                    </div>
                  </div>
                </div>

                {/* Selected - Green */}
                <div className="relative flex-1 min-w-0 -ml-2">
                  <div className="absolute inset-0 bg-[#28a745]" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 15px 50%)' }} />
                  <div className="relative h-full flex flex-col items-center justify-center text-white px-2 md:px-4">
                    <span className="text-[10px] md:text-xs font-medium">Selected</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl md:text-2xl font-bold">{stats.selected}</span>
                      <span className="text-[10px] md:text-xs opacity-80">{stats.selectionRate}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rejected Indicator */}
              <div className="flex items-center justify-end mt-3 gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg border border-red-100">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs font-medium text-red-700">Rejected: {stats.rejected}</span>
                  <span className="text-[10px] text-red-500">({stats.totalUsers > 0 ? Math.round((stats.rejected / stats.totalUsers) * 100) : 0}%)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Candidate Status */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4 md:px-5">
              <CardTitle className="text-sm md:text-base font-semibold text-gray-900">Candidate Status</CardTitle>
            </CardHeader>
            <CardContent className="px-4 md:px-5 pb-3">
              <div className="space-y-0">
                {/* Invited */}
                <div
                  className="flex items-center justify-between py-2 md:py-2.5 border-b cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => handleNavigation("/dashboard/users?interviewStatus=INTERVIEW_SENT")}
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <CheckCircle className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-xs md:text-sm font-medium text-gray-700">Invited</p>
                      <p className="text-[10px] md:text-xs text-gray-400">Awaiting response</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs md:text-sm font-semibold text-gray-900">{stats.awaitingResponse}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
                {/* In Progress */}
                <div
                  className="flex items-center justify-between py-2 md:py-2.5 border-b cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => handleNavigation("/dashboard/users?interviewStatus=INTERVIEW_SENT,INTERVIEW_RESENT")}
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <Users className="h-4 w-4 text-gray-400" />
                    <p className="text-xs md:text-sm font-medium text-gray-700">In Progress</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs md:text-sm font-semibold text-gray-900">{stats.inProgress}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
                {/* Completed */}
                <div
                  className="flex items-center justify-between py-2 md:py-2.5 border-b cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => handleNavigation("/dashboard/users?interviewStatus=INTERVIEW_COMPLETED,AI_RESPONSE_CAPTURED,REVIEWED")}
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <UserCheck className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xs md:text-sm font-medium text-gray-700">Completed</p>
                      <p className="text-[10px] md:text-xs text-gray-400">{stats.completionRate}% completion</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:gap-2">
                    <Badge variant="outline" className="text-[10px] md:text-xs bg-gray-100 text-gray-600 border-0 px-1.5">CONS</Badge>
                    <span className="text-xs md:text-sm font-semibold text-gray-900">{stats.completed}</span>
                    <span className="text-[10px] text-gray-400">({stats.completionRate})</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
                {/* Shortlisted Today */}
                <div
                  className="flex items-center justify-between py-2 md:py-2.5 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => handleNavigation("/dashboard/users?reviewStatus=SELECTED")}
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <UserCheck className="h-4 w-4 text-teal-500" />
                    <div>
                      <p className="text-xs md:text-sm font-medium text-gray-700">Shortlisted Today</p>
                      <p className="text-[10px] md:text-xs text-gray-400">{stats.shortlistedToday}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs md:text-sm font-semibold text-gray-900">{stats.shortlistedToday}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

     
        {/* Recent Interviews, Recent Candidates, Cost & Alerts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Recent Interviews */}
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4 md:px-5">
              <CardTitle className="text-sm md:text-base font-semibold text-gray-900">Recent Interviews</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleNavigation("/dashboard")}
                className="text-indigo-600 hover:text-indigo-700 h-7 md:h-8 text-xs md:text-sm"
              >
                View All
                <ArrowRight className="h-3 w-3 md:h-4 md:w-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="px-4 md:px-5 pb-4">
              {recentInterviews.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <FileText className="h-8 w-8 md:h-10 md:w-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-xs md:text-sm">No interviews yet</p>
                </div>
              ) : (
                <div className="space-y-2 md:space-y-3">
                  {recentInterviews.map((interview) => {
                    const interviewAssignees = assignees.filter((a) => a.interview_id === interview.id);
                    return (
                      <div
                        key={interview.id}
                        className="flex items-center justify-between p-2.5 md:p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                        onClick={() => handleNavigation(`/dashboard/interviews/${interview.id}`)}
                      >
                        <div className="flex items-center gap-2 md:gap-3 min-w-0">
                          <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                            <PlayCircle className="h-4 w-4 md:h-5 md:w-5 text-indigo-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-xs md:text-sm text-gray-900 truncate">{interview.name}</p>
                            <p className="text-[10px] md:text-xs text-gray-500 truncate">{interviewAssignees.length} candidates</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <p className="text-[10px] md:text-xs text-gray-500">{formatDate(interview.created_at)}</p>
                          <p className="text-[10px] md:text-xs text-gray-400">{interview.is_active ? "Active" : "Paused"}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Candidates */}
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4 md:px-5">
              <CardTitle className="text-sm md:text-base font-semibold text-gray-900">Recent Candidates</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-indigo-600 hover:text-indigo-700 h-7 md:h-8 text-xs md:text-sm"
                onClick={() => handleNavigation("/dashboard/users")}
              >
                View All
                <ArrowRight className="h-3 w-3 md:h-4 md:w-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="px-4 md:px-5 pb-4">
              {recentAssignees.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <Users className="h-8 w-8 md:h-10 md:w-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-xs md:text-sm">No candidates yet</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {recentAssignees.map((candidate) => {
                    const initials = `${candidate.first_name?.[0] || ""}${candidate.last_name?.[0] || ""}`.toUpperCase();
                    const candidateName = `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim();
                    return (
                      <div
                        key={candidate.id}
                        className="flex items-center justify-between py-2.5 md:py-3 border-b last:border-0 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                        onClick={() => handleNavigation(`/dashboard/users?search=${encodeURIComponent(candidateName)}`)}
                      >
                        <div className="flex items-center gap-2 md:gap-3 min-w-0">
                          <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-medium text-xs md:text-sm flex-shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-xs md:text-sm text-gray-900 truncate">{candidate.first_name} {candidate.last_name}</p>
                            <p className="text-[10px] md:text-xs text-gray-500 truncate">{candidate.email}</p>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cost & Usage Snapshot */}
          <Card className="border shadow-sm md:col-span-2 lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4 md:px-5">
              <CardTitle className="text-sm md:text-base font-semibold text-gray-900">Cost & Usage Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="px-4 md:px-5 pb-4">
              <div className="space-y-4">
                {/* Monthly Cost */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Monthly Cost</p>
                      <p className="text-xl font-bold text-gray-900">${costData?.monthlyCost?.toFixed(2) || "0.00"}</p>
                    </div>
                  </div>
                </div>

                {/* Today's Cost */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <Clock className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Today&apos;s Cost</p>
                      <p className="text-xl font-bold text-gray-900">${costData?.todayCost?.toFixed(2) || "0.00"}</p>
                    </div>
                  </div>
                </div>

                {/* View All Button */}
                <Button
                  variant="outline"
                  className="w-full h-9 text-sm"
                  onClick={() => handleNavigation("/dashboard/cost-analysis")}
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  View All
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Quick Actions */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4 md:px-5">
            <CardTitle className="text-sm md:text-base font-semibold text-gray-900">Alerts & Quick Actions</CardTitle>
            <p className="text-[10px] md:text-xs text-gray-400">Enters, at stated ncparvive, whip proode hore</p>
          </CardHeader>
          <CardContent className="px-4 md:px-5 pb-4">
            <div className="flex flex-wrap gap-2 md:gap-3">
              <Button variant="outline" className="h-8 md:h-9 gap-1.5 md:gap-2 text-xs md:text-sm px-3" onClick={() => handleNavigation("/dashboard")}>
                <PlayCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-indigo-600" />
                New Interview
              </Button>
              <Button variant="outline" className="h-8 md:h-9 gap-1.5 md:gap-2 text-xs md:text-sm px-3" onClick={() => handleNavigation("/dashboard/users")}>
                <UserPlus className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-600" />
                Invite Candidates
              </Button>
              <Button variant="outline" className="h-8 md:h-9 gap-1.5 md:gap-2 text-xs md:text-sm px-3" onClick={() => handleNavigation("/dashboard/cost-analysis")}>
                <FileText className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-600" />
                View Reports
              </Button>
              <Button variant="outline" className="h-8 md:h-9 gap-1.5 md:gap-2 text-xs md:text-sm px-3" onClick={() => handleNavigation("/dashboard/interviewers")}>
                <Settings className="h-3.5 w-3.5 md:h-4 md:w-4 text-purple-600" />
                Configure AI Interviewer
              </Button>
              <Button variant="outline" className="h-8 md:h-9 gap-1.5 md:gap-2 text-xs md:text-sm px-3" onClick={() => handleNavigation("/dashboard/cost-analysis")}>
                <BarChart3 className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600" />
                Cost Analysis
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default DashboardOverview;
