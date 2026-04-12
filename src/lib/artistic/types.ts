export type ArtisticCardType = "default" | "notes" | "frame";

export type ArtisticCard = {
  id: string;
  type: ArtisticCardType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  body: string;
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