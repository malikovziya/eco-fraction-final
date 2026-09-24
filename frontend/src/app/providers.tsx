"use client";

import { DemoPanel } from "@/components/DemoPanel";
import { Nav } from "@/components/Nav";
import { Toasts } from "@/components/Toasts";
import { AuthProvider } from "@/lib/auth";
import { LiveProvider } from "@/lib/live";
import { PrefsProvider, usePrefs } from "@/lib/prefs";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrefsProvider>
      <AuthProvider>
        <LiveProvider>
          <Nav />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
          <Footer />
          <Toasts />
          <DemoPanel />
        </LiveProvider>
      </AuthProvider>
    </PrefsProvider>
  );
}

function Footer() {
  const { t } = usePrefs();
  return <footer className="border-t border-line/60 py-6 text-center text-xs text-faint">{t("footer.note")}</footer>;
}
