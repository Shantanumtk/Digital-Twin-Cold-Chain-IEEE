import { NextRequest, NextResponse } from 'next/server';

const STATE_ENGINE = process.env.STATE_ENGINE_URL || process.env.API_URL || 'http://state-engine.coldchain.svc.cluster.local';

export async function GET(req: NextRequest, { params }: { params: { assetId: string } }) {
  const qs = req.nextUrl.search;
  const url = `${STATE_ENGINE}/assets/${params.assetId}/config${qs}`;
  try {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
    const body = await r.json();
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: 'Upstream error', detail: String(err) }, { status: 502 });
  }
}
