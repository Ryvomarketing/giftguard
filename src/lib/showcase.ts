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

export interface TourStep { id: string; view: 'home' | 'matches' | 'calls' | 'donors'; label: string; say: string; targets: string[]; }
export type TourLanguage = 'en' | 'es';

const dollars = (cents: number, language: TourLanguage) => new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

type TourInput = Pick<Snapshot, 'flags' | 'outreach' | 'matches' | 'today' | 'giftCount' | 'donors'> & { sourceCount: number };

/** A one-minute spoken walk through the workspace, told with this workspace's own numbers. Nothing in it changes data. */
export function tourSteps(data: TourInput, language: TourLanguage = 'en'): TourStep[] {
  const impact = impactSummary(data);
  const open = data.flags.filter(flag => needsOutreach(flag, data.outreach, data.today)).sort((a, b) => a.daysLate - b.daysLate);
  const example = open[0];
  const firstName = example ? example.name.split(' ')[0] : '';
  const views: TourStep['view'][] = ['home', 'matches', 'calls', 'donors', 'home'];
  const ids = ['tour-home', 'tour-matches', 'tour-calls', 'tour-donors', 'tour-ask'];
  const targets = [['impact-summary', 'overview-summary'], ['match-records', 'nav-matches'], ['follow-up-detail', 'follow-up-list'], ['donor-list'], ['voice-launcher', 'voice-panel']];
  const labels = language === 'es'
    ? ['Tu revisión semanal', 'Duplicados por revisar', 'Llamadas de esta semana', 'Todos los donantes', 'Solo pregúntame']
    : ['Your weekly review', 'Duplicates ready to review', 'Calls this week', 'All donors', 'Just ask'];
  let say: string[];
  if (language === 'es') {
    const cadence = example ? example.pattern === 'annual' ? 'anual' : example.pattern === 'quarterly' ? 'trimestral' : 'mensual' : '';
    const intro = impact.atRiskDonors || impact.duplicateGroups
      ? `Leí tus ${data.sourceCount} hojas de cálculo y ${data.giftCount.toLocaleString('es-US')} transacciones, y encontré ${dollars(impact.atRiskCents, 'es')} en donaciones recurrentes en riesgo y ${impact.duplicateGroups} ${impact.duplicateGroups === 1 ? 'donante que aparece' : 'donantes que aparecen'} más de una vez.`
      : `Leí tus ${data.sourceCount} hojas de cálculo y ${data.giftCount.toLocaleString('es-US')} transacciones. Nada está en riesgo esta semana y cada donante se cuenta una sola vez.`;
    say = [
      `Hola, soy GiftGuard. Esta es tu revisión semanal. ${intro}`,
      impact.duplicateGroups
        ? `Estas son las personas que aparecen en más de uno de tus archivos. Compara los nombres y los datos de contacto, y luego combínalos. Nada se fusiona hasta que tú lo confirmes.`
        : `Cuando la misma persona aparece en más de un archivo, aparece aquí. Tú comparas los datos y decides. Nada se fusiona hasta que tú lo confirmes.`,
      example
        ? `Estos son donantes recurrentes cuya donación no llegó cuando se esperaba. La donación ${cadence} de ${firstName} lleva ${example.daysLate} ${example.daysLate === 1 ? 'día' : 'días'} de retraso. Cada persona viene con el motivo, sus datos de contacto y una nota que puedes editar y enviar.`
        : `Cuando la donación de un donante recurrente no llega, aparece aquí con el motivo, sus datos de contacto y una nota que puedes editar y enviar.`,
      `Cada donante y cada donación, en una sola lista con buscador: ${data.donors.length} donantes hasta ahora. Abre cualquier nombre para ver el historial completo y una línea de tiempo que muestra exactamente dónde faltó una donación.`,
      `Y simplemente puedes preguntarme. Di "¿quién es nuestro mayor donante?", "abre la lista de llamadas" o "redacta una nota de agradecimiento". Yo hago los clics, y nunca envío ni cambio nada sin ti.`,
    ];
  } else {
    const cadence = example ? example.pattern === 'annual' ? 'yearly' : example.pattern === 'quarterly' ? 'quarterly' : 'monthly' : '';
    const intro = impact.atRiskDonors || impact.duplicateGroups
      ? `I read your ${plural(data.sourceCount, 'spreadsheet')} and ${plural(data.giftCount, 'transaction')}, and found ${dollars(impact.atRiskCents, 'en')} in regular giving at risk and ${plural(impact.duplicateGroups, 'donor')} who appear more than once.`
      : `I read your ${plural(data.sourceCount, 'spreadsheet')} and ${plural(data.giftCount, 'transaction')}. Nothing is at risk this week and every donor is counted once.`;
    say = [
      `Hi, I'm GiftGuard. This is your weekly review. ${intro}`,
      impact.duplicateGroups
        ? `These are the people who show up in more than one of your files. Compare the names and contact details, then combine them. Nothing merges until you confirm it yourself.`
        : `When the same person shows up in more than one file, they appear here. You compare the details and decide. Nothing merges until you confirm it yourself.`,
      example
        ? `These are regular givers whose gift did not arrive when expected. ${firstName}'s ${cadence} gift is ${plural(example.daysLate, 'day')} late. Each person comes with the reason, their contact details, and a note you can edit and send.`
        : `When a regular giver's gift does not arrive, they appear here with the reason, their contact details, and a note you can edit and send.`,
      `Every donor and every gift, in one searchable list, ${plural(data.donors.length, 'donor')} so far. Open any name for the full history and a giving timeline that shows exactly where a gift went missing.`,
      `And you can simply ask me. Say "who is our biggest donor", "open the call list", or "draft a thank-you note". I do the clicking, and I never send or change anything without you.`,
    ];
  }
  return views.map((view, index) => ({ id: ids[index], view, label: labels[index], say: say[index], targets: targets[index] }));
}
