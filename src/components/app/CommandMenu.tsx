import { ArrowLeftIcon, SunMoonIcon } from "lucide-react"
import { useState } from "react"

import { useTheme } from "@/components/theme-provider"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { useUIStore } from "@/stores/ui"
import { RootPage } from "./CommandRoot"

export type CommandPage = "root" | "theme"

/** 命令面板（PRD 6.9）：跳转、服务器、系统三组；主题在二级页里选 */
export function CommandMenu() {
  const { theme, setTheme } = useTheme()
  const open = useUIStore((s) => s.commandOpen)
  const [page, setPage] = useState<CommandPage>("root")
  const [search, setSearch] = useState("")

  const onOpenChange = (next: boolean) => {
    useUIStore.getState().setCommandOpen(next)
    if (!next) {
      setPage("root")
      setSearch("")
    }
  }
  const goPage = (p: CommandPage) => {
    setPage(p)
    setSearch("")
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={copy.command.title} description={copy.command.description}>
      <Command
        onKeyDown={(e) => {
          // 二级页里，空输入时按退格返回
          if (page !== "root" && e.key === "Backspace" && !search) {
            e.preventDefault()
            goPage("root")
          }
        }}
      >
        <CommandInput placeholder={copy.command.placeholder} value={search} onValueChange={setSearch} />
        <CommandList>
          <CommandEmpty>{copy.command.empty}</CommandEmpty>
          {page === "root" ? (
            <RootPage close={() => onOpenChange(false)} goPage={goPage} />
          ) : (
            <CommandGroup heading={copy.command.actions.theme}>
              <CommandItem value={copy.command.back} onSelect={() => goPage("root")}>
                <ArrowLeftIcon />
                {copy.command.back}
              </CommandItem>
              {(["system", "light", "dark"] as const).map((t) => (
                <CommandItem
                  key={t}
                  value={copy.command.theme[t]}
                  data-checked={theme === t}
                  onSelect={() => {
                    setTheme(t)
                    toast.add({ title: copy.command.themeSet[t] })
                    onOpenChange(false)
                  }}
                >
                  <SunMoonIcon />
                  {copy.command.theme[t]}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
