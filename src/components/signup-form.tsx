'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

export type PublicEvent = { code: string; name: string; host: string; date: string };
type Props = { event: PublicEvent; preview?: boolean; initialLanguage?: 'en' | 'es' };

const copy = {
  en: { welcome: 'Welcome', signup: 'Sign up for', hosted: 'Hosted by', name: 'Full name', email: 'Email', phone: 'Mobile phone', zip: 'ZIP code', language: 'Preferred language', pledge: 'Pledge tonight (optional)', pledgeHint: 'A pledge is a promise, not a payment. Staff will follow up.', consent: 'You may keep my details and contact me about this event and future ones.', submit: 'Add me to the list', previewSubmit: 'Preview only', sending: 'Adding you…', thanks: 'You’re on the list.', thanksBody: 'Thank you. A staff member will be in touch.', another: 'Sign up another guest', privacy: 'Your details go only to the organization hosting this event.', english: 'English', spanish: 'Español', required: 'Name and an email or phone are required.' },
  es: { welcome: 'Bienvenido', signup: 'Inscríbete para', hosted: 'Organiza', name: 'Nombre completo', email: 'Correo electrónico', phone: 'Teléfono móvil', zip: 'Código postal', language: 'Idioma preferido', pledge: 'Promesa de donación esta noche (opcional)', pledgeHint: 'Una promesa no es un pago. El equipo te contactará.', consent: 'Pueden guardar mis datos y contactarme sobre este evento y otros futuros.', submit: 'Agregarme a la lista', previewSubmit: 'Solo vista previa', sending: 'Agregando…', thanks: 'Ya estás en la lista.', thanksBody: 'Gracias. Alguien del equipo se comunicará contigo.', another: 'Inscribir a otra persona', privacy: 'Tus datos van únicamente a la organización que organiza este evento.', english: 'English', spanish: 'Español', required: 'Se requiere el nombre y un correo o teléfono.' },
};

const longDate = (date: string, language: 'en' | 'es') => new Date(`${date}T12:00:00Z`).toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The page a guest sees. In preview mode nothing is sent; staff use it to check what guests will be asked. */
export function SignupForm({ event, preview = false, initialLanguage = 'en' }: Props) {
  const [language, setLanguage] = useState<'en' | 'es'>(initialLanguage);
  const [form, setForm] = useState({ name: '', email: '', phone: '', zip: '', pledge: '', consent: false });
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  const t = copy[language];
  const update = (field: keyof typeof form, value: string | boolean) => setForm(previous => ({ ...previous, [field]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return;
    setError(''); setState('sending');
    try {
      const response = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: event.code, ...form, language }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t.required);
      setState('done');
    } catch (err) { setState('idle'); setError(err instanceof Error ? err.message : t.required); }
  }
  const id = (field: string) => `${preview ? 'preview' : 'signup'}-${event.code}-${field}`;
  return (
    <div className={`signup-card ${preview ? 'is-preview' : ''}`} lang={language} aria-label={preview ? 'Preview of the guest sign-up page' : undefined}>
      <div className="signup-brand"><span className="signup-wordmark">GiftGuard<span>.</span></span><div className="signup-lang" role="group" aria-label={t.language}><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>{t.english}</button><button type="button" className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')}>{t.spanish}</button></div></div>
      <p className="signup-kicker">{t.signup}</p>
      <h1 className="signup-title">{event.name}</h1>
      <p className="signup-meta">{longDate(event.date, language)}{event.host ? ` · ${t.hosted} ${event.host}` : ''}</p>
      {state === 'done' ? (
        <div className="signup-done" role="status"><span className="signup-check"><Check size={22} /></span><h2>{t.thanks}</h2><p>{t.thanksBody}</p><button type="button" className="signup-link" onClick={() => { setForm({ name: '', email: '', phone: '', zip: '', pledge: '', consent: false }); setState('idle'); }}>{t.another}</button></div>
      ) : (
        <form className="signup-form" onSubmit={submit} noValidate>
          <label htmlFor={id('name')}>{t.name}<input id={id('name')} autoComplete="name" value={form.name} onChange={e => update('name', e.target.value)} required /></label>
          <div className="signup-row">
            <label htmlFor={id('email')}>{t.email}<input id={id('email')} type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => update('email', e.target.value)} /></label>
            <label htmlFor={id('phone')}>{t.phone}<input id={id('phone')} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={e => update('phone', e.target.value)} /></label>
          </div>
          <div className="signup-row">
            <label htmlFor={id('zip')}>{t.zip}<input id={id('zip')} inputMode="numeric" autoComplete="postal-code" value={form.zip} onChange={e => update('zip', e.target.value)} /></label>
            <label htmlFor={id('pledge')}>{t.pledge}<input id={id('pledge')} inputMode="decimal" placeholder="$" value={form.pledge} onChange={e => update('pledge', e.target.value)} /></label>
          </div>
          <p className="signup-hint">{t.pledgeHint}</p>
          <label className="signup-consent"><input type="checkbox" checked={form.consent} onChange={e => update('consent', e.target.checked)} required /><span>{t.consent}</span></label>
          {error && <p className="signup-error" role="alert">{error}</p>}
          <button type="submit" className="signup-submit" disabled={preview || state === 'sending'} aria-disabled={preview}>{state === 'sending' ? <><Loader2 className="loading-spinner" size={16} />{t.sending}</> : preview ? t.previewSubmit : t.submit}</button>
          <p className="signup-privacy">{t.privacy}</p>
        </form>
      )}
    </div>
  );
}
