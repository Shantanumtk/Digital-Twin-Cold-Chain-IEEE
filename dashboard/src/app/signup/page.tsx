"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Snowflake, UserPlus, Eye, EyeOff, AlertCircle, ArrowLeft } from "lucide-react";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to create account"); return; }
      router.push("/login?registered=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center px-4">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: "radial-gradient(circle at 25px 25px, rgba(255,255,255,0.15) 1px, transparent 0)",
          backgroundSize: "50px 50px",
        }} />
      </div>
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-600/30">
            <Snowflake className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Cold Chain Digital Twin</h1>
          <p className="text-blue-300 mt-1 text-sm">Create your account</p>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <a href="/login" className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all">
              <ArrowLeft className="w-5 h-5" />
            </a>
            <h2 className="text-xl font-semibold text-white">Create account</h2>
          </div>
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-1.5">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Choose a username" disabled={loading} autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="you@example.com" disabled={loading} />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pr-11"
                  placeholder="At least 6 characters" disabled={loading} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-1.5">Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Repeat your password" disabled={loading} />
            </div>
            <button type="submit" disabled={loading || !username || !email || !password || !confirmPassword}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25">
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : ( <><UserPlus className="w-4 h-4" /> Create Account</> )}
            </button>
          </form>
          <div className="mt-6 text-center">
            <p className="text-white/40 text-sm">
              Already have an account?{" "}
              <a href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">Sign in</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
