import { NextRequest, NextResponse } from "next/server";

const MCP_AGENT_URL = process.env.MCP_AGENT_URL || "http://localhost:8001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversation_id, agent } = body;

    const endpoint =
      agent === "simulate"
        ? `${MCP_AGENT_URL}/api/chat/simulate`
        : `${MCP_AGENT_URL}/api/chat/query`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversation_id }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `MCP Agent error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Chat proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to MCP Agent" },
      { status: 500 }
    );
  }
}