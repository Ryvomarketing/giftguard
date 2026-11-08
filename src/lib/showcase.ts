import { needsOutreach } from './outreach';
import type { Gift, LateFlag, MatchCandidate, Outreach, Snapshot } from './types';

/** The two numbers a nonprofit feels: giving at risk and donors counted twice. Both come from the real flags and matches. */
export interface ImpactSummary { atRiskCents: number; atRiskDonors: number; duplicateGroups: number; duplicateRecords: number; }

type ImpactInput = Pick<Snapshot, 'flags' | 'outreach' | 'matches' | 'today'>;

export function impactSummary(data: ImpactInput): ImpactSummary {
  const open = data.flags.filter(flag => needsOutreach(flag, data.outreach, data.today));
  const pending = data.matches.filter(match => match.status === 'pending');
  return {
    atRiskCents: open.reduce((sum, flag) => sum + flag.annualValueCents, 0),
    atRiskDonors: open.length,
    duplicateGroups: pending.length,
    duplicateRecords: pending.reduce((sum, match) => sum + match.recordIds.length, 0),
  };
}

export interface TimelineMonth { month: string; label: string; cents: number; count: number; purchaseOnly: boolean; expectedMissing: boolean; isToday: boolean; }

const monthKey = (date: string) => date.slice(0, 7);
const shortMonth = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** The last `months` calendar months ending with the workspace date. The flagged expected month is marked only when nothing arrived in it. */
export function timelineMonths(gifts: Pick<Gift, 'date' | 'amountCents' | 'kind'>[], today: string, flag?: Pick<LateFlag, 'expectedDate'> | null, months = 24): TimelineMonth[] {
  const end = new Date(`${monthKey(today)}-01T00:00:00Z`);
  const totals = new Map<string, { cents: number; count: number; donations: number }>();
  for (const gift of gifts) {
    const key = monthKey(gift.date);
    const entry = totals.get(key) ?? { cents: 0, count: 0, donations: 0 };
    entry.cents += gift.amountCents; entry.count += 1; if (gift.kind !== 'purchase') entry.donations += 1;
    totals.set(key, entry);
  }
  const expected = flag ? monthKey(flag.expectedDate) : null;
  const result: TimelineMonth[] = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset, 1));
    const key = date.toISOString().slice(0, 7);
    const entry = totals.get(key);
    result.push({
      month: key, label: shortMonth(key), cents: entry?.cents ?? 0, count: entry?.count ?? 0,
      purchaseOnly: !!entry && entry.donations === 0,
      expectedMissing: expected === key && !entry,
      isToday: key === monthKey(today),
    });
  }
  return result;
}

export interface TourStep { id: string; view: 'home' | 'matches' | 'calls' | 'donors' | 'events'; label: string; say: string; targets: string[]; eventId?: string; }
export type TourLanguage = 'en' | 'es';

const dollars = (cents: number, language: TourLanguage) => new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
/** Spoken amounts are rounded down to a clean figure: "over $6,000", not "$6,270". */
const roughDollars = (cents: number, language: TourLanguage) => {
  const whole = Math.floor(cents / 100);
  const unit = whole >= 1000 ? 1000 : 100;
  const floor = Math.floor(whole / unit) * unit;
  const text = dollars(floor * 100, language);
  if (floor === whole || floor === 0) return dollars(cents, language);
  return language === 'es' ? `más de ${text}` : `over ${text}`;
};
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

type TourInput = Pick<Snapshot, 'flags' | 'outreach' | 'matches' | 'today' | 'giftCount' | 'donors' | 'events'> & { sourceCount: number };

