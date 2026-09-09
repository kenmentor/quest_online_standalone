import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_URL =
  process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || '';

function livekitUrl(): string {
  return LIVEKIT_URL;
}

export async function POST(request: NextRequest) {
  try {
    const { identity, room, name } = await request.json();

    if (!identity || !room) {
      return NextResponse.json(
        { error: 'Missing required fields: identity, room' },
        { status: 400 }
      );
    }

    const token = await mintToken(identity, room, name || identity);

    return NextResponse.json({
      participantToken: token,
      livekitUrl: livekitUrl(),
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Token generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}

async function mintToken(identity: string, room: string, name?: string): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: name || identity,
  });

  at.addGrant({
    roomJoin: true,
    room: room,
    canPublish: true,
    canSubscribe: true,
  });

  return await at.toJwt();
}

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get('room');
  const identity = request.nextUrl.searchParams.get('identity');
  const name = request.nextUrl.searchParams.get('name') || undefined;

  if (!identity || !room) {
    return NextResponse.json({ error: 'Missing room or identity' }, { status: 400 });
  }

  try {
    const participantToken = await mintToken(identity, room, name);
    return NextResponse.json(
      { participantToken, livekitUrl: livekitUrl() },
      { headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  } catch (error) {
    console.error('Token generation error:', error);
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}