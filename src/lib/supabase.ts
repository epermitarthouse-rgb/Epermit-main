import { createClient } from '@supabase/supabase-js';

// SINGLE SOURCE OF TRUTH
// Hardcoded for immediate Vercel deployment stability
const SUPABASE_URL = "https://eeqxyjrcldivtpikcpvk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlcXh5anJjbGRpdnRwaWtjcHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NzM3ODAsImV4cCI6MjA4NDE0OTc4MH0.yPtoSOuQGB5UU-fLbcy1Lp8dNF2IHOeQas9kushTrV0";

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase Keys Missing!");

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
