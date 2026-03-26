import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Download, 
  Smartphone, 
  Zap, 
  WifiOff, 
  Bell, 
  Shield,
  CheckCircle2,
  ArrowRight,
  Apple,
  Chrome
} from "lucide-react";
import { Layout } from "@/components/layout/Layout";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Install() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    
    setDeferredPrompt(null);
  };

  const features = [
    {
      icon: Zap,
      title: "Lightning Fast",
      description: "Instant access from your home screen without opening a browser"
    },
    {
      icon: WifiOff,
      title: "Works Offline",
      description: "Access your projects and data even without an internet connection"
    },
    {
      icon: Bell,
      title: "Push Notifications",
      description: "Get real-time alerts for permit updates, deadlines, and inspections"
    },
    {
      icon: Shield,
      title: "Secure & Private",
      description: "Your data is encrypted and stored securely on your device"
    }
  ];

  return (
    <Layout>
      <main className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        <div className="container max-w-4xl py-12 md:py-20">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Smartphone className="h-4 w-4" />
              Mobile App Available
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Install{" "}
              <span className="bg-gradient-to-r from-primary to-sky-400 bg-clip-text text-transparent">
                DesignCheck
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Get the full app experience on your device. Access your permits, projects, 
              and jurisdiction data anytime, anywhere.
            </p>
          </div>

          {/* Install Card */}
          <Card className="mb-12 border-primary/20 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">
                {isInstalled ? "App Installed!" : "Install the App"}
              </CardTitle>
              <CardDescription>
                {isInstalled 
                  ? "You're all set! Open DesignCheck from your home screen."
                  : "Add DesignCheck to your home screen for the best experience"
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {isInstalled ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="p-4 rounded-full bg-green-500/10">
                    <CheckCircle2 className="h-12 w-12 text-green-500" />
                  </div>
                  <p className="text-center text-muted-foreground">
                    DesignCheck is installed and ready to use. Look for it on your home screen!
                  </p>
                  <Button asChild>
                    <a href="/dashboard">
                      Go to Dashboard
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </div>
              ) : isIOS ? (
                <div className="space-y-6 py-4">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                    <Apple className="h-8 w-8 text-foreground" />
                    <div>
                      <h3 className="font-semibold">iOS Installation</h3>
                      <p className="text-sm text-muted-foreground">
                        Follow these steps to install on iPhone/iPad
                      </p>
                    </div>
                  </div>
                  <ol className="space-y-4 pl-6 list-decimal">
                    <li className="text-muted-foreground">
                      <span className="text-foreground font-medium">Tap the Share button</span> at the bottom of Safari
                    </li>
                    <li className="text-muted-foreground">
                      <span className="text-foreground font-medium">Scroll down</span> and tap "Add to Home Screen"
                    </li>
                    <li className="text-muted-foreground">
                      <span className="text-foreground font-medium">Tap "Add"</span> in the top right corner
                    </li>
                  </ol>
                </div>
              ) : deferredPrompt ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <Button size="lg" onClick={handleInstallClick} className="gap-2">
                    <Download className="h-5 w-5" />
                    Install DesignCheck
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Free • No app store required • Instant install
                  </p>
                </div>
              ) : (
                <div className="space-y-6 py-4">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                    <Chrome className="h-8 w-8 text-foreground" />
                    <div>
                      <h3 className="font-semibold">Browser Installation</h3>
                      <p className="text-sm text-muted-foreground">
                        Install from your browser menu
                      </p>
                    </div>
                  </div>
                  <p className="text-muted-foreground">
                    Look for the install icon in your browser's address bar, or open the browser menu 
                    and select "Install app" or "Add to Home Screen".
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border/50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
