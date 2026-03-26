import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group [--normal-bg:hsl(var(--background))] [--normal-text:hsl(var(--foreground))] [--normal-border:hsl(var(--border))]"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-xl group-[.toaster]:shadow-2xl group-[.toaster]:border group-[.toaster]:border-white/10 group-[.toaster]:bg-gray-900/90 group-[.toaster]:backdrop-blur-md group-[.toaster]:text-white group-[.toaster]:animate-slide-in-right group-[.toaster]:overflow-hidden",
          description: "group-[.toast]:text-sm group-[.toast]:text-gray-400",
          actionButton: "group-[.toast]:bg-emerald-600 group-[.toast]:text-white group-[.toast]:hover:bg-emerald-500",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-emerald-500 group-[.toaster]:shadow-[0_0_20px_rgba(16,185,129,0.15)]",
          error:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-red-500 group-[.toaster]:shadow-[0_0_20px_rgba(239,68,68,0.15)]",
          info:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-blue-500 group-[.toaster]:shadow-[0_0_20px_rgba(59,130,246,0.15)]",
          warning:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-amber-500 group-[.toaster]:shadow-[0_0_20px_rgba(245,158,11,0.15)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
