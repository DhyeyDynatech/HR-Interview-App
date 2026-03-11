"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { User } from "@/types/auth";

interface AuthContextProps {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  signup: (data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextProps>({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
  signup: async () => ({ success: false }),
  logout: async () => {},
  refreshSession: async () => {},
  refreshUser: async () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const sessionCheckAttempts = useRef(0);
  const sessionRefreshInterval = useRef<NodeJS.Timeout | null>(null);

  // Handle invalid session - wrapped in useCallback for stable reference
  const handleInvalidSession = useCallback(() => {
    console.log('🔐 Auth Provider: Clearing invalid session');
    localStorage.removeItem("auth_token");
    setUser(null);
    setToken(null);
    sessionCheckAttempts.current = 0;
    
    // Redirect to login if not already on public pages
    const publicPages = ['/sign-in', '/sign-up', '/call/', '/reset-password'];
    const isPublicPage = publicPages.some(page => pathname?.includes(page));
    
    if (!isPublicPage) {
      console.log('🔐 Auth Provider: Redirecting to login page');
      router.push('/sign-in');
    }
  }, [pathname, router]);

  // Check session - wrapped in useCallback for stable reference
  const checkSession = useCallback(async (silent: boolean = false) => {
    try {
      const token = localStorage.getItem("auth_token");
      
      if (!token) {
        console.log('🔐 Auth Provider: No token found');
        setUser(null);
        setToken(null);
        setIsLoading(false);

        return;
      }

      // Check token expiry locally before making API call
      try {
        const [encoded] = token.split(".");
        // Use browser-compatible base64 decoding
        let decoded: string;
        if (typeof window !== 'undefined') {
          // Browser environment - use atob
          decoded = atob(encoded);
        } else {
          // Node.js environment - use Buffer
          decoded = Buffer.from(encoded, "base64").toString("utf-8");
        }
        const payload = JSON.parse(decoded);
        
        if (payload.exp < Date.now()) {
          console.log('🔐 Auth Provider: Token expired locally (instant logout)');
          handleInvalidSession();
          setIsLoading(false);

          return;
        }
      } catch (error) {
        console.error('🔐 Auth Provider: Error parsing token:', error);
        handleInvalidSession();
        setIsLoading(false);

        return;
      }

      console.log('🔐 Auth Provider: Checking session with token');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch("/api/auth/session", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          console.log('✅ Auth Provider: Session valid, user:', data.user.email);
          setUser(data.user);
          setToken(token);
          sessionCheckAttempts.current = 0; // Reset retry counter on success
        } else {
          console.error('❌ Auth Provider: Invalid session response');
          handleInvalidSession();
        }
      } else {
        console.error('❌ Auth Provider: Session check failed with status:', response.status);
        handleInvalidSession();
      }
    } catch (error: any) {
      console.error("❌ Auth Provider: Session check error:", error);
      
      // Retry logic for network errors (not auth errors)
      if (error.name === 'AbortError' || error.message?.includes('fetch')) {
        sessionCheckAttempts.current++;
        
        if (sessionCheckAttempts.current < 3) {
          console.log(`🔄 Auth Provider: Retrying session check (attempt ${sessionCheckAttempts.current + 1}/3)`);
          setTimeout(() => checkSession(silent), 2000); // Retry after 2 seconds

          return;
        } else {
          console.error('❌ Auth Provider: Max retry attempts reached');
        }
      }
      
      // Don't clear token on network errors during silent refresh
      if (!silent) {
        handleInvalidSession();
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [handleInvalidSession]);

  // Check session on mount and setup periodic refresh
  useEffect(() => {
    console.log('🔐 Auth Provider: Initializing session check');
    checkSession();
    
    // Setup periodic session refresh every 5 minutes
    sessionRefreshInterval.current = setInterval(() => {
      console.log('🔄 Auth Provider: Periodic session refresh');
      const token = localStorage.getItem("auth_token");
      if (token) {
        checkSession(true); // Silent refresh
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Check session when tab becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('👁️ Auth Provider: Tab became visible, checking session');
        const token = localStorage.getItem("auth_token");
        if (token) {
          checkSession(true); // Silent refresh
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);


    return () => {
      if (sessionRefreshInterval.current) {
        clearInterval(sessionRefreshInterval.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkSession]);

  // Redirect to login if user is not authenticated
  useEffect(() => {
    // Public routes that don't require authentication
    const publicRoutes = ['/sign-in', '/sign-up', '/call/', '/reset-password']; // /call/ is for candidates taking interviews
    const isPublicRoute = publicRoutes.some(route => pathname?.includes(route));
    
    // Don't redirect if still loading or on public route
    if (isLoading || isPublicRoute) {
      return;
    }
    
    // Redirect to login if no user and not loading
    if (!user) {
      console.log('🔐 Auth Provider: No authenticated user, redirecting to login');
      router.push('/sign-in');
    }
  }, [user, isLoading, pathname, router]);

  const login = async (email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      console.log('🔐 Auth Provider: Attempting login for:', email);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log('✅ Auth Provider: Login successful');
        localStorage.setItem("auth_token", data.session.token);
        setUser(data.session.user);
        setToken(data.session.token);
        sessionCheckAttempts.current = 0; // Reset retry counter

        return { success: true };
      }

      console.error('❌ Auth Provider: Login failed:', data.message);

      return { success: false, message: data.message || "Login failed" };
    } catch (error) {
      console.error("❌ Auth Provider: Login error:", error);

      return { success: false, message: "An error occurred during login" };
    }
  };

  const signup = async (data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        localStorage.setItem("auth_token", result.session.token);
        setUser(result.session.user);
        setToken(result.session.token);

        return { success: true };
      }


      return { success: false, message: result.message || "Signup failed" };
    } catch (error) {
      console.error("Signup error:", error);

      return { success: false, message: "An error occurred during signup" };
    }
  };

  const logout = async () => {
    try {
      console.log('🔐 Auth Provider: Logging out');
      const token = localStorage.getItem("auth_token");
      if (token) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      console.error("❌ Auth Provider: Logout error:", error);
    } finally {
      localStorage.removeItem("auth_token");
      setUser(null);
      setToken(null);
      sessionCheckAttempts.current = 0;
      
      // Clear the periodic refresh interval
      if (sessionRefreshInterval.current) {
        clearInterval(sessionRefreshInterval.current);
      }
      
      console.log('✅ Auth Provider: Logout complete');
      router.push("/sign-in");
    }
  };

  const refreshSession = async () => {
    console.log('🔄 Auth Provider: Manual session refresh requested');
    await checkSession(false);
  };

  const refreshUser = async () => {
    console.log('🔄 Auth Provider: Refreshing user data');
    await checkSession(false);
  };


  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login,
        signup,
        logout,
        refreshSession,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
};
