import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Every new /api/cron/* route must be added here explicitly. Crons authenticate
// via a Bearer CRON_SECRET header, not a Clerk session, so without this listing
// Clerk's auth.protect() blocks the request before it ever reaches the route
// handler — the request 404s in a way that looks like a routing bug, not an
// auth bug. (T2.4b and T2.5 both hit this the same way; don't repeat it on T-future crons.)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/clerk',
  '/api/cron/export',
  '/api/cron/embeddings',
  '/api/cron/task-alerts',
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}