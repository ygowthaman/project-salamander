import classes from "./Wordmark.module.css";

interface WordmarkProps {
  order?: 1 | 2;
  className?: string;
}

export function Wordmark({ order = 2, className }: WordmarkProps) {
  const Heading = order === 1 ? "h1" : "h2";
  return (
    <Heading className={className ? `${classes.wordmark} ${className}` : classes.wordmark}>
      Salamander
    </Heading>
  );
}
