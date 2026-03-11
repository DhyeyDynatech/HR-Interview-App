'use client';

import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { MoreHorizontal, Mail, Phone, Calendar, UserCheck, UserX, Briefcase, ExternalLink, CheckSquare, Square, FileText, Clock, AlertTriangle, Eye, Edit, Trash2, History, Loader2, Send } from 'lucide-react';
import { InterviewAssignee, ReviewStatus } from '@/types/user';
import { Interview } from '@/types/interview';
import { useAssignees } from '@/contexts/users.context';
import { assigneeService } from '@/services/users.service';
import { useToast } from '@/components/ui/use-toast';
import { ResumeViewer } from './ResumeViewer';
import Link from 'next/link';

interface AssigneeCardProps {
  assignee: InterviewAssignee;
  onEdit: (assignee: InterviewAssignee) => void;
  onViewDetails: (assignee: InterviewAssignee) => void;
  interviews?: Interview[];
  hasGivenInterview?: boolean;
  callId?: string;
  interviewDate?: string;
  isSelected?: boolean;
  onSelect?: () => void;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active':

      return 'bg-green-100 text-green-800 hover:bg-green-200';
    case 'inactive':

      return 'bg-gray-100 text-gray-800 hover:bg-gray-200';
    case 'pending':

      return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200';
    default:

      return 'bg-gray-100 text-gray-800 hover:bg-gray-200';
  }
};

function getInterviewStatusInfo(status: string | null | undefined): { text: string; className: string } | null {
  if (!status) {
    return null;
  }
  
  switch (status) {
    case 'NOT_SENT':
      return {
        text: 'Not Sent',
        className: 'text-[10px] sm:text-xs bg-gray-50 text-gray-600 border-gray-300 whitespace-nowrap'
      };
    case 'INTERVIEW_SENT':
      return {
        text: 'Interview Sent',
        className: 'text-[10px] sm:text-xs bg-blue-50 text-blue-700 border-blue-300 whitespace-nowrap'
      };
    case 'INTERVIEW_RESENT':
      return {
        text: 'Interview Resent',
        className: 'text-[10px] sm:text-xs bg-amber-50 text-amber-700 border-amber-300 whitespace-nowrap'
      };
    case 'INTERVIEW_COMPLETED':
      return {
        text: 'Interview Completed',
        className: 'text-[10px] sm:text-xs bg-indigo-50 text-indigo-700 border-indigo-300 whitespace-nowrap'
      };
    case 'AI_RESPONSE_CAPTURED':
      return {
        text: 'AI Response Captured',
        className: 'text-[10px] sm:text-xs bg-purple-50 text-purple-700 border-purple-300 whitespace-nowrap'
      };
    case 'REVIEWED':
      return {
        text: 'Reviewed',
        className: 'text-[10px] sm:text-xs bg-cyan-50 text-cyan-700 border-cyan-300 whitespace-nowrap'
      };
    case 'NOT_REVIEWED':
      return {
        text: 'To be Reviewed',
        className: 'text-[10px] sm:text-xs bg-orange-50 text-orange-700 border-orange-300 whitespace-nowrap'
      };
    case 'CANDIDATE_SELECTED':
      return {
        text: 'Candidate Selected',
        className: 'text-[10px] sm:text-xs bg-green-100 text-green-700 border-green-300 whitespace-nowrap'
      };
    case 'CANDIDATE_REJECTED':
      return {
        text: 'Candidate Rejected',
        className: 'text-[10px] sm:text-xs bg-red-100 text-red-700 border-red-300 whitespace-nowrap'
      };
    default:
      return null;
  }
};

function getInitials(firstName: string, lastName: string) {

  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
};

// Helper function to normalize image URLs to handle both cloud and legacy local paths
const normalizeImageUrl = (url: string | null | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  
  // If it's already a full URL (from Vercel Blob or other cloud storage), return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Legacy: Handle old local file paths
  if (url.startsWith('/user-images/')) {
    try {
      // Decode URL encoding (%20 -> space, etc.)
      let decoded = decodeURIComponent(url);
      
      // Extract just the filename part
      const filename = decoded.replace('/user-images/', '');
      
      // Normalize the filename to match what's actually saved
      // The upload API replaces special chars with underscores: file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      // So we need to do the same normalization
      const normalizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      return `/user-images/${normalizedFilename}`;
    } catch (error) {
      // If decoding fails, return undefined
      console.error('Error normalizing image URL:', url, error);

      return undefined;
    }
  }
  
  return undefined;
};

