interface Props {
  value: string;
  tone?: 'plain' | 'before' | 'after';
  label?: string;
}

/** Renders a cell value as literal text. Empty strings are named so blanks stay visible. */
export function ValueChip({ value, tone = 'plain', label }: Props) {
  const className = ['chip', tone === 'plain' ? '' : tone, value.length === 0 ? 'empty' : ''].filter(Boolean).join(' ');
  return (
    <span className={className} aria-label={label ? `${label}: ${value.length === 0 ? 'empty' : value}` : undefined}>
      {value.length === 0 ? 'empty' : value}
    </span>
  );
}
