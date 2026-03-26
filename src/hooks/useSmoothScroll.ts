import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export function useSmoothScroll() {
  const navigate = useNavigate();
  const location = useLocation();

  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, []);

  const scrollToSectionOrNavigate = useCallback((sectionId: string, fallbackPath?: string) => {
    // If we're on the homepage, scroll directly
    if (location.pathname === "/") {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        return;
      }
    }
    
    // Otherwise navigate to homepage with hash
    if (fallbackPath) {
      navigate(fallbackPath);
    } else {
      navigate(`/#${sectionId}`);
      // After navigation, scroll to section
      setTimeout(() => {
        const element = document.getElementById(sectionId);
        if (element) {
          element.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 100);
    }
  }, [location.pathname, navigate]);

  return { scrollToSection, scrollToSectionOrNavigate };
}
