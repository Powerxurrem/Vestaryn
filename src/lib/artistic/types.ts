export type ArtisticCardType =
  | "default"
  | "notes"
  | "frame"
  | "prompt"
  | "output"
  | "bridge";

export type ArtisticOutputKind = "text" | "powerpoint" | "image";
export type ArtisticBridgeKind =
  | "file_context"
  | "summary_bridge"
export type ArtisticOutputRole =
  | "summary"
  | "email"
  | "report";
  
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
  imageUrl?: string;
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