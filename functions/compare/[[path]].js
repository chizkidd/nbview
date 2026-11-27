import { handle } from '../_lib/preview.mjs';

export function onRequest({ request }) {
  return handle(request, 'compare');
}
