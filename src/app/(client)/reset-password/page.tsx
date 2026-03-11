"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";

function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || null;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Invalid reset link. Please request a new password reset.");
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Invalid reset link. Please request a new password reset.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push("/sign-in");
        }, 3000);
      } else {
        setError(data.message || "Failed to reset password");
      }
    } catch (err) {
      setError("An error occurred. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen w-full bg-gray-100 absolute top-0 left-0 z-50">
      {/* Desktop View */}
      <div className="hidden md:flex flex-col items-center justify-center z-10" style={{width: "100%"}}>
        {/* Black Card Container */}
        <div className="bg-black rounded-2xl shadow-2xl p-12 w-full max-w-md">
          {/* Header with Logo */}
          <div className="w-full mb-12 text-center">
            <div className="flex items-center justify-center mb-6">
              <img 
                src="/dynatech-logo.png" 
                alt="DynaTech Systems" 
                className="h-7 w-auto object-contain"
              />
            </div>
            <p className="text-white text-sm">AI-powered Interview Management System</p>
          </div>

          {/* Main Content */}
          <div className="w-full">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold text-white mb-2">Reset Password</h1>
              <p className="text-white text-sm">Enter your new password</p>
            </div>

            {success ? (
              <div className="space-y-6">
                <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-lg text-sm text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <p className="font-semibold">Password reset successful!</p>
                  </div>
                  <p>Redirecting to sign in page...</p>
                </div>
                <Link href="/sign-in">
                  <Button className="w-full h-12 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold rounded-lg transition-all">
                    Go to Sign In
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-white text-sm font-medium">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      className="pl-10 pr-10 h-12 border-0 bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-white/20 rounded-lg"
                      required
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <p className="text-white/60 text-xs">Password must be at least 6 characters long</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-white text-sm font-medium">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={confirmPassword}
                      className="pl-10 pr-10 h-12 border-0 bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-white/20 rounded-lg"
                      required
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !token}
                  className="w-full h-12 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold rounded-lg transition-all mt-6"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </form>
            )}

            <div className="mt-6 text-center">
              <Link href="/sign-in" className="text-[#5865f2] hover:text-[#4752c4] text-sm font-semibold transition-colors">
                Back to Sign In
              </Link>
            </div>
          </div>

          {/* Footer */}
          <p className="mt-12 text-center text-xs text-white/60">
            © {new Date().getFullYear()} DynaTech Systems. All rights reserved.
          </p>
        </div>
      </div>

      {/* Mobile View */}
      <div className="block md:hidden px-6 w-full max-w-sm z-10">
        <div className="text-center bg-black rounded-2xl p-8">
          <img 
            src="/dynatech-logo.png" 
            alt="DynaTech Systems" 
            className="h-10 w-auto mx-auto mb-3 object-contain"
          />
          <h2 className="text-lg mt-4 text-white">
            Mobile version is currently under construction. 🚧
          </h2>
          <p className="text-white/70 mt-3">
            Please reset your password using a PC for the best experience. Sorry for the
            inconvenience.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordPage;

