"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Lock, Eye, EyeOff } from "lucide-react";

function SignInPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState("");
  const [forgotPasswordIsError, setForgotPasswordIsError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await login(email, password);
      if (result.success) {
        router.push("/dashboard/overview");
      } else {
        setError(result.message || "Login failed");
      }
    } catch (err) {
      setError("An error occurred during login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotPasswordMessage("");
    setForgotPasswordIsError(false);
    setForgotPasswordLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });

      const data = await response.json();

      if (data.success) {
        setForgotPasswordIsError(false);
        setForgotPasswordMessage(data.message);
        // In development, show the reset link
        if (data.resetLink) {
          setForgotPasswordMessage(
            `${data.message}\n\nReset link (DEV ONLY): ${data.resetLink}`
          );
        }
      } else {
        setForgotPasswordIsError(true);
        setForgotPasswordMessage(data.message || "An error occurred");
      }
    } catch (err) {
      setForgotPasswordIsError(true);
      setForgotPasswordMessage("An error occurred. Please try again later.");
    } finally {
      setForgotPasswordLoading(false);
    }
  };


  return (
    <div className="flex items-center justify-center min-h-screen w-full bg-gray-100 absolute top-0 left-0 z-50">
      {/* Desktop View */}
      <div className="hidden md:flex flex-col items-center justify-center z-10" style={{width: "100%"}}>
        {/* Black Card Container */}
        <div className="bg-black rounded-2xl shadow-2xl p-12 w-full max-w-md">
          {/* Header with Logo and Microsoft Badge */}
          <div className="w-full mb-12 text-center">
            <div className="flex items-center justify-between mb-6" style={{marginLeft: "32px"}}>
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
              <h1 className="text-4xl font-bold text-white mb-2">Welcome back</h1>
              <p className="text-white text-sm">Sign in to your account</p>
            </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-white text-sm font-medium">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="example@example.com"
                  value={email}
                  className="pl-10 h-12 border-0 bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-white/20 rounded-lg"
                  required
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-white text-sm font-medium">Password</Label>
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
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-sm text-[#5865f2] hover:text-[#4752c4] transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold rounded-lg transition-all mt-6"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-white text-sm">
              {/* Don&apos;t have an account?{" "} */}
              {/* <Link href="/sign-up" className="text-[#5865f2] hover:text-[#4752c4] font-semibold transition-colors">
                Sign up
              </Link> */}
            </p>
          </div>
          </div>

          {/* Forgot Password Modal */}
          {showForgotPassword && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-black rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-800">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-white">Reset Password</h2>
                  <button
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotPasswordEmail("");
                      setForgotPasswordMessage("");
                    }}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    ✕
                  </button>
                </div>

                <p className="text-white/70 text-sm mb-6">
                  Enter your email address and we&apos;ll send you a link to reset your password.
                </p>

                <form onSubmit={handleForgotPassword} className="space-y-5">
                  {forgotPasswordMessage && (
                    <div className={`px-4 py-3 rounded-lg text-sm ${
                      forgotPasswordIsError
                        ? "bg-red-900/50 border border-red-500 text-red-200"
                        : "bg-green-900/50 border border-green-500 text-green-200"
                    }`}>
                      {forgotPasswordMessage.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="forgot-email" className="text-white text-sm font-medium">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="example@example.com"
                        value={forgotPasswordEmail}
                        className="pl-10 h-12 border-0 bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-white/20 rounded-lg"
                        required
                        onChange={(e) => setForgotPasswordEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(false);
                        setForgotPasswordEmail("");
                        setForgotPasswordMessage("");
                        setForgotPasswordIsError(false);
                      }}
                      className="flex-1 h-12 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-all"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={forgotPasswordLoading}
                      className="flex-1 h-12 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold rounded-lg transition-all"
                    >
                      {forgotPasswordLoading ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        "Send Reset Link"
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}

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
            Please sign in using a PC for the best experience. Sorry for the
            inconvenience.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SignInPage;
