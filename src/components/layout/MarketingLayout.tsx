import { ReactNode } from "react";
import { MarketingHeader } from "./MarketingHeader";
import { Footer } from "./Footer";

interface MarketingLayoutProps {
  children: ReactNode;
}

export function MarketingLayout({ children }: MarketingLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <MarketingHeader />
      <main className="flex-1 overflow-x-hidden min-w-0">{children}</main>
      <Footer />
    </div>
  );
}
