import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { metadata } from "./metadata";
import { Toaster } from "@/components/ui/toaster";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
import ThemeToggle from "@/components/ThemeToggle";
import AuthButton from "@/components/AuthButton";

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
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <body className="min-h-screen bg-background">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
          <div className="container mx-auto flex items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity">
              AgentData
            </Link>
            <nav className="flex items-center gap-3">
              <Link href="/discover" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Discover
              </Link>
              <div className="h-4 w-px bg-border" />
              <AuthButton />
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
