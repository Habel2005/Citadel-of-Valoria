import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Citadel of Valoria — Procedural 3D Voxel Fortress',
  description:
    'Interactive 3D procedural voxel island citadel rendered in Three.js with dynamic time-of-day lighting, reflective ocean, and curated camera flights.',
  openGraph: {
    title: 'Citadel of Valoria — Procedural 3D Voxel Fortress',
    description:
      'Interactive 3D procedural voxel island citadel rendered in Three.js with dynamic time-of-day lighting, reflective ocean, and curated camera flights.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Citadel of Valoria — Procedural 3D Voxel Fortress',
    description:
      'Interactive 3D procedural voxel island citadel rendered in Three.js with dynamic time-of-day lighting, reflective ocean, and curated camera flights.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark">
      <body
        suppressHydrationWarning
        className="overflow-hidden bg-[#0c101a] text-slate-100 antialiased selection:bg-amber-400/30 selection:text-amber-100"
      >
        {children}
      </body>
    </html>
  );
}
