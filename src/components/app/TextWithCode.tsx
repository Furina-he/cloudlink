/** 把文案里反引号包住的命令按等宽渲染（活动标题，PRD 6.7「Agent 在 hk-edge 上执行的 `docker restart api` 被护栏拦下」） */
export function TextWithCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="font-mono text-[0.8125rem]">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  )
}
