"use client";

import React, { useState, useContext, ReactNode, useEffect } from "react";
import { Interview } from "@/types/interview";
import { InterviewService } from "@/services/interviews.service";
import { useAuth } from "@/contexts/auth.context";

interface InterviewContextProps {
  interviews: Interview[];
  setInterviews: React.Dispatch<React.SetStateAction<Interview[]>>;
  getInterviewById: (interviewId: string) => Interview | null | any;
  interviewsLoading: boolean;
  setInterviewsLoading: (interviewsLoading: boolean) => void;
  fetchInterviews: () => void;
}

export const InterviewContext = React.createContext<InterviewContextProps>({
  interviews: [],
  setInterviews: () => {},
  getInterviewById: () => null,
  setInterviewsLoading: () => undefined,
  interviewsLoading: false,
  fetchInterviews: () => {},
});

interface InterviewProviderProps {
  children: ReactNode;
}

export function InterviewProvider({ children }: InterviewProviderProps) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const { user, isLoading: authLoading } = useAuth();
  const [interviewsLoading, setInterviewsLoading] = useState(true);

  const fetchInterviews = async () => {
    if (!user?.id) {
      setInterviewsLoading(false);

      return;
    }

    try {
      setInterviewsLoading(true);
      const response = await InterviewService.getAllInterviews(user.id, user.role, user.organization_id);
      setInterviews(response);
      console.log('✅ Interviews data set, count:', response.length);
      
      // Small delay to ensure state has propagated
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(error);
    } finally {
      console.log('📊 Setting interviewsLoading to false');
      setInterviewsLoading(false);
    }
  };

  const getInterviewById = async (interviewId: string) => {
    const response = await InterviewService.getInterviewById(interviewId);

    return response;
  };

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      return;
    }

    // If no user, stop loading
    if (!user?.id) {
      setInterviewsLoading(false);

      return;
    }

    // Fetch interviews if user is available
    fetchInterviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);


  return (
    <InterviewContext.Provider
      value={{
        interviews,
        setInterviews,
        getInterviewById,
        interviewsLoading,
        setInterviewsLoading,
        fetchInterviews,
      }}
    >
      {children}
    </InterviewContext.Provider>
  );
}

export const useInterviews = () => {
  const value = useContext(InterviewContext);

  return value;
};
