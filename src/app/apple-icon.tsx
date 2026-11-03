// Home-screen icon for phones (owners approve from there), rendered from the same mark as icon.svg.
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F6B55' }}>
        <svg width="132" height="132" viewBox="12 10 40 44">
          <path d="M22 13h20a7 7 0 0 1 7 7v15a7 7 0 0 1-7 7H31l-9 8v-8a7 7 0 0 1-7-7V20a7 7 0 0 1 7-7z" fill="#F4F5F2" />
          <path d="M24.5 28.5l5.5 5.5 10.5-11" fill="none" stroke="#0F6B55" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
