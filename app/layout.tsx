import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'AutoEgoLab v3 — Factory Video → Robot Training Data',
  description:
    '7 AI agents process egocentric factory video into structured VLA datasets for robot learning. Zero annotation, 5 minutes.',
  keywords: ['robotics', 'VLA', 'egocentric video', 'AI pipeline', 'robot learning', 'dataset generation'],
  openGraph: {
    title: 'AutoEgoLab v3',
    description: 'Autonomous factory video to robot training data pipeline.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-[#0f0f13] text-white antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}

