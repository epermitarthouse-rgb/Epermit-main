import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, ChevronLeft, ChevronRight, Volume2, VolumeX, Loader2, User, Headphones, Gauge, Sliders } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { AudioWaveform } from './AudioWaveform';
import { TTSHealthcheck } from './TTSHealthcheck';

import demoDashboard from '@/assets/videos/demo-dashboard.mp4';
import demoSubmission from '@/assets/videos/demo-submission.mp4';
import demoJurisdiction from '@/assets/videos/demo-jurisdiction.mp4';
import demoDocuments from '@/assets/videos/demo-documents.mp4';
import demoAnalytics from '@/assets/videos/demo-analytics.mp4';
import demoCollaboration from '@/assets/videos/demo-collaboration.mp4';
import demoPortalIntake from '@/assets/videos/demo-portal-intake.mp4';
import demoMultiFiling from '@/assets/videos/demo-multi-filing.mp4';
import demoResponseMatrix from '@/assets/videos/demo-response-matrix.mp4';

interface Voice {
  id: string;
  name: string;
  description: string;
  previewText: string;
}

const availableVoices: Voice[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Professional male', previewText: "Hi, I'm George. I'll guide you through PermitPulse with a professional tone." },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Warm female', previewText: "Hello! I'm Sarah, and I bring warmth and clarity to every explanation." },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Authoritative male', previewText: "Greetings, I'm Roger. Let me walk you through with authority and confidence." },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Friendly female', previewText: "Hey there! I'm Laura, here to make learning PermitPulse fun and friendly." },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Casual male', previewText: "What's up! I'm Charlie, keeping things casual and easy to follow." },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Young male', previewText: "Hey! I'm Liam, bringing fresh energy to your permit management journey." },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Clear female', previewText: "Hello, I'm Alice. I speak clearly so you never miss important details." },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Expressive female', previewText: "Hi there! I'm Matilda, and I love adding expression to every feature." },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep male', previewText: "Hello. I'm Daniel, providing a deep and reassuring voice for your tour." },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Soft female', previewText: "Hi, I'm Lily. My soft voice makes complex permits feel simple." },
];

interface VideoSegment {
  src: string;
  title: string;
  description: string;
  narration: string;
}

const videoSegments: VideoSegment[] = [
  {
    src: demoDashboard,
    title: 'Multi-Municipality Permit Tracking',
    description: 'Track permits across 10 DMV jurisdictions with municipality badges, workflow-aligned navigation, and real-time agent status.',
    narration: 'Welcome to Insight DesignCheck. Your centralized dashboard tracks permits across 10 DMV jurisdictions. See municipality badges, agent pipeline status, and deadline alerts — all organized by your workflow.',
  },
  {
    src: demoPortalIntake,
    title: 'Portal Harvest & Data Scraping',
    description: 'Automatically scrape permit data, review comments, and project status from Accela, Momentum, EnerGov, and ASP.NET portals.',
    narration: 'Our Portal Harvest engine scrapes permit data from four different portal platforms — Accela, Momentum, EnerGov, and A S P dot NET. Review comments, project status, and attachments are extracted and organized automatically.',
  },
  {
    src: demoMultiFiling,
    title: 'Autonomous Multi-Municipality Filing',
    description: 'A 9-agent AI pipeline autonomously files permits across DC, Virginia, and Maryland jurisdictions on Accela, Momentum, EnerGov, and ASP.NET portals.',
    narration: 'Our 9-agent pipeline autonomously files permits across 10 DMV jurisdictions. From property intelligence and license validation through form filing and submission — the system handles Accela, Momentum, EnerGov, and A S P dot NET portals with a mandatory human review gate.',
  },
  {
    src: demoResponseMatrix,
    title: 'AI-Powered Response Matrix',
    description: 'Auto-draft responses to plan review comments with code references, quality scoring, plan markup, and branded export packages.',
    narration: 'The Response Matrix auto-drafts responses to plan review comments using AI with building code references. Quality scoring ensures accuracy, plan markup links responses to drawings, and branded export creates professional response packages.',
  },
  {
    src: demoJurisdiction,
    title: 'Jurisdiction Intelligence',
    description: 'Access detailed requirements, fees, and timelines for any jurisdiction.',
    narration: 'Access jurisdiction intelligence instantly. Get detailed permit requirements, fee schedules, and expected timelines for any jurisdiction across the country.',
  },
  {
    src: demoDocuments,
    title: 'Smart Document Management',
    description: 'Organize, version, and search all your permit documents effortlessly.',
    narration: 'Keep all your documents organized with smart document management. Version control, instant search, and automatic categorization save you hours of work.',
  },
  {
    src: demoAnalytics,
    title: 'Powerful Analytics',
    description: 'Gain insights with real-time charts and performance metrics.',
    narration: 'Powerful analytics give you actionable insights. Track cycle times, monitor approval rates, and identify bottlenecks with real-time performance metrics.',
  },
  {
    src: demoCollaboration,
    title: 'Seamless Collaboration',
    description: 'Work together with your team in real-time on shared projects.',
    narration: 'Collaborate seamlessly with your entire team. Share projects, assign tasks, and stay in sync with real-time updates and notifications.',
  },
];

