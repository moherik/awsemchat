import { type DemoMessage } from "./demo-store";
export type Chat = {
  avatar?: string;
  id: string;
  name: string;
  initials: string;
  circle: boolean;
  status: string;
  preview: string;
  time: string;
  unread: number;
  color: string;
};
type Message = DemoMessage;
export const sampleChats: Chat[] = [
  {
    id: "naya",
    avatar: "https://i.pravatar.cc/120?img=47",
    name: "Naya",
    initials: "N",
    circle: false,
    status: "Taking the scenic route",
    preview: "That little café? Saturday it is.",
    time: "16:42",
    unread: 2,
    color: "#805445",
  },
  {
    id: "family",
    avatar:
      "https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=160&q=85",
    name: "The home team",
    initials: "HT",
    circle: true,
    status: "6 people · Family",
    preview: "Mum: I saved you a slice 🍰",
    time: "15:08",
    unread: 1,
    color: "#49644D",
  },
  {
    id: "raka",
    avatar: "https://i.pravatar.cc/120?img=12",
    name: "Raka",
    initials: "R",
    circle: false,
    status: "One more song",
    preview: "You: Sending this your way",
    time: "13:21",
    unread: 0,
    color: "#526B83",
  },
  {
    id: "weekend",
    avatar:
      "https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=160&q=85",
    name: "Weekend people",
    initials: "WP",
    circle: true,
    status: "8 people · Friends",
    preview: "Dimas: Who’s bringing the cards?",
    time: "Yesterday",
    unread: 0,
    color: "#776044",
  },
  {
    id: "sari",
    name: "Sari",
    initials: "S",
    circle: false,
    status: "Back in the garden",
    preview: "Look what finally bloomed!",
    time: "Yesterday",
    unread: 0,
    color: "#49644D",
    avatar: "https://i.pravatar.cc/120?img=44",
  },
  {
    id: "bima",
    name: "Bima",
    initials: "B",
    circle: false,
    status: "See you at the weekend",
    preview: "You: I’ll bring the cards.",
    time: "Thu",
    unread: 0,
    color: "#526B83",
    avatar: "https://i.pravatar.cc/120?img=13",
  },
  {
    id: "ayu",
    name: "Ayu",
    initials: "A",
    circle: false,
    status: "Finding little joys",
    preview: "Saved this one to our Moments.",
    time: "Wed",
    unread: 0,
    color: "#805445",
    avatar: "https://i.pravatar.cc/120?img=49",
  },
];
const seed: Message[] = [
  { text: "Found a tiny café with a very good window seat.", own: false },
  { text: "Sounds like our kind of place.", own: true },
  { text: "No plans, no rush. Just coffee and a catch-up?", own: false },
  { text: "Saturday? ☕", own: true },
  { text: "That little café? Saturday it is.", own: false },
];
export const getSeed = (id: string): Message[] =>
  id === "naya"
    ? seed
    : id === "family"
      ? [
          { text: "I saved you a slice 🍰", own: false },
          { text: "Best news all day. See you at dinner!", own: true },
        ]
      : id === "raka"
        ? [
            { text: "This song has been on repeat.", own: false },
            { text: "Sending this your way", own: true },
          ]
        : id === "weekend"
          ? [{ text: "Who’s bringing the cards?", own: false }]
          : [];
