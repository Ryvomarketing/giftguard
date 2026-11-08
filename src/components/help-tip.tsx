'use client';

import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button type="button" className="help-trigger" aria-label={`About ${label}`} onClick={event => { event.preventDefault(); setOpen(value => !value); }}>
          <Info size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8} className="help-content">{children}</TooltipContent>
    </Tooltip>
  );
}
