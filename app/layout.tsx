import type { Metadata } from 'next'
import { ClerkProvider, UserButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@/lib/supabase'
import { tryBootstrapAdmin } from '@/lib/actions/bootstrap'
import './globals.css'

export const metadata: Metadata = {
  title: 'Food Forest',
  description: 'Work tracking and knowledge management',
}

async function getUserRow(clerkId: string) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('users')
    .select('id, role')
    .eq('clerk_id', clerkId)
    .single()
  return data
}

function SetupScreen({ message }: { message: string }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
            <h1>Account being set up</h1>
            <p>{message}</p>
          </div>
        </body>
      </html>
    </ClerkProvider>
  )
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (userId) {
    const user = await getUserRow(userId)

    // Sync-window guard: no row yet (webhook hasn't landed)
    if (!user) {
      return (
        <SetupScreen message="Your account is being configured. This usually takes a few seconds. Refresh to try again." />
      )
    }

    // Sync-window guard: row exists but no role (awaiting placement)
    if (user.role === null) {
      // Try bootstrap — if this is the configured first admin and zero admins exist, promote now
      await tryBootstrapAdmin()

      // Re-fetch to see if bootstrap promoted us
      const refreshed = await getUserRow(userId)
      if (!refreshed || refreshed.role === null) {
        return (
          <SetupScreen message="Your account is awaiting placement by an administrator. Please check back shortly." />
        )
      }
    }
  }

  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <div className="min-h-screen">
            <header className="flex items-center justify-between px-4 py-3 border-b bg-white">
              <span className="font-semibold text-gray-800">Food Forest</span>
              <UserButton />
            </header>
            {children}
          </div>
        </body>
      </html>
    </ClerkProvider>
  )
}
