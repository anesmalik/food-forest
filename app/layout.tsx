import type { Metadata } from 'next'
import { ClerkProvider, auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@/lib/supabase'
import './globals.css'

export const metadata: Metadata = {
  title: 'Food Forest',
  description: 'Work tracking and knowledge management',
}

async function getUserRow(clerkId: string) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', clerkId)
    .single()
  return data
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (userId) {
    const user = await getUserRow(userId)
    if (!user) {
      return (
        <ClerkProvider>
          <html lang="en">
            <body>
              <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
                <h1>Account being set up</h1>
                <p>Your account is being configured. This usually takes a few seconds. Refresh to try again.</p>
              </div>
            </body>
          </html>
        </ClerkProvider>
      )
    }
  }

  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}