import { articleBySlug } from './content.js';

export function articleSummary(slug) {
  const article = articleBySlug(slug);
  return article ? `${article.label}: ${article.body}` : 'Article not found';
}

export function markArticleReady(element) {
  if (element) element.dataset.ready = 'true';
}
