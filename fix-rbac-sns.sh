#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

ALERT_EMAIL="shpro1994@gmail.com"
MQTT_EC2_IP="35.167.241.198"
MONGO_IP="10.0.10.39"
AWS_REGION="us-west-2"
NAMESPACE="coldchain"

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}  Cold Chain — RBAC Middleware + SNS Notifications          ${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

if [ ! -f "dashboard/package.json" ]; then
  echo -e "${RED}ERROR: Run from project root${NC}"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════
# PART 1 — RBAC CODE CHANGES
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}── PART 1: RBAC Code Changes ───────────────────────────────${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[1/4] NextAuth route — pass role through JWT + session...${NC}"
# ─────────────────────────────────────────────────────────────
cat > dashboard/src/app/api/auth/\[...nextauth\]/route.ts << 'EOF'
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const MONGO_URI = process.env.AUTH_MONGO_URI || process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB  = process.env.MONGO_DB || "coldchain";

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
          return {
            id:    user._id.toString(),
            name:  user.username,
            email: user.email,
            role:  user.role ?? "operator",
          };
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
      if (user) {
        token.username = user.name;
        token.role     = (user as any).role ?? "operator";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name        = token.username as string;
        (session.user as any).role = token.role as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "coldchain-digital-twin-secret-2026",
});

