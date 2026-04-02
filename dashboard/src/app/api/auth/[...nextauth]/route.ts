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
