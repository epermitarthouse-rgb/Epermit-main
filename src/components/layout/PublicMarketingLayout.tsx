import { ReactNode } from "react";
import { PublicMarketingHeader } from "./PublicMarketingHeader";
import { Footer } from "./Footer";

interface PublicMarketingLayoutProps {
  children: ReactNode;
}

export function PublicMarketingLayout({ children }: PublicMarketingLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicMarketingHeader />
      <main className="flex-1 overflow-x-hidden min-w-0">{children}</main>
      <Footer />
    </div>
  );
}
