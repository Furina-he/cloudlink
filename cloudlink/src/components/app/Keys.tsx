import { Kbd, KbdGroup } from "@/components/ui/kbd"

/** 快捷键提示，例如 Ctrl + S（KEY_HINT 里的一项） */
export function Keys({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <KbdGroup className={className}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </KbdGroup>
  )
}
