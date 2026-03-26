import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MapPin, Clock, DollarSign, FileCheck, ExternalLink, Bell, BellOff, Check, ArrowLeftRight, Download, Filter, Map, List, X, Loader2, CheckCircle2, XCircle, AlertCircle, Link2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

// Region definitions for filtering
const regions: Record<string, string[]> = {
  "Northeast": ["NY", "MA", "PA", "MD", "DC"],
  "Southeast": ["FL", "GA", "NC", "VA", "TN", "LA"],
  "Midwest": ["IL", "OH", "MI", "MO", "NE", "MN", "KS", "WI"],
  "Southwest": ["TX", "AZ", "NM", "OK"],
  "West": ["CA", "WA", "OR", "CO", "NV"],
};

const getRegionForState = (state: string): string => {
  for (const [region, states] of Object.entries(regions)) {
    if (states.includes(state)) return region;
  }
  return "Other";
};

// City coordinates for map markers
const cityCoordinates: Record<string, [number, number]> = {
  "nyc": [-74.006, 40.7128],
  "la": [-118.2437, 34.0522],
  "chicago": [-87.6298, 41.8781],
  "houston": [-95.3698, 29.7604],
  "phoenix": [-112.074, 33.4484],
  "philadelphia": [-75.1652, 39.9526],
  "san-antonio": [-98.4936, 29.4241],
  "san-diego": [-117.1611, 32.7157],
  "dallas": [-96.797, 32.7767],
  "austin": [-97.7431, 30.2672],
  "san-jose": [-121.8863, 37.3382],
  "jacksonville": [-81.6557, 30.3322],
  "fort-worth": [-97.3308, 32.7555],
  "columbus": [-82.9988, 39.9612],
  "sf": [-122.4194, 37.7749],
  "charlotte": [-80.8431, 35.2271],
  "seattle": [-122.3321, 47.6062],
  "denver": [-104.9903, 39.7392],
  "washington-dc": [-77.0369, 38.9072],
  "boston": [-71.0589, 42.3601],
  "el-paso": [-106.485, 31.7619],
  "nashville": [-86.7816, 36.1627],
  "detroit": [-83.0458, 42.3314],
  "oklahoma-city": [-97.5164, 35.4676],
  "portland": [-122.6765, 45.5152],
  "las-vegas": [-115.1398, 36.1699],
  "memphis": [-90.049, 35.1495],
  "louisville": [-85.7585, 38.2527],
  "baltimore": [-76.6122, 39.2904],
  "milwaukee": [-87.9065, 43.0389],
  "albuquerque": [-106.6504, 35.0844],
  "tucson": [-110.9747, 32.2226],
  "fresno": [-119.7871, 36.7378],
  "sacramento": [-121.4944, 38.5816],
  "mesa": [-111.8315, 33.4152],
  "kansas-city": [-94.5786, 39.0997],
  "atlanta": [-84.388, 33.749],
  "omaha": [-95.9345, 41.2565],
  "colorado-springs": [-104.8214, 38.8339],
  "raleigh": [-78.6382, 35.7796],
  "miami": [-80.1918, 25.7617],
  "virginia-beach": [-75.978, 36.8529],
  "long-beach": [-118.1937, 33.77],
  "oakland": [-122.2711, 37.8044],
  "minneapolis": [-93.265, 44.9778],
  "tulsa": [-95.9928, 36.154],
  "wichita": [-97.3375, 37.6872],
  "new-orleans": [-90.0715, 29.9511],
  "arlington": [-97.1081, 32.7357],
};

interface JurisdictionData {
  id: string;
  name: string;
  state: string;
  baseCode: string;
  amendments: string[];
  submissionReqs: { item: string; required: boolean }[];
  fees: { type: string; amount: string }[];
  processingTimes: { type: string; time: string }[];
  contact: { phone: string; email: string; website: string };
  lastUpdated: string;
}

