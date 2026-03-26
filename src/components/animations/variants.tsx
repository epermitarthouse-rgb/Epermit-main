import { motion, HTMLMotionProps, Variants } from "framer-motion";
import { ReactNode } from "react";

// Fade in animation variants
export const fadeIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" }
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
  },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" }
  },
};

export const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -40 },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
  },
};

export const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
  },
};

// Scale animations
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { 
    opacity: 1, 
    scale: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
  },
};

export const scaleOnHover: Variants = {
  initial: { scale: 1 },
  hover: { scale: 1.02, transition: { duration: 0.2 } },
  tap: { scale: 0.98 },
};

// Stagger container
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

export const staggerContainerFast: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

// Stagger item
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
  },
};

// Card hover effects
export const cardHover: Variants = {
  initial: { y: 0, boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)" },
  hover: { 
    y: -8, 
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
    transition: { duration: 0.3, ease: "easeOut" }
  },
};

// Button animations
export const buttonHover: Variants = {
  initial: { scale: 1 },
  hover: { scale: 1.05, transition: { duration: 0.2 } },
  tap: { scale: 0.95 },
};

// Page transition
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
  },
  exit: { 
    opacity: 0, 
    y: -20,
    transition: { duration: 0.3 }
  },
};

// Slide animations for modals/panels
export const slideInRight: Variants = {
  hidden: { x: "100%", opacity: 0 },
  visible: { 
    x: 0, 
    opacity: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
  },
  exit: { 
    x: "100%", 
    opacity: 0,
    transition: { duration: 0.3 }
  },
};

export const slideInLeft: Variants = {
  hidden: { x: "-100%", opacity: 0 },
  visible: { 
    x: 0, 
    opacity: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
  },
  exit: { 
    x: "-100%", 
    opacity: 0,
    transition: { duration: 0.3 }
  },
};

export const slideInUp: Variants = {
  hidden: { y: "100%", opacity: 0 },
  visible: { 
    y: 0, 
    opacity: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
  },
  exit: { 
    y: "100%", 
    opacity: 0,
    transition: { duration: 0.3 }
  },
};

// Number counter animation hook helper
export const counterVariants: Variants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: { 
    opacity: 1, 
    scale: 1,
    transition: { 
      type: "spring",
      stiffness: 100,
      damping: 10 
    }
  },
};

// Reusable motion components
interface MotionDivProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
}

export const FadeIn = ({ children, ...props }: MotionDivProps) => (
  <motion.div
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: "-100px" }}
    variants={fadeIn}
    {...props}
  >
    {children}
  </motion.div>
);

export const FadeInUp = ({ children, ...props }: MotionDivProps) => (
  <motion.div
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: "-100px" }}
    variants={fadeInUp}
    {...props}
  >
    {children}
  </motion.div>
);

export const StaggerContainer = ({ children, ...props }: MotionDivProps) => (
  <motion.div
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: "-100px" }}
    variants={staggerContainer}
    {...props}
  >
    {children}
  </motion.div>
);

export const StaggerItem = ({ children, ...props }: MotionDivProps) => (
  <motion.div variants={staggerItem} {...props}>
    {children}
  </motion.div>
);

export const HoverCard = ({ children, ...props }: MotionDivProps) => (
  <motion.div
    initial="initial"
    whileHover="hover"
    whileTap="tap"
    variants={cardHover}
    {...props}
  >
    {children}
  </motion.div>
);

export const ScaleOnHover = ({ children, ...props }: MotionDivProps) => (
  <motion.div
    initial="initial"
    whileHover="hover"
    whileTap="tap"
    variants={scaleOnHover}
    {...props}
  >
    {children}
  </motion.div>
);

// Page wrapper with transition
export const PageTransition = ({ children, ...props }: MotionDivProps) => (
  <motion.div
    initial="initial"
    animate="animate"
    exit="exit"
    variants={pageTransition}
    {...props}
  >
    {children}
  </motion.div>
);