const VOICE_STORAGE_KEY = 'permitpulse-preferred-voice';
const SPEED_STORAGE_KEY = 'permitpulse-playback-speed';
const CALIBRATION_STORAGE_KEY = 'permitpulse-voice-calibration';

const playbackSpeeds = [0.75, 1, 1.25, 1.5] as const;
type PlaybackSpeed = typeof playbackSpeeds[number];

interface VoiceCalibration {
  stability: number;
  similarity_boost: number;
  style: number;
}

type CalibrationPreset = 'clean' | 'neutral' | 'expressive';

const calibrationPresets: Record<CalibrationPreset, { label: string; description: string; settings: VoiceCalibration }> = {
  clean: {
    label: 'Clean',
    description: 'Clear & consistent',
    settings: { stability: 0.9, similarity_boost: 0.8, style: 0.0 },
  },
  neutral: {
    label: 'Neutral',
    description: 'Balanced delivery',
    settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3 },
  },
  expressive: {
    label: 'Expressive',
    description: 'Dynamic & emotive',
    settings: { stability: 0.35, similarity_boost: 0.7, style: 0.6 },
  },
};

const VOICEOVER_ENABLED_KEY = 'permitpulse-voiceover-enabled';

export function PlatformDemoVideo() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCache, setAudioCache] = useState<Map<string, string>>(new Map());
  const [selectedVoiceId, setSelectedVoiceId] = useState(() => {
    // Load saved preference from localStorage
    const saved = localStorage.getItem(VOICE_STORAGE_KEY);
    if (saved && availableVoices.some(v => v.id === saved)) {
      return saved;
    }
    return availableVoices[0].id;
  });
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [isVoiceSelectorOpen, setIsVoiceSelectorOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(() => {
    const saved = localStorage.getItem(SPEED_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 1;
    return playbackSpeeds.includes(parsed as PlaybackSpeed) ? (parsed as PlaybackSpeed) : 1;
  });
  const [calibrationPreset, setCalibrationPreset] = useState<CalibrationPreset>(() => {
    const saved = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (saved && (saved === 'clean' || saved === 'neutral' || saved === 'expressive')) {
      return saved as CalibrationPreset;
    }
    return 'clean';
  });
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  // Show overlay until user has explicitly enabled voiceover
  const [showVoiceoverOverlay, setShowVoiceoverOverlay] = useState(() => {
    return localStorage.getItem(VOICEOVER_ENABLED_KEY) !== 'true';
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrationRequestIdRef = useRef(0);
  const hasUserInteractedRef = useRef(false);

  // When the video segment ends before narration is finished, we queue the next segment
  // and advance only after the narration completes so sentences don't get cut off.
  const pendingAdvanceIndexRef = useRef<number | null>(null);

  const markUserInteracted = () => {
    hasUserInteractedRef.current = true;
  };

  // Handler for enabling voiceover via the overlay CTA
  const enableVoiceover = useCallback(() => {
    markUserInteracted();
    setShowVoiceoverOverlay(false);
    setIsMuted(false);
    localStorage.setItem(VOICEOVER_ENABLED_KEY, 'true');
  }, []);
  const calibrationPresetRef = useRef<CalibrationPreset>(calibrationPreset);
  const voiceSettingsRef = useRef<VoiceCalibration>(calibrationPresets[calibrationPreset].settings);

  useEffect(() => {
    calibrationPresetRef.current = calibrationPreset;
    voiceSettingsRef.current = calibrationPresets[calibrationPreset].settings;
  }, [calibrationPreset]);

  const currentSegment = videoSegments[currentIndex];
  const selectedVoice = availableVoices.find(v => v.id === selectedVoiceId) || availableVoices[0];

  // Generate TTS audio for text with specific voice and calibration settings
  const generateAudio = useCallback(async (text: string, voiceId: string, cacheKey: string): Promise<string | null> => {
    // Include calibration preset in cache key so different presets generate different audio
    const fullCacheKey = `${cacheKey}-${calibrationPresetRef.current}`;

    // Check cache first
    if (audioCache.has(fullCacheKey)) {
      return audioCache.get(fullCacheKey)!;
    }

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`;
      console.debug('[TTS] request', {
        voiceId,
        cacheKey: fullCacheKey,
        textChars: text.length,
        calibration: calibrationPresetRef.current,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          text,
          voiceId,
          voiceSettings: voiceSettingsRef.current,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[TTS] request failed', response.status, errText);
        return null;
      }

      const audioBlob = await response.blob();
      console.debug('[TTS] response ok', { bytes: audioBlob.size, type: audioBlob.type });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Cache the audio URL
      setAudioCache(prev => new Map(prev).set(fullCacheKey, audioUrl));

      return audioUrl;
    } catch (error) {
      console.error('Error generating audio:', error);
      return null;
    }
  }, [audioCache]);

  // Generate narration for a segment
  const generateNarration = useCallback(async (index: number, voiceId: string): Promise<string | null> => {
    const cacheKey = `narration-${voiceId}-${index}`;
    return generateAudio(videoSegments[index].narration, voiceId, cacheKey);
  }, [generateAudio]);

  // Generate voice preview
  const generateVoicePreview = useCallback(async (voice: Voice): Promise<string | null> => {
    const cacheKey = `preview-${voice.id}`;
    return generateAudio(voice.previewText, voice.id, cacheKey);
  }, [generateAudio]);

  // Play voice preview
  const playVoicePreview = useCallback(async (voice: Voice) => {
    // Stop any existing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    
    // Pause main narration while previewing
    if (audioRef.current) {
      audioRef.current.pause();
    }

    setPreviewingVoiceId(voice.id);
    
    const audioUrl = await generateVoicePreview(voice);
    
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.volume = 0.8;
      previewAudioRef.current = audio;
      
      audio.onended = () => {
        setPreviewingVoiceId(null);
        previewAudioRef.current = null;
      };
      
      try {
        await audio.play();
      } catch (error) {
        console.error('Error playing preview:', error);
        setPreviewingVoiceId(null);
      }
    } else {
      setPreviewingVoiceId(null);
      toast.error('Failed to load voice preview');
    }
  }, [generateVoicePreview]);

  // Stop voice preview
  const stopVoicePreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewingVoiceId(null);
  }, []);

  // Preload next segment's audio
  const preloadNextAudio = useCallback(async (currentIdx: number, voiceId: string) => {
    const nextIdx = (currentIdx + 1) % videoSegments.length;
    const baseCacheKey = `narration-${voiceId}-${nextIdx}`;
    const fullCacheKey = `${baseCacheKey}-${calibrationPresetRef.current}`;

    // Cache keys include calibration preset (see generateAudio)
    if (!audioCache.has(fullCacheKey)) {
      await generateNarration(nextIdx, voiceId);
    }
  }, [audioCache, generateNarration]);

  // Play narration for current segment
  const playNarration = useCallback(async (index: number, voiceId: string) => {
    // Bump request id to cancel any in-flight narration generation.
    narrationRequestIdRef.current += 1;
    const requestId = narrationRequestIdRef.current;

    if (isMuted) {
      setIsAudioPlaying(false);
      return;
    }

    // Stop any existing narration audio immediately
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setIsAudioPlaying(false);

    // Also stop any voice preview to avoid overlapping audio
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewingVoiceId(null);
    }

    setIsLoadingAudio(true);
    const audioUrl = await generateNarration(index, voiceId);
    setIsLoadingAudio(false);

    // If a newer narration request started while we were generating, abort.
    if (requestId !== narrationRequestIdRef.current) {
      return;
    }

    if (audioUrl && !isMuted) {
      const audio = new Audio(audioUrl);
      audio.preload = 'auto';
      audio.volume = 0.85;
      audio.playbackRate = playbackSpeed;
      audioRef.current = audio;

      // Track audio playing state
      audio.onplay = () => setIsAudioPlaying(true);
      audio.onpause = () => setIsAudioPlaying(false);
      audio.onended = () => {
        setIsAudioPlaying(false);

        // If the video ended while narration was playing, advance now.
        const pendingIndex = pendingAdvanceIndexRef.current;
        if (pendingIndex !== null) {
          pendingAdvanceIndexRef.current = null;
          setProgress(0);
          setCurrentIndex(pendingIndex);
          setIsPlaying(true);
        }
      };

      try {
        // No extra buffering wait here to reduce perceived delay.
        await audio.play();
      } catch (error) {
        console.error('Error playing audio:', error);
        setIsAudioPlaying(false);
      }
    }

    // Preload next audio
    preloadNextAudio(index, voiceId);
  }, [isMuted, generateNarration, preloadNextAudio, playbackSpeed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const progressPercent = (video.currentTime / video.duration) * 100;
      setProgress(progressPercent);
    };

    const handleEnded = () => {
      const nextIndex = (currentIndex + 1) % videoSegments.length;

      // If voiceover is active and narration is still playing, wait to advance
      // so the narration can finish its sentence instead of being cut off.
      const voiceoverActive = !isMuted && !showVoiceoverOverlay;
      const narrationInProgress = !!audioRef.current && !audioRef.current.paused && !audioRef.current.ended;

      if (voiceoverActive && narrationInProgress) {
        pendingAdvanceIndexRef.current = nextIndex;
        video.pause();
        setIsPlaying(false);
        return;
      }

      setCurrentIndex(nextIndex);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [currentIndex, isMuted, showVoiceoverOverlay]);

  // When voiceover overlay is dismissed, start narration immediately
  useEffect(() => {
    if (!showVoiceoverOverlay && !isMuted && isPlaying && hasUserInteractedRef.current) {
      playNarration(currentIndex, selectedVoiceId);
    }
  }, [showVoiceoverOverlay, isMuted, isPlaying, currentIndex, selectedVoiceId, playNarration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.load();
    video.playbackRate = playbackSpeed;
    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));

      // Only start narration after a user gesture (avoids browser autoplay audio restrictions)
      if (!isMuted && hasUserInteractedRef.current) {
        playNarration(currentIndex, selectedVoiceId);
      }
    }
  }, [currentIndex, isPlaying, playNarration, selectedVoiceId, playbackSpeed, isMuted]);

  // Apply playback speed to video and audio when speed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      // Revoke object URLs
      audioCache.forEach(url => URL.revokeObjectURL(url));
    };
  }, [audioCache]);

  const togglePlayPause = () => {
    markUserInteracted();
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } else {
      video.play();
      if (audioRef.current) {
        audioRef.current.play();
      } else if (!isMuted) {
        playNarration(currentIndex, selectedVoiceId);
      }
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    markUserInteracted();
    pendingAdvanceIndexRef.current = null;
    const newMuted = !isMuted;
    setIsMuted(newMuted);

    if (newMuted && audioRef.current) {
      audioRef.current.pause();
    } else if (!newMuted && isPlaying) {
      playNarration(currentIndex, selectedVoiceId);
    }
  };

  const handleSpeedChange = (speed: PlaybackSpeed) => {
    markUserInteracted();
    setPlaybackSpeed(speed);
    localStorage.setItem(SPEED_STORAGE_KEY, speed.toString());
    toast.success(`Playback speed: ${speed}x`);
  };

  const handleCalibrationChange = (preset: CalibrationPreset) => {
    markUserInteracted();
    pendingAdvanceIndexRef.current = null;
    // Update state + persist
    setCalibrationPreset(preset);
    localStorage.setItem(CALIBRATION_STORAGE_KEY, preset);
    setIsCalibrationOpen(false);

    // Update refs immediately so the next generation uses the new settings right away
    calibrationPresetRef.current = preset;
    voiceSettingsRef.current = calibrationPresets[preset].settings;

    // Stop current audio and restart with new calibration
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (isPlaying && !isMuted) {
      playNarration(currentIndex, selectedVoiceId);
    }

    toast.success(`Voice calibration: ${calibrationPresets[preset].label}`);
  };

  const goToPrevious = () => {
    markUserInteracted();
    pendingAdvanceIndexRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setCurrentIndex((prev) => (prev - 1 + videoSegments.length) % videoSegments.length);
    setProgress(0);
  };

  const goToNext = () => {
    markUserInteracted();
    pendingAdvanceIndexRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setCurrentIndex((prev) => (prev + 1) % videoSegments.length);
    setProgress(0);
  };

  const goToSegment = (index: number) => {
    markUserInteracted();
    pendingAdvanceIndexRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setCurrentIndex(index);
    setProgress(0);
  };

  const handleVoiceSelect = (voiceId: string) => {
    markUserInteracted();
    pendingAdvanceIndexRef.current = null;
    stopVoicePreview();
    setSelectedVoiceId(voiceId);
    setIsVoiceSelectorOpen(false);

    // Save preference to localStorage
    localStorage.setItem(VOICE_STORAGE_KEY, voiceId);

    // If currently playing, restart narration with new voice
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (isPlaying && !isMuted) {
      playNarration(currentIndex, voiceId);
    }

    toast.success(`Voice changed to ${availableVoices.find(v => v.id === voiceId)?.name}`);
  };

  return (
    <section className="py-16 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            See How It Works
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Watch our platform in action. From permit tracking to team collaboration, 
            discover how PermitPulse streamlines your entire permit management process.
          </p>
        </div>

        <div className="max-w-5xl mx-auto">
          {/* Video Player */}
          <div className="relative rounded-xl overflow-hidden shadow-2xl bg-black">
            <div className="aspect-video relative">
              <video
                ref={videoRef}
                src={currentSegment.src}
                className="w-full h-full object-cover"
                muted
                playsInline
                autoPlay
              />

              {/* Voiceover Enable Overlay - Prominent CTA for first-time users */}
              <AnimatePresence>
                {showVoiceoverOverlay && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-20"
                  >
                    <motion.button
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      transition={{ delay: 0.1, duration: 0.3 }}
                      onClick={enableVoiceover}
                      className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 hover:border-primary/60 hover:from-primary/30 hover:to-primary/10 transition-all duration-300 group cursor-pointer"
                    >
                      <div className="w-20 h-20 rounded-full bg-primary/20 group-hover:bg-primary/30 flex items-center justify-center transition-colors">
                        <Volume2 className="w-10 h-10 text-primary" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-xl md:text-2xl font-bold text-white mb-2">
                          Click to Enable AI Voiceover
                        </h3>
                        <p className="text-white/70 text-sm md:text-base max-w-xs">
                          Experience a guided tour with AI-powered narration
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-primary text-sm font-medium group-hover:gap-3 transition-all">
                        <Headphones className="w-4 h-4" />
                        <span>Start Listening</span>
                      </div>
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Audio Status Indicator */}
              {!isMuted && !showVoiceoverOverlay && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
                  {isLoadingAudio ? (
                    <>
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                      <span className="text-xs text-white">Loading narration...</span>
                    </>
                  ) : (
                    <>
                      <AudioWaveform 
                        isActive={isAudioPlaying} 
                        isLoading={isLoadingAudio}
                        barCount={5}
                        className="h-4"
                      />
                      <span className="text-xs text-white">
                        {isAudioPlaying ? 'AI Voice' : 'Ready'}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Overlay Controls */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300">
                {/* Top Right Controls */}
                <div className="absolute top-4 right-4 flex items-center gap-2">
                  <button
                    onClick={toggleMute}
                    className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? (
                      <VolumeX className="w-5 h-5 text-white" />
                    ) : (
                      <Volume2 className="w-5 h-5 text-white" />
                    )}
                  </button>
                </div>

                {/* Center Play/Pause */}
                <button
                  onClick={togglePlayPause}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors">
                    {isPlaying ? (
                      <Pause className="w-8 h-8 text-white" />
                    ) : (
                      <Play className="w-8 h-8 text-white ml-1" />
                    )}
                  </div>
                </button>

                {/* Navigation Arrows */}
                <button
                  onClick={goToPrevious}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>
                <button
                  onClick={goToNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                >
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>

                {/* Bottom Info */}
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentIndex}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                    >
                      <h3 className="text-xl md:text-2xl font-bold text-white mb-1">
                        {currentSegment.title}
                      </h3>
                      <p className="text-white/80 text-sm md:text-base">
                        {currentSegment.description}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
              <div
                className="h-full bg-primary transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Segment Indicators */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {videoSegments.map((segment, index) => (
              <button
                key={index}
                onClick={() => goToSegment(index)}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                  index === currentIndex
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
                )}
              >
                {segment.title}
              </button>
            ))}
          </div>

          {/* Segment Progress Dots */}
          <div className="flex justify-center gap-2 mt-4">
            {videoSegments.map((_, index) => (
              <button
                key={index}
                onClick={() => goToSegment(index)}
                className={cn(
                  'w-2 h-2 rounded-full transition-all duration-200',
                  index === currentIndex
                    ? 'bg-primary w-6'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                )}
                aria-label={`Go to segment ${index + 1}`}
              />
            ))}
          </div>

          {/* Voice Selector and Audio hint */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-6">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Voice:</span>
              <Popover open={isVoiceSelectorOpen} onOpenChange={setIsVoiceSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[200px] justify-between">
                    <span>{selectedVoice.name}</span>
                    <span className="text-xs text-muted-foreground">{selectedVoice.description}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-2" align="center">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground px-2 py-1">
                      Click <Headphones className="inline w-3 h-3 mx-0.5" /> to preview a voice
                    </p>
                    {availableVoices.map((voice) => (
                      <div
                        key={voice.id}
                        className={cn(
                          'flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors',
                          voice.id === selectedVoiceId
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted'
                        )}
                        onClick={() => handleVoiceSelect(voice.id)}
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">{voice.name}</div>
                          <div className="text-xs text-muted-foreground">{voice.description}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (previewingVoiceId === voice.id) {
                              stopVoicePreview();
                            } else {
                              playVoicePreview(voice);
                            }
                          }}
                        >
                          {previewingVoiceId === voice.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Headphones className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Speed Control */}
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Speed:</span>
              <div className="flex rounded-md border border-input overflow-hidden">
                {playbackSpeeds.map((speed) => (
                  <button
                    key={speed}
                    onClick={() => handleSpeedChange(speed)}
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium transition-colors',
                      speed === playbackSpeed
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Calibration */}
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Style:</span>
              <Popover open={isCalibrationOpen} onOpenChange={setIsCalibrationOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <span>{calibrationPresets[calibrationPreset].label}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-3" align="center">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">
                      Adjust voice expressiveness and consistency
                    </p>
                    {(Object.keys(calibrationPresets) as CalibrationPreset[]).map((preset) => {
                      const presetData = calibrationPresets[preset];
                      return (
                        <button
                          key={preset}
                          onClick={() => handleCalibrationChange(preset)}
                          className={cn(
                            'w-full flex flex-col items-start p-3 rounded-lg border transition-all',
                            preset === calibrationPreset
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border hover:border-primary/50 hover:bg-muted/50'
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="font-medium text-sm">{presetData.label}</span>
                            {preset === calibrationPreset && (
                              <div className="w-2 h-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground mt-0.5">
                            {presetData.description}
                          </span>
                          <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                            <span>Stability: {Math.round(presetData.settings.stability * 100)}%</span>
                            <span>Style: {Math.round(presetData.settings.style * 100)}%</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
            </Popover>
            </div>

            {/* TTS Healthcheck */}
            <TTSHealthcheck />
            
            <p className="text-sm text-muted-foreground">
              {isMuted ? (
                <>Click <Volume2 className="inline w-4 h-4 mx-1" /> to enable AI voiceover</>
              ) : (
                <>AI voiceover enabled</>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
