"use client";

import { Suspense } from "react";
import React from "react";
import "../globals.css";
import { cn } from "@/lib/utils";
import Navbar from "@/components/navbar";
import Providers from "@/components/providers";
import { AuthProvider, useAuth } from "@/contexts/auth.context";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import SideMenu from "@/components/sideMenu";
import { NavigationLoader } from "@/components/NavigationLoader";
import { usePathname } from "next/navigation";

const metadata = {
  title: "DynaTech Systems - HR Interviewer",
  description: "AI-powered Interview Management System",
  openGraph: {
    title: "DynaTech Systems - HR Interviewer",
    description: "AI-powered Interview Management System",
    siteName: "DynaTech Systems",
    images: [
      {
        url: "/dynatech-logo.png",
        width: 800,
        height: 600,
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  
  // Public routes that don't require authentication
  const publicRoutes = ['/sign-in', '/sign-up', '/call/'];
  const isPublicRoute = publicRoutes.some(route => pathname?.includes(route));
  
  // Detect mobile screen size
  React.useEffect(() => {
    // Safety check for SSR
    if (typeof window === 'undefined') return;
    
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // On desktop, always keep sidebar "open" (visible)
      if (!mobile) {
        setIsSidebarOpen(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Close sidebar when route changes on mobile
  React.useEffect(() => {
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  }, [pathname, isMobile]);
  
  // Show loading screen while checking authentication (only for protected routes)
  if (isLoading && !isPublicRoute) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="inline-block h-16 w-16 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-lg text-gray-700 font-medium">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  const showSidebar = pathname && !pathname.includes("/sign-in") && !pathname.includes("/sign-up");

  return (
    <>
      <Suspense fallback={null}>
        <NavigationLoader />
      </Suspense>
      {showSidebar && (
        <Navbar 
          onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          isMenuOpen={isSidebarOpen}
        />
      )}
      <div className="flex flex-row h-screen relative">
        {showSidebar && (
          <SideMenu 
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
        )}
        <div className="md:ml-[200px] pt-[64px] h-full overflow-y-auto flex-grow w-full md:w-[calc(100%-200px)]">
          {children}
        </div>
      </div>
      <Toaster />
      <SonnerToaster position="top-right" richColors />
    </>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>{metadata.title}</title>
        <meta name="description" content={metadata.description} />
        <link rel="icon" href="/browser-client-icon.ico" />
      </head>
      <body
        className={cn(
          "font-sans",
          "antialiased overflow-hidden min-h-screen",
        )}
      >
        <AuthProvider>
          <Providers>
            <LayoutContent>{children}</LayoutContent>
          </Providers>
        </AuthProvider>
      </body>
    </html>
  );
}
