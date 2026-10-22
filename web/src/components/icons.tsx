// Category icons: one Lucide icon per category, shown in a tinted bubble everywhere a category appears.
import {
  ShoppingCart, Utensils, Bus, Fuel, House, Zap, ShoppingBag, Gamepad2, Repeat, HeartPulse, GraduationCap, Plane,
  Landmark, Banknote, Wallet, Tag, CircleHelp, Coffee, Gift, Baby, PawPrint, Dumbbell, Shirt, Scissors, Car, Smartphone,
  PiggyBank, Briefcase, Music, BookOpen, ArrowLeftRight, type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  cart: ShoppingCart, utensils: Utensils, bus: Bus, fuel: Fuel, home: House, zap: Zap, bag: ShoppingBag, gamepad: Gamepad2,
  repeat: Repeat, health: HeartPulse, education: GraduationCap, plane: Plane, bank: Landmark, cash: Banknote, wallet: Wallet,
  tag: Tag, help: CircleHelp, coffee: Coffee, gift: Gift, baby: Baby, pet: PawPrint, gym: Dumbbell, clothes: Shirt,
  beauty: Scissors, car: Car, phone: Smartphone, savings: PiggyBank, work: Briefcase, music: Music, book: BookOpen,
};

const BY_KEY: Record<string, string> = {
  groceries: 'cart', restaurants: 'utensils', transport: 'bus', fuel: 'fuel', housing: 'home', utilities: 'zap', shopping: 'bag',
  entertainment: 'gamepad', subscriptions: 'repeat', health: 'health', education: 'education', travel: 'plane', bank_fees: 'bank',
  cash: 'cash', income: 'wallet', other: 'tag', uncategorized: 'help',
};

export const iconName = (c: { icon?: string | null; key?: string | null } | null | undefined) =>
  (c?.icon && ICONS[c.icon] ? c.icon : BY_KEY[c?.key ?? ''] ?? (c ? 'tag' : 'help'));

type CatLike = { icon?: string | null; key?: string | null; color?: string | null } | null | undefined;

/** Round tinted bubble with the category's icon. Decorative: the category name is always shown as text next to it. */
export function CatIcon({ cat, size = 36, transfer }: { cat: CatLike; size?: number; transfer?: boolean }) {
  const Icon = transfer ? ArrowLeftRight : ICONS[iconName(cat)];
  const color = transfer ? 'var(--accent)' : cat?.color ?? '#8a94a6';
  return (
    <span className="cat-icon" aria-hidden="true" style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

/** Initials avatar for merchants and banks (no external logo lookups: they would leak what you buy). */
export function Monogram({ name, size = 36 }: { name: string; size?: number }) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const text = ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="monogram" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 50% 28%)` }}>{text}</span>;
}