/** A one-minute spoken walk through the workspace, told with this workspace's own numbers and kept to about 175 words so it fits. Nothing in it changes data. */
export function tourSteps(data: TourInput, language: TourLanguage = 'en'): TourStep[] {
  const impact = impactSummary(data);
  const open = data.flags.filter(flag => needsOutreach(flag, data.outreach, data.today)).sort((a, b) => a.daysLate - b.daysLate);
  const example = open[0];
  const firstName = example ? example.name.split(' ')[0] : '';
  // The sign-up list with the most guests is the one worth showing; its guest preview and QR code render once it is selected.
  const event = [...data.events].sort((a, b) => b.signups.length - a.signups.length || b.date.localeCompare(a.date))[0];
  const guests = event?.signups.length ?? 0;
  const known = event?.signups.filter(signup => signup.matchDonorId).length ?? 0;
  const views: TourStep['view'][] = ['home', 'matches', 'calls', 'donors', 'events', 'home'];
  const ids = ['tour-home', 'tour-matches', 'tour-calls', 'tour-donors', 'tour-events', 'tour-ask'];
  const targets = [['impact-summary', 'overview-summary'], ['match-records', 'nav-matches'], ['follow-up-detail', 'follow-up-list'], ['donor-list'], event ? ['event-preview', 'event-detail', 'event-list'] : ['event-list', 'nav-events'], ['voice-launcher', 'voice-panel']];
  const labels = language === 'es'
    ? ['Bienvenidos a GiftGuard', 'Duplicados por revisar', 'Llamadas de esta semana', 'Todos los donantes', 'Eventos e inscripciones', 'Pregúntame lo que sea']
    : ['Welcome to GiftGuard', 'Duplicates ready to review', 'Calls this week', 'All donors', 'Events and sign-ups', 'Just ask'];
  let say: string[];
  if (language === 'es') {
    const cadence = example ? example.pattern === 'annual' ? 'anual' : example.pattern === 'quarterly' ? 'trimestral' : 'mensual' : '';
    const intro = impact.atRiskDonors || impact.duplicateGroups
      ? `Ya leí tus ${data.sourceCount} hojas de cálculo y ${data.giftCount.toLocaleString('es-US')} transacciones. Lo importante: ${roughDollars(impact.atRiskCents, 'es')} en donaciones de siempre en riesgo, y ${impact.duplicateGroups} ${impact.duplicateGroups === 1 ? 'donante que aparece' : 'donantes que aparecen'} más de una vez.`
      : `Ya leí tus ${data.sourceCount} hojas de cálculo y ${data.giftCount.toLocaleString('es-US')} transacciones. Nada en riesgo esta semana, y cada donante se cuenta una sola vez. ¡Todo bien!`;
    say = [
      `¡Qué más! Bienvenidos a GiftGuard. ${intro}`,
      impact.duplicateGroups
        ? `Mira, estas personas aparecen en más de un archivo. Compáralas y júntalas. Tranquilo, nada se une hasta que tú digas que sí.`
        : `Cuando una misma persona aparece en varios archivos, sale aquí. Tú decides. Nada se une hasta que tú digas que sí.`,
      example
        ? `Estos donan seguido, pero esta vez no llegó la plata. La donación ${cadence} de ${firstName} lleva ${example.daysLate} ${example.daysLate === 1 ? 'día' : 'días'} de retraso. Cada uno trae el motivo, su contacto y una notica lista para enviar.`
        : `Cuando a alguien que dona seguido no le llega la donación, sale aquí con el motivo, su contacto y una notica lista para enviar.`,
      `Todos tus donantes y donaciones en una sola lista con buscador: ${data.donors.length} donantes hasta ahora. Abre un nombre y ves su historial, con una línea de tiempo que muestra dónde faltó la plata.`,
      event
        ? `Y la gente nueva entra limpia desde el primer día. Para ${event.name} armamos una página de inscripción y un código QR en segundos. ${guests} ${guests === 1 ? 'invitado se anotó' : 'invitados se anotaron'} desde el celular${known ? `, ${known} ya ${known === 1 ? 'era donante conocido' : 'eran donantes conocidos'}: los emparejamos solitos` : ''}. A la derecha, lo que ve el invitado.`
        : `Y la gente nueva entra limpia desde el primer día. Dime "tengo una gala el 21 de noviembre, hazme una lista de inscripción" y en segundos tienes la página para invitados y el código QR, con cada inscrito emparejado con tus donantes.`,
      `Y lo mejor: solo pregúntame. Quién es nuestro mayor donante, ábreme las llamadas, o hazme una nota de agradecimiento. Yo hago los clics, y nunca envío ni cambio nada sin tu permiso. ¡Listo!`,
    ];
  } else {
    const cadence = example ? example.pattern === 'annual' ? 'yearly' : example.pattern === 'quarterly' ? 'quarterly' : 'monthly' : '';
    const intro = impact.atRiskDonors || impact.duplicateGroups
      ? `Your ${plural(data.sourceCount, 'spreadsheet')} and ${plural(data.giftCount, 'transaction')} are in. What matters: ${roughDollars(impact.atRiskCents, 'en')} in regular giving at risk, and ${plural(impact.duplicateGroups, 'donor')} who appear more than once.`
      : `Your ${plural(data.sourceCount, 'spreadsheet')} and ${plural(data.giftCount, 'transaction')} are in. Nothing is at risk this week, and every donor is counted once.`;
    say = [
      `Welcome to GiftGuard! ${intro}`,
      impact.duplicateGroups
        ? `These people show up in more than one file. Compare, then combine. Nothing merges until you confirm.`
        : `When the same person shows up in more than one file, they appear here. You decide. Nothing merges until you confirm.`,
      example
        ? `Regular givers whose gift did not arrive. ${firstName}'s ${cadence} gift is ${plural(example.daysLate, 'day')} late. Each comes with the reason, contact details, and a note ready to send.`
        : `When a regular giver's gift does not arrive, they appear here with the reason, contact details, and a note ready to send.`,
      `Every donor and every gift in one searchable list, ${plural(data.donors.length, 'donor')} so far. Open a name for the full history and a timeline showing where a gift went missing.`,
      event
        ? `New names come in clean from day one. ${event.name} got a sign-up page and QR code in seconds. ${plural(guests, 'guest')} signed up on their phones${known ? `, ${known} already known donors, matched automatically` : ''}. On the right, what a guest sees.`
        : `New names come in clean from day one. Say "I have a gala on November 21, make me a sign-up list" and in seconds you have a guest page and a QR code, every sign-up matched against your donors.`,
      `And just ask me: who is our biggest donor, open the call list, draft a thank-you note. I do the clicking, and I never send or change anything without you.`,
    ];
  }
  return views.map((view, index) => ({ id: ids[index], view, label: labels[index], say: say[index], targets: targets[index], ...(view === 'events' && event ? { eventId: event.id } : {}) }));
}
