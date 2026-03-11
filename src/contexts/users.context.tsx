'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from '@/contexts/auth.context';
import { InterviewAssignee, CreateAssigneeRequest, UpdateAssigneeRequest, AssignInterviewRequest, UnassignInterviewRequest } from '@/types/user';
import { assigneeService } from '@/services/users.service';
import { useToast } from '@/components/ui/use-toast';

interface AssigneesContextType {
  assignees: InterviewAssignee[];
  assigneesLoading: boolean;
  refreshAssignees: () => Promise<void>;
  addAssignee: (assigneeData: CreateAssigneeRequest, options?: { silent?: boolean }) => Promise<InterviewAssignee | null>;
  updateAssignee: (id: number, updateData: UpdateAssigneeRequest) => Promise<InterviewAssignee | null>;
  deleteAssignee: (id: number) => Promise<boolean>;
  assignInterview: (assignmentData: AssignInterviewRequest) => Promise<InterviewAssignee | null>;
  unassignInterview: (unassignData: UnassignInterviewRequest) => Promise<InterviewAssignee | null>;
  searchAssignees: (searchTerm: string) => Promise<InterviewAssignee[]>;
  getAssigneesByStatus: (status: 'active' | 'inactive' | 'pending') => Promise<InterviewAssignee[]>;
  getUnassignedAssignees: () => Promise<InterviewAssignee[]>;
}

const AssigneesContext = createContext<AssigneesContextType | undefined>(undefined);

export function useAssignees() {
  const context = useContext(AssigneesContext);
  if (context === undefined) {
    throw new Error('useAssignees must be used within an AssigneesProvider');
  }

  return context;
};

interface AssigneesProviderProps {
  children: ReactNode;
}

export function AssigneesProvider({ children }: AssigneesProviderProps) {
  const [assignees, setAssignees] = useState<InterviewAssignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(true);
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const organizationId = user?.organization_id;

  const refreshAssignees = async () => {
    console.log('🔄 refreshAssignees CALLED');
    console.trace('Call stack:');
    try {
      setAssigneesLoading(true);
      // Pass organizationId (which can be undefined/null) - service will handle it
      const data = await assigneeService.getAllAssignees(organizationId);
      setAssignees(data);
      console.log('✅ Assignees data set, count:', data.length);
      
      // Small delay to ensure state has propagated
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error refreshing assignees:', error);
      toast({
        title: 'Error',
        description: 'Failed to refresh assignees',
        variant: 'destructive',
      });
    } finally {
      console.log('📊 Setting assigneesLoading to false');
      setAssigneesLoading(false);
    }
  };

  const addAssignee = async (assigneeData: CreateAssigneeRequest, options?: { silent?: boolean }): Promise<InterviewAssignee | null> => {
    try {
      // Include organization_id if available, otherwise it will be null
      const newAssignee = await assigneeService.createAssignee({
        ...assigneeData,
        organization_id: assigneeData.organization_id || organizationId || null,
      });

      setAssignees(prev => [newAssignee, ...prev]);

      if (!options?.silent) {
        toast({
          title: 'Success',
          description: 'Assignee created successfully',
        });
      }

      return newAssignee;
    } catch (error) {
      console.error('Error adding assignee:', error);
      // Re-throw the error so the modal can handle it and show a specific message
      throw error;
    }
  };

  const updateAssignee = async (id: number, updateData: UpdateAssigneeRequest): Promise<InterviewAssignee | null> => {
    console.log("Updating assignee:", id, updateData);
    try {
      const updatedAssignee = await assigneeService.updateAssignee(id, updateData);
      
      setAssignees(prev => 
        prev.map(assignee => 
          assignee.id === id ? updatedAssignee : assignee
        )
      );
      
      toast({
        title: 'Success',
        description: 'Assignee updated successfully',
      });
      

      return updatedAssignee;
    } catch (error) {
      console.error('Error updating assignee:', error);
      toast({
        title: 'Error',
        description: 'Failed to update assignee',
        variant: 'destructive',
      });

      return null;
    }
  };

  const deleteAssignee = async (id: number): Promise<boolean> => {
    try {
      await assigneeService.deleteAssignee(id);
      
      setAssignees(prev => prev.filter(assignee => assignee.id !== id));
      
      toast({
        title: 'Success',
        description: 'Assignee deleted successfully',
      });
      

      return true;
    } catch (error) {
      console.error('Error deleting assignee:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete assignee',
        variant: 'destructive',
      });

      return false;
    }
  };

  const assignInterview = async (assignmentData: AssignInterviewRequest): Promise<InterviewAssignee | null> => {
    try {
      const updatedAssignee = await assigneeService.assignInterview(assignmentData);
      
      setAssignees(prev => 
        prev.map(assignee => 
          assignee.id === assignmentData.assignee_id ? updatedAssignee : assignee
        )
      );
      
      toast({
        title: 'Success',
        description: 'Interview assigned successfully',
      });
      

      return updatedAssignee;
    } catch (error) {
      console.error('Error assigning interview:', error);
      toast({
        title: 'Error',
        description: 'Failed to assign interview',
        variant: 'destructive',
      });

      return null;
    }
  };

  const unassignInterview = async (unassignData: UnassignInterviewRequest): Promise<InterviewAssignee | null> => {
    try {
      const updatedAssignee = await assigneeService.unassignInterview(unassignData);
      
      setAssignees(prev => 
        prev.map(assignee => 
          assignee.id === unassignData.assignee_id ? updatedAssignee : assignee
        )
      );
      
      toast({
        title: 'Success',
        description: 'Interview unassigned successfully',
      });
      

      return updatedAssignee;
    } catch (error) {
      console.error('Error unassigning interview:', error);
      toast({
        title: 'Error',
        description: 'Failed to unassign interview',
        variant: 'destructive',
      });

      return null;
    }
  };

  const searchAssignees = async (searchTerm: string): Promise<InterviewAssignee[]> => {
    try {

      return await assigneeService.searchAssignees(organizationId, searchTerm);
    } catch (error) {
      console.error('Error searching assignees:', error);

      return [];
    }
  };

  const getAssigneesByStatus = async (status: 'active' | 'inactive' | 'pending'): Promise<InterviewAssignee[]> => {
    try {

      return await assigneeService.getAssigneesByStatus(organizationId, status);
    } catch (error) {
      console.error('Error getting assignees by status:', error);

      return [];
    }
  };

  const getUnassignedAssignees = async (): Promise<InterviewAssignee[]> => {
    try {

      return await assigneeService.getUnassignedAssignees(organizationId);
    } catch (error) {
      console.error('Error getting unassigned assignees:', error);

      return [];
    }
  };

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      console.log('⏳ Users Context: Waiting for auth to complete');

      return;
    }

    // If no user after auth loads, don't fetch
    if (!user?.id) {
      console.log('❌ Users Context: No user found, skipping fetch');
      setAssigneesLoading(false);

      return;
    }

    // Fetch assignees when user is ready
    console.log('✅ Users Context: User ready, fetching assignees');
    refreshAssignees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  const value: AssigneesContextType = {
    assignees,
    assigneesLoading,
    refreshAssignees,
    addAssignee,
    updateAssignee,
    deleteAssignee,
    assignInterview,
    unassignInterview,
    searchAssignees,
    getAssigneesByStatus,
    getUnassignedAssignees,
  };


  return (
    <AssigneesContext.Provider value={value}>
      {children}
    </AssigneesContext.Provider>
  );
};
