"use client";

import React, { useState, useContext, ReactNode, useEffect } from "react";
import { Interviewer } from "@/types/interviewer";
import { InterviewerService } from "@/services/interviewers.service";
import { useAuth } from "@/contexts/auth.context";

interface InterviewerContextProps {
  interviewers: Interviewer[];
  setInterviewers: React.Dispatch<React.SetStateAction<Interviewer[]>>;
  createInterviewer: (payload: any) => void;
  interviewersLoading: boolean;
  setInterviewersLoading: (interviewersLoading: boolean) => void;
}

export const InterviewerContext = React.createContext<InterviewerContextProps>({
  interviewers: [],
  setInterviewers: () => {},
  createInterviewer: () => {},
  interviewersLoading: false,
  setInterviewersLoading: () => undefined,
});

interface InterviewerProviderProps {
  children: ReactNode;
}

export function InterviewerProvider({ children }: InterviewerProviderProps) {
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const { user, isLoading: authLoading } = useAuth();
  const [interviewersLoading, setInterviewersLoading] = useState(true);

  const fetchInterviewers = async () => {
    if (!user?.id) {
      setInterviewersLoading(false);

      return;
    }

    try {
      setInterviewersLoading(true);
      const response = await InterviewerService.getAllInterviewers(user.id);
      setInterviewers(response);
      console.log('✅ Interviewers data set, count:', response.length);
      
      // Small delay to ensure state has propagated
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(error);
    } finally {
      console.log('📊 Setting interviewersLoading to false');
      setInterviewersLoading(false);
    }
  };

  const createInterviewer = async (payload: any) => {
    // Interviewer creation is disabled - only default interviewers are allowed
    console.warn("Interviewer creation is disabled. Only default interviewers are allowed.");
    return null;
  };

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      return;
    }

    // If no user, stop loading
    if (!user?.id) {
      setInterviewersLoading(false);

      return;
    }

    // Fetch interviewers if user is available
    fetchInterviewers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);


  return (
    <InterviewerContext.Provider
      value={{
        interviewers,
        setInterviewers,
        createInterviewer,
        interviewersLoading,
        setInterviewersLoading,
      }}
    >
      {children}
    </InterviewerContext.Provider>
  );
}

export const useInterviewers = () => {
  const value = useContext(InterviewerContext);

  return value;
};
