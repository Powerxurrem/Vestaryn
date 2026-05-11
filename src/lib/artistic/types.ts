export type ArtisticCardType =
  | "default"
  | "notes"
  | "frame"
  | "prompt"
  | "output"
  | "bridge";

export type ArtisticPromptIntent =
  | "general"
  | "book_title"
  | "book_page_text"
  | "book_character"
  | "book_background"
  | "book_illustration";

export type ArtisticOutputKind =
  | "text"
  | "powerpoint"
  | "image"
  | "book_page";

export type ArtisticTextStyleFont =
  | "storybook"
  | "serif"
  | "sans"
  | "handwritten"
  | "display";

export type ArtisticTextStyleProcessorSettings = {
  fontFamily?: ArtisticTextStyleFont;
  fontSize?: number;
  color?: string;
  opacity?: number;
  rotation?: number;
  letterSpacing?: number;
  lineHeight?: number;
  textShadow?: "none" | "soft" | "strong" | "glow";
  textOutline?: "none" | "light" | "dark";
  fontWeight?: "normal" | "medium" | "semibold" | "bold";
};

export type ArtisticBridgeKind =
  | "file_context"
  | "summary_bridge"
  | "image_processor"
  | "text_style_processor";

  export type ArtisticImageProcessorKind =
  | "remove_background";

  export type ArtisticProcessorAdjustments = {
    saturation?: number;
    brightness?: number;
    contrast?: number;
  };

export type ArtisticOutputRole =
  | "summary"
  | "email"
  | "report";

export type ArtisticPptImageZone = {
  imageCardId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ArtisticBookImageZoneRole =
  | "background"
  | "character"
  | "overlay";

export type ArtisticBookImageObjectFit =
  | "cover"
  | "contain";

export type ArtisticBookImageZone = {
  visualCardId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role?: ArtisticBookImageZoneRole;
  objectFit?: ArtisticBookImageObjectFit;
};

export type ArtisticBookTextAlign =
  | "left"
  | "center"
  | "right";

export type ArtisticBookTextBackground =
  | "none"
  | "soft_panel"
  | "paper_panel";

export type ArtisticBookFontFamily =
  | "storybook"
  | "serif"
  | "sans"
  | "handwritten";

export type ArtisticBookTextZone = {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  fontFamily?: ArtisticBookFontFamily;
  align?: ArtisticBookTextAlign;
  color?: string;
  background?: ArtisticBookTextBackground;
};

export type ArtisticBookPageRatio =
  | "square"
  | "portrait"
  | "landscape";

export type ArtisticImageAspect =
  | "square"
  | "portrait"
  | "landscape";

export type ArtisticImageMode =
  | "presentation_visual"
  | "book_background"
  | "book_character"
  | "print_illustration";

export type ArtisticCard = {
  id: string;
  type: ArtisticCardType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  body: string;
  links?: string[];
  sourceCardId?: string;
  
  outputKind?: ArtisticOutputKind;
  outputRole?: ArtisticOutputRole;
  bridgeKind?: ArtisticBridgeKind;
  upstreamCardId?: string;
  summaryBridgeUnlocked?: boolean;
  promptGateUnlocked?: boolean; 
  contextFileName?: string;
  contextText?: string;
  groupId?: string;
  imageStatus?: "idle" | "generating" | "done" | "error";

  /**
   * Display URL used by the browser.
   * Can be a fresh signed URL, data URL fallback, or temporary preview URL.
   */
  imageUrl?: string;

  /**
   * Durable Supabase Storage path.
   * This is the real persisted asset reference.
   */
  imageStoragePath?: string;

  imageMode?: ArtisticImageMode;
  imageAspect?: ArtisticImageAspect;

  imageProcessorKind?: ArtisticImageProcessorKind;
  inputImageCardId?: string;

  /**
   * Display URL for processed image output.
   */
  processedImageUrl?: string;

  /**
   * Durable Supabase Storage path for processed output.
   */
  processedImageStoragePath?: string;
  processorStatus?: "idle" | "processing" | "done" | "error";
  processorError?: string;
  processorAdjustments?: ArtisticProcessorAdjustments;
  processorFlipX?: boolean;
  processorFlipY?: boolean;
  promptIntent?: ArtisticPromptIntent; 
  bookPageRatio?: ArtisticBookPageRatio;
  linkedImageCardId?: string;
  linkedImageCardIds?: string[];

  inputTextCardId?: string;
  textStyleProcessorStatus?: "idle" | "processing" | "done" | "error";
  textStyleProcessorError?: string;
  textStyleSettings?: ArtisticTextStyleProcessorSettings;

  pptImageX?: number;
  pptImageY?: number;
  pptImageW?: number;
  pptImageH?: number;
  pptImageZones?: ArtisticPptImageZone[];
  bookImageZones?: ArtisticBookImageZone[];
  bookTextZone?: ArtisticBookTextZone;

};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type PanOffset = {
  x: number;
  y: number;
};

export type CardPresetUi = {
  shell: string;
  header: string;
  title: string;
  body: string;
  input: string;
};