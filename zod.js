import { z } from 'zod'

export const userSchema = z.object({
  email: z.string().email(),
  age: z.number().max(120).min(0)
})
