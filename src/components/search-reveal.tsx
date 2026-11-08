'use client';

import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = { value: string; onChange: (value: string) => void; placeholder: string; label: string; disabled?: boolean; className?: string };

/** The one search control used everywhere: a magnifier that opens into a field, and folds away again when empty. */
export function SearchReveal({ value, onChange, placeholder, label, disabled = false, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const expanded = open || value.length > 0;
  return (
    <div className={`search-reveal ${expanded ? 'open' : ''} ${className}`}>
      <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={expanded ? `Hide ${label.toLowerCase()}` : label} aria-expanded={expanded} onClick={() => {
        if (expanded && !value) { setOpen(false); return; }
        if (expanded && value) { onChange(''); setOpen(false); return; }
        setOpen(true); requestAnimationFrame(() => input.current?.focus());
      }}><Search size={16} /></Button>
      <Input ref={input} className="search-input" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { onChange(''); setOpen(false); (event.target as HTMLInputElement).blur(); } }} onBlur={() => { if (!value) setOpen(false); }} placeholder={placeholder} aria-label={label} tabIndex={expanded ? 0 : -1} />
    </div>
  );
}
