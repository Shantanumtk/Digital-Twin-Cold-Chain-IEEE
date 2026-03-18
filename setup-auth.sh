#!/bin/bash
# =============================================================================
# Cold Chain Digital Twin — Authentication Setup Script (macOS + Linux)
# =============================================================================
# Run from the project root:
#   bash setup-auth.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[AUTH] $1${NC}"; }
log_done()  { echo -e "${GREEN}[AUTH] ✓ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}[AUTH] → $1${NC}"; }

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Cold Chain Digital Twin — Auth Setup                ║${NC}"
echo -e "${GREEN}║   Login + Signup + NextAuth.js + MongoDB              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

if [ ! -d "dashboard/src" ]; then
  echo "Error: Run this script from the project root (where dashboard/ exists)"
  exit 1
fi

cd dashboard

# =============================================================================
# Step 1: Update package.json with new dependencies
# =============================================================================
log_info "Adding auth dependencies to package.json..."

python3 << 'PKGJSON'
import json

with open("package.json") as f:
    pkg = json.load(f)

deps = pkg.setdefault("dependencies", {})
dev_deps = pkg.setdefault("devDependencies", {})

deps["next-auth"] = "4.24.11"
deps["bcryptjs"] = "2.4.3"
deps["mongodb"] = "6.12.0"
dev_deps["@types/bcryptjs"] = "2.4.6"

with open("package.json", "w") as f:
    json.dump(pkg, f, indent=2)
    f.write("\n")

print("  ✓ package.json updated with next-auth, bcryptjs, mongodb")
PKGJSON

log_done "Dependencies added to package.json"

# =============================================================================
# Step 2: NextAuth API route
# =============================================================================
log_info "Creating NextAuth API route..."
mkdir -p 'src/app/api/auth/[...nextauth]'

cat > 'src/app/api/auth/[...nextauth]/route.ts' << 'EOF'
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const MONGO_URI = process.env.AUTH_MONGO_URI || process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "coldchain";

async function getDb() {
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  return { client, db: client.db(MONGO_DB) };
}

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        let client;
        try {
          const conn = await getDb();
          client = conn.client;
          const user = await conn.db.collection("users").findOne({
            $or: [{ username: credentials.username }, { email: credentials.username }],
          });
          if (!user) return null;
          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) return null;
          await conn.db.collection("users").updateOne(
            { _id: user._id },
            { $set: { lastLogin: new Date() } }
          );
          return { id: user._id.toString(), name: user.username, email: user.email };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        } finally {
          if (client) await client.close();
        }
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.username = user.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.name = token.username as string;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "coldchain-digital-twin-secret-2026",
});

export { handler as GET, handler as POST };
EOF
log_done "NextAuth API route created"

# =============================================================================
# Step 3: Signup API route
# =============================================================================
log_info "Creating Signup API route..."
mkdir -p src/app/api/auth/signup

cat > src/app/api/auth/signup/route.ts << 'EOF'
import { NextRequest, NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const MONGO_URI = process.env.AUTH_MONGO_URI || process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "coldchain";

export async function POST(request: NextRequest) {
  let client;
  try {
    const { username, email, password } = await request.json();
    if (!username || !email || !password)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    if (username.length < 3)
      return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    if (password.length < 6)
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });

    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const users = client.db(MONGO_DB).collection("users");

    const existing = await users.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      const field = existing.username === username ? "Username" : "Email";
      return NextResponse.json({ error: `${field} already exists` }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await users.insertOne({
      username, email, password: hashedPassword,
      role: "operator", createdAt: new Date(), lastLogin: null,
    });
    return NextResponse.json({ message: "Account created successfully" }, { status: 201 });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  } finally {
    if (client) await client.close();
  }
}
EOF
log_done "Signup API route created"

# =============================================================================
# Step 4: Seed API route
# =============================================================================
log_info "Creating Seed API route..."
mkdir -p src/app/api/auth/seed

cat > src/app/api/auth/seed/route.ts << 'EOF'
import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const MONGO_URI = process.env.AUTH_MONGO_URI || process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "coldchain";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "coldchain2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@coldchain.local";

export async function GET() {
  let client;
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const users = client.db(MONGO_DB).collection("users");
    await users.createIndex({ username: 1 }, { unique: true });
    await users.createIndex({ email: 1 }, { unique: true });

    const adminExists = await users.findOne({ username: ADMIN_USER });
    if (adminExists)
      return NextResponse.json({ message: "Admin already exists", seeded: false });

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await users.insertOne({
      username: ADMIN_USER, email: ADMIN_EMAIL, password: hashedPassword,
      role: "admin", createdAt: new Date(), lastLogin: null,
    });
    return NextResponse.json({ message: "Admin user created", seeded: true });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: "Failed to seed admin user" }, { status: 500 });
  } finally {
    if (client) await client.close();
  }
}
EOF
log_done "Seed API route created"

