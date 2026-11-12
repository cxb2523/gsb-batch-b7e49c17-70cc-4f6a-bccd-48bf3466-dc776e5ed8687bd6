export interface DocArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  readingTime: string;
  content: string;
}

export interface DocCategory {
  id: string;
  title: string;
  articles: DocArticle[];
}

export interface TocItem {
  id: string;
  text: string;
  level: number;
}
