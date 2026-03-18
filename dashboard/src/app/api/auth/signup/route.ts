export const dynamic = "force-dynamic";

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