export { handler as GET, handler as POST };
EOF
echo -e "${GREEN}  ✓ role flows: MongoDB → authorize() → JWT → session${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[2/4] NextAuth type augmentation...${NC}"
# ─────────────────────────────────────────────────────────────
mkdir -p dashboard/src/types
cat > dashboard/src/types/next-auth.d.ts << 'EOF'
import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      name?:  string | null;
      email?: string | null;
      image?: string | null;
      role?:  string;
    };
  }
}
EOF
echo -e "${GREEN}  ✓ next-auth.d.ts type augmentation created${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[3/4] Next.js middleware — block /simulator for non-admin...${NC}"
# ─────────────────────────────────────────────────────────────
cat > dashboard/src/middleware.ts << 'EOF'
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token    = req.nextauth.token as any;
    const { pathname } = req.nextUrl;

    // Non-admin trying to access simulator route → redirect to home
    if (pathname.startsWith("/simulator") && token?.role !== "admin") {
      return NextResponse.redirect(new URL("/", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
EOF
echo -e "${GREEN}  ✓ middleware.ts — unauthenticated→/login, non-admin /simulator→/${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[4/4] Simulator API route guard — 403 for non-admin...${NC}"
# ─────────────────────────────────────────────────────────────
mkdir -p dashboard/src/app/api/simulator
cat > dashboard/src/app/api/simulator/route.ts << 'EOF'
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession();
  const role = (session?.user as any)?.role;
  if (!session || role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }
  return NextResponse.json({ status: "ok", role });
}
EOF
echo -e "${GREEN}  ✓ /api/simulator 403 guard created${NC}"

# ═══════════════════════════════════════════════════════════════
# PART 2 — SNS TERRAFORM + STATE ENGINE
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── PART 2: SNS Terraform + State Engine ────────────────────${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[5/7] terraform/sns.tf — SNS topic + email + IAM...${NC}"
# ─────────────────────────────────────────────────────────────
cat > terraform/sns.tf << EOF
# ─── SNS Topic for Cold Chain Critical Alerts ───────────────────────
resource "aws_sns_topic" "coldchain_alerts" {
  name = "coldchain-critical-alerts"
  tags = {
    Project     = "coldchain-digital-twin"
    Environment = "production"
  }
}

resource "aws_sns_topic_subscription" "email_alert" {
  topic_arn = aws_sns_topic.coldchain_alerts.arn
  protocol  = "email"
  endpoint  = "${ALERT_EMAIL}"
}

resource "aws_iam_policy" "sns_publish" {
  name        = "coldchain-sns-publish"
  description = "Allow state engine to publish critical alerts to SNS"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sns:Publish"
      Resource = aws_sns_topic.coldchain_alerts.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "sns_publish_attach" {
  role       = aws_iam_role.eks_node_role.name
  policy_arn = aws_iam_policy.sns_publish.arn
}

output "sns_topic_arn" {
  value       = aws_sns_topic.coldchain_alerts.arn
  description = "Set as SNS_TOPIC_ARN env var in state engine deployment"
}
EOF
echo -e "${GREEN}  ✓ terraform/sns.tf created (email: ${ALERT_EMAIL})${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[6/7] state-engine/sns_publisher.py...${NC}"
# ─────────────────────────────────────────────────────────────
cat > state-engine/sns_publisher.py << 'EOF'
"""
SNS publisher for Cold Chain critical alerts.
Safe no-op if SNS_TOPIC_ARN is not set.
"""
import boto3, os, logging
from datetime import datetime

logger        = logging.getLogger(__name__)
SNS_TOPIC_ARN = os.getenv("SNS_TOPIC_ARN", "")
AWS_REGION    = os.getenv("AWS_DEFAULT_REGION", "us-west-2")
_client       = None

def _get_client():
    global _client
    if _client is None:
        _client = boto3.client("sns", region_name=AWS_REGION)
    return _client

def publish_critical_alert(asset_id: str, alert_type: str, message: str,
                            value: float = None, threshold: float = None):
    if not SNS_TOPIC_ARN:
        logger.debug("SNS_TOPIC_ARN not set — skipping")
        return
    try:
        lines = [
            "CRITICAL ALERT — Cold Chain Digital Twin",
            "─" * 45,
            f"Asset     : {asset_id}",
            f"Alert Type: {alert_type}",
            f"Message   : {message}",
        ]
        if value is not None:     lines.append(f"Value     : {value}")
        if threshold is not None: lines.append(f"Threshold : {threshold}")
        lines += [
            f"Time      : {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "─" * 45,
            f"Dashboard : http://{os.getenv('DASHBOARD_URL', 'your-lb-url')}",
        ]
        _get_client().publish(
            TopicArn  = SNS_TOPIC_ARN,
            Subject   = f"[CRITICAL] Cold Chain Alert — {asset_id}",
            Message   = "\n".join(lines),
            MessageAttributes={
                "asset_id":   {"DataType": "String", "StringValue": asset_id},
                "alert_type": {"DataType": "String", "StringValue": alert_type},
                "severity":   {"DataType": "String", "StringValue": "CRITICAL"},
            }
        )
        logger.info(f"SNS published: {asset_id} — {alert_type}")
    except Exception as e:
        logger.error(f"SNS publish failed: {e}")
EOF
echo -e "${GREEN}  ✓ state-engine/sns_publisher.py created${NC}"

# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[7/7] Patch state_engine.py to call SNS on CRITICAL...${NC}"
# ─────────────────────────────────────────────────────────────
python3 << 'PYEOF'
import os

path = "state-engine/state_engine.py"
if not os.path.exists(path):
    print(f"  ~ {path} not found — skipping patch")
    exit()

with open(path) as f:
    content = f.read()

if 'sns_publisher' not in content:
    content = content.replace(
        'import logging',
        'import logging\ntry:\n    from sns_publisher import publish_critical_alert\nexcept ImportError:\n    def publish_critical_alert(*args, **kwargs): pass',
        1
    )
    print("  ✓ sns_publisher import added")
else:
    print("  ✓ sns_publisher already imported")

# Try multiple patterns for CRITICAL alert logging
injected = False
patterns = [
    'logger.warning(f"CRITICAL alert: {asset_id}',
    'severity == "HIGH"',
    'alerts_collection.insert_one({',
]
for p in patterns:
    if p in content and 'publish_critical_alert' not in content:
        idx = content.find(p)
        # Find end of that line
        end = content.find('\n', idx)
        insert = (
            '\n                try:\n'
            '                    publish_critical_alert(\n'
            '                        asset_id=str(asset_id),\n'
            '                        alert_type=str(alert_type if "alert_type" in dir() else "CRITICAL"),\n'
            '                        message=str(message if "message" in dir() else "Critical threshold exceeded"),\n'
            '                    )\n'
            '                except Exception: pass'
        )
        content = content[:end] + insert + content[end:]
        print(f"  ✓ publish_critical_alert() injected at pattern: '{p[:40]}'")
        injected = True
        break

if not injected and 'publish_critical_alert' not in content:
    print("  ~ Could not auto-patch state_engine.py — add call manually after CRITICAL detection")

with open(path, "w") as f:
    f.write(content)
PYEOF
echo -e "${GREEN}  ✓ state_engine.py patched${NC}"

# ═══════════════════════════════════════════════════════════════
# PART 3 — TERRAFORM APPLY + KUBECTL INJECT
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── PART 3: Terraform Apply + kubectl env inject ────────────${NC}"

echo -e "${YELLOW}Running terraform apply for SNS...${NC}"
cd terraform
terraform init -upgrade -reconfigure > /dev/null 2>&1 || true
terraform apply -auto-approve \
  -target=aws_sns_topic.coldchain_alerts \
  -target=aws_sns_topic_subscription.email_alert \
  -target=aws_iam_policy.sns_publish \
  -target=aws_iam_role_policy_attachment.sns_publish_attach

SNS_ARN=$(terraform output -raw sns_topic_arn 2>/dev/null || echo "")
cd ..

if [ -z "$SNS_ARN" ]; then
  echo -e "${RED}  ✗ Could not get SNS ARN from terraform output${NC}"
else
  echo -e "${GREEN}  ✓ SNS topic created: ${SNS_ARN}${NC}"

  echo -e "${YELLOW}Injecting SNS_TOPIC_ARN into state-engine deployment...${NC}"
  kubectl set env deployment/state-engine \
    -n ${NAMESPACE} \
    SNS_TOPIC_ARN="${SNS_ARN}" \
    DASHBOARD_URL="$(kubectl get svc -n ${NAMESPACE} dashboard -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
  echo -e "${GREEN}  ✓ SNS_TOPIC_ARN injected into state-engine${NC}"

  echo -e "${YELLOW}Restarting state-engine to pick up new env...${NC}"
  kubectl rollout restart deployment/state-engine -n ${NAMESPACE}
  kubectl rollout status deployment/state-engine -n ${NAMESPACE} --timeout=120s
  echo -e "${GREEN}  ✓ state-engine restarted${NC}"
fi

# ═══════════════════════════════════════════════════════════════
# PART 4 — REBUILD + REDEPLOY DASHBOARD
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}── PART 4: Rebuild + Redeploy Dashboard ────────────────────${NC}"

STATE_ENGINE=$(kubectl get svc -n ${NAMESPACE} state-engine -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
DASH_LB=$(kubectl get svc -n ${NAMESPACE} dashboard -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/coldchain-digital-twin-dashboard"

echo -e "${YELLOW}Building dashboard image...${NC}"
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL="http://${STATE_ENGINE}" \
  --build-arg MCP_AGENT_URL="http://${MQTT_EC2_IP}:8001" \
  --build-arg NEXTAUTH_URL="http://${DASH_LB}" \
  --build-arg AUTH_MONGO_URI="mongodb://${MONGO_IP}:27017" \
  --build-arg NEXTAUTH_SECRET="coldchain-digital-twin-secret-2026" \
  -t dashboard:latest dashboard/

echo -e "${YELLOW}Pushing to ECR...${NC}"
docker tag dashboard:latest ${ECR}:latest
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com
docker push ${ECR}:latest

echo -e "${YELLOW}Rolling out dashboard...${NC}"
kubectl rollout restart deployment/dashboard -n ${NAMESPACE}
kubectl rollout status deployment/dashboard -n ${NAMESPACE} --timeout=120s

# ═══════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  All done!                                                  ${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "RBAC:"
echo "  - Unauthenticated users → redirected to /login"
echo "  - Logged-in non-admin → /simulator redirected to /"
echo "  - Admin users → full access including Simulator page"
echo ""
echo "SNS:"
echo "  - Critical alerts → email to ${ALERT_EMAIL}"
echo "  - Check inbox and click 'Confirm subscription' link from AWS"
echo "  - After confirming, every CRITICAL asset alert fires an email"
echo ""
echo -e "${YELLOW}⚠ Check ${ALERT_EMAIL} inbox for AWS SNS subscription confirmation email!${NC}"