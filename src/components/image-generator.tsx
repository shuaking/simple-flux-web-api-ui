"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Slider } from "./ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronDown, ChevronUp, Copy, Download, Share, Undo, X, Upload } from "lucide-react";
import Image from "next/image";
import { generateImage } from "@/app/actions";
import { type AppError } from "@/types/errors";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import { ImageGeneratorButton } from "./image-generator-button";
import { Lightbox } from "@/components/ui/lightbox";
import { ToastAction } from "@/components/ui/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const AVAILABLE_MODELS = {
  "flux-1-pro": "fal-ai/flux-pro/new",
  "flux-1.1-pro": "fal-ai/flux-pro/v1.1-ultra",
  "flux-lora": "fal-ai/flux-lora",
  "flux-dev": "fal-ai/flux/dev",
  "flux-schnell": "fal-ai/flux/schnell",
  "flux-img2img": "fal-ai/flux/dev/image-to-image",
} as const;

type AspectRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "9:21";

interface FluxImage {
  url: string;
  width: number;
  height: number;
  content_type: string;
}

interface Options {
  prompt: string;
  num_images: string;
  model: keyof typeof AVAILABLE_MODELS;
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "9:21";
  image_size: "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  seed?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  enable_safety_checker?: boolean;
  safety_tolerance?: 1 | 2 | 3 | 4 | 5 | 6;
  output_format?: "jpeg" | "png";
  raw?: boolean;
  sync_mode?: boolean;
  image_url?: string;
  image_prompt_strength?: number;
  strength?: number;
}

interface ApiError {
  message: string;
  status?: number;
  body?: {
    detail?: string;
  };
}

type GenerationState = 'idle' | 'generating' | 'success' | 'error';

interface GenerationHistory {
  prompt: string;
  options: Options;
  timestamp: number;
}