export function AssigneeCard({ assignee, onEdit, onViewDetails, interviews = [], hasGivenInterview = false, callId, interviewDate, isSelected = false, onSelect }: AssigneeCardProps) {
  const { deleteAssignee, assignInterview, unassignInterview } = useAssignees();
  const { toast } = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [isResending, setIsResending] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [showResumeViewer, setShowResumeViewer] = React.useState(false);
  
  const assignedInterview = interviews.find(i => i.id === assignee.interview_id);

  const handleDelete = async () => {
    const success = await deleteAssignee(assignee.id);
    if (success) {
      toast({
        title: 'Success',
        description: 'Assignee deleted successfully',
      });
      setDeleteConfirmOpen(false);
    } else {
      toast({
        title: 'Error',
        description: 'Failed to delete assignee',
        variant: 'destructive',
      });
    }
  };

  const handleAssignInterview = async () => {
    // This would typically open a modal to select an interview
    // For now, we'll just show a toast
    toast({
      title: 'Info',
      description: 'Interview assignment feature will be implemented in the next step',
    });
  };

  const handleUnassignInterview = async () => {
    if (!assignee.interview_id) {
  return;
}
    
    const success = await unassignInterview({
      assignee_id: assignee.id,
      assigned_by: 'current-user-id', // This should come from auth context
    });
    
    if (success) {
      toast({
        title: 'Success',
        description: 'Interview unassigned successfully',
      });
    }
  };

  const handleResendInterview = async () => {
    if (!assignee.interview_id || !assignee.email) {
      toast({
        title: 'Error',
        description: 'Missing interview or email information',
        variant: 'destructive',
      });

      return;
    }

    setIsResending(true);
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
          assignees: [{
            id: assignee.id,
            email: assignee.email,
            interview_id: assignee.interview_id,
            first_name: assignee.first_name,
            last_name: assignee.last_name,
          }],
        }),
      });

      const data = await response.json();

      if (response.ok && data.results && data.results[0]?.success) {
        toast({
          title: 'Success',
          description: `Interview link sent to ${assignee.email}`,
        });
        // When recruiter explicitly resends the interview,
        // allow the assignee to take the interview again
        try {
          // Optimistically update allow_retake for this assignee
          const updated = await assigneeService.updateAssignee(assignee.id, {
            allow_retake: true,
          } as any);
          console.log('Updated assignee allow_retake:', updated?.allow_retake);
        } catch (err) {
          console.error('Error updating assignee allow_retake on resend:', err);
        }
      } else {
        toast({
          title: 'Error',
          description: data.results?.[0]?.error || data.error || 'Failed to send interview email',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error resending interview:', error);
      toast({
        title: 'Error',
        description: 'Failed to send interview email. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsResending(false);
    }
  };

  const handleSendInterview = async () => {
    if (!assignee.interview_id || !assignee.email) {
      toast({
        title: 'Error',
        description: 'Missing interview or email information',
        variant: 'destructive',
      });

      return;
    }

    setIsSending(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      const response = await fetch('/api/send-assignee-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          assignees: [{
            id: assignee.id,
            email: assignee.email,
            interview_id: assignee.interview_id,
            first_name: assignee.first_name,
            last_name: assignee.last_name,
          }],
        }),
      });

      const data = await response.json();

      if (response.ok && data.results && data.results[0]?.success) {
        toast({
          title: 'Success',
          description: `Interview link sent to ${assignee.email}`,
        });
      } else {
        toast({
          title: 'Error',
          description: data.results?.[0]?.error || data.error || 'Failed to send interview email',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error sending interview:', error);
      toast({
        title: 'Error',
        description: 'Failed to send interview email. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };


return (
  <Card className={`hover:shadow-md transition-shadow ${isSelected ? 'ring-2 ring-blue-500' : ''}`}>
    <CardHeader className="pb-3 px-3 sm:px-4 md:px-6" style={{
      borderBottom: '3px solid #e0e0e0',
      marginBottom: '10px',
      outlineWidth: '5px',
      outlineColor: '#e0e0e0',
      marginTop: '10px',
    }}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4" >
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1" >
          {onSelect && (
            <button
              className="flex items-center mr-1 sm:mr-2 flex-shrink-0"
              onClick={onSelect}
            >
              {isSelected ? (
                <CheckSquare className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
              ) : (
                <Square className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
              )}
            </button>
          )}
          <Avatar className="h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0">
            <AvatarImage
              src={normalizeImageUrl(assignee.avatar_url)}
              alt={`${assignee.first_name} ${assignee.last_name}`}
              onError={(e) => {
                // Hide broken images to prevent 404 errors
                e.currentTarget.style.display = 'none';
              }}
            />
            <AvatarFallback className="bg-blue-100 text-blue-600 text-xs sm:text-sm">
              {getInitials(assignee.first_name, assignee.last_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-xs sm:text-sm truncate">
              {assignee.first_name} {assignee.last_name}
            </h3>
            <p className="text-[10px] sm:text-xs text-gray-500 truncate">{assignee.email}</p>
          </div>
        </div>

        {/* Action Buttons - Interview & Resend outside, rest in dropdown */}
        <div className="flex items-center gap-1 sm:gap-2 w-full sm:w-auto justify-end flex-shrink-0">
          {/* Interview Button - Always visible when applicable */}
          {hasGivenInterview && assignee.interview_id && callId && (
            <Link
              href={`/interviews/${assignee.interview_id}?call=${callId}`}
              target="_blank"
            >
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 sm:px-3 flex items-center gap-1 text-blue-600 border-blue-300 hover:bg-blue-50 whitespace-nowrap text-xs sm:text-sm"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Interview</span>
              </Button>
            </Link>
          )}

          {/* Send Interview Button - Visible when interview assigned but link not yet sent */}
          {assignee.interview_id && (!assignee.interview_status || assignee.interview_status === 'NOT_SENT') && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 sm:px-3 flex items-center gap-1 text-blue-600 border-blue-300 hover:bg-blue-50 whitespace-nowrap text-xs sm:text-sm"
              onClick={handleSendInterview}
              disabled={isSending}
              title={isSending ? 'Sending...' : 'Send Interview Link'}
            >
              {isSending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isSending ? 'Sending...' : 'Send'}
              </span>
            </Button>
          )}

          {/* Resend Interview Button - Visible after interview link has been sent */}
          {assignee.interview_id && assignee.interview_status && assignee.interview_status !== 'NOT_SENT' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 sm:px-3 flex items-center gap-1 text-indigo-600 border-indigo-300 hover:bg-indigo-50 whitespace-nowrap text-xs sm:text-sm"
              onClick={handleResendInterview}
              disabled={isResending}
              title={isResending ? 'Sending...' : 'Resend Interview Link'}
            >
              {isResending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <History className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isResending ? 'Sending...' : 'Resend'}
              </span>
            </Button>
          )}

          {/* 3-dot dropdown for View, Edit, Delete */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onViewDetails(assignee)}>
                <Eye className="mr-2 h-4 w-4" />
                View
              </DropdownMenuItem>
              {assignee.resume_url && (
                <DropdownMenuItem onClick={() => setShowResumeViewer(true)}>
                  <FileText className="mr-2 h-4 w-4 text-green-600" />
                  <span className="text-green-600">View Resume</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => {
                console.log('Edit clicked for:', assignee);
                onEdit(assignee);
              }}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Delete confirmation dialog */}
          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent className="max-w-[90vw] sm:max-w-md">
              <AlertDialogHeader>
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="p-1.5 sm:p-2 bg-red-100 rounded-full flex-shrink-0">
                    <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-red-600" />
                  </div>
                  <AlertDialogTitle className="text-base sm:text-lg">Delete Applicant</AlertDialogTitle>
                </div>
                <AlertDialogDescription className="pt-2 text-sm">
                  Are you sure you want to delete <strong>{assignee.first_name} {assignee.last_name}</strong>?
                  <br />
                  <span className="text-xs text-gray-500 mt-1 block">
                    This action cannot be undone. All associated data will be permanently deleted.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                <AlertDialogCancel
                  className="w-full sm:w-auto"
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="w-full sm:w-auto bg-red-600 hover:bg-red-700"
                  onClick={handleDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </CardHeader>

    <CardContent className="pt-0 px-3 sm:px-4 md:px-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {/* Left Side - Contact & Interview Details */}
        <div className="space-y-1.5 sm:space-y-2">
          {assignee.phone && (
            <div className="flex items-center text-[11px] sm:text-xs text-gray-600">
              <Phone className="mr-1.5 sm:mr-2 h-3 w-3 flex-shrink-0" />
              <span className="truncate">{assignee.phone}</span>
            </div>
          )}

          {assignee.applicant_id && (
            <div className="flex items-center text-[11px] sm:text-xs text-gray-600">
              <FileText className="mr-1.5 sm:mr-2 h-3 w-3 flex-shrink-0" />
              <span className="font-mono truncate">ID: {assignee.applicant_id}</span>
            </div>
          )}

          {assignedInterview && (
            <div className="flex items-center text-[11px] sm:text-xs text-gray-600">
              <Briefcase className="mr-1.5 sm:mr-2 h-3 w-3 flex-shrink-0" />
              <span className="text-gray-600 mr-1 sm:mr-2 flex-shrink-0">Assigned Interview:</span>
              <span className="font-medium text-blue-600 truncate"> {assignedInterview.name}</span>
            </div>
          )}

          {assignee.assigned_at && (
            <div className="flex items-center text-[11px] sm:text-xs text-gray-500">
              <Calendar className="mr-1.5 sm:mr-2 h-3 w-3 flex-shrink-0" />
              <span className="truncate">Assigned: {new Date(assignee.assigned_at).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              })}</span>
            </div>
          )}

          {/* Interview Taken Date */}
          {interviewDate && (
            <div className="flex items-center text-[11px] sm:text-xs font-medium text-gray-600">
              <Clock className="mr-1.5 sm:mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="truncate">Interview Taken: {interviewDate}</span>
            </div>
          )}
        </div>

        {/* Right Side - Tags and Statuses */}
        <div className="space-y-1.5 sm:space-y-2 flex flex-col items-start lg:items-start">
          <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-start">
            {/* Assignee Status */}
            <Badge className={`text-[10px] sm:text-xs ${getStatusColor(assignee.status)} whitespace-nowrap`}>
              {assignee.status}
            </Badge>

            {/* Interview Assignment Status */}
            {assignee.interview_id ? (
              <Badge variant="outline" className="text-[10px] sm:text-xs bg-green-50 text-green-700 border-green-300 whitespace-nowrap">
                <UserCheck className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3" />
                Assigned
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] sm:text-xs bg-gray-50 text-gray-600 border-gray-300 whitespace-nowrap">
                <UserX className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3" />
                Unassigned
              </Badge>
            )}

            {/* Interview Status */}
            {(() => {
              const statusInfo = getInterviewStatusInfo(assignee.interview_status);
              
              return statusInfo ? (
                <Badge variant="outline" className={statusInfo.className}>
                  {statusInfo.text}
                </Badge>
              ) : null;
            })()}

            {/* Review Status */}
            {(() => {
              const reviewStatus = assignee.review_status || 'NO_STATUS';

              // If candidate has not yet taken the interview, don't show any review badge
              if (!hasGivenInterview) {
                return null;
              }

              if (reviewStatus === 'NO_STATUS') {
                // Interview completed but recruiter hasn't reviewed yet
                return (
                  <Badge variant="outline" className="text-[10px] sm:text-xs bg-gray-100 text-gray-700 border-gray-300 whitespace-nowrap">
                    To Be Reviewed
                  </Badge>
                );
              }

              if (reviewStatus === 'NOT_SELECTED') {
                return (
                  <Badge variant="outline" className="text-[10px] sm:text-xs bg-red-100 text-red-700 border-red-300 whitespace-nowrap">
                    Not Selected
                  </Badge>
                );
              }

              if (reviewStatus === 'POTENTIAL') {
                return (
                  <Badge variant="outline" className="text-[10px] sm:text-xs bg-yellow-100 text-yellow-700 border-yellow-300 whitespace-nowrap">
                    Potential
                  </Badge>
                );
              }

              if (reviewStatus === 'SELECTED') {
                return (
                  <Badge variant="outline" className="text-[10px] sm:text-xs bg-green-100 text-green-700 border-green-300 whitespace-nowrap">
                    Selected
                  </Badge>
                );
              }

              return null;
            })()}

            {/* Tag */}
            {assignee.tag && (
              <Badge variant="outline" className="text-[10px] sm:text-xs text-purple-600 border-purple-300 bg-purple-50 whitespace-nowrap max-w-[120px] truncate">
                {assignee.tag}
              </Badge>
            )}
          </div>

          {assignee.notes && (
            <p className="text-[11px] sm:text-xs text-gray-600 mt-1 sm:mt-2 line-clamp-2 text-left w-full">
              {assignee.notes}
            </p>
          )}
        </div>
      </div>
      </CardContent>

      {/* Resume Viewer */}
      {assignee.resume_url && (
        <ResumeViewer
          isOpen={showResumeViewer}
          onClose={() => setShowResumeViewer(false)}
          resumeUrl={assignee.resume_url}
          assigneeName={`${assignee.first_name} ${assignee.last_name}`}
        />
      )}
    </Card>
  );
};

