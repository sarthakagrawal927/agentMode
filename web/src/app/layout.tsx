import { Inter } from "next/font/google";
import "./globals.css";
import { metadata } from "./metadata";
import { Toaster } from "@/components/ui/toaster";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
import ThemeToggle from "@/components/ThemeToggle";

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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <header className="border-b bg-background">
          <div className="container mx-auto flex items-center justify-between p-4">
            <Link href="/" className="text-xl font-semibold hover:opacity-80">
              AgentData
            </Link>
            <nav className="flex items-center gap-4">
              <Link href="/discover" className="text-sm px-3 py-1 rounded border hover:bg-accent">
                Discover
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        {children}
        <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
