import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"

import "./index.css"
import App from "./App.tsx"
import { BackendGate } from "@/components/app/BackendGate"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"

async function bootstrap() {
  // Mock 模式（pnpm dev:mock）：先装好 mockIPC，再订阅事件、渲染（PRD 7.8）。动态导入，正式构建不打包夹具
  if (import.meta.env.VITE_MOCK === "1") {
    const { installMocks } = await import("@/mocks/install")
    installMocks()
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <MotionConfig
          reducedMotion="user"
          transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
        >
          <TooltipProvider>
            <Toaster closeLabel={copy.common.close}>
              <BackendGate>
                <App />
              </BackendGate>
            </Toaster>
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </StrictMode>
  )
}

void bootstrap()