const jurisdictions: JurisdictionData[] = [
  {
    id: "nyc",
    name: "New York City",
    state: "NY",
    baseCode: "2022 NYC Building Code (based on 2021 IBC with significant modifications)",
    amendments: [
      "Local Law 97: Building Emissions Law",
      "Local Law 11: Façade Inspection and Safety Program (FISP)",
      "NYC Zoning Resolution modifications",
      "NYC Fire Code Chapter 9 requirements",
      "Accessibility requirements beyond ADA (Local Law 58)",
    ],
    submissionReqs: [
      { item: "Architectural Plans (PDF)", required: true },
      { item: "Structural Plans with PE/RA Seal", required: true },
      { item: "Energy Code Compliance (NYCECC)", required: true },
      { item: "Zoning Analysis", required: true },
      { item: "Environmental Review (CEQR)", required: false },
      { item: "Landmarks Preservation Commission Approval", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.26 per SF (min $225)" },
      { type: "Plan Examination", amount: "100% of filing fee" },
      { type: "Certificate of Occupancy", amount: "$100 per floor" },
      { type: "Elevator Filing", amount: "$260 per device" },
    ],
    processingTimes: [
      { type: "Professional Certification", time: "1-3 days" },
      { type: "Standard Plan Exam", time: "4-8 weeks" },
      { type: "Complex Projects", time: "8-16 weeks" },
      { type: "New Construction", time: "12-20 weeks" },
    ],
    contact: { phone: "(212) 566-5000", email: "customerservice@buildings.nyc.gov", website: "https://nyc.gov/buildings" },
    lastUpdated: "January 2026",
  },
  {
    id: "la",
    name: "Los Angeles",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "LAMC Chapter IX: Building Regulations",
      "Ordinance 183893: Seismic retrofit for wood-frame",
      "LA Green Building Code (LAGBC)",
      "Hillside Construction Regulations",
      "Fire District No. 1 requirements",
    ],
    submissionReqs: [
      { item: "Plot Plan", required: true },
      { item: "Floor Plans & Elevations", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Title 24 Energy Forms", required: true },
      { item: "Soils Report", required: false },
      { item: "Grading Plans", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "Based on valuation table" },
      { type: "Plan Check", amount: "Varies by project type" },
      { type: "School Fee", amount: "$4.08 per SF (residential)" },
      { type: "AQMD Fee", amount: "$0.045 per SF" },
    ],
    processingTimes: [
      { type: "Express Permit", time: "Same day" },
      { type: "Residential Addition", time: "4-6 weeks" },
      { type: "Commercial TI", time: "6-10 weeks" },
      { type: "New Construction", time: "10-16 weeks" },
    ],
    contact: { phone: "(213) 482-0000", email: "ladbs@lacity.org", website: "https://ladbs.org" },
    lastUpdated: "January 2026",
  },
  {
    id: "chicago",
    name: "Chicago",
    state: "IL",
    baseCode: "2022 Chicago Building Code (based on 2021 IBC)",
    amendments: [
      "Chicago Energy Conservation Code",
      "High-Rise Building Safety Ordinance",
      "Chicago Sustainable Development Policy",
      "Affordable Requirements Ordinance (ARO)",
      "Transit-Oriented Development regulations",
    ],
    submissionReqs: [
      { item: "Architectural Drawings", required: true },
      { item: "Structural Drawings", required: true },
      { item: "MEP Plans", required: true },
      { item: "Energy Compliance Documentation", required: true },
      { item: "Zoning Review Application", required: true },
      { item: "Environmental Site Assessment", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.35 per SF" },
      { type: "Plan Review", amount: "75% of permit fee" },
      { type: "Elevator Permit", amount: "$350 per unit" },
      { type: "Demolition Permit", amount: "$0.10 per SF" },
    ],
    processingTimes: [
      { type: "Easy Permit", time: "1-5 days" },
      { type: "Standard Review", time: "4-8 weeks" },
      { type: "Developer Services", time: "6-12 weeks" },
      { type: "New Construction", time: "10-16 weeks" },
    ],
    contact: { phone: "(312) 744-3449", email: "buildings@cityofchicago.org", website: "https://chicago.gov/buildings" },
    lastUpdated: "January 2026",
  },
  {
    id: "houston",
    name: "Houston",
    state: "TX",
    baseCode: "2021 International Building Code (with local amendments)",
    amendments: [
      "No zoning - deed restrictions apply",
      "Houston Floodplain Management Ordinance",
      "Chapter 10: Building Code amendments",
      "Hurricane resistance requirements",
      "Commercial energy conservation code",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Floor Plans & Elevations", required: true },
      { item: "Structural Plans", required: true },
      { item: "Plumbing/Mechanical Plans", required: true },
      { item: "Flood Zone Determination", required: true },
      { item: "Tree Survey (if applicable)", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$8 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Re-inspection Fee", amount: "$125 per visit" },
      { type: "Express Review", amount: "200% of standard fee" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "High-Rise", time: "8-14 weeks" },
    ],
    contact: { phone: "(832) 394-8800", email: "houstonpermittingcenter@houstontx.gov", website: "https://houstonpermittingcenter.org" },
    lastUpdated: "January 2026",
  },
  {
    id: "phoenix",
    name: "Phoenix",
    state: "AZ",
    baseCode: "2021 International Building Code (Phoenix amendments)",
    amendments: [
      "Phoenix Zoning Ordinance requirements",
      "Desert landscaping requirements",
      "Pool barrier code enhancements",
      "Solar-ready construction requirements",
      "Heat mitigation design standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Construction Documents", required: true },
      { item: "Energy Compliance", required: true },
      { item: "Dust Control Plan", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Drainage Report", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$6.25 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Grading Permit", amount: "$450 base + acreage" },
      { type: "Pool Permit", amount: "$250 flat fee" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "1-2 weeks" },
      { type: "Residential New", time: "3-5 weeks" },
      { type: "Commercial TI", time: "4-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
    ],
    contact: { phone: "(602) 262-7811", email: "pdd.intake@phoenix.gov", website: "https://phoenix.gov/pdd" },
    lastUpdated: "January 2026",
  },
  {
    id: "philadelphia",
    name: "Philadelphia",
    state: "PA",
    baseCode: "2018 International Building Code (PA UCC)",
    amendments: [
      "Philadelphia Building Construction Code",
      "Historical Commission Review requirements",
      "Green Building requirements (Bill 120428)",
      "Stormwater Management regulations",
      "Civic Design Review for large projects",
    ],
    submissionReqs: [
      { item: "Architectural Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Site Plan with Zoning", required: true },
      { item: "Energy Code Compliance (REScheck/COMcheck)", required: true },
      { item: "Historic Review (if applicable)", required: false },
      { item: "PWD Stormwater Plan", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$25 per $1,000 valuation" },
      { type: "Zoning Permit", amount: "$60 base fee" },
      { type: "Mechanical Permit", amount: "$100 per system" },
      { type: "Fire Suppression", amount: "$200 per floor" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-3 weeks" },
      { type: "Residential New", time: "4-6 weeks" },
      { type: "Commercial", time: "6-10 weeks" },
      { type: "Major Development", time: "10-16 weeks" },
    ],
    contact: { phone: "(215) 686-2463", email: "li.info@phila.gov", website: "https://phila.gov/li" },
    lastUpdated: "January 2026",
  },
  {
    id: "san-antonio",
    name: "San Antonio",
    state: "TX",
    baseCode: "2021 International Building Code (Texas amendments)",
    amendments: [
      "SA Unified Development Code",
      "Edwards Aquifer Protection regulations",
      "Historic Design Guidelines (downtown)",
      "Tree Preservation Ordinance",
      "Flood Damage Prevention regulations",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "SAWS Utility Letter", required: true },
      { item: "Tree Survey", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.15 per SF" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Impact Fee", amount: "Varies by district" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial Minor", time: "4-6 weeks" },
      { type: "Commercial Major", time: "6-10 weeks" },
      { type: "Fast Track (additional fee)", time: "5-10 days" },
    ],
    contact: { phone: "(210) 207-1111", email: "dsd-customers@sanantonio.gov", website: "https://sanantonio.gov/dsd" },
    lastUpdated: "January 2026",
  },
  {
    id: "san-diego",
    name: "San Diego",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "San Diego Municipal Code Chapter 14",
      "Coastal Development Permit requirements",
      "Climate Action Plan compliance",
      "Brush Management regulations",
      "Community Plan Design Standards",
    ],
    submissionReqs: [
      { item: "Architectural Plans (PDF)", required: true },
      { item: "Structural Plans", required: true },
      { item: "Title 24 Energy Compliance", required: true },
      { item: "Landscape Documentation", required: true },
      { item: "Geotechnical Report", required: false },
      { item: "Coastal Development Permit", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "Based on valuation table" },
      { type: "Plan Check", amount: "81% of permit fee" },
      { type: "Strong Motion Fee", amount: "$0.028 per SF" },
      { type: "Technology Fee", amount: "4% of permit fee" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-4 weeks" },
      { type: "Residential New", time: "6-10 weeks" },
      { type: "Commercial TI", time: "6-10 weeks" },
      { type: "Commercial New", time: "10-16 weeks" },
    ],
    contact: { phone: "(619) 446-5000", email: "dsdcustomerservice@sandiego.gov", website: "https://sandiego.gov/development-services" },
    lastUpdated: "January 2026",
  },
  {
    id: "dallas",
    name: "Dallas",
    state: "TX",
    baseCode: "2021 International Building Code (Dallas amendments)",
    amendments: [
      "Dallas Development Code",
      "Downtown Dallas 360 Plan requirements",
      "Green Building Program incentives",
      "Floodplain Management regulations",
      "Mixed-Use Development standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Traffic Impact Analysis", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$8 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Expedited Review", amount: "150% of standard fee" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "High-Rise", time: "12-16 weeks" },
    ],
    contact: { phone: "(214) 670-5313", email: "devservices@dallascityhall.com", website: "https://dallascityhall.com/departments/sustainabledevelopment" },
    lastUpdated: "January 2026",
  },
  {
    id: "austin",
    name: "Austin",
    state: "TX",
    baseCode: "2021 International Building Code (Austin amendments)",
    amendments: [
      "Austin Energy Green Building requirements",
      "Water Forward conservation standards",
      "Heritage Tree Ordinance",
      "S.M.A.R.T. Housing Program",
      "Wildland-Urban Interface Code",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "MEP Plans", required: true },
      { item: "Austin Energy Green Building rating", required: true },
      { item: "Tree Survey", required: false },
      { item: "Traffic Impact Analysis", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.37 per SF" },
      { type: "Plan Review", amount: "75% of permit fee" },
      { type: "Impact Fee", amount: "Varies by area" },
      { type: "Expedited Review", amount: "200% of standard" },
    ],
    processingTimes: [
      { type: "Residential Express", time: "1-3 days" },
      { type: "Residential Standard", time: "3-6 weeks" },
      { type: "Commercial", time: "6-12 weeks" },
      { type: "Site Plan", time: "8-16 weeks" },
    ],
    contact: { phone: "(512) 978-4000", email: "devassist@austintexas.gov", website: "https://austintexas.gov/department/development-services" },
    lastUpdated: "January 2026",
  },
  {
    id: "san-jose",
    name: "San Jose",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "San Jose Municipal Code Title 24",
      "Green Building Ordinance",
      "Riparian Corridor Policy",
      "Urban Village requirements",
      "Seismic retrofit for unreinforced masonry",
    ],
    submissionReqs: [
      { item: "Architectural Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Title 24 Energy Compliance", required: true },
      { item: "Green Point Rated checklist", required: true },
      { item: "Geotechnical Report", required: false },
      { item: "Arborist Report", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$1.05 per $100 valuation" },
      { type: "Plan Check", amount: "65% of permit fee" },
      { type: "Technology Fee", amount: "5% of permit fee" },
      { type: "SMIP Fee", amount: "$0.13 per $1,000 valuation" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-4 weeks" },
      { type: "Residential New", time: "6-10 weeks" },
      { type: "Commercial", time: "8-12 weeks" },
      { type: "High-Rise", time: "12-18 weeks" },
    ],
    contact: { phone: "(408) 535-3555", email: "building.services@sanjoseca.gov", website: "https://sanjoseca.gov/building" },
    lastUpdated: "January 2026",
  },
  {
    id: "jacksonville",
    name: "Jacksonville",
    state: "FL",
    baseCode: "2023 Florida Building Code (8th Edition)",
    amendments: [
      "Jacksonville Zoning Code",
      "Coastal Construction Control Line regulations",
      "St. Johns River Water Management requirements",
      "Hurricane shelter space requirements",
      "Downtown Investment Authority Design Guidelines",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (signed/sealed)", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "FBC Product Approvals", required: true },
      { item: "Environmental Report", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.20 per SF" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Re-inspection", amount: "$100 per visit" },
      { type: "Express Review", amount: "200% of standard" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "1-2 weeks" },
      { type: "Residential New", time: "3-5 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
    ],
    contact: { phone: "(904) 255-8500", email: "building@coj.net", website: "https://coj.net/building" },
    lastUpdated: "January 2026",
  },
  {
    id: "fort-worth",
    name: "Fort Worth",
    state: "TX",
    baseCode: "2021 International Building Code (Texas amendments)",
    amendments: [
      "Fort Worth Zoning Ordinance",
      "Urban Design Standards",
      "Trinity River Vision Corridor requirements",
      "Gas Well Drilling regulations",
      "Historic Overlay District standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Compliance", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Traffic Impact Study", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$7 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Zoning Verification", amount: "$50 flat fee" },
      { type: "Certificate of Occupancy", amount: "$100" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial Minor", time: "4-6 weeks" },
      { type: "Commercial Major", time: "6-10 weeks" },
      { type: "Priority Review", time: "50% faster" },
    ],
    contact: { phone: "(817) 392-2222", email: "developmentservices@fortworthtexas.gov", website: "https://fortworthtexas.gov/developmentservices" },
    lastUpdated: "January 2026",
  },
  {
    id: "columbus",
    name: "Columbus",
    state: "OH",
    baseCode: "2019 Ohio Building Code (based on 2018 IBC)",
    amendments: [
      "Columbus City Code Chapter 4105",
      "Green Building Initiative incentives",
      "Community Reinvestment Areas",
      "Urban Commercial Overlay requirements",
      "Floodplain Management regulations",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code (IECC) Compliance", required: true },
      { item: "Stormwater Management", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$12 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$75 base + equipment" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Expedited", time: "Additional fee, 50% faster" },
    ],
    contact: { phone: "(614) 645-7433", email: "buildingservices@columbus.gov", website: "https://columbus.gov/bzs" },
    lastUpdated: "January 2026",
  },
  {
    id: "sf",
    name: "San Francisco",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "Local Amendment 106A: Green Building Requirements",
      "SF Building Code Section 1207: Sound Transmission",
      "Height limit zones per SF Planning Code",
      "Accessibility beyond ADA per SF Admin Code Chapter 38",
      "Seismic retrofit requirements for soft-story buildings",
    ],
    submissionReqs: [
      { item: "Architectural Plans (PDF)", required: true },
      { item: "Structural Plans (PDF)", required: true },
      { item: "Energy Compliance (Title 24)", required: true },
      { item: "Green Building Checklist", required: true },
      { item: "Geotechnical Report (if applicable)", required: false },
      { item: "Historic Resource Evaluation", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$1.25 per $100 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Technology Fee", amount: "$27 + 4% of permit fee" },
      { type: "Strong Motion Fee", amount: "$0.13 per $1,000 valuation" },
    ],
    processingTimes: [
      { type: "Residential Alteration", time: "4-6 weeks" },
      { type: "Commercial TI (<5,000 SF)", time: "6-8 weeks" },
      { type: "Commercial TI (>5,000 SF)", time: "8-12 weeks" },
      { type: "New Construction", time: "12-16 weeks" },
    ],
    contact: { phone: "(415) 558-6088", email: "dbi.info@sfgov.org", website: "https://sfdbi.org" },
    lastUpdated: "January 2026",
  },
  {
    id: "charlotte",
    name: "Charlotte",
    state: "NC",
    baseCode: "2018 North Carolina State Building Code",
    amendments: [
      "Charlotte UDO (Unified Development Ordinance)",
      "Post Construction Stormwater Ordinance",
      "Charlotte Tree Ordinance",
      "Historic District Design Standards",
      "Transit Oriented Development requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (sealed)", required: true },
      { item: "Energy Code Compliance (NC)", required: true },
      { item: "Stormwater Management Plan", required: false },
      { item: "Historic Commission Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$7.50 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Fire Review", amount: "$200 base + SF" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Express Review", time: "1-2 weeks (additional fee)" },
    ],
    contact: { phone: "(704) 336-2261", email: "permitcenter@charlottenc.gov", website: "https://charlottenc.gov/development" },
    lastUpdated: "January 2026",
  },
  {
    id: "seattle",
    name: "Seattle",
    state: "WA",
    baseCode: "2021 Seattle Building Code (based on 2021 IBC)",
    amendments: [
      "Seattle Energy Code (more stringent than state)",
      "Seattle Noise Code requirements",
      "Environmentally Critical Areas (ECA) regulations",
      "Design Review requirements by neighborhood",
      "Mandatory Housing Affordability (MHA) requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Floor Plans", required: true },
      { item: "Building Sections", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Stormwater Management", required: true },
      { item: "SEPA Checklist", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$16.50 per $1,000 valuation" },
      { type: "Plan Review (hourly)", amount: "$295/hour" },
      { type: "Development Fee", amount: "Varies by zone" },
      { type: "Impact Fee", amount: "Varies by use" },
    ],
    processingTimes: [
      { type: "Simple Projects", time: "2-4 weeks" },
      { type: "Standard Review", time: "6-10 weeks" },
      { type: "Full Review", time: "10-14 weeks" },
      { type: "Design Review", time: "Add 8-12 weeks" },
    ],
    contact: { phone: "(206) 684-8600", email: "sdci@seattle.gov", website: "https://seattle.gov/sdci" },
    lastUpdated: "January 2026",
  },
  {
    id: "denver",
    name: "Denver",
    state: "CO",
    baseCode: "2021 Denver Building and Fire Code (based on 2021 IBC)",
    amendments: [
      "Denver Green Code requirements",
      "Affordable Housing requirements",
      "Denver Zoning Code (Form-Based)",
      "Landmark Preservation regulations",
      "Electric Vehicle Infrastructure requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Denver Green Code Checklist", required: true },
      { item: "Zoning Review", required: true },
      { item: "Landmark Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$13.40 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Use Tax", amount: "4.81% of materials" },
      { type: "Technology Fee", amount: "2% of permit fee" },
    ],
    processingTimes: [
      { type: "Residential Simple", time: "2-4 weeks" },
      { type: "Residential Complex", time: "4-8 weeks" },
      { type: "Commercial", time: "6-12 weeks" },
      { type: "Large Development", time: "10-16 weeks" },
    ],
    contact: { phone: "(720) 865-2730", email: "denverpermits@denvergov.org", website: "https://denvergov.org/development-services" },
    lastUpdated: "January 2026",
  },
  {
    id: "washington-dc",
    name: "Washington",
    state: "DC",
    baseCode: "2017 DC Construction Codes (based on 2015 IBC)",
    amendments: [
      "DC Green Building Act requirements",
      "Historic Preservation Review Board",
      "Comprehensive Plan land use requirements",
      "Inclusionary Zoning requirements",
      "Stormwater Management regulations (DDOE)",
    ],
    submissionReqs: [
      { item: "Architectural Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "DC Green Building compliance", required: true },
      { item: "Zoning Review", required: true },
      { item: "Historic Review (if applicable)", required: false },
      { item: "DOEE Stormwater Plan", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$16 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Certificate of Occupancy", amount: "$150" },
      { type: "Elevator Permit", amount: "$300 per device" },
    ],
    processingTimes: [
      { type: "Residential", time: "4-6 weeks" },
      { type: "Commercial TI", time: "6-10 weeks" },
      { type: "Commercial New", time: "10-14 weeks" },
      { type: "Historic District", time: "Add 4-8 weeks" },
    ],
    contact: { phone: "(202) 442-4400", email: "dob@dc.gov", website: "https://dob.dc.gov" },
    lastUpdated: "January 2026",
  },
  {
    id: "boston",
    name: "Boston",
    state: "MA",
    baseCode: "2015 International Building Code (MA amendments 9th Edition)",
    amendments: [
      "Boston Zoning Code Article 37 (Green Buildings)",
      "BPDA Large Project Review",
      "Boston Landmarks Commission requirements",
      "Coastal Flood Resilience Overlay",
      "Inclusionary Development Policy",
    ],
    submissionReqs: [
      { item: "Architectural Plans", required: true },
      { item: "Structural Plans (PE sealed)", required: true },
      { item: "Energy Code Compliance (Stretch Code)", required: true },
      { item: "BPDA Project Notification Form", required: true },
      { item: "Historic Review", required: false },
      { item: "Environmental Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$18 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Certificate of Occupancy", amount: "$150" },
      { type: "Linkage Fee", amount: "Varies by development" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-4 weeks" },
      { type: "Residential Major", time: "6-10 weeks" },
      { type: "Commercial", time: "8-12 weeks" },
      { type: "Large Project Review", time: "12-20 weeks" },
    ],
    contact: { phone: "(617) 635-5300", email: "isd@boston.gov", website: "https://boston.gov/isd" },
    lastUpdated: "January 2026",
  },
  {
    id: "el-paso",
    name: "El Paso",
    state: "TX",
    baseCode: "2021 International Building Code (Texas amendments)",
    amendments: [
      "El Paso Zoning Code",
      "Desert-adapted landscaping requirements",
      "Border region construction standards",
      "Wind load requirements for high wind zone",
      "Water conservation requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Compliance", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Drainage Study", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$5 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Impact Fee", amount: "Varies by area" },
      { type: "Re-inspection", amount: "$50 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Large Projects", time: "8-12 weeks" },
    ],
    contact: { phone: "(915) 212-0095", email: "development@elpasotexas.gov", website: "https://elpasotexas.gov/development-services" },
    lastUpdated: "January 2026",
  },
  {
    id: "nashville",
    name: "Nashville",
    state: "TN",
    baseCode: "2021 International Building Code (Nashville amendments)",
    amendments: [
      "Nashville Zoning Code updates",
      "Metro Historic Zoning Commission",
      "Design Review for Downtown Code",
      "Stormwater Management Manual",
      "Tree Protection requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Energy Compliance", required: true },
      { item: "Stormwater Management Plan", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.30 per SF" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Fire Review", amount: "$150 base + SF" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "3-5 weeks" },
      { type: "Commercial TI", time: "5-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Express Review", time: "1-2 weeks (add fee)" },
    ],
    contact: { phone: "(615) 862-6590", email: "codes@nashville.gov", website: "https://nashville.gov/codes" },
    lastUpdated: "January 2026",
  },
  {
    id: "detroit",
    name: "Detroit",
    state: "MI",
    baseCode: "2015 Michigan Building Code (based on 2015 IBC)",
    amendments: [
      "Detroit City Code Chapter 9",
      "Historic District Commission requirements",
      "Motor City Match incentives",
      "Detroit Land Bank compliance",
      "Neighborhood Enterprise Zone requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance (MI)", required: true },
      { item: "Historic Review", required: false },
      { item: "Environmental Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$10 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Certificate of Occupancy", amount: "$100" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Priority Review", time: "50% faster (add fee)" },
    ],
    contact: { phone: "(313) 224-2733", email: "bseed@detroitmi.gov", website: "https://detroitmi.gov/bseed" },
    lastUpdated: "January 2026",
  },
  {
    id: "oklahoma-city",
    name: "Oklahoma City",
    state: "OK",
    baseCode: "2021 International Building Code (Oklahoma amendments)",
    amendments: [
      "Oklahoma City Zoning Code",
      "Tornado safe room requirements",
      "MAPS 4 development standards",
      "Historic Preservation Commission",
      "Floodplain Management regulations",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Storm Shelter Plans (schools/daycares)", required: false },
      { item: "Floodplain Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$6 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$50 base + equipment" },
      { type: "Re-inspection", amount: "$50 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "1-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Large Projects", time: "8-12 weeks" },
    ],
    contact: { phone: "(405) 297-2525", email: "devservices@okc.gov", website: "https://okc.gov/development" },
    lastUpdated: "January 2026",
  },
  {
    id: "portland",
    name: "Portland",
    state: "OR",
    baseCode: "2021 Oregon Structural Specialty Code (based on 2021 IBC)",
    amendments: [
      "Portland City Code Title 33 (Zoning)",
      "Inclusionary Housing requirements",
      "Design Commission Review",
      "Portland Clean Energy Fund requirements",
      "Tree Code (Title 11)",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Oregon Energy Code Compliance", required: true },
      { item: "Tree Preservation Plan", required: false },
      { item: "Design Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$14.70 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Land Use Review", amount: "$300-$8,000 depending on type" },
      { type: "System Development Charge", amount: "Varies by use" },
    ],
    processingTimes: [
      { type: "Residential Simple", time: "2-4 weeks" },
      { type: "Residential Complex", time: "6-10 weeks" },
      { type: "Commercial", time: "8-14 weeks" },
      { type: "Design Review", time: "Add 8-16 weeks" },
    ],
    contact: { phone: "(503) 823-7300", email: "bds@portlandoregon.gov", website: "https://portland.gov/bds" },
    lastUpdated: "January 2026",
  },
  {
    id: "las-vegas",
    name: "Las Vegas",
    state: "NV",
    baseCode: "2021 International Building Code (Clark County amendments)",
    amendments: [
      "Clark County Development Code",
      "Water-efficient landscaping requirements",
      "Solar-ready construction",
      "Desert Conservation Program",
      "High-rise fire safety requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Water-efficient Landscape Plan", required: false },
      { item: "Gaming approval (if applicable)", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$6.50 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Pool Permit", amount: "$325 flat fee" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Resort/Casino", time: "10-16 weeks" },
    ],
    contact: { phone: "(702) 455-8000", email: "compdev@clarkcountynv.gov", website: "https://clarkcountynv.gov/building" },
    lastUpdated: "January 2026",
  },
  {
    id: "memphis",
    name: "Memphis",
    state: "TN",
    baseCode: "2021 International Building Code (Memphis amendments)",
    amendments: [
      "Memphis Unified Development Code",
      "Historic Overlay District standards",
      "Floodway Management regulations",
      "Landscape and Screening requirements",
      "Downtown Memphis Design Guidelines",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Energy Compliance", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$7 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Certificate of Occupancy", amount: "$75" },
      { type: "Re-inspection", amount: "$50 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Express Review", time: "50% faster (add fee)" },
    ],
    contact: { phone: "(901) 636-6500", email: "codes@memphistn.gov", website: "https://memphistn.gov/construction-codes" },
    lastUpdated: "January 2026",
  },
  {
    id: "louisville",
    name: "Louisville",
    state: "KY",
    baseCode: "2018 Kentucky Building Code (based on 2015 IBC)",
    amendments: [
      "Louisville Metro Land Development Code",
      "Overlay District requirements",
      "Historic Preservation standards",
      "Floodplain Management",
      "Metro Parks development requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Kentucky Energy Code Compliance", required: true },
      { item: "Historic Review", required: false },
      { item: "Floodplain Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$8 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$50 base" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Large Development", time: "10-14 weeks" },
    ],
    contact: { phone: "(502) 574-3321", email: "permits@louisvilleky.gov", website: "https://louisvilleky.gov/develop-louisville" },
    lastUpdated: "January 2026",
  },
  {
    id: "baltimore",
    name: "Baltimore",
    state: "MD",
    baseCode: "2018 International Building Code (Maryland amendments)",
    amendments: [
      "Baltimore City Zoning Code",
      "CHAP (Commission for Historical and Architectural Preservation)",
      "Chesapeake Bay Critical Area requirements",
      "Inclusionary Housing requirements",
      "Green Building standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (sealed)", required: true },
      { item: "Maryland Energy Code Compliance", required: true },
      { item: "Historic Review (if applicable)", required: false },
      { item: "Stormwater Management", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$11 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Fire Review", amount: "$100 base + SF" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "3-5 weeks" },
      { type: "Commercial TI", time: "5-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Historic District", time: "Add 4-8 weeks" },
    ],
    contact: { phone: "(410) 396-4661", email: "permits@baltimorecity.gov", website: "https://dhcd.baltimorecity.gov" },
    lastUpdated: "January 2026",
  },
  {
    id: "milwaukee",
    name: "Milwaukee",
    state: "WI",
    baseCode: "2017 Wisconsin Commercial Building Code",
    amendments: [
      "Milwaukee Zoning Code",
      "Historic Preservation Commission requirements",
      "City of Milwaukee Green Building Policy",
      "Brownfield Remediation requirements",
      "Tax Incremental Financing (TIF) standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Wisconsin Energy Code Compliance", required: true },
      { item: "Historic Review", required: false },
      { item: "Environmental Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$9 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Certificate of Occupancy", amount: "$100" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Large Development", time: "10-14 weeks" },
    ],
    contact: { phone: "(414) 286-8211", email: "dnspermits@milwaukee.gov", website: "https://city.milwaukee.gov/dns" },
    lastUpdated: "January 2026",
  },
  {
    id: "albuquerque",
    name: "Albuquerque",
    state: "NM",
    baseCode: "2021 International Building Code (New Mexico amendments)",
    amendments: [
      "Integrated Development Ordinance (IDO)",
      "Water Conservation requirements",
      "Solar-ready construction",
      "Historic Zone requirements",
      "View Protection Overlay",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "New Mexico Energy Code Compliance", required: true },
      { item: "Water Conservation Plan", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$5 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$50 base" },
      { type: "Re-inspection", amount: "$50 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Large Projects", time: "8-12 weeks" },
    ],
    contact: { phone: "(505) 924-3600", email: "abqplanning@cabq.gov", website: "https://cabq.gov/planning" },
    lastUpdated: "January 2026",
  },
  {
    id: "tucson",
    name: "Tucson",
    state: "AZ",
    baseCode: "2021 International Building Code (Arizona amendments)",
    amendments: [
      "Tucson Unified Development Code",
      "Rainwater Harvesting requirements",
      "Native Plant Preservation Ordinance",
      "Dark Sky Ordinance (lighting)",
      "Historic Zone Development Standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Rainwater Harvesting Plan", required: false },
      { item: "Native Plant Survey", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$6 per $1,000 valuation" },
      { type: "Plan Review", amount: "60% of permit fee" },
      { type: "Grading Permit", amount: "$200 base" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Express Review", time: "1-2 weeks (add fee)" },
    ],
    contact: { phone: "(520) 791-5550", email: "dsd@tucsonaz.gov", website: "https://tucsonaz.gov/pdsd" },
    lastUpdated: "January 2026",
  },
  {
    id: "fresno",
    name: "Fresno",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "Fresno Municipal Code Chapter 15",
      "San Joaquin Valley Air Quality requirements",
      "Water Conservation Plan requirements",
      "Downtown Fresno specific plan",
      "Cal Green Building Standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Title 24 Energy Compliance", required: true },
      { item: "Air Quality Review", required: false },
      { item: "Water Conservation Plan", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "Based on valuation table" },
      { type: "Plan Check", amount: "65% of permit fee" },
      { type: "SMIP Fee", amount: "$0.13 per $1,000 valuation" },
      { type: "Technology Fee", amount: "3% of permit fee" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-3 weeks" },
      { type: "Residential New", time: "4-6 weeks" },
      { type: "Commercial", time: "6-10 weeks" },
      { type: "Large Projects", time: "10-14 weeks" },
    ],
    contact: { phone: "(559) 621-8277", email: "darm@fresno.gov", website: "https://fresno.gov/darm" },
    lastUpdated: "January 2026",
  },
  {
    id: "sacramento",
    name: "Sacramento",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "Sacramento City Code Chapter 15",
      "Central City Specific Plan",
      "Floodplain Management regulations",
      "Cal Green Building Standards",
      "Historic District Guidelines",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Title 24 Energy Compliance", required: true },
      { item: "Floodplain Review", required: false },
      { item: "Historic Preservation Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "Based on valuation table" },
      { type: "Plan Check", amount: "65% of permit fee" },
      { type: "Strong Motion Fee", amount: "$0.13 per $1,000 valuation" },
      { type: "Technology Fee", amount: "4% of permit fee" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-4 weeks" },
      { type: "Residential New", time: "5-8 weeks" },
      { type: "Commercial", time: "6-12 weeks" },
      { type: "Large Projects", time: "10-16 weeks" },
    ],
    contact: { phone: "(916) 264-5011", email: "cddpermits@cityofsacramento.org", website: "https://cityofsacramento.org/cdd" },
    lastUpdated: "January 2026",
  },
  {
    id: "mesa",
    name: "Mesa",
    state: "AZ",
    baseCode: "2021 International Building Code (Arizona amendments)",
    amendments: [
      "Mesa Zoning Ordinance",
      "Environmentally Sensitive Land Ordinance",
      "Desert Uplands development standards",
      "Water Efficient Landscape requirements",
      "Downtown Mesa design standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Drainage Report", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$5.50 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Pool Permit", amount: "$200 flat fee" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Express Review", time: "1-2 weeks" },
    ],
    contact: { phone: "(480) 644-2211", email: "devservices@mesaaz.gov", website: "https://mesaaz.gov/development" },
    lastUpdated: "January 2026",
  },
  {
    id: "kansas-city",
    name: "Kansas City",
    state: "MO",
    baseCode: "2018 International Building Code (Kansas City amendments)",
    amendments: [
      "Kansas City Zoning & Development Code",
      "Green Building Policy for city projects",
      "Historic Preservation Commission",
      "TIF and CID development requirements",
      "Stormwater Quality regulations",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Historic Review", required: false },
      { item: "Stormwater Plan", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$10 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$75 base" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Large Development", time: "10-14 weeks" },
    ],
    contact: { phone: "(816) 513-1500", email: "devservices@kcmo.org", website: "https://kcmo.gov/city-development" },
    lastUpdated: "January 2026",
  },
  {
    id: "atlanta",
    name: "Atlanta",
    state: "GA",
    baseCode: "2020 Georgia State Minimum Standard Building Code (based on 2018 IBC)",
    amendments: [
      "Atlanta City Code Chapter 8 (Buildings)",
      "BeltLine Overlay District",
      "Inclusionary Zoning requirements",
      "Urban Design Commission Review",
      "Tree Recompense requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (PE sealed)", required: true },
      { item: "Georgia Energy Code Compliance", required: true },
      { item: "Tree Survey", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$12 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Fire Review", amount: "$200 base + SF" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "3-5 weeks" },
      { type: "Commercial TI", time: "5-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Large Development", time: "12-18 weeks" },
    ],
    contact: { phone: "(404) 330-6070", email: "permits@atlantaga.gov", website: "https://atlantaga.gov/government/departments/city-planning" },
    lastUpdated: "January 2026",
  },
  {
    id: "omaha",
    name: "Omaha",
    state: "NE",
    baseCode: "2018 International Building Code (Nebraska amendments)",
    amendments: [
      "Omaha Municipal Code Chapter 40",
      "Downtown Master Plan requirements",
      "Floodplain Management",
      "Historic Preservation Commission",
      "Environmental Quality Control Ordinance",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Nebraska Energy Code Compliance", required: true },
      { item: "Floodplain Review", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$7 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$50 base" },
      { type: "Re-inspection", amount: "$50 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Large Projects", time: "8-12 weeks" },
    ],
    contact: { phone: "(402) 444-5371", email: "permits@cityofomaha.org", website: "https://cityofomaha.org/planning" },
    lastUpdated: "January 2026",
  },
  {
    id: "colorado-springs",
    name: "Colorado Springs",
    state: "CO",
    baseCode: "2021 International Building Code (Pikes Peak Regional amendments)",
    amendments: [
      "City Code Chapter 7 (Buildings)",
      "Hillside Development Overlay",
      "Wildland-Urban Interface Code",
      "Downtown Form-Based Code",
      "Water Resource requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Colorado Energy Code Compliance", required: true },
      { item: "Drainage Report", required: false },
      { item: "Wildfire Mitigation Plan", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$8 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Use Tax", amount: "3.12% of materials" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Large Projects", time: "10-14 weeks" },
    ],
    contact: { phone: "(719) 327-2880", email: "pprbd@elpasoco.com", website: "https://pprbd.org" },
    lastUpdated: "January 2026",
  },
  {
    id: "raleigh",
    name: "Raleigh",
    state: "NC",
    baseCode: "2018 North Carolina State Building Code",
    amendments: [
      "Raleigh Unified Development Ordinance",
      "Downtown Plan requirements",
      "Transit Overlay District",
      "Stormwater Management standards",
      "Historic District Guidelines",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (sealed)", required: true },
      { item: "NC Energy Code Compliance", required: true },
      { item: "Stormwater Management Plan", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$7 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Fire Review", amount: "$150 base + SF" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Express Review", time: "1-2 weeks (add fee)" },
    ],
    contact: { phone: "(919) 996-2495", email: "inspections@raleighnc.gov", website: "https://raleighnc.gov/development" },
    lastUpdated: "January 2026",
  },
  {
    id: "miami",
    name: "Miami",
    state: "FL",
    baseCode: "2023 Florida Building Code (8th Edition)",
    amendments: [
      "Miami 21 Form-Based Zoning Code",
      "High Velocity Hurricane Zone (HVHZ) requirements",
      "Sea Level Rise strategy",
      "Historic Preservation Board",
      "Arts & Entertainment District standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans (signed/sealed)", required: true },
      { item: "Structural Plans (signed/sealed)", required: true },
      { item: "Florida Energy Code Compliance", required: true },
      { item: "HVHZ Product Approvals", required: true },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.25 per SF" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "Impact Fee", amount: "Varies by use" },
      { type: "Re-inspection", amount: "$125 per visit" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-3 weeks" },
      { type: "Residential New", time: "4-6 weeks" },
      { type: "Commercial TI", time: "5-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
    ],
    contact: { phone: "(305) 416-1100", email: "buildinginfo@miamigov.com", website: "https://miamigov.com/building" },
    lastUpdated: "January 2026",
  },
  {
    id: "virginia-beach",
    name: "Virginia Beach",
    state: "VA",
    baseCode: "2018 Virginia Construction Code (based on 2018 IBC)",
    amendments: [
      "City Zoning Ordinance",
      "Chesapeake Bay Preservation requirements",
      "Oceanfront Resort District Form-Based Code",
      "Floodplain Management regulations",
      "Historic & Cultural District standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (PE sealed)", required: true },
      { item: "Virginia Energy Code Compliance", required: true },
      { item: "Chesapeake Bay Review", required: false },
      { item: "Floodplain Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$0.35 per SF" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$75 base" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-4 weeks" },
      { type: "Commercial TI", time: "4-6 weeks" },
      { type: "Commercial New", time: "6-10 weeks" },
      { type: "Large Development", time: "10-14 weeks" },
    ],
    contact: { phone: "(757) 385-4211", email: "permits@vbgov.com", website: "https://vbgov.com/permits" },
    lastUpdated: "January 2026",
  },
  {
    id: "long-beach",
    name: "Long Beach",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "Long Beach Municipal Code Title 18",
      "Coastal Development standards",
      "Downtown Plan requirements",
      "Historic Preservation requirements",
      "Cal Green Building Standards",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Title 24 Energy Compliance", required: true },
      { item: "Coastal Development Permit", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "Based on valuation table" },
      { type: "Plan Check", amount: "65% of permit fee" },
      { type: "Strong Motion Fee", amount: "$0.13 per $1,000 valuation" },
      { type: "Technology Fee", amount: "5% of permit fee" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "2-4 weeks" },
      { type: "Residential New", time: "6-10 weeks" },
      { type: "Commercial", time: "6-12 weeks" },
      { type: "Large Projects", time: "10-16 weeks" },
    ],
    contact: { phone: "(562) 570-6651", email: "lbds@longbeach.gov", website: "https://longbeach.gov/lbds" },
    lastUpdated: "January 2026",
  },
  {
    id: "oakland",
    name: "Oakland",
    state: "CA",
    baseCode: "2022 California Building Code (based on 2021 IBC)",
    amendments: [
      "Oakland Planning Code",
      "Soft Story Retrofit Ordinance",
      "Green Building requirements",
      "Mills Act Historic Preservation",
      "Affordable Housing Impact Fee",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans", required: true },
      { item: "Title 24 Energy Compliance", required: true },
      { item: "Green Building Checklist", required: true },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "Based on valuation table" },
      { type: "Plan Check", amount: "70% of permit fee" },
      { type: "Technology Fee", amount: "5% of permit fee" },
      { type: "Strong Motion Fee", amount: "$0.13 per $1,000 valuation" },
    ],
    processingTimes: [
      { type: "Residential Minor", time: "3-5 weeks" },
      { type: "Residential New", time: "8-12 weeks" },
      { type: "Commercial", time: "8-14 weeks" },
      { type: "Large Projects", time: "12-18 weeks" },
    ],
    contact: { phone: "(510) 238-3891", email: "buildingpermits@oaklandca.gov", website: "https://oaklandca.gov/services/building-permits" },
    lastUpdated: "January 2026",
  },
  {
    id: "minneapolis",
    name: "Minneapolis",
    state: "MN",
    baseCode: "2020 Minnesota State Building Code (based on 2018 IBC)",
    amendments: [
      "Minneapolis 2040 Plan requirements",
      "Green Zone requirements",
      "Historic Preservation Commission",
      "Sustainable Building Policy",
      "Minneapolis Zoning Code",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Minnesota Energy Code Compliance", required: true },
      { item: "Green Zone Compliance", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$14 per $1,000 valuation" },
      { type: "Plan Review", amount: "65% of permit fee" },
      { type: "State Surcharge", amount: "0.5% of permit fee" },
      { type: "Re-inspection", amount: "$100 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "3-5 weeks" },
      { type: "Commercial TI", time: "5-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Express Review", time: "50% faster (add fee)" },
    ],
    contact: { phone: "(612) 673-3000", email: "developmentreview@minneapolismn.gov", website: "https://minneapolismn.gov/development" },
    lastUpdated: "January 2026",
  },
  {
    id: "tulsa",
    name: "Tulsa",
    state: "OK",
    baseCode: "2021 International Building Code (Oklahoma amendments)",
    amendments: [
      "Tulsa Zoning Code",
      "PlaniTulsa comprehensive plan",
      "Historic Preservation Commission",
      "Stormwater Management Manual",
      "Floodplain Management regulations",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Floodplain Review", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$5.50 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$45 base" },
      { type: "Re-inspection", amount: "$45 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "1-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Large Projects", time: "8-12 weeks" },
    ],
    contact: { phone: "(918) 596-9601", email: "permits@cityoftulsa.org", website: "https://cityoftulsa.org/permits" },
    lastUpdated: "January 2026",
  },
  {
    id: "wichita",
    name: "Wichita",
    state: "KS",
    baseCode: "2018 International Building Code (Kansas amendments)",
    amendments: [
      "Wichita-Sedgwick County Unified Zoning Code",
      "Historic Preservation Commission",
      "Downtown Development standards",
      "Floodplain Management regulations",
      "Design Review District requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Kansas Energy Code Compliance", required: true },
      { item: "Floodplain Review", required: false },
      { item: "Historic Review", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$5 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Mechanical Permit", amount: "$40 base" },
      { type: "Re-inspection", amount: "$50 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "1-2 weeks" },
      { type: "Commercial TI", time: "2-4 weeks" },
      { type: "Commercial New", time: "4-6 weeks" },
      { type: "Large Projects", time: "6-10 weeks" },
    ],
    contact: { phone: "(316) 268-4471", email: "codes@wichita.gov", website: "https://wichita.gov/metro-area-building-development" },
    lastUpdated: "January 2026",
  },
  {
    id: "new-orleans",
    name: "New Orleans",
    state: "LA",
    baseCode: "2021 Louisiana State Uniform Construction Code",
    amendments: [
      "Comprehensive Zoning Ordinance (CZO)",
      "Historic District Landmarks Commission",
      "Floodplain Management regulations",
      "French Quarter Design Guidelines",
      "Resilient Building requirements",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Plans (PE sealed)", required: true },
      { item: "Louisiana Energy Code Compliance", required: true },
      { item: "Historic Review", required: false },
      { item: "Floodplain Compliance", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$10 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Certificate of Occupancy", amount: "$100" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "3-5 weeks" },
      { type: "Commercial TI", time: "5-8 weeks" },
      { type: "Commercial New", time: "8-12 weeks" },
      { type: "Historic District", time: "Add 4-8 weeks" },
    ],
    contact: { phone: "(504) 658-7100", email: "permits@nola.gov", website: "https://nola.gov/safety-and-permits" },
    lastUpdated: "January 2026",
  },
  {
    id: "arlington",
    name: "Arlington",
    state: "TX",
    baseCode: "2021 International Building Code (Texas amendments)",
    amendments: [
      "Arlington Unified Development Code",
      "Entertainment District requirements",
      "Downtown Arlington Master Plan",
      "Stormwater Management regulations",
      "Sustainability guidelines",
    ],
    submissionReqs: [
      { item: "Site Plan", required: true },
      { item: "Building Plans", required: true },
      { item: "Structural Calculations", required: true },
      { item: "Energy Code Compliance", required: true },
      { item: "Landscape Plan", required: false },
      { item: "Traffic Impact Analysis", required: false },
    ],
    fees: [
      { type: "Building Permit", amount: "$6 per $1,000 valuation" },
      { type: "Plan Review", amount: "50% of permit fee" },
      { type: "Impact Fee", amount: "Varies by area" },
      { type: "Re-inspection", amount: "$75 per visit" },
    ],
    processingTimes: [
      { type: "Residential", time: "2-3 weeks" },
      { type: "Commercial TI", time: "3-5 weeks" },
      { type: "Commercial New", time: "5-8 weeks" },
      { type: "Large Projects", time: "8-12 weeks" },
    ],
    contact: { phone: "(817) 459-6777", email: "permits@arlingtontx.gov", website: "https://arlingtontx.gov/development" },
    lastUpdated: "January 2026",
  },
];

export function JurisdictionLookupDemo() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionData | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareWith, setCompareWith] = useState<JurisdictionData | null>(null);
  const [activeTab, setActiveTab] = useState("amendments");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [selectedState, setSelectedState] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [mapboxToken, setMapboxToken] = useState<string>(() => {
    return localStorage.getItem("mapbox_token") || "";
  });
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState<string | null>(null);
  const [linkValidation, setLinkValidation] = useState<Record<string, { status: 'valid' | 'invalid' | 'checking' | 'unknown'; statusCode?: number }>>({});
  const [isValidatingLinks, setIsValidatingLinks] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem("jurisdiction_favorites");
    return saved ? JSON.parse(saved) : [];
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Fetch user subscriptions
  useEffect(() => {
    if (user) {
      fetchSubscriptions();
    } else {
      setSubscriptions([]);
    }
  }, [user]);

  const fetchSubscriptions = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from("jurisdiction_subscriptions")
        .select("jurisdiction_id")
        .eq("user_id", user.id);

      if (error) throw error;
      setSubscriptions(data?.map((s) => s.jurisdiction_id) || []);
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
    }
  };

  const toggleSubscription = async (jurisdiction: JurisdictionData) => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to subscribe to jurisdiction updates.",
        variant: "destructive",
      });
      return;
    }

    setSubscriptionLoading(jurisdiction.id);
    const isSubscribed = subscriptions.includes(jurisdiction.id);

    try {
      if (isSubscribed) {
        // Unsubscribe
        const { error } = await supabase
          .from("jurisdiction_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq("jurisdiction_id", jurisdiction.id);

        if (error) throw error;

        setSubscriptions((prev) => prev.filter((id) => id !== jurisdiction.id));
        toast({
          title: "Unsubscribed",
          description: `You will no longer receive updates for ${jurisdiction.name}.`,
        });
      } else {
        // Subscribe
        const { error } = await supabase
          .from("jurisdiction_subscriptions")
          .insert({
            user_id: user.id,
            jurisdiction_id: jurisdiction.id,
            jurisdiction_name: jurisdiction.name,
            jurisdiction_state: jurisdiction.state,
          });

        if (error) throw error;

        setSubscriptions((prev) => [...prev, jurisdiction.id]);
        toast({
          title: "Subscribed!",
          description: `You'll be notified when ${jurisdiction.name} updates their building codes.`,
        });
      }
    } catch (error) {
      console.error("Error toggling subscription:", error);
      toast({
        title: "Error",
        description: "Failed to update subscription. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubscriptionLoading(null);
    }
  };

  // Validate a single URL
  const validateUrl = async (jurisdictionId: string, url: string) => {
    setLinkValidation((prev) => ({
      ...prev,
      [jurisdictionId]: { status: 'checking' },
    }));

    try {
      const { data, error } = await supabase.functions.invoke('validate-url', {
        body: { url },
      });

      if (error) throw error;

      setLinkValidation((prev) => ({
        ...prev,
        [jurisdictionId]: {
          status: data.accessible ? 'valid' : 'invalid',
          statusCode: data.status,
        },
      }));

      return data.accessible;
    } catch (error) {
      console.error('Error validating URL:', error);
      setLinkValidation((prev) => ({
        ...prev,
        [jurisdictionId]: { status: 'invalid' },
      }));
      return false;
    }
  };

  // Validate all jurisdiction links
  const validateAllLinks = async () => {
    setIsValidatingLinks(true);
    let validCount = 0;
    let invalidCount = 0;

    // Validate in batches of 5 to avoid overwhelming the server
    const batchSize = 5;
    for (let i = 0; i < jurisdictions.length; i += batchSize) {
      const batch = jurisdictions.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((j) => validateUrl(j.id, j.contact.website))
      );
      results.forEach((isValid) => {
        if (isValid) validCount++;
        else invalidCount++;
      });
    }

    setIsValidatingLinks(false);
    toast({
      title: "Link Validation Complete",
      description: `${validCount} valid, ${invalidCount} invalid out of ${jurisdictions.length} total links.`,
    });
  };

  // Get unique states from jurisdictions
  const availableStates = useMemo(() => {
    const states = [...new Set(jurisdictions.map((j) => j.state))].sort();
    return states;
  }, []);

  // Get states for selected region
  const statesInSelectedRegion = useMemo(() => {
    if (selectedRegion === "all") return availableStates;
    return availableStates.filter((state) => regions[selectedRegion]?.includes(state));
  }, [selectedRegion, availableStates]);

  // Toggle favorite
  const toggleFavorite = (jurisdictionId: string) => {
    setFavorites((prev) => {
      const newFavorites = prev.includes(jurisdictionId)
        ? prev.filter((id) => id !== jurisdictionId)
        : [...prev, jurisdictionId];
      localStorage.setItem("jurisdiction_favorites", JSON.stringify(newFavorites));
      return newFavorites;
    });
  };

  const filteredJurisdictions = useMemo(() => {
    return jurisdictions.filter((j) => {
      // Favorites filter
      if (showFavoritesOnly && !favorites.includes(j.id)) {
        return false;
      }

      // Search filter
      const matchesSearch =
        j.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.state.toLowerCase().includes(searchQuery.toLowerCase());

      // Region filter
      const matchesRegion =
        selectedRegion === "all" || regions[selectedRegion]?.includes(j.state);

      // State filter
      const matchesState = selectedState === "all" || j.state === selectedState;

      return matchesSearch && matchesRegion && matchesState;
    });
  }, [searchQuery, selectedRegion, selectedState, showFavoritesOnly, favorites]);

  // Initialize map
  useEffect(() => {
    if (viewMode !== "map" || !mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;
    
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [-98.5795, 39.8283], // Center of US
        zoom: 3.5,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.current.on("load", () => {
        updateMarkers();
      });

      return () => {
        markersRef.current.forEach((marker) => marker.remove());
        markersRef.current = [];
        map.current?.remove();
      };
    } catch (error) {
      console.error("Error initializing map:", error);
    }
  }, [viewMode, mapboxToken]);

  // Update markers when filtered jurisdictions change
  useEffect(() => {
    if (map.current && viewMode === "map") {
      updateMarkers();
    }
  }, [filteredJurisdictions, viewMode]);

  const updateMarkers = () => {
    // Remove existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (!map.current) return;

    // Add new markers
    filteredJurisdictions.forEach((j) => {
      const coords = cityCoordinates[j.id];
      if (!coords) return;

      // Create custom marker element
      const el = document.createElement("div");
      el.className = "jurisdiction-marker";
      el.style.cssText = `
        width: 24px;
        height: 24px;
        background: hsl(var(--accent));
        border: 2px solid white;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        transition: transform 0.2s;
      `;
      el.addEventListener("mouseenter", () => {
        el.style.transform = "scale(1.2)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "scale(1)";
      });

      // Create popup
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="padding: 8px; min-width: 180px;">
          <h4 style="margin: 0 0 4px 0; font-weight: 600; color: #333;">${j.name}, ${j.state}</h4>
          <p style="margin: 0; font-size: 12px; color: #666;">Updated: ${j.lastUpdated}</p>
          <p style="margin: 4px 0 0 0; font-size: 11px; color: #888;">${j.amendments.length} local amendments</p>
        </div>
      `);

      const marker = new mapboxgl.Marker(el)
        .setLngLat(coords)
        .setPopup(popup)
        .addTo(map.current!);

      el.addEventListener("click", () => {
        setSelectedJurisdiction(j);
      });

      markersRef.current.push(marker);
    });
  };

  const saveMapboxToken = (token: string) => {
    localStorage.setItem("mapbox_token", token);
    setMapboxToken(token);
    setShowTokenInput(false);
  };

  const exportToPDF = (jurisdiction: JurisdictionData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let yPos = 20;

    // Helper function to add text with word wrap
    const addWrappedText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number = 6): number => {
      const lines = doc.splitTextToSize(text, maxWidth);
      doc.text(lines, x, y);
      return y + lines.length * lineHeight;
    };

    // Helper function to check and add new page if needed
    const checkNewPage = (requiredSpace: number = 30): void => {
      if (yPos > 270 - requiredSpace) {
        doc.addPage();
        yPos = 20;
      }
    };

    // Title
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(`${jurisdiction.name}, ${jurisdiction.state}`, margin, yPos);
    yPos += 10;

    // Subtitle - Base Code
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    yPos = addWrappedText(jurisdiction.baseCode, margin, yPos, contentWidth);
    yPos += 5;

    // Report date
    doc.setFontSize(8);
    doc.text(`Report Generated: ${new Date().toLocaleDateString()}`, margin, yPos);
    doc.text(`Last Updated: ${jurisdiction.lastUpdated}`, margin + 80, yPos);
    yPos += 15;

    doc.setTextColor(0);

    // Section: Local Amendments
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Local Amendments", margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    jurisdiction.amendments.forEach((amendment) => {
      checkNewPage(15);
      doc.text("•", margin, yPos);
      yPos = addWrappedText(amendment, margin + 5, yPos, contentWidth - 5);
      yPos += 2;
    });
    yPos += 10;

    // Section: Submission Requirements
    checkNewPage(40);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Submission Requirements", margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    jurisdiction.submissionReqs.forEach((req) => {
      checkNewPage(12);
      const status = req.required ? "[Required]" : "[If Applicable]";
      doc.text("•", margin, yPos);
      doc.text(`${req.item} ${status}`, margin + 5, yPos);
      yPos += 6;
    });
    yPos += 10;

    // Section: Fee Schedule
    checkNewPage(40);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Fee Schedule", margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    jurisdiction.fees.forEach((fee) => {
      checkNewPage(12);
      doc.text(`${fee.type}:`, margin, yPos);
      doc.text(fee.amount, margin + 80, yPos);
      yPos += 6;
    });
    yPos += 10;

    // Section: Processing Times
    checkNewPage(40);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Processing Times", margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    jurisdiction.processingTimes.forEach((time) => {
      checkNewPage(12);
      doc.text(`${time.type}:`, margin, yPos);
      doc.text(time.time, margin + 80, yPos);
      yPos += 6;
    });
    yPos += 10;

    // Section: Contact Information
    checkNewPage(30);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Contact Information", margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Phone: ${jurisdiction.contact.phone}`, margin, yPos);
    yPos += 6;
    doc.text(`Email: ${jurisdiction.contact.email}`, margin, yPos);
    yPos += 6;
    doc.text(`Website: ${jurisdiction.contact.website}`, margin, yPos);
    yPos += 15;

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("This report is for informational purposes only. Always verify requirements with the jurisdiction.", margin, 285);

    // Save the PDF
    doc.save(`${jurisdiction.name.replace(/\s+/g, "_")}_Requirements.pdf`);
  };

  const exportComparisonToPDF = (j1: JurisdictionData, j2: JurisdictionData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const colWidth = (pageWidth - margin * 3) / 2;
    let yPos = 20;

    // Helper function to check and add new page if needed
    const checkNewPage = (requiredSpace: number = 30): void => {
      if (yPos > 270 - requiredSpace) {
        doc.addPage();
        yPos = 20;
      }
    };

    // Title
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Jurisdiction Comparison Report", margin, yPos);
    yPos += 10;

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`${j1.name}, ${j1.state}  vs  ${j2.name}, ${j2.state}`, margin, yPos);
    yPos += 8;

    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Report Generated: ${new Date().toLocaleDateString()}`, margin, yPos);
    yPos += 15;
    doc.setTextColor(0);

    // Column headers
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(j1.name, margin, yPos);
    doc.text(j2.name, margin + colWidth + margin, yPos);
    yPos += 8;

    // Base Codes
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Base Code:", margin, yPos);
    doc.text("Base Code:", margin + colWidth + margin, yPos);
    yPos += 5;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const baseCode1Lines = doc.splitTextToSize(j1.baseCode, colWidth);
    const baseCode2Lines = doc.splitTextToSize(j2.baseCode, colWidth);
    doc.text(baseCode1Lines, margin, yPos);
    doc.text(baseCode2Lines, margin + colWidth + margin, yPos);
    yPos += Math.max(baseCode1Lines.length, baseCode2Lines.length) * 5 + 10;

    // Amendments count
    checkNewPage(20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Local Amendments: ${j1.amendments.length}`, margin, yPos);
    doc.text(`Local Amendments: ${j2.amendments.length}`, margin + colWidth + margin, yPos);
    yPos += 15;

    // Processing Times
    checkNewPage(50);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Processing Times", margin, yPos);
    yPos += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const maxTimes = Math.max(j1.processingTimes.length, j2.processingTimes.length);
    for (let i = 0; i < maxTimes; i++) {
      checkNewPage(10);
      if (j1.processingTimes[i]) {
        doc.text(`${j1.processingTimes[i].type}: ${j1.processingTimes[i].time}`, margin, yPos);
      }
      if (j2.processingTimes[i]) {
        doc.text(`${j2.processingTimes[i].type}: ${j2.processingTimes[i].time}`, margin + colWidth + margin, yPos);
      }
      yPos += 6;
    }
    yPos += 10;

    // Fees
    checkNewPage(50);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Fee Schedule", margin, yPos);
    yPos += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const maxFees = Math.max(j1.fees.length, j2.fees.length);
    for (let i = 0; i < maxFees; i++) {
      checkNewPage(10);
      if (j1.fees[i]) {
        doc.text(`${j1.fees[i].type}: ${j1.fees[i].amount}`, margin, yPos);
      }
      if (j2.fees[i]) {
        doc.text(`${j2.fees[i].type}: ${j2.fees[i].amount}`, margin + colWidth + margin, yPos);
      }
      yPos += 6;
    }
    yPos += 10;

    // Contact Information
    checkNewPage(30);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Contact Information", margin, yPos);
    yPos += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Phone: ${j1.contact.phone}`, margin, yPos);
    doc.text(`Phone: ${j2.contact.phone}`, margin + colWidth + margin, yPos);
    yPos += 6;
    doc.text(`Email: ${j1.contact.email}`, margin, yPos);
    doc.text(`Email: ${j2.contact.email}`, margin + colWidth + margin, yPos);
    yPos += 15;

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("This report is for informational purposes only. Always verify requirements with the jurisdiction.", margin, 285);

    // Save the PDF
    doc.save(`Comparison_${j1.name.replace(/\s+/g, "_")}_vs_${j2.name.replace(/\s+/g, "_")}.pdf`);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Left Panel - Search & List */}
      <div className="space-y-4">
        <Card className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by city or state..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex gap-2">
            <Select
              value={selectedRegion}
              onValueChange={(value) => {
                setSelectedRegion(value);
                setSelectedState("all"); // Reset state when region changes
              }}
            >
              <SelectTrigger className="flex-1 bg-background">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50">
                <SelectItem value="all">All Regions</SelectItem>
                {Object.keys(regions).map((region) => (
                  <SelectItem key={region} value={region}>
                    {region}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedState}
              onValueChange={setSelectedState}
            >
              <SelectTrigger className="flex-1 bg-background">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50 max-h-[300px]">
                <SelectItem value="all">All States</SelectItem>
                {statesInSelectedRegion.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(selectedRegion !== "all" || selectedState !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                setSelectedRegion("all");
                setSelectedState("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </Card>

        {/* Favorites Toggle */}
        <Button
          variant={showFavoritesOnly ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
        >
          <Star className={cn("h-4 w-4 mr-2", showFavoritesOnly && "fill-current")} />
          {showFavoritesOnly ? `Favorites (${favorites.length})` : "Show Favorites"}
        </Button>

        {/* View Toggle */}
        <div className="flex gap-2">
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4 mr-2" />
            List
          </Button>
          <Button
            variant={viewMode === "map" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => {
              if (!mapboxToken) {
                setShowTokenInput(true);
              } else {
                setViewMode("map");
              }
            }}
          >
            <Map className="h-4 w-4 mr-2" />
            Map
          </Button>
        </div>

        {/* Token Input Modal */}
        {showTokenInput && (
          <Card className="p-4 space-y-3 border-accent">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Mapbox Access Token</p>
              <Button variant="ghost" size="sm" onClick={() => setShowTokenInput(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your free public token from{" "}
              <a href="https://mapbox.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                mapbox.com
              </a>{" "}
              → Account → Tokens
            </p>
            <Input
              placeholder="pk.eyJ1Ijo..."
              value={mapboxToken}
              onChange={(e) => setMapboxToken(e.target.value)}
            />
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                if (mapboxToken) {
                  saveMapboxToken(mapboxToken);
                  setViewMode("map");
                }
              }}
              disabled={!mapboxToken}
            >
              Save & View Map
            </Button>
          </Card>
        )}

        {/* List View */}
        {viewMode === "list" && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Jurisdictions</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={validateAllLinks}
                    disabled={isValidatingLinks}
                  >
                    {isValidatingLinks ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4 mr-2" />
                    )}
                    {isValidatingLinks ? "Validating..." : "Validate Links"}
                  </Button>
                  <Badge variant="secondary">
                    {filteredJurisdictions.length} of {jurisdictions.length}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {filteredJurisdictions.map((j) => {
                    const validation = linkValidation[j.id];
                    return (
                      <button
                        key={j.id}
                        className={cn(
                          "w-full p-3 rounded-lg border text-left transition-all hover:shadow-md",
                          selectedJurisdiction?.id === j.id ? "border-accent bg-accent/5" : "hover:bg-secondary/30"
                        )}
                        onClick={() => {
                          setSelectedJurisdiction(j);
                          if (compareMode && !compareWith) {
                            setCompareWith(j);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <MapPin className="h-5 w-5 text-accent" />
                            <div>
                              <p className="font-medium">{j.name}, {j.state}</p>
                              <p className="text-xs text-muted-foreground">Updated {j.lastUpdated}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {validation && (
                              <div className="flex items-center gap-1">
                                {validation.status === 'checking' && (
                                  <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                                )}
                                {validation.status === 'valid' && (
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                )}
                                {validation.status === 'invalid' && (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                              </div>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(j.id);
                              }}
                              className="p-1 rounded hover:bg-secondary/50 transition-colors"
                              aria-label={favorites.includes(j.id) ? "Remove from favorites" : "Add to favorites"}
                            >
                              <Star 
                                className={cn(
                                  "h-4 w-4 transition-colors",
                                  favorites.includes(j.id) 
                                    ? "text-yellow-500 fill-yellow-500" 
                                    : "text-muted-foreground hover:text-yellow-500"
                                )} 
                              />
                            </button>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Map View */}
        {viewMode === "map" && mapboxToken && (
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Map View</CardTitle>
                <Badge variant="secondary">
                  {filteredJurisdictions.length} locations
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={mapContainer} className="h-[400px] w-full" />
            </CardContent>
          </Card>
        )}

        <Button
          variant={compareMode ? "default" : "outline"}
          className={cn("w-full", compareMode && "bg-accent hover:bg-accent/90")}
          onClick={() => {
            setCompareMode(!compareMode);
            setCompareWith(null);
          }}
        >
          <ArrowLeftRight className="h-4 w-4 mr-2" />
          {compareMode ? "Exit Compare Mode" : "Compare Jurisdictions"}
        </Button>
      </div>

      {/* Right Panel - Details */}
      <div className="lg:col-span-2">
        {!selectedJurisdiction ? (
          <Card className="h-full flex items-center justify-center text-center p-12">
            <div>
              <MapPin className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Select a Jurisdiction</h3>
              <p className="text-muted-foreground">Choose from the list to view requirements</p>
            </div>
          </Card>
        ) : compareMode && compareWith && selectedJurisdiction.id !== compareWith.id ? (
          // Compare View
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Comparison</CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    <Badge>{selectedJurisdiction.name}</Badge>
                    <span className="text-muted-foreground">vs</span>
                    <Badge variant="outline">{compareWith.name}</Badge>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => exportComparisonToPDF(selectedJurisdiction, compareWith)}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {/* Base Code */}
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs text-muted-foreground mb-1">Base Code</p>
                  <p className="text-sm font-medium">{selectedJurisdiction.baseCode}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs text-muted-foreground mb-1">Base Code</p>
                  <p className="text-sm font-medium">{compareWith.baseCode}</p>
                </div>

                {/* Processing Times */}
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs text-muted-foreground mb-2">Processing Times</p>
                  {selectedJurisdiction.processingTimes.slice(0, 3).map((t) => (
                    <div key={t.type} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t.type}</span>
                      <span className="font-medium">{t.time}</span>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs text-muted-foreground mb-2">Processing Times</p>
                  {compareWith.processingTimes.slice(0, 3).map((t) => (
                    <div key={t.type} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t.type}</span>
                      <span className="font-medium">{t.time}</span>
                    </div>
                  ))}
                </div>

                {/* Amendments Count */}
                <div className="p-3 rounded-lg bg-secondary/30 text-center">
                  <p className="text-3xl font-bold text-accent">{selectedJurisdiction.amendments.length}</p>
                  <p className="text-xs text-muted-foreground">Local Amendments</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 text-center">
                  <p className="text-3xl font-bold text-accent">{compareWith.amendments.length}</p>
                  <p className="text-xs text-muted-foreground">Local Amendments</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          // Single Jurisdiction View
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-accent" />
                    {selectedJurisdiction.name}, {selectedJurisdiction.state}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{selectedJurisdiction.baseCode}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleFavorite(selectedJurisdiction.id)}
                    className={cn(
                      favorites.includes(selectedJurisdiction.id) && "border-yellow-500"
                    )}
                  >
                    <Star 
                      className={cn(
                        "h-4 w-4 mr-2",
                        favorites.includes(selectedJurisdiction.id) 
                          ? "text-yellow-500 fill-yellow-500" 
                          : ""
                      )} 
                    />
                    {favorites.includes(selectedJurisdiction.id) ? "Favorited" : "Favorite"}
                  </Button>
                  <Button 
                    variant={subscriptions.includes(selectedJurisdiction.id) ? "default" : "outline"} 
                    size="sm"
                    onClick={() => toggleSubscription(selectedJurisdiction)}
                    disabled={subscriptionLoading === selectedJurisdiction.id}
                  >
                    {subscriptionLoading === selectedJurisdiction.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : subscriptions.includes(selectedJurisdiction.id) ? (
                      <BellOff className="h-4 w-4 mr-2" />
                    ) : (
                      <Bell className="h-4 w-4 mr-2" />
                    )}
                    {subscriptions.includes(selectedJurisdiction.id) ? "Unsubscribe" : "Subscribe"}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => exportToPDF(selectedJurisdiction)}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="amendments">Amendments</TabsTrigger>
                  <TabsTrigger value="requirements">Requirements</TabsTrigger>
                  <TabsTrigger value="fees">Fees</TabsTrigger>
                  <TabsTrigger value="times">Times</TabsTrigger>
                </TabsList>

                <TabsContent value="amendments" className="mt-4">
                  <div className="space-y-2">
                    {selectedJurisdiction.amendments.map((amendment, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30">
                        <Check className="h-4 w-4 text-accent mt-0.5" />
                        <span className="text-sm">{amendment}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="requirements" className="mt-4">
                  <div className="space-y-2">
                    {selectedJurisdiction.submissionReqs.map((req, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                        <div className="flex items-center gap-3">
                          <FileCheck className={cn("h-4 w-4", req.required ? "text-accent" : "text-muted-foreground")} />
                          <span className="text-sm">{req.item}</span>
                        </div>
                        <Badge variant={req.required ? "default" : "secondary"}>
                          {req.required ? "Required" : "If Applicable"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="fees" className="mt-4">
                  <div className="space-y-2">
                    {selectedJurisdiction.fees.map((fee, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                        <div className="flex items-center gap-3">
                          <DollarSign className="h-4 w-4 text-accent" />
                          <span className="text-sm">{fee.type}</span>
                        </div>
                        <span className="font-medium text-sm">{fee.amount}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="times" className="mt-4">
                  <div className="space-y-2">
                    {selectedJurisdiction.processingTimes.map((time, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                        <div className="flex items-center gap-3">
                          <Clock className="h-4 w-4 text-accent" />
                          <span className="text-sm">{time.type}</span>
                        </div>
                        <span className="font-medium text-sm">{time.time}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>

              {/* Contact Info */}
              <div className="mt-6 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Contact Information</p>
                  {linkValidation[selectedJurisdiction.id]?.status && (
                    <Badge 
                      variant={linkValidation[selectedJurisdiction.id].status === 'valid' ? 'default' : 
                               linkValidation[selectedJurisdiction.id].status === 'invalid' ? 'destructive' : 'secondary'}
                      className="text-xs"
                    >
                      {linkValidation[selectedJurisdiction.id].status === 'valid' && 'Link Verified'}
                      {linkValidation[selectedJurisdiction.id].status === 'invalid' && 'Link Issue Detected'}
                      {linkValidation[selectedJurisdiction.id].status === 'checking' && 'Checking...'}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 text-sm items-center">
                  <span className="text-muted-foreground">{selectedJurisdiction.contact.phone}</span>
                  <span className="text-muted-foreground">{selectedJurisdiction.contact.email}</span>
                  <div className="flex items-center gap-2">
                    <a 
                      href={selectedJurisdiction.contact.website} 
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-1 hover:underline",
                        linkValidation[selectedJurisdiction.id]?.status === 'invalid' 
                          ? "text-destructive" 
                          : "text-accent"
                      )}
                    >
                      Official Website <ExternalLink className="h-3 w-3" />
                    </a>
                    {linkValidation[selectedJurisdiction.id]?.status === 'valid' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                    {linkValidation[selectedJurisdiction.id]?.status === 'invalid' && (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    {linkValidation[selectedJurisdiction.id]?.status === 'checking' && (
                      <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                    )}
                    {!linkValidation[selectedJurisdiction.id] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => validateUrl(selectedJurisdiction.id, selectedJurisdiction.contact.website)}
                      >
                        <Link2 className="h-3 w-3 mr-1" />
                        Test
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