# =============================================================================
# Step 5: Login page
# =============================================================================
log_info "Creating Login page..."
mkdir -p src/app/login

cat > src/app/login/page.tsx << 'EOF'
"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Snowflake, LogIn, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");

  useEffect(() => {
    fetch("/api/auth/seed").then(() => setSeeding(false)).catch(() => setSeeding(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn("credentials", { username, password, redirect: false });
      if (result?.error) {
        setError("Invalid username or password");
      } else {
        router.push("/");
        router.refresh();
      }
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
          <p className="text-blue-300 mt-1 text-sm">Real-time Monitoring Dashboard</p>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6">Sign in to your account</h2>
          {registered && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2 text-green-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Account created successfully. Please sign in.
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-1.5">Username or Email</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Enter your username" disabled={loading || seeding} autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pr-11"
                  placeholder="Enter your password" disabled={loading || seeding} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading || seeding || !username || !password}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25">
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : ( <><LogIn className="w-4 h-4" /> Sign In</> )}
            </button>
          </form>
          <div className="mt-6 text-center">
            <p className="text-white/40 text-sm">
              Don&apos;t have an account?{" "}
              <a href="/signup" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">Create account</a>
            </p>
          </div>
        </div>
        <p className="text-center text-white/20 text-xs mt-6">Default: admin / coldchain2026</p>
      </div>
    </div>
  );
}
EOF
log_done "Login page created"

# =============================================================================
# Step 6: Signup page
# =============================================================================
log_info "Creating Signup page..."
mkdir -p src/app/signup

cat > src/app/signup/page.tsx << 'EOF'
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
EOF
log_done "Signup page created"

# =============================================================================
# Step 7: SessionProvider
# =============================================================================
log_info "Creating SessionProvider component..."

cat > src/components/SessionProvider.tsx << 'EOF'
"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
EOF
log_done "SessionProvider created"

# =============================================================================
# Step 8: Middleware
# =============================================================================
log_info "Creating auth middleware..."

cat > src/middleware.ts << 'EOF'
import { withAuth } from "next-auth/middleware";

export default withAuth({ pages: { signIn: "/login" } });

export const config = {
  matcher: ["/((?!login|signup|api/auth|_next|favicon.ico|public).*)"],
};
EOF
log_done "Middleware created"

# =============================================================================
# Step 9: Patch existing files using Python (cross-platform)
# =============================================================================
log_info "Patching existing files..."

python3 << 'PYEOF'
import os

# --- Patch layout.tsx ---
f = "src/app/layout.tsx"
content = open(f).read()
if "SessionProvider" not in content:
    content = content.replace(
        "import './globals.css';",
        "import './globals.css';\nimport SessionProvider from '@/components/SessionProvider';"
    )
    content = content.replace(
        "<body className={inter.className}>{children}</body>",
        "<body className={inter.className}><SessionProvider>{children}</SessionProvider></body>"
    )
    open(f, "w").write(content)
    print("  ✓ layout.tsx patched")
else:
    print("  → layout.tsx already patched")

# --- Patch Header.tsx ---
f = "src/components/Header.tsx"
content = open(f).read()
if "signOut" not in content:
    content = content.replace(
        "import { useState } from 'react';",
        "import { useState } from 'react';\nimport { signOut } from 'next-auth/react';"
    )
    content = content.replace(
        "Gamepad2 } from 'lucide-react';",
        "Gamepad2, LogOut } from 'lucide-react';"
    )
    old = """<div className="hidden sm:flex items-center gap-2 text-sm text-gray-500">
              <RefreshCw className="w-4 h-4" />
              {lastUpdated ? <span>{format(lastUpdated, 'HH:mm:ss')}</span> : <span>Loading...</span>}
            </div>"""
    new = """<div className="hidden sm:flex items-center gap-2 text-sm text-gray-500">
              <RefreshCw className="w-4 h-4" />
              {lastUpdated ? <span>{format(lastUpdated, 'HH:mm:ss')}</span> : <span>Loading...</span>}
            </div>

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>"""
    content = content.replace(old, new)
    open(f, "w").write(content)
    print("  ✓ Header.tsx patched")
else:
    print("  → Header.tsx already patched")

# --- Patch next.config.js ---
f = "next.config.js"
content = open(f).read()
if "NEXTAUTH_SECRET" not in content:
    content = content.replace(
        "MCP_AGENT_URL: process.env.MCP_AGENT_URL || 'http://localhost:8001',",
        "MCP_AGENT_URL: process.env.MCP_AGENT_URL || 'http://localhost:8001',\n    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'coldchain-digital-twin-secret-2026',\n    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',\n    AUTH_MONGO_URI: process.env.AUTH_MONGO_URI || 'mongodb://localhost:27017',"
    )
    open(f, "w").write(content)
    print("  ✓ next.config.js patched")
else:
    print("  → next.config.js already patched")

# --- Patch Dockerfile ---
f = "Dockerfile"
content = open(f).read()
if "AUTH_MONGO_URI" not in content:
    content = content.replace(
        "ARG MCP_AGENT_URL=http://localhost:8001",
        "ARG MCP_AGENT_URL=http://localhost:8001\nARG AUTH_MONGO_URI=mongodb://localhost:27017\nARG NEXTAUTH_SECRET=coldchain-digital-twin-secret-2026"
    )
    content = content.replace(
        "ENV MCP_AGENT_URL=$MCP_AGENT_URL",
        "ENV MCP_AGENT_URL=$MCP_AGENT_URL\nENV AUTH_MONGO_URI=$AUTH_MONGO_URI\nENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET"
    )
    open(f, "w").write(content)
    print("  ✓ Dockerfile patched")
else:
    print("  → Dockerfile already patched")

# --- Patch K8s dashboard deployment ---
os.chdir("..")
f = "k8s/dashboard/dashboard-deployment.yaml"
content = open(f).read()
if "AUTH_MONGO_URI" not in content:
    content = content.replace(
        "          readinessProbe:",
        "          env:\n            - name: AUTH_MONGO_URI\n              value: \"mongodb://MONGODB_PRIVATE_IP:27017\"\n            - name: NEXTAUTH_SECRET\n              value: \"coldchain-digital-twin-secret-2026\"\n            - name: NEXTAUTH_URL\n              value: \"http://localhost:3000\"\n          readinessProbe:"
    )
    open(f, "w").write(content)
    print("  ✓ K8s dashboard deployment patched")
else:
    print("  → K8s dashboard deployment already patched")

# --- Patch deploy-script.sh ---
f = "scripts/deploy-script.sh"
content = open(f).read()
if "AUTH_MONGO_URI" not in content:
    content = content.replace(
        '--build-arg MCP_AGENT_URL="http://${MQTT_BROKER_PRIVATE_IP}:8001"',
        '--build-arg MCP_AGENT_URL="http://${MQTT_BROKER_PRIVATE_IP}:8001" \\\n    --build-arg AUTH_MONGO_URI="mongodb://${MONGODB_PRIVATE_IP}:27017" \\\n    --build-arg NEXTAUTH_SECRET="coldchain-digital-twin-secret-2026"'
    )
    content = content.replace(
        '  log_info "Waiting for dashboard pods..."',
        '  # Set auth env vars\n  kubectl set env deployment/dashboard -n "$NAMESPACE" \\\n    AUTH_MONGO_URI="mongodb://${MONGODB_PRIVATE_IP}:27017" \\\n    NEXTAUTH_SECRET="coldchain-digital-twin-secret-2026"\n\n  log_info "Waiting for dashboard pods..."'
    )
    open(f, "w").write(content)
    print("  ✓ deploy-script.sh patched")
else:
    print("  → deploy-script.sh already patched")

print("\nAll patches applied!")
PYEOF

log_done "All existing files patched"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Auth Setup Complete!                                ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} NextAuth.js configured (JWT + MongoDB)"
echo -e "  ${GREEN}✓${NC} Login page at /login"
echo -e "  ${GREEN}✓${NC} Signup page at /signup"
echo -e "  ${GREEN}✓${NC} Admin seed at /api/auth/seed"
echo -e "  ${GREEN}✓${NC} Middleware protecting all routes"
echo -e "  ${GREEN}✓${NC} Logout button in Header"
echo -e "  ${GREEN}✓${NC} Dockerfile updated"
echo -e "  ${GREEN}✓${NC} K8s deployment updated"
echo -e "  ${GREEN}✓${NC} Deploy script updated"
echo ""
echo -e "  ${YELLOW}Default credentials: admin / coldchain2026${NC}"
echo ""
echo -e "  ${BLUE}To deploy:${NC}"
echo -e "    bash scripts/deploy-script.sh --anthropic-key YOUR_KEY"
echo ""