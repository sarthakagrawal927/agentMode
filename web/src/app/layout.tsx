import { Inter } from "next/font/google";
import "./globals.css";
import { metadata } from "./metadata";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export { metadata };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-background">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
