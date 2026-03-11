"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Lock, Eye, EyeOff, User } from "lucide-react";

function SignUpPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm_password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (formData.password !== formData.confirm_password) {
      setError("Passwords do not match");

      return;
    }

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters");

      return;
    }

    setIsLoading(true);

    try {
      const result = await signup({
        email: formData.email,
        password: formData.password,
        first_name: formData.first_name,
        last_name: formData.last_name,
      });

      if (result.success) {
        router.push("/dashboard");
      } else {
        setError(result.message || "Signup failed");
      }
    } catch (err) {
      setError("An error occurred during signup");
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="flex items-center justify-center min-h-screen w-full bg-gray-100 absolute top-0 left-0 z-50 py-8">
      {/* Desktop View */}
      <div className="hidden md:flex flex-col items-center justify-center z-10" style={{width: "100%"}}>
        {/* Black Card Container */}
        <div className="bg-black rounded-2xl shadow-2xl p-12 w-full max-w-md">
          {/* Header with Logo and Microsoft Badge */}
          <div className="w-full mb-8 text-center">
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
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-white mb-2">Create account</h1>
              <p className="text-white text-sm">Start your AI interview journey</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name" className="text-white text-sm font-medium">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="first_name"
                      name="first_name"
                      type="text"
                      placeholder="John"
                      value={formData.first_name}
                      className="pl-10 h-11 border-0 bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-white/20 rounded-lg"
                      required
                      onChange={handleChange}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="last_name" className="text-white text-sm font-medium">Last Name</Label>
                  <Input
                    id="last_name"
                    name="last_name"
                    type="text"
                    placeholder="Doe"
                    value={formData.last_name}
                    className="h-11 border-gray-200 focus:border-indigo-500 focus:ring-indigo-500"
                    required
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-white text-sm font-medium">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    className="pl-10 h-11 border-gray-200 focus:border-indigo-500 focus:ring-indigo-500"
                    required
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-white text-sm font-medium">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={formData.password}
                    className="pl-10 pr-10 h-11 border-0 bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-white/20 rounded-lg"
                    required
                    onChange={handleChange}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm_password" className="text-white text-sm font-medium">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    id="confirm_password"
                    name="confirm_password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={formData.confirm_password}
                    className="pl-10 h-11 border-gray-200 focus:border-indigo-500 focus:ring-indigo-500"
                    required
                    onChange={handleChange}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] mt-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-white text-sm">
                Already have an account?{" "}
                <Link href="/sign-in" className="text-[#5865f2] hover:text-[#4752c4] font-semibold transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-white/60">
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

export default SignUpPage;
