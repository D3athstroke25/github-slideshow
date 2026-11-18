import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import { site } from "@/config/site";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CartBar } from "@/components/CartBar";
import { PlaceholderBanner } from "@/components/PlaceholderBanner";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${site.domain}`),
  title: { default: site.title, template: `%s | ${site.name}` },
  description:
    "100% halal Indo-Chinese Hakka and North Indian food on York Blvd, Hamilton. Order direct for pickup or delivery — better prices than the apps.",
};

export const viewport: Viewport = {
  themeColor: "#9e1b1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-3 focus:text-white"
        >
          Skip to content
        </a>
        <CartProvider>
          <PlaceholderBanner />
          <Header />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
          <CartBar />
        </CartProvider>
      </body>
    </html>
  );
}
