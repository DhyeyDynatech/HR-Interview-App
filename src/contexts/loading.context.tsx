'use client';

import React, { createContext, useContext, useState, useRef, ReactNode } from 'react';

interface LoadingContextType {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  startLoading: (taskId?: string) => string; // Returns task ID
  stopLoading: (taskId?: string) => void;
  forceStopLoading: () => void; // Emergency stop
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function useLoading() {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }

  return context;
};

interface LoadingProviderProps {
  children: ReactNode;
}

export function LoadingProvider({ children }: LoadingProviderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const loadingCounterRef = useRef(0);
  const activeTasksRef = useRef<Set<string>>(new Set());
  const taskIdCounterRef = useRef(0);

  const startLoading = (taskId?: string): string => {
    const id = taskId || `task-${++taskIdCounterRef.current}`;
    
    console.log(`🔵 Loading START for: ${id}`);
    
    activeTasksRef.current.add(id);
    loadingCounterRef.current++;
    
    console.log(`📊 Active tasks: ${activeTasksRef.current.size}, Counter: ${loadingCounterRef.current}`);
    
    if (!isLoading) {
      setIsLoading(true);
    }
    

    return id;
  };

  function stopLoading(taskId?: string) {
    if (taskId && activeTasksRef.current.has(taskId)) {
      console.log(`🟢 Loading STOP for: ${taskId}`);
      activeTasksRef.current.delete(taskId);
      loadingCounterRef.current = Math.max(0, loadingCounterRef.current - 1);
    } else if (!taskId) {
      // Legacy support: decrement counter without specific task ID
      console.log(`🟡 Loading STOP (no task ID)`);
      loadingCounterRef.current = Math.max(0, loadingCounterRef.current - 1);
      
      // If counter hits 0 but tasks remain, clear the oldest task
      if (loadingCounterRef.current === 0 && activeTasksRef.current.size > 0) {
        const oldestTask = Array.from(activeTasksRef.current)[0];
        console.log(`🧹 Cleaning up orphaned task: ${oldestTask}`);
        activeTasksRef.current.delete(oldestTask);
      }
    }
    
    console.log(`📊 Active tasks: ${activeTasksRef.current.size}, Counter: ${loadingCounterRef.current}`);
    
    // Only stop loading when all tasks are complete
    // Auto-cleanup: If counter is 0 but tasks remain, force clear them
    if (loadingCounterRef.current === 0) {
      if (activeTasksRef.current.size > 0) {
        console.log(`⚠️ Counter is 0 but ${activeTasksRef.current.size} task(s) remain. Force clearing...`);
        activeTasksRef.current.clear();
      }
      console.log(`✅ All loading tasks complete - hiding loader`);
      setIsLoading(false);
    }
  };

  function forceStopLoading() {
    console.log(`🔴 Force STOP - Clearing all loading states`);
    loadingCounterRef.current = 0;
    activeTasksRef.current.clear();
    setIsLoading(false);
  };


  return (
    <LoadingContext.Provider
      value={{
        isLoading,
        setIsLoading,
        startLoading,
        stopLoading,
        forceStopLoading,
      }}
    >
      {children}
    </LoadingContext.Provider>
  );
};

