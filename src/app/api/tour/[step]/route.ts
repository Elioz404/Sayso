// POST: run one step of the judge's tour, in the tour copy this browser owns.
import { HttpError, notFound } from '@/core/errors.ts';
import { TOUR_STEPS, type TourStep } from '@/core/tour.ts';
import { ready } from '@/server/context.ts';
import { handle, requireOwner } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ step: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { step } = await params;
    if (!TOUR_STEPS.includes(step as TourStep)) throw new HttpError(400, `Steps are ${TOUR_STEPS.join(', ')}`);
    const { tours } = await ready();
    if (!tours) throw notFound('Tour');
    return Response.json(await tours.run(shopId, step as TourStep));
  });
}
