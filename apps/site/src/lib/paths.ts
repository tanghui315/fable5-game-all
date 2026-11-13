import { getSiteData } from './data';

/** getStaticPaths helper shared by the English and Chinese detail wrappers. */
export function gameStaticPaths() {
  return getSiteData().games.map((view) => ({
    params: { slug: view.game.slug },
    props: { id: view.game.id },
  }));
}

/** getStaticPaths helper shared by the English and Chinese author wrappers. */
export function authorStaticPaths() {
  return getSiteData().authors.map((author) => ({
    params: { author: author.id },
    props: { id: author.id },
  }));
}
