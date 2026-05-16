// Lightweight class-name joiner — avoids pulling in clsx/tailwind-merge
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
