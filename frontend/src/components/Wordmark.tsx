import classes from "./Wordmark.module.css";

interface WordmarkProps {
  /**
   * The heading level to render. The login screen is the page's own title, so
   * `h1`; the app header sits above whichever view is showing and takes `h2`.
   * Only the level changes — the wordmark looks identical either way.
   */
  order?: 1 | 2;
  /** Layout from the caller — spacing, alignment. Never the font. */
  className?: string;
}

/**
 * "SALAMANDER", set in the brand face. It appears on the login card and in the
 * signed-in header, and the two must not drift, so the family, size, weight and
 * colour live here rather than at either call site.
 */
export function Wordmark({ order = 2, className }: WordmarkProps) {
  const Heading = order === 1 ? "h1" : "h2";
  return (
    <Heading className={className ? `${classes.wordmark} ${className}` : classes.wordmark}>
      SALAMANDER
    </Heading>
  );
}
