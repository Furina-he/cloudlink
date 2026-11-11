/** 命令片段（DESIGN.md Command Chip）：mono 11.5px、pill 底、5px 圆角；一条命令一块，放不下时整块换行，不从词中间断开 */
export function CommandChip({ children }: { children: string }) {
  return <code className="rounded-[5px] bg-pill px-[7px] py-0.5 font-mono text-[11.5px] whitespace-nowrap text-fg-2">{children}</code>
}
