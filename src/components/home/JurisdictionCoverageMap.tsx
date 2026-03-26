import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { MapPin, Building2, Clock, DollarSign, X, ChevronRight, ExternalLink, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface JurisdictionInfo {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  base_permit_fee: number | null;
  plan_review_sla_days: number | null;
  is_high_volume: boolean | null;
  website_url: string | null;
}

interface StateData {
  code: string;
  name: string;
  count: number;
  jurisdictions: JurisdictionInfo[];
  avgFee: number | null;
  avgProcessingDays: number | null;
}

// US State SVG paths - properly scaled for 959x593 viewBox
const US_STATES: Record<string, { path: string; name: string }> = {
  AL: { path: "M628.5,397.9l-1.9,23.3l-1.3,11.5l-0.9,9.2l5.1,3.2l2.1,4.9l0.3,2l6.7-1l25.7-2.8l9.4-0.8l-0.4-4.5l1.9-10.5l3.5-12.9l3.3-9.4l2.5-10.9l-1.7-8l-33.7,3.1l-9.9,0.9l-3.6,0.3l-0.5,0.6z", name: "Alabama" },
  AZ: { path: "M213.9,392.5l-1.2,1.9l0.3,1.2l-6.1,36.5l-7.5,43.9l14.3,2.5l25.5,4.1l18,2.6l18.1,2.3l13.9,1.6l3.5-23.3l0.9-31.4l0.2-18.9l-19.9-2.8l-20-13.6l-4-5.2l-3.4,0.1l-7.3,2.9l-3.5,0.1l-6.5-1.6l-2.8,0.5l-1.9,3.7l-4.3,2.9l-2.3-0.9l-1.8-3.9z", name: "Arizona" },
  AR: { path: "M564.3,361.1l-7.7,0.6l-42.3,2.1l-10.5,0.3l0.4,5.7l0,28.3l-0.5,12l2.9,5.7l4.2-1.1l2.9,0.8l1.5,6.1l38.5-1.9l18.8-1.2l4.5-0.5l0.7-3.4l-2.4-3.7l1.5-4.7l-0.3-3.3l3.3-5.1l1.9-2.7l-2.3-3.4l2-7.3l2.5-4.9l-0.6-4.5l-5.2-2.9l0.6-5.2l-8.7,0.5z", name: "Arkansas" },
  CA: { path: "M136.9,287.1l-2.1,8.8l-1.9,10.5l2.9,5.9l-0.6,3.5l-4.1-0.3l-3.9,3.9l-1.2,5.9l3.6,6.1l3.9,5.9l4.3,5.9l0.2,4.5l-1.9,1l-1.8,4.1l2.4,3.9l0.4,3.7l6.5,8.9l3.6,6.2l3.3,5.9l-0.2,7.1l-0.6,4.1l2.2,3.9l2.7,2.9l0.2,3.5l-3.9,4.9l-1,3.5l1.2,3.5l-6.7,0.7l-5.5-0.1l-1.2,0.3l3.9,6.6l3.4,6.9l2.3,4.7l4.7,5.9l3.4,3.3l0.8,5.9l2.5,6.6l3.9,5.3l0.8,3.4l-0.8,5.8l-0.6,5.9l2.4,4.9l0.3,1.9l25.4,4.4l38.9,6.5l27.7,4.1l-14.3-97.5l-8.2-57.9l-28.3,7.9l-23.3,5.1l-29.3-49.2z", name: "California" },
  CO: { path: "M379.2,276.5l-2.6,48.7l-0.7,14.4l-1,17.7l22.1,1.1l45.4,1.5l38,0.2l22.7-0.4l-2-52.2l-0.8-15.7l-1.6-15.6l-47.6,1.1l-40.1-0.3z", name: "Colorado" },
  CT: { path: "M852.1,185.2l-3.9-15.2l-1.2,0.2l-22.7,5.1l1.1,5.5l1.9,10.3l-0.9,4.9l5.1-0.4l17.8-5.1z", name: "Connecticut" },
  DE: { path: "M817.2,238.3l0.4-3l1.9-1.8l1.9-3.5l-1.2-3.1l-1.5-4.1l-2.4-0.5l-1.1,0.5l-5.6,1.5l1.2,5.2l2.3,10.3l3.3,15z", name: "Delaware" },
  FL: { path: "M703.6,453.7l2.7-5.9l3.9-5.8l3.5-3.3l3.9-1.7l1.1-2.7l-4.7-1.1l-3.5,0.7l1.1-3.5l0.2-4.3l1.1-5.7l3.7-6.3l3.3-4.1l1.8-3.9l0.4-6.5l-3.3-6.3l-4.1-3.9l-1.5-3.9l-2.1-8.3l-2.7-4.9l-2.9-2.1l-3.1,0.6l-1.1,2.3l1.8,3.3l0.4,5.7l-2,2.3l-2.9,0.2l-4.1-0.6l-1.4,4.1l-6.5,2.3l-5.5,0.4l-3.9,2.9l-5.7,0.4l-3.1-1.4l-3.3,3.1l-4.3,0.2l-1.1-1.8l-4.3-0.2l-3.7,1.4l-1.6,4.3l-6.9,0.8l-1.1-0.8l-7.9,0.9l-10.1,0.2l-13.7,1.5l-0.5,3.9l4.5,3l3.9,5.6l6.9,5.9l2.9,3.2l0.3,5.5l4.5,0.4l6.3,4.3l10.9,3l5.1,3.1l5.2-1l2.3,2.7l4.7,0.2l5.4,4.1l3.1,4.1l3.1,3l4.5,0.4l4.9,4.3l0.6,2.4l1.9,2.1l-0.4,3.3l1.4,1.5l2.7-5.3l1.6-4.3l-0.4-4l1.7-0.3l1.4,2.6l2.9-3.6l0.2-4.3l1.6-2.9l-2.7-3.6l-4.5-2.6l1-1.6z", name: "Florida" },
  GA: { path: "M695.3,372.5l-4.3,1.7l-10.9,1.7l-26.1,3.1l-6.4,0.5l1.2,11.6l1.5,14.9l1.3,17.7l2.6,22.9l1.9,7.5l2.9,8.7l4.3,5.3l2.1,4l-0.3,4.9l2.5,5.8l4.1,2.5l1.9-1.1l3.9-5.2l4-2.9l3.9,1.5l3.9,3.9l5.2-0.5l1.9-4.7l5-1.2l4.1-0.5l4.4-2.6l1.8-7.6l3.9-6.7l1.3-3.5l3.7-2.5l0.4-4l-1.9-6l-2.3-2.3l0.2-3l1.3-7.3l-1.5-5l2.9-10.9l0.2-6.2l-0.9-5.3l-3.9-6.9l-0.3-3.5l-10.7,1.2z", name: "Georgia" },
  ID: { path: "M229.2,191.8l-5.1,21.2l-4.9,18.9l1.5,3.7l-0.5,3.1l3.3,4.3l0.2,2.1l-2.9,3.3l-0.8,2.7l0.6,2.4l2.4,2l0.2,0.4l-0.8,7.2l3.5,2.4l1.4,3.5l-1.2,2.9l1.8,3.7l-0.2,2.9l2.5,1l1.9-2.5l4.5-0.8l2.3-2.5l0.8-0.2l0.7,0.8l0.8,10l1.6,0.2l2.1-2.1l5.9,1.2l4.5-4.7l0.2-5.9l4.3-4.1l30.9,5.9l-9.2-52.7l-5.7-33.5l-22.5,4.4l-24.1,3.7z", name: "Idaho" },
  IL: { path: "M594.2,221.5l-1.2,2.9l-1.5,4.1l0.3,6.9l4.4,6.5l0.2,4.1l-1.7,4.1l-0.4,6.4l2.1,5.5l5.5,5.3l4.1,2.9l0.4,24.4l-1,15.9l-0.8,5.9l-2.9,4.5l-2.7,2.9l-0.3,4.3l3.1,6.8l6.7,5.5l5.7,2l0.6,3.7l-3.3,3.5l-0.8,2.4l0.4,3.1l-8.4,0.5l-27.3,1.7l-11.9,0.3l-1-2.8l-0.9-6.1l-4.7-4.9l-0.6-4.8l2.9-2.7l0.6-3.8l-1.2-1.6l-2.6-6.1l-0.4-6.5l1.5-6.4l-0.8-3.1l-3.1-4.3l0.2-3.8l0.2-5.1l2.3-2.3l2-2.9l-2.5-4.5l-4.1-2.3l-0.4-2.7l-2.3-6.6l0.6-5l2.9-5.9l0.6-5.7l-0.6-3.5l-3.5-5.3l-0.8-5.5l1.6-5.7l3.7-3.3l0.2-5.7l-1.4-1.8l0.4-2.6l22.7,2.1l17.2,0.6z", name: "Illinois" },
  IN: { path: "M604.7,230.5l1.2-2.9l17.4,1.1l13.5-0.8l1.6,1.4l0.2,2.7l2.5,3.2l-1.5,5.7l-2.3,2.1l-0.9,3.3l0.5,2.9l3.3,6.1l-0.2,7.7l2.9,9.9l0.4,4.5l0.5,3.9l-0.8,5.5l2.5,6.9l0.2,5.9l-2.5,2.5l0.4,2.9l1.3,0.8l0.6,4.5l-25.2,2.9l-14.8,1.4l-0.4-3.3l-6.1-5.5l-3.3-6.6l0.2-4.1l2.9-3.1l2.7-4.3l0.8-5.7l1.2-16.3l-0.3-22.9l-4.3-3.3l-5.3-5.1l-2.1-5.5l0.4-6.6z", name: "Indiana" },
  IA: { path: "M550.5,213.3l0.8,3.1l3.7,3.5l0.6,3.9l-2.3,5.7l-0.4,4.3l-3.5,5.9l-4.5,4.1l-0.8,2.1l0.4,2.3l2.9,2.3l0.8,3.3l-0.4,3.5l-1.4,1.6l-2,0.2l-2.5,3.3l0.2,1.8l-0.2,0.4l-54.9,1.8l-11.3-0.3l0.6-4.3l-1.5-3.9l-3.3-2.7l-0.6-3.1l-2-5l1.2-5.3l1.8-4.7l-1.4-2.9l-3.5-2l0.6-5.3l1.6-5.5l-1.8-2.3l-0.8-4.7l3.3-5.5l1.4-7.5l-1.2-3.1l-2.5-2.5l0.4-1.8l46.5,0.8l29.1-0.6l1.4,2.5l3.5,3.3l4.5,1z", name: "Iowa" },
  KS: { path: "M500.5,305.5l-1.2,26.5l-0.5,20.7l-53.5-0.4l-46.5-2.3l-25.6-1.9l1.8-55.5l27.7,1l56,1.6l41.7,0.2z", name: "Kansas" },
  KY: { path: "M680.6,311.4l-3.3,3.5l-6.5,6.9l-3.4,6.3l-0.8,4.1l-5.3-0.3l-8.3,3.7l-5.5,2.1l-4.5,4.5l-8.9,4.5l-4.9,4.3l-6.1,0.6l-8.1,0.5l-30.1,2.3l-22.2,0.9l-7.9,0.5l-6.1,7l3.1,1.6l2.9,0.4l2,2.4l-3.2,3.9l0.6,1.4l3.1,1.4l2.4-1.8l4.5,0.6l5.3-4.1l3.3,0.4l2.5,2.1l4.5-3.3l5.7,0.4l3.7,2.3l3.9-2.9l4.5,1.2l0.2,2.5l4.3-1.6l1.9-3.3l5.1,0.4l1.4-1.6l-1-3.5l4.1-4.3l5.5,3.3l3.9-0.8l5.4,0.4l3.1-2.7l2.4,0.6l3.9-3.5l3.7,0.4l1.8-4.5l5.1,0.6l4.5-2.7l3.5,0.4l3.3-4.3l2.7-3.7l4.5,0.6l3.7,3.3l9.1-5.1l4.5-7.5l5.5-5.7l2.7-3.5l-0.6-3.5l-5.9-4.1z", name: "Kentucky" },
  LA: { path: "M563.7,453.5l-1.3-5.8l-2.9-0.8l-4.2,1.1l-2.5-5.3l0.4-11.9l0-27.7l-37.7,1.9l0.5,3.5l-1.5,5.4l3.7,5.1l2,8.5l-0.2,5l2.1,3.5l-0.2,9.8l-1.7,2.3l0.6,2.9l-4.7,5.5l-4.3,0.8l1.2,4.1l-1.2,3.9l3.6,3.2l-0.6,1.3l-4.3-0.5l-2.8,2.5l-2.3-0.4l-2.9-2.9l-6.9,4.3l2.3,3.7l0.2,4.3l4.3,2.3l0.6,3l-1.9,4.7l0.2,3.5l1.8,1.5l10.3,1.6l10.7-0.3l5.5-1.4l1-2.6l6.6-0.4l8.1,3.1l2.7-0.8l2.9,2.7l0.4,4.1l2.8-0.2l0.3-2.7l1.6-2.6l-0.4-3.6l-2.4-1l1.2-1.8l4.3,0.6l2.2,1.2l0.3,4.2l3.6,1.2l2.3-3.2l0.4,2.7l4,1.1l1.8-1.7l-1.2-1.9l0.4-3.4l-4.5-0.8l0.6-1.7l2.9-1.4l0.1-3.9l2.8-5l-4.3,0.5l-3.3-3.3l4.7-2.3l0.5-4.5l1.5-1.9l-0.9-2.2l2.9-2l4.7,2z", name: "Louisiana" },
  ME: { path: "M897.5,98.7l1.5-1.4l1.7,2.5l2.1,4.5l1.5,0.8l1.3-0.4l2-5.5l-1.7-4.5l-0.2-1.7l1.1-0.6l0.6,0.6l1.9,2.3l0.2,2.1l1,1.4l-1.2,5.3l-2.9,4.7l-2.7,1.4l-3.5,4.3l-4.9,4.1l-0.8,2.1l1.9,2.9l-1.8,1.5l-0.8,5.5l-1,0.6l-1.6-1.9l-2.3,3.5l-1.8-0.8l-0.4-2.7l1.6-1.4l0.3-3.5l-3.5-1.7l-0.3-1.5l-3.5-13.7l3.9-11.9l2.1-1.4l2.9,3.3l3.3-0.2l0.3,2l0.8,0.8l2.5-1.9l0.6,2.3l-1.6,2.9l0.3,2z", name: "Maine" },
  MD: { path: "M818.6,255.1l-7.3-24.3l-3.5-0.4l-5.5,1.2l-5.3,0.2l-1.9-5.7l-22.1,4.9l-20.2,3.7l-2.5,7.3l0.4,2.1l3.5,1.2l2.5,0.2l1.4-2.1l1.6,1.4l0.4,3.5l7.8,0.4l3.1-4.1l1.2-1.2l1.9,1.8l4.3-0.6l2.1-2.9l3.1-2.5l1.4,0.4l2.1,3.5l6.3,1.4l5.7,4.1l5.1-0.2l5.9,3.3l5-0.6l-0.5-5.1l2.1-0.8l2.1,5.1l1.1,4.1l1.5,5.1l0.4,0.2l1.1-3.7l-0.8-4.4l-2.8-6.6l-0.5-2.7l1.1-2.5z", name: "Maryland" },
  MA: { path: "M891.3,167l0.3-1.8l-1.9-4.5l3.7-1l1.5,3.1l2.9,0.6l-0.1,1.7l-5.1,2.3zM873.5,156l-3.4,0.2l-0.9-1.5l-2.9,1.5l-0.3,1.9l3.9,1.4l4.9-0.8l0.9-1.5zM855.7,157.4l0.6,2.9l2.3,0.1l2.6-2.3l0.6-1.9l-2.8-0.4l-2.5,0.4z", name: "Massachusetts" },
  MI: { path: "M553.7,115.1l7.3,0.4l3.3-2.9l2.3-2.3l5.1-1.4l3.3-4.3l8.5,4.9l2.7,2.5l6.9,1.4l1.2,1.6l-0.9,4.5l0.6,2.1l-0.6,3.1l3.5,5.1l6.1,1.4l0.8,0.2l4.1-2.5l1.4-5.9l1.8-2.7l-1.4-5.7l1.6-1l4.5,2.1l1.8,3.5l0.6,5.3l-1.9,4.5l-0.3,4.1l0.4,2.9l3.3,1l2.7,0.4l4.5-1.8l4.5,0.4l1.9-1.4l4.5-6.7l3.3-2.3l0.2-3.1l-0.2-6.5l-1.6-1.6l-3.1-0.4l-0.8-4.9l-3.7-3.5l-1.9-2.9l0.8-1.2l2.9,0.6l2.7,2.3l3.3,2.9l2.3,0.6l2.9-0.6l1.6,0.4l-0.8,2.1l2.3,2.3l0.8,3.9l-0.8,1.2l0.4,2.7l3.9-0.6l1.8-0.8l2.1-3.9l0.4-2.9l-0.4-2.5l-3.1-2.1l-1.2-1.2l0.6-2.3l-3.3-3.7l0.8-1.2l-0.4-1.9l-2.9-1.8l-0.2-5.6l3.3-0.8l3.6-0.4l3.5,1.7l4.1,5.9l4.1,3.9l0.4,1.8l3.7,1l0.2,2.7l-1.7,2.5l-0.2,2.3l0.8,1.5l-3.7,3.7l-0.5,3.3l0.6,3.1l-0.6,2.3l-3.1,4.3l0,1.4l-2.4,2.1l0.3,1.6l-5.4,3.7l-1.1,5.3l0.4,2.9l-1.4,3.1l-1.2,2.5l0.4,2.5l-3.1,5.3l-1.6,5.5l1.2,3.5l-0.8,4.3l-0.6,2.7l-1.9,3.3l-1.3,5.7l-2.1,4.7l0.4,1.8l-2.2,1.6l-2,3.5l-17.2-1.1l-1.1-2.7l-0.6-5.1l-2.1-4.9l-23.3,4.6l-4.1,0.4l-7-12.2l-7.2-14.1l-5.7-15.3z", name: "Michigan" },
  MN: { path: "M473.9,95.5l0.2,5.5l2.7,5.5l5,4.3l0.4,9l0.4,4.1l1.8,1.7l0.6,3.7l-2.7,6l-1.9,3.9l-0.2,6.8l-0.6,3.3l2.3,3.3l4.9,1.7l5.2,2.8l1.3,4.2l-0.2,5.3l0,6.8l-0.6,5.3l62.2-0.4l0.8-21.5l-2.3-1.4l-1.6-3.9l-1.6-7.1l-1.2-6.1l-3.7-3.9l-1-7.3l0.3-4.9l-1.5-3.7l-0.1-3.8l6.3,0.2l0.3-9.9l-2.9-0.1l-0.6-5.6l-5.5,0.2l-0.2-3.7l-1.2-2.8l-4.9-3.3l-4.6-1.8l-2.9-3.3l-3.9,0l-0.6,2.5l-3.3,0.6l-1.2,1.4l-1.8,2.9l-2.1,0.8l-2.3-1.8l-4.3-0.2l-1.2-1.8l-1.8-0.2l-2.8,2.5l-2.5,0.4l-0.4,4.9l-3.3,3.3l-3.3,0.5l-2.5-2.1z", name: "Minnesota" },
  MS: { path: "M588.9,420.3l-1.5-6.1l-3-0.8l-4.1,1.1l-2.5-5.3l0.4-11.9l0-28.5l-0.3-4.3l-38.8,1.9l-18.8,1.2l-0.7,3.9l3.3,4.3l-0.2,3.9l1.5,3.7l1.2,0.2l0.4,2.9l-3.1,0.8l-0.2,2.7l-4.5,1.6l-0.4,5.9l-0.8,2.7l1.5,4.5l3.3,3.9l-0.2,8.5l-0.6,7.5l1.8,5.3l-1.6,3.5l0.6,2.5l-1,5.5l-0.6,5.9l-1.8,2.9l1,2.5l-1.2,2.1l2.3,4.5l-0.4,1.2l37-2.3l9.3-0.6l-0.6-4.9l2.3-4.3l5.8-6.5l4.8-2.2l-0.6-7.2z", name: "Mississippi" },
  MO: { path: "M583.9,275.9l-8.1,0.5l-30.1,1l-22.2,0l0,2.1l-22.7-0.2l0.7,5.7l1.5,4.5l4.5,4.4l3.3,2.7l0.4,4.4l-2.9,2.3l-0.6,2.5l2.5,4.6l4.1,3.9l7,7.8l0.9,1.4l-0.4,20.6l-0.7,17.5l5.1,0.1l42.3-2.1l7.7-0.6l8.7-0.5l-0.6,5l5.1,2.9l0.6,4.5l-2.4,4.8l-2.1,7.7l2.5,3.5l-1.5,4.5l2.3,3.7l-0.7,3.3l4.3-0.3l0.9-6.3l2.9-5.1l4-2.1l2.5-4.5l-0.4-5.5l-3.7-4.3l-3.6-4.7l-0.4-3.3l3.5-6.1l0.3-5l-5.9-4.3l-5.7-4.7l-3.1-6.6l0.2-4.1l2.9-3.1l2.7-4.1l0.8-6.5l1-15.5l-0.4-24.4l-4.1-2.9z", name: "Missouri" },
  MT: { path: "M316.2,99.3l-1.4,20.3l-1.1,20.1l1,10.1l2.8,5.5l-0.1,3.2l2.9,6.5l-0.3,4.5l1.6,4.2l3.8,1.5l4.9,5.9l-33.9-1.9l-35.9-3.3l-27.9-3.3l-6.9-1l5.1-21.2l24.1-3.7l22.5-4.4l-7.9-43.8l69.5,8.2z", name: "Montana" },
  NE: { path: "M467.5,221.9l-3.1,4.3l0.6,3.3l-1.5,6.4l0.4,6.3l2.7,6.3l-0.2,3.5l-2.2,2.4l-0.2,5.3l22.6,0.2l22.2,0l30.1-1l8.1-0.5l-5.5-5.1l-2.2-5.5l0.2-6.6l1.7-4.3l-0.2-4.1l-4.3-6.7l-0.2-6.5l1.6-4.3l-46.3-0.8l-24,0.4z", name: "Nebraska" },
  NV: { path: "M175.9,298.5l21.2,3.3l21.1,2.9l-9.9,62.3l-4.6,26.5l-10.9-15l-13.9-9.5l-2.7-3.7l1.6-3.5l0.3-7.4l-3.7-5.8l-5.1-2.1l-2.5-2.7l-0.4-4.4l-5.3-6.3l-2.2-5.7l2.5-8.9l-2-4.4l2.4-10.5l0.3-5.9z", name: "Nevada" },
  NH: { path: "M873.7,120.1l0.4-2.1l3.5-1l0.6-2.5l-1.2-4.5l1.4-4.1l-1.6-4.9l0.4-3.9l-0.2-2.3l-2-4.9l-1.2-8.1l-2.6,0.1l-1.8,2.7l-1.2,1.7l0.4,4.9l-2.3,1.4l-0.4,3.9l-1.2,1l-1,10.1l1.6,2.1l0.2,2.3l-1.6,2.9l0.4,3.1l-0.4,5.5l0.3,6l0.3,1.6l4.5-0.8l4.7-7.1z", name: "New Hampshire" },
  NJ: { path: "M832.5,207.8l-2.1,2.3l-2.1,1.8l-0.2,3.3l1.6,2.7l4.1-0.4l1.2,4.5l0.8,1.6l-0.8,6.1l1.2,2.9l2.5,0.2l2.5,3.5l2-0.6l2.3-4.7l-0.2-3.3l-1.2-3.3l-0.3-4.5l-2.7-3.1l-2.9-4.9l0.4-3.5l2.3-1.4l0.4-5.4l-2.7-2l-3.8,2.3l-1.1,4.1z", name: "New Jersey" },
  NM: { path: "M299.5,414.3l7.5,0.8l22.5,2l19.6,1.5l2.3-24.7l4-51.6l1.9-25.9l-25-2.2l-50.9-5.8l-5.1,39.9l-2.9,22.5l-3.1,23.5l14.6,2l14.5,1.6z", name: "New Mexico" },
  NY: { path: "M822.9,177.9l-1.6-1.2l-3.9,2.1l-3.5,2.7l-2.5,0.4l-1.9-1.2l-2.7-0.2l-3.7,2.7l-3.3,0.2l-3.9-2.3l-8.6,0.1l-6.2,0.2l-25.6,5.5l-23.7,4.3l4.6,17.5l1.3,2.4l42.6-9.2l23.1-5l1.2,4.6l-2.9,2.5l-4.3,2.5l-3.1,2.9l-1.6,3.5l0.2,2.7l-3.3,3.3l-4.3,5.7l-3.1,5.7l-0.4,3.7l1.8,5.1l3.8-4.3l3.5-5.1l3.7-1.8l6.4-1.6l4.8-2.3l6.9-4.9l3.4-3.5l4.2-5.9l3.5-5.9l2.1-5.2l-0.6-7.3l-4.1-6.1z", name: "New York" },
  NC: { path: "M822.5,337.3l-2.6-5.7l-4.7-0.4l-1.2-4.9l-2.7,0.4l-4.7,3.9l-4.5,0.8l-3.5-0.2l-1.6,3.5l-6.7,3.9l-3.8,0.4l-1.6,1.6l-0.4,2.7l-4.7,0.2l-2.8,3l-2.9,4.9l-5.3,4.1l-0.8,2l1.2,2.3l-1.6,3.9l-4.7,0.6l-3.5,2.3l-1.6,2.5l-3.3-0.4l-4.3,4.1l-4.3,3.5l-2.4,3.9l-0.4,2.3l-7.9,0.1l-29.5,3.6l-26.9,2.1l-5.1,0.8l-4.5-1.6l-9.7,0.9l10.9,9.2l6.1,4l3.3,4.1l4.2,0.3l16.7-1.9l12.1-1.4l31.7-5.5l32.1-6.9l12.1-3l6.5-2.3l3.8-3.8l6.4-2.2l3.5-2.8l1.9-3.7l4.9-2.3l0.6-3.8l1.1-1.4l-1.7-4.6l3.9-2.8l1.8-1.7l1.5-5.9l4.7-2z", name: "North Carolina" },
  ND: { path: "M473.9,95.5l-2.5-6.3l-4.1-4.9l-1.6-8.4l-4-2l-1.9-4.1l-57-1.2l-31.9-1.9l1.9,14.7l1.2,12.1l1.4,20.3l1.1,20.1l1,10.1l38.5,0.4l37.7-0.6l21.2-1.4l-0.6-5.3l2.4-3.3l0.6-3.3l0.2-6.8l1.9-3.9l2.7-6l-0.6-3.7l-1.8-1.7l-0.4-4.1l-0.4-9l-5-4.3z", name: "North Dakota" },
  OH: { path: "M701.7,232.7l-3.5,3.5l-3.7,4.1l-4.9,2.9l0.4,2.9l-5.5,3.7l-4.3,2.9l-0.2,10l-2.3,3.9l2.3,5.5l-0.6,5.5l2.3,4.7l5.5,4.9l-0.6,5.5l-2,3l-0.5,2.7l2.3,3.5l-0.2,1.6l4.2-3.7l6.5-7.1l3.3-3.5l5.7,4.1l0.6,3.5l-2.7,3.3l-5.5,5.9l-4.3,7.3l-9.1,5.1l-4.1-3.7l-4.3-0.6l-2.7,3.9l-3.3,4.3l-3.5-0.4l-4.5,2.7l-5.1-0.6l-1.6,4.1l-3.9-0.4l-3.7,3.5l-2.4-0.6l-3.1,2.7l-5.5-0.2l-4.1,0.6l-5.7-3.5l-4.1,4.1l-0.6-4.5l-1.2-0.6l0.4-2.9l2.5-2.5l-0.2-5.9l-2.5-6.9l0.8-5.5l-0.5-3.9l-0.4-4.5l-2.9-9.9l0.2-7.7l-3.3-6.1l-0.5-2.9l0.9-3.3l2.3-2.1l1.5-5.7l-2.5-3.2l-0.2-2.7l-1.6-1.4l7.1-2.9l22.1-4.5l17.7-2.9l20.7-3.3z", name: "Ohio" },
  OK: { path: "M500.5,351.4l-0.3-18.7l-0.3-1l-53.1-0.4l-46.5-2.3l-0.7,10.4l8.9,0.4l0.8,38.3l1.2,5.5l3.9,3.5l1.6,0.3l1.4-2.7l2.7,1.8l4.2,0.2l3.1,1.4l4.5-2.3l2.5,0.8l3.3,1.6l5.1-2.9l3.1,1.4l2.9-0.3l2.3,2.3l0.4,6.5l2.7,2.1l4.7-0.2l3.5-2.9l0.8-0.2l4.1,1.8l2.7-2.9l3.3,0.4l2.5,2.3l4.7,1.4l1.8,1.6l4.3-0.6l2.7-2.5l4.9,0.8l4.3,1.4l2.3-1.1l-0.2-4.9l3.5-2.3l5-0.4l5.1-0.2l4.1-1.6l0.8-3.1l4.7-2.1l0.4-5l-1.4-5.2l0.7-3.8l-5.6,0.2l-8.9-0.3l1.2-26.3z", name: "Oklahoma" },
  OR: { path: "M137.7,176.7l-0.1,0.7l-5.7,0.9l-3.4,1.5l-1.9,1.2l-2.2,3.4l-0.5,3.6l2.3,3.9l0.6,4.5l-0.6,4l2,3.3l28.8,7.1l30.9,7.1l25.7,5.1l-5.5-31.7l-5.3-32.5l-25.3,4.8l-11.2,0.8l-5.7-0.2l-1.9,2.9l-4.7,2.1l-4.3-0.4l-4.3,3.3l-2.9,1l-3.3,0.4l0.1,1.2l-1.4,1.8z", name: "Oregon" },
  PA: { path: "M807.4,223.7l-4.5-7.9l-4.5,0.6l-1.8-1l-0.7-2.7l-6.2,1.2l-13.9,2.6l-36.6,7.6l-11.9,1.8l4.7,19.5l5.9,21.2l2.1-0.2l3.9-3.5l4-2.1l5.8-1.2l5.5,0.5l4.1,3.7l5.5-0.2l5.1-3.7l1.6-5l0.8-3.3l2.3-3.7l0.2-9.8l4.1-2.7l5.7-3.9l-0.4-2.9l4.7-2.7l3.9-4.3l3.5-3.3l6.9-1.2l9.1,3.5z", name: "Pennsylvania" },
  RI: { path: "M866.7,174.3l-1-5.3l-1-5.7l-5.4,1.4l1.6,4.5l1.3,3.4l2,5.1z", name: "Rhode Island" },
  SC: { path: "M729.3,372.3l-3.5-2.9l-4.1-1l-1.8-5l-3.3-3.9l-3.5-0.4l-4.5,3.5l-5.5,4.5l-3.3,4.3l-4.1-0.2l-4.7-2.3l-1.2,2l-10.1,1.7l-24.4,3.3l4.5,6l1,5.9l-0.2,6l3,11.1l5.5,3.4l6.5-2.6l4.5-0.2l5.8-1.5l11-5.8l2.9,1.8l3.3-4.3l5-4.3l3.3-1l5.7-6.5l6-4.7l6-1.9l4.3-2.7z", name: "South Carolina" },
  SD: { path: "M473.3,172.4l-62.2,0.4l0.6,21.5l-0.8,3.7l-3.5,5.1l-0.3,4.6l24,-0.4l46.3,0.8l1.2-2.5l-1.8-3.3l0.2-2.9l-1.8-3.7l1.2-2.9l-1.4-3.5l-3.5-2.4l0.8-7.2l-0.2-0.4l2.4-2l-0.6-2.4l2.9-3.3l0.5-3.1z", name: "South Dakota" },
  TN: { path: "M687.1,336.7l-5.5,4.5l-10.7,1.2l-5.1,5.3l-5.3,0.3l-8.1,5.7l-5.9,1l-1.9,3l-5.5,2.1l-5.3,3l-3,4.1l-26.3,2.9l-23.4,1.8l-10.9,1l-10.7,0.2l-6.5,0.4l-4.3-6.5l6.1-7l7.9-0.5l22.2-0.9l30.1-2.3l8.1-0.5l6.1-0.6l4.9-4.3l8.9-4.5l4.5-4.5l5.5-2.1l8.3-3.7l5.3,0.3l0.8-4.1l3.4-6.3l6.9-7.1l0.8,4.7l4.5,4.7l2.1,5.1l5.3,1l0.9,3.7z", name: "Tennessee" },
  TX: { path: "M503.4,412.3l-0.6,6.9l-5.1,0.2l-5,0.4l-3.5,2.3l0.2,4.9l-2.3,1.1l-4.3-1.4l-4.9-0.8l-2.7,2.5l-4.3,0.6l-1.8-1.6l-4.7-1.4l-2.5-2.3l-3.3-0.4l-2.7,2.9l-4.1-1.8l-0.8,0.2l-3.5,2.9l-4.7,0.2l-2.7-2.1l-0.4-6.5l-2.3-2.3l-2.9,0.3l-3.1-1.4l-5.1,2.9l-3.3-1.6l-2.5-0.8l-4.5,2.3l-3.1-1.4l-4.2-0.2l-2.7-1.8l-1.4,2.7l-1.6-0.3l-3.9-3.5l-1.2-5.5l-0.8-38.3l-8.9-0.4l-7.6,0.4l-22.5-2l-7.5-0.8l-1.5,12.9l-0.8,7.7l1.9,6.5l1.8,5.5l1.6,5.1l-1,4.1l2.5,3.3l-0.8,8.3l-0.2,4.5l1.8,4.3l0.6,4.7l1.6,4.3l0.4,3.5l2.1,4.7l4.1,5.7l2.3,4.3l0.6,2.3l2.7,1.2l-0.3,3.3l-0.4,3.5l2,1.8l0.4,2.7l0.8,2.7l1.8,3.9l3.5,0.4l3.5,0.4l3.1,2.9l2.7,1l1.8,2.7l2.3,0.4l1.4,1.6l-0.2,3.5l3.3,0.6l2.7,2.3l-1.2,2.3l1.6,2l1.8-0.2l3.3-3.3l1.8-3.1l2-1.2l1-2.5l3.1-2.5l3.9-2.5l4.3-0.8l6.4-2.7l3.1-2.7l2.5-2.7l0.6-1.4l-0.4-2.9l2.1-1.4l-1.4-1.8l4.1-5.1l1.6-3.5l3.5-4.7l0.8-4.1l2.1-3.5l-0.4-2.3l-3.3-3.5l-1.2-2.9l-0.4-5.3l-2.1-3.3l1-1.2l4.7-1.2l7.7-0.8l4.5-0.2l1.6,0.4l-0.2-0.2l2.7,0.8l3.7,3.7l3.5,0.4l2.5-0.2l4.1,1.4l4.5-2.3l1.4-3.9l3.7-0.2l2.3-1.2l1.4,0.8l3.3-2l3.9-1.4l0.8-1.8l4.3-2.7l2.3,0.6l2.1,1.8l2.3-1l0.8-2.7l2.5-1.6l4.7-0.2l6.9,2.5l3.7,0.4l1.2-0.4l0.6,0.2l0.3,2.8l4.5,0.9l3.7,2.5l1.9,3.1l1.5,3.4l3.9,1.8l2.9-1l3.7-3.7l4.5-6.2l0.8-2.5l0.9-3.3l0.3-3.1l-1.4-3.5l-1.8-2.1l-3.1-0.4l-0.8-1l-0.6-3.3l-0.6-1.4l0.2-1.4l-4.5-5.5l-1.6-2.4l0.2-0.8l37.7-1.9l-0.4-5.7l-18.8,1.2z", name: "Texas" },
  UT: { path: "M273.8,283.3l-41.7-6.1l-21.2-3.3l-13.9,89.7l31.2,4.5l27.1,3.4l21.7,2.4l5.1-39.9l-8.2-0.9z", name: "Utah" },
  VT: { path: "M854.7,114.3l2.1,5.3l-1.5,4.5l2.1,3.7l-0.8,2.7l0.2,8.3l-0.8,2.5l1.9,5.1l-0.8,4.3l0.2,3.5l-4.5,1.4l-4.3,6.5l1.4,3.5l-18.9,4.1l-3.5-13.9l-3.1-16.5l1.5-2.1l-0.4-3.3l1.8-3.1l-0.4-2.3l-1.6-2.1l0.6-9.5l1-1l0.4-3.9l2.3-1.4l-0.4-4.9l1.2-1.7l1.8-2.7l17.9-4.5l2,4.9l0.2,2.3l-0.4,3.9l1.6,4.9l-1.4,4.1l1.2,4.5z", name: "Vermont" },
  VA: { path: "M807.8,289.7l2.5-6.9l5.8-0.2l1.9-4.5l3.4-5.7l1-0.9l-1.6-0.8l-0.4-2.5l-2.1-2.5l2.3-5.7l2.6-2.9l0.2-5.7l3.2-0.4l0.5-2.7l-0.6-3.5l4.9-3.9l2.6-4.5l1.4,1.2l2.7,6.8l0.8,3.9l-1.1,2.4l0.4,2.7l2.9,6.5l-1,3.5l0.6,4.5l0.6,0.2l-5,5.5l-2.3,1.7l-0.4,2.3l2.7,4.7l3.4,2.3l-0.2,3.4l-1.9,3.9l1.2,3.1l5.5,2.9l2.9,2.5l-0.8,0.4l0.3,2.2l-3.4,2.1l-3.4-0.4l-5.1,4.5l-2.8,0.4l-2.5,3.7l-5.1,0.2l-2.3,2.5l-9.1,4.5l-4.3-0.2l-0.4,3.5l-5.8,5.5l-1.6-0.6l-0.2-5.7l-2.9-1.4l-1.9,0.6l-3.7,4.5l-6.9,0.4l-2.5-1l-11.7,5.5l-3.1-1.2l-1,0.4l-11.8,1.6l1.9-3.3l2.3-3.9l1-5.3l4.6-1.4l6.5-1.9l6-6.1l1.8-3.5l-0.8-2.9l2.8-2l4.5-3.3l1.4-3.7l14.9-4.1l5.5-3.5l4.3-0.6l2.5-5.3l4.3-2.7l3.3,0.2z", name: "Virginia" },
  WA: { path: "M171.9,42.5l-4.1,0.2l-5.3,1.6l-3.3,0.8l-0.8,2.5l-5.1,1.6l-2.1,0.2l-1.8-1l-4.7,1.4l-4.3,1l-3.1-0.4l-3.3,2.7l-5.7,1.4l-4.3,3.3l-2.4-0.4l1.5,2.1l-0.3,3.5l1.5,2.7l0.2,4.3l-1.2,3.9l1.8,3.5l-0.2,8.3l1.2,3.3l2.5,1.3l1.2,3.4l0.5,4.9l1.5,2.5l-0.6,4.3l1.4,1.6l-0.7,6.8l0.7,5.9l-2.8-0.2l-0.8-4.1l-30.9-7.1l-28.8-7.1l10-46l60.9,14.9l34,6.4z", name: "Washington" },
  WV: { path: "M750.6,258.3l-2.3,3.9l0.2,9.8l-0.8,3.3l-1.6,5l-5.1,3.7l-5.5,0.2l-4.1-3.7l-5.5-0.5l-5.8,1.2l-4,2.1l-3.9,3.5l-1.9,0.2l-2.7-2.9l-5.4-0.8l-2.1-5.1l-4.5-4.7l-1.2-4.3l-6.5,5.1l-3.5,3.1l-2.1,4.1l0.4,3.3l-3.1,5.5l-3.9,4.7l0.2,3.1l2.3,2.5l-0.2,5.3l-3.1,4.1l0.6,5.9l-2.7,3.7l-4.7,6.9l-3.5,4.7l5.3-0.3l5.1-5.3l10.7-1.2l5.5-4.5l2.7-5.1l4.3-4.5l4.5-0.6l6.5-6.7l4.5-6.5l3.5-3.9l0.4-4.7l5.5-0.8l2.9-3.1l2.5-0.6l3.7,4.1l1.6-0.6l1.6-3.5l3.1-2.1l4.3-4.7l2.1-3.3l-0.8-2.5l-0.4-2.7l3.3-4.1l2.1-1.8l2.1-2.3l-5.1-0.6l-1-3.7z", name: "West Virginia" },
  WI: { path: "M594.3,110.1l-2.9,3.9l0.4,3.5l-0.6,2.3l-1.6,3.3l0.6,3.9l0.8,2.3l1.7,4.5l3.7,5.7l1.6,2.5l-0.6,2.9l0.2,2.7l1.4,4.7l1.8,3.1l-0.4,6.5l0.4,4.1l-0.8,4.7l-1.4,3.3l-0.4,3.1l1.2,1.8l-0.4,2.4l-22.7-2.1l-2.5-1l-3.5-3.3l-1.4-2.5l-29.1,0.6l-7.5-0.2l0.2-6.8l1.3-4.2l-5.2-2.8l-4.9-1.7l-2.3-3.3l0.6-3.3l0.2-6.8l2.1-3.9l2.5-6l-0.6-3.7l1.8-2.1l0.2-3.3l-1.2-1.6l0.4-1.8l-2.1-3.9l0.1-3.2l1.1-1.5l5-0.5l5.2-2.3l4.7,0.9l1.5-2.1l3.3-1.4l1.4-1.8l4.3-1.6l2.3,1.1l2,0.5l2.9,2.3l5,1.8l3.8-0.2l0.6-1.4l1.5-0.9l4.9,2.7l1.7,4.9l1.4,1.4l0.2,2.4l1.8,0.6l1.1-0.9l1.5-4.3l3.1-4.5l2-1.8l-0.4-3.6l1.3-1.3l-0.5-4.9l3.7-5.5z", name: "Wisconsin" },
  WY: { path: "M329.2,185.1l-1.2-10.1l-33.9-1.9l-35.9-3.3l-5.3,49l-4.2,39.9l41.7,4.1l50.9,4.2l1.6-52.4l-13.6-1.1z", name: "Wyoming" },
  DC: { path: "M800,259l1.5,1.5l1.5-1l0.5-1.5l-1-1.5l-1.5,0.5l-1,2z", name: "Washington D.C." },
  AK: { path: "M158.1,453.6l-0.3,85.4l1.6,1l3.1,0.2l1.5-1.1l5.2,2.4l3.3-1.8l0.2-0.2l2.7,1.8l5.5-3.7l5.3-3.3l2.8,1.2l6.4,0.5l3.7,2.9l5.6,3.3l4.2,2.5l2.3,1.2l2.6-0.4l-0.4-3l-2.2-1.6l-4.4-1.5l-2.9-2.1l-2.4-1.1l0.9-0.8l4.3,1.7l3.6,1.5l2,1.4l1.9,1.3l2.2-0.2l0.2-2.1l-1.4-1.9l0.3-0.8l1.4,1l1.6,1.1l5.6-3.9l2.1-2.6l0.6-3.4l3.5-2.5l1.1-2.5l-4-0.2l-3.1,0.3l-2.7-0.8l-4.5,0.1l-3.1-2.7l-1.5-4.1l-3.2-2l-1.3,0.7l0.3,2.9l-1.4,1.7l-3.2-1l-3.3-3.8l-4-2.9l-1.9-3.7l-4-1.5l-1.3-3.3l-2.1,0.3l-2.7-1.7l0.2-2.9l1.9-2.5l0.1-1.7l-0.9-0.8l-3.1,2.1l-3.3,2.2l-4.3-0.3l-1.7-3.5l-3.8-1.7l-2.3,0.9l-2.7,3l-3.3,1.6l-1.9-0.4z", name: "Alaska" },
  HI: { path: "M233.1,503l2.1,5.6l3.5,1.6l1.6-0.8l1.2-2.9l-0.4-2.3l-5.9-2.2zM247.9,509.5l6.6,3.2l1.4-0.8l0.4-3.3l-3.2-2.3l-5.3-0.1zM260.7,518l2.5,4.7l3.1-0.8l0.6-1l-1-3.8l-2.5-1.7zM270.1,524.1l1.2,4.9l4.1,1.4l4.9,0.2l3.9-1.2l-0.2-2.5l-4.9-3.3l-5.1-0.6zM300,537.7l3.5,4.5l1,3.9l3.5-0.4l5.5-3.5l6.6-2.9l5.1,0.8l4.1,0.8l-1.2-4.1l-4.7-1.2l-5.5,1.2l-4.3,2.5l-5.9,0.2l-2.7-3.7l-3.1-0.8z", name: "Hawaii" }
};

const JurisdictionCoverageMap = () => {
  const [stateData, setStateData] = useState<Record<string, StateData>>({});
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [comparisonJurisdictions, setComparisonJurisdictions] = useState<JurisdictionInfo[]>([]);

  useEffect(() => {
    const fetchJurisdictions = async () => {
      try {
        const { data: jurisdictions, error } = await supabase
          .from('jurisdictions')
          .select('id, name, city, state, base_permit_fee, plan_review_sla_days, is_high_volume, website_url')
          .eq('is_active', true);

        if (error) throw error;

        const stateMap: Record<string, StateData> = {};
        
        Object.entries(US_STATES).forEach(([code, { name }]) => {
          stateMap[code] = {
            code,
            name,
            count: 0,
            jurisdictions: [],
            avgFee: null,
            avgProcessingDays: null
          };
        });

        jurisdictions?.forEach((j) => {
          // State can be stored as either a code (e.g., "NY") or full name (e.g., "New York")
          let stateCode = j.state?.toUpperCase();
          
          // If it's a full name, find the corresponding code
          if (stateCode && !US_STATES[stateCode]) {
            const foundEntry = Object.entries(US_STATES).find(
              ([, { name }]) => name.toLowerCase() === j.state?.toLowerCase()
            );
            stateCode = foundEntry?.[0];
          }
          
          if (stateCode && stateMap[stateCode]) {
            stateMap[stateCode].count++;
            stateMap[stateCode].jurisdictions.push({
              id: j.id,
              name: j.name,
              city: j.city,
              state: j.state,
              base_permit_fee: j.base_permit_fee,
              plan_review_sla_days: j.plan_review_sla_days,
              is_high_volume: j.is_high_volume,
              website_url: j.website_url
            });
          }
        });

        // Calculate averages
        Object.keys(stateMap).forEach((stateCode) => {
          const stateJurisdictions = stateMap[stateCode].jurisdictions;
          if (stateJurisdictions.length > 0) {
            const fees = stateJurisdictions
              .map(j => j.base_permit_fee)
              .filter((f): f is number => f !== null);
            const days = stateJurisdictions
              .map(j => j.plan_review_sla_days)
              .filter((d): d is number => d !== null);
            
            stateMap[stateCode].avgFee = fees.length > 0 
              ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) 
              : null;
            stateMap[stateCode].avgProcessingDays = days.length > 0 
              ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) 
              : null;
          }
        });

        setStateData(stateMap);
      } catch (err) {
        console.error('Error fetching jurisdictions:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchJurisdictions();
  }, []);

  const getStateColor = (stateCode: string) => {
    const count = stateData[stateCode]?.count || 0;
    if (count === 0) return "hsl(var(--muted))";
    if (count <= 5) return "hsl(var(--primary) / 0.3)";
    if (count <= 15) return "hsl(var(--primary) / 0.5)";
    if (count <= 30) return "hsl(var(--primary) / 0.7)";
    return "hsl(var(--primary))";
  };

  const totalJurisdictions = useMemo(() => 
    Object.values(stateData).reduce((sum, s) => sum + s.count, 0), 
    [stateData]
  );

  const statesWithCoverage = useMemo(() => 
    Object.values(stateData).filter(s => s.count > 0).length, 
    [stateData]
  );

  const addToComparison = (jurisdiction: JurisdictionInfo) => {
    if (comparisonJurisdictions.length < 5 && !comparisonJurisdictions.find(j => j.id === jurisdiction.id)) {
      setComparisonJurisdictions([...comparisonJurisdictions, jurisdiction]);
    }
  };

  const removeFromComparison = (jurisdictionId: string) => {
    setComparisonJurisdictions(comparisonJurisdictions.filter(j => j.id !== jurisdictionId));
  };

  const isInComparison = (jurisdictionId: string) => 
    comparisonJurisdictions.some(j => j.id === jurisdictionId);

  return (
    <section className="py-20 bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <Badge variant="outline" className="mb-4">
            <MapPin className="w-3 h-3 mr-1" />
            Interactive Coverage Map
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Nationwide Jurisdiction Coverage
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Click on any state to explore jurisdictions, compare permit fees, and view processing times
          </p>
        </motion.div>

        {/* Stats Row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex flex-wrap justify-center gap-8 mb-8"
        >
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">{totalJurisdictions}+</div>
            <div className="text-sm text-muted-foreground">Jurisdictions</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">{statesWithCoverage}</div>
            <div className="text-sm text-muted-foreground">States Covered</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">98%</div>
            <div className="text-sm text-muted-foreground">Data Accuracy</div>
          </div>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Map Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-2 bg-card rounded-2xl border shadow-lg p-6 overflow-hidden"
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="relative">
                <svg
                  viewBox="0 0 959 593"
                  className="w-full h-auto"
                  style={{ maxHeight: '500px' }}
                >
                  {/* Render all states */}
                  {Object.entries(US_STATES).map(([code, { path, name }]) => {
                    const isSelected = selectedState === code;
                    const isHovered = hoveredState === code;
                    const hasData = stateData[code]?.count > 0;
                    
                    return (
                      <motion.path
                        key={code}
                        d={path}
                        fill={isSelected ? "hsl(var(--primary))" : getStateColor(code)}
                        stroke={isSelected || isHovered ? "hsl(var(--primary))" : "hsl(var(--border))"}
                        strokeWidth={isSelected || isHovered ? 2 : 0.5}
                        className={cn(
                          "transition-all duration-200 cursor-pointer",
                          hasData && "hover:brightness-110"
                        )}
                        initial={false}
                        animate={{
                          scale: isSelected ? 1.02 : 1,
                          opacity: selectedState && !isSelected ? 0.5 : 1
                        }}
                        whileHover={{ scale: hasData ? 1.02 : 1 }}
                        onClick={() => {
                          if (hasData) {
                            setSelectedState(isSelected ? null : code);
                            setSelectedJurisdiction(null);
                          }
                        }}
                        onMouseEnter={() => setHoveredState(code)}
                        onMouseLeave={() => setHoveredState(null)}
                      >
                        <title>{`${name}: ${stateData[code]?.count || 0} jurisdictions`}</title>
                      </motion.path>
                    );
                  })}
                </svg>

                {/* State Tooltip */}
                <AnimatePresence>
                  {hoveredState && stateData[hoveredState] && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-4 left-4 bg-popover border rounded-lg shadow-xl p-4 pointer-events-none z-10"
                    >
                      <h4 className="font-semibold">{stateData[hoveredState].name}</h4>
                      <div className="text-sm text-muted-foreground mt-1">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3 h-3" />
                          {stateData[hoveredState].count} jurisdictions
                        </div>
                        {stateData[hoveredState].avgFee && (
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-3 h-3" />
                            Avg fee: ${stateData[hoveredState].avgFee}
                          </div>
                        )}
                        {stateData[hoveredState].avgProcessingDays && (
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            Avg time: {stateData[hoveredState].avgProcessingDays} days
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Legend */}
                <div className="absolute top-4 right-4 bg-popover/90 backdrop-blur-sm border rounded-lg p-3 text-xs">
                  <div className="font-medium mb-2">Coverage Density</div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-4 h-4 rounded" style={{ background: "hsl(var(--muted))" }}></div>
                    <span>No data</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-4 h-4 rounded" style={{ background: "hsl(var(--primary) / 0.3)" }}></div>
                    <span>1-5</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-4 h-4 rounded" style={{ background: "hsl(var(--primary) / 0.5)" }}></div>
                    <span>6-15</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-4 h-4 rounded" style={{ background: "hsl(var(--primary) / 0.7)" }}></div>
                    <span>16-30</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ background: "hsl(var(--primary))" }}></div>
                    <span>30+</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Details Panel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="bg-card rounded-2xl border shadow-lg overflow-hidden"
          >
            <AnimatePresence mode="wait">
              {selectedState && stateData[selectedState] ? (
                <motion.div
                  key={selectedState}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col"
                >
                  {/* State Header */}
                  <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{stateData[selectedState].name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {stateData[selectedState].count} jurisdictions
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedState(null);
                        setSelectedJurisdiction(null);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* State Stats */}
                  <div className="p-4 border-b grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <DollarSign className="w-5 h-5 mx-auto mb-1 text-primary" />
                      <div className="text-lg font-semibold">
                        {stateData[selectedState].avgFee ? `$${stateData[selectedState].avgFee}` : 'N/A'}
                      </div>
                      <div className="text-xs text-muted-foreground">Avg Permit Fee</div>
                    </div>
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <Clock className="w-5 h-5 mx-auto mb-1 text-primary" />
                      <div className="text-lg font-semibold">
                        {stateData[selectedState].avgProcessingDays ? `${stateData[selectedState].avgProcessingDays}d` : 'N/A'}
                      </div>
                      <div className="text-xs text-muted-foreground">Avg Review Time</div>
                    </div>
                  </div>

                  {/* Jurisdictions List */}
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-2">
                      {stateData[selectedState].jurisdictions.map((j) => (
                        <motion.div
                          key={j.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            "p-3 rounded-lg border cursor-pointer transition-all",
                            selectedJurisdiction?.id === j.id
                              ? "border-primary bg-primary/5"
                              : "hover:border-primary/50 hover:bg-muted/50"
                          )}
                          onClick={() => setSelectedJurisdiction(
                            selectedJurisdiction?.id === j.id ? null : j
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-primary" />
                              <span className="font-medium text-sm">{j.name}</span>
                            </div>
                            {j.is_high_volume && (
                              <Badge variant="secondary" className="text-xs">High Vol</Badge>
                            )}
                          </div>
                          
                          <AnimatePresence>
                            {selectedJurisdiction?.id === j.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="mt-3 pt-3 border-t space-y-2"
                              >
                                <div className="flex items-center gap-2 text-sm">
                                  <DollarSign className="w-3 h-3 text-muted-foreground" />
                                  <span>Fee: {j.base_permit_fee ? `$${j.base_permit_fee}` : 'Contact for quote'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <Clock className="w-3 h-3 text-muted-foreground" />
                                  <span>Review: {j.plan_review_sla_days ? `${j.plan_review_sla_days} days` : 'Varies'}</span>
                                </div>
                                
                                <div className="flex gap-2 mt-3">
                                  <Button
                                    size="sm"
                                    variant={isInComparison(j.id) ? "secondary" : "default"}
                                    className="flex-1 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isInComparison(j.id)) {
                                        removeFromComparison(j.id);
                                      } else {
                                        addToComparison(j);
                                      }
                                    }}
                                  >
                                    {isInComparison(j.id) ? (
                                      <>
                                        <Check className="w-3 h-3 mr-1" />
                                        Added
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="w-3 h-3 mr-1" />
                                        Compare
                                      </>
                                    )}
                                  </Button>
                                  {j.website_url && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs"
                                      asChild
                                    >
                                      <a href={j.website_url} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </Button>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      ))}
                    </div>
                  </ScrollArea>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center p-8 text-center"
                >
                  <MapPin className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h3 className="font-semibold mb-2">Select a State</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Click on any colored state to view its jurisdictions and permit data
                  </p>
                  <Link to="/jurisdiction-comparison">
                    <Button variant="outline" size="sm">
                      <ChevronRight className="w-4 h-4 mr-2" />
                      View All Jurisdictions
                    </Button>
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Comparison Panel */}
        <AnimatePresence>
          {comparisonJurisdictions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="mt-8 bg-card rounded-2xl border shadow-lg p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">
                  Comparing {comparisonJurisdictions.length} Jurisdiction{comparisonJurisdictions.length > 1 ? 's' : ''}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setComparisonJurisdictions([])}
                >
                  Clear All
                </Button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Jurisdiction</th>
                      <th className="text-left p-2">State</th>
                      <th className="text-left p-2">Permit Fee</th>
                      <th className="text-left p-2">Review Time</th>
                      <th className="text-left p-2">Volume</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonJurisdictions.map((j) => (
                      <tr key={j.id} className="border-b last:border-0">
                        <td className="p-2 font-medium">{j.name}</td>
                        <td className="p-2">{j.state}</td>
                        <td className="p-2">{j.base_permit_fee ? `$${j.base_permit_fee}` : 'N/A'}</td>
                        <td className="p-2">{j.plan_review_sla_days ? `${j.plan_review_sla_days} days` : 'N/A'}</td>
                        <td className="p-2">
                          {j.is_high_volume ? (
                            <Badge variant="secondary">High</Badge>
                          ) : (
                            <span className="text-muted-foreground">Standard</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromComparison(j.id)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
};

export default JurisdictionCoverageMap;
