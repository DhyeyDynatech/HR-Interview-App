'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLoading } from '@/contexts/loading.context';
import { useInterviews } from '@/contexts/interviews.context';
import { useAssignees } from '@/contexts/users.context';
import { useInterviewers } from '@/contexts/interviewers.context';
import { useAuth } from '@/contexts/auth.context';

const MIN_LOADER_DISPLAY_TIME = 500; // Minimum time to show loader (ms)
const RENDER_BUFFER_TIME = 300; // Extra time to ensure page is fully rendered (ms) - reduced for faster navigation

export function NavigationLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isLoading, stopLoading, forceStopLoading } = useLoading();
  const { isLoading: authLoading } = useAuth();
  
  // Get loading states from all contexts
  const { interviewsLoading } = useInterviews();
  const { assigneesLoading } = useAssignees();
  const { interviewersLoading } = useInterviewers();
  
  const prevPathRef = useRef(pathname);
  const loadingStartTimeRef = useRef<number | null>(null);
  const [canStopLoading, setCanStopLoading] = useState(false);
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxWaitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_LOADER_TIME = 5000; // Maximum 5 seconds

  // Track when loading started
  useEffect(() => {
    if (isLoading && !loadingStartTimeRef.current) {
      loadingStartTimeRef.current = Date.now();
      setCanStopLoading(false);
      
      // Set minimum display time
      const timeout = setTimeout(() => {
        setCanStopLoading(true);
      }, MIN_LOADER_DISPLAY_TIME);
      
      // Safety timeout: Force stop after MAX_LOADER_TIME
      maxWaitTimeoutRef.current = setTimeout(() => {
        console.log('⏰ Max loader time reached - force stopping loader');
        forceStopLoading();
      }, MAX_LOADER_TIME);
      

      return () => {
        clearTimeout(timeout);
        if (maxWaitTimeoutRef.current) {
          clearTimeout(maxWaitTimeoutRef.current);
        }
      };
    } else if (!isLoading) {
      loadingStartTimeRef.current = null;
      // Clear max timeout when loading stops naturally
      if (maxWaitTimeoutRef.current) {
        clearTimeout(maxWaitTimeoutRef.current);
        maxWaitTimeoutRef.current = null;
      }
    }
  }, [isLoading, forceStopLoading]);

  // Handle route changes
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      console.log('🔄 Route changed from', prevPathRef.current, 'to', pathname);
      prevPathRef.current = pathname;
      
      // Reset the loading start time on route change
      // This allows quick successive navigations to work properly
      loadingStartTimeRef.current = null;
      
      // If currently loading and route changed, allow immediate stop
      if (isLoading) {
        console.log('⚡ Quick navigation detected - allowing immediate stop');
        setCanStopLoading(true);
      }
    }
  }, [pathname, searchParams, isLoading]);

  // Cleanup on unmount
  useEffect(() => {

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
      if (maxWaitTimeoutRef.current) {
        clearTimeout(maxWaitTimeoutRef.current);
      }
    };
  }, []);

  // Stop loading once all data is loaded AND minimum time has passed
  useEffect(() => {
    // Clear any existing timeout
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = null;
    }

    // Don't check data loading if auth is still loading
    if (authLoading) {
      console.log('🔐 Auth still loading, keeping loader visible');

      return;
    }

    const isDataLoading = interviewsLoading || assigneesLoading || interviewersLoading;
    
    console.log('📊 Navigation Loader State:', {
      isLoading,
      isDataLoading,
      canStopLoading,
      interviewsLoading,
      assigneesLoading,
      interviewersLoading
    });
    
    if (isLoading && !isDataLoading && canStopLoading) {
      console.log('⏳ Data loaded, waiting for render to complete...');
      
      // Give more time for page to fully render and paint
      renderTimeoutRef.current = setTimeout(() => {
        // Use requestAnimationFrame to wait for next paint
        requestAnimationFrame(() => {
          console.log('🎨 Page rendered, stopping navigation loader');
          
          // Force stop if we've been loading for a while
          const loadingDuration = loadingStartTimeRef.current 
            ? Date.now() - loadingStartTimeRef.current 
            : 0;
          
          if (loadingDuration > 2000) {
            console.log('⚠️ Long loading detected, force stopping');
            forceStopLoading();
          } else {
            stopLoading(); // This will only stop if counter reaches 0
          }
          
          renderTimeoutRef.current = null;
        });
      }, RENDER_BUFFER_TIME);
      

      return () => {
        if (renderTimeoutRef.current) {
          clearTimeout(renderTimeoutRef.current);
        }
      };
    }
  }, [isLoading, interviewsLoading, assigneesLoading, interviewersLoading, stopLoading, canStopLoading, authLoading]);


  return null;
}
