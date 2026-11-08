export type Source = 'online' | 'event' | 'auction' | 'check';
export type Confidence = 'High' | 'Medium' | 'Low';
export type ContactStatus = 'Called' | 'Emailed' | 'Left message' | 'Snoozed';
export interface SourceRecord { id: string; donorId: string; source: Source; sourceFile: string; name: string; email: string; phone: string; address: string; zip: string; language: 'en' | 'es'; }
export interface Gift { id: string; recordId: string; date: string; amountCents: number; recurring: boolean; source: Source; sourceFile: string; program: string; kind: 'donation' | 'purchase'; }
export interface Donor { id: string; name: string; email: string; phone: string; address: string; language: 'en' | 'es'; records: SourceRecord[]; gifts: Gift[]; }
export interface MatchCandidate { id: string; recordIds: string[]; donorIds: string[]; name: string; confidence: Confidence; reason: string; evidence: string[]; status: 'pending' | 'approved' | 'rejected' | 'skipped'; assessedBy: 'rules' | 'ai'; }
export interface LateFlag { donorId: string; name: string; pattern: 'monthly' | 'quarterly' | 'annual'; expectedDate: string; daysLate: number; lastGiftDate: string; lastAmountCents: number; usualAmountCents: number; annualValueCents: number; reason: string; firstGiftYear: number; program: string; }
export interface Outreach { donorId: string; status: ContactStatus; result: string; at: string; snoozedUntil: string | null; }
export interface MergeLog { id: string; donorId: string; name: string; recordIds: string[]; at: string; reason: string; undone: boolean; }
export interface SourceFreshness { source: Source; file: string; importedAt: string; throughDate: string; }
/** One uploaded spreadsheet, shown back exactly as its rows were received. */
export interface UploadedFile { file: string; source: Source; importedAt: string; throughDate: string; headers: string[]; rows: Record<string, string>[]; total: number; }
/** A guest who signed up at an event. The donor match is staff-only and never shown to the guest. */
export interface Signup { id: string; eventId: string; name: string; email: string; phone: string; zip: string; language: 'en' | 'es'; pledgeCents: number | null; consent: boolean; createdAt: string; matchDonorId: string | null; matchName: string | null; matchReason: string | null; matchConfidence: Confidence | null; }
/** An event with its own public sign-up page. */
export interface SignupEvent { id: string; code: string; name: string; host: string; date: string; createdAt: string; createdBy: 'staff' | 'assistant'; signups: Signup[]; }
export interface Snapshot { donors: Donor[]; matches: MatchCandidate[]; flags: LateFlag[]; outreach: Outreach[]; merges: MergeLog[]; sources: SourceFreshness[]; events: SignupEvent[]; today: string; demo: boolean; aiAvailable: boolean; giftCount: number; totalCents: number; }
export type Action = { type: 'merge'; candidateIds: string[]; email?: string; address?: string } | { type: 'undo'; mergeId: string } | { type: 'reject' | 'skip'; candidateId: string } | { type: 'undoReview'; candidateId: string } | { type: 'undoEditContact'; donorId: string } | { type: 'contact'; donorId: string; status: ContactStatus; result: string } | { type: 'undoContact'; donorId: string } | { type: 'editContact'; donorId: string; email: string; address: string; language: 'en' | 'es' } | { type: 'reset' };
export interface Approval { id: string; title: string; description: string; items: string[]; action: Action; expiresAt: string; }
export interface CommandResult { message: string; view?: 'home' | 'matches' | 'calls' | 'donors' | 'events'; donorId?: string; donorIds?: string[]; eventId?: string; answer?: { label: string; count: number; totalCents: number | null }; approval?: Approval; note?: string; mode: 'ai' | 'demo'; }
export interface ImportResult { imported: number; skipped: number; files: number; warnings: string[]; needsSource?: { file: string }[]; needsMapping?: { file: string; headers: string[]; missing: string[] }[]; }
export type ColumnMap = Partial<Record<'name'|'firstName'|'lastName'|'email'|'phone'|'address'|'zip'|'amount'|'date'|'recurring'|'source'|'transactionId'|'program'|'kind'|'language', string>>;
