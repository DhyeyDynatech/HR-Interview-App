import { createBrowserClient } from '@supabase/ssr';
import { nanoid } from 'nanoid';
import { InterviewAssignee, CreateAssigneeRequest, UpdateAssigneeRequest, AssignInterviewRequest, UnassignInterviewRequest, ClientUser, UserRole, UserStatus } from '@/types/user';
import { logger } from '@/lib/logger';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const assigneeService = {
  // Get all assignees - optionally filter by organization_id
  async getAllAssignees(organizationId?: string | null): Promise<InterviewAssignee[]> {
    try {
      let query = supabase
        .from('interview_assignee')
        .select('*')
        .order('created_at', { ascending: false });

      // Only filter by organization_id if it's provided
      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }
      // If no organization_id, get ALL assignees (don't filter)

      const { data, error } = await query;

      if (error) {
  throw error;
}

      return data || [];
    } catch (error) {
      logger.error('Error fetching assignees:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Get assignee by ID
  async getAssigneeById(id: number): Promise<InterviewAssignee | null> {
    try {
      const { data, error } = await supabase
        .from('interview_assignee')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
  throw error;
}

      return data;
    } catch (error) {
      logger.error('Error fetching assignee:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Get assignee by email - optionally filter by organization_id
  // Also checks records with NULL org_id to catch legacy data
  async getAssigneeByEmail(email: string, organizationId?: string | null): Promise<InterviewAssignee | null> {
    try {
      if (organizationId) {
        // First check with the provided org_id
        const { data, error } = await supabase
          .from('interview_assignee')
          .select('*')
          .eq('email', email)
          .eq('organization_id', organizationId)
          .single();

        if (!error && data) return data;
        if (error && error.code !== 'PGRST116') throw error;

        // Fallback: check for records with NULL org_id
        const { data: nullData, error: nullError } = await supabase
          .from('interview_assignee')
          .select('*')
          .eq('email', email)
          .is('organization_id', null)
          .single();

        if (!nullError && nullData) return nullData;
        if (nullError && nullError.code !== 'PGRST116') throw nullError;

        return null;
      }

      // No org_id provided — just check by email
      const { data, error } = await supabase
        .from('interview_assignee')
        .select('*')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      return data || null;
    } catch (error) {
      logger.error('Error fetching assignee by email:', error instanceof Error ? error.message : JSON.stringify(error));
      throw error;
    }
  },

  // Create new assignee
  async createAssignee(assigneeData: CreateAssigneeRequest): Promise<InterviewAssignee> {
    try {
      // Remove organization_id if it's an empty string
      // If user provides applicant_id, use it; otherwise let database trigger auto-generate it
      const dataToInsert: any = {
        ...assigneeData,
        organization_id: assigneeData.organization_id || null,
      };

      // Only remove applicant_id if it's explicitly empty/null - let database auto-generate
      // If user provided a value, keep it
      if (!assigneeData.applicant_id || assigneeData.applicant_id.trim() === '') {
        delete dataToInsert.applicant_id;
      }

      // If running in browser, call API endpoint (for logging)
      // If running in server (API route), use direct Supabase call
      if (typeof window !== 'undefined') {
        // Browser context - call API endpoint for logging
        const token = localStorage.getItem('auth_token');
        const baseUrl = window.location.origin;
        
        const response = await fetch(`${baseUrl}/api/assignees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          credentials: 'include',
          body: JSON.stringify(dataToInsert),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } else {
        // Server context - use direct Supabase call (API route will handle logging)
        const { data, error } = await supabase
          .from('interview_assignee')
          .insert([dataToInsert])
          .select()
          .single();

        if (error) {
          throw error;
        }

        return data;
      }
    } catch (error) {
      logger.error('Error creating assignee:', error instanceof Error ? error.message : JSON.stringify(error));
      throw error;
    }
  },

  // Update assignee
  async updateAssignee(id: number, updateData: UpdateAssigneeRequest): Promise<InterviewAssignee> {
    try {
      // If running in browser, call API endpoint (for logging)
      // If running in server (API route), use direct Supabase call
      if (typeof window !== 'undefined') {
        // Browser context - call API endpoint for logging
        const token = localStorage.getItem('auth_token');
        const baseUrl = window.location.origin;
        
        const response = await fetch(`${baseUrl}/api/assignees/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          credentials: 'include',
          body: JSON.stringify(updateData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } else {
        // Server context - use direct Supabase call (API route will handle logging)
        const { data, error } = await supabase
          .from('interview_assignee')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          throw error;
        }

        return data;
      }
    } catch (error) {
      logger.error('Error updating assignee:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Delete assignee
  async deleteAssignee(id: number): Promise<void> {
    try {
      // If running in browser, call API endpoint (for logging)
      // If running in server (API route), use direct Supabase call
      if (typeof window !== 'undefined') {
        // Browser context - call API endpoint for logging
        const token = localStorage.getItem('auth_token');
        const baseUrl = window.location.origin;
        
        const response = await fetch(`${baseUrl}/api/assignees/${id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
      } else {
        // Server context - use direct Supabase call (API route will handle logging)
        const { error } = await supabase
          .from('interview_assignee')
          .delete()
          .eq('id', id);

        if (error) {
          throw error;
        }
      }
    } catch (error) {
      logger.error('Error deleting assignee:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Update assignee status
  async updateAssigneeStatus(id: number, status: 'active' | 'inactive' | 'pending'): Promise<InterviewAssignee> {
    try {
      const { data, error } = await supabase
        .from('interview_assignee')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

      if (error) {
  throw error;
}

      return data;
    } catch (error) {
      logger.error('Error updating assignee status:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Assign interview to assignee
  async assignInterview(assignmentData: AssignInterviewRequest): Promise<InterviewAssignee> {
    try {
      // If running in browser, call API endpoint (for logging)
      // If running in server (API route), use direct Supabase call
      if (typeof window !== 'undefined') {
        // Browser context - call API endpoint for logging
        const token = localStorage.getItem('auth_token');
        const baseUrl = window.location.origin;
        
        const response = await fetch(`${baseUrl}/api/assignees/assign-interview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          credentials: 'include',
          body: JSON.stringify(assignmentData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } else {
        // Server context - use direct Supabase call (API route will handle logging)
        const { data, error } = await supabase
          .from('interview_assignee')
          .update({
            interview_id: assignmentData.interview_id,
            assigned_by: assignmentData.assigned_by,
            assigned_at: new Date().toISOString(),
            notes: assignmentData.notes
          })
          .eq('id', assignmentData.assignee_id)
          .select()
          .single();

        if (error) {
          throw error;
        }

        return data;
      }
    } catch (error) {
      logger.error('Error assigning interview:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Unassign interview from assignee
  async unassignInterview(unassignData: UnassignInterviewRequest): Promise<InterviewAssignee> {
    try {
      // If running in browser, call API endpoint (for logging)
      // If running in server (API route), use direct Supabase call
      if (typeof window !== 'undefined') {
        // Browser context - call API endpoint for logging
        const token = localStorage.getItem('auth_token');
        const baseUrl = window.location.origin;
        
        const response = await fetch(`${baseUrl}/api/assignees/assign-interview`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
          credentials: 'include',
          body: JSON.stringify(unassignData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } else {
        // Server context - use direct Supabase call (API route will handle logging)
        const { data, error } = await supabase
          .from('interview_assignee')
          .update({
            interview_id: null,
            assigned_by: unassignData.assigned_by,
            assigned_at: null,
            notes: null
          })
          .eq('id', unassignData.assignee_id)
          .select()
          .single();

        if (error) {
          throw error;
        }

        return data;
      }
    } catch (error) {
      logger.error('Error unassigning interview:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Get assignees by interview ID
  async getAssigneesByInterview(interviewId: string): Promise<InterviewAssignee[]> {
    try {
      const { data, error } = await supabase
        .from('interview_assignee')
        .select('*')
        .eq('interview_id', interviewId)
        .order('assigned_at', { ascending: false });

      if (error) {
  throw error;
}

      return data || [];
    } catch (error) {
      logger.error('Error fetching assignees by interview:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Search assignees - optionally filter by organization_id
  async searchAssignees(organizationId: string | null | undefined, searchTerm: string): Promise<InterviewAssignee[]> {
    try {
      let query = supabase
        .from('interview_assignee')
        .select('*')
        .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }
      // If no organization_id, get ALL matching assignees

      const { data, error } = await query;

      if (error) {
  throw error;
}

      return data || [];
    } catch (error) {
      logger.error('Error searching assignees:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Get assignees by status - optionally filter by organization_id
  async getAssigneesByStatus(organizationId: string | null | undefined, status: 'active' | 'inactive' | 'pending'): Promise<InterviewAssignee[]> {
    try {
      let query = supabase
        .from('interview_assignee')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }
      // If no organization_id, get ALL assignees with this status

      const { data, error } = await query;

      if (error) {
  throw error;
}

      return data || [];
    } catch (error) {
      logger.error('Error fetching assignees by status:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Get unassigned assignees (no interview_id) - optionally filter by organization_id
  async getUnassignedAssignees(organizationId: string | null | undefined): Promise<InterviewAssignee[]> {
    try {
      let query = supabase
        .from('interview_assignee')
        .select('*')
        .is('interview_id', null)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }
      // If no organization_id, get ALL unassigned assignees

      const { data, error } = await query;

      if (error) {
  throw error;
}

      return data || [];
    } catch (error) {
      logger.error('Error fetching unassigned assignees:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },

  // Update assignee review status by email and interview_id
  async updateAssigneeReviewStatus(
    email: string,
    interviewId: string,
    reviewStatus: 'NO_STATUS' | 'NOT_SELECTED' | 'POTENTIAL' | 'SELECTED'
  ): Promise<InterviewAssignee | null> {
    try {
      // Determine interview_status based on review_status
      // Any review_status value (SELECTED, NOT_SELECTED, POTENTIAL) → REVIEWED
      // review_status = NO_STATUS or null → NOT_REVIEWED
      let interviewStatus: 'REVIEWED' | 'NOT_REVIEWED' | null = null;

      if (reviewStatus === 'NO_STATUS' || !reviewStatus) {
        interviewStatus = 'NOT_REVIEWED';
      } else if (reviewStatus === 'SELECTED' || reviewStatus === 'NOT_SELECTED' || reviewStatus === 'POTENTIAL') {
        interviewStatus = 'REVIEWED';
      }

      const updateData: any = { review_status: reviewStatus };
      if (interviewStatus) {
        updateData.interview_status = interviewStatus;
      }

      // Use case-insensitive email match and don't use .single() to avoid error when no rows found
      const { data, error } = await supabase
        .from('interview_assignee')
        .update(updateData)
        .ilike('email', email)
        .eq('interview_id', interviewId)
        .select();

      if (error) {
        throw error;
      }

      // Return the first matching record or null if no matches
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      logger.error('Error updating assignee review status:', error instanceof Error ? error.message : String(error));
      // Don't throw - return null to allow silent failure for background sync
      return null;
    }
  },

  // Get assignee by email and interview_id
  async getAssigneeByEmailAndInterview(
    email: string,
    interviewId: string
  ): Promise<InterviewAssignee | null> {
    try {
      const { data, error } = await supabase
        .from('interview_assignee')
        .select('*')
        // Use case-insensitive match to avoid issues with email casing
        .ilike('email', email)
        .eq('interview_id', interviewId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {

          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error getting assignee by email and interview:', error instanceof Error ? error.message : String(error));

      return null;
    }
  },
};

// User Service for managing users in the "user" table
export const createUser = async (
  userData: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    avatar_url?: string;
    organization_id: string;
    role: UserRole;
    status: UserStatus;
  },
  createdBy: string
): Promise<ClientUser | null> => {
  try {
    const userId = nanoid(); // Generate unique ID
    const { data, error } = await supabase
      .from('user')
      .insert([
        {
          id: userId, // Explicitly provide the ID
          ...userData,
          created_by: createdBy,
        },
      ])
      .select()
      .single();

    if (error) {
  throw error;
}

    return data;
  } catch (error) {
    logger.error('Error creating user:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const getUserByEmail = async (email: string): Promise<ClientUser | null> => {
  try {
    const { data, error } = await supabase
      .from('user')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      // If no user found, return null instead of throwing
      if (error.code === 'PGRST116') {

        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    logger.error('Error fetching user by email:', error instanceof Error ? error.message : String(error));

    return null;
  }
};

export const getUserById = async (userId: string): Promise<ClientUser | null> => {
  try {
    const { data, error } = await supabase
      .from('user')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {

        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    logger.error('Error fetching user by ID:', error instanceof Error ? error.message : String(error));

    return null;
  }
};

export const getAllUsers = async (organizationId: string, userRole?: string): Promise<ClientUser[]> => {
  try {
    let query = supabase
      .from('user')
      .select('*');

    // If user is admin, show all users. Otherwise, filter by organization
    if (userRole === 'admin') {
      // Admin can see all users - no organization filter
    } else {
      query = query.eq('organization_id', organizationId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) {
  throw error;
}

    return data || [];
  } catch (error) {
    logger.error('Error fetching all users:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const getUsersByRole = async (organizationId: string, role: string, userRole?: string): Promise<ClientUser[]> => {
  try {
    let query = supabase
      .from('user')
      .select('*')
      .eq('role', role);

    // If user is admin, show all users with this role. Otherwise, filter by organization
    if (userRole !== 'admin') {
      query = query.eq('organization_id', organizationId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) {
  throw error;
}

    return data || [];
  } catch (error) {
    logger.error('Error fetching users by role:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const getUsersByStatus = async (organizationId: string, status: string, userRole?: string): Promise<ClientUser[]> => {
  try {
    let query = supabase
      .from('user')
      .select('*')
      .eq('status', status);

    // If user is admin, show all users with this status. Otherwise, filter by organization
    if (userRole !== 'admin') {
      query = query.eq('organization_id', organizationId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) {
  throw error;
}

    return data || [];
  } catch (error) {
    logger.error('Error fetching users by status:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const searchUsers = async (organizationId: string, searchTerm: string, userRole?: string): Promise<ClientUser[]> => {
  try {
    let query = supabase
      .from('user')
      .select('*')
      .or(`email.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`);

    // If user is admin, search all users. Otherwise, filter by organization
    if (userRole !== 'admin') {
      query = query.eq('organization_id', organizationId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) {
  throw error;
}

    return data || [];
  } catch (error) {
    logger.error('Error searching users:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const updateUser = async (
  userId: string,
  updates: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    avatar_url?: string;
    role?: UserRole;
    status?: UserStatus;
  }
): Promise<ClientUser | null> => {
  try {
    const { data, error } = await supabase
      .from('user')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
  throw error;
}

    return data;
  } catch (error) {
    logger.error('Error updating user:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const deleteUser = async (userId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('user')
      .delete()
      .eq('id', userId);

    if (error) {
  throw error;
}

    return true;
  } catch (error) {
    logger.error('Error deleting user:', error instanceof Error ? error.message : String(error));
    throw error;
  }
};

export const logUserActivity = async (
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: any
): Promise<void> => {
  try {
    const { error } = await supabase
      .from('user_activity_log')
      .insert([
        {
          user_id: userId,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          details,
        },
      ]);

    if (error) {
  throw error;
}
  } catch (error) {
    logger.error('Error logging user activity:', error instanceof Error ? error.message : String(error));
    // Don't throw, just log the error - activity logging shouldn't break the main flow
  }
};
