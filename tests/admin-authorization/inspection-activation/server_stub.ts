export const handlers: Array<(request: Request) => Response | Promise<Response>> = [];
export function serve(handler: typeof handlers[number]) { handlers.push(handler); }
