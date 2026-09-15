import type { Metadata } from "next";
import "./globals.css";
import { AuthBar } from "@/components/AuthBar";

export const metadata: Metadata = {
  title: "InboxRules",
  description: "Automated inbox hygiene for every connected mailbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
