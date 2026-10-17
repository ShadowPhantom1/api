import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Anvex — API aggregation, without the glue code", template: "%s · Anvex" },
  description:
    "Anvex discovers real APIs, stores their configuration in Postgres and exposes them through tested REST and OpenAI-compatible gateways.",
  applicationName: "Anvex",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
