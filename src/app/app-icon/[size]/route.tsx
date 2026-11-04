// The installed app's icons, drawn from the same mark as icon.svg. "maskable" leaves the safe zone
// Android crops to (the mark sits in the middle 60%).
import { ImageResponse } from 'next/og';

const SIZES: Record<string, { px: number; mark: number }> = {
  '192': { px: 192, mark: 140 },
  '512': { px: 512, mark: 376 },
  maskable: { px: 512, mark: 300 },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await params).size];
  if (!spec) return new Response('Not found', { status: 404 });
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#B04A22' }}>
        <svg width={spec.mark} height={spec.mark} viewBox="12 10 40 44">
          <path d="M22 13h20a7 7 0 0 1 7 7v15a7 7 0 0 1-7 7H31l-9 8v-8a7 7 0 0 1-7-7V20a7 7 0 0 1 7-7z" fill="#FFFDFA" />
          <path d="M24.5 28.5l5.5 5.5 10.5-11" fill="none" stroke="#B04A22" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { width: spec.px, height: spec.px, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
