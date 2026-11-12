import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Search,
  BookOpen,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  Clock,
  Menu,
  X,
  ExternalLink,
  Layers,
  Server,
  Database,
  FileCode2,
} from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { DEFAULT_DOC_SLUG, DOC_CATEGORIES, getDocArticle } from '@/docs/content';
import { DocRenderer } from '@/docs/DocRenderer';
import type { TocItem, DocArticle } from '@/docs/types';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  architecture: (
    <div className="w-4 h-4 rounded bg-brand-subtle grid place-items-center text-brand-strong">
      <Layers className="w-2.5 h-2.5" />
    </div>
  ),
  deployment: (
    <div className="w-4 h-4 rounded bg-avatar-blue-bg grid place-items-center text-ink-tertiary">
      <Server className="w-2.5 h-2.5" />
    </div>
  ),
  storage: (
    <div className="w-4 h-4 rounded bg-success-subtle grid place-items-center text-success">
      <Database className="w-2.5 h-2.5" />
    </div>
  ),
  reference: (
    <div className="w-4 h-4 rounded bg-warning-subtle grid place-items-center text-warning">
      <FileCode2 className="w-2.5 h-2.5" />
    </div>
  ),
};

export function Docs() {
  const { slug } = useParams<{ slug?: string }>();

  // The first article when no slug is given
  const activeSlug = slug || DEFAULT_DOC_SLUG;
  const activeArticle = getDocArticle(activeSlug);

  // Scroll to top when active article changes
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeSlug]);

  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [headings, setHeadings] = useState<TocItem[]>([]);

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  const handleHeadingsExtracted = useCallback((newHeadings: TocItem[]) => {
    setHeadings(newHeadings);
  }, []);

  // Filter articles based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return DOC_CATEGORIES;

    const query = searchQuery.toLowerCase();
    return DOC_CATEGORIES.map((cat) => ({
      ...cat,
      articles: cat.articles.filter(
        (art) =>
          art.title.toLowerCase().includes(query) ||
          art.description.toLowerCase().includes(query) ||
          art.content.toLowerCase().includes(query),
      ),
    })).filter((cat) => cat.articles.length > 0);
  }, [searchQuery]);

  // Flattened article list for Prev / Next calculation
  const allArticlesList = useMemo(() => {
    return DOC_CATEGORIES.flatMap((c) => c.articles);
  }, []);

  const currentIndex = allArticlesList.findIndex((a) => a.slug === activeArticle.slug);
  const prevArticle: DocArticle | null =
    currentIndex > 0 ? (allArticlesList[currentIndex - 1] ?? null) : null;
  const nextArticle: DocArticle | null =
    currentIndex >= 0 && currentIndex < allArticlesList.length - 1
      ? (allArticlesList[currentIndex + 1] ?? null)
      : null;

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      {/* Shared Public Header identical to homepage */}
      <PublicHeader fixed={true} />

      {/* Mobile Sub-Header for Docs Navigation & Breadcrumbs */}
      <div className="md:hidden w-full bg-surface-warm border-b border-border px-4 py-2.5 flex items-center justify-between text-xs pt-16">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-white border border-border-strong rounded-md text-ink font-medium shadow-2xs"
          aria-label="Toggle documentation navigation"
        >
          {mobileMenuOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          <span>Docs Menu</span>
        </button>
        <div className="flex items-center gap-1.5 text-ink-muted font-mono text-[11px] truncate max-w-[200px]">
          <span>Docs</span>
          <span className="text-border-strong">/</span>
          <span className="text-ink font-semibold truncate">{activeArticle.title}</span>
        </div>
      </div>

      {/* Main 3-Column Documentation Hub (94rem max width matching Canvas page) */}
      <div className="flex-1 w-full max-w-[94rem] mx-auto md:pt-14 sm:md:pt-16 flex items-start">
        {/* Left Sidebar: Grouped Category Navigation */}
        <aside
          className={`${
            mobileMenuOpen ? 'block fixed inset-x-0 bottom-0 top-14 bg-white z-50 p-4' : 'hidden'
          } md:block w-full md:w-64 lg:w-72 shrink-0 bg-surface-warm md:bg-transparent border-r border-border md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:self-start overflow-y-auto transition-all`}
        >
          {/* Search Box Header */}
          <div className="p-4 border-b border-border sticky top-0 bg-surface-warm/95 backdrop-blur-xs z-10">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documentation..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-border-strong rounded-lg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-tile transition-all placeholder:text-ink-subtle font-mono text-ink"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Grouped Category Navigation List */}
          <nav
            className="p-3 sm:p-4 flex flex-col gap-5 text-xs"
            aria-label="Documentation navigation"
          >
            {filteredCategories.length === 0 ? (
              <div className="p-4 text-center text-ink-subtle font-mono text-xs">
                No articles found matching "{searchQuery}"
              </div>
            ) : (
              filteredCategories.map((category) => {
                const isCollapsed = collapsedCategories[category.id];
                return (
                  <div key={category.id} className="flex flex-col gap-1">
                    {/* Category Group Header */}
                    <button
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-ink-muted hover:text-ink font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer rounded-md hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-2">
                        {CATEGORY_ICONS[category.id] || <BookOpen className="w-3.5 h-3.5" />}
                        <span>{category.title}</span>
                      </div>
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 text-ink-subtle" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-ink-subtle" />
                      )}
                    </button>

                    {/* Category Articles */}
                    {!isCollapsed && (
                      <ul className="flex flex-col gap-0.5 pl-2.5 border-l border-border ml-3.5 my-1">
                        {category.articles.map((art) => {
                          const isActive = art.slug === activeArticle.slug;
                          return (
                            <li key={art.slug}>
                              <Link
                                to={`/docs/${art.slug}`}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`block px-2.5 py-1.5 transition-all text-xs rounded-md ${
                                  isActive
                                    ? 'bg-ink text-white font-semibold shadow-xs'
                                    : 'text-ink-muted hover:text-ink hover:bg-surface-2'
                                }`}
                              >
                                {art.title}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </nav>
        </aside>

        {/* Center Main Content Pane */}
        <main className="flex-1 min-w-0 px-6 sm:px-10 lg:px-12 py-8 max-w-4xl">
          {/* Article Header Meta */}
          <div className="mb-8 pb-6 border-b border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="font-mono text-[10px] text-brand-strong bg-brand-subtle border border-brand-border px-2.5 py-0.5 rounded-md uppercase tracking-wider font-semibold">
                {activeArticle.category}
              </span>
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-ink-muted">
                <Clock className="w-3.5 h-3.5 text-ink-subtle" />
                <span>{activeArticle.readingTime}</span>
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              {activeArticle.title}
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-ink-muted leading-relaxed">
              {activeArticle.description}
            </p>
          </div>

          {/* Rendered Documentation Body */}
          <DocRenderer
            markdown={activeArticle.content}
            onHeadingsExtracted={handleHeadingsExtracted}
          />

          {/* Prev / Next Article Footer Navigation */}
          <div className="mt-14 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
            {prevArticle ? (
              <Link
                to={`/docs/${prevArticle.slug}`}
                className="group flex flex-col p-4 sm:p-5 bg-white border border-border hover:border-border-strong hover:shadow-[0_4px_20px_rgba(23,34,56,0.03)] hover:-translate-y-0.5 transition-all rounded-xl shadow-2xs"
              >
                <span className="font-mono text-[10px] text-ink-subtle uppercase tracking-wider flex items-center gap-1 group-hover:text-ink-muted transition-colors">
                  <ArrowLeft className="w-3 h-3" />
                  <span>Previous</span>
                </span>
                <span className="mt-1.5 text-sm font-semibold text-ink group-hover:text-ink-hover line-clamp-1">
                  {prevArticle.title}
                </span>
              </Link>
            ) : (
              <div />
            )}

            {nextArticle && (
              <Link
                to={`/docs/${nextArticle.slug}`}
                className="group flex flex-col items-end text-right p-4 sm:p-5 bg-white border border-border hover:border-border-strong hover:shadow-[0_4px_20px_rgba(23,34,56,0.03)] hover:-translate-y-0.5 transition-all rounded-xl shadow-2xs"
              >
                <span className="font-mono text-[10px] text-ink-subtle uppercase tracking-wider flex items-center gap-1 group-hover:text-ink-muted transition-colors">
                  <span>Next</span>
                  <ArrowRight className="w-3 h-3" />
                </span>
                <span className="mt-1.5 text-sm font-semibold text-ink group-hover:text-ink-hover line-clamp-1">
                  {nextArticle.title}
                </span>
              </Link>
            )}
          </div>
        </main>

        {/* Right Rail: "On this page" TOC Sidebar */}
        <aside className="hidden xl:block w-64 shrink-0 p-6 sticky top-16 h-[calc(100vh-4rem)] self-start overflow-y-auto">
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] font-bold text-ink-muted uppercase tracking-wider">
              On this page
            </span>

            {headings.length === 0 ? (
              <span className="text-xs text-ink-subtle italic">Overview</span>
            ) : (
              <ul className="flex flex-col gap-2 text-xs text-ink-muted border-l border-border pl-3">
                {headings.map((h) => (
                  <li key={h.id} className={h.level === 3 ? 'pl-2' : ''}>
                    <a href={`#${h.id}`} className="hover:text-ink transition-colors line-clamp-1">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {/* Quick Links & Community Card */}
            <div className="mt-8 pt-5 border-t border-border flex flex-col gap-2.5 text-xs text-ink-muted">
              <span className="font-mono text-[10px] text-ink-subtle uppercase tracking-wider">
                Community
              </span>
              <a
                href="https://github.com/qaribhaider/canvhq"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
              >
                <span>Edit on GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <Link
                to="/security"
                className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
              >
                <span>Security Architecture</span>
              </Link>
              <Link
                to="/terms"
                className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
              >
                <span>Terms & Privacy</span>
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {/* Persistent Bottom Dock Bar with 94rem max width */}
      <PublicFooter />
    </div>
  );
}
