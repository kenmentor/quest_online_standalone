import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'http://localhost:7880';
const STEFIE_API_URL = process.env.NEXT_PUBLIC_STEFIE_API_URL || 'https://3c6a-105-116-13-159.ngrok-free.app';

export async function GET(request: NextRequest) {
  const prefix = request.nextUrl.searchParams.get('prefix') || '';

  // Fetch available room codes from the server
  let roomNames: string[] = [];
  try {
    const res = await fetch(`${STEFIE_API_URL}/api/languages`, { next: { revalidate: 30 } });
    if (res.ok) {
      const langs = await res.json();
      roomNames = langs.map((l: { code: string }) => l.code);
    }
  } catch {}

  // Fallback if server unreachable
  if (roomNames.length === 0) {
    roomNames = ['german-room', 'french-room', 'spanish-room', 'italian-room'];
  }

  // Apply room prefix
  if (prefix) {
    roomNames = roomNames.map(r => `${r}-${prefix}`);
  }

  const counts: Record<string, number> = {};

  try {
    const client = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    for (const roomName of roomNames) {
      try {
        const participants = await client.listParticipants(roomName);
        counts[roomName] = participants.length;
      } catch {
        counts[roomName] = 0;
      }
    }
  } catch (error) {
    console.error('Failed to get room counts:', error);
    for (const roomName of roomNames) {
      counts[roomName] = 0;
    }
  }

  return NextResponse.json({ counts }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
