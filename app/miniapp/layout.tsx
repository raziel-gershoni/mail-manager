import Script from "next/script";
import type { ReactNode } from "react";

export const metadata = { title: "Mail Manager — Settings" };

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </>
  );
}
