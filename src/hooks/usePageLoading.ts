'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLoading } from '@/contexts/loading.context';

export const usePageLoading = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startLoading, stopLoading } = useLoading();

  useEffect(() => {
    // Stop loading when route changes
    stopLoading();
  }, [pathname, searchParams, stopLoading]);


  return { startLoading, stopLoading };
};

