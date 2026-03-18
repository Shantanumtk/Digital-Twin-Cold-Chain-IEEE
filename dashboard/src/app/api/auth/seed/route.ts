export const dynamic = "force-dynamic";

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
