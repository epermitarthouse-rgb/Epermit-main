import { useTheme } from "@/hooks/useTheme";
import type { ComponentProps } from "react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-xl group-[.toaster]:border group-[.toaster]:border-border/80 group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:shadow-lg group-[.toaster]:backdrop-blur-md group-[.toaster]:animate-slide-in-right group-[.toaster]:overflow-hidden dark:group-[.toaster]:border-border/60 dark:group-[.toaster]:bg-card dark:group-[.toaster]:shadow-elegant",
          description: "group-[.toast]:text-sm group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:hover:bg-primary/90",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-success group-[.toaster]:shadow-[0_0_24px_hsl(var(--success)/0.12)]",
          error:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-destructive group-[.toaster]:shadow-[0_0_24px_hsl(var(--destructive)/0.12)]",
          info:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-primary group-[.toaster]:shadow-[0_0_24px_hsl(var(--primary)/0.12)]",
          warning:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-warning group-[.toaster]:shadow-[0_0_24px_hsl(var(--warning)/0.12)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
