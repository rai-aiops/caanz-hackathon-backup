import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Agents Trace Dashboard",
  description: "Local observability dashboard for OpenAI Agents SDK traces.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-density="compact">
      <body>{children}</body>
    </html>
  );
}
