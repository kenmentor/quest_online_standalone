import { NextResponse } from 'next/server';

const STEFIE_API_URL = process.env.NEXT_PUBLIC_STEFIE_API_URL || 'http://localhost:8080';

export async function GET() {
  try {
    const res = await fetch(`${STEFIE_API_URL}/api/languages`, { next: { revalidate: 30 } });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch {
    return NextResponse.json([], {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
