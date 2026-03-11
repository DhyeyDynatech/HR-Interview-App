"use client";

import Link from "next/link";
import React, { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLoading } from "@/contexts/loading.context";
import { useAuth } from "@/contexts/auth.context";
import { LogOut, User, Settings, Menu, X } from "lucide-react";

interface NavbarProps {
  onMenuToggle?: () => void;
  isMenuOpen?: boolean;
}

function Navbar({ onMenuToggle, isMenuOpen = false }: NavbarProps) {
  const pathname = usePathname();
  const { startLoading } = useLoading();
  const { user, logout, isLoading: authLoading } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleLogoClick() {
    if (pathname && !pathname.endsWith("/dashboard")) {
      startLoading();
    }
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
  };

  function getUserInitials() {
    if (!user) {
  return "?";
}

    return `${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase() || "?";
  };


  return (
    <div className="fixed inset-x-0 top-0 bg-slate-100 z-[10] h-fit py-4" style={{ backgroundColor: 'black' }}>
      <div className="flex items-center justify-between h-full gap-2 px-4 md:px-8 mx-auto">
        <div className="flex flex-row gap-3 justify-center items-center">
          {/* Mobile Menu Toggle Button */}
          {onMenuToggle && (
            <button
              onClick={onMenuToggle}
              className="md:hidden text-white p-2 hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              {isMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          )}
          <Link 
            href="/dashboard" 
            className="flex items-center gap-2"
            onClick={handleLogoClick}
          >
            <img 
              src="/dynatech-logo.png" 
              alt="DynaTech Systems Logo" 
              className="h-8 md:h-10 w-auto object-contain"
            />
          </Link>
        </div>

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2"
            disabled={authLoading}
          >
            {authLoading ? (
              <div className="w-9 h-9 rounded-full bg-gray-300 flex items-center justify-center border-2 border-white shadow-sm animate-pulse">
                <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={`${user.first_name} ${user.last_name}`}
                className="w-9 h-9 rounded-full object-cover border-2 border-white shadow-sm"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#ff6b35] flex items-center justify-center text-white font-medium text-sm border-2 border-white shadow-sm">
                {getUserInitials()}
              </div>
            )}
          </button>

          {showUserMenu && (
            <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <div className="py-1">
                <Link
                  href="/profile"
                  onClick={() => {
                    setShowUserMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <User className="h-4 w-4 text-gray-400" />
                  Profile
                </Link>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    // TODO: Navigate to settings
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings className="h-4 w-4 text-gray-400" />
                  Settings
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Navbar;
