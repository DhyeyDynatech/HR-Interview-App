"use client";

import React from "react";
import { PlayCircleIcon, SpeechIcon, Users, X, LayoutDashboard, Settings, BarChart3, ScanSearch, Building2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useLoading } from "@/contexts/loading.context";
import { useAuth } from "@/contexts/auth.context";

interface SideMenuProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function SideMenu({ isOpen = true, onClose }: SideMenuProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { startLoading } = useLoading();
  const { user } = useAuth();
  const canAccessMarketing = user?.role === 'admin' || user?.role === 'marketing';

  const handleNavigation = (path: string) => {
    if (pathname && pathname === path) {
      return;
    }
    startLoading();
    router.push(path);
    if (onClose) {
      onClose();
    }
  };

  const isActive = (path: string, additionalPaths?: string[]) => {
    if (!pathname) return false;
    if (pathname === path) return true;
    if (additionalPaths) {
      return additionalPaths.some(p => pathname.includes(p));
    }
    return false;
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-[40] md:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={`
          z-[50] bg-slate-100 py-6 w-[200px] fixed top-[64px] left-0 h-full
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
        style={{ marginTop: '10px' }}
      >
        <div className="md:hidden flex justify-end mb-4 px-6">
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-col justify-between gap-1">
            <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard/overview")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard/overview")}
            >
              <LayoutDashboard className="h-5 w-5 mr-3" />
              <p className="font-medium">Dashboard</p>
            </div>
            <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard", ["/interviews"]) && !pathname?.includes("/overview") && !pathname?.includes("/interviewers") && !pathname?.includes("/users") && !pathname?.includes("/settings") && !pathname?.includes("/cost-analysis") && !pathname?.includes("/ats-scoring") && !pathname?.includes("/company-finder")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard")}
            >
              <PlayCircleIcon className="h-5 w-5 mr-3" />
              <p className="font-medium">Interviews</p>
            </div>
            <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard/interviewers")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard/interviewers")}
            >
              <SpeechIcon className="h-5 w-5 mr-3" />
              <p className="font-medium">Interviewers</p>
            </div>
            <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard/users")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard/users")}
            >
              <Users className="h-5 w-5 mr-3" />
              <p className="font-medium">Users</p>
            </div>
            <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard/ats-scoring")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard/ats-scoring")}
            >
              <ScanSearch className="h-5 w-5 mr-3" />
              <p className="font-medium">ATS Scoring</p>
            </div>
            {canAccessMarketing && (
              <div
                className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                  isActive("/dashboard/company-finder")
                    ? "bg-indigo-500 text-white"
                    : "hover:bg-slate-200"
                }`}
                onClick={() => handleNavigation("/dashboard/company-finder")}
              >
                <Building2 className="h-5 w-5 mr-3" />
                <p className="font-medium">Company Finder</p>
              </div>
            )}
            <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard/cost-analysis")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard/cost-analysis")}
            >
              <BarChart3 className="h-5 w-5 mr-3" />
              <p className="font-medium">Cost & Analysis</p>
            </div>
            {/* <div
              className={`flex flex-row items-center px-6 py-3 cursor-pointer transition-colors ${
                isActive("/dashboard/settings")
                  ? "bg-indigo-500 text-white"
                  : "hover:bg-slate-200"
              }`}
              onClick={() => handleNavigation("/dashboard/settings")}
            >
              <Settings className="h-5 w-5 mr-3" />
              <p className="font-medium">Settings</p>
            </div> */}
          </div>
        </div>
      </div>
    </>
  );
}

export default SideMenu;
