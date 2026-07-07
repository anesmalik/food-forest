import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET

  if (!webhookSecret) {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text()

  const headerPayload = await headers()
  const svixId = headerPayload.get('svix-id')
  const svixTimestamp = headerPayload.get('svix-timestamp')
  const svixSignature = headerPayload.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 })
  }

  let event: any
  try {
    const wh = new Webhook(webhookSecret)
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const { id: clerkId, email_addresses, first_name, last_name } = event.data
    const email = email_addresses?.[0]?.email_address ?? ''
    const displayName = [first_name, last_name].filter(Boolean).join(' ') || email

    const { error } = await supabase
      .from('users')
      .upsert(
        {
          clerk_id: clerkId,
          email,
          display_name: displayName,
        },
        { onConflict: 'clerk_id' }
      )

    if (error) {
      console.error('webhook upsert error:', error)
      return NextResponse.json({ error: 'db upsert failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}