export function ImageGenerator() {
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [options, setOptions] = useState<Options>({
    prompt: "",
    num_images: "1",
    image_size: "landscape_16_9",
    model: "flux-1-pro",
    seed: undefined,
    num_inference_steps: 28,
    guidance_scale: 3.5,
    enable_safety_checker: false,
    safety_tolerance: 6,
    output_format: "jpeg",
    raw: false,
  });
  
  const [history, setHistory] = useState<GenerationHistory[]>([]);
  const historyIndex = useRef(-1);
  
  const { toast } = useToast();
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    input?: any;
    output?: any;
  }>({});

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imagePromptStrength, setImagePromptStrength] = useState<number>(0.35);
  const [syncMode, setSyncMode] = useState(false);
  const [timings, setTimings] = useState<Record<string, number> | null>(null);
  const [nsfwDetected, setNsfwDetected] = useState<boolean[]>([]);

  const isFluxProUltra = options.model === "flux-1.1-pro";

  const handleUndo = useCallback(() => {
    if (historyIndex.current > 0) {
      historyIndex.current--;
      const previousState = history[historyIndex.current];
      setOptions(previousState.options);
    }
  }, [history]);

  const promptTemplates = [
    "A stunning landscape with mountains and a lake",
    "A futuristic cityscape at night",
    "A magical forest with glowing mushrooms",
    "An abstract art piece with vibrant colors",
  ];

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(options.prompt);
    toast({
      title: "Prompt Copied",
      description: "The prompt has been copied to your clipboard.",
    });
  };

  const handleDownloadImage = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `generated-image-${Date.now()}.${options.output_format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download the image. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleShareImage = async (url: string) => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Generated Image',
          text: options.prompt,
          url: url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast({
          title: "Link Copied",
          description: "Image URL has been copied to your clipboard.",
        });
      }
    } catch (error) {
      toast({
        title: "Share Failed",
        description: "Failed to share the image. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleError = (error: unknown) => {
    const generationError = error as AppError;
    setError(generationError.message);
    
    let toastMessage = "Failed to generate image. Please try again.";
    let toastAction: React.ReactNode = undefined;

    switch (generationError.code) {
      case 'INSUFFICIENT_CREDITS':
        toastMessage = "Insufficient credits. Please top up your account.";
        toastAction = (
          <ToastAction altText="Go to Billing" onClick={() => window.open('https://fal.ai/dashboard/billing', '_blank')}>
            Go to Billing
          </ToastAction>
        );
        break;
      case 'INVALID_API_KEY':
        toastMessage = "Invalid API key. Please check your settings.";
        break;
      case 'RATE_LIMIT_EXCEEDED':
        toastMessage = "Rate limit exceeded. Please try again in a few moments.";
        break;
    }

    toast({
      title: "Generation Failed",
      description: toastMessage,
      variant: "destructive",
      duration: 5000,
      action: toastAction,
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result as string);
        setOptions(prev => ({
          ...prev,
          image_url: reader.result as string,
        }));
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: "Failed to upload the image. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveImage = () => {
    setUploadedImage(null);
    setOptions(prev => ({
      ...prev,
      image_url: undefined,
      image_prompt_strength: undefined,
    }));
  };

  const handleGenerate = async () => {
    const apiKey = localStorage.getItem("fal_api_key");
    if (!apiKey) {
      toast({
        title: "Error",
        description: "Please set your API key in the settings tab",
        variant: "destructive",
      });
      return;
    }

    if (!options.prompt) {
      toast({
        title: "Error",
        description: "Please enter a prompt",
        variant: "destructive",
      });
      return;
    }

    try {
      setGenerationState('generating');
      setIsLoading(true);
      setError(null);
      setProgress(0);
      setProgressText("");
      setImageUrls([]);
      setCost(null);
      setTimings(null);
      setNsfwDetected([]);

      // Add to history
      const newHistory = {
        prompt: options.prompt,
        options: { ...options },
        timestamp: Date.now(),
      };
      setHistory(prev => [...prev, newHistory]);
      historyIndex.current = history.length;

      const result = await generateImage(
        apiKey,
        options.prompt,
        isFluxProUltra ? options.aspect_ratio || "16:9" : options.image_size,
        options.model,
        isFluxProUltra ? 1 : parseInt(options.num_images),
        {
          seed: options.seed,
          output_format: options.output_format,
          raw: options.raw,
          sync_mode: options.sync_mode,
          ...(isFluxProUltra ? {} : {
            enable_safety_checker: options.enable_safety_checker,
            safety_tolerance: options.safety_tolerance?.toString() as "1" | "2" | "3" | "4" | "5" | "6",
            image_url: options.image_url,
            image_prompt_strength: options.image_prompt_strength,
            num_inference_steps: options.num_inference_steps,
            guidance_scale: options.guidance_scale,
            strength: options.strength,
          }),
        }
      );

      setDebugInfo(prev => ({
        ...prev,
        output: {
          ...result,
          cost: result.cost ? `$${result.cost.toFixed(3)}` : 'N/A'
        }
      }));

      if (result.status === "COMPLETED" && result.imageUrls) {
        setGenerationState('success');
        setImageUrls(result.imageUrls);
        if (result.cost) setCost(result.cost);
        if (result.metadata?.timings) setTimings(result.metadata.timings);
        if (result.metadata?.has_nsfw_concepts) setNsfwDetected(result.metadata.has_nsfw_concepts);

        const historyItem = {
          id: crypto.randomUUID(),
          imageUrl: result.imageUrls[0],
          prompt: options.prompt,
          model: options.model,
          cost: result.cost || 0,
          createdAt: new Date().toISOString(),
          requestDetails: {
            prompt: options.prompt,
            aspectRatio: options.image_size,
            model: options.model,
            numImages: parseInt(options.num_images),
            options: {
              seed: options.seed,
              safety_tolerance: options.safety_tolerance,
              output_format: options.output_format,
              raw: options.raw,
              enable_safety_checker: options.enable_safety_checker,
            },
          },
          responseDetails: result,
          metadata: result.metadata,
        };

        const existingHistory = JSON.parse(localStorage.getItem("imageHistory") || "[]");
        localStorage.setItem(
          "imageHistory",
          JSON.stringify([historyItem, ...existingHistory].slice(0, 50))
        );

        toast({
          title: "Generation Complete",
          description: `Successfully generated ${result.imageUrls.length} image${result.imageUrls.length > 1 ? 's' : ''}.`,
        });
      }
    } catch (error) {
      setGenerationState('error');
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isLoading) {
        e.preventDefault();
        handleGenerate();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isLoading) {
        e.preventDefault();
        handleUndo();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, handleUndo]);

  const TimingDisplay = ({ timings }: { timings: Record<string, number> }) => (
    <div className="text-sm text-muted-foreground space-y-1">
      <h4 className="font-medium">Generation Timings:</h4>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(timings).map(([key, value]) => (
          <div key={key} className="flex justify-between">
            <span>{key}:</span>
            <span>{value.toFixed(2)}s</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Card className="flex flex-col md:flex-row min-h-[600px]">
        <div className="flex-1 border-r overflow-y-auto">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Generate Image
              {history.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleUndo}
                  disabled={historyIndex.current <= 0}
                  title="Undo (⌘Z)"
                >
                  <Undo className="h-4 w-4" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Prompt</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyPrompt}
                  disabled={!options.prompt}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
              </div>
              <Textarea
                placeholder="Enter your prompt here..."
                value={options.prompt}
                onChange={(e) => {
                  const newPrompt = e.target.value;
                  setOptions(prev => ({ ...prev, prompt: newPrompt }));
                }}
                className="h-32"
              />
              {promptTemplates.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {promptTemplates.map((template, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() => setOptions(prev => ({ ...prev, prompt: template }))}
                    >
                      Template {index + 1}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Model</label>
                <Select
                  value={options.model}
                  onValueChange={(value: keyof typeof AVAILABLE_MODELS) => 
                    setOptions({ ...options, model: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flux-1-pro">Flux.1 Pro</SelectItem>
                    <SelectItem value="flux-1.1-pro">FLUX1.1 [pro] Ultra - High Res</SelectItem>
                    <SelectItem value="flux-lora">Flux LoRA</SelectItem>
                    <SelectItem value="flux-dev">Flux Dev</SelectItem>
                    <SelectItem value="flux-schnell">Flux Schnell</SelectItem>
                    <SelectItem value="flux-img2img">Flux Image-to-Image</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isFluxProUltra ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Aspect Ratio</label>
                      <Select
                        value={options.aspect_ratio}
                        onValueChange={(value: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "9:21") => 
                          setOptions({ ...options, aspect_ratio: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="21:9">Ultra Wide 21:9</SelectItem>
                          <SelectItem value="16:9">Wide 16:9</SelectItem>
                          <SelectItem value="4:3">Standard 4:3</SelectItem>
                          <SelectItem value="1:1">Square 1:1</SelectItem>
                          <SelectItem value="3:4">Portrait 3:4</SelectItem>
                          <SelectItem value="9:16">Tall 9:16</SelectItem>
                          <SelectItem value="9:21">Ultra Tall 9:21</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Output Format</label>
                      <Select
                        value={options.output_format}
                        onValueChange={(value: "jpeg" | "png") => setOptions({ ...options, output_format: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="jpeg">JPEG</SelectItem>
                          <SelectItem value="png">PNG</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Seed (Optional)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        value={options.seed || ''}
                        onChange={(e) => setOptions({ ...options, seed: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="Leave blank for random"
                      />
                      <Button 
                        variant="outline" 
                        onClick={() => setOptions({ ...options, seed: Math.floor(Math.random() * 1000000) })}
                      >
                        Random
                      </Button>
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="raw"
                        checked={options.raw}
                        onCheckedChange={(checked) => setOptions({ ...options, raw: !!checked })}
                      />
                      <label htmlFor="raw" className="text-sm font-medium">
                        Raw Output
                      </label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="sync_mode"
                        checked={options.sync_mode}
                        onCheckedChange={(checked) => setOptions(prev => ({ ...prev, sync_mode: !!checked }))}
                      />
                      <label htmlFor="sync_mode" className="text-sm font-medium">
                        Sync Mode
                      </label>
                    </div>
                  </div>
                </>
              ) : options.model === "flux-1-pro" ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Image Size</label>
                      <Select
                        value={options.image_size}
                        onValueChange={(value) =>
                          setOptions((prev) => ({ ...prev, image_size: value as Options["image_size"] }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select image size" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="square_hd">Square HD</SelectItem>
                          <SelectItem value="square">Square</SelectItem>
                          <SelectItem value="portrait_4_3">Portrait 4:3</SelectItem>
                          <SelectItem value="portrait_16_9">Portrait 16:9</SelectItem>
                          <SelectItem value="landscape_4_3">Landscape 4:3</SelectItem>
                          <SelectItem value="landscape_16_9">Landscape 16:9</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Output Format</label>
                      <Select
                        value={options.output_format}
                        onValueChange={(value: "jpeg" | "png") => setOptions({ ...options, output_format: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="jpeg">JPEG</SelectItem>
                          <SelectItem value="png">PNG</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Seed</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={options.seed || ''}
                          onChange={(e) => setOptions({ ...options, seed: e.target.value ? Number(e.target.value) : undefined })}
                          placeholder="Leave blank for random"
                        />
                        <Button 
                          variant="outline" 
                          onClick={() => setOptions({ ...options, seed: Math.floor(Math.random() * 1000000) })}
                        >
                          Random
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Number of Images</label>
                      <Select
                        value={options.num_images}
                        onValueChange={(value) => setOptions({ ...options, num_images: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="inference-steps" className="text-sm font-medium">
                      Inference Steps ({options.num_inference_steps})
                    </label>
                    <Slider
                      id="inference-steps"
                      min={1}
                      max={50}
                      step={1}
                      value={[options.num_inference_steps || 28]}
                      onValueChange={([value]) =>
                        setOptions((prev) => ({ ...prev, num_inference_steps: value }))
                      }
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="guidance-scale" className="text-sm font-medium">
                      Guidance Scale ({options.guidance_scale})
                    </label>
                    <Slider
                      id="guidance-scale"
                      min={1}
                      max={20}
                      step={0.1}
                      value={[options.guidance_scale || 3.5]}
                      onValueChange={([value]) =>
                        setOptions((prev) => ({ ...prev, guidance_scale: value }))
                      }
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sync_mode"
                      checked={options.sync_mode}
                      onCheckedChange={(checked) => setOptions(prev => ({ ...prev, sync_mode: !!checked }))}
                    />
                    <label htmlFor="sync_mode" className="text-sm font-medium">
                      Enable Sync Mode
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Seed</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        value={options.seed || ''}
                        onChange={(e) => setOptions({ ...options, seed: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="Leave blank for random"
                      />
                      <Button 
                        variant="outline" 
                        onClick={() => setOptions({ ...options, seed: Math.floor(Math.random() * 1000000) })}
                      >
                        Random
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Safety Tolerance</label>
                      <Select
                        value={options.safety_tolerance?.toString()}
                        onValueChange={(value) => setOptions({ ...options, safety_tolerance: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 - Very Strict</SelectItem>
                          <SelectItem value="2">2 - Strict</SelectItem>
                          <SelectItem value="3">3 - Moderate</SelectItem>
                          <SelectItem value="4">4 - Permissive</SelectItem>
                          <SelectItem value="5">5 - Very Permissive</SelectItem>
                          <SelectItem value="6">6 - Unrestricted</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Output Format</label>
                      <Select
                        value={options.output_format}
                        onValueChange={(value: "jpeg" | "png") => setOptions({ ...options, output_format: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="jpeg">JPEG</SelectItem>
                          <SelectItem value="png">PNG</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="raw"
                        checked={options.raw}
                        onCheckedChange={(checked) => setOptions({ ...options, raw: !!checked })}
                      />
                      <label htmlFor="raw" className="text-sm font-medium">
                        Raw Output
                      </label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="safety"
                        checked={options.enable_safety_checker}
                        onCheckedChange={(checked) => setOptions(prev => ({ ...prev, enable_safety_checker: !!checked }))}
                      />
                      <label htmlFor="safety" className="text-sm font-medium">
                        Enable Safety Checker
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium">Number of Images</label>
                      <span className="text-sm text-muted-foreground">{options.num_images}</span>
                    </div>
                    <Slider
                      min={1}
                      max={4}
                      step={1}
                      value={[parseInt(options.num_images)]}
                      onValueChange={(value) => setOptions({ ...options, num_images: String(value[0]) })}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Image Input (Optional)</label>
                    {uploadedImage ? (
                      <div className="relative">
                        <Image
                          src={uploadedImage}
                          alt="Uploaded image"
                          width={300}
                          height={300}
                          className="rounded-lg"
                        />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2"
                          onClick={handleRemoveImage}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <div className="mt-2 space-y-2">
                          <label className="text-sm font-medium">Image Prompt Strength</label>
                          <div className="flex items-center gap-4">
                            <Slider
                              min={0}
                              max={1}
                              step={0.05}
                              value={[imagePromptStrength]}
                              onValueChange={([value]) => {
                                setImagePromptStrength(value);
                                setOptions(prev => ({
                                  ...prev,
                                  image_prompt_strength: value,
                                }));
                              }}
                              className="flex-1"
                            />
                            <span className="text-sm text-muted-foreground w-12">
                              {imagePromptStrength.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center w-full">
                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="h-8 w-8 mb-4 text-muted-foreground" />
                            <p className="mb-2 text-sm text-muted-foreground">
                              <span className="font-semibold">Click to upload</span> or drag and drop
                            </p>
                            <p className="text-xs text-muted-foreground">PNG, JPG or JPEG</p>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={handleImageUpload}
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sync_mode"
                      checked={options.sync_mode}
                      onCheckedChange={(checked) => setOptions(prev => ({ ...prev, sync_mode: !!checked }))}
                    />
                    <label htmlFor="sync_mode" className="text-sm font-medium">
                      Enable Sync Mode
                      <span className="ml-2 text-xs text-muted-foreground">
                        (Faster generation, but may be less reliable)
                      </span>
                    </label>
                  </div>
                </>
              )}
            </div>

            {!isFluxProUltra && options.model !== "flux-1-pro" && (
              <>
                <div className="grid gap-2">
                  <label htmlFor="image-size" className="text-sm font-medium">
                    Image Size
                  </label>
                  <Select
                    value={options.image_size}
                    onValueChange={(value) =>
                      setOptions((prev) => ({ ...prev, image_size: value as Options["image_size"] }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select image size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="square_hd">Square HD</SelectItem>
                      <SelectItem value="square">Square</SelectItem>
                      <SelectItem value="portrait_4_3">Portrait 4:3</SelectItem>
                      <SelectItem value="portrait_16_9">Portrait 16:9</SelectItem>
                      <SelectItem value="landscape_4_3">Landscape 4:3</SelectItem>
                      <SelectItem value="landscape_16_9">Landscape 16:9</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <label htmlFor="inference-steps" className="text-sm font-medium">
                    Inference Steps ({options.num_inference_steps})
                  </label>
                  <Slider
                    id="inference-steps"
                    min={1}
                    max={50}
                    step={1}
                    value={[options.num_inference_steps || 28]}
                    onValueChange={([value]) =>
                      setOptions((prev) => ({ ...prev, num_inference_steps: value }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="guidance-scale" className="text-sm font-medium">
                    Guidance Scale ({options.guidance_scale})
                  </label>
                  <Slider
                    id="guidance-scale"
                    min={1}
                    max={20}
                    step={0.1}
                    value={[options.guidance_scale || 3.5]}
                    onValueChange={([value]) =>
                      setOptions((prev) => ({ ...prev, guidance_scale: value }))
                    }
                  />
                </div>
              </>
            )}

            <ImageGeneratorButton 
              isLoading={isLoading} 
              onGenerate={handleGenerate} 
              shortcutText="⌘ + Enter"
            />

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Generation Failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </div>

        <div className="flex-1 p-6 flex flex-col items-center justify-center bg-muted/10">
          {imageUrls.length > 0 ? (
            <div className="space-y-4 w-full">
              <div className={`grid ${imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                {imageUrls.map((url, index) => (
                  <div key={index} className="relative group">
                    <div
                      className="cursor-pointer transition-transform hover:scale-[1.02]"
                      onClick={() => setSelectedImage(url)}
                    >
                      <Image
                        src={url}
                        alt={`Generated image ${index + 1}`}
                        width={1024}
                        height={1024}
                        className="rounded-lg shadow-lg w-full h-auto"
                      />
                      {nsfwDetected[index] && (
                        <div className="absolute top-2 left-2 bg-destructive text-white text-xs px-2 py-1 rounded">
                          NSFW Content Detected
                        </div>
                      )}
                    </div>
                    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => handleDownloadImage(url)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => handleShareImage(url)}
                        >
                          <Share className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="space-y-4">
                {cost !== null && (
                  <div className="text-sm text-muted-foreground text-center">
                    Generation Cost: ${cost.toFixed(3)}
                  </div>
                )}
                
                {timings && <TimingDisplay timings={timings} />}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-muted-foreground w-full max-w-[512px]">
              {!imageUrls.length && (
                <div className="flex flex-col items-center justify-center text-muted-foreground w-full max-w-[512px]">
                  {isLoading ? (
                    <div className="w-full space-y-4">
                      <div className="border-2 border-dashed rounded-lg w-full aspect-video flex flex-col items-center justify-center p-4">
                        <Loader2 className="h-8 w-8 animate-spin mb-4" />
                        <p className="text-center font-medium">{progressText}</p>
                        <Progress value={progress} className="w-full mt-4" />
                      </div>
                    </div>
                  ) : error ? (
                    <div className="border-2 border-destructive rounded-lg w-full aspect-video flex flex-col items-center justify-center p-8 space-y-4">
                      <div className="text-destructive text-center space-y-2">
                        <p className="font-medium">Generation Failed</p>
                        <p className="text-sm">{error}</p>
                        {error.includes('balance') && (
                          <Button 
                            variant="outline" 
                            className="mt-4"
                            onClick={() => window.open('https://fal.ai/dashboard/billing', '_blank')}
                          >
                            Go to Billing
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed rounded-lg w-full aspect-video flex items-center justify-center">
                      <p>Generated image will appear here</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {imageUrls.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="cursor-pointer" onClick={() => setShowDebug(!showDebug)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Debug Information</CardTitle>
              {showDebug ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          {showDebug && (
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="font-medium text-sm">Input Parameters</h3>
                  <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-[400px]">
                    {JSON.stringify(debugInfo.input, null, 2)}
                  </pre>
                </div>
                <div className="space-y-2">
                  <h3 className="font-medium text-sm">Output Response</h3>
                  <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-[400px]">
                    {JSON.stringify(debugInfo.output, null, 2)}
                  </pre>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {selectedImage && (
        <Lightbox
          isOpen={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          imageUrl={selectedImage}
        />
      )}
    </>
  );
}