import {
  ArrowDownUpIcon,
  ChevronDownIcon,
  CircleIcon,
  FileInputIcon,
  PlusIcon,
  ServerIcon,
} from "lucide-react"
import { motion } from "motion/react"
import { useMemo, useState, type RefObject } from "react"
import { useShallow } from "zustand/react/shallow"

import type { Asset, AssetType, ProbeState } from "@/bindings"
import { ENV_DOT } from "@/components/app/EnvBadge"
import { PROBE_STATE, ProbeStateIcon, TONE_TEXT } from "@/components/app/StateBadge"
import { Truncate } from "@/components/app/Truncate"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { collectValues, ENV_ORDER, groupAssets, selectFilteredAssets, useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { isProbing, useProbeStore } from "@/stores/probe"
import { useSkillStore } from "@/stores/skills"
import { useUIStore, type AssetSort } from "@/stores/ui"

const LATER_TYPES: AssetType[] = ["domain", "panel", "storage"]
/** cmdk 根节点会接管这些键；筛选控件里按它们时不交给 cmdk */
const LIST_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "Enter", "PageUp", "PageDown"])

/** 非正常的探测状态在行内写出状态词（颜色不是唯一线索）；正常的只有图标和读屏文字 */
function stateWord(state: ProbeState, probing: boolean) {
  if (probing) return <span className="text-muted-foreground">{copy.probing}</span>
  if (state === "ok") return null
  return <span className={TONE_TEXT[PROBE_STATE[state].tone]}>{copy.probeState[state]}</span>
}

