"use client";

import { ReactNode } from 'react';
import { InterviewProvider } from '@/contexts/interviews.context';
import { InterviewerProvider } from '@/contexts/interviewers.context';
import { ClientProvider } from '@/contexts/clients.context';
import { ResponseProvider } from '@/contexts/responses.context';
import { AssigneesProvider } from '@/contexts/users.context';
import { LoadingProvider, useLoading } from '@/contexts/loading.context';
import { ToastProvider } from '@/components/ui/toast';
import PageLoader from '@/components/loaders/page-loader/PageLoader';
import ProgressBar from '@/components/loaders/progress-bar/ProgressBar';

interface ProvidersProps {
  children: ReactNode;
}

function LoadingWrapper({ children }: ProvidersProps) {
  const { isLoading } = useLoading();
  

  return (
    <>
      <ProgressBar isLoading={isLoading} />
      <PageLoader isLoading={isLoading} />
      {children}
    </>
  );
};

function Providers({ children }: ProvidersProps) {

  return (
    <LoadingProvider>
      <ToastProvider>
        <InterviewProvider>
          <InterviewerProvider>
            <ClientProvider>
              <ResponseProvider>
                <AssigneesProvider>
                  <LoadingWrapper>
                    {children}
                  </LoadingWrapper>
                </AssigneesProvider>
              </ResponseProvider>
            </ClientProvider>
          </InterviewerProvider>
        </InterviewProvider>
      </ToastProvider>
    </LoadingProvider>
  );
};

export default Providers;
