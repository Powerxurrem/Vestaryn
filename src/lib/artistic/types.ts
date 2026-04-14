export type ArtisticCardType =
  | "default"
  | "notes"
  | "frame"
  | "prompt"
  | "output"
  | "bridge";

export type ArtisticOutputKind = "text" | "powerpoint";
export type ArtisticBridgeKind = "file_context";
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
  contextFileName?: string;
  contextText?: string;
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