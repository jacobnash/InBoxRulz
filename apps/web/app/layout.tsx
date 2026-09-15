import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InboxRules",
  description: "Automated inbox hygiene for every connected mailbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
