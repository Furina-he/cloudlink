// 手写契约（PRD F-308）：Agent 笔记收件箱
export type AgentNoteFlag = "secret" | "injection"

export interface AgentNote {
  id: string
  assetId: string
  /** 行首日期之后的正文，纯文本 */
  text: string
  /** 取行首日期，没有日期时取读入时间 */
  writtenAt: string
  /** 命中密钥的笔记必须编辑后才能并入 */
  flags: AgentNoteFlag[]
  status: "pending" | "merged" | "dismissed"
}
