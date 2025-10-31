'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme" className="w-9 h-9">
        <Sun className="hidden dark:block" />
        <Moon className="block dark:hidden" />
      </Button>
    );
  }

  const isDark = (theme === 'dark') || (theme === 'system' && resolvedTheme === 'dark');

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className="w-9 h-9"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}


