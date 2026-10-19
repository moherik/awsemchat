import type { ReplyContext } from "./photos/reply-card";
import { starterStickers, type StickerArtwork } from "./stickers/model.ts";
import { useSyncExternalStore } from "react";
export type DemoMessage = {
  text: string;
  own: boolean;
  moment?: boolean;
  momentIndex?: number;
  image?: string;
  sticker?: boolean;
  stickerArtwork?: StickerArtwork;
  failed?: boolean;
  reply?: string;
  replyContext?: ReplyContext;
  reaction?: string;
};
export type DemoState = {
  opened: string[];
  chatPreferences?: Record<string, { pinned?: boolean; muted?: boolean; archived?: boolean }>;
  outgoing: string[];
  recoveryKey: string;
  pingMute: Record<string, boolean>;
  momentImages: Record<string, string>;
  momentStickers: Record<string, StickerArtwork>;
  theme: "system" | "light" | "dark";
  avatar: string | null;
  name: string;
  status: string;
  phone: string;
  requests: string[];
  friends: string[];
  circles: { name: string; members: string[]; id?: string; description?: string; avatar?: string | null; left?: boolean }[];
  blocked: string[];
  stickers: string[];
  backup: string | null;
  schedule: string;
  music: boolean;
  notifications: boolean;
  messages: Record<string, DemoMessage[]>;
  moments: Record<string, string[]>;
  stickerImages: Record<string, string>;
  stickerArt: Record<string, StickerArtwork>;
  favoriteGifs?: { id: string; name: string; uri: string }[];
  recentStickers: string[];
  stickerPacks: string[];
  groupStickers: Record<string, string[]>;
  customEmoji: Record<string, string[]>;
};
let state: DemoState = {
  opened: [],
  outgoing: [],
  recoveryKey: "",
  pingMute: {},
  momentImages: Object.fromEntries(['naya','family','raka','weekend','sari','bima','ayu'].map(id => [`${id}-0`, 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&q=85'])), momentStickers: {},
  theme: "system",
  avatar: null,
  name: "You",
  status: "A little more offline today",
  phone: "",
  requests: ["Dimas"],
  friends: ["Naya", "Raka", "Sari", "Bima", "Ayu"],
  circles: [
    {
      name: "The home team", id: "family",
      members: ["You", "Mum", "Dad", "Naya", "Raka", "Dimas"],
    },
    {
      name: "Weekend people", id: "weekend",
      members: ["You", "Naya", "Raka", "Dimas", "Sari", "Bima", "Ayu", "Lia"],
    },
  ],
  blocked: [],
  stickers: Object.keys(starterStickers),
  backup: null,
  schedule: "Weekly",
  music: false,
  notifications: true,
  messages: {},
  moments: Object.fromEntries(['naya','family','raka','weekend','sari','bima','ayu'].map(id => [id, ['Sunday, saved.']])),
  stickerImages: Object.fromEntries(Object.entries(starterStickers).map(([key, art]) => [key, art.image])),
  stickerArt: starterStickers, recentStickers: [], stickerPacks: ["Everyday", "Made by you", "Saved stickers"],
  groupStickers: { "The home team": ["Coffee break", "Big hug", "For you"], "Weekend people": ["Hello!", "Weekend mood"] },
  customEmoji: {},
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;
export function updateDemo(patch: Partial<DemoState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useDemo() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

let backupSnapshot: DemoState | null = null;
export function createDemoBackup() {
  updateDemo({ backup: new Date().toLocaleString() });
  backupSnapshot = JSON.parse(JSON.stringify(state)) as DemoState;
}
export function restoreDemoBackup() {
  if (!backupSnapshot) return false;
  state = JSON.parse(JSON.stringify(backupSnapshot)) as DemoState;
  listeners.forEach((listener) => listener());
  return true;
}

export function getDemoSnapshot() {
  return state;
}
