"use client"

import type React from "react"

import { useState, useRef } from "react"
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from "framer-motion"

interface LocationMapProps {
  location?: string
  coordinates?: string
  className?: string
}

export function LocationMap({
  location = "East Coast Coverage",
  coordinates = "200+ Jurisdictions",
  className,
}: LocationMapProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  const rotateX = useTransform(mouseY, [-50, 50], [8, -8])
  const rotateY = useTransform(mouseX, [-50, 50], [-8, 8])

  const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 })
  const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 })

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    mouseX.set(e.clientX - centerX)
    mouseY.set(e.clientY - centerY)
  }

  const handleMouseLeave = () => {
    mouseX.set(0)
    mouseY.set(0)
    setIsHovered(false)
  }

  const handleClick = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div
      ref={containerRef}
      className={`relative cursor-pointer select-none ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <motion.div
        className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden border border-border bg-card shadow-xl"
        style={{
          rotateX: isHovered ? springRotateX : 0,
          rotateY: isHovered ? springRotateY : 0,
          transformPerspective: 1000,
        }}
        animate={{
          scale: isExpanded ? 1.02 : 1,
        }}
        transition={{ duration: 0.3 }}
      >
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />

        {/* Map visualization */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 p-6"
            >
              {/* Grid lines for map effect */}
              <svg className="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 100 100">
                {/* Main roads */}
                <line x1="0" y1="35" x2="100" y2="35" className="stroke-foreground" strokeWidth="0.5" />
                <line x1="0" y1="65" x2="100" y2="65" className="stroke-foreground" strokeWidth="0.5" />
                <line x1="30" y1="0" x2="30" y2="100" className="stroke-foreground" strokeWidth="0.5" />
                <line x1="70" y1="0" x2="70" y2="100" className="stroke-foreground" strokeWidth="0.5" />

                {/* Secondary streets */}
                {[20, 50, 80].map((y, i) => (
                  <line key={`h-${i}`} x1="0" y1={y} x2="100" y2={y} className="stroke-muted-foreground/30" strokeWidth="0.3" />
                ))}
                {[15, 45, 55, 85].map((x, i) => (
                  <line key={`v-${i}`} x1={x} y1="0" x2={x} y2="100" className="stroke-muted-foreground/30" strokeWidth="0.3" />
                ))}
              </svg>

              {/* Location markers */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2 }}
                className="absolute top-[20%] left-[60%] w-3 h-3 rounded-full bg-primary shadow-lg"
              />
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3 }}
                className="absolute top-[35%] left-[70%] w-2 h-2 rounded-full bg-primary/70"
              />
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.4 }}
                className="absolute top-[50%] left-[65%] w-4 h-4 rounded-full bg-primary shadow-lg"
              >
                <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
              </motion.div>
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute top-[65%] left-[55%] w-2.5 h-2.5 rounded-full bg-primary/80"
              />
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.6 }}
                className="absolute top-[75%] left-[45%] w-2 h-2 rounded-full bg-primary/60"
              />

              {/* Center marker with pulse */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3, type: "spring" }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              >
                <div className="relative">
                  <motion.div
                    className="absolute inset-0 rounded-full bg-primary/20"
                    animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <div className="w-4 h-4 rounded-full bg-primary border-2 border-background shadow-lg" />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Grid pattern - only show when collapsed */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: isExpanded ? 0 : 0.1 }}>
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" className="stroke-foreground" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Content */}
        <div className="absolute inset-0 p-6 flex flex-col justify-between">
          {/* Top section */}
          <div className="flex items-start justify-between">
            <motion.div
              className="w-12 h-12 rounded-2xl bg-primary/10 backdrop-blur-sm flex items-center justify-center border border-primary/20"
              animate={{ rotate: isHovered ? 10 : 0 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              {/* Map Icon SVG */}
              <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </motion.div>

            {/* Status indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 backdrop-blur-sm border border-primary/20">
              <motion.div
                className="w-2 h-2 rounded-full bg-primary"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <span className="text-xs font-medium text-primary">Live</span>
            </div>
          </div>

          {/* Bottom section */}
          <div className="space-y-2">
            <motion.h3
              className="text-xl font-semibold text-foreground"
              animate={{ y: isHovered ? -2 : 0 }}
            >
              {location}
            </motion.h3>

            <AnimatePresence>
              {isExpanded && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-sm text-muted-foreground"
                >
                  {coordinates}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Animated underline */}
            <motion.div
              className="h-0.5 bg-gradient-to-r from-primary to-primary/50 rounded-full"
              initial={{ width: "30%" }}
              animate={{ width: isHovered ? "100%" : "30%" }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </motion.div>

      {/* Click hint */}
      <motion.p
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-muted-foreground"
        animate={{ opacity: isHovered ? 1 : 0 }}
      >
        Click to expand
      </motion.p>
    </div>
  )
}