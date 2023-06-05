import * as hubspot from '@hubspot/api-client'
import { z } from 'zod'
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const ZChatData = z.object({
  id: z.string(),
  started_timestamp: z.number(),
  ended_timestamp: z.number(),
  messages: z.array(z.object({
    user_type: z.enum(['agent', 'supervisor', 'visitor']),
    author_name: z.string(),
    text: z.string(),
    timestamp: z.number(),
  }))
})
type ZChatData = z.infer<typeof ZChatData>

const ZVisitorData = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  custom_variables: z.array(z.record(z.string())).optional(),
})

const ZInput = z.object({
  chat: ZChatData,
  visitor: ZVisitorData,
})

const formatMessage = (chat: ZChatData) => (
  `LiveChat conversation transcript for chat https://my.livechatinc.com/archives/${chat.id}:
  ------------
  ${
    chat.messages
      .map(message => `[${new Date(message.timestamp).toLocaleTimeString('en')}] ${message.author_name}: ${message.text}`)
      .join('\n')
  }
  (Times in GMT-5)`
    .replace(/\n/g, "<br/>")
)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const token = process.env.HUBSPOT_TOKEN
  if (!token)
    throw new Error('Please define HUBSPOT_TOKEN as an env var')

  const client = new hubspot.Client({accessToken: token})
  const {visitor, chat} = ZInput.parse(JSON.parse(event.body))

  const getOrCreateContact = async () => {
    try {
      return await client.crm.contacts.basicApi.getById(visitor.email, undefined, undefined, undefined, undefined, 'email')
    } catch (e) {
      console.log(`Creating user ${visitor.name}:${visitor.email}`)
      return await client.crm.contacts.basicApi.create({
        properties: {
          email: visitor.email,
          firstname: visitor.name
        }
      })
    }
  }

  const contact = await getOrCreateContact()
  // Limit message size
  const body = formatMessage(chat).substring(0, 65_535)

  const note = await client.crm.objects.notes.basicApi.create({
    properties: {
      hs_note_body: body,
      hs_timestamp: Date.now().toString(),
    }
  })

  await client.crm.objects.notes.associationsApi.create(Number(note.id), 'contact', Number(contact.id), [])

  return {
    statusCode: 200,
    body: ''
  }
}
