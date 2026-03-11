'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Plus, Grid3X3, List, Users, UserCheck, UserX, Briefcase, Upload, Download, Tag, ExternalLink, Trash2, Mail, CheckSquare, Square, FileText, CheckCircle2, AlertTriangle, MoreHorizontal, Edit, Trash, UserPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import { useAssignees } from '@/contexts/users.context';
import { useInterviews } from '@/contexts/interviews.context';
import { Interview } from '@/types/interview';
import { AssigneeCard } from '@/components/dashboard/user/userCard';
import { CreateAssigneeModal } from '@/components/dashboard/user/createUserModal';
import { BulkImportModal } from '@/components/dashboard/user/bulkImportModal';
import { BulkActionsModals } from '@/components/dashboard/user/BulkActionsModals';
import { InterviewAssignee } from '@/types/user';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ResponseService } from '@/services/responses.service';
import { useToast } from '@/components/ui/use-toast';

export default function AssigneesPage() {
  const { assignees, assigneesLoading, refreshAssignees, searchAssignees, getAssigneesByStatus, deleteAssignee } = useAssignees();
  const { interviews, interviewsLoading } = useInterviews();
  const searchParams = useSearchParams();

  // Explicitly type interviews for TypeScript
  const typedInterviews: Interview[] = interviews;
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [interviewFilter, setInterviewFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [reviewFilter, setReviewFilter] = useState<string>('NO_STATUS');
  const [interviewStatusFilter, setInterviewStatusFilter] = useState<string>('all');

  // Read URL parameters and set filters
  useEffect(() => {
    const interviewStatusParam = searchParams.get('interviewStatus');
    const reviewStatusParam = searchParams.get('reviewStatus');

    if (interviewStatusParam) {
      setInterviewStatusFilter(interviewStatusParam);
    }
    if (reviewStatusParam) {
      setReviewFilter(reviewStatusParam);
    }
  }, [searchParams]);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<InterviewAssignee | null>(null);
  const [isBulkImportModalOpen, setIsBulkImportModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewAssignee, setViewAssignee] = useState<InterviewAssignee | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [assigneeToDelete, setAssigneeToDelete] = useState<InterviewAssignee | null>(null);
  const [assigneesWithResponses, setAssigneesWithResponses] = useState<Set<string>>(new Set());
  const [assigneeCallIds, setAssigneeCallIds] = useState<Map<string, string>>(new Map()); // email -> call_id mapping
  const [assigneeInterviewDates, setAssigneeInterviewDates] = useState<Map<string, string>>(new Map()); // email -> interview_date mapping
  const [selectedAssignees, setSelectedAssignees] = useState<Set<number>>(new Set());
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  
  // Bulk action modals
  const [isBulkStatusModalOpen, setIsBulkStatusModalOpen] = useState(false);
  const [isBulkInterviewModalOpen, setIsBulkInterviewModalOpen] = useState(false);
  const [isBulkTagModalOpen, setIsBulkTagModalOpen] = useState(false);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const isModalOpenRef = React.useRef(false);
  
  React.useEffect(() => {
    isModalOpenRef.current = isCreateModalOpen || isBulkImportModalOpen || isViewModalOpen || deleteConfirmOpen;
  }, [isCreateModalOpen, isBulkImportModalOpen, isViewModalOpen, deleteConfirmOpen]);

  // Listen for review status updates from interview details page
  React.useEffect(() => {
    function handleReviewStatusUpdate() {
      // Refresh assignees when review status is updated
      refreshAssignees();
    };

    window.addEventListener('assigneeReviewStatusUpdated', handleReviewStatusUpdate);


    return () => {
      window.removeEventListener('assigneeReviewStatusUpdated', handleReviewStatusUpdate);
    };
  }, [refreshAssignees]);

  // Check which assignees have given interviews (have responses) and store their call_ids and interview dates
  React.useEffect(() => {
    // Don't run this expensive check while any modal is open to prevent re-renders
    if (isModalOpenRef.current) {
      console.log('⏸️ Deferring assignee response check (modal is open)');

      return;
    }

    const checkAssigneesWithResponses = async () => {
      const assigneesWithResponsesSet = new Set<string>();
      const callIdsMap = new Map<string, string>();
      const interviewDatesMap = new Map<string, string>();
      
      for (const assignee of assignees) {
        if (assignee.interview_id && assignee.email) {
          try {
            const responses = await ResponseService.getAllResponses(assignee.interview_id);
            const matchingResponse = responses.find(
              (response) => response.email?.toLowerCase() === assignee.email.toLowerCase()
            );
            if (matchingResponse) {
              assigneesWithResponsesSet.add(assignee.email.toLowerCase());
              // Store the call_id for this assignee
              callIdsMap.set(assignee.email.toLowerCase(), matchingResponse.call_id);
              // Store the interview taken date (created_at from response)
              if (matchingResponse.created_at) {
                const interviewDate = new Date(matchingResponse.created_at).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric'
                });
                interviewDatesMap.set(assignee.email.toLowerCase(), interviewDate);
              }
            }
          } catch (error) {
            console.error(`Error checking responses for assignee ${assignee.email}:`, error);
          }
        }
      }
      
      setAssigneesWithResponses(assigneesWithResponsesSet);
      setAssigneeCallIds(callIdsMap);
      setAssigneeInterviewDates(interviewDatesMap);
    };

    if (assignees.length > 0) {
      checkAssigneesWithResponses();
    }
  }, [assignees]);


  // Get unique tags from assignees
  const uniqueTags = React.useMemo(() => {
    const tags = assignees
      .map(a => a.tag)
      .filter((tag): tag is string => !!tag && tag.trim() !== '');


    return Array.from(new Set(tags)).sort();
  }, [assignees]);

  // Filter assignees based on search, status, interview, and tag
  // Use useMemo instead of useEffect to avoid unnecessary state updates
  const filteredAssignees = React.useMemo(() => {
    let filtered = assignees;

    if (statusFilter !== 'all') {
      filtered = filtered.filter(assignee => assignee.status === statusFilter);
    }

    if (interviewFilter !== 'all') {
      if (interviewFilter === 'unassigned') {
        filtered = filtered.filter(assignee => !assignee.interview_id);
      } else if (interviewFilter === 'assigned') {
        filtered = filtered.filter(assignee => assignee.interview_id);
      } else {
        filtered = filtered.filter(assignee => assignee.interview_id === interviewFilter);
      }
    }

    if (tagFilter !== 'all') {
      if (tagFilter === 'no-tag') {
        filtered = filtered.filter(assignee => !assignee.tag || assignee.tag.trim() === '');
      } else {
        filtered = filtered.filter(assignee => assignee.tag === tagFilter);
      }
    }

    if (reviewFilter !== 'all') {
      if (reviewFilter === 'no-review' || reviewFilter === 'NO_STATUS') {
        filtered = filtered.filter(assignee => !assignee.review_status || assignee.review_status === 'NO_STATUS');
      } else {
        filtered = filtered.filter(assignee => assignee.review_status === reviewFilter);
      }
    }

    // Filter by interview status (from URL parameter)
    if (interviewStatusFilter !== 'all') {
      const statuses = interviewStatusFilter.split(',');
      filtered = filtered.filter(assignee =>
        assignee.interview_status && statuses.includes(assignee.interview_status)
      );
    }

    if (searchTerm) {
      filtered = filtered.filter(assignee =>
        assignee.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assignee.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assignee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (assignee.tag && assignee.tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (assignee.applicant_id && assignee.applicant_id.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }


    return filtered;
  }, [assignees, searchTerm, statusFilter, interviewFilter, tagFilter, reviewFilter, interviewStatusFilter]);

  // Group filtered assignees by interview name (merge same-named interviews into one group)
  const groupedAssignees = React.useMemo(() => {
    const groups: { interviewId: string | null; interviewName: string; assignees: InterviewAssignee[] }[] = [];
    const groupMap = new Map<string, InterviewAssignee[]>();

    for (const assignee of filteredAssignees) {
      const interviewName = assignee.interview_id
        ? (typedInterviews.find((i) => i.id === assignee.interview_id)?.name || assignee.interview_id)
        : null;
      const key = interviewName ?? '__unassigned__';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(assignee);
    }

    // Assigned interviews first (sorted by interview name), then unassigned last
    const assignedKeys = Array.from(groupMap.keys()).filter((k) => k !== '__unassigned__');
    assignedKeys.sort((a, b) => a.localeCompare(b));

    for (const key of assignedKeys) {
      const assigneesInGroup = groupMap.get(key)!;
      // Use the interview_id of the first assignee as representative (for actions)
      const representativeId = assigneesInGroup[0]?.interview_id || null;
      groups.push({
        interviewId: representativeId,
        interviewName: key,
        assignees: assigneesInGroup,
      });
    }

    if (groupMap.has('__unassigned__')) {
      groups.push({
        interviewId: null,
        interviewName: 'Unassigned',
        assignees: groupMap.get('__unassigned__')!,
      });
    }

    return groups;
  }, [filteredAssignees, typedInterviews]);

  function toggleGroupCollapse(groupKey: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  function handleSearch(value: string) {
    setSearchTerm(value);
  };

  function handleStatusFilter(value: string) {
    setStatusFilter(value);
  };

  function handleInterviewFilter(value: string) {
    setInterviewFilter(value);
  };

  function handleTagFilter(value: string) {
    setTagFilter(value);
  };

  function handleReviewFilter(value: string) {
    setReviewFilter(value);
  };

  function getReviewStatusBadge(reviewStatus: string | null | undefined) {
    if (!reviewStatus || reviewStatus === 'NO_STATUS') {

      return <Badge variant="outline" className="bg-gray-100 text-gray-700">To Be Reviewed</Badge>;
    }
    switch (reviewStatus) {
      case 'NOT_SELECTED':

        return <Badge variant="outline" className="bg-red-100 text-red-700">Not Selected</Badge>;
      case 'POTENTIAL':

        return <Badge variant="outline" className="bg-yellow-100 text-yellow-700">Potential</Badge>;
      case 'SELECTED':

        return <Badge variant="outline" className="bg-green-100 text-green-700">Selected</Badge>;
      default:

        return <Badge variant="outline">To Be Reviewed</Badge>;
    }
  };

  function getInitials(firstName: string, lastName: string) {

    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  function handleDeleteAssignee(assignee: InterviewAssignee) {
    setAssigneeToDelete(assignee);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (assigneeToDelete) {
      const success = await deleteAssignee(assigneeToDelete.id);
      if (success) {
        toast({
          title: 'Success',
          description: 'Assignee deleted successfully',
        });
        refreshAssignees();
      } else {
        toast({
          title: 'Error',
          description: 'Failed to delete assignee',
          variant: 'destructive',
        });
      }
      setDeleteConfirmOpen(false);
      setAssigneeToDelete(null);
    }
  };

  // Checkbox selection handlers
  function handleSelectAssignee(assigneeId: number) {
    setSelectedAssignees(prev => {
      const newSet = new Set(prev);
      if (newSet.has(assigneeId)) {
        newSet.delete(assigneeId);
      } else {
        newSet.add(assigneeId);
      }
      console.log('✅ Selected assignees:', Array.from(newSet), 'Count:', newSet.size);


      return newSet;
    });
  };

  function handleSelectAll() {
    if (selectedAssignees.size === filteredAssignees.length) {
      setSelectedAssignees(new Set());
    } else {
      setSelectedAssignees(new Set(filteredAssignees.map(a => a.id)));
    }
  };

  function handleSelectGroup(groupAssignees: InterviewAssignee[]) {
    setSelectedAssignees(prev => {
      const next = new Set(prev);
      const groupIds = groupAssignees.map(a => a.id);
      const allSelected = groupIds.every(id => next.has(id));
      if (allSelected) {
        groupIds.forEach(id => next.delete(id));
      } else {
        groupIds.forEach(id => next.add(id));
      }
      return next;
    });
  }

  const isAllSelected = filteredAssignees.length > 0 && selectedAssignees.size === filteredAssignees.length;
  const isIndeterminate = selectedAssignees.size > 0 && selectedAssignees.size < filteredAssignees.length;

  // Send emails to selected assignees
  const handleSendEmails = async () => {
    if (selectedAssignees.size === 0) {
      toast({
        title: 'No Selection',
        description: 'Please select at least one assignee to send emails',
        variant: 'destructive',
      });

      return;
    }

    const selected = filteredAssignees.filter(a => selectedAssignees.has(a.id));
    const assigneesWithInterviews = selected.filter(a => a.interview_id && a.email);

    if (assigneesWithInterviews.length === 0) {
      toast({
        title: 'No Valid Assignees',
        description: 'Selected assignees must have an interview assigned and an email address',
        variant: 'destructive',
      });

      return;
    }

    setIsSendingEmails(true);
    try {
      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await fetch('/api/send-assignee-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          assignees: assigneesWithInterviews.map(a => ({
            id: a.id,
            email: a.email,
            first_name: a.first_name,
            last_name: a.last_name,
            interview_id: a.interview_id,
          })),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Emails sent successfully to ${assigneesWithInterviews.length} assignee(s)`,
        });
        setSelectedAssignees(new Set());
      } else {
        toast({
          title: 'Error',
          description: data.error || 'Failed to send emails',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error sending emails:', error);
      toast({
        title: 'Error',
        description: 'Failed to send emails. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSendingEmails(false);
    }
  };

  // Export function
  function exportToCSV() {
    const headers = ['Name', 'Email', 'Phone', 'Applicant ID', 'Status', 'Review Status', 'Tag', 'Interview', 'Assigned At', 'Notes'];
    const rows = filteredAssignees.map(assignee => [
      `${assignee.first_name} ${assignee.last_name}`,
      assignee.email,
      assignee.phone || '',
      assignee.applicant_id || '',
      assignee.status,
      assignee.review_status || 'NO_STATUS',
      assignee.tag || '',
      assignee.interview_id ? (typedInterviews.find(i => i.id === assignee.interview_id)?.name || assignee.interview_id) : 'Unassigned',
      assignee.assigned_at ? new Date(assignee.assigned_at).toLocaleString() : '',
      assignee.notes || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `assignees_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  function handleEditAssignee(assignee: InterviewAssignee) {
    setSelectedAssignee(assignee);
    setIsCreateModalOpen(true);
  };

  function handleViewDetails(assignee: InterviewAssignee) {
    setViewAssignee(assignee);
    setIsViewModalOpen(true);
  };
  
  function handleCreateNew() {
    setSelectedAssignee(null);
    setIsCreateModalOpen(true);
  };

  function getStats() {
    const total = assignees.length;
    const active = assignees.filter(a => a.status === 'active').length;
    const assigned = assignees.filter(a => a.interview_id).length;
    const unassigned = assignees.filter(a => !a.interview_id).length;


    return { total, active, assigned, unassigned };
  };

  const stats = getStats();

  if (assigneesLoading) {

    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-2 text-gray-600">Loading assignees...</p>
        </div>
      </div>
    );
  }
  // View information to view button


  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Interview Assignees</h1>
            <p className="text-sm md:text-base text-gray-600">Manage users who can be assigned interviews</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm"
              className="flex items-center gap-2 text-xs sm:text-sm"
              onClick={() => setIsBulkImportModalOpen(true)} 
            >
              <Upload className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Import CSV</span>
              <span className="sm:hidden">Import</span>
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="flex items-center gap-2 text-xs sm:text-sm"
              onClick={exportToCSV} 
            >
              <Download className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </Button>
            <Button size="sm" className="flex items-center gap-2 text-xs sm:text-sm" onClick={handleCreateNew}>
              <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Add Assignee</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>

        {/* Bulk Actions Bar - Shows when assignees are selected */}
        {selectedAssignees.size > 0 && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-3 md:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                <span className="text-sm sm:text-base font-medium text-blue-900">
                  {selectedAssignees.size} assignee(s) selected
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  disabled={isSendingEmails}
                  size="sm"
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
                  onClick={handleSendEmails}
                >
                  <Mail className="h-4 w-4" />
                  {isSendingEmails ? 'Sending...' : 'Send Email'}
                </Button>
                <Button 
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setIsBulkStatusModalOpen(true)}
                >
                  <Edit className="h-4 w-4" />
                  Change Status
                </Button>
                <Button 
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setIsBulkInterviewModalOpen(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  Assign Interview
                </Button>
                <Button 
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setIsBulkTagModalOpen(true)}
                >
                  <Tag className="h-4 w-4" />
                  Assign Tag
                </Button>
                <Button 
                  variant="destructive"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setIsBulkDeleteConfirmOpen(true)}
                >
                  <Trash className="h-4 w-4" />
                  Delete
                </Button>
                <Button 
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setSelectedAssignees(new Set())}
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <UserCheck className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active</p>
                <p className="text-2xl font-bold">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <UserCheck className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Assigned</p>
                <p className="text-2xl font-bold">{stats.assigned}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <UserX className="h-5 w-5 text-gray-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Unassigned</p>
                <p className="text-2xl font-bold">{stats.unassigned}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="space-y-4">
            {/* Search and View Toggle */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex-1 w-full">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search assignees..."
                    value={searchTerm}
                    className="pl-10 h-10 text-sm"
                    onChange={(e) => handleSearch(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  size="sm"
                  className="h-10 flex-1 sm:flex-initial"
                  onClick={() => setViewMode('grid')}
                >
                  <Grid3X3 className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Grid</span>
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'default' : 'outline'}
                  size="sm"
                  className="h-10 flex-1 sm:flex-initial"
                  onClick={() => setViewMode('table')}
                >
                  <List className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">List</span>
                </Button>
              </div>
            </div>
            
            {/* Filter Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 whitespace-nowrap min-w-fit">
                  <UserCheck className="h-4 w-4" />
                  Status
                </label>
                <Select value={statusFilter} onValueChange={handleStatusFilter}>
                  <SelectTrigger className="flex-1 h-9">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Interview Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 whitespace-nowrap min-w-fit">
                  <Briefcase className="h-4 w-4" />
                  Interview
                </label>
                <Select value={interviewFilter} onValueChange={handleInterviewFilter}>
                  <SelectTrigger className="flex-1 h-9">
                    <SelectValue placeholder="Filter by interview" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Interviews</SelectItem>
                    <SelectItem value="assigned">Has Interview Assigned</SelectItem>
                    <SelectItem value="unassigned">No Interview Assigned</SelectItem>
                    {!interviewsLoading && typedInterviews.length > 0 && (
                      <>
                        <SelectItem value="separator" className="border-t my-1" disabled>
                          ──────────
                        </SelectItem>
                        {typedInterviews.map((interview) => (
                          <SelectItem key={interview.id} value={interview.id}>
                            {interview.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Tag Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 whitespace-nowrap min-w-fit">
                  <Tag className="h-4 w-4" />
                  Department / Tag
                </label>
                <Select value={tagFilter} onValueChange={handleTagFilter}>
                  <SelectTrigger className="flex-1 h-9">
                    <SelectValue placeholder="Filter by tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tags</SelectItem>
                    <SelectItem value="no-tag">No Tag</SelectItem>
                    {uniqueTags.length > 0 && (
                      <>
                        <SelectItem value="separator" className="border-t my-1" disabled>
                          ──────────
                        </SelectItem>
                        {uniqueTags.map((tag) => (
                          <SelectItem key={tag} value={tag}>
                            {tag}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Review Status Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 whitespace-nowrap min-w-fit">
                  <CheckCircle2 className="h-4 w-4" />
                  Review Status
                </label>
                <Select value={reviewFilter} onValueChange={handleReviewFilter}>
                  <SelectTrigger className="flex-1 h-9">
                    <SelectValue placeholder="Filter by review" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reviews</SelectItem>
                    <SelectItem value="no-review">No Review</SelectItem>
                    <SelectItem value="NO_STATUS">To Be Reviewed</SelectItem>
                    <SelectItem value="NOT_SELECTED">Not Selected</SelectItem>
                    <SelectItem value="POTENTIAL">Potential</SelectItem>
                    <SelectItem value="SELECTED">Selected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Active Filters Display */}
            {(statusFilter !== 'all' || interviewFilter !== 'all' || tagFilter !== 'all' || reviewFilter !== 'all' || interviewStatusFilter !== 'all') && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <span className="text-sm text-gray-600">Active filters:</span>
                {statusFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Status: {statusFilter}
                    <button
                      className="ml-1 hover:text-red-500"
                      onClick={() => setStatusFilter('all')}
                    >
                      ×
                    </button>
                  </Badge>
                )}
                {interviewFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Interview: {interviewFilter === 'assigned' ? 'Assigned' : interviewFilter === 'unassigned' ? 'Unassigned' : typedInterviews.find(i => i.id === interviewFilter)?.name || interviewFilter}
                    <button
                      className="ml-1 hover:text-red-500"
                      onClick={() => setInterviewFilter('all')}
                    >
                      ×
                    </button>
                  </Badge>
                )}
                {tagFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Tag: {tagFilter === 'no-tag' ? 'No Tag' : tagFilter}
                    <button
                      className="ml-1 hover:text-red-500"
                      onClick={() => setTagFilter('all')}
                    >
                      ×
                    </button>
                  </Badge>
                )}
                {reviewFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Review: {reviewFilter === 'no-review' ? 'No Review' : reviewFilter === 'NO_STATUS' ? 'To Be Reviewed' : reviewFilter === 'NOT_SELECTED' ? 'Not Selected' : reviewFilter === 'POTENTIAL' ? 'Potential' : reviewFilter === 'SELECTED' ? 'Selected' : reviewFilter}
                    <button
                      className="ml-1 hover:text-red-500"
                      onClick={() => setReviewFilter('all')}
                    >
                      ×
                    </button>
                  </Badge>
                )}
                {interviewStatusFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Interview Status: {interviewStatusFilter.includes(',') ? 'Multiple' : interviewStatusFilter.replace(/_/g, ' ')}
                    <button
                      className="ml-1 hover:text-red-500"
                      onClick={() => setInterviewStatusFilter('all')}
                    >
                      ×
                    </button>
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => {
                    setStatusFilter('all');
                    setInterviewFilter('all');
                    setTagFilter('all');
                    setReviewFilter('all');
                    setInterviewStatusFilter('all');
                  }}
                >
                  Clear all
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'grid' | 'table')}>
        <TabsContent value="grid" className="space-y-4">
          {filteredAssignees.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No assignees found</h3>
                <p className="text-gray-600 mb-4">
                  {searchTerm || statusFilter !== 'all' 
                    ? 'Try adjusting your search or filter criteria.'
                    : 'Get started by adding your first assignee.'
                  }
                </p>
                {!searchTerm && statusFilter === 'all' && (
                  <Button onClick={handleCreateNew}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Assignee
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {filteredAssignees.length > 0 && (
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <button
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                    onClick={handleSelectAll}
                  >
                    {isAllSelected ? (
                      <CheckSquare className="h-5 w-5 text-blue-600" />
                    ) : isIndeterminate ? (
                      <div className="h-5 w-5 border-2 border-blue-600 bg-blue-100 rounded flex items-center justify-center">
                        <div className="h-2 w-2 bg-blue-600 rounded" />
                      </div>
                    ) : (
                      <Square className="h-5 w-5 text-gray-400" />
                    )}
                    <span>Select All ({selectedAssignees.size} selected)</span>
                  </button>
                </div>
              )}
              {groupedAssignees.map((group) => {
                const groupKey = group.interviewId || 'unassigned';
                const isCollapsed = collapsedGroups.has(groupKey);
                return (
                <div key={groupKey} className="space-y-3">
                  {/* Group Header */}
                  <div className="flex items-center gap-2 px-1 w-full hover:bg-gray-50 rounded-md py-1.5 transition-colors">
                    <button
                      className="flex items-center"
                      onClick={(e) => { e.stopPropagation(); handleSelectGroup(group.assignees); }}
                      title={`Select all in ${group.interviewName}`}
                    >
                      {group.assignees.every(a => selectedAssignees.has(a.id)) ? (
                        <CheckSquare className="h-4 w-4 text-blue-600" />
                      ) : group.assignees.some(a => selectedAssignees.has(a.id)) ? (
                        <div className="h-4 w-4 border-2 border-blue-600 bg-blue-100 rounded flex items-center justify-center">
                          <div className="h-1.5 w-1.5 bg-blue-600 rounded-sm" />
                        </div>
                      ) : (
                        <Square className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    <button
                      className="flex items-center gap-2 flex-1 text-left"
                      onClick={() => toggleGroupCollapse(groupKey)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      )}
                      <Briefcase className="h-4 w-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-gray-700">
                        {group.interviewName}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        {group.assignees.length}
                      </Badge>
                    </button>
                  </div>
                  {/* Group Grid */}
                  {!isCollapsed && (
                  <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                    {group.assignees.map((assignee) => {
                      const callId = assigneeCallIds.get(assignee.email.toLowerCase());
                      const interviewDate = assigneeInterviewDates.get(assignee.email.toLowerCase());

                      return (
                        <AssigneeCard
                          key={assignee.id}
                          assignee={assignee}
                          interviews={typedInterviews}
                          hasGivenInterview={assigneesWithResponses.has(assignee.email.toLowerCase())}
                          callId={callId}
                          interviewDate={interviewDate}
                          isSelected={selectedAssignees.has(assignee.id)}
                          onEdit={handleEditAssignee}
                          onViewDetails={handleViewDetails}
                          onSelect={() => handleSelectAssignee(assignee.id)}
                        />
                      );
                    })}
                  </div>
                  )}
                </div>
                );
              })}
            </>
          )}
        </TabsContent>
        
        <TabsContent value="table" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Assignees Table</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <div className="inline-block min-w-full align-middle px-4 md:px-0">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 w-12 sticky left-0 bg-white z-10">
                        <button
                          onClick={handleSelectAll}
                          className="flex items-center"
                          title="Select All"
                        >
                          {isAllSelected ? (
                            <CheckSquare className="h-5 w-5 text-blue-600" />
                          ) : isIndeterminate ? (
                            <div className="h-5 w-5 border-2 border-blue-600 bg-blue-100 rounded flex items-center justify-center">
                              <div className="h-2 w-2 bg-blue-600 rounded" />
                            </div>
                          ) : (
                            <Square className="h-5 w-5 text-gray-400" />
                          )}
                        </button>
                      </th>
                      <th className="text-left p-2 whitespace-nowrap">Profile</th>
                      <th className="text-left p-2 whitespace-nowrap">Name</th>
                      <th className="text-left p-2 whitespace-nowrap">Email</th>
                      <th className="text-left p-2 whitespace-nowrap hidden lg:table-cell">Applicant ID</th>
                      <th className="text-left p-2 whitespace-nowrap">Status</th>
                      <th className="text-left p-2 whitespace-nowrap hidden md:table-cell">Review</th>
                      <th className="text-left p-2 whitespace-nowrap hidden md:table-cell">Tag</th>
                      <th className="text-left p-2 whitespace-nowrap hidden lg:table-cell">Assignment</th>
                      <th className="text-left p-2 whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedAssignees.map((group) => {
                      const groupKey = group.interviewId || 'unassigned';
                      const isCollapsed = collapsedGroups.has(groupKey);
                      return (
                      <React.Fragment key={groupKey}>
                        {/* Group header row */}
                        <tr className="bg-gray-50 border-b hover:bg-gray-100 transition-colors">
                          <td colSpan={10} className="p-2 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                className="flex items-center"
                                onClick={(e) => { e.stopPropagation(); handleSelectGroup(group.assignees); }}
                                title={`Select all in ${group.interviewName}`}
                              >
                                {group.assignees.every(a => selectedAssignees.has(a.id)) ? (
                                  <CheckSquare className="h-4 w-4 text-blue-600" />
                                ) : group.assignees.some(a => selectedAssignees.has(a.id)) ? (
                                  <div className="h-4 w-4 border-2 border-blue-600 bg-blue-100 rounded flex items-center justify-center">
                                    <div className="h-1.5 w-1.5 bg-blue-600 rounded-sm" />
                                  </div>
                                ) : (
                                  <Square className="h-4 w-4 text-gray-400" />
                                )}
                              </button>
                              <button
                                className="flex items-center gap-2 flex-1 text-left cursor-pointer"
                                onClick={() => toggleGroupCollapse(groupKey)}
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="h-4 w-4 text-gray-500" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-gray-500" />
                                )}
                                <Briefcase className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-semibold text-gray-700">
                                  {group.interviewName}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {group.assignees.length}
                                </Badge>
                              </button>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && group.assignees.map((assignee) => (
                      <tr key={assignee.id} className="border-b hover:bg-gray-50">
                        <td className="p-2 sticky left-0 bg-white z-10">
                          <button
                            className="flex items-center"
                            onClick={() => handleSelectAssignee(assignee.id)}
                          >
                            {selectedAssignees.has(assignee.id) ? (
                              <CheckSquare className="h-5 w-5 text-blue-600" />
                            ) : (
                              <Square className="h-5 w-5 text-gray-400" />
                            )}
                          </button>
                        </td>
                        <td className="p-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={assignee.avatar_url}
                              alt={`${assignee.first_name} ${assignee.last_name}`}
                            />
                            <AvatarFallback className="bg-blue-100 text-blue-600 text-xs">
                              {getInitials(assignee.first_name, assignee.last_name)}
                            </AvatarFallback>
                          </Avatar>
                        </td>
                        <td className="p-2">
                          <div>
                            <div className="font-medium">
                              {assignee.first_name} {assignee.last_name}
                            </div>
                            {assignee.phone && (
                              <div className="text-sm text-gray-500">{assignee.phone}</div>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="max-w-[150px] truncate" title={assignee.email}>
                            {assignee.email}
                          </div>
                        </td>
                        <td className="p-2 hidden lg:table-cell">
                          {assignee.applicant_id ? (
                            <span className="text-sm font-mono text-gray-700">{assignee.applicant_id}</span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant={assignee.status === 'active' ? 'default' : 'secondary'}>
                            {assignee.status}
                          </Badge>
                        </td>
                        <td className="p-2 hidden md:table-cell">
                          {getReviewStatusBadge(assignee.review_status)}
                        </td>
                        <td className="p-2 hidden md:table-cell">
                          {assignee.tag ? (
                            <Badge variant="outline" className="text-purple-600">
                              {assignee.tag}
                            </Badge>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-2 hidden lg:table-cell">
                          {assignee.interview_id ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="text-green-600">
                                Assigned
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {typedInterviews.find(i => i.id === assignee.interview_id)?.name || assignee.interview_id}
                              </span>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-gray-600">
                              Unassigned
                            </Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1 sm:gap-2 flex-wrap">
                            {assignee.interview_id && assigneesWithResponses.has(assignee.email.toLowerCase()) && (() => {
                              const callId = assigneeCallIds.get(assignee.email.toLowerCase());


                              return callId ? (
                                <Link
                                  href={`/interviews/${assignee.interview_id}?call=${callId}`}
                                  target="_blank"
                                >
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-1"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Interview
                                  </Button>
                                </Link>
                              ) : null;
                            })()}
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleEditAssignee(assignee)}
                            >
                              <span className="hidden sm:inline">Edit</span>
                              <span className="sm:hidden">E</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleViewDetails(assignee)}
                            >
                              <span className="hidden sm:inline">View</span>
                              <span className="sm:hidden">V</span>
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="flex items-center gap-1 text-xs"
                              onClick={() => handleDeleteAssignee(assignee)}
                            >
                              <Trash2 className="h-3 w-3" />
                              <span className="hidden sm:inline">Delete</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                        ))}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Modal */}
      <CreateAssigneeModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        assignee={selectedAssignee}
        mode={selectedAssignee ? 'edit' : 'create'}
      />

      {/* Bulk Import Modal */}
      <BulkImportModal
        isOpen={isBulkImportModalOpen}
        onClose={() => setIsBulkImportModalOpen(false)}
        onImportComplete={() => {
          // Refresh the assignees list after import
          refreshAssignees();
        }}
      />

      {/* Bulk Actions Modals */}
      <BulkActionsModals
        selectedAssignees={selectedAssignees}
        assignees={assignees}
        interviews={interviews}
        isBulkStatusModalOpen={isBulkStatusModalOpen}
        setIsBulkStatusModalOpen={setIsBulkStatusModalOpen}
        isBulkInterviewModalOpen={isBulkInterviewModalOpen}
        setIsBulkInterviewModalOpen={setIsBulkInterviewModalOpen}
        isBulkTagModalOpen={isBulkTagModalOpen}
        setIsBulkTagModalOpen={setIsBulkTagModalOpen}
        isBulkDeleteConfirmOpen={isBulkDeleteConfirmOpen}
        setIsBulkDeleteConfirmOpen={setIsBulkDeleteConfirmOpen}
        onBulkActionComplete={() => refreshAssignees()}
        onClearSelection={() => setSelectedAssignees(new Set())}
      />

      {/* View Details Modal */}
      {isViewModalOpen && viewAssignee && (
        <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Assignee Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-500">Name</p>
                <p className="font-medium">{viewAssignee.first_name} {viewAssignee.last_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="font-medium">{viewAssignee.email}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Phone</p>
                <p className="font-medium">{viewAssignee.phone || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <Badge className={`${viewAssignee.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {viewAssignee.status}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500">Interview Assignment</p>
                {viewAssignee.interview_id ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Briefcase className="h-4 w-4 text-blue-600" />
                    <p className="font-medium text-blue-600">
                      {typedInterviews.find(i => i.id === viewAssignee.interview_id)?.name || viewAssignee.interview_id}
                    </p>
                  </div>
                ) : (
                  <p className="font-medium text-gray-500">No interview assigned</p>
                )}
              </div>
              {viewAssignee.assigned_at && (
                <div>
                  <p className="text-sm text-gray-500">Assigned at</p>
                  <p className="font-medium">{new Date(viewAssignee.assigned_at).toLocaleString()}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-500">Tag</p>
                {viewAssignee.tag ? (
                  <Badge variant="outline" className="text-purple-600">
                    {viewAssignee.tag}
                  </Badge>
                ) : (
                  <p className="font-medium text-gray-400">No tag assigned</p>
                )}
              </div>
              {viewAssignee.notes && (
                <div>
                  <p className="text-sm text-gray-500">Notes</p>
                  <p className="font-medium">{viewAssignee.notes}</p>
                </div>
              )}
              {viewAssignee.interview_id && (() => {
                const callId = assigneeCallIds.get(viewAssignee.email.toLowerCase());


                return callId ? (
                  <div>
                    <p className="text-sm text-gray-500">Interview Details</p>
                    <Link
                      href={`/interviews/${viewAssignee.interview_id}?call=${callId}`}
                      target="_blank"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2 mt-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View Interview Details
                      </Button>
                    </Link>
                  </div>
                ) : assigneesWithResponses.has(viewAssignee.email.toLowerCase()) ? (
                  <div>
                    <p className="text-sm text-gray-500">Interview Details</p>
                    <Link
                      href={`/interviews/${viewAssignee.interview_id}?email=${encodeURIComponent(viewAssignee.email)}`}
                      target="_blank"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2 mt-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View Interview Details
                      </Button>
                    </Link>
                  </div>
                ) : null;
              })()}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <AlertDialogTitle>Delete Applicant</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="pt-2">
              Are you sure you want to delete <strong>{assigneeToDelete?.first_name} {assigneeToDelete?.last_name}</strong>?
              <br />
              <span className="text-xs text-gray-500 mt-1 block">
                This action cannot be undone. All associated data will be permanently deleted.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteConfirmOpen(false);
              setAssigneeToDelete(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* End of View Details Modal */}
    </div>
  );
}
