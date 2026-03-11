import type { Metadata } from "next";
import "../globals.css";
import Providers from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "DynaTech Systems - HR Interviewer",
  description: "AI-powered Interview Management System",
  openGraph: {
    title: "DynaTech Systems - HR Interviewer",
    description: "AI-powered Interview Management System",
    siteName: "DynaTech Systems",
    images: [
      {
        url: "/dynatech-logo.png",
        width: 800,
        height: 600,
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/browser-user-icon.ico" />
      </head>
      <body className="font-sans">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
