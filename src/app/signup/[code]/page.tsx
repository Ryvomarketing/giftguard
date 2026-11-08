import type { Metadata } from 'next';
import { publicEvent } from '@/lib/events';
import { SignupForm } from '@/components/signup-form';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const event = publicEvent(code);
  return { title: event ? `${event.name} — Sign up` : 'Sign up', robots: { index: false, follow: false } };
}

/** The only page a guest ever sees. It knows the event's name and date and nothing else. */
export default async function SignupPage({ params }: Params) {
  const { code } = await params;
  const event = publicEvent(code);
  return (
    <main className="signup-page">
      {event
        ? <SignupForm event={event} />
        : <div className="signup-card"><p className="signup-kicker">Sign up</p><h1 className="signup-title">This page is not available.</h1><p className="signup-meta">The link may be out of date. Please ask a staff member for the current sign-up page.</p></div>}
    </main>
  );
}
