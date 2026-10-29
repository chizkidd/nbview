import { handle } from '../_lib/preview.mjs';

export const onRequest = ({ request }) => handle(request, 'github');
