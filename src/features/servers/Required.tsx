/** 必填标记：「*」只给眼睛看，读屏靠控件上的 aria-required */
export function Required() {
  return (
    <span aria-hidden className="text-muted-foreground">
      *
    </span>
  )
}
