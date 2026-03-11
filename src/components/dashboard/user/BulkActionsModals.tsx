'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Interview } from '@/types/interview';

interface BulkActionsModalsProps {
  selectedAssignees: Set<number>;
  assignees: any[];
  interviews: Interview[];
  
  // Bulk Status Modal
  isBulkStatusModalOpen: boolean;
  setIsBulkStatusModalOpen: (open: boolean) => void;
  
  // Bulk Interview Modal
  isBulkInterviewModalOpen: boolean;
  setIsBulkInterviewModalOpen: (open: boolean) => void;
  
  // Bulk Tag Modal
  isBulkTagModalOpen: boolean;
  setIsBulkTagModalOpen: (open: boolean) => void;
  
  // Bulk Delete Modal
  isBulkDeleteConfirmOpen: boolean;
  setIsBulkDeleteConfirmOpen: (open: boolean) => void;
  
  // Callbacks
  onBulkActionComplete: () => void;
  onClearSelection: () => void;
}

export function BulkActionsModals({
  selectedAssignees,
  assignees,
  interviews,
  isBulkStatusModalOpen,
  setIsBulkStatusModalOpen,
  isBulkInterviewModalOpen,
  setIsBulkInterviewModalOpen,
  isBulkTagModalOpen,
  setIsBulkTagModalOpen,
  isBulkDeleteConfirmOpen,
  setIsBulkDeleteConfirmOpen,
  onBulkActionComplete,
  onClearSelection,
}: BulkActionsModalsProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  // Bulk Status Change
  const [bulkStatus, setBulkStatus] = useState<string>('active');
  
  // Bulk Interview Assignment
  const [bulkInterviewId, setBulkInterviewId] = useState<string>('none');
  
  // Bulk Tag Assignment
  const [bulkTag, setBulkTag] = useState<string>('');

  const selectedAssigneesList = assignees.filter(a => selectedAssignees.has(a.id));

  // Handle Bulk Status Change
  const handleBulkStatusChange = async () => {
    if (!bulkStatus) {
      toast({
        title: 'Error',
        description: 'Please select a status',
        variant: 'destructive',
      });

      return;
    }

    setIsLoading(true);
    try {
      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await fetch('/api/assignees/bulk-update-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          assignee_ids: Array.from(selectedAssignees),
          status: bulkStatus,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update status');
      }

      toast({
        title: 'Success',
        description: `Updated status for ${data.updated} assignee(s)`,
      });

      setIsBulkStatusModalOpen(false);
      onBulkActionComplete();
      onClearSelection();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update status',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Bulk Interview Assignment
  const handleBulkInterviewAssignment = async () => {
    setIsLoading(true);
    try {
      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await fetch('/api/assignees/bulk-assign-interview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          assignee_ids: Array.from(selectedAssignees),
          interview_id: bulkInterviewId === 'none' ? null : bulkInterviewId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to assign interview');
      }

      toast({
        title: 'Success',
        description: bulkInterviewId !== 'none'
          ? `Assigned interview to ${data.updated} assignee(s)`
          : `Removed interview from ${data.updated} assignee(s)`,
      });

      setIsBulkInterviewModalOpen(false);
      onBulkActionComplete();
      onClearSelection();
    } catch (error) {
      console.error('Error assigning interview:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to assign interview',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Bulk Tag Assignment
  const handleBulkTagAssignment = async () => {
    setIsLoading(true);
    try {
      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await fetch('/api/assignees/bulk-assign-tag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          assignee_ids: Array.from(selectedAssignees),
          tag: bulkTag || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to assign tag');
      }

      toast({
        title: 'Success',
        description: bulkTag
          ? `Assigned tag to ${data.updated} assignee(s)`
          : `Removed tag from ${data.updated} assignee(s)`,
      });

      setIsBulkTagModalOpen(false);
      onBulkActionComplete();
      onClearSelection();
    } catch (error) {
      console.error('Error assigning tag:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to assign tag',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Bulk Delete
  const handleBulkDelete = async () => {
    setIsLoading(true);
    try {
      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await fetch('/api/assignees/bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          assignee_ids: Array.from(selectedAssignees),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete assignees');
      }

      toast({
        title: 'Success',
        description: `Deleted ${data.deleted} assignee(s)`,
      });

      setIsBulkDeleteConfirmOpen(false);
      onBulkActionComplete();
      onClearSelection();
    } catch (error) {
      console.error('Error deleting assignees:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete assignees',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <>
      {/* Bulk Status Change Modal */}
      <Dialog open={isBulkStatusModalOpen} onOpenChange={setIsBulkStatusModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Status for {selectedAssignees.size} Assignee(s)</DialogTitle>
            <DialogDescription>
              Select a new status to apply to all selected assignees.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Status</Label>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="text-sm text-gray-600">
              <p className="font-medium mb-2">Selected Assignees:</p>
              <ul className="list-disc list-inside space-y-1">
                {selectedAssigneesList.slice(0, 5).map(a => (
                  <li key={a.id}>{a.first_name} {a.last_name} ({a.email})</li>
                ))}
                {selectedAssigneesList.length > 5 && (
                  <li>... and {selectedAssigneesList.length - 5} more</li>
                )}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkStatusModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkStatusChange} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Status'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Interview Assignment Modal */}
      <Dialog open={isBulkInterviewModalOpen} onOpenChange={setIsBulkInterviewModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Interview to {selectedAssignees.size} Assignee(s)</DialogTitle>
            <DialogDescription>
              Select an interview to assign to all selected assignees, or leave empty to remove assignment.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Interview</Label>
              <Select value={bulkInterviewId} onValueChange={setBulkInterviewId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select interview (or select 'None' to unassign)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Interview (Remove Assignment)</SelectItem>
                  {interviews.map(interview => (
                    <SelectItem key={interview.id} value={interview.id}>
                      {interview.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="text-sm text-gray-600">
              <p className="font-medium mb-2">Selected Assignees:</p>
              <ul className="list-disc list-inside space-y-1">
                {selectedAssigneesList.slice(0, 5).map(a => (
                  <li key={a.id}>{a.first_name} {a.last_name} ({a.email})</li>
                ))}
                {selectedAssigneesList.length > 5 && (
                  <li>... and {selectedAssigneesList.length - 5} more</li>
                )}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkInterviewModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkInterviewAssignment} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                bulkInterviewId !== 'none' ? 'Assign Interview' : 'Remove Assignment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Tag Assignment Modal */}
      <Dialog open={isBulkTagModalOpen} onOpenChange={setIsBulkTagModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Tag to {selectedAssignees.size} Assignee(s)</DialogTitle>
            <DialogDescription>
              Enter a tag to assign to all selected assignees, or leave empty to remove tags.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tag / Department</Label>
              <Input
                placeholder="e.g., Frontend, Backend, Senior, etc."
                value={bulkTag}
                onChange={(e) => setBulkTag(e.target.value)}
              />
              <p className="text-xs text-gray-500">Leave empty to remove tags from selected assignees</p>
            </div>

            <div className="text-sm text-gray-600">
              <p className="font-medium mb-2">Selected Assignees:</p>
              <ul className="list-disc list-inside space-y-1">
                {selectedAssigneesList.slice(0, 5).map(a => (
                  <li key={a.id}>{a.first_name} {a.last_name} ({a.email})</li>
                ))}
                {selectedAssigneesList.length > 5 && (
                  <li>... and {selectedAssigneesList.length - 5} more</li>
                )}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkTagModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkTagAssignment} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                bulkTag ? 'Assign Tag' : 'Remove Tags'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Modal */}
      <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <AlertDialogTitle>Delete {selectedAssignees.size} Assignee(s)?</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="pt-2">
              <p className="mb-3">
                Are you sure you want to delete the following assignees? This action cannot be undone.
              </p>
              <div className="bg-gray-50 p-3 rounded-lg max-h-40 overflow-y-auto">
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {selectedAssigneesList.slice(0, 10).map(a => (
                    <li key={a.id}>{a.first_name} {a.last_name} ({a.email})</li>
                  ))}
                  {selectedAssigneesList.length > 10 && (
                    <li className="font-medium">... and {selectedAssigneesList.length - 10} more</li>
                  )}
                </ul>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                All associated data will be permanently deleted from the system.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsBulkDeleteConfirmOpen(false)} disabled={isLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedAssignees.size} Assignee(s)`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

