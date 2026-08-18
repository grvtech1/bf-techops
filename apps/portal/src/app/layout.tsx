import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Merchant Platform Operations",
  description: "Merchant billing and delivery operations"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