function AssetRow({
  asset,
  current,
  probing,
  mounts,
  fresh,
  onOpen,
}: {
  asset: Asset
  current: boolean
  probing: boolean
  mounts: number
  fresh: boolean
  onOpen: () => void
}) {
  return (
    <CommandItem
      value={asset.id}
      onSelect={onOpen}
      aria-current={current ? "true" : undefined}
      className="gap-2 py-1 hover:bg-muted/60 data-selected:bg-transparent aria-[current=true]:bg-muted! aria-[current=true]:font-medium group-data-[focused=true]/assets:data-selected:bg-muted! group-data-[focused=true]/assets:data-selected:inset-ring-1 group-data-[focused=true]/assets:data-selected:inset-ring-ring [&>svg:last-child]:hidden"
    >
      <motion.div
        className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2"
        initial={fresh ? { opacity: 0, y: 4 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <ProbeStateIcon state={asset.probe.status} probing={probing} className="row-span-2" />
        <Truncate text={asset.name} />
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {mounts > 0 && (
            <>
              <span aria-hidden>{copy.assets.mountCount(mounts)}</span>
              <span className="sr-only">{copy.assets.mountCountLabel(mounts)}</span>
            </>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
          <span className="max-w-[70%] shrink-0 truncate font-mono">{asset.connection.sshAlias}</span>
          {asset.facts.os && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{asset.facts.os}</span>
            </>
          )}
        </span>
        <span className="justify-self-end text-xs font-normal">{stateWord(asset.probe.status, probing)}</span>
      </motion.div>
    </CommandItem>
  )
}

/** 资产列表面板（PRD 6.4）：Command 负责键盘导航和 listbox 语义，筛选由 store 完成 */
export function AssetList({
  titleRef,
  searchRef,
  loading,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
  searchRef: RefObject<HTMLInputElement | null>
  loading: boolean
}) {
  const filter = useUIStore((s) => s.assetFilter)
  const sort = useUIStore((s) => s.assetSort)
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const { byId, ids, freshIds, failed } = useAssetStore(
    useShallow((s) => ({ byId: s.byId, ids: s.ids, freshIds: s.freshIds, failed: s.status === "error" }))
  )
  const skillByAsset = useSkillStore(
    useShallow((s) => Object.fromEntries(Object.values(s.statusById).map((k) => [k.assetId, k.id])))
  )
  const mountCount = useMountStore(
    useShallow((s) => {
      const counts: Record<string, number> = {}
      Object.values(s.byId).forEach((m) => (counts[m.skillId] = (counts[m.skillId] ?? 0) + 1))
      return counts
    })
  )
  const probingIds = useProbeStore(
    useShallow((s) => Object.keys(s.activeRunByAsset).filter((id) => isProbing(s, id)))
  )

  const groups = useMemo(() => groupAssets(selectFilteredAssets({ byId, ids }, filter), sort), [byId, ids, filter, sort])
  const allTags = useMemo(() => collectValues(Object.values(byId), (a) => a.tags), [byId])
  const filtered = filter.query !== "" || filter.types.length > 0 || filter.envTags.length > 0 || filter.tags.length > 0

  // 键盘高亮（cmdk 的 data-selected）只在列表有焦点时显示并跟着方向键走，另加焦点环，和「当前打开」
  // （aria-current，frost 底色 + 加粗）区分；失焦后高亮回到当前资产，下次从这里开始移动。
  // cmdk 在受控值匹配不到任何项时会自己选中第一项，所以没焦点时不显示高亮底色
  const [highlight, setHighlight] = useState(selectedAssetId ?? "")
  const [prevSelected, setPrevSelected] = useState(selectedAssetId)
  const [focused, setFocused] = useState(false)
  if (prevSelected !== selectedAssetId) {
    setPrevSelected(selectedAssetId)
    setHighlight(selectedAssetId ?? "")
  }

  const ui = useUIStore.getState
  const toggleIn = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...list, value] : list.filter((x) => x !== value)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
          {copy.nav.assets}
        </h1>
        <ButtonGroup className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => ui().startNewAsset()}>
            <PlusIcon data-icon="inline-start" />
            {copy.assets.newAsset}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon-sm" aria-label={copy.assets.moreCreate} />}
            >
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={() => ui().setImportOpen(true)}>
                <FileInputIcon />
                {copy.assets.importSsh}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>

      <Command
        shouldFilter={false}
        vimBindings={false}
        // cmdk 用这个 label 给搜索框命名（aria-labelledby），列表另有自己的 label
        label={copy.assets.searchLabel}
        value={highlight}
        onValueChange={(v) => focused && setHighlight(v)}
        data-focused={focused}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setFocused(false)
          setHighlight(selectedAssetId ?? "")
        }}
        className="group/assets min-h-0 flex-1 rounded-none! bg-transparent p-0"
      >
        {/* shadcn 的 CommandInput 只在命令面板里用，自身没有焦点环；列表里的搜索框要看得见焦点 */}
        <div className="px-2 [&:has([data-slot=command-input]:focus-visible)_[data-slot=input-group]]:border-ring [&:has([data-slot=command-input]:focus-visible)_[data-slot=input-group]]:ring-3 [&:has([data-slot=command-input]:focus-visible)_[data-slot=input-group]]:ring-ring/50">
          <CommandInput
            ref={searchRef}
            value={filter.query}
            onValueChange={(query) => ui().setFilter({ query })}
            placeholder={copy.assets.searchPlaceholder}
          />
        </div>

        <div
          className="flex flex-col gap-1.5 px-3 pt-2 pb-1"
          onKeyDown={(e) => LIST_KEYS.has(e.key) && e.stopPropagation()}
        >
          <ToggleGroup
            aria-label={copy.assets.typeFilter}
            variant="outline"
            size="sm"
            spacing={1}
            value={[filter.types[0] ?? "all"]}
            onValueChange={(v) => {
              const t = v[0]
              if (t) ui().setFilter({ types: t === "all" ? [] : [t as AssetType] })
            }}
            className="flex-wrap"
          >
            <ToggleGroupItem value="all" className="px-1.5">
              {copy.assets.typeAll}
            </ToggleGroupItem>
            <ToggleGroupItem value="vps" className="px-1.5">
              {copy.assets.type.vps}
            </ToggleGroupItem>
            {LATER_TYPES.map((t) => (
              <Tooltip key={t}>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <ToggleGroupItem value={t} disabled className="px-1.5">
                    {copy.assets.type[t]}
                    <span className="sr-only">（{copy.assets.typeLater}）</span>
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{copy.assets.typeLater}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>

          <div className="flex flex-wrap gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
                {filter.envTags.length
                  ? copy.assets.filterCount(copy.assets.envFilter, filter.envTags.length)
                  : copy.assets.envFilter}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-auto min-w-32">
                {ENV_ORDER.map((env) => (
                  <DropdownMenuCheckboxItem
                    key={env}
                    checked={filter.envTags.includes(env)}
                    onCheckedChange={(on) => ui().setFilter({ envTags: toggleIn(filter.envTags, env, on) })}
                  >
                    <CircleIcon className={cn("size-2! fill-current", ENV_DOT[env])} />
                    {copy.env.tag[env]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
                {filter.tags.length
                  ? copy.assets.filterCount(copy.assets.tagFilter, filter.tags.length)
                  : copy.assets.tagFilter}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-auto min-w-32">
                {allTags.length === 0 ? (
                  <DropdownMenuLabel>{copy.assets.noTags}</DropdownMenuLabel>
                ) : (
                  allTags.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag}
                      checked={filter.tags.includes(tag)}
                      onCheckedChange={(on) => ui().setFilter({ tags: toggleIn(filter.tags, tag, on) })}
                    >
                      {tag}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="xs" aria-label={`${copy.assets.sort}：${copy.assets.sortBy[sort]}`} />}
              >
                <ArrowDownUpIcon data-icon="inline-start" />
                {copy.assets.sortBy[sort]}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-auto min-w-32">
                <DropdownMenuLabel>{copy.assets.sort}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => ui().setAssetSort(v as AssetSort)}>
                  {(Object.keys(copy.assets.sortBy) as AssetSort[]).map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {copy.assets.sortBy[k]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-1 px-3 py-2" aria-busy="true" aria-label={copy.shell.loadingAssets}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <Skeleton className="size-4 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <CommandList label={copy.assets.listLabel} className="max-h-none min-h-0 flex-1 px-1.5 pb-2">
            <CommandEmpty className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
              {ids.length === 0 ? (
                <>
                  <ServerIcon className="size-4" aria-hidden />
                  {failed ? copy.assets.loadFailedTitle : copy.onboarding.title}
                </>
              ) : (
                <>
                  {copy.assets.noMatch}
                  {filtered && (
                    <Button variant="outline" size="sm" onClick={() => ui().resetFilter()}>
                      {copy.assets.clearFilter}
                    </Button>
                  )}
                </>
              )}
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.env} heading={copy.env.tag[g.env]}>
                {g.assets.map((a) => {
                  const skillId = skillByAsset[a.id]
                  return (
                    <AssetRow
                      key={a.id}
                      asset={a}
                      current={a.id === selectedAssetId}
                      probing={probingIds.includes(a.id)}
                      mounts={skillId ? (mountCount[skillId] ?? 0) : 0}
                      fresh={freshIds.includes(a.id)}
                      onOpen={() => ui().selectAsset(a.id)}
                    />
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        )}
      </Command>
    </div>
  )
}
