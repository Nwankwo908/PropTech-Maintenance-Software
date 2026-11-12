export type Handler = (request: Request) => Response | Promise<Response>;
export const handlers: Handler[] = [];
export function serve(handler: Handler) {
  handlers.push(handler);
}
