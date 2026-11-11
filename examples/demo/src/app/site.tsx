import { lazy, type ReactNode, Suspense, useEffect } from "react"
import { ComponentsPage } from "../pages/components-page"
import { DesignSystemPage } from "../pages/design-system-page"
import { FigurePage } from "../pages/figure-page"
import { FiguresPage } from "../pages/figures-page"
import { HomePage } from "../pages/home-page"
import { LabFigurePage } from "../pages/lab-figure-page"
import { LabPage } from "../pages/lab-page"
import { SoundPage } from "../pages/sound-page"
import { StudioPage } from "../pages/studio-page"
import { useRoute } from "./route-store"
import { SiteFooter } from "./site-footer"
import { SiteHeader } from "./site-header"

const PAGES = ["figures", "studio", "lab", "components", "sound", "design-system", "bench"] as const
type Page = (typeof PAGES)[number]
const BenchPage = import.meta.env.DEV ? lazy(() => import("../pages/bench-page")) : null
const PAGE_SET: ReadonlySet<string> = new Set(BenchPage ? PAGES : PAGES.filter((page) => page !== "bench"))
const isPage = (segment: string | undefined): segment is Page => segment !== undefined && PAGE_SET.has(segment)

function PageBody({ page, slug }: { page: Page; slug: string | undefined }): ReactNode {
  switch (page) {
    case "design-system":
      return <DesignSystemPage />
    case "figures":
      return slug ? <FigurePage slug={slug} /> : <FiguresPage />
    case "studio":
      return <StudioPage />
    case "lab":
      return slug ? <LabFigurePage slug={slug} /> : <LabPage />
    case "components":
      return <ComponentsPage slug={slug} />
    case "sound":
      return <SoundPage focus={slug} />
    case "bench":
      return BenchPage ? (
        <Suspense fallback={null}>
          <BenchPage />
        </Suspense>
      ) : null
  }
}

export function Site(): ReactNode {
  const [page, slug] = useRoute()
  const where = isPage(page) ? `${page}/${slug ?? ""}` : page === undefined ? "/" : null
  useEffect(() => {
    if (where && !(page === "sound" && slug)) window.scrollTo({ top: 0, behavior: "instant" })
  }, [where, page, slug])
  if (!isPage(page)) return <HomePage />
  return (
    <>
      <SiteHeader current={page} />
      <PageBody page={page} slug={slug} />
      <SiteFooter />
    </>
  )
}
