// The owner's assistant lives in a side panel on every owner page; this address just opens it.
import { redirect } from 'next/navigation';

export default function Assistant() {
  redirect('/owner?assistant=1');
}
