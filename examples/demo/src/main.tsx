import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { configureSound } from "react-isokit"
import "react-isokit/styles.css"
import "react-isokit/themes.css"
import "./styles/tokens.css"
import "./styles/base.css"
import "./styles/controls.css"
import "./styles/site.css"
import "./styles/design-system.css"
import { Site } from "./app/site"
import { themeStore } from "./app/theme-store"

configureSound({ defaultOn: true, storageKey: "isokit-demo:sound" })
themeStore.start()

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Site />
    </StrictMode>,
  )
}